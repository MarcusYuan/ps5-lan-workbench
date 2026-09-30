'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { FtpClient } = require('./ftp-client');
const { validPort } = require('./target');

const fail = (code, message) => Object.assign(new Error(message), { code });
function safeName(name) {
  if (!name || name === '.' || name === '..' || /[\/\\\x00-\x1f\x7f]/.test(name))
    throw fail('GAME_INVALID', 'Unsafe file name');
  return name;
}
async function unchanged(file) {
  const stat = await fs.promises.lstat(file.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs ||
      await fs.promises.realpath(file.path) !== file.path)
    throw fail('GAME_CHANGED', 'Selected game files changed');
}

async function selectGame(source, kind) {
  if (!['folder', 'image'].includes(kind) || typeof source !== 'string') throw fail('GAME_INVALID', 'Invalid game selection');
  const absolute = path.resolve(source);
  const root = await fs.promises.lstat(absolute);
  if (root.isSymbolicLink()) throw fail('GAME_INVALID', 'Symbolic links are not supported');
  const real = await fs.promises.realpath(absolute);
  const name = safeName(path.basename(real));
  const files = []; const directories = [];
  const add = async (file, relative) => {
    if (files.length >= 200000) throw fail('GAME_INVALID', 'Too many game files');
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail('GAME_INVALID', 'Only regular files are supported');
    files.push({ path: file, relative, size: stat.size, mtimeMs: stat.mtimeMs });
  };
  if (kind === 'image') {
    if (!root.isFile() || !/\.(exfat|ffpkg)$/i.test(name) || root.size < 512)
      throw fail('GAME_INVALID', 'Select an .exfat or .ffpkg image');
    await add(real, name);
  } else {
    if (!root.isDirectory()) throw fail('GAME_INVALID', 'Select a game folder');
    const walk = async (directory, relative = '', depth = 0) => {
      if (depth > 64) throw fail('GAME_INVALID', 'Game directory nesting is too deep');
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        safeName(entry.name);
        const child = path.join(directory, entry.name);
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const stat = await fs.promises.lstat(child);
        if (stat.isSymbolicLink()) throw fail('GAME_INVALID', 'Symbolic links are not supported');
        if (stat.isDirectory()) {
          if (directories.length >= 200000) throw fail('GAME_INVALID', 'Too many game directories');
          directories.push(childRelative); await walk(child, childRelative, depth + 1);
        }
        else await add(child, childRelative);
      }
    };
    await walk(real);
    const metadata = files.find(file => file.relative === 'sce_sys/param.json');
    if (!files.some(file => file.relative === 'eboot.bin' && file.size > 0) || !metadata || metadata.size > 262144)
      throw fail('GAME_INVALID', 'Select the game root containing eboot.bin and sce_sys/param.json');
    try {
      const param = JSON.parse(await fs.promises.readFile(metadata.path, 'utf8'));
      if (!param || typeof param !== 'object' || Array.isArray(param) || typeof param.titleId !== 'string' || !param.titleId)
        throw new Error('Missing titleId');
    } catch { throw fail('GAME_INVALID', 'Invalid game param.json'); }
    // Publish the executable last even inside staging.
    files.sort((a, b) => Number(a.relative === 'eboot.bin') - Number(b.relative === 'eboot.bin'));
  }
  const size = files.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(size)) throw fail('GAME_INVALID', 'Game is too large');
  return { fileId: crypto.randomUUID(), name, kind, files, directories, size };
}

function publicGame(game) {
  return game ? { fileId: game.fileId, name: game.name, kind: game.kind, size: game.size, fileCount: game.files.length } : null;
}

async function transfer(game, target, { signal, onUpdate = () => {}, port = 2121 } = {}) {
  if (!validPort(port)) throw fail('INVALID_PS5_PORT', 'Invalid FTP port');
  const client = new FtpClient(target.address, port, signal);
  const final = `/data/homebrew/${safeName(game.name)}`;
  const stage = `/data/.ps5-local-host-${crypto.randomUUID()}`;
  let stageCreated = false; let published = false;
  let publishing = false;
  let sent = 0; let lastUpdate = 0;
  const stagedFiles = []; const stagedDirectories = [];
  const checkCanceled = () => { if (signal?.aborted) throw fail('TASK_CANCELED', 'Transfer canceled'); };
  try {
    for (const file of game.files) { checkCanceled(); await unchanged(file); }
    await client.open();
    await client.mkdir('/data/homebrew');
    if (await client.exists(final)) throw fail('GAME_EXISTS', 'Destination already exists; existing games are not overwritten');
    // A unique staging directory outside loader scan roots avoids partial-game registration.
    client.expect(await client.command(`MKD ${stage}`), [257, 250]);
    stageCreated = true;
    for (const directory of game.directories) {
      checkCanceled();
      await client.mkdir(`${stage}/${directory}`); stagedDirectories.push(`${stage}/${directory}`);
    }
    onUpdate({ phase: 'uploading', transferProgress: 0, destination: final });
    for (const file of game.files) {
      checkCanceled();
      await unchanged(file);
      const remote = `${stage}/${file.relative}`;
      stagedFiles.push(remote);
      const meter = new Transform({ transform(chunk, encoding, callback) {
        sent += chunk.length;
        if (Date.now() - lastUpdate >= 200) {
          lastUpdate = Date.now();
          onUpdate({ transferProgress: game.size ? Math.min(99, sent / game.size * 100) : 0 });
        }
        callback(null, chunk);
      } });
      await client.store(remote, () => {
        const stream = fs.createReadStream(file.path);
        stream.on('error', cause => meter.destroy(cause));
        meter.once('close', () => stream.destroy());
        stream.pipe(meter);
        return meter;
      });
      await unchanged(file);
      const reply = client.expect(await client.command(`SIZE ${remote}`), [213]);
      if (!/^\d+$/.test(reply.text) || Number(reply.text) !== file.size)
        throw fail('GAME_SIZE', 'Remote file size does not match');
    }
    for (const file of game.files) { checkCanceled(); await unchanged(file); }
    if (signal?.aborted) throw fail('TASK_CANCELED', 'Transfer canceled');
    if (await client.exists(final)) throw fail('GAME_EXISTS', 'Destination already exists');
    publishing = true;
    await client.rename(game.kind === 'folder' ? stage : `${stage}/${game.name}`, final);
    published = true;
    if (game.kind === 'image') {
      try { client.expect(await client.command(`RMD ${stage}`), [250]); }
      catch { onUpdate({ cleanupPath: stage }); }
    }
    return { status: 'transferred' };
  } catch (cause) {
    if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)$/.test(cause.code || '')) cause.i18nKey = 'game.ftpError';
    if (publishing && !published) cause = fail('RESULT_UNCONFIRMED', `Final rename unconfirmed; check ${final} on PS5`);
    else if (signal?.aborted && !published) cause = fail('TASK_CANCELED', 'Transfer canceled');
    if (stageCreated && !published) {
      // Reconnect without the canceled signal to remove only this task's staging files.
      const cleanupAbort = new AbortController();
      const cleanupTimer = setTimeout(() => cleanupAbort.abort(), 10000);
      const cleanup = new FtpClient(target.address, port, cleanupAbort.signal);
      try {
        await cleanup.open();
        for (const file of stagedFiles.reverse()) cleanup.expect(await cleanup.command(`DELE ${file}`), [250, 550]);
        for (const directory of stagedDirectories.reverse()) cleanup.expect(await cleanup.command(`RMD ${directory}`), [250, 550]);
        cleanup.expect(await cleanup.command(`RMD ${stage}`), [250, 550]);
      } catch { cause.message += `; unfinished staging may remain at ${stage}`; }
      finally { clearTimeout(cleanupTimer); cleanup.close(); }
    }
    throw cause;
  } finally { client.close(); }
}

module.exports = { selectGame, publicGame, transfer };
