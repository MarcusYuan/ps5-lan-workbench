'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { path7za } = require('7zip-bin');
const { extractElf, download, cachePath } = require('../src/components/downloader');
const { component } = require('../src/components/catalog');

test('7z extracts only the selected member and rejects wrong size, missing member and cancellation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'component-archive-'));
  try {
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
    await fs.writeFile(path.join(dir, 'sample.elf'), bytes);
    await fs.writeFile(path.join(dir, 'other.txt'), 'not a payload');
    const archive = path.join(dir, 'fixture.7z');
    execFileSync(path7za, ['a', archive, 'sample.elf', 'other.txt'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
    assert.deepEqual(await extractElf(archive, { asset: 'sample.elf', size: bytes.length }), bytes);
    await assert.rejects(extractElf(archive, { asset: 'sample.elf', size: 4 }), /expected size/);
    await assert.rejects(extractElf(archive, { asset: 'absent.elf', size: 8 }), cause => cause.code === 'COMPONENT_EXTRACT_FAILED');
    await assert.rejects(extractElf(archive, { asset: 'sample.elf', size: 8 }, AbortSignal.abort()), { name: 'AbortError' });
    const controller = new AbortController();
    const pending = extractElf(archive, { asset: 'sample.elf', size: 8 }, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('invalid GBAtemp attachment preserves cache and removes temporary download files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'component-cache-'));
  try {
    const prior = Buffer.from('previous cache');
    await fs.writeFile(cachePath(dir, 'kstuffLite'), prior);
    let requested;
    await assert.rejects(download(dir, 'kstuffLite', { downloadRoute: 'mirror', fetchImpl: async url => {
      requested = url;
      return new Response(Buffer.alloc(component('kstuffLite').archive.size));
    } }), /checksum mismatch/);
    assert.equal(requested, component('kstuffLite').url);
    assert.deepEqual(await fs.readFile(cachePath(dir, 'kstuffLite')), prior);
    assert.deepEqual(await fs.readdir(dir), ['kstuffLite.elf']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
