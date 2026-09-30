'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { download, inspect, cachePath } = require('../src/components/downloader');
const { component, CATALOG } = require('../src/components/catalog');

async function cacheFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps5-shadowmount-test-'));
  t.after(async () => {
    for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
    await fs.rmdir(dir);
  });
  return dir;
}

for (const route of ['direct', 'mirror']) {
  test(`ShadowMountPlus rejects corrupted ELF via ${route} without replacing the cache`, async t => {
    const dir = await cacheFixture(t);
    const prior = Buffer.from('previous cache');
    const file = cachePath(dir, 'shadowMountPlus');
    await fs.writeFile(file, prior);
    const corrupt = Buffer.alloc(component('shadowMountPlus').size);
    corrupt.set([0x7f, 0x45, 0x4c, 0x46]);
    let requested;
    await assert.rejects(download(dir, 'shadowMountPlus', {
      downloadRoute: route,
      fetchImpl: async url => { requested = url; return new Response(corrupt); },
    }), /checksum mismatch/);
    assert.ok(requested.endsWith('/releases/download/1.7beta2/shadowmountplus.elf'));
    assert.equal(requested.startsWith('https://gh-proxy.org/'), route === 'mirror');
    assert.deepEqual(await fs.readFile(file), prior);
    assert.deepEqual(await fs.readdir(dir), ['shadowMountPlus.elf']);
    assert.equal(await inspect(dir, 'shadowMountPlus'), null);
  });
}

test('canceling a ShadowMountPlus download removes the temporary file and retains the cache', async t => {
  const dir = await cacheFixture(t);
  const file = cachePath(dir, 'shadowMountPlus');
  const prior = Buffer.from('previous cache');
  await fs.writeFile(file, prior);
  const abort = new AbortController();
  await assert.rejects(download(dir, 'shadowMountPlus', {
    signal: abort.signal,
    fetchImpl: async () => { abort.abort(); return new Response(Buffer.alloc(32)); },
  }), cause => cause.name === 'AbortError');
  assert.deepEqual(await fs.readFile(file), prior);
  assert.deepEqual(await fs.readdir(dir), ['shadowMountPlus.elf']);
});

test('every downloadable component is exposed by the shipped interface', async () => {
  const html = await fs.readFile(path.join(__dirname, '../ui-prototype/index.html'), 'utf8');
  const cards = [...html.matchAll(/data-component="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(cards.slice().sort(), Object.keys(CATALOG).sort());
});
