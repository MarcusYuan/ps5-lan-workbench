'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { selectGame, publicGame, transfer } = require('../src/ps5/game-transfer');

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-ftp-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const folder = path.join(temp, 'PPSA00001');
  await fs.mkdir(path.join(folder, 'sce_sys'), { recursive: true });
  await fs.mkdir(path.join(folder, 'empty'));
  await fs.writeFile(path.join(folder, 'eboot.bin'), Buffer.alloc(1024 * 1024, 7));
  await fs.writeFile(path.join(folder, 'sce_sys', 'param.json'), JSON.stringify({ titleId: 'PPSA00001' }));
  await fs.writeFile(path.join(folder, 'zero.dat'), '');
  return { temp, folder };
}

// Real TCP control/data channels exercise command ordering, passive mode and cleanup.
async function ftpServer(t, options = {}) {
  const files = new Map(); const directories = new Set(['/', '/data', '/data/homebrew']);
  const commands = []; const sockets = new Set(); const servers = new Set();
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); };
  const control = net.createServer(socket => {
    track(socket); socket.write('220-Test server\r\n220 Ready\r\n');
    let buffer = ''; let pendingData; let passive; let renameFrom;
    const reply = message => socket.write(message + '\r\n');
    const command = async line => {
      commands.push(line);
      const split = line.indexOf(' '); const verb = split < 0 ? line : line.slice(0, split); const arg = split < 0 ? '' : line.slice(split + 1);
      if (verb === 'USER') return reply(options.denyLogin ? '530 Login refused' : '331 Password');
      if (verb === 'PASS') return reply('230 Logged in');
      if (verb === 'TYPE') return reply('200 Binary');
      if (verb === 'SIZE') return reply(files.has(arg) ? `213 ${files.get(arg).length + (options.badSize ? 1 : 0)}` : '550 Missing');
      if (verb === 'CWD') return reply(directories.has(arg) ? '250 Directory' : '550 Missing');
      if (verb === 'MKD') { directories.add(arg); return reply('257 Created'); }
      if (verb === 'EPSV' && options.pasv) return reply('502 Unsupported');
      if (verb === 'EPSV' || verb === 'PASV') {
        pendingData = new Promise(resolve => {
          passive = net.createServer(data => { track(data); data.pause(); resolve(data); });
          servers.add(passive);
        });
        await listen(passive);
        const port = passive.address().port;
        // Deliberately advertise a different host; client must use the control peer.
        return reply(verb === 'EPSV' ? `229 Passive (|||${port}|)` : `227 Passive (192,0,2,1,${port >> 8},${port & 255})`);
      }
      if (verb === 'STOR') {
        reply('150 Send file');
        const data = await pendingData; const chunks = [];
        data.on('data', chunk => chunks.push(chunk));
        data.on('end', () => {
          files.set(arg, Buffer.concat(chunks)); data.end(); passive.close();
          if (options.disconnectOnStore) { socket.destroy(); return; }
          if (!options.noCompletion) reply('226 Complete');
          options.onStored?.(arg);
        });
        data.resume(); return;
      }
      if (verb === 'RNFR') { renameFrom = arg; return reply('350 Rename'); }
      if (verb === 'RNTO') {
        if (files.has(renameFrom)) { files.set(arg, files.get(renameFrom)); files.delete(renameFrom); }
        else {
          for (const [file, bytes] of [...files]) if (file.startsWith(renameFrom + '/')) { files.set(arg + file.slice(renameFrom.length), bytes); files.delete(file); }
          for (const directory of [...directories]) if (directory === renameFrom || directory.startsWith(renameFrom + '/')) { directories.add(arg + directory.slice(renameFrom.length)); directories.delete(directory); }
        }
        if (options.disconnectOnRename) { socket.destroy(); return; }
        return reply('250 Renamed');
      }
      if (verb === 'DELE') { files.delete(arg); return reply('250 Deleted'); }
      if (verb === 'RMD') { directories.delete(arg); return reply('250 Removed'); }
      reply('500 Unknown');
    };
    let queue = Promise.resolve();
    socket.on('data', data => {
      buffer += data.toString(); let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        queue = queue.then(() => command(line)).catch(() => socket.destroy());
      }
    });
  });
  servers.add(control); await listen(control);
  t.after(async () => { for (const socket of sockets) socket.destroy(); for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve)); });
  return { port: control.address().port, files, directories, commands };
}

test('folder transfer preserves contents and empty directories, publishing only after verified uploads', async t => {
  const { folder } = await fixture(t); const ftp = await ftpServer(t);
  const selected = await selectGame(folder, 'folder');
  assert.equal(publicGame(selected).fileCount, 3);
  assert.equal(publicGame(selected).path, undefined);
  assert.equal((await transfer(selected, { address: '127.0.0.1' }, { port: ftp.port })).status, 'transferred');
  assert.equal(ftp.files.get('/data/homebrew/PPSA00001/eboot.bin').length, 1024 * 1024);
  assert.equal(ftp.files.get('/data/homebrew/PPSA00001/zero.dat').length, 0);
  assert.ok(ftp.directories.has('/data/homebrew/PPSA00001/empty'));
  assert.ok(ftp.commands.filter(line => line.startsWith('STOR ')).every(line => !line.includes('/data/homebrew/')));
  assert.ok(![...ftp.directories].some(name => name.startsWith('/data/.ps5-local-host-')));
});

test('image transfer supports PASV fallback and never connects to its advertised foreign host', async t => {
  const { temp } = await fixture(t); const ftp = await ftpServer(t, { pasv: true });
  const image = path.join(temp, 'Game 中文.exfat'); const bytes = Buffer.alloc(1024, 3);
  await fs.writeFile(image, bytes);
  await transfer(await selectGame(image, 'image'), { address: '127.0.0.1' }, { port: ftp.port });
  assert.deepEqual(ftp.files.get('/data/homebrew/Game 中文.exfat'), bytes);
  assert.ok(ftp.commands.includes('PASV'));
  assert.ok(![...ftp.directories].some(name => name.startsWith('/data/.ps5-local-host-')));
});

test('existing destinations and changed sources are rejected before uploading', async t => {
  const { folder } = await fixture(t); const ftp = await ftpServer(t);
  const selected = await selectGame(folder, 'folder');
  ftp.directories.add('/data/homebrew/PPSA00001');
  await assert.rejects(transfer(selected, { address: '127.0.0.1' }, { port: ftp.port }), { code: 'GAME_EXISTS' });
  assert.ok(!ftp.commands.some(command => command.startsWith('STOR')));
  await fs.writeFile(path.join(folder, 'zero.dat'), 'changed');
  await assert.rejects(transfer(selected, { address: '127.0.0.1' }, { port: ftp.port }), { code: 'GAME_CHANGED' });
});

test('size mismatch removes task staging and does not publish a game', async t => {
  const { folder } = await fixture(t); const ftp = await ftpServer(t, { badSize: true });
  await assert.rejects(transfer(await selectGame(folder, 'folder'), { address: '127.0.0.1' }, { port: ftp.port }), { code: 'GAME_SIZE' });
  assert.equal(ftp.files.size, 0);
  assert.ok(!ftp.directories.has('/data/homebrew/PPSA00001'));
  assert.ok(![...ftp.directories].some(name => name.startsWith('/data/.ps5-local-host-')));
});

test('cancel while waiting for upload completion cleans up partial files', async t => {
  const { folder } = await fixture(t); const abort = new AbortController();
  const ftp = await ftpServer(t, { noCompletion: true, onStored: () => abort.abort() });
  await assert.rejects(transfer(await selectGame(folder, 'folder'), { address: '127.0.0.1' }, { port: ftp.port, signal: abort.signal }), { code: 'TASK_CANCELED' });
  assert.equal(ftp.files.size, 0);
  assert.ok(!ftp.directories.has('/data/homebrew/PPSA00001'));
});

test('selection rejects incomplete folders, installation packages and directory links', async t => {
  const { temp, folder } = await fixture(t);
  await assert.rejects(selectGame(temp, 'folder'), { code: 'GAME_INVALID' });
  const pkg = path.join(temp, 'game.pkg'); await fs.writeFile(pkg, Buffer.alloc(1024));
  await assert.rejects(selectGame(pkg, 'image'), { code: 'GAME_INVALID' });
  const link = path.join(folder, 'linked'); await fs.symlink(temp, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(selectGame(folder, 'folder'), { code: 'GAME_INVALID' });
});

test('FFPKG image is transferred as a file, not treated as an install package', async t => {
  const { temp } = await fixture(t); const ftp = await ftpServer(t);
  const image = path.join(temp, 'Game.ffpkg'); await fs.writeFile(image, Buffer.alloc(512));
  const selected = await selectGame(image, 'image');
  await transfer(selected, { address: '127.0.0.1' }, { port: ftp.port });
  assert.equal(ftp.files.get('/data/homebrew/Game.ffpkg').length, 512);
});

test('lost upload connection cleans only staging, preserving unrelated remote content', async t => {
  const { folder } = await fixture(t); const ftp = await ftpServer(t, { disconnectOnStore: true });
  ftp.files.set('/data/homebrew/Other.exfat', Buffer.from('keep'));
  await assert.rejects(transfer(await selectGame(folder, 'folder'), { address: '127.0.0.1' }, { port: ftp.port }));
  assert.equal(ftp.files.size, 1);
  assert.equal(ftp.files.get('/data/homebrew/Other.exfat').toString(), 'keep');
  assert.ok(!ftp.directories.has('/data/homebrew/PPSA00001'));
});

test('lost final rename reply reports an unconfirmed result without deleting published content', async t => {
  const { folder } = await fixture(t); const ftp = await ftpServer(t, { disconnectOnRename: true });
  await assert.rejects(transfer(await selectGame(folder, 'folder'), { address: '127.0.0.1' }, { port: ftp.port }), { code: 'RESULT_UNCONFIRMED' });
  assert.ok(ftp.files.has('/data/homebrew/PPSA00001/eboot.bin'));
  assert.ok(!ftp.commands.some(command => command.startsWith('DELE /data/homebrew/')));
});

test('login refusal does not create directories or send data', async t => {
  const { folder } = await fixture(t); const ftp = await ftpServer(t, { denyLogin: true });
  await assert.rejects(transfer(await selectGame(folder, 'folder'), { address: '127.0.0.1' }, { port: ftp.port }), { code: 'FTP_REPLY' });
  assert.ok(!ftp.commands.some(command => /^(STOR|MKD) /.test(command)));
});
