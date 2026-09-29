'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { downloadArchive, validateSourceUrl, validateEntryPath } = require('../src/core/downloader');

let hasYauzl = true;
try { require.resolve('yauzl'); } catch { hasYauzl = false; }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small standards-compliant stored ZIP fixture builder; no external zip tool is needed.
function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name);
    const data = Buffer.from(item.data || '');
    const directory = item.name.endsWith('/');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const unixType = item.unixType ?? (directory ? 0x4000 : 0x8000);
    central.writeUInt32LE((((unixType) | (directory ? 0o755 : 0o644)) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function response(bytes, url = 'https://files.example.test/package.zip') {
  return new Response(Readable.toWeb(Readable.from([bytes])), {
    status: 200,
    headers: { 'content-length': String(bytes.length) },
  });
}

async function withTempDir(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'downloader-test-'));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('accepts only GitHub repository roots or direct HTTPS ZIP URLs', () => {
  assert.deepEqual(validateSourceUrl('https://github.com/example/project'), {
    kind: 'github', owner: 'example', repo: 'project', sourceUrl: 'https://github.com/example/project',
  });
  assert.equal(validateSourceUrl('https://downloads.example.test/release.zip').kind, 'zip');
  assert.throws(() => validateSourceUrl('http://github.com/example/project'), /HTTPS/);
  assert.throws(() => validateSourceUrl('https://github.com/example/project/tree/main'), /GitHub repository|ZIP/);
  assert.throws(() => validateSourceUrl('https://downloads.example.test/release.tar.gz'), /ZIP/);
});

test('validates relative entry paths', () => {
  assert.equal(validateEntryPath('nested/index.html'), 'nested/index.html');
  for (const value of ['../index.html', '/index.html', 'C:/index.html', 'nested\\index.html', 'a//b']) {
    assert.throws(() => validateEntryPath(value), /relative path|segments/);
  }
});

test('rejects malformed ZIP data and preserves an existing install', { skip: !hasYauzl }, async () => {
  await withTempDir(async (directory) => {
    const destinationDir = path.join(directory, 'site');
    await fs.mkdir(destinationDir);
    await fs.writeFile(path.join(destinationDir, 'old.txt'), 'keep me');
    await assert.rejects(downloadArchive({
      sourceUrl: 'https://files.example.test/bad.zip', destinationDir,
      fetchImpl: async (url) => response(Buffer.from('not a zip'), url),
    }));
    assert.equal(await fs.readFile(path.join(destinationDir, 'old.txt'), 'utf8'), 'keep me');
  });
});

test('rejects ZIP traversal entries and preserves existing content', { skip: !hasYauzl }, async () => {
  await withTempDir(async (directory) => {
    const destinationDir = path.join(directory, 'site');
    await fs.mkdir(destinationDir);
    await fs.writeFile(path.join(destinationDir, 'old.txt'), 'old');
    const zip = makeZip([{ name: 'bundle/index.html', data: 'ok' }, { name: '../outside.txt', data: 'escape' }]);
    await assert.rejects(downloadArchive({
      sourceUrl: 'https://files.example.test/package.zip', destinationDir,
      fetchImpl: async (url) => response(zip, url),
    }), /unsafe|traversal|absolute|relative path/i);
    assert.equal(await fs.readFile(path.join(destinationDir, 'old.txt'), 'utf8'), 'old');
    await assert.rejects(fs.stat(path.join(directory, 'outside.txt')));
  });
});

test('rejects ZIP symbolic links', { skip: !hasYauzl }, async () => {
  await withTempDir(async directory => {
    const zip = makeZip([
      { name: 'bundle/index.html', data: 'ok' },
      { name: 'bundle/escape', data: '../../secret', unixType: 0xa000 },
    ]);
    await assert.rejects(downloadArchive({
      sourceUrl: 'https://files.example.test/package.zip', destinationDir: path.join(directory, 'site'),
      fetchImpl: async url => response(zip, url),
    }), /symbolic links/);
  });
});

test('reports a missing entry without replacing the existing install', { skip: !hasYauzl }, async () => {
  await withTempDir(async (directory) => {
    const destinationDir = path.join(directory, 'site');
    await fs.mkdir(destinationDir);
    await fs.writeFile(path.join(destinationDir, 'old.txt'), 'old');
    const zip = makeZip([{ name: 'bundle/readme.txt', data: 'hello' }]);
    await assert.rejects(downloadArchive({
      sourceUrl: 'https://files.example.test/package.zip', destinationDir,
      fetchImpl: async (url) => response(zip, url),
    }), /Entry file was not found/);
    assert.equal(await fs.readFile(path.join(destinationDir, 'old.txt'), 'utf8'), 'old');
  });
});

test('network failure and cancellation retain the previous install', async () => {
  await withTempDir(async directory => {
    const destinationDir = path.join(directory, 'site');
    await fs.mkdir(destinationDir);
    await fs.writeFile(path.join(destinationDir, 'old.txt'), 'still available');
    await assert.rejects(downloadArchive({
      sourceUrl: 'https://files.example.test/package.zip', destinationDir,
      fetchImpl: async () => { throw new Error('offline'); },
    }), /offline/);
    const abortController = new AbortController();
    const archive = makeZip([{ name: 'bundle/index.html', data: 'new' }]);
    await assert.rejects(downloadArchive({
      sourceUrl: 'https://files.example.test/package.zip', destinationDir,
      signal: abortController.signal,
      fetchImpl: async url => response(archive, url),
      onProgress: () => abortController.abort(),
    }), /abort/i);
    assert.equal(await fs.readFile(path.join(destinationDir, 'old.txt'), 'utf8'), 'still available');
  });
});

test('resolves a GitHub default branch to its exact commit before downloading codeload', { skip: !hasYauzl }, async () => {
  await withTempDir(async (directory) => {
    const sha = '09f10f5b58fab8a9ae9e8df214da37271290b13e';
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/repos/example/project')) return new Response(JSON.stringify({ default_branch: 'main' }));
      if (url.endsWith('/branches/main')) return new Response(JSON.stringify({ commit: { sha } }));
      assert.match(url, new RegExp(`/legacy\\.zip/${sha}$`));
      return response(makeZip([{ name: 'project/index.html', data: 'ok' }]), url);
    };
    const result = await downloadArchive({
      sourceUrl: 'https://github.com/example/project', destinationDir: path.join(directory, 'site'), fetchImpl,
    });
    assert.equal(result.version, sha);
    assert.equal(calls.length, 3);
    assert.equal(await fs.readFile(path.join(directory, 'site/index.html'), 'utf8'), 'ok');
  });
});

test('installs a valid archive, strips one wrapper folder, and records provenance', { skip: !hasYauzl }, async () => {
  await withTempDir(async (directory) => {
    const destinationDir = path.join(directory, 'site');
    const sourceUrl = 'https://files.example.test/package.zip';
    const zip = makeZip([
      { name: 'bundle/' },
      { name: 'bundle/index.html', data: '<h1>offline</h1>' },
      { name: 'bundle/LICENSE', data: 'MIT' },
      { name: 'bundle/src/app.js', data: 'console.log("ok")' },
    ]);
    const progress = [];
    const result = await downloadArchive({
      sourceUrl, destinationDir, entryPath: 'index.html', onProgress: (value) => progress.push(value),
      fetchImpl: async (url) => response(zip, url),
    });
    assert.equal(await fs.readFile(path.join(destinationDir, 'index.html'), 'utf8'), '<h1>offline</h1>');
    assert.equal(await fs.readFile(path.join(destinationDir, 'LICENSE'), 'utf8'), 'MIT');
    assert.equal(await fs.readFile(path.join(destinationDir, 'src/app.js'), 'utf8'), 'console.log("ok")');
    assert.equal(result.sourceUrl, sourceUrl);
    assert.equal(result.finalUrl, sourceUrl);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.downloadedAt);
    assert.ok(progress.length > 0);
    const persisted = JSON.parse(await fs.readFile(path.join(destinationDir, '.download-metadata.json'), 'utf8'));
    assert.equal(persisted.sha256, result.sha256);
  });
});

test('mirror mode covers repository API, branch API, and ZIP without changing the recorded source', { skip: !hasYauzl }, async () => {
  await withTempDir(async directory => {
    const sha = 'a'.repeat(40);
    const calls = [];
    const sourceUrl = 'https://github.com/example/project';
    const result = await downloadArchive({ sourceUrl, downloadRoute: 'mirror', destinationDir: path.join(directory, 'site'),
      fetchImpl: async url => {
        calls.push(url);
        assert.ok(url.startsWith('https://gh-proxy.org/https://'));
        if (url.endsWith('/repos/example/project')) return Response.json({ default_branch: 'main' });
        if (url.endsWith('/branches/main')) return Response.json({ commit: { sha } });
        assert.ok(url.endsWith(`/legacy.zip/${sha}`));
        const result = response(makeZip([{ name: 'project/index.html', data: 'mirror-test' }]));
        Object.defineProperty(result, 'url', { value: url });
        return result;
      } });
    assert.equal(calls.length, 3);
    assert.equal(result.sourceUrl, sourceUrl);
    assert.equal(result.version, sha);
    assert.equal(result.downloadRoute, 'mirror');
    assert.ok(result.finalUrl.startsWith('https://gh-proxy.org/'));
    assert.equal(await fs.readFile(path.join(directory, 'site/index.html'), 'utf8'), 'mirror-test');
  });
});
