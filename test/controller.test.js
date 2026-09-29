'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const { createController } = require('../src/service/controller');
const { getCertificate } = require('../src/core/certificate');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('authenticated helper serves HTTPS and releases ports on stop', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-controller-test-'));
  const appPath = path.join(temp, 'node-helper.js');
  const helperPath = path.resolve(__dirname, '../src/service/helper.js');
  await fs.writeFile(appPath, `require(${JSON.stringify(helperPath)}).runHelper(process.argv[process.argv.indexOf('--service-helper') + 1]);`);
  const root = path.join(temp, 'content');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Local test</h1>');
  const dnsPort = await freePort();
  const httpsPort = await freePort();
  const httpPort = await freePort();
  const cert = getCertificate(path.join(temp, 'cert'), 'manuals.playstation.net');
  let controller;
  try {
    controller = await createController({ executable: process.execPath, appPath, packaged: false,
      config: { address: '127.0.0.1', domain: 'manuals.playstation.net', root, entryPath: 'index.html',
        certificate: { cert: cert.cert, key: cert.key }, dnsPort, httpsPort, httpPort } });
    assert.deepEqual(controller.ports, { dns: dnsPort, https: httpsPort, http: httpPort });
    const status = await new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', port: httpsPort, path: '/index.html', rejectUnauthorized: false }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(status, 200);
    await controller.stop();
    controller = null;
    const probe = net.createServer();
    try { await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(httpsPort, '127.0.0.1', resolve); }); }
    finally { await new Promise(resolve => probe.close(resolve)); }
  } finally {
    await controller?.stop();
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('helper startup error preserves its translation key through controller IPC', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-controller-i18n-'));
  const appPath = path.join(temp, 'node-helper.js');
  const helperPath = path.resolve(__dirname, '../src/service/helper.js');
  await fs.writeFile(appPath, `require(${JSON.stringify(helperPath)}).runHelper(process.argv[process.argv.indexOf('--service-helper') + 1]);`);
  try {
    await assert.rejects(
      createController({ executable: process.execPath, appPath, packaged: false,
        config: { address: 'not-an-ip', domain: 'manuals.playstation.net', root: temp, entryPath: 'index.html' } }),
      error => error.i18nKey === 'error.serviceIpv4' && error.detail === '请选择有效的 IPv4 网卡地址',
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
