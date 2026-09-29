'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const i18n = require('../src/i18n');

test('system language follows Chinese locales and defaults to English otherwise', () => {
  assert.equal(i18n.resolveLocale('system', 'zh-CN'), 'zh-CN');
  assert.equal(i18n.resolveLocale('system', 'zh-TW'), 'zh-CN');
  assert.equal(i18n.resolveLocale('system', 'fr-FR'), 'en');
  assert.equal(i18n.resolveLocale(undefined, 'en-US'), 'en');
  assert.equal(i18n.resolveLocale('invalid', 'zh_HK'), 'zh-CN');
  assert.equal(i18n.resolveLocale('en', 'zh-CN'), 'en');
  assert.equal(i18n.resolveLocale('zh-CN', 'en-US'), 'zh-CN');
});

test('English and Chinese dictionaries have identical keys and interpolation parameters', () => {
  const en = i18n.messages.en;
  const zh = i18n.messages['zh-CN'];
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const parameters = (value) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(en)) {
    assert.deepEqual(parameters(zh[key]), parameters(en[key]), key);
    assert.notEqual(zh[key].trim(), '', key);
    assert.notEqual(en[key].trim(), '', key);
  }
});

test('all static interface translation keys exist', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../ui-prototype/index.html'), 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(i18n.messages.en, match[1]), `Missing key: ${match[1]}`);
  }
});

test('messages and nested log details re-render in the selected language', () => {
  const issue = i18n.serializeError(new Error('Entry file was not found in the archive: index.html'));
  assert.equal(issue.key, 'error.entryNotFound');
  assert.equal(issue.params.path, 'index.html');
  const log = i18n.message('log.downloadFailed', { detail: issue });
  assert.match(i18n.formatMessage('en', log), /Download did not complete:.*index\.html/);
  assert.match(i18n.formatMessage('zh-CN', log), /下载未完成：.*index\.html/);
  assert.equal(i18n.formatMessage('zh-CN', issue, { includeDetail: false }).includes('Entry file'), false);
  assert.match(i18n.formatMessage('zh-CN', issue, { includeDetail: true }), /Entry file was not found/);
});

test('structured errors retain code and raw detail for service IPC', () => {
  const cause = i18n.createError('ENTRY_MISSING', 'error.entryMissing', {}, 'ENOENT index.html');
  const serialized = i18n.serializeError(cause);
  assert.deepEqual(serialized, { code: 'ENTRY_MISSING', key: 'error.entryMissing', params: {}, detail: 'ENOENT index.html' });
  assert.equal(i18n.formatMessage('en', serialized), 'The selected web entry file does not exist.');
  assert.equal(i18n.formatMessage('zh-CN', serialized), '所选网页入口不存在。');
});

test('cancellation is distinct from an unexpected failure', () => {
  const canceled = new Error('This operation was aborted');
  canceled.name = 'AbortError';
  const serialized = i18n.serializeError(canceled);
  assert.equal(serialized.key, 'source.canceled');
  assert.equal(i18n.formatMessage('en', serialized), 'Download canceled');
});
