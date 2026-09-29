'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { request, identify, uploadPort } = require('../ps5/manager-client');
const { assertUnchanged } = require('./file');

const SEGMENT_BYTES = 1024 * 1024;
const MAX_FLIGHTS = 2;

async function install(selected, target, { signal, onUpdate = () => {} } = {}) {
  await assertUnchanged(selected);
  const identity = await identify(target, signal);
  if (identity.upload.active || identity.install.is_installing)
    throw Object.assign(new Error('PKG Manager is busy'), { code: 'MANAGER_BUSY' });
  const eligibility = await request(target, '/api/upload/check', { method: 'POST', body: selected.details, signal });
  if (eligibility?.can_install !== true)
    throw Object.assign(new Error(eligibility?.install_disabled_reason || 'PKG cannot be installed'), { code: 'PKG_INELIGIBLE' });

  const owner = crypto.randomBytes(32).toString('hex');
  const details = selected.details;
  const init = await request(target, '/api/upload/init', {
    method: 'POST', signal, body: { filename: selected.name, total: selected.size, owner, session_id: '',
      title_name: details.title_name, title_id: details.title_id,
      app_version: details.app_version, pkg_type: details.pkg_type },
  });
  const port = uploadPort(init);
  const sid = init.session_id;
  const ownPath = `live:${sid}`;
  const totalSegments = Math.ceil(selected.size / SEGMENT_BYTES);
  const acked = new Set();
  const pending = new Set([0]);
  const flights = new Set();
  const retries = new Map();
  let file;
  let ws;
  let timer;
  let finished = false;
  let installStarted = false;
  let sending = false;
  let demandWindow = 0;
  let maxFlights = 1;
  let nextSequential = 0;
  let lastReply = Date.now();
  let pollBusy = false;
  let confirmed = false;
  let stopResolve;
  let stopReject;
  const done = new Promise((resolve, reject) => { stopResolve = resolve; stopReject = reject; });
  const fail = cause => { if (!finished) { finished = true; stopReject(cause); } };
  const succeed = () => { if (!finished) { confirmed = true; finished = true; stopResolve({ status: 'confirmed', sessionId: sid }); } };
  const cancel = async () => {
    const result = await request(target, '/api/upload/cancel', { method: 'POST',
      body: { owner, session_id: sid }, timeout: 5000 }).catch(() => null);
    return result?.success === true;
  };
  const abort = async () => {
    const confirmed = await cancel();
    fail(Object.assign(new Error(confirmed ? 'Canceled' : 'Cancel result unknown'),
      { code: confirmed ? 'TASK_CANCELED' : 'RESULT_UNCONFIRMED' }));
  };
  signal?.addEventListener('abort', abort, { once: true });

  async function pump() {
    if (sending || finished || !ws || ws.readyState !== WebSocket.OPEN) return;
    sending = true;
    try {
      while (!finished && flights.size < maxFlights) {
        let segment = pending.values().next().value;
        if (segment == null && !demandWindow) {
          while (nextSequential < totalSegments && (acked.has(nextSequential) || flights.has(nextSequential))) nextSequential++;
          segment = nextSequential < totalSegments ? nextSequential++ : undefined;
        }
        if (segment == null) break;
        pending.delete(segment);
        if (segment < 0 || segment >= totalSegments || flights.has(segment)) continue;
        flights.add(segment);
        const length = Math.min(SEGMENT_BYTES, selected.size - segment * SEGMENT_BYTES);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(buffer, 0, length, segment * SEGMENT_BYTES);
        if (bytesRead !== length) throw Object.assign(new Error('Package file changed'), { code: 'PKG_CHANGED' });
        if (finished) break;
        ws.send(JSON.stringify({ op: 'seg', seg: segment }));
        ws.send(buffer);
      }
    } catch (cause) { fail(cause); } finally { sending = false; }
  }

  function onMessage(event) {
    if (finished) return;
    lastReply = Date.now();
    let message;
    try { message = JSON.parse(String(event.data)); } catch { fail(new Error('Invalid upload socket reply')); return; }
    if (message.op === 'ack' && Number.isInteger(message.seg) && message.seg >= 0 && message.seg < totalSegments) {
      flights.delete(message.seg); retries.delete(message.seg);
      acked.add(message.seg);
      onUpdate({ phase: 'installing', transferProgress: Math.min(100, Math.round(acked.size / totalSegments * 100)) });
      void pump();
    } else if (message.op === 'busy' && Number.isInteger(message.seg)) {
      flights.delete(message.seg);
      const count = (retries.get(message.seg) || 0) + 1;
      retries.set(message.seg, count);
      if (count > 120) fail(Object.assign(new Error('Upload remained busy'), { code: 'UPLOAD_STALLED' }));
      else setTimeout(() => { pending.add(message.seg); void pump(); }, Math.min(1000, count * 50));
    } else if (message.op === 'seek' && Number.isInteger(message.seg)) {
      if (message.seg >= 0 && message.seg < totalSegments) {
        pending.add(message.seg);
        for (let i = 1; i < demandWindow && pending.size < 16 && message.seg + i < totalSegments; i++)
          if (!acked.has(message.seg + i)) pending.add(message.seg + i);
        void pump();
      }
    } else if (message.op === 'error') {
      fail(Object.assign(new Error(message.error || 'Upload rejected'), { code: 'UPLOAD_REJECTED' }));
    }
  }

  async function poll() {
    if (pollBusy || finished) return;
    pollBusy = true;
    try {
      const upload = await request(target, '/api/upload/status', { timeout: 5000 });
      if (upload.session_id && upload.session_id !== sid) throw Object.assign(new Error('Upload session replaced'), { code: 'SESSION_CHANGED' });
      if (!installStarted && upload.header_ready) {
        const current = await request(target, '/api/poll', { timeout: 5000 });
        if (current.is_installing && current.pkg_path !== ownPath)
          throw Object.assign(new Error('Another installation is running'), { code: 'MANAGER_BUSY' });
        if (!current.is_installing) {
          const launched = await request(target, '/api/install', { method: 'POST', body: { path: ownPath }, timeout: 15000 });
          if (!launched?.success) throw Object.assign(new Error(launched?.error || 'Installation rejected'), { code: 'INSTALL_REJECTED' });
        }
        installStarted = true;
        onUpdate({ phase: 'installing', installProgress: null });
      }
      if (installStarted) {
        const status = await request(target, '/api/poll', { timeout: 5000 });
        if (status.pkg_path !== ownPath) throw Object.assign(new Error('Installation status no longer matches this session'), { code: 'RESULT_UNCONFIRMED' });
        onUpdate({ phase: 'installing', installProgress: Number.isFinite(status.progress) ? status.progress : null });
        if (status.failed) throw Object.assign(new Error(status.status || 'PS5 installation failed'), { code: 'INSTALL_FAILED' });
        if (status.completed === true) succeed();
        else if (!status.is_installing) throw Object.assign(new Error('Installation result unknown'), { code: 'RESULT_UNCONFIRMED' });
      }
      if (Date.now() - lastReply > 15000 && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
      if (Date.now() - lastReply > 60000) throw Object.assign(new Error('Upload stalled'), { code: 'UPLOAD_STALLED' });
      await assertUnchanged(selected);
    } catch (cause) { fail(cause); } finally { pollBusy = false; }
  }

  try {
    file = await fs.promises.open(selected.path, 'r');
    onUpdate({ phase: 'uploading', transferProgress: 0, installProgress: null, sessionId: sid });
    ws = new WebSocket(`ws://${target.address}:${port}/ws/upload`);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Upload socket timed out')), 10000);
      ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Upload socket failed')); }, { once: true });
    });
    ws.send(JSON.stringify({ op: 'init', filename: selected.name, total: selected.size, owner, session_id: sid }));
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Upload handshake timed out')), 10000);
      ws.addEventListener('message', function listener(event) {
        clearTimeout(timeout); ws.removeEventListener('message', listener);
        try { resolve(JSON.parse(String(event.data))); } catch { reject(new Error('Invalid upload handshake')); }
      });
    });
    if (ready?.op !== 'ready' || ready.session_id !== sid)
      throw Object.assign(new Error(ready?.error || 'Upload session refused'), { code: 'UPLOAD_HANDSHAKE' });
    demandWindow = Number.isInteger(ready.demand_window) ? Math.min(8, Math.max(0, ready.demand_window)) : 0;
    maxFlights = ready.upload_window === 2 ? MAX_FLIGHTS : 1;
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', () => fail(new Error('Upload socket failed')));
    ws.addEventListener('close', () => fail(Object.assign(new Error('Upload socket closed'), { code: 'RESULT_UNCONFIRMED' })));
    await pump();
    timer = setInterval(() => { void poll(); }, 2000);
    await poll();
    return await done;
  } catch (cause) {
    if (!confirmed && !signal?.aborted) await cancel();
    throw cause;
  } finally {
    finished = true;
    clearInterval(timer);
    signal?.removeEventListener('abort', abort);
    try { ws?.close(); } catch { /* already closed */ }
    await file?.close();
  }
}

module.exports = { install, SEGMENT_BYTES, MAX_FLIGHTS };
