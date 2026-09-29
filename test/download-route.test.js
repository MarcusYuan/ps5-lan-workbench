'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { downloadUrl, createDownloadFetch, MIRROR_ORIGIN } = require('../src/core/download-route');
const components = require('../src/components/downloader');

test('mirror routes only public GitHub URLs and keeps direct mode unchanged', () => {
  for (const host of ['github.com', 'api.github.com', 'codeload.github.com']) {
    const url = `https://${host}/owner/repo`;
    assert.equal(downloadUrl(url, 'mirror'), `${MIRROR_ORIGIN}/${url}`);
    assert.equal(downloadUrl(url, 'direct'), url);
  }
  for (const url of ['https://files.example/a.zip', 'https://github.com.evil.test/a.zip',
    'https://github.com/a/b.zip?token=secret', 'https://user:secret@github.com/a/b.zip',
    'http://github.com/a/b.zip', 'https://github.com:8443/a/b.zip',
    `${MIRROR_ORIGIN}/https://github.com/a/b.zip`]) {
    assert.equal(downloadUrl(url, 'mirror'), url);
  }
});

test('route is captured per task and mirror requests omit sensitive headers', async () => {
  let preference = 'mirror';
  const calls = [];
  const taskFetch = createDownloadFetch(preference, async (url, options) => {
    calls.push({ url, options }); return new Response('{}');
  });
  preference = 'direct';
  await taskFetch('https://api.github.com/repos/a/b', { headers: { Authorization: 'test-only', Cookie: 'test-only', Accept: 'application/json' } });
  assert.equal(preference, 'direct');
  assert.ok(calls[0].url.startsWith(MIRROR_ORIGIN));
  assert.equal(calls[0].options.headers.get('authorization'), null);
  assert.equal(calls[0].options.headers.get('cookie'), null);
  assert.equal(calls[0].options.headers.get('accept'), 'application/json');
  assert.equal(calls[0].options.credentials, 'omit');
});

test('mirror rejects unsafe redirects before fetching them and preserves cancellation', async () => {
  for (const location of ['http://github.com/a', 'https://evil.test/a', 'https://u:p@github.com/a', 'https://gh-proxy.org:8443/a']) {
    let calls = 0;
    const fetch = createDownloadFetch('mirror', async () => {
      calls++; return new Response(null, { status: 302, headers: { location } });
    });
    await assert.rejects(fetch('https://github.com/a/b.zip'), { code: 'MIRROR_DOWNLOAD_FAILED' });
    assert.equal(calls, 1);
  }
  const canceled = new DOMException('Canceled', 'AbortError');
  await assert.rejects(createDownloadFetch('mirror', async () => { throw canceled; })('https://github.com/a/b.zip'), e => e === canceled);
});

test('mirror accepts known HTTPS redirects, limits loops, and reports HTTP errors without silently falling back', async () => {
  let calls = 0;
  const fetch = createDownloadFetch('mirror', async url => {
    calls++;
    return calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } }) : new Response('ok');
  });
  assert.equal(await (await fetch('https://github.com/a/b.zip')).text(), 'ok');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(createDownloadFetch('mirror', async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://gh-proxy.org/loop' } });
  })('https://github.com/a/b.zip'), { code: 'MIRROR_DOWNLOAD_FAILED' });
  assert.equal(calls, 6);
  calls = 0;
  await assert.rejects(createDownloadFetch('mirror', async () => {
    calls++; return new Response('unavailable', { status: 503 });
  })('https://github.com/a/b.zip'), { code: 'MIRROR_DOWNLOAD_FAILED' });
  assert.equal(calls, 1);
});

test('mirrored component checksum failure preserves the previous cache', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mirror-component-test-'));
  try {
    const file = components.cachePath(dir, 'pkgManager');
    await fs.writeFile(file, 'previous-cache');
    await assert.rejects(components.download(dir, 'pkgManager', { downloadRoute: 'mirror', fetchImpl: async url => {
      assert.ok(url.startsWith(`${MIRROR_ORIGIN}/https://github.com/`));
      const response = new Response(Buffer.alloc(1939016));
      Object.defineProperty(response, 'url', { value: url });
      return response;
    } }), /checksum mismatch/);
    assert.equal(await fs.readFile(file, 'utf8'), 'previous-cache');
    assert.deepEqual(await fs.readdir(dir), ['pkgManager.elf']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
