'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { component } = require('../src/components/catalog');
const payload = require('../src/ps5/payload-manager-client');

const target = { address: '192.168.100.2' };
const validConfig = { AUTOLOAD_ENABLED: false, AUTOLOAD_LIST: '', AUTO_BROWSER_OPEN: true };

function fetchRoutes(routes) {
  return async url => {
    const route = new URL(url).pathname;
    const value = routes[route];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: 200 });
  };
}

test('pinned component metadata includes pinned Kstuff test5 and official Payload Manager assets', () => {
  assert.equal(component('kstuffLite').sha256, '829b45fe871dd64fbd53874ae4558076c2f1e1f203fe1ab52db5510d5fc45923');
  assert.equal(component('payloadManager').size, 2410776);
  assert.equal(component('payloadManager').sha256, '62b3ba2a4937c2afc502f9a4e7242cca538610ebb4ae2800c7c6f72e7f268e7c');
  assert.equal(component('autoloader').verification, 'sent');
  assert.equal(component('kstuffLite').verification, 'sent');
  assert.equal(component('pkgManager').verification, 'pkgManager');
  assert.equal(component('payloadManager').verification, 'payloadManager');
});

test('identification requires the pinned version and recognizable config', async () => {
  const options = { fetchImpl: fetchRoutes({ '/version': '0.5.2', '/get_config': validConfig }) };
  assert.deepEqual(await payload.identify(target, undefined, options), { version: '0.5.2' });
  await assert.rejects(payload.identify(target, undefined, {
    fetchImpl: fetchRoutes({ '/version': '0.5.3', '/get_config': validConfig }),
  }), cause => cause.code === 'UNVERIFIED_PAYLOAD_MANAGER_VERSION');
  await assert.rejects(payload.identify(target, undefined, {
    fetchImpl: fetchRoutes({ '/version': '0.5.2', '/get_config': { ...validConfig, AUTOLOAD_ENABLED: 'false' } }),
  }), cause => cause.code === 'BAD_PAYLOAD_MANAGER_RESPONSE');
  await assert.rejects(payload.identify(target, undefined, {
    fetchImpl: fetchRoutes({ '/version': '0.5.2', '/get_config': 'not json' }),
  }), cause => cause.code === 'BAD_PAYLOAD_MANAGER_RESPONSE');
});

test('identification rejects oversized replies and redirects', async () => {
  await assert.rejects(payload.identify(target, undefined, {
    fetchImpl: async () => new Response('x'.repeat(17000)),
  }), cause => cause.code === 'BAD_PAYLOAD_MANAGER_RESPONSE');
  let redirectMode;
  await payload.identify(target, undefined, {
    fetchImpl: async (_url, options) => {
      redirectMode = options.redirect;
      return new Response('0.5.2', { status: 302 });
    },
  }).catch(() => {});
  assert.equal(redirectMode, 'error');
});

test('already running service skips ELF and unknown service blocks sending', async () => {
  let sends = 0;
  const sendImpl = async () => { sends++; };
  assert.deepEqual(await payload.load('payload.elf', target, {
    identifyImpl: async () => ({ version: '0.5.2' }), sendImpl,
  }), { status: 'alreadyRunning' });
  assert.equal(sends, 0);
  await assert.rejects(payload.load('payload.elf', target, {
    identifyImpl: async () => { throw Object.assign(new Error('unknown'), { code: 'BAD_PAYLOAD_MANAGER_RESPONSE' }); }, sendImpl,
  }), cause => cause.code === 'BAD_PAYLOAD_MANAGER_RESPONSE');
  assert.equal(sends, 0);
});

test('unreachable service sends once and waits for confirmation', async () => {
  let sends = 0;
  const phases = [];
  const runtime = [];
  const result = await payload.load('payload.elf', target, {
    identifyImpl: async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); },
    sendImpl: async () => { sends++; }, waitImpl: async () => ({ version: '0.5.2' }),
    onPhase: phase => phases.push(phase), onRuntime: phase => runtime.push(phase),
  });
  assert.deepEqual(result, { status: 'confirmed' });
  assert.equal(sends, 1);
  assert.deepEqual(phases, ['sending', 'verifying']);
  assert.deepEqual(runtime, ['unreachable', 'running']);
});

test('startup timeout stays unconfirmed; cancellation stops polling', async () => {
  await assert.rejects(payload.waitForReady(target, undefined, {
    duration: 5, interval: 1,
    identifyImpl: async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); },
  }), cause => cause.code === 'RESULT_UNCONFIRMED');
  const controller = new AbortController();
  const pending = payload.waitForReady(target, controller.signal, {
    duration: 30000, interval: 1000,
    identifyImpl: async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); },
  });
  controller.abort();
  await assert.rejects(pending, cause => cause.code === 'TASK_CANCELED');
});
