import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNewItems } from '../scripts/lib/favorites.js';

const items = [
  { id: '1', title: 'a' },
  { id: '2', title: 'b' },
  { id: '3', title: 'c' },
  { id: '4', title: 'd' },
  { id: '5', title: 'e' },
];

test('pickNewItems 跳过账本里已扫描的 id', () => {
  const picked = pickNewItems(items, new Set(['1', '2']), new Map(), 10);
  assert.deepEqual(picked.map((item) => item.id), ['3', '4', '5']);
});

test('pickNewItems 跳过本次已收集的 id', () => {
  const collected = new Map([['3', { id: '3' }]]);
  const picked = pickNewItems(items, new Set(), collected, 10);
  assert.deepEqual(picked.map((item) => item.id), ['1', '2', '4', '5']);
});

test('pickNewItems 遵守单批剩余配额', () => {
  const picked = pickNewItems(items, new Set(['1']), new Map(), 2);
  assert.deepEqual(picked.map((item) => item.id), ['2', '3']);
});

test('pickNewItems 配额用尽时返回空数组', () => {
  assert.deepEqual(pickNewItems(items, new Set(), new Map(), 0), []);
});
