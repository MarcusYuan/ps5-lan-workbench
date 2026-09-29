'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sfoDetails(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46535000) return {};
  const keys = bytes.readUInt32LE(8);
  const values = bytes.readUInt32LE(12);
  const count = Math.min(bytes.readUInt32LE(16), 4096);
  const found = {};
  for (let index = 0; index < count && 36 + index * 16 <= bytes.length; index++) {
    const entry = 20 + index * 16;
    const keyOffset = keys + bytes.readUInt16LE(entry);
    const valueOffset = values + bytes.readUInt32LE(entry + 12);
    const length = bytes.readUInt32LE(entry + 4);
    if (keyOffset >= bytes.length || length > 4096 || valueOffset + length > bytes.length) continue;
    const end = bytes.indexOf(0, keyOffset);
    if (end < 0) continue;
    found[bytes.subarray(keyOffset, end).toString('utf8')] =
      bytes.subarray(valueOffset, valueOffset + length).toString('utf8').split('\0')[0];
  }
  return { title_name: found.TITLE || '', title_id: found.TITLE_ID || '',
    app_version: found.APP_VER || found.VERSION || '', category: found.CATEGORY || '' };
}

async function selectPkg(filePath) {
  if (typeof filePath !== 'string' || !/\.pkg$/i.test(filePath)) throw Object.assign(new Error('Choose a .pkg file'), { code: 'INVALID_PKG_FILE' });
  const absolute = path.resolve(filePath);
  const stat = await fs.promises.stat(absolute);
  if (!stat.isFile() || stat.size < 128) throw Object.assign(new Error('Package is empty or not a file'), { code: 'INVALID_PKG_FILE' });
  const handle = await fs.promises.open(absolute, 'r');
  try {
    const read = async (offset, size) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || size > 262144 || offset + size > stat.size)
        throw Object.assign(new Error('Invalid package metadata offset'), { code: 'INVALID_PKG_FORMAT' });
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, offset);
      if (bytesRead !== size) throw Object.assign(new Error('Package changed during reading'), { code: 'PKG_CHANGED' });
      return buffer;
    };
    const first = await read(0, Math.min(stat.size, 512));
    const magic = first.subarray(0, 4).toString('latin1');
    let cnt = 0;
    if (magic === '\x7fFIH') cnt = first.readUInt32LE(0x58) + first.readUInt32LE(0x5c) * 0x100000000;
    else if (magic !== '\x7fCNT') throw Object.assign(new Error('Unsupported package format'), { code: 'INVALID_PKG_FORMAT' });
    const header = await read(cnt, 128);
    if (header.subarray(0, 4).toString('latin1') !== '\x7fCNT') throw Object.assign(new Error('CNT header missing'), { code: 'INVALID_PKG_FORMAT' });
    const count = header.readUInt32BE(0x10);
    const cntType = header.readUInt32BE(0x04);
    const tableOffset = header.readUInt32BE(0x18);
    if (!count || count > 2048 || tableOffset > 0x200000) throw Object.assign(new Error('Invalid package table'), { code: 'INVALID_PKG_FORMAT' });
    const table = await read(cnt + tableOffset, count * 32);
    const contentId = header.subarray(0x40, 0x70).toString('utf8').split('\0')[0];
    const meta = { title_name: '', title_id: '', app_version: '', pkg_type: 'base', content_id: contentId };
    let category = '';
    let hasPs4SfoCategory = false;
    let hasBaseAppMetadata = false;
    let stringTable = null;
    const rows = [];
    for (let index = 0; index < count; index++) {
      const offset = index * 32;
      const row = { type: table.readUInt32BE(offset), nameOffset: table.readUInt32BE(offset + 4),
        offset: table.readUInt32BE(offset + 16), size: table.readUInt32BE(offset + 20) };
      rows.push(row);
      if (row.type === 0x0200 && row.size < 65536) stringTable = await read(cnt + row.offset, row.size);
    }
    for (const row of rows) {
      const name = stringTable && row.nameOffset < stringTable.length ?
        stringTable.subarray(row.nameOffset).toString('utf8').split('\0')[0] : '';
      if ((row.type === 0x2000 || name === 'param.json') && row.size > 0 && row.size < 262144) {
        try {
          const data = JSON.parse((await read(cnt + row.offset, row.size)).toString('utf8').split('\0')[0]);
          const localized = data.localizedParameters || {};
          const preferred = localized.en_US || localized.en || Object.values(localized).find(value => value?.titleName) || {};
          meta.title_name = data.titleName || data.title || preferred.titleName || meta.title_name;
          meta.title_id = data.titleId || meta.title_id;
          meta.app_version = data.contentVersion || data.appVersion || data.version || meta.app_version;
          category = data.category || category;
          hasBaseAppMetadata = ['applicationDrmType', 'applicationCategoryType', 'contentBadgeType']
            .some(key => Object.prototype.hasOwnProperty.call(data, key));
        } catch { /* use other metadata entries */ }
      } else if ((row.type === 0x1000 || name === 'param.sfo') && row.size > 0 && row.size < 262144) {
        const details = sfoDetails(await read(cnt + row.offset, row.size));
        for (const key of ['title_name', 'title_id', 'app_version']) if (!meta[key]) meta[key] = details[key];
        if (!category && details.category) { category = details.category; hasPs4SfoCategory = true; }
      }
      if ([0x1008, 0x0407, 0x0408].includes(row.type)) meta.pkg_type = 'update';
    }
    if (meta.pkg_type !== 'update' && category.startsWith('gp')) meta.pkg_type = 'update';
    else if (meta.pkg_type !== 'update' && (category.startsWith('ac') || category.startsWith('al'))) meta.pkg_type = 'dlc';
    else if (meta.pkg_type !== 'update' && !hasPs4SfoCategory && (cntType & 0xff) === 1 && !hasBaseAppMetadata)
      meta.pkg_type = 'dlc';
    if (!meta.title_id) meta.title_id = contentId.match(/-([^_]+)_/)?.[1] || '';
    if (!meta.title_name) meta.title_name = meta.title_id || path.basename(absolute);
    if (meta.app_version && !/^v/i.test(meta.app_version)) meta.app_version = `v${meta.app_version}`;
    if (!meta.title_id || !['base', 'update', 'dlc'].includes(meta.pkg_type))
      throw Object.assign(new Error('Package metadata is incomplete'), { code: 'INVALID_PKG_FORMAT' });
    return { fileId: crypto.randomUUID(), name: path.basename(absolute), size: stat.size,
      mtimeMs: stat.mtimeMs, path: absolute, details: meta };
  } finally { await handle.close(); }
}

async function assertUnchanged(selected) {
  const stat = await fs.promises.stat(selected.path);
  if (!stat.isFile() || stat.size !== selected.size || stat.mtimeMs !== selected.mtimeMs)
    throw Object.assign(new Error('Package file changed since selection'), { code: 'PKG_CHANGED' });
}

function publicFile(selected) {
  if (!selected) return null;
  const { fileId, name, size, details } = selected;
  return { fileId, name, size, details };
}

module.exports = { selectPkg, assertUnchanged, publicFile };
