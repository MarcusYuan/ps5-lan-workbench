'use strict';

const fs = require('node:fs');
const net = require('node:net');
const { startServices } = require('../core/services');
const { serializeError } = require('../i18n');

async function runHelper(ticketPath) {
  const ticket = JSON.parse(fs.readFileSync(ticketPath, 'utf8'));
  if (!Number.isInteger(ticket.port) || !/^[a-f0-9]{64}$/.test(ticket.token)) throw new Error('Invalid service ticket');
  const socket = net.connect({ host: '127.0.0.1', port: ticket.port });
  let service;
  let closing = false;
  let buffer = '';
  const send = value => { if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n'); };
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    if (service) await service.stop().catch(() => {});
    socket.destroy();
    process.exit(0);
  };
  socket.on('connect', () => send({ type: 'hello', token: ticket.token }));
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 128 * 1024) { socket.destroy(); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let message;
      try { message = JSON.parse(line); } catch { socket.destroy(); return; }
      if (message.type === 'start' && !service) {
        const config = message.config;
        startServices({ ...config, onEvent: event => send({ type: 'event', event }) })
          .then(result => { service = result; send({ type: 'ready', ports: { dns: result.dnsPort, https: result.httpsPort, http: result.httpPort } }); })
          .catch(error => { send({ type: 'error', error: serializeError(error) }); socket.end(); });
      } else if (message.type === 'stop') {
        shutdown();
      }
    }
  });
  socket.on('close', shutdown);
  socket.on('error', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { runHelper };
