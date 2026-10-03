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

for (const id of ['shadowMountPlus', 'shadowMountPlusBeta3', 'garlicSaveMgr']) {
  for (const route of ['direct', 'mirror']) {
    test(`${id} rejects corrupted ELF via ${route} without replacing the cache`, async t => {
      const dir = await cacheFixture(t);
      const prior = Buffer.from('previous cache');
      const file = cachePath(dir, id);
      await fs.writeFile(file, prior);
      const corrupt = Buffer.alloc(component(id).size);
      corrupt.set([0x7f, 0x45, 0x4c, 0x46]);
      let requested;
      await assert.rejects(download(dir, id, {
        downloadRoute: route,
        fetchImpl: async url => { requested = url; return new Response(corrupt); },
      }), /checksum mismatch/);
      assert.ok(requested.endsWith(`/releases/download/${component(id).version}/${component(id).asset}`));
      assert.equal(requested.startsWith('https://gh-proxy.org/'), route === 'mirror');
      assert.deepEqual(await fs.readFile(file), prior);
      assert.deepEqual(await fs.readdir(dir), [`${id}.elf`]);
      assert.equal(await inspect(dir, id), null);
    });
  }
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

test('beta3 failure preserves beta2 in its independent cache', async t => {
  const dir = await cacheFixture(t);
  const beta2File = cachePath(dir, 'shadowMountPlus');
  const prior = Buffer.from('existing beta2 cache');
  await fs.writeFile(beta2File, prior);
  await assert.rejects(download(dir, 'shadowMountPlusBeta3', {
    fetchImpl: async () => new Response(Buffer.alloc(component('shadowMountPlusBeta3').size)),
  }), /checksum mismatch/);
  assert.deepEqual(await fs.readFile(beta2File), prior);
  assert.deepEqual(await fs.readdir(dir), ['shadowMountPlus.elf']);
  assert.equal(component('shadowMountPlusBeta3').prerelease, true);
});

test('every downloadable component is exposed by a card or version choice in the shipped interface', async () => {
  const html = await fs.readFile(path.join(__dirname, '../ui-prototype/index.html'), 'utf8');
  const cards = [...html.matchAll(/data-component="([^"]+)"/g)].map(match => match[1]);
  const choices = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map(match => match[1]).filter(id => Object.hasOwn(CATALOG, id));
  assert.deepEqual([...new Set([...cards, ...choices])].sort(), Object.keys(CATALOG).sort());
});
