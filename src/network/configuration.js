'use strict';

const fs = require('node:fs/promises');
const { isIPv4 } = require('node:net');
const { createError } = require('../i18n');

const fail = (key, detail) => createError('NETWORK_CONFIG', `network.${key}`, {}, detail);
const sort = values => [...values].sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const usable = a => !a.address.startsWith('169.254.');
const number = ip => ip.split('.').reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
function overlaps(address, other, prefix) {
  if (!isIPv4(other) || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) return false;
  const bits = Math.min(24, prefix);
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (number(address) & mask) === (number(other) & mask);
}

function validateOptions(value) {
  if (!value || !['single', 'dual'].includes(value.mode) || typeof value.adapterId !== 'string' ||
      value.adapterId.length > 100 || !isIPv4(value.address || '')) throw fail('invalid');
  const octets = value.address.split('.').map(Number);
  if (octets[3] !== 1 || !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))) throw fail('invalid');
  return { mode: value.mode, adapterId: value.adapterId, address: value.address };
}

function protection(snapshot, adapter) {
  return { dhcp: adapter.dhcp, addresses: sort(adapter.addresses.filter(usable).map(a => `${a.address}/${a.prefix}`)),
    dns: sort(adapter.dns), gateways: sort(adapter.gateways), defaults: sort(snapshot.defaults), dnsState: snapshot.dnsState };
}

function preserved(before, snapshot, adapter, address) {
  const now = protection(snapshot, { ...adapter, addresses: adapter.addresses.filter(a => a.address !== address) });
  return equal(before, now);
}

function prepare(snapshot, value) {
  const options = validateOptions(value);
  const adapter = snapshot.adapters.find(a => a.id === options.adapterId);
  if (!adapter?.hardware || !adapter.connected) throw fail('adapterUnavailable');
  if (options.mode === 'single' && (!adapter.addresses.some(usable) || !adapter.gateways.length)) throw fail('singleNeedsInternet');
  if (options.mode === 'dual' && adapter.gateways.length) throw fail('dualHasGateway');
  for (const other of snapshot.adapters) {
    if (other.id !== adapter.id && other.addresses.some(a => overlaps(options.address, a.address, a.prefix))) throw fail('conflict');
  }
  for (const route of snapshot.routes || []) {
    if (route.adapterId !== adapter.id && route.prefix >= 8 && overlaps(options.address, route.address, route.prefix)) throw fail('conflict');
  }
  const existing = adapter.addresses.find(a => a.address === options.address);
  if (existing) {
    if (existing.prefix !== 24 || existing.state === 'Duplicate') throw fail('conflict');
    return { ...options, existing: true };
  }
  if (snapshot.platform === 'win32' && adapter.dhcp && typeof adapter.coexistence !== 'boolean') throw fail('unsupportedCoexistence');
  return { ...options, version: 1, bootId: snapshot.bootId, before: protection(snapshot, adapter),
    coexistence: adapter.coexistence, phase: 'pending' };
}

function validateRecord(record) {
  validateOptions(record);
  if (record.version !== 1 || typeof record.bootId !== 'string' || !record.before ||
      typeof record.before.dhcp !== 'boolean' || !['addresses', 'dns', 'gateways', 'defaults'].every(k =>
        Array.isArray(record.before[k]) && record.before[k].every(v => typeof v === 'string')) ||
      ![true, false, null].includes(record.coexistence)) throw fail('recordInvalid');
  return record;
}

// Runs inside the authorized helper. Inputs are rechecked against the live adapter before any command.
async function executeChange(request, driver) {
  if (!request || !['apply', 'clear'].includes(request.action)) throw fail('invalid');
  const record = validateRecord(request.record);
  let snapshot = await driver.read();
  if (snapshot.bootId !== record.bootId) {
    if (request.action === 'clear') return { status: 'expired' };
    throw fail('changed');
  }
  let adapter = snapshot.adapters.find(a => a.id === record.adapterId);
  if (!adapter?.hardware) throw fail('adapterUnavailable');
  const ownedAddress = () => adapter.addresses.find(a => a.address === record.address);
  const matches = address => address && address.prefix === 24 && address.origin === 'Manual' &&
    (snapshot.platform !== 'win32' || address.skipAsSource === (record.before.addresses.length > 0));
  const refresh = async () => {
    snapshot = await driver.read();
    adapter = snapshot.adapters.find(a => a.id === record.adapterId);
    if (!adapter || snapshot.bootId !== record.bootId) throw fail('changed');
  };
  const remove = async () => {
    await refresh();
    const address = ownedAddress();
    if (address && !matches(address)) throw fail('changed');
    if (address) await driver.remove(adapter, record.address);
    await refresh();
    if (ownedAddress()) throw fail('recovery');
    if (snapshot.platform === 'win32' && record.before.dhcp && record.coexistence === false && adapter.coexistence === true) {
      // Disabling coexistence must not remove a static address added by somebody else meanwhile.
      const added = adapter.addresses.filter(a => a.origin === 'Manual' && usable(a) &&
        !record.before.addresses.includes(`${a.address}/${a.prefix}`));
      if (added.length) throw fail('coexistenceRetained');
      await driver.coexist(adapter, false);
      await refresh();
      if (adapter.coexistence !== false) throw fail('recovery');
    }
  };
  if (request.action === 'clear') {
    const beforeClear = protection(snapshot, { ...adapter, addresses: adapter.addresses.filter(a => a.address !== record.address) });
    await remove();
    if (!preserved(beforeClear, snapshot, adapter, record.address)) throw fail('recovery');
    return { status: 'cleared' };
  }
  const fresh = prepare(snapshot, record);
  if (fresh.existing || !equal(fresh.before, record.before) || fresh.coexistence !== record.coexistence) throw fail('changed');
  let adding = false;
  try {
    if (snapshot.platform === 'win32' && adapter.dhcp && !adapter.coexistence) {
      await driver.coexist(adapter, true);
      await refresh();
      if (adapter.coexistence !== true || !preserved(record.before, snapshot, adapter, record.address)) throw fail('changed');
    }
    adding = true;
    await driver.add(adapter, record.address);
    for (let attempt = 0; attempt < 16; attempt++) {
      await refresh();
      const address = ownedAddress();
      if (address?.state === 'Duplicate') throw fail('conflict');
      if (matches(address) && address.state === 'Preferred') break;
      if (attempt === 15) throw fail('verifyFailed');
      await driver.wait(500);
    }
    if (!preserved(record.before, snapshot, adapter, record.address)) throw fail('changed');
    return { status: 'configured' };
  } catch (cause) {
    try {
      if (adding || (record.before.dhcp && record.coexistence === false)) await remove();
      if (!preserved(record.before, snapshot, adapter, record.address)) throw fail('recovery');
    } catch (recovery) {
      throw fail('recovery', `${cause.message}; ${recovery.message}`);
    }
    throw cause;
  }
}

function createConfigurator({ file, read, mutate }) {
  let busy = false;
  async function load() {
    try { return validateRecord(JSON.parse(await fs.readFile(file, 'utf8'))); }
    catch (cause) { if (cause.code === 'ENOENT') return null; throw fail('recordInvalid', cause.message); }
  }
  async function save(record) {
    if (!record) { await fs.unlink(file).catch(cause => { if (cause.code !== 'ENOENT') throw cause; }); return; }
    await fs.writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
  return {
    async inspect() { const snapshot = await read(); return { ...snapshot, managed: await load() }; },
    async change(action, options) {
      if (busy) throw fail('busy');
      busy = true;
      try {
        const snapshot = await read();
        let record = await load();
        if (action === 'clear') {
          if (!record) throw fail('nothingToClear');
          const result = snapshot.bootId === record.bootId ? await mutate({ action, record }) : { status: 'expired' };
          await save(null);
          return result;
        }
        if (action !== 'apply') throw fail('invalid');
        validateOptions(options);
        if (record && record.bootId !== snapshot.bootId) { await save(null); record = null; }
        if (record) throw fail('clearFirst');
        const planned = prepare(snapshot, options);
        if (planned.existing) return { status: 'existing', address: planned.address };
        // Journal before invoking the helper, so a lost reply or app crash still leaves a cleanup record.
        await save(planned);
        const result = await mutate({ action, record: planned });
        await save({ ...planned, phase: 'configured' });
        return { ...result, address: planned.address };
      } finally { busy = false; }
    },
  };
}

module.exports = { validateOptions, validateRecord, protection, prepare, executeChange, createConfigurator, overlaps };
