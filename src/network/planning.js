'use strict';

// The renderer previews the same checks that the privileged configuration path enforces again.
(function (root, factory) {
  const planning = factory();
  if (typeof module === 'object' && module.exports) module.exports = planning;
  else root.NetworkPlanning = planning;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const ipv4 = value => typeof value === 'string' && value === value.trim() &&
    /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value) &&
    value.split('.').every(n => Number(n) <= 255);
  const usable = a => !a.address.startsWith('169.254.');
  const number = ip => ip.split('.').reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
  const issue = (key, params = {}) => ({ key: `network.${key}`, params });

  function overlaps(address, other, prefix) {
    if (!ipv4(other) || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) return false;
    const bits = Math.min(24, prefix);
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (number(address) & mask) === (number(other) & mask);
  }

  function invalidOptions(value) {
    if (!value || !['single', 'dual'].includes(value.mode) || typeof value.adapterId !== 'string' ||
        value.adapterId.length > 100 || !ipv4(value.address)) return true;
    const octets = value.address.split('.').map(Number);
    return octets[3] !== 1 || !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  }

  function selectionIssue(snapshot, value) {
    if (invalidOptions(value)) return issue('invalid');
    const adapter = snapshot.adapters.find(a => a.id === value.adapterId);
    if (!adapter?.hardware || !adapter.connected) return issue('adapterUnavailable');
    if (value.mode === 'single' && (!adapter.addresses.some(usable) || !adapter.gateways.length)) return issue('singleNeedsInternet');
    if (value.mode === 'dual' && adapter.gateways.length) return issue('dualHasGateway');
    for (const other of snapshot.adapters) {
      const address = other.id !== adapter.id && other.addresses.find(a => overlaps(value.address, a.address, a.prefix));
      if (address) return issue('adapterConflict', { address: value.address, adapter: other.name,
        current: `${address.address}/${address.prefix}` });
    }
    for (const route of snapshot.routes || []) {
      if (route.adapterId !== adapter.id && route.prefix >= 8 && overlaps(value.address, route.address, route.prefix)) {
        return issue('routeConflict', { address: value.address, route: `${route.address}/${route.prefix}`,
          adapter: snapshot.adapters.find(a => a.id === route.adapterId)?.name || route.adapterId || '—' });
      }
    }
    const existing = adapter.addresses.find(a => a.address === value.address);
    if (existing) return existing.prefix !== 24 || existing.state === 'Duplicate' ? issue('conflict') : null;
    if (snapshot.platform === 'win32' && adapter.dhcp && typeof adapter.coexistence !== 'boolean') return issue('unsupportedCoexistence');
    return null;
  }

  // Suggestions only check this computer's addresses/routes. Duplicate detection still runs after adding.
  function suggestAddress(snapshot, value) {
    if (!['network.adapterConflict', 'network.routeConflict', 'network.conflict'].includes(selectionIssue(snapshot, value)?.key)) return null;
    for (const address of ['192.168.100.1', '172.31.253.1', '10.253.253.1', '172.30.253.1', '192.168.253.1']) {
      if (!snapshot.adapters.some(a => a.addresses.some(ip => ip.address === address)) &&
          !selectionIssue(snapshot, { ...value, address })) return address;
    }
    return null;
  }

  return { invalidOptions, overlaps, selectionIssue, suggestAddress };
});
