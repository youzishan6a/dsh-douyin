import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOlderThan } from '../src/age.js';

const now = new Date('2026-11-12T00:00:00Z');

test('selectOlderThan 按发布时间分组', () => {
  const items = [
    { id: 'old', publishAt: '2025-01-01T00:00:00Z' },
    { id: 'new', publishAt: '2026-11-01T00:00:00Z' },
    { id: 'unknown', publishAt: null },
  ];
  const result = selectOlderThan(items, { olderThanDays: 100, ageBasis: 'publish', now });
  assert.deepEqual(result.eligible.map((item) => item.id), ['old']);
  assert.deepEqual(result.newer.map((item) => item.id), ['new']);
  assert.deepEqual(result.unknown.map((item) => item.id), ['unknown']);
});

test('selectOlderThan 按首次扫描时间分组并计算天数', () => {
  const items = [
    { id: 'a', firstSeenAt: '2026-10-01T00:00:00Z' },
    { id: 'b', firstSeenAt: '2026-11-10T00:00:00Z' },
  ];
  const result = selectOlderThan(items, { olderThanDays: 30, ageBasis: 'firstSeen', now });
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].id, 'a');
  assert.equal(result.eligible[0].ageDays, 42);
});

test('selectOlderThan 结果按最老优先排序', () => {
  const items = [
    { id: 'mid', publishAt: '2025-06-01T00:00:00Z' },
    { id: 'oldest', publishAt: '2024-01-01T00:00:00Z' },
  ];
  const result = selectOlderThan(items, { olderThanDays: 30, ageBasis: 'publish', now });
  assert.deepEqual(result.eligible.map((item) => item.id), ['oldest', 'mid']);
});

test('selectOlderThan 截止时间正确', () => {
  const result = selectOlderThan([], { olderThanDays: 10, ageBasis: 'publish', now });
  assert.equal(result.cutoffIso, '2026-11-02T00:00:00.000Z');
});
