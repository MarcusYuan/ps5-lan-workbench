'use strict';

const net = require('node:net');
const fs = require('node:fs');

function connect(address, port, signal, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    const fail = error => { socket.destroy(); reject(error); };
    const abort = () => fail(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
    socket.setTimeout(timeout, () => fail(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })));
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.removeListener('error', fail);
      socket.setTimeout(0);
      signal?.removeEventListener('abort', abort);
      resolve(socket);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function sendElf(file, target, { signal, onProgress = () => {} } = {}) {
  // A separate empty connection checks reachability without sending probe bytes.
  const probe = await connect(target.address, target.elfPort, signal);
  probe.end();
  const total = (await fs.promises.stat(file)).size;
  const socket = await connect(target.address, target.elfPort, signal);
  let sent = 0;
  const abort = () => socket.destroy(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024 })) {
      if (signal?.aborted) abort();
      if (!socket.write(chunk)) await new Promise((resolve, reject) => {
        socket.once('drain', resolve); socket.once('error', reject);
      });
      sent += chunk.length;
      onProgress(Math.round(sent / total * 100));
    }
    await new Promise((resolve, reject) => { socket.end(resolve); socket.once('error', reject); });
  } finally {
    signal?.removeEventListener('abort', abort);
    socket.destroy();
  }
}

module.exports = { connect, sendElf };
