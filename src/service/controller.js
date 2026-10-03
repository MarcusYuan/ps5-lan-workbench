'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createError } = require('../i18n');

const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
const windowsArg = value => `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, match => match + match)}"`;

function helperArgs(appPath, ticketPath, packaged) {
  return packaged ? ['--service-helper', ticketPath] : [appPath, '--service-helper', ticketPath];
}

function launch(executable, args, elevated) {
  if (!elevated) return spawn(executable, args, { stdio: 'ignore', windowsHide: true });
  if (process.platform === 'darwin') {
    const command = [executable, ...args].map(shellQuote).join(' ');
    return spawn('/usr/bin/osascript', ['-e', `do shell script ${JSON.stringify(command)} with administrator privileges`], { stdio: 'ignore' });
  }
  if (process.platform === 'win32') {
    const expression = `Start-Process -FilePath ${psQuote(executable)} -ArgumentList ${psQuote(args.map(windowsArg).join(' '))} -Verb RunAs -Wait -WindowStyle Hidden`;
    return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(expression, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true });
  }
  throw new Error('Automatic system authorization is supported on macOS and Windows only.');
}

async function createController({ executable, appPath, packaged, config, elevated = false, onEvent = () => {}, timeoutMs = 30000,
  stopTimeoutMs = 3000, confirmStop = false }) {
  const token = crypto.randomBytes(32).toString('hex');
  const ticketDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ps5-local-host-'));
  const ticketPath = path.join(ticketDir, 'ticket.json');
  const server = net.createServer();
  let socket;
  let child;
  let settled = false;
  let closed = false;
  let exitNotified = false;
  let timer;
  const cleanupTicket = async () => { await fsp.rm(ticketDir, { recursive: true, force: true }).catch(() => {}); };
  const notifyExit = code => {
    if (!closed && !exitNotified) {
      exitNotified = true;
      try { onEvent({ type: 'serviceExited', code }); } finally { void close(); }
    }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (socket && !socket.destroyed) {
      socket.write(JSON.stringify({ type: 'stop' }) + '\n');
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, stopTimeoutMs);
        socket.once('close', () => { clearTimeout(timeout); resolve(); });
      });
      if (confirmStop && !socket.destroyed) {
        closed = false;
        throw createError('HOTSPOT', 'hotspot.stopFailed');
      }
      socket.destroy();
    }
    if (child && !child.killed && !elevated) child.kill('SIGTERM');
    if (server.listening) server.close();
    await cleanupTicket();
  };
  let rejectStart;
  const result = new Promise((resolve, reject) => {
    rejectStart = reject;
    const fail = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (confirmStop) void close().then(() => reject(error), reject);
      else { reject(error); void close().catch(() => {}); }
    };
    server.on('connection', peer => {
      if (socket) { peer.destroy(); return; }
      let authenticated = false;
      let buffer = '';
      peer.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 128 * 1024) { peer.destroy(); return; }
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          let message;
          try { message = JSON.parse(line); } catch { peer.destroy(); return; }
          if (message.type === 'hello') {
            if (authenticated || message.token !== token || socket) { peer.destroy(); return; }
            authenticated = true;
            socket = peer;
            peer.write(JSON.stringify({ type: 'start', config }) + '\n');
          } else if (!authenticated) {
            peer.destroy(); return;
          } else if (message.type === 'ready') {
            if (!settled) { settled = true; clearTimeout(timer); resolve({ stop: close, ports: message.ports, result: message.result, elevated }); }
          } else if (message.type === 'error') {
            const details = message.error || message;
            const error = new Error(details.detail || details.message || 'Service startup failed.');
            error.code = details.code;
            error.i18nKey = details.key;
            error.i18nParams = details.params;
            error.detail = details.detail;
            fail(error);
          } else if (message.type === 'event') {
            onEvent(message.event);
          }
        }
      });
      peer.on('close', () => { if (!authenticated) return; if (!settled) fail(new Error('Service helper disconnected before startup.')); else notifyExit(); });
      peer.on('error', error => { if (authenticated) fail(error); });
    });
    server.on('error', fail);
    timer = setTimeout(() => fail(new Error('Authorized helper did not finish startup within the allowed time.')), timeoutMs);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await fsp.writeFile(ticketPath, JSON.stringify({ port: server.address().port, token }), { mode: 0o600, flag: 'wx' });
    child = launch(executable, helperArgs(appPath, ticketPath, packaged), elevated);
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); rejectStart(error); void close().catch(() => {}); } });
    child.on('exit', code => { if (!settled) { settled = true; clearTimeout(timer); rejectStart(new Error(`Service helper exited before startup (${code}).`)); void close().catch(() => {}); } else notifyExit(code); });
    return await result;
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { createController, helperArgs };
