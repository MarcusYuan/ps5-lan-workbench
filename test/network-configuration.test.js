'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepare, executeChange, createConfigurator, validateOptions } = require('../src/network/configuration');
const { createSystemDriver, parseCoexistence, parseMacInterfaces } = require('../src/network/system');

const options = { mode: 'single', adapterId: 'wifi', address: '192.168.100.1' };
function snapshot() {
  return { platform: 'win32', bootId: 'boot-1', defaults: ['1:192.168.1.1:0'], dnsState: '', routes: [], adapters: [
    { id: 'wifi', index: 1, hardware: true, connected: true, name: 'Wi-Fi', dhcp: true, coexistence: false,
      addresses: [{ address: '192.168.1.50', prefix: 24, origin: 'Dhcp', state: 'Preferred', skipAsSource: false }],
      gateways: ['192.168.1.1'], dns: ['192.168.1.1'] },
    { id: 'cable', index: 2, hardware: true, connected: true, name: 'Ethernet', dhcp: false, coexistence: false,
      addresses: [], gateways: [], dns: [] },
  ] };
}
function mock(state = snapshot(), hooks = {}) {
  const calls = [];
  const adapter = a => state.adapters.find(item => item.id === a.id);
  const driver = {
    read: async () => structuredClone(state), wait: async () => {},
    coexist: async (a, enabled) => { calls.push(['coexist', a.id, enabled]); adapter(a).coexistence = enabled; },
    add: async (a, address) => {
      calls.push(['add', a.id, address]);
      const skipAsSource = adapter(a).addresses.some(ip => !ip.address.startsWith('169.254.'));
      adapter(a).addresses.push({ address, prefix: 24, origin: 'Manual', state: 'Preferred', skipAsSource });
      hooks.afterAdd?.(state, adapter(a));
    },
    remove: async (a, address) => { calls.push(['remove', a.id, address]); adapter(a).addresses = adapter(a).addresses.filter(ip => ip.address !== address); },
  };
  return { state, calls, driver };
}

test('single-adapter apply and cleanup preserve DHCP, original addresses, DNS and gateways', async () => {
  const f = mock(); const original = structuredClone(f.state); const record = prepare(f.state, options);
  assert.equal((await executeChange({ action: 'apply', record }, f.driver)).status, 'configured');
  assert.equal(f.state.adapters[0].addresses.length, 2);
  assert.equal(f.state.adapters[0].dhcp, true);
  assert.equal((await executeChange({ action: 'clear', record }, f.driver)).status, 'cleared');
  assert.deepEqual(f.state, original);
  assert.deepEqual(f.calls.map(call => call[0]), ['coexist', 'add', 'remove', 'coexist']);
});

test('dual-adapter configuration changes only the selected direct-connect adapter', async () => {
  const f = mock(); const original = structuredClone(f.state);
  const record = prepare(f.state, { ...options, mode: 'dual', adapterId: 'cable' });
  await executeChange({ action: 'apply', record }, f.driver);
  assert.deepEqual(f.state.adapters[0], original.adapters[0]);
  assert.equal(f.state.adapters[1].addresses[0].skipAsSource, false);
  await executeChange({ action: 'clear', record }, f.driver);
  assert.deepEqual(f.state, original);
  assert.ok(f.calls.every(call => call[1] === 'cable'));
});

test('validation rejects internet adapter in direct mode, disconnected or virtual adapters and malformed requests', () => {
  assert.throws(() => prepare(snapshot(), { ...options, mode: 'dual' }), e => e.i18nKey === 'network.dualHasGateway');
  for (const mutation of [a => a.connected = false, a => a.hardware = false]) {
    const state = snapshot(); mutation(state.adapters[0]); assert.throws(() => prepare(state, options));
  }
  for (const address of ['8.8.8.1', '127.0.0.1', '192.168.100.2', '192.168.100.1;whoami', '192.168.999.1'])
    assert.throws(() => validateOptions({ ...options, address }));
  assert.throws(() => validateOptions({ ...options, mode: 'reset' }));
  const state = snapshot(); state.adapters[0].coexistence = null;
  assert.throws(() => prepare(state, options), e => e.i18nKey === 'network.unsupportedCoexistence');
});

test('existing addresses are borrowed without ownership; overlapping adapters and routes block changes', () => {
  const state = snapshot();
  state.adapters[0].addresses.push({ address: options.address, prefix: 24 });
  assert.equal(prepare(state, options).existing, true);
  state.adapters[1].addresses.push({ address: '192.168.100.90', prefix: 24 });
  assert.throws(() => prepare(state, options), e => e.i18nKey === 'network.conflict');
  const routed = snapshot(); routed.routes.push({ adapterId: 'vpn', address: '192.168.0.0', prefix: 16 });
  assert.throws(() => prepare(routed, options), e => e.i18nKey === 'network.conflict');
});

test('a changed adapter or address appearing while authorization is pending prevents mutation', async () => {
  for (const change of [a => a.dns.push('1.1.1.1'), a => a.addresses.push({ address: options.address, prefix: 24 })]) {
    const f = mock(); const record = prepare(f.state, options); change(f.state.adapters[0]);
    await assert.rejects(executeChange({ action: 'apply', record }, f.driver), e => e.i18nKey === 'network.changed');
    assert.deepEqual(f.calls, []);
  }
});

test('duplicate address detection and failed add commands roll back the alias and coexistence setting', async () => {
  for (const afterAdd of [(_s, a) => a.addresses.at(-1).state = 'Duplicate', () => { throw new Error('command failed after adding'); }]) {
    const f = mock(snapshot(), { afterAdd }); const original = structuredClone(f.state); const record = prepare(f.state, options);
    await assert.rejects(executeChange({ action: 'apply', record }, f.driver));
    assert.deepEqual(f.state, original);
  }
});

test('unexpected internet configuration changes are reported even after address rollback', async () => {
  const f = mock(snapshot(), { afterAdd: (_s, a) => { a.dhcp = false; } });
  await assert.rejects(executeChange({ action: 'apply', record: prepare(f.state, options) }, f.driver), e => e.i18nKey === 'network.recovery');
  assert.ok(!f.state.adapters[0].addresses.some(a => a.address === options.address));
});

test('cleanup preserves somebody else’s new static address and does not disable coexistence', async () => {
  const f = mock(); const record = prepare(f.state, options); await executeChange({ action: 'apply', record }, f.driver);
  f.state.adapters[0].addresses.push({ address: '192.168.101.10', prefix: 24, origin: 'Manual' });
  await assert.rejects(executeChange({ action: 'clear', record }, f.driver), e => e.i18nKey === 'network.coexistenceRetained');
  assert.equal(f.state.adapters[0].coexistence, true);
  assert.ok(f.state.adapters[0].addresses.some(a => a.address === '192.168.101.10'));
  assert.ok(!f.state.adapters[0].addresses.some(a => a.address === options.address));
});

test('cleanup refuses a reassigned address and ignores an expired boot record', async () => {
  const f = mock(); const record = prepare(f.state, options); await executeChange({ action: 'apply', record }, f.driver);
  f.state.adapters[0].addresses.at(-1).origin = 'Dhcp';
  const calls = f.calls.length;
  await assert.rejects(executeChange({ action: 'clear', record }, f.driver), e => e.i18nKey === 'network.changed');
  assert.equal(f.calls.length, calls);
  f.state.bootId = 'boot-2';
  assert.equal((await executeChange({ action: 'clear', record }, f.driver)).status, 'expired');
  assert.equal(f.calls.length, calls);
});

test('macOS alias configuration does not modify DHCP or use Windows commands', async () => {
  const state = snapshot(); state.platform = 'darwin'; state.adapters[0].coexistence = null;
  const f = mock(state); const original = structuredClone(state); const record = prepare(state, options);
  await executeChange({ action: 'apply', record }, f.driver);
  await executeChange({ action: 'clear', record }, f.driver);
  assert.deepEqual(state, original); assert.deepEqual(f.calls.map(c => c[0]), ['add', 'remove']);
});

test('the durable journal permits cleanup after an unconfirmed helper result and app restart', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-network-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'network-config.json'); const f = mock();
  const first = createConfigurator({ file, read: f.driver.read, mutate: async request => {
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).phase, 'pending');
    await executeChange(request, f.driver); throw new Error('reply lost');
  } });
  await assert.rejects(first.change('apply', options));
  const next = createConfigurator({ file, read: f.driver.read, mutate: request => executeChange(request, f.driver) });
  assert.equal((await next.inspect()).managed.phase, 'pending');
  await assert.rejects(next.change('apply', options), e => e.i18nKey === 'network.clearFirst');
  await next.change('clear'); assert.equal((await next.inspect()).managed, null);
  assert.deepEqual(f.state, snapshot());
});

test('borrowed addresses and expired records never authorize removal', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-network-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const f = mock(); const file = path.join(dir, 'network-config.json');
  const app = createConfigurator({ file, read: f.driver.read, mutate: request => executeChange(request, f.driver) });
  f.state.adapters[0].addresses.push({ address: options.address, prefix: 24 });
  assert.equal((await app.change('apply', options)).status, 'existing');
  await assert.rejects(app.change('clear'), e => e.i18nKey === 'network.nothingToClear');
  assert.deepEqual(f.calls, []);
  f.state.adapters[0].addresses.pop(); const record = prepare(f.state, options);
  await fs.writeFile(file, JSON.stringify(record)); f.state.bootId = 'boot-2';
  await app.change('clear'); assert.deepEqual(f.calls, []);
});

test('platform adapters emit only scoped alias commands without gateway/DNS/reset operations', async () => {
  const calls = []; const exec = async (file, args) => { calls.push([file, ...args]); return { stdout: '' }; };
  const windows = createSystemDriver({ platform: 'win32', exec });
  const adapter = { index: 12, id: '{63EF90AA-9DFB-436E-91D4-6F5727BFC41A}', addresses: [{ address: '192.168.1.50' }] };
  await windows.coexist(adapter, true); await windows.add(adapter, options.address); await windows.remove(adapter, options.address);
  assert.ok(calls[1].includes('skipassource=true')); assert.ok(calls.every(c => c.includes('store=active')));
  assert.ok(!calls.flat().some(value => /gateway=|dns|reset|source=static/i.test(value)));
  await windows.add({ ...adapter, addresses: [{ address: '169.254.1.50' }] }, options.address);
  assert.ok(calls.at(-1).includes('skipassource=false'));
  const mac = createSystemDriver({ platform: 'darwin', exec });
  await mac.add({ device: 'en0' }, options.address); await mac.remove({ device: 'en0' }, options.address);
  assert.deepEqual(calls.at(-1), ['/sbin/ifconfig', 'en0', 'inet', options.address, '-alias']);
  await assert.rejects(mac.add({ device: 'en0;whoami' }, options.address));
});

test('adapter parsing preserves physical identity and fails closed on unknown coexistence output', () => {
  assert.equal(parseCoexistence('IfIndex : 12\nDHCP/Static IP coexistence : enabled').get(12), true);
  assert.equal(parseCoexistence('IfIndex : 12\nUnknown : enabled').get(12), undefined);
  const result = parseMacInterfaces('en0: flags=8863\n\tether aa:bb:cc:dd:ee:ff\n\tinet 192.168.1.2 netmask 0xffffff00 broadcast 192.168.1.255\n\tstatus: active',
    'Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa:bb:cc:dd:ee:ff');
  assert.equal(result[0].hardware, true); assert.equal(result[0].addresses[0].prefix, 24);
});
