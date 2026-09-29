'use strict';

const { validPort } = require('./target');

function endpoint(target, route) { return `http://${target.address}:${target.managerPort}${route}`; }

async function request(target, route, { method = 'GET', body, signal, timeout = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(endpoint(target, route), {
      method, body: body == null ? undefined : JSON.stringify(body),
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      signal: controller.signal, redirect: 'error',
    });
    const raw = await response.text();
    if (raw.length > 65536) throw new Error('PKG Manager reply exceeds size limit');
    if (!response.ok) throw Object.assign(new Error(`PKG Manager HTTP ${response.status}: ${raw.slice(0, 300)}`), { code: `HTTP_${response.status}` });
    if (route === '/api/version') return raw.trim();
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid PKG Manager response'), { code: 'BAD_MANAGER_RESPONSE' }); }
  } catch (cause) {
    if (controller.signal.aborted && !signal?.aborted)
      throw Object.assign(new Error('PKG Manager timed out'), { code: 'ETIMEDOUT' });
    throw cause;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function identify(target, signal) {
  const version = await request(target, '/api/version', { signal });
  if (version !== '1.4.1') throw Object.assign(new Error(`Unsupported PKG Manager version: ${version}`), { code: 'UNSUPPORTED_MANAGER_VERSION' });
  const [upload, install] = await Promise.all([
    request(target, '/api/upload/status', { signal }),
    request(target, '/api/poll', { signal }),
  ]);
  if (!upload || typeof upload !== 'object' || typeof upload.active !== 'boolean' ||
      !install || typeof install !== 'object' || typeof install.is_installing !== 'boolean' ||
      typeof install.pkg_path !== 'string') {
    throw Object.assign(new Error('Unrecognized PKG Manager API'), { code: 'UNRECOGNIZED_MANAGER' });
  }
  return { version, upload, install };
}

function uploadPort(init) {
  const port = Number(init?.ws_port);
  if (!init?.success || typeof init.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(init.session_id) || !validPort(port))
    throw Object.assign(new Error('Invalid upload session reply'), { code: 'BAD_UPLOAD_INIT' });
  return port;
}

function loadDecision(identity, reload = false) {
  if (identity.upload.active || identity.install.is_installing) {
    if (reload) throw Object.assign(new Error('PKG Manager is busy'), { code: 'MANAGER_BUSY' });
    return 'alreadyRunningBusy';
  }
  return reload ? 'send' : 'alreadyRunning';
}

module.exports = { request, identify, uploadPort, loadDecision };
