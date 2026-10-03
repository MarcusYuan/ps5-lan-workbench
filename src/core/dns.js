const dgram = require('node:dgram');
const net = require('node:net');
const packet = require('dns-packet');

function answerDns(message, domain, address, onEvent = () => {}) {
  let query;
  try { query = packet.decode(message); } catch { return null; }
  if (query.type !== 'query' || !query.questions?.length) return null;
  const target = domain.toLowerCase().replace(/\.$/, '');
  const questions = query.questions;
  const matches = q => q.name.toLowerCase().replace(/\.$/, '') === target;
  for (const q of questions) onEvent({ type: 'dnsQuery', name: q.name, queryType: q.type, matched: matches(q) });
  // A single exact IN question is supported. Never partially answer a mixed request.
  const question = questions[0];
  let flags;
  let answers = [];
  if (query.flags & 0x7800) flags = 0x8004; // NOTIMP: no update/other DNS operations.
  else if (questions.length !== 1) flags = 0x8001; // FORMERR
  else if (!matches(question)) flags = 0x8403; // NXDOMAIN, including subdomains.
  else if (question.class !== 'IN' || !['A', 'AAAA'].includes(question.type)) flags = 0x8005; // REFUSED
  else {
    flags = 0x8400;
    if (question.type === 'A') answers = [{ type: 'A', name: question.name, ttl: 60, data: address }];
    // Empty AAAA keeps clients on the local IPv4 service; no external fallback here.
  }
  // Echo recursion desired, but never advertise recursion available or forward queries.
  return packet.encode({ type: 'response', id: query.id, flags: flags | (query.flags & 0x0100), questions, answers });
}

async function startDns({ address, domain, port = 53, onEvent = () => {} }) {
  const udp = dgram.createSocket('udp4');
  const sockets = new Set();
  udp.on('message', (message, remote) => {
    const response = answerDns(message, domain, address, onEvent);
    if (response) udp.send(response, remote.port, remote.address);
  });
  await new Promise((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(port, address, () => { udp.off('error', reject); resolve(); });
  });
  const actualPort = udp.address().port;
  const tcp = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const size = buffer.readUInt16BE(0);
        if (size > 4096) { socket.destroy(); return; }
        if (buffer.length < size + 2) return;
        const response = answerDns(buffer.subarray(2, size + 2), domain, address, onEvent);
        buffer = buffer.subarray(size + 2);
        if (response) { const header = Buffer.alloc(2); header.writeUInt16BE(response.length); socket.write(Buffer.concat([header, response])); }
      }
    });
  });
  try {
    await new Promise((resolve, reject) => {
      tcp.once('error', reject);
      tcp.listen(actualPort, address, () => { tcp.off('error', reject); resolve(); });
    });
  } catch (error) {
    udp.close();
    throw error;
  }
  return {
    port: actualPort,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise(resolve => udp.close(resolve)),
        new Promise(resolve => tcp.close(resolve)),
      ]);
    },
  };
}

module.exports = { answerDns, startDns };
