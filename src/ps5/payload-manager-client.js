'use strict';

const PORT = 8084;
const VERSION = '0.5.2';
const MAX_RESPONSE_BYTES = 16 * 1024;
const UNREACHABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

function url(target, route, port = PORT) {
  return `http://${target.address}:${port}${route}`;
}

function isUnreachable(cause) {
  return UNREACHABLE.has(cause?.code) || UNREACHABLE.has(cause?.cause?.code);
}

async function request(target, route, { signal, timeout = 5000, port = PORT, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    const response = await fetchImpl(url(target, route, port), {
      method: 'GET', redirect: 'error', signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error(`Payload Manager HTTP ${response.status}`), { code: 'PAYLOAD_MANAGER_HTTP' });
    if (!response.body) throw Object.assign(new Error('Empty Payload Manager response'), { code: 'BAD_PAYLOAD_MANAGER_RESPONSE' });
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_RESPONSE_BYTES) throw Object.assign(new Error('Payload Manager response too large'), { code: 'BAD_PAYLOAD_MANAGER_RESPONSE' });
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) throw Object.assign(new Error('Payload Manager response too large'), { code: 'BAD_PAYLOAD_MANAGER_RESPONSE' });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (cause) {
    if (signal?.aborted) throw Object.assign(new Error('Canceled'), { name: 'AbortError', code: 'TASK_CANCELED' });
    if (controller.signal.aborted) throw Object.assign(new Error('Payload Manager request timed out'), { code: 'ETIMEDOUT' });
    throw cause;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function identify(target, signal, options = {}) {
  const started = Date.now();
  const rawVersion = await request(target, '/version', { signal, ...options });
  const version = rawVersion.trim();
  if (version !== VERSION) throw Object.assign(new Error(`Unverified Payload Manager version: ${version.slice(0, 80) || '(empty)'}`), { code: 'UNVERIFIED_PAYLOAD_MANAGER_VERSION' });
  const timeout = options.timeout == null ? undefined : Math.max(1, options.timeout - (Date.now() - started));
  const rawConfig = await request(target, '/get_config', { signal, ...options, ...(timeout == null ? {} : { timeout }) });
  let config;
  try { config = JSON.parse(rawConfig); }
  catch { throw Object.assign(new Error('Invalid Payload Manager config response'), { code: 'BAD_PAYLOAD_MANAGER_RESPONSE' }); }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      typeof config.AUTOLOAD_ENABLED !== 'boolean' ||
      typeof config.AUTOLOAD_LIST !== 'string' ||
      typeof config.AUTO_BROWSER_OPEN !== 'boolean')
    throw Object.assign(new Error('Unrecognized Payload Manager config response'), { code: 'BAD_PAYLOAD_MANAGER_RESPONSE' });
  return { version };
}

async function waitForReady(target, signal, { duration = 30000, interval = 2000, identifyImpl = identify } = {}) {
  const deadline = Date.now() + duration;
  while (true) {
    if (signal?.aborted) throw Object.assign(new Error('Canceled'), { name: 'AbortError', code: 'TASK_CANCELED' });
    const budget = deadline - Date.now();
    if (budget <= 0) throw Object.assign(new Error('Payload Manager startup not confirmed'), { code: 'RESULT_UNCONFIRMED' });
    try { return await identifyImpl(target, signal, { timeout: Math.min(5000, budget) }); }
    catch (cause) {
      if (!isUnreachable(cause)) throw cause;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error('Payload Manager startup not confirmed'), { code: 'RESULT_UNCONFIRMED' });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(interval, remaining));
        const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Canceled'), { name: 'AbortError', code: 'TASK_CANCELED' })); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}

async function load(file, target, { signal, onProgress = () => {}, onPhase = () => {},
  onRuntime = () => {}, identifyImpl = identify, sendImpl, waitImpl = waitForReady } = {}) {
  try {
    await identifyImpl(target, signal);
    onRuntime('running');
    return { status: 'alreadyRunning' };
  } catch (cause) {
    if (!isUnreachable(cause)) {
      onRuntime('error', cause);
      throw cause;
    }
    onRuntime('unreachable', cause);
  }
  onPhase('sending');
  await sendImpl(file, target, { signal, onProgress });
  onPhase('verifying');
  try {
    await waitImpl(target, signal);
    onRuntime('running');
    return { status: 'confirmed' };
  } catch (cause) {
    onRuntime(cause.code === 'RESULT_UNCONFIRMED' ? 'unconfirmed' : 'error', cause);
    throw cause;
  }
}

module.exports = { PORT, VERSION, identify, isUnreachable, url, waitForReady, load };
