import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyItem, filterItems, groupByCategory, normalizeTypes } from '../src/classify.js';
import { splitExcludeKeywords, matchExclude } from '../src/text.js';

test('classifyItem 识别常见类型', () => {
  assert.equal(classifyItem({ title: '成都火锅探店，太好吃了' }).type, 'food');
  assert.equal(classifyItem({ title: 'iPhone 17 评测：这次值得买吗' }).type, 'tech');
  assert.equal(classifyItem({ title: '新手减脂训练计划' }).type, 'fitness');
  assert.equal(classifyItem({ title: '完全无关的一句话' }).type, 'other');
});

test('normalizeTypes 支持 id、中文名与自定义关键词', () => {
  const { ids, keywords } = normalizeTypes(['food', '旅行', '带货']);
  assert.deepEqual([...ids].sort(), ['food', 'travel']);
  assert.deepEqual(keywords, ['带货']);
});

test('filterItems 按类型筛选', () => {
  const items = [
    { id: '1', title: '火锅探店' },
    { id: '2', title: '手机评测' },
  ];
  const result = filterItems(items, { types: ['美食'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
  assert.equal(result[0].categoryLabel, '美食');
});

test('filterItems 支持排除词', () => {
  const items = [
    { id: '1', title: '露营装备清单' },
    { id: '2', title: '露营装备带货专场' },
  ];
  const result = filterItems(items, {
    types: [],
    excludeKeywords: splitExcludeKeywords('带货'),
    excludeMatcher: matchExclude,
  });
  assert.deepEqual(result.map((item) => item.id), ['1']);
});

test('groupByCategory 按数量倒序并截断', () => {
  const items = [
    { id: '1', title: '火锅', category: 'food', categoryLabel: '美食' },
    { id: '2', title: '烧烤', category: 'food', categoryLabel: '美食' },
    { id: '3', title: '手机', category: 'tech', categoryLabel: '科技数码' },
  ];
  const groups = groupByCategory(items, 1);
  assert.equal(groups[0].label, '美食');
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].items.length, 1);
});
