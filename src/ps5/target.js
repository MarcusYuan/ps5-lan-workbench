'use strict';

const net = require('node:net');

const DEFAULT_TARGET = Object.freeze({ address: '', elfPort: 9021, managerPort: 8844 });

function validIpv4(address) {
  return typeof address === 'string' && net.isIP(address) === 4 &&
    address.split('.').every(part => String(Number(part)) === part);
}

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function normalizeTarget(value, { allowEmpty = false } = {}) {
  const address = String(value?.address ?? '').trim();
  const elfPort = Number(value?.elfPort ?? DEFAULT_TARGET.elfPort);
  const managerPort = Number(value?.managerPort ?? DEFAULT_TARGET.managerPort);
  if ((!allowEmpty || address) && !validIpv4(address)) throw Object.assign(new Error('Invalid PS5 IPv4 address'), { code: 'INVALID_PS5_IP' });
  if (!validPort(elfPort) || !validPort(managerPort)) throw Object.assign(new Error('Invalid PS5 port'), { code: 'INVALID_PS5_PORT' });
  return { address, elfPort, managerPort };
}

module.exports = { DEFAULT_TARGET, validIpv4, validPort, normalizeTarget };
