'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createError } = require('../i18n');
const { component } = require('./catalog');
const { createDownloadFetch, MIRROR_ORIGIN } = require('../core/download-route');

const MAX_COMPONENT_BYTES = 32 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'gbatemp.net']);

function extractElf(archive, item, signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
  const executable = require('7zip-bin').path7za.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  return new Promise((resolve, reject) => {
    // Extract only the catalog's fixed member to stdout; archive paths never reach the filesystem.
    const child = spawn(executable, ['e', '-so', '-y', archive, item.asset], { windowsHide: true, signal });
    const chunks = [];
    let size = 0;
    let failure;
    const timer = setTimeout(() => { failure = createError('COMPONENT_EXTRACT_TIMEOUT', 'components.extractTimeout'); child.kill(); }, 30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > item.size) { failure = new Error('Component exceeds expected size'); child.kill(); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', cause => { failure = cause; });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || size !== item.size) reject(createError('COMPONENT_EXTRACT_FAILED', 'components.extractFailed'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function cachePath(cacheDir, id) { return path.join(cacheDir, `${id}.${component(id).format || 'elf'}`); }

async function inspect(cacheDir, id) {
  const item = component(id);
  const file = cachePath(cacheDir, id);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size !== item.size) return null;
  const header = Buffer.alloc(4);
  const check = await fsp.open(file, 'r');
  try { await check.read(header, 0, 4, 0); } finally { await check.close(); }
  if (item.format !== 'dat' && !header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return null;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === item.sha256 ? { file, sha256: item.sha256, size: stat.size, version: item.version } : null;
}

async function download(cacheDir, id, { signal, onProgress = () => {}, downloadRoute = 'direct', fetchImpl = globalThis.fetch } = {}) {
  const item = component(id);
  if (item.format === 'dat') signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]) : AbortSignal.timeout(30 * 60 * 1000);
  await fsp.mkdir(cacheDir, { recursive: true });
  const temporary = path.join(cacheDir, `${id}-${crypto.randomUUID()}.part`);
  const extracted = `${temporary}.elf`;
  const expected = item.archive || item;
  let handle;
  try {
    const response = await createDownloadFetch(downloadRoute, fetchImpl)(item.url, { signal, redirect: 'follow', headers: { 'User-Agent': 'PS5-Local-Host' } });
    const finalUrl = new URL(response.url || item.url);
    if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password || finalUrl.port ||
        !(ALLOWED_HOSTS.has(finalUrl.hostname) || (downloadRoute === 'mirror' && finalUrl.origin === MIRROR_ORIGIN))) throw new Error('Unexpected download redirect');
    if (!response.ok || !response.body) throw new Error(`Component download failed (${response.status})`);
    handle = await fsp.open(temporary, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      if (signal?.aborted) throw Object.assign(new Error('Canceled'), { name: 'AbortError' });
      size += chunk.length;
      if (size > (item.format === 'dat' ? 512 * 1024 * 1024 : MAX_COMPONENT_BYTES) || size > expected.size) throw new Error('Component exceeds expected size');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw new Error('Component file write stopped');
        offset += bytesWritten;
      }
      onProgress(Math.min(item.archive ? 95 : 100, Math.round(size / expected.size * (item.archive ? 95 : 100))));
    }
    await handle.close(); handle = null;
    if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('Component checksum mismatch');
    let elfFile = temporary;
    if (item.archive) {
      const bytes = await extractElf(temporary, item, signal);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Component checksum mismatch');
      await fsp.writeFile(extracted, bytes, { flag: 'wx', mode: 0o600 });
      elfFile = extracted;
    }
    const header = Buffer.alloc(4);
    const check = await fsp.open(elfFile, 'r');
    try { await check.read(header, 0, 4, 0); } finally { await check.close(); }
    if (item.format !== 'dat' && !header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Downloaded file is not ELF');
    if (signal?.aborted) throw Object.assign(new Error('Canceled'), { name: 'AbortError' });
    await fsp.rename(elfFile, cachePath(cacheDir, id));
    onProgress(100);
    return { version: item.version, size: item.size, sha256: item.sha256, url: finalUrl.href, downloadRoute, downloadedAt: new Date().toISOString() };
  } finally {
    await handle?.close().catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});
    await fsp.rm(extracted, { force: true }).catch(() => {});
  }
}

module.exports = { inspect, download, cachePath, extractElf };
