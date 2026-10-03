'use strict';

const { peerAddresses } = require('./hotspot');

function networkMode(value, platform = process.platform) {
  return ['single', 'dual', ...(platform === 'win32' ? ['hotspot'] : [])].includes(value) ? value :
    platform === 'win32' ? 'hotspot' : 'single';
}

function targetReady(hotspot, target, now = Date.now()) {
  return Boolean(hotspot.active && hotspot.address && hotspot.confirmedTarget === target &&
    hotspot.peers?.includes(target) && now - hotspot.peersUpdatedAt < 8000);
}

module.exports = { networkMode, peerAddresses, targetReady };
