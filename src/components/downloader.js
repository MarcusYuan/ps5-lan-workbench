'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { component } = require('./catalog');
const { createDownloadFetch, MIRROR_ORIGIN } = require('../core/download-route');

const MAX_COMPONENT_BYTES = 32 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function cachePath(cacheDir, id) { return path.join(cacheDir, `${id}.elf`); }

async function inspect(cacheDir, id) {
  const item = component(id);
  const file = cachePath(cacheDir, id);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size !== item.size) return null;
  const header = Buffer.alloc(4);
  const check = await fsp.open(file, 'r');
  try { await check.read(header, 0, 4, 0); } finally { await check.close(); }
  if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return null;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === item.sha256 ? { file, sha256: item.sha256, size: stat.size, version: item.version } : null;
}

async function download(cacheDir, id, { signal, onProgress = () => {}, downloadRoute = 'direct', fetchImpl = globalThis.fetch } = {}) {
  const item = component(id);
  await fsp.mkdir(cacheDir, { recursive: true });
  const temporary = path.join(cacheDir, `${id}-${crypto.randomUUID()}.part`);
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
      if (size > MAX_COMPONENT_BYTES || size > item.size) throw new Error('Component exceeds expected size');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw new Error('Component file write stopped');
        offset += bytesWritten;
      }
      onProgress(Math.min(100, Math.round(size / item.size * 100)));
    }
    await handle.close(); handle = null;
    if (size !== item.size || hash.digest('hex') !== item.sha256) throw new Error('Component checksum mismatch');
    const header = Buffer.alloc(4);
    const check = await fsp.open(temporary, 'r');
    try { await check.read(header, 0, 4, 0); } finally { await check.close(); }
    if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Downloaded file is not ELF');
    await fsp.rename(temporary, cachePath(cacheDir, id));
    return { version: item.version, size, sha256: item.sha256, url: finalUrl.href, downloadRoute, downloadedAt: new Date().toISOString() };
  } finally {
    await handle?.close().catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

module.exports = { inspect, download, cachePath };
