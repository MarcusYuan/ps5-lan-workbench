const dgram = require('node:dgram');
const net = require('node:net');
const packet = require('dns-packet');

function answerDns(message, domain, address, onEvent = () => {}) {
  let query;
  try { query = packet.decode(message); } catch { return null; }
  if (query.type !== 'query' || !query.questions?.length) return null;
  const target = domain.toLowerCase().replace(/\.$/, '');
  const questions = query.questions;
  const matched = questions.some(q => q.name.toLowerCase().replace(/\.$/, '') === target);
  const answers = questions.filter(q => q.name.toLowerCase().replace(/\.$/, '') === target && q.type === 'A')
    .map(q => ({ type: 'A', name: q.name, ttl: 60, data: address }));
  for (const q of questions) onEvent({ type: 'dnsQuery', name: q.name, queryType: q.type, matched: q.name.toLowerCase().replace(/\.$/, '') === target });
  return packet.encode({ type: 'response', id: query.id, flags: matched ? 0x8400 : 0x8403, questions, answers });
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
