'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { Transform, Writable } = require('node:stream');
const { FtpClient } = require('./ftp-client');
const { validPort } = require('./target');
const { createError } = require('../i18n');

const TITLES = Object.freeze(['PPSA01650', 'PPSA01651', 'PPSA01652']);
const fail = (code, key, detail) => createError(code, key, {}, detail);

function validateOptions(options) {
  if (!options || !TITLES.includes(options.titleId) || !validPort(options.port) || options.prepared !== true)
    throw fail('Y2JB_PREPARATION', 'y2jb.preparationError');
  return { titleId: options.titleId, port: options.port };
}

// Hash the uploaded file through RETR; SIZE alone cannot establish byte integrity.
async function verifyRemote(client, remote, expected) {
  const reply = client.expect(await client.command(`SIZE ${remote}`), [213]);
  if (!/^\d+$/.test(reply.text) || Number(reply.text) !== expected.size)
    throw fail('Y2JB_VERIFY', 'y2jb.verifyError');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  await client.retrieve(remote, () => new Writable({ write(chunk, encoding, done) {
    bytes += chunk.length;
    if (bytes > expected.size) return done(fail('Y2JB_VERIFY', 'y2jb.verifyError'));
    hash.update(chunk); done();
  } }));
  if (bytes !== expected.size || hash.digest('hex') !== expected.sha256)
    throw fail('Y2JB_VERIFY', 'y2jb.verifyError');
}

async function install(file, item, target, options, { signal, onUpdate = () => {} } = {}) {
  if (item.verification !== 'ftp' || item.format !== 'dat') throw fail('Y2JB_COMPONENT', 'y2jb.preparationError');
  const { titleId, port } = validateOptions(options);
  const timeout = AbortSignal.timeout(30 * 60 * 1000);
  const boundedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const client = new FtpClient(target.address, port, boundedSignal);
  const directory = `/user/download/${titleId}`;
  const destination = `${directory}/download0.dat`;
  const token = crypto.randomUUID();
  const staging = `${directory}/.ps5-local-host-${token}.part`;
  const backup = `${directory}/download0.dat.backup-${token}`;
  let handle; let staged = false; let publishing = false; let hadOriginal = false;
  const canceled = () => {
    if (boundedSignal.aborted) throw fail(signal?.aborted ? 'TASK_CANCELED' : 'Y2JB_TIMEOUT',
      signal?.aborted ? 'remote.canceled' : 'y2jb.timeout');
  };
  try {
    canceled();
    // Keep one descriptor open throughout, even if a later download changes the cache name.
    handle = await fs.promises.open(file, 'r');
    if ((await handle.stat()).size !== item.size) throw fail('Y2JB_VERIFY', 'y2jb.verifyError');
    const hash = crypto.createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) { canceled(); hash.update(chunk); }
    if (hash.digest('hex') !== item.sha256) throw fail('Y2JB_VERIFY', 'y2jb.verifyError');
    canceled();
    await client.open();
    // Do not invent system directories on a wrong FTP server or unsupported setup.
    client.expect(await client.command('CWD /user/download'), [250]);
    client.expect(await client.command('CWD /'), [250]);
    await client.mkdir(directory);
    hadOriginal = await client.exists(destination);
    onUpdate({ phase: 'y2jbUploading', transferProgress: 0, destination });
    let sent = 0; let lastUpdate = 0;
    staged = true;
    await client.store(staging, () => {
      const source = handle.createReadStream({ start: 0, autoClose: false });
      const meter = new Transform({ transform(chunk, encoding, done) {
        sent += chunk.length;
        if (Date.now() - lastUpdate >= 200) {
          lastUpdate = Date.now(); onUpdate({ transferProgress: Math.min(99, sent / item.size * 100) });
        }
        done(null, chunk);
      } });
      source.on('error', cause => meter.destroy(cause));
      meter.once('close', () => source.destroy());
      source.pipe(meter); return meter;
    });
    onUpdate({ phase: 'y2jbVerifying', transferProgress: 100 });
    await verifyRemote(client, staging, item);
    canceled();
    // Recheck presence before publishing. No other app should modify this cache during installation.
    if (await client.exists(destination) !== hadOriginal) throw fail('Y2JB_CHANGED', 'y2jb.changed');
    onUpdate({ phase: 'y2jbPublishing' });
    publishing = true;
    if (hadOriginal) {
      await client.rename(destination, backup);
      onUpdate({ backupPath: backup });
    }
    canceled();
    await client.rename(staging, destination);
    return { status: 'y2jbInstalled', backupPath: hadOriginal ? backup : null };
  } catch (original) {
    let cause = original;
    if (publishing) cause = fail('RESULT_UNCONFIRMED', 'y2jb.unconfirmed', `Destination: ${destination}; backup: ${backup}; staging: ${staging}`);
    else if (signal?.aborted) cause = fail('TASK_CANCELED', 'remote.canceled');
    else if (timeout.aborted) cause = fail('Y2JB_TIMEOUT', 'y2jb.timeout');
    else if (!cause.i18nKey) cause = fail(original.code || 'Y2JB_FTP', 'y2jb.ftpError', original.message);
    client.close();
    if (staged) {
      const cleanup = new FtpClient(target.address, port, AbortSignal.timeout(10000));
      try {
        await cleanup.open();
        if (publishing) {
          // A lost RNTO reply is ambiguous. Never delete a destination or overwrite a backup.
          const backupExists = hadOriginal && await cleanup.exists(backup);
          onUpdate({ backupPath: backupExists ? backup : null });
          if (backupExists && !await cleanup.exists(destination)) {
            await cleanup.rename(backup, destination);
            onUpdate({ backupPath: null });
            cause = fail('Y2JB_RESTORED', 'y2jb.restored', `Destination: ${destination}; staging: ${staging}`);
          }
          onUpdate({ recoveryPath: await cleanup.exists(staging) ? staging : null });
        } else {
          cleanup.expect(await cleanup.command(`DELE ${staging}`), [250, 550]);
        }
      } catch {
        onUpdate({ recoveryPath: staging });
        cause.detail = `${cause.detail || cause.message}; staging: ${staging}; backup: ${backup}`;
      } finally { cleanup.close(); }
    }
    throw cause;
  } finally { client.close(); await handle?.close(); }
}

module.exports = { install, validateOptions, verifyRemote, TITLES };
