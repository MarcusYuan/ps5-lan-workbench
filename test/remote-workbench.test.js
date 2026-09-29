'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { normalizeTarget } = require('../src/ps5/target');
const { identify, loadDecision } = require('../src/ps5/manager-client');
const { selectPkg } = require('../src/pkg/file');
const { install, SEGMENT_BYTES, MAX_FLIGHTS } = require('../src/pkg/install-session');
const { component } = require('../src/components/catalog');

async function fixturePkg(dir, size = 512) {
  const file = path.join(dir, 'sample.pkg');
  const data = Buffer.alloc(512);
  data.set([0x7f, 0x43, 0x4e, 0x54], 0);
  data.writeUInt32BE(1, 0x10);
  data.writeUInt32BE(0x80, 0x18);
  data.write('UP0000-CUSA00001_00-TESTPACKAGE0000', 0x40, 'utf8');
  data.writeUInt32BE(0x2000, 0x80);
  data.writeUInt32BE(0xa0, 0x80 + 16);
  const meta = Buffer.from(JSON.stringify({ titleName: 'Test package', titleId: 'CUSA00001', contentVersion: '1.00' }));
  data.writeUInt32BE(meta.length, 0x80 + 20);
  meta.copy(data, 0xa0);
  await fsp.writeFile(file, data);
  if (size > data.length) {
    const handle = await fsp.open(file, 'r+');
    try { await handle.truncate(size); } finally { await handle.close(); }
  }
  return file;
}

test('target settings remain separate from the computer NIC and validate IPv4/ports', () => {
  assert.deepEqual(normalizeTarget({ address: '192.168.100.2' }),
    { address: '192.168.100.2', elfPort: 9021, managerPort: 8844 });
  assert.throws(() => normalizeTarget({ address: '192.168.100.999' }), /Invalid PS5 IPv4/);
  assert.throws(() => normalizeTarget({ address: '192.168.100.2', managerPort: 0 }), /Invalid PS5 port/);
  assert.equal(component('pkgManager').sha256.length, 64);
});

test('local PKG inspection supports a sparse 8 GiB file without reading it all', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ps5-pkg-test-'));
  try {
    const file = await fixturePkg(dir, 8 * 1024 * 1024 * 1024);
    const selected = await selectPkg(file);
    assert.equal(selected.size, 8 * 1024 * 1024 * 1024);
    assert.equal(selected.details.title_id, 'CUSA00001');
    assert.ok(SEGMENT_BYTES * MAX_FLIGHTS <= 32 * 1024 * 1024);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('local PKG inspection reads PS4 param.sfo metadata', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ps5-sfo-test-'));
  try {
    const file = path.join(dir, 'legacy.pkg');
    const bytes = Buffer.alloc(1024);
    bytes.set([0x7f, 0x43, 0x4e, 0x54]);
    bytes.writeUInt32BE(1, 0x10);
    bytes.writeUInt32BE(0x80, 0x18);
    bytes.write('UP0000-CUSA00002_00-TESTPACKAGE0000', 0x40);
    bytes.writeUInt32BE(0x1000, 0x80);
    bytes.writeUInt32BE(0x100, 0x80 + 16);
    const sfo = Buffer.alloc(256);
    sfo.writeUInt32LE(0x46535000, 0);
    sfo.writeUInt32LE(0x40, 8);
    sfo.writeUInt32LE(0x80, 12);
    sfo.writeUInt32LE(1, 16);
    sfo.writeUInt16LE(0, 20);
    sfo.writeUInt32LE(12, 24);
    sfo.writeUInt32LE(0, 32);
    sfo.write('TITLE', 0x40);
    sfo.write('Legacy Game', 0x80);
    bytes.writeUInt32BE(sfo.length, 0x80 + 20);
    sfo.copy(bytes, 0x100);
    await fsp.writeFile(file, bytes);
    const selected = await selectPkg(file);
    assert.equal(selected.details.title_name, 'Legacy Game');
    assert.equal(selected.details.title_id, 'CUSA00002');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a generic HTTP 200 service cannot impersonate PKG Manager', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(identify({ address: '127.0.0.1', managerPort: server.address().port }), /Unsupported/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('running PKG Manager is reported without resending; explicit reload requires idle state', () => {
  const idle = { upload: { active: false }, install: { is_installing: false } };
  assert.equal(loadDecision(idle), 'alreadyRunning');
  assert.equal(loadDecision(idle, true), 'send');
  for (const busy of [
    { upload: { active: true }, install: { is_installing: false } },
    { upload: { active: false }, install: { is_installing: true } },
  ]) {
    assert.equal(loadDecision(busy), 'alreadyRunningBusy');
    assert.throws(() => loadDecision(busy, true), cause => cause.code === 'MANAGER_BUSY');
  }
});

function serverFrame(value) {
  const body = Buffer.from(JSON.stringify(value));
  assert.ok(body.length < 126);
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
}

test('Direct Install uses returned WebSocket port and confirms PS5 status', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ps5-direct-test-'));
  const file = await fixturePkg(dir);
  const selected = await selectPkg(file);
  let sessionId = 'testsession';
  let headerReady = false;
  let installStarted = false;
  let currentSeg = null;
  let received = 0;
  const wsServer = net.createServer(socket => {
    let pending = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', bytes => {
      pending = Buffer.concat([pending, bytes]);
      if (!upgraded) {
        const end = pending.indexOf('\r\n\r\n');
        if (end < 0) return;
        const headers = pending.subarray(0, end + 4).toString();
        const key = headers.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i)?.[1];
        const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        pending = pending.subarray(end + 4); upgraded = true;
      }
      while (pending.length >= 2) {
        const opcode = pending[0] & 15;
        let length = pending[1] & 127;
        let offset = 2;
        if (length === 126) { if (pending.length < 4) break; length = pending.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (pending.length < 10) break; length = Number(pending.readBigUInt64BE(2)); offset = 10; }
        if (pending.length < offset + 4 + length) break;
        const mask = pending.subarray(offset, offset + 4); offset += 4;
        const body = Buffer.from(pending.subarray(offset, offset + length));
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
        pending = pending.subarray(offset + length);
        if (opcode === 1) {
          const message = JSON.parse(body.toString());
          if (message.op === 'init') socket.write(serverFrame({ op: 'ready', session_id: sessionId, demand_window: 1, upload_window: 2 }));
          else if (message.op === 'seg') currentSeg = message.seg;
          else if (message.op === 'ping') socket.write(serverFrame({ op: 'pong' }));
        } else if (opcode === 2) {
          received += body.length; headerReady = true;
          socket.write(serverFrame({ op: 'ack', seg: currentSeg }));
        } else if (opcode === 8) { socket.end(); break; }
      }
    });
  });
  await new Promise(resolve => wsServer.listen(0, '127.0.0.1', resolve));
  const control = http.createServer(async (req, res) => {
    const reply = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.url === '/api/version') { res.end('1.4.1'); return; }
    if (req.url === '/api/upload/status') { reply({ active: headerReady, header_ready: headerReady, session_id: headerReady ? sessionId : '' }); return; }
    if (req.url === '/api/poll') { reply({ is_installing: false, pkg_path: installStarted ? `live:${sessionId}` : '', completed: installStarted, failed: false, progress: installStarted ? 100 : 0 }); return; }
    if (req.url === '/api/upload/check') { reply({ can_install: true }); return; }
    if (req.url === '/api/upload/init') { reply({ success: true, session_id: sessionId, offset: 0, ws_port: wsServer.address().port }); return; }
    if (req.url === '/api/install') { installStarted = true; reply({ success: true }); return; }
    if (req.url === '/api/upload/cancel') { reply({ success: true }); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  try {
    const result = await install(selected, { address: '127.0.0.1', managerPort: control.address().port });
    assert.equal(result.status, 'confirmed');
    assert.equal(received, selected.size);
    assert.equal(installStarted, true);
  } finally {
    await new Promise(resolve => control.close(resolve));
    wsServer.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
