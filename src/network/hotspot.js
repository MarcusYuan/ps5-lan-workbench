'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { createError } = require('../i18n');

const fail = key => createError('HOTSPOT', `hotspot.${key}`);
const nativeErrors = new Set(['invalid', 'sharingActive', 'radioUnavailable', 'addressAmbiguous', 'nativeError', 'isolationFailed']);

function validateOptions(options) {
  if (!options || typeof options.ssid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(options.ssid) ||
      typeof options.password !== 'string' || !/^[\x21-\x7e]{8,63}$/.test(options.password)) throw fail('invalid');
  return { ssid: options.ssid, password: options.password };
}

function privateAddress(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const n = value.split('.').map(Number);
  return n.every(v => v <= 255) && (n[0] === 10 || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168));
}

function peerAddresses(values, host) {
  if (!Array.isArray(values) || values.length > 8 || values.some(ip => !privateAddress(ip) || ip === host)) return null;
  return [...new Set(values)].sort();
}

function nativeScript({ compileOnly = false, inputProbe = false } = {}) {
  const sources = ['hotspot-native.cs', 'hotspot-isolation.cs']
    .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8'));
  // Compress raw trusted source once; base64-before-gzip needlessly enlarges Windows arguments.
  if (sources.some(source => /^'@/m.test(source))) throw fail('nativeError');
  const sourceArray = sources.map(source => `@'\n${source}\n'@`).join(',\n');
  const script = `$hotspotCompileOnly=$${compileOnly}\n$hotspotInputProbe=$${inputProbe}\n$hotspotSource=@(\n${sourceArray}\n)\n` +
    fs.readFileSync(path.join(__dirname, 'hotspot-native.ps1'), 'utf8');
  // Keep below Windows' process command length limit as the native source grows.
  const encoded = gzipSync(Buffer.from(script, 'utf8')).toString('base64');
  return `$bytes=[Convert]::FromBase64String('${encoded}');$stream=New-Object IO.MemoryStream(,$bytes);` +
    '$gzip=New-Object IO.Compression.GZipStream($stream,[IO.Compression.CompressionMode]::Decompress);' +
    '$reader=New-Object IO.StreamReader($gzip,[Text.Encoding]::UTF8);' +
    'try { & ([ScriptBlock]::Create($reader.ReadToEnd())) } finally { $reader.Dispose();$gzip.Dispose();$stream.Dispose() }';
}

async function startWindowsHotspot(options, { platform = process.platform, spawnProcess = spawn,
  onEvent = () => {}, startupMs = 45000, healthMs = 12000, stopMs = 5000,
  servicePorts = { dns: 53, https: 443, http: 8000 } } = {}) {
  if (platform !== 'win32') throw fail('unsupported');
  const request = validateOptions(options);
  for (const key of ['dns', 'https', 'http']) {
    if (!Number.isInteger(servicePorts?.[key]) || servicePorts[key] < 1 || servicePorts[key] > 65535) throw fail('invalid');
  }
  // These are trusted host configuration, never taken from renderer hotspot options.
  const nativeRequest = { ...request, executable: process.execPath,
    dnsPort: servicePorts.dns, httpsPort: servicePorts.https, httpPort: servicePorts.http };
  const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(nativeScript(), 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stopping = false;
  let exited = false;
  let stopPromise;
  let timer;
  let ready = false;
  let address = '';
  let buffer = '';
  let reported = false;
  let resolveExit;
  const exit = new Promise(resolve => { resolveExit = resolve; });
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopping = true;
    clearTimeout(timer);
    stopPromise = (async () => {
      if (exited) return;
      child.stdin.end('\n');
      let timeout;
      await Promise.race([exit, new Promise(resolve => { timeout = setTimeout(resolve, stopMs); })]);
      clearTimeout(timeout);
      if (!exited) {
        child.kill();
        await Promise.race([exit, new Promise(resolve => { timeout = setTimeout(resolve, stopMs); })]);
        clearTimeout(timeout);
      }
      if (!exited) throw fail('stopFailed');
    })();
    return stopPromise;
  };
  const result = new Promise((resolve, reject) => {
    const failed = key => {
      if (stopping || reported) return;
      reported = true;
      const cause = fail(key);
      // Release the native publisher before reporting failure to the parent.
      void stop().then(() => {
        if (!ready) reject(cause);
        else onEvent({ type: 'hotspotFailed', key: cause.i18nKey });
      }, () => {
        if (!ready) reject(fail('stopFailed'));
        else onEvent({ type: 'hotspotFailed', key: 'hotspot.stopFailed' });
      });
    };
    const arm = (ms, key) => { clearTimeout(timer); timer = setTimeout(() => failed(key), ms); };
    arm(startupMs, 'radioUnavailable');
    child.on('error', () => { exited = true; resolveExit(); failed('nativeError'); });
    child.on('exit', () => { exited = true; resolveExit(); failed('unexpectedStop'); });
    child.stdin.on('error', () => failed('nativeError'));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) { failed('nativeError'); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/^\uFEFF/, '');
        buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { failed('nativeError'); return; }
        if (stopping) return;
        if (message.type === 'error') { failed(nativeErrors.has(message.key) ? message.key : 'nativeError'); return; }
        if (message.type === 'started' && !ready) {
          if (message.isolated !== true) { failed('isolationFailed'); return; }
          ready = true;
          arm(healthMs, 'healthLost');
          resolve({ stop, result: { ssid: request.ssid }, get address() { return address; } });
        } else if (message.type === 'health' && ready) arm(healthMs, 'healthLost');
        else if (message.type === 'address' && ready) {
          if (message.address !== '' && !privateAddress(message.address)) { failed('addressAmbiguous'); return; }
          address = message.address;
          onEvent({ type: 'hotspotAddress', address });
        } else if (message.type === 'peer' && ready && privateAddress(message.address) && privateAddress(message.peer)) {
          onEvent({ type: 'hotspotPeer', address: message.address, peer: message.peer });
        } else if (message.type === 'peers' && ready && message.address === address && privateAddress(address)) {
          const peers = peerAddresses(message.peers, address);
          if (peers === null) { failed('nativeError'); return; }
          onEvent({ type: 'hotspotPeers', address, peers });
        } else if (message.type === 'disconnected' && ready) onEvent({ type: 'hotspotPeerLeft' });
        else if (message.type === 'peerError' && ready) onEvent({ type: 'hotspotPeerError' });
      }
    });
    // Drain diagnostics without exposing raw compiler/COM output or passwords.
    child.stderr.resume();
    child.stdin.write(JSON.stringify(nativeRequest) + '\n');
  });
  return result;
}

module.exports = { validateOptions, privateAddress, peerAddresses, nativeScript, startWindowsHotspot };
