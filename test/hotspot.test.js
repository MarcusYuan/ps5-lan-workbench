'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn, spawnSync } = require('node:child_process');
const { validateOptions, privateAddress, nativeScript, startWindowsHotspot } = require('../src/network/hotspot');

const options = { ssid: 'PS5 Test', password: 'Example123!' };
function harness(settings = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let writes = ''; let stopped = false; let command;
  child.stdin.on('data', data => { writes += data; });
  child.stdin.on('finish', () => { stopped = true; queueMicrotask(() => child.emit('exit', 0)); });
  child.kill = () => { stopped = true; child.emit('exit', 0); };
  const events = [];
  const pending = startWindowsHotspot(options, { platform: 'win32',
    spawnProcess: (...args) => { command = args; return child; }, onEvent: event => events.push(event), ...settings });
  return { pending, events, send: message => child.stdout.write(JSON.stringify(message) + '\n'),
    get command() { return command; }, get writes() { return writes; }, get stopped() { return stopped; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('complete peer snapshots track multiple devices and removal independently', async () => {
  const h = harness(); h.send({ type: 'started', isolated: true }); const session = await h.pending;
  h.send({ type: 'address', address: '192.168.137.1' });
  h.send({ type: 'peers', address: session.address, peers: ['192.168.137.2', '192.168.137.3'] });
  h.send({ type: 'peers', address: session.address, peers: ['192.168.137.3'] });
  h.send({ type: 'peers', address: session.address, peers: [] });
  assert.deepEqual(h.events.filter(e => e.type === 'hotspotPeers').map(e => e.peers),
    [['192.168.137.2', '192.168.137.3'], ['192.168.137.3'], []]);
  await session.stop();
});

test('hotspot inputs are bounded and passwords do not enter command arguments', async () => {
  for (const value of [null, {}, { ...options, ssid: '中文' }, { ...options, ssid: 'x'.repeat(33) },
    { ...options, password: 'short' }, { ...options, password: 'space pass' }, { ...options, password: 'line\nbreak' }]) {
    assert.throws(() => validateOptions(value), cause => cause.i18nKey === 'hotspot.invalid' && !cause.detail);
  }
  await assert.rejects(startWindowsHotspot(options, { platform: 'darwin', spawnProcess: () => assert.fail('spawned on macOS') }),
    cause => cause.i18nKey === 'hotspot.unsupported');
  const h = harness(); h.send({ type: 'started', isolated: true }); const session = await h.pending;
  assert.ok(!JSON.stringify(h.command).includes(options.password));
  assert.deepEqual(JSON.parse(h.writes.trim()), { ...options, executable: process.execPath, dnsPort: 53, httpsPort: 443, httpPort: 8000 });
  assert.deepEqual(session.result, { ssid: options.ssid });
  assert.equal(session.address, ''); // Broadcasting does not invent a service address.
  h.send({ type: 'address', address: '192.168.137.1' });
  h.send({ type: 'peer', address: '192.168.137.1', peer: '192.168.137.8' });
  assert.equal(session.address, '192.168.137.1');
  assert.deepEqual(h.events[1], { type: 'hotspotPeer', address: '192.168.137.1', peer: '192.168.137.8' });
  await session.stop(); assert.ok(h.stopped);
  assert.ok(!JSON.stringify(h.events).includes(options.password));
});

test('sharing conflicts during startup release the publisher before returning an error', async () => {
  const h = harness(); h.send({ type: 'error', key: 'sharingActive' });
  await assert.rejects(h.pending, cause => cause.i18nKey === 'hotspot.sharingActive');
  assert.ok(h.stopped); assert.deepEqual(h.events, []);
});

test('broadcasting without confirmed isolation is rejected and cleaned up', async () => {
  for (const isolated of [undefined, false, 'true']) {
    const h = harness(); h.send({ type: 'started', isolated });
    await assert.rejects(h.pending, cause => cause.i18nKey === 'hotspot.isolationFailed');
    assert.ok(h.stopped); assert.deepEqual(h.events, []);
  }
});

test('renderer options cannot expand allowed ports or choose a proxy executable', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = ''; child.stdin.on('data', data => { input += data; });
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('exit', 0)));
  const pending = startWindowsHotspot({ ...options, executable: 'proxy.exe', dnsPort: 7890 },
    { platform: 'win32', servicePorts: { dns: 5354, https: 8443, http: 18000 }, spawnProcess: () => child });
  child.stdout.write(JSON.stringify({ type: 'started', isolated: true }) + '\n');
  const session = await pending;
  assert.deepEqual(JSON.parse(input), { ...options, executable: process.execPath,
    dnsPort: 5354, httpsPort: 8443, httpPort: 18000 });
  await session.stop();
  await assert.rejects(startWindowsHotspot(options, { platform: 'win32',
    servicePorts: { dns: 53, https: 443, http: 65536 }, spawnProcess: () => assert.fail('spawned invalid policy') }),
  cause => cause.i18nKey === 'hotspot.invalid');
});

test('loss of filtering policy during operation shuts down the hotspot', async () => {
  const h = harness(); h.send({ type: 'started', isolated: true }); await h.pending;
  h.send({ type: 'error', key: 'isolationFailed' }); await tick();
  assert.ok(h.stopped);
  assert.deepEqual(h.events, [{ type: 'hotspotFailed', key: 'hotspot.isolationFailed' }]);
});

test('runtime sharing conflicts stop the owned hotspot and report failure', async () => {
  const h = harness(); h.send({ type: 'started', isolated: true }); await h.pending;
  h.send({ type: 'error', key: 'sharingActive' }); await tick();
  assert.ok(h.stopped);
  assert.deepEqual(h.events, [{ type: 'hotspotFailed', key: 'hotspot.sharingActive' }]);
});

test('untrusted or ambiguous addresses are never emitted to the app', async () => {
  for (const address of ['8.8.8.8', '127.0.0.1', '169.254.1.1', '192.168.999.1', '192.168.01.1', '::1']) {
    assert.equal(privateAddress(address), false);
    const h = harness(); h.send({ type: 'started', isolated: true }); await h.pending;
    h.send({ type: 'address', address }); await tick();
    assert.ok(h.stopped); assert.deepEqual(h.events, [{ type: 'hotspotFailed', key: 'hotspot.addressAmbiguous' }]);
  }
});

test('health watchdog stops a helper that no longer checks network isolation', async () => {
  const h = harness({ healthMs: 20 }); h.send({ type: 'started', isolated: true }); await h.pending;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(h.stopped);
  assert.deepEqual(h.events, [{ type: 'hotspotFailed', key: 'hotspot.healthLost' }]);
});

test('startup timeout and malformed native output clean up without echoing diagnostics', async () => {
  const h = harness({ startupMs: 20 });
  await assert.rejects(h.pending, cause => cause.i18nKey === 'hotspot.radioUnavailable');
  assert.ok(h.stopped);
  const bad = harness(); bad.send({ type: 'error', key: options.password });
  await assert.rejects(bad.pending, cause => cause.i18nKey === 'hotspot.nativeError' && !cause.message.includes(options.password));
  assert.ok(bad.stopped);
});

test('Windows built-in compiler accepts the native helper without an installed SDK', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(nativeScript({ compileOnly: true }), 'utf16le').toString('base64')],
  { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout.trim()).type, 'compiled');
});

test('native stop input remains responsive without blocking status reporting', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const script = Buffer.from(nativeScript({ inputProbe: true }), 'utf16le').toString('base64');
  assert.ok(script.length < 30000);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', script],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let output = '';
  let timeout;
  try {
    const watching = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Status blocked waiting for stdin')), 10000);
      child.on('error', reject);
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('inputWatching')) resolve();
      });
    });
    await watching; clearTimeout(timeout);
    const exit = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end('\n');
    assert.equal(await exit, 0);
    assert.ok(output.includes('inputStopped'));
  } finally { clearTimeout(timeout); child.kill(); }
});
