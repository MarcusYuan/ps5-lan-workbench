'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const net = require('node:net');
const packet = require('dns-packet');
const { answerDns, startDns } = require('../src/core/dns');
const domain = 'manuals.playstation.net';
const question = (name = domain, type = 'A', dnsClass = 'IN') => ({ name, type, class: dnsClass });
const encode = (questions, flags = 0x0100) => packet.encode({ type: 'query', id: 42, flags, questions });
const answer = (questions, flags) => packet.decode(answerDns(encode(questions, flags), domain, '192.168.137.1'));

test('DNS whitelist matches exactly, allowing case and the absolute-name trailing dot', () => {
  for (const name of [domain, 'MANUALS.PlayStation.NET', domain + '.']) {
    const response = answer([question(name)]);
    assert.equal(response.flags & 15, 0);
    assert.equal(response.answers.length, 1);
    assert.equal(response.answers[0].data, '192.168.137.1');
    assert.equal(response.flags & 0x80, 0); // No recursive resolver.
    assert.equal(response.flags & 0x100, 0x100);
  }
  for (const name of ['example.org', 'updates.playstation.net', 'x.' + domain, domain + '.example.org']) {
    for (const type of ['A', 'AAAA', 'ANY']) {
      const response = answer([question(name, type)]);
      assert.equal(response.flags & 15, 3);
      assert.deepEqual(response.answers, []);
    }
  }
});

test('AAAA returns no address; unsupported types/classes and mixed requests cannot bypass the whitelist', () => {
  assert.deepEqual(answer([question(domain, 'AAAA')]).answers, []);
  for (const q of [question(domain, 'ANY'), question(domain, 'TXT'), question(domain, 'A', 'CH'), question(domain, 'A', 'ANY')]) {
    const response = answer([q]);
    assert.equal(response.flags & 15, 5); assert.deepEqual(response.answers, []);
  }
  const mixed = answer([question(), question('example.org')]);
  assert.equal(mixed.flags & 15, 1); assert.deepEqual(mixed.answers, []);
  const update = answer([question()], 5 << 11);
  assert.equal(update.flags & 15, 4); assert.deepEqual(update.answers, []);
  assert.equal(answerDns(Buffer.from([0, 1]), domain, '192.168.137.1'), null);
});

test('UDP and TCP apply the same DNS whitelist', async () => {
  // Windows UDP ephemeral ports can fall in a TCP-excluded range. Ask TCP first.
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dns = await startDns({ address: '127.0.0.1', domain, port });
  const udp = async bytes => {
    const socket = dgram.createSocket('udp4'); let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('UDP timeout')), 1500);
        socket.once('error', reject); socket.once('message', data => resolve(packet.decode(data)));
        socket.send(bytes, dns.port, '127.0.0.1');
      });
    } finally { clearTimeout(timer); socket.close(); }
  };
  const tcp = bytes => new Promise((resolve, reject) => {
    const socket = net.connect(dns.port, '127.0.0.1'); let data = Buffer.alloc(0);
    socket.setTimeout(1500, () => socket.destroy(new Error('TCP timeout')));
    socket.once('error', reject);
    socket.once('connect', () => { const header = Buffer.alloc(2); header.writeUInt16BE(bytes.length); socket.write(Buffer.concat([header, bytes])); });
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 2 && data.length >= data.readUInt16BE(0) + 2) {
        resolve(packet.decode(data.subarray(2, data.readUInt16BE(0) + 2))); socket.destroy();
      }
    });
  });
  try {
    for (const send of [udp, tcp]) {
      assert.equal((await send(encode([question()]))).answers[0].data, '127.0.0.1');
      assert.equal((await send(encode([question('example.org')]))).flags & 15, 3);
      const mixed = await send(encode([question(), question('example.org')]));
      assert.equal(mixed.flags & 15, 1); assert.deepEqual(mixed.answers, []);
    }
  } finally { await dns.stop(); }
});
