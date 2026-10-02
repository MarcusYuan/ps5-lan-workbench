'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { install, validateOptions } = require('../src/ps5/y2jb-installer');
const { component } = require('../src/components/catalog');
const { download, inspect, cachePath } = require('../src/components/downloader');

const destination = '/user/download/PPSA01650/download0.dat';
const old = Buffer.from('original YouTube download data');
const bytes = Buffer.alloc(96 * 1024, 5);
const item = { format: 'dat', verification: 'ftp', size: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex') };

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'y2jb-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'download0.dat'); await fs.writeFile(file, bytes);
  const files = new Map(options.fresh ? [] : [[destination, old]]);
  files.set('/data/ps5_autoloader/autoload.txt', Buffer.from('custom.elf'));
  const directories = new Set(['/', '/user/download', '/user/download/PPSA01650']);
  const sockets = new Set(); const servers = new Set(); const commands = [];
  let renameCount = 0; let connections = 0;
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); };
  const control = net.createServer(socket => {
    const connection = ++connections;
    track(socket); socket.write('220 Ready\r\n');
    let buffer = ''; let dataPromise; let passive; let from;
    const reply = text => socket.write(text + '\r\n');
    async function command(line) {
      commands.push(line);
      const [verb, ...rest] = line.split(' '); const arg = rest.join(' ');
      if (verb === 'USER') return reply(options.deny || (options.denyCleanup && connection > 1) ? '530 Denied' : '230 Ready');
      if (verb === 'TYPE') return reply('200 Binary');
      if (verb === 'CWD') return reply(directories.has(arg) ? '250 OK' : '550 Missing');
      if (verb === 'MKD') { directories.add(arg); return reply('257 Created'); }
      if (verb === 'SIZE') return reply(files.has(arg) ? `213 ${files.get(arg).length}` : '550 Missing');
      if (verb === 'EPSV' && options.pasv) return reply('502 Unsupported');
      if (verb === 'EPSV' || verb === 'PASV') {
        dataPromise = new Promise(resolve => {
          passive = net.createServer(data => { track(data); data.pause(); resolve(data); }); servers.add(passive);
        });
        await listen(passive); const port = passive.address().port;
        return reply(verb === 'EPSV' ? `229 Passive (|||${port}|)` : `227 Passive (192,0,2,1,${port >> 8},${port & 255})`);
      }
      if (verb === 'STOR') {
        reply('150 Upload'); const data = await dataPromise; const chunks = [];
        data.on('data', chunk => chunks.push(chunk));
        data.on('end', () => {
          files.set(arg, Buffer.concat(chunks)); data.end(); passive.close();
          options.onStored?.();
          if (options.disconnectUpload) return socket.destroy();
          reply('226 Complete');
        }); data.resume(); return;
      }
      if (verb === 'RETR') {
        reply('150 Download'); const data = await dataPromise;
        const payload = Buffer.from(files.get(arg)); if (options.corruptReadback) payload[0] ^= 1;
        data.end(payload, () => { passive.close(); reply('226 Complete'); }); return;
      }
      if (verb === 'RNFR') { from = arg; return reply(files.has(from) ? '350 Rename' : '550 Missing'); }
      if (verb === 'RNTO') {
        renameCount++;
        if (renameCount === options.failRename) return reply('550 Rename failed');
        if (files.has(arg)) return reply('550 Exists');
        files.set(arg, files.get(from)); files.delete(from);
        options.onRenamed?.(renameCount);
        if (renameCount === options.disconnectRename) return socket.destroy();
        return reply('250 Renamed');
      }
      if (verb === 'DELE') { files.delete(arg); return reply('250 Deleted'); }
      return reply('500 Unknown');
    }
    let queue = Promise.resolve();
    socket.on('data', chunk => {
      buffer += chunk.toString(); let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        queue = queue.then(() => command(line)).catch(() => socket.destroy());
      }
    });
  });
  servers.add(control); await listen(control);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  const updates = [];
  const run = signal => install(file, item, { address: '127.0.0.1' }, {
    titleId: 'PPSA01650', port: control.address().port, prepared: true,
  }, { signal, onUpdate: update => updates.push(update) });
  return { dir, file, files, commands, updates, run };
}

test('Y2JB upload is read back before replacement; original and autoload config are retained', async t => {
  const f = await fixture(t, { pasv: true }); const result = await f.run();
  assert.equal(result.status, 'y2jbInstalled');
  assert.deepEqual(f.files.get(destination), bytes);
  assert.deepEqual(f.files.get(result.backupPath), old);
  assert.equal(f.files.get('/data/ps5_autoloader/autoload.txt').toString(), 'custom.elf');
  assert.ok(f.commands.findIndex(c => c.startsWith('RETR ')) < f.commands.findIndex(c => c.startsWith('RNFR ')));
  assert.ok(![...f.files.keys()].some(p => p.endsWith('.part')));
});

test('Y2JB first install works without an existing download0.dat', async t => {
  const f = await fixture(t, { fresh: true });
  assert.equal((await f.run()).backupPath, null);
  assert.deepEqual(f.files.get(destination), bytes);
});

test('same-size corruption during readback preserves the original and removes staging', async t => {
  const f = await fixture(t, { corruptReadback: true });
  await assert.rejects(f.run(), { code: 'Y2JB_VERIFY' });
  assert.deepEqual(f.files.get(destination), old);
  assert.ok(!f.commands.some(c => c.startsWith('RNFR ')));
  assert.ok(![...f.files.keys()].some(p => p.endsWith('.part')));
});

test('failed final rename restores original data and retains staging for diagnosis', async t => {
  const f = await fixture(t, { failRename: 2 });
  await assert.rejects(f.run(), { code: 'Y2JB_RESTORED' });
  assert.deepEqual(f.files.get(destination), old);
  assert.ok(f.updates.some(u => u.recoveryPath));
});

test('lost final rename acknowledgement never deletes the new destination or backup', async t => {
  const f = await fixture(t, { disconnectRename: 2 });
  await assert.rejects(f.run(), { code: 'RESULT_UNCONFIRMED' });
  assert.deepEqual(f.files.get(destination), bytes);
  assert.deepEqual([...f.files.entries()].find(([p]) => p.includes('.backup-'))[1], old);
  assert.ok(!f.commands.some(c => c.startsWith('DELE ')));
});

test('lost backup rename acknowledgement restores the original when destination is absent', async t => {
  const f = await fixture(t, { disconnectRename: 1 });
  await assert.rejects(f.run(), { code: 'Y2JB_RESTORED' });
  assert.deepEqual(f.files.get(destination), old);
});

test('canceling upload cleans staging and leaves the original intact', async t => {
  const abort = new AbortController(); const f = await fixture(t, { onStored: () => abort.abort() });
  await assert.rejects(f.run(abort.signal), { code: 'TASK_CANCELED' });
  assert.deepEqual(f.files.get(destination), old);
  assert.ok(![...f.files.keys()].some(p => p.endsWith('.part')));
});

test('interrupted upload and FTP refusal never replace existing data', async t => {
  for (const options of [{ disconnectUpload: true }, { deny: true }]) {
    const f = await fixture(t, options); await assert.rejects(f.run());
    assert.deepEqual(f.files.get(destination), old);
    assert.ok(!f.commands.some(c => c.startsWith('RNFR ')));
  }
});

test('cancel during backup replacement restores original data using a new connection', async t => {
  const abort = new AbortController();
  const f = await fixture(t, { onRenamed: count => { if (count === 1) abort.abort(); } });
  await assert.rejects(f.run(abort.signal), { code: 'Y2JB_RESTORED' });
  assert.deepEqual(f.files.get(destination), old);
  assert.ok(f.updates.some(update => update.backupPath === null));
});

test('cleanup refusal reports the staging path without claiming removal or changing original data', async t => {
  const f = await fixture(t, { corruptReadback: true, denyCleanup: true });
  await assert.rejects(f.run(), { code: 'Y2JB_VERIFY' });
  assert.deepEqual(f.files.get(destination), old);
  const retained = f.updates.find(update => update.recoveryPath)?.recoveryPath;
  assert.ok(f.files.has(retained));
});

test('changed local cache is rejected before contacting FTP', async t => {
  const f = await fixture(t); await fs.writeFile(f.file, Buffer.alloc(bytes.length, 9));
  await assert.rejects(f.run(), { code: 'Y2JB_VERIFY' });
  assert.equal(f.commands.length, 0);
});

test('installer only accepts prepared requests, allowlisted title IDs and valid ports', () => {
  for (const titleId of ['../PPSA01650', 'PPSA01650\r\nDELE /data', 'PPSA99999'])
    assert.throws(() => validateOptions({ titleId, port: 2121, prepared: true }));
  for (const port of [0, 65536, 2.5, '2121'])
    assert.throws(() => validateOptions({ titleId: 'PPSA01650', port, prepared: true }));
  assert.throws(() => validateOptions({ titleId: 'PPSA01650', port: 2121, prepared: false }));
});

test('DAT download failure preserves independent caches and never accepts truncated data', async t => {
  const f = await fixture(t);
  for (const id of ['y2jb', 'y2jbDev']) {
    const file = cachePath(f.dir, id); await fs.writeFile(file, old);
    assert.ok(file.endsWith('.dat'));
    await assert.rejects(download(f.dir, id, { fetchImpl: async () => new Response(bytes) }), /checksum mismatch/);
    assert.deepEqual(await fs.readFile(file), old);
    assert.equal(await inspect(f.dir, id), null);
    assert.equal(component(id).size, 336789504);
  }
  assert.ok(!(await fs.readdir(f.dir)).some(p => p.endsWith('.part')));
});
