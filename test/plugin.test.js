import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTools } from '../src/tools.js';
import { resolveConfig } from '../src/config.js';
import { writeLedger } from '../src/store.js';

const ITEMS = {
  hotpot: {
    id: '1001', url: 'https://www.douyin.com/video/1001', title: '成都火锅探店，本地人才知道',
    author: '吃货小王', publishAt: '2026-01-01T00:00:00Z', firstSeenAt: '2026-06-01T00:00:00Z', duration: '03:21',
  },
  breakfast: {
    id: '1002', url: 'https://www.douyin.com/video/1002', title: '10 分钟快手早餐食谱',
    author: '厨房日记', publishAt: '2026-08-01T00:00:00Z', firstSeenAt: '2026-11-10T00:00:00Z', duration: '01:10',
  },
  phone: {
    id: '1003', url: 'https://www.douyin.com/video/1003', title: '手机评测：这次真的值得买',
    author: '数码实验室', publishAt: '2026-02-01T00:00:00Z', firstSeenAt: '2026-05-01T00:00:00Z', duration: '08:02',
  },
  ad: {
    id: '1004', url: 'https://www.douyin.com/video/1004', title: '火锅底料带货专场',
    author: '带货小李', publishAt: '2025-05-01T00:00:00Z', firstSeenAt: '2026-04-01T00:00:00Z', duration: '00:45',
  },
};

/**
 * 建一个只读写临时目录的插件实例。
 * @param {Record<string, unknown>} [overrides] 需要覆盖的配置。
 * @returns {{config: ReturnType<typeof resolveConfig>, tools: Map<string, any>, dir: string}} 测试上下文。
 */
function setup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-douyin-plugin-'));
  const config = resolveConfig({ dataDir: dir, ...overrides });
  writeLedger(config.ledgerPath, { version: 1, items: ITEMS });
  const tools = new Map(createTools(config).map((tool) => [tool.name, tool]));
  return { config, tools, dir };
}

test('注册六个工具，名称唯一且参数结构合法', () => {
  const { tools } = setup();
  assert.deepEqual([...tools.keys()].sort(), [
    'douyin_check_update',
    'douyin_favorites_scan',
    'douyin_favorites_summarize',
    'douyin_login',
    'douyin_status',
    'douyin_unfavorite_old',
  ]);
  for (const tool of tools.values()) {
    assert.equal(tool.parameters.type, 'object');
    assert.ok(Object.keys(tool.parameters.properties).length > 0);
    assert.ok(tool.output?.schema);
    assert.equal(typeof tool.output.render, 'function');
    assert.equal(typeof tool.execute, 'function');
  }
});

test('douyin_favorites_summarize 按类型筛选并排除带货', async () => {
  const { tools } = setup();
  const tool = tools.get('douyin_favorites_summarize');
  const value = await tool.execute({ types: ['美食'], exclude: '带货' }, {});

  assert.equal(value.activeTotal, 4);
  assert.equal(value.matched, 2);
  assert.equal(value.groups.length, 1);
  assert.equal(value.groups[0].label, '美食');
  assert.deepEqual(value.groups[0].items.map((item) => item.title).sort(), [
    '10 分钟快手早餐食谱',
    '成都火锅探店，本地人才知道',
  ]);

  const text = tool.output.render({}, value)[0].text;
  assert.match(text, /抖音收藏归纳素材/);
  assert.match(text, /筛选后 2 条/);
});

test('douyin_favorites_summarize 支持自定义关键词类型', async () => {
  const { tools } = setup();
  const tool = tools.get('douyin_favorites_summarize');
  const value = await tool.execute({ types: ['评测'] }, {});
  assert.equal(value.matched, 1);
  assert.equal(value.groups[0].items[0].title, '手机评测：这次真的值得买');
});

test('douyin_unfavorite_old 演练模式按首次扫描时间排序', async () => {
  const { tools } = setup();
  const tool = tools.get('douyin_unfavorite_old');
  const value = await tool.execute({ olderThanDays: 100, ageBasis: 'firstSeen', limit: 2 }, {});

  assert.equal(value.mode, 'dryRun');
  assert.equal(value.eligibleCount, 3);
  assert.deepEqual(value.candidates.map((item) => item.id), ['1004', '1003']);
  assert.equal(value.candidates[0].ageDays > value.candidates[1].ageDays, true);

  const text = tool.output.render({}, value)[0].text;
  assert.match(text, /演练模式/);
  assert.match(text, /不会处理/);
});

test('douyin_unfavorite_old 未确认时拒绝执行', async () => {
  const { tools } = setup();
  const tool = tools.get('douyin_unfavorite_old');
  await assert.rejects(
    () => tool.execute({ olderThanDays: 10, ageBasis: 'firstSeen', dryRun: false }, {}),
    /confirm=true/,
  );
});

test('douyin_unfavorite_old 配置禁用后直接拒绝', async () => {
  const { tools } = setup({ allowDestructive: false });
  const tool = tools.get('douyin_unfavorite_old');
  await assert.rejects(() => tool.execute({ olderThanDays: 10 }, {}), /allowDestructive/);
});

test('douyin_status 不打开浏览器也能给出账本概况', async () => {
  const { tools, config } = setup();
  const tool = tools.get('douyin_status');
  const value = await tool.execute({}, {});
  assert.equal(value.total, 4);
  assert.equal(value.active, 4);
  assert.equal(value.withPublishDate, 4);
  assert.equal(value.probed, false);
  assert.equal(value.dataDir, config.dataDir);
});
