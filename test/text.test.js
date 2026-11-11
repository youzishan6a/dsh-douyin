import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, parseDateText, splitExcludeKeywords, matchExclude, normalizeText } from '../src/text.js';

test('normalizeText 去掉零宽字符并压缩空白', () => {
  assert.equal(normalizeText('  a\u200b b\n c '), 'a b c');
  assert.equal(normalizeText(null), '');
});

test('parseCount 解析万/w/k', () => {
  assert.equal(parseCount('1.2万'), 12_000);
  assert.equal(parseCount('3.4w'), 34_000);
  assert.equal(parseCount('12,345'), 12_345);
  assert.equal(parseCount(''), null);
});

test('parseDateText 解析绝对日期', () => {
  const iso = parseDateText('2023年5月1日');
  assert.equal(new Date(iso).getFullYear(), 2023);
  assert.equal(new Date(iso).getMonth(), 4);
});

test('parseDateText 解析相对时间', () => {
  const now = new Date('2026-11-12T00:00:00Z');
  const iso = parseDateText('3天前', now);
  assert.equal(new Date(iso).toISOString().slice(0, 10), '2026-11-09');
});

test('parseDateText 遇到无关文本返回 null', () => {
  assert.equal(parseDateText('1.2万点赞'), null);
});

test('splitExcludeKeywords 拆自然语言', () => {
  assert.deepEqual(splitExcludeKeywords('不要总结带货和直播切片'), ['带货', '直播切片']);
  assert.deepEqual(splitExcludeKeywords('除了 游戏、明星八卦'), ['游戏', '明星八卦']);
  assert.deepEqual(splitExcludeKeywords(''), []);
});

test('matchExclude 命中标题或作者', () => {
  const keywords = splitExcludeKeywords('带货');
  assert.equal(matchExclude({ title: '直播带货翻车' }, keywords), '带货');
  assert.equal(matchExclude({ title: '露营装备', author: '带货小王' }, keywords), '带货');
  assert.equal(matchExclude({ title: '露营装备' }, keywords), null);
});
