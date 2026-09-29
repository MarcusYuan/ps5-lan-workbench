'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { createDownloadFetch } = require('./download-route');

const DEFAULT_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const METADATA_FILENAME = '.download-metadata.json';

function validateSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Source must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:') throw new TypeError('Only HTTPS download sources are supported.');
  if (url.username || url.password) throw new TypeError('Source URLs must not contain credentials.');
  if (url.hostname.toLowerCase() === 'github.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 2 && !segments.some((part) => part === '.' || part === '..') &&
        !segments[0].startsWith('.') && !segments[1].startsWith('.')) {
      const owner = segments[0];
      const repo = segments[1].replace(/\.git$/i, '');
      if (!owner || !repo) throw new TypeError('Enter a GitHub repository URL in the form https://github.com/owner/repo.');
      return { kind: 'github', owner, repo, sourceUrl: url.href };
    }
  }
  if (!url.pathname.toLowerCase().endsWith('.zip')) {
    throw new TypeError('Enter a GitHub repository URL or a direct HTTPS ZIP URL.');
  }
  return { kind: 'zip', sourceUrl: url.href };
}

function validateEntryPath(entryPath) {
  if (typeof entryPath !== 'string' || !entryPath.trim()) throw new TypeError('Entry path must be a non-empty relative path.');
  const normalized = entryPath.trim();
  if (normalized.includes('\0') || normalized.includes('\\') || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new TypeError('Entry path must be a safe relative path.');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new TypeError('Entry path must not contain empty, dot, or parent segments.');
  return parts.join('/');
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
}

async function request(url, { fetchImpl, signal, headers } = {}) {
  abortIfNeeded(signal);
  const response = await fetchImpl(url, { signal, headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`Download request failed (${response.status} ${response.statusText || ''}).`.trim());
  const finalUrl = response.url || url;
  if (new URL(finalUrl).protocol !== 'https:') throw new Error('Refusing an insecure HTTP redirect.');
  return response;
}

async function resolveSource(source, { fetchImpl, signal }) {
  if (source.kind === 'zip') return { url: source.sourceUrl, version: null };
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'offline-lan-service-shell' };
  const repoResponse = await request(apiRoot, { fetchImpl, signal, headers });
  const repoInfo = await repoResponse.json();
  if (!repoInfo.default_branch) throw new Error('GitHub did not report a default branch for this repository.');
  const branchUrl = `${apiRoot}/branches/${encodeURIComponent(repoInfo.default_branch)}`;
  const branchResponse = await request(branchUrl, { fetchImpl, signal, headers });
  const branchInfo = await branchResponse.json();
  const sha = branchInfo.commit?.sha;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('GitHub did not return a valid commit SHA for the default branch.');
  return { url: `https://codeload.github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/legacy.zip/${sha}`, version: sha };
}

async function downloadToFile(response, filePath, { signal, onProgress, maxArchiveBytes }) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxArchiveBytes) throw new Error(`Archive exceeds the ${maxArchiveBytes} byte download limit.`);
  if (!response.body) throw new Error('Download response did not contain a body.');
  let loaded = 0;
  const hash = crypto.createHash('sha256');
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      loaded += chunk.length;
      if (loaded > maxArchiveBytes) return callback(new Error(`Archive exceeds the ${maxArchiveBytes} byte download limit.`));
      hash.update(chunk);
      onProgress?.({ loaded, total: Number.isFinite(declared) && declared > 0 ? declared : null,
        percent: Number.isFinite(declared) && declared > 0 ? Math.min(100, Math.round(loaded / declared * 100)) : null });
      callback(null, chunk);
    },
  });
  const sourceStream = typeof response.body.getReader === 'function'
    ? require('node:stream').Readable.fromWeb(response.body)
    : response.body;
  await pipeline(sourceStream, meter, fs.createWriteStream(filePath, { flags: 'wx' }), { signal });
  return { bytes: loaded, sha256: hash.digest('hex'), contentLength: Number.isFinite(declared) ? declared : null };
}

function safeZipPath(entryName) {
  if (typeof entryName !== 'string' || !entryName || entryName.includes('\0') || entryName.includes('\\') || entryName.startsWith('/')) {
    throw new Error('ZIP contains an unsafe path.');
  }
  const isDirectory = entryName.endsWith('/');
  const parts = (isDirectory ? entryName.slice(0, -1) : entryName).split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..') || /^[a-zA-Z]:/.test(parts[0])) {
    throw new Error('ZIP contains a path traversal or absolute path.');
  }
  const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (parts.some((part) => part.includes(':') || /[. ]$/.test(part) || windowsReserved.test(part))) {
    throw new Error('ZIP contains a path that is unsafe on Windows.');
  }
  return { name: parts.join('/'), isDirectory, parts };
}

function entryUnixType(entry) {
  const attrs = entry.externalFileAttributes >>> 0;
  const platform = entry.versionMadeBy >>> 8;
  return platform === 3 ? ((attrs >>> 16) & 0xf000) : 0;
}

async function extractZip(zipPath, rawDirectory, { signal, maxExpandedBytes, yauzlImpl }) {
  const yauzl = yauzlImpl || require('yauzl');
  await fsp.mkdir(rawDirectory, { recursive: true });
  return new Promise((resolve, reject) => {
    let archive;
    let settled = false;
    let expanded = 0;
    const names = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', abort);
      if (archive) archive.close();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return finish(openError);
      archive = zip;
      zip.on('error', finish);
      zip.on('end', () => finish(null, { expandedBytes: expanded, names }));
      zip.on('entry', (entry) => {
        (async () => {
          const safe = safeZipPath(entry.fileName);
          const unixType = entryUnixType(entry);
          if (unixType === 0xa000) throw new Error('ZIP symbolic links are not allowed.');
          if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error('ZIP contains an unsupported special file.');
          const destination = path.join(rawDirectory, ...safe.parts);
          const resolved = path.resolve(destination);
          const root = path.resolve(rawDirectory) + path.sep;
          if (!resolved.startsWith(root)) throw new Error('ZIP contains a path outside the extraction directory.');
          names.push(safe.name + (safe.isDirectory ? '/' : ''));
          if (safe.isDirectory) {
            await fsp.mkdir(destination, { recursive: true });
            zip.readEntry();
            return;
          }
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new Error('ZIP contains an invalid file size.');
          expanded += entry.uncompressedSize;
          if (expanded > maxExpandedBytes) throw new Error(`Expanded archive exceeds the ${maxExpandedBytes} byte limit.`);
          await fsp.mkdir(path.dirname(destination), { recursive: true });
          await new Promise((done, fail) => {
            zip.openReadStream(entry, (streamError, stream) => {
              if (streamError) return fail(streamError);
              const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
              pipeline(stream, output, { signal }).then(done, fail);
            });
          });
          zip.readEntry();
        })().catch(finish);
      });
      zip.readEntry();
    });
  });
}

function uniformTopFolder(names) {
  if (!names.length) return null;
  let top = null;
  for (const name of names) {
    const isDirectory = name.endsWith('/');
    const parts = name.split('/').filter(Boolean);
    if ((!isDirectory && parts.length < 2) || (isDirectory && parts.length < 1) || (top !== null && parts[0] !== top)) return null;
    top = parts[0];
  }
  return top;
}

async function replaceDirectory(stagedDirectory, destinationDir) {
  const parent = path.dirname(destinationDir);
  const backup = path.join(parent, `.${path.basename(destinationDir)}.backup-${crypto.randomUUID()}`);
  let movedOld = false;
  try {
    try {
      await fsp.rename(destinationDir, backup);
      movedOld = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fsp.rename(stagedDirectory, destinationDir);
  } catch (error) {
    if (movedOld) {
      try { await fsp.rename(backup, destinationDir); } catch (restoreError) {
        error.restoreError = restoreError;
      }
    }
    throw error;
  }
  if (movedOld) await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
}

/** Download and transactionally install a user-selected ZIP archive. */
async function downloadArchive({ sourceUrl, destinationDir, entryPath = 'index.html', signal, onProgress,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES, maxExpandedBytes = DEFAULT_MAX_EXPANDED_BYTES,
  fetchImpl = globalThis.fetch, downloadRoute = 'direct', yauzlImpl } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch API implementation is required.');
  if (!destinationDir || typeof destinationDir !== 'string') throw new TypeError('A destination directory is required.');
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 1 || !Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1) {
    throw new TypeError('Archive size limits must be positive safe integers.');
  }
  const source = validateSourceUrl(sourceUrl);
  fetchImpl = createDownloadFetch(downloadRoute, fetchImpl);
  const safeEntryPath = validateEntryPath(entryPath);
  abortIfNeeded(signal);
  const resolved = await resolveSource(source, { fetchImpl, signal });
  const response = await request(resolved.url, { fetchImpl, signal });
  const finalUrl = response.url || resolved.url;
  const target = path.resolve(destinationDir);
  const parent = path.dirname(target);
  await fsp.mkdir(parent, { recursive: true });
  const work = await fsp.mkdtemp(path.join(parent, `.${path.basename(target)}.download-`));
  const zipPath = path.join(work, 'archive.zip');
  const raw = path.join(work, 'raw');
  const staged = path.join(work, 'ready');
  try {
    const archiveInfo = await downloadToFile(response, zipPath, { signal, onProgress, maxArchiveBytes });
    const extractInfo = await extractZip(zipPath, raw, { signal, maxExpandedBytes, yauzlImpl });
    const wrapper = uniformTopFolder(extractInfo.names);
    const contentDir = wrapper ? path.join(raw, wrapper) : raw;
    const entryFullPath = path.resolve(contentDir, ...safeEntryPath.split('/'));
    if (!entryFullPath.startsWith(path.resolve(contentDir) + path.sep)) throw new Error('Entry path is outside the downloaded content directory.');
    let entryStat;
    try { entryStat = await fsp.stat(entryFullPath); } catch { throw new Error(`Entry file was not found in the archive: ${safeEntryPath}`); }
    if (!entryStat.isFile()) throw new Error(`Entry path is not a file: ${safeEntryPath}`);
    await fsp.rename(contentDir, staged);
    const metadata = {
      sourceUrl: source.sourceUrl,
      downloadRoute,
      finalUrl,
      version: resolved.version,
      sha256: archiveInfo.sha256,
      downloadedAt: new Date().toISOString(),
      archiveBytes: archiveInfo.bytes,
      expandedBytes: extractInfo.expandedBytes,
      entryPath: safeEntryPath,
    };
    await fsp.writeFile(path.join(staged, METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await replaceDirectory(staged, target);
    return { ...metadata, destinationDir: target, entryFile: path.join(target, ...safeEntryPath.split('/')) };
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

module.exports = { downloadArchive, validateSourceUrl, validateEntryPath, safeZipPath,
  DEFAULT_MAX_ARCHIVE_BYTES, DEFAULT_MAX_EXPANDED_BYTES, METADATA_FILENAME };
