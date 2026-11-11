import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activeItems, markUnfavorited, mergeItems, readLedger, writeLedger } from '../scripts/lib/store.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-douyin-test-'));
}

test('mergeItems 新增时记录首次出现时间', () => {
  const { items, added } = mergeItems({}, [{ id: '1', url: 'u', title: 't', author: 'a' }], '2026-01-01T00:00:00Z');
  assert.equal(added, 1);
  assert.equal(items['1'].firstSeenAt, '2026-01-01T00:00:00Z');
  assert.equal(items['1'].lastSeenAt, '2026-01-01T00:00:00Z');
});

test('mergeItems 更新时保留 firstSeenAt 与 publishAt', () => {
  const first = mergeItems({}, [{ id: '1', url: 'u', title: '旧标题', publishAt: '2025-01-01T00:00:00Z' }], '2026-01-01T00:00:00Z');
  const second = mergeItems(first.items, [{ id: '1', url: 'u', title: '新标题', publishAt: null }], '2026-02-01T00:00:00Z');
  assert.equal(second.items['1'].title, '新标题');
  assert.equal(second.items['1'].firstSeenAt, '2026-01-01T00:00:00Z');
  assert.equal(second.items['1'].publishAt, '2025-01-01T00:00:00Z');
  assert.equal(second.items['1'].lastSeenAt, '2026-02-01T00:00:00Z');
});

test('mergeItems 再次出现会清掉已取消标记', () => {
  const first = mergeItems({}, [{ id: '1', url: 'u', title: 't' }]);
  first.items['1'].unfavoritedAt = '2026-01-01T00:00:00Z';
  const second = mergeItems(first.items, [{ id: '1', url: 'u', title: 't' }], '2026-03-01T00:00:00Z');
  assert.equal(second.items['1'].unfavoritedAt, undefined);
});

test('activeItems 过滤已取消收藏', () => {
  const { items } = mergeItems({}, [{ id: '1' }, { id: '2' }]);
  const ledger = { version: 1, items };
  markUnfavorited(ledger, ['1'], '2026-01-01T00:00:00Z');
  assert.deepEqual(activeItems(ledger).map((item) => item.id), ['2']);
});

test('写入后可读回，损坏文件回退空账本', () => {
  const dir = tempDir();
  const file = path.join(dir, 'ledger.json');
  writeLedger(file, { version: 1, items: { '1': { id: '1' } } });
  assert.equal(readLedger(file).items['1'].id, '1');

  fs.writeFileSync(file, '{broken');
  assert.deepEqual(readLedger(file).items, {});
});
