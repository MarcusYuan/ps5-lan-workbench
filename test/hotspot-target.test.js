'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { networkMode, peerAddresses, targetReady } = require('../src/network/hotspot-target');

test('Windows defaults to hotspot and retains saved modes; macOS defaults to single adapter', () => {
  assert.equal(networkMode(undefined, 'win32'), 'hotspot');
  assert.equal(networkMode('dual', 'win32'), 'dual');
  assert.equal(networkMode('single', 'win32'), 'single');
  assert.equal(networkMode(undefined, 'darwin'), 'single');
  assert.equal(networkMode('hotspot', 'darwin'), 'single');
});

test('peer snapshots reject unbounded, invalid and local addresses', () => {
  const host = '192.168.137.1';
  assert.deepEqual(peerAddresses(['192.168.137.3', '192.168.137.2', '192.168.137.3'], host), ['192.168.137.2', '192.168.137.3']);
  for (const peers of [null, ['8.8.8.8'], [host], Array(9).fill('192.168.137.2')]) assert.equal(peerAddresses(peers, host), null);
});

test('saved IP alone never authorizes services: confirmation, connection and fresh data are required', () => {
  const ip = '192.168.137.2';
  const state = { active: true, address: '192.168.137.1', peers: [ip, '192.168.137.3'], peersUpdatedAt: 1000, confirmedTarget: ip };
  assert.equal(targetReady(state, ip, 2000), true);
  for (const patch of [{ active: false }, { address: '' }, { confirmedTarget: '' }, { peers: ['192.168.137.3'] }])
    assert.equal(targetReady({ ...state, ...patch }, ip, 2000), false);
  assert.equal(targetReady(state, '192.168.137.3', 2000), false);
  assert.equal(targetReady(state, ip, 9000), false);
});
