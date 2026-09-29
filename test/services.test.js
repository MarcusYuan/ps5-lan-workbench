'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const dgram = require('node:dgram');
const net = require('node:net');
const https = require('node:https');
const dnsPacket = require('dns-packet');
const { startServices } = require('../src/core/services');
const { getCertificate } = require('../src/core/certificate');

const DOMAIN = 'manuals.playstation.net';

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function udpQuery(port, name, type) {
  const socket = dgram.createSocket('udp4');
  try {
    const question = dnsPacket.encode({ type: 'query', id: 42, flags: 0x0100, questions: [{ type, name }] });
    const response = new Promise((resolve, reject) => {
      socket.once('message', bytes => resolve(dnsPacket.decode(bytes)));
      socket.once('error', reject);
      setTimeout(() => reject(new Error('DNS UDP timeout')), 1000);
    });
    socket.send(question, port, '127.0.0.1');
    return await response;
  } finally { socket.close(); }
}

async function tcpQuery(port, name, type) {
  const question = dnsPacket.encode({ type: 'query', id: 43, questions: [{ type, name }] });
  const request = Buffer.alloc(question.length + 2);
  request.writeUInt16BE(question.length);
  question.copy(request, 2);
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = Buffer.alloc(0);
    socket.on('connect', () => socket.write(request));
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length >= 2 && buffer.length >= buffer.readUInt16BE(0) + 2) {
        resolve(dnsPacket.decode(buffer.subarray(2, buffer.readUInt16BE(0) + 2)));
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

function getHttps(port, url, userAgent) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port, path: url, rejectUnauthorized: false,
      headers: { 'user-agent': userAgent || 'node-test' } }, response => {
      const certificate = response.socket.getPeerCertificate();
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, location: response.headers.location,
        type: response.headers['content-type'], body: Buffer.concat(chunks), certificate }));
    }).on('error', reject);
  });
}

test('DNS and HTTPS serve local content and release ports', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-host-test-'));
  const root = path.join(temp, 'content');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'export const ready = true;');
  await fs.writeFile(path.join(root, 'assets', 'worker.mjs'), 'self.postMessage("ready");');
  await fs.writeFile(path.join(root, 'assets', 'data.bin'), Buffer.from([0, 1, 2, 255]));
  const certDir = path.join(temp, 'cert');
  const dnsPort = await unusedPort();
  const httpsPort = await unusedPort();
  const httpPort = await unusedPort();
  const events = [];
  let service;
  try {
    service = await startServices({ address: '127.0.0.1', domain: DOMAIN, root, certDir,
      entryPath: 'index.html', dnsPort, httpsPort, httpPort, onEvent: event => events.push(event) });
    const a = await udpQuery(dnsPort, DOMAIN, 'A');
    assert.equal(a.answers[0].data, '127.0.0.1');
    const aaaa = await udpQuery(dnsPort, DOMAIN, 'AAAA');
    assert.equal(aaaa.answers.length, 0);
    assert.equal(aaaa.flags & 0x000f, 0);
    const other = await udpQuery(dnsPort, 'example.org', 'A');
    assert.equal(other.flags & 0x000f, 3);
    assert.equal((await tcpQuery(dnsPort, DOMAIN, 'A')).answers[0].data, '127.0.0.1');

    const guide = await getHttps(httpsPort, '/document/en/ps5/', 'PlayStation 5');
    assert.equal(guide.status, 302);
    assert.equal(guide.location, '/index.html');
    const home = await getHttps(httpsPort, '/index.html?x=1', 'PlayStation 5');
    assert.equal(home.status, 200);
    assert.match(home.body.toString(), /type="module"/);
    assert.match(home.certificate.subjectaltname, /DNS:manuals\.playstation\.net/);
    const module = await getHttps(httpsPort, '/assets/app.js');
    assert.equal(module.status, 200);
    assert.match(module.type, /javascript/);
    assert.match((await getHttps(httpsPort, '/assets/worker.mjs')).type, /javascript/);
    assert.deepEqual((await getHttps(httpsPort, '/assets/data.bin')).body, Buffer.from([0, 1, 2, 255]));
    assert.equal((await getHttps(httpsPort, '/missing.js')).status, 404);
    assert.equal((await getHttps(httpsPort, '/%2e%2e/secret')).status, 403);
    assert.ok(events.some(event => event.type === 'webRequest' && event.protocol === 'https'));
    const reused = getCertificate(certDir, DOMAIN);
    assert.equal(reused.reused, true);
    const changed = getCertificate(certDir, 'example.net');
    assert.equal(changed.reused, false);
    assert.match(new (require('node:crypto').X509Certificate)(changed.cert).subjectAltName, /DNS:example\.net/);
  } finally {
    if (service) await service.stop();
    await fs.rm(temp, { recursive: true, force: true });
  }
  const closed = dgram.createSocket('udp4');
  try { await new Promise((resolve, reject) => { closed.once('error', reject); closed.bind(dnsPort, '127.0.0.1', resolve); }); }
  finally { closed.close(); }
});

test('an occupied DNS port fails without replacing the existing listener', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-port-test-'));
  const root = path.join(temp, 'content');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'index.html'), 'hello');
  const port = await unusedPort();
  const blocker = dgram.createSocket('udp4');
  try {
    await new Promise(resolve => blocker.bind(port, '127.0.0.1', resolve));
    await assert.rejects(startServices({ address: '127.0.0.1', domain: DOMAIN, root,
      certDir: path.join(temp, 'cert'), entryPath: 'index.html', dnsPort: port,
      httpsPort: await unusedPort(), httpPort: await unusedPort() }), error => error.code === 'EADDRINUSE');
    assert.equal(blocker.address().port, port);
  } finally {
    blocker.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
