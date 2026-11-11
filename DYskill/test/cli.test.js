import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeLedger } from '../scripts/lib/store.js';

const CLI = fileURLToPath(new URL('../scripts/douyin.mjs', import.meta.url));
const ROOT = path.dirname(path.dirname(CLI));

/**
 * 生成 n 天前的 ISO 时间。
 * @param {number} days 天数。
 * @returns {string} ISO 时间。
 */
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * 建临时数据目录并写入账本。
 * @returns {string} 数据目录。
 */
function setupData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-skill-'));
  writeLedger(path.join(dir, 'ledger.json'), {
    version: 1,
    items: {
      1001: {
        id: '1001', url: 'https://www.douyin.com/video/1001', title: '成都火锅探店，本地人才知道',
        author: '吃货小王', publishAt: daysAgo(300), firstSeenAt: daysAgo(200), duration: '03:21',
      },
      1002: {
        id: '1002', url: 'https://www.douyin.com/video/1002', title: '10 分钟快手早餐食谱',
        author: '厨房日记', publishAt: daysAgo(90), firstSeenAt: daysAgo(10), duration: '01:10',
      },
      1003: {
        id: '1003', url: 'https://www.douyin.com/video/1003', title: '手机评测：这次真的值得买',
        author: '数码实验室', publishAt: daysAgo(250), firstSeenAt: daysAgo(150), duration: '08:02',
      },
      1004: {
        id: '1004', url: 'https://www.douyin.com/video/1004', title: '火锅底料带货专场',
        author: '带货小李', publishAt: daysAgo(500), firstSeenAt: daysAgo(300), duration: '00:45',
      },
    },
  });
  return dir;
}

/**
 * 执行 CLI。
 * @param {string[]} args 参数。
 * @returns {{status:number, stdout:string, stderr:string}} 执行结果。
 */
function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('summarize 按类型筛选并排除带货', () => {
  const dir = setupData();
  const result = run(['summarize', '--types', '美食', '--exclude', '带货', '--json', '--data-dir', dir]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.activeTotal, 4);
  assert.equal(value.matched, 2);
  assert.equal(value.groups.length, 1);
  assert.equal(value.groups[0].label, '美食');
  assert.deepEqual(value.groups[0].items.map((item) => item.title).sort(), [
    '10 分钟快手早餐食谱',
    '成都火锅探店，本地人才知道',
  ]);
});

test('summarize 文本输出包含归纳提示', () => {
  const dir = setupData();
  const result = run(['summarize', '--types', '美食', '--data-dir', dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /抖音收藏归纳素材/);
  assert.match(result.stdout, /不要补充未列出的视频/);
});

test('unfavorite 默认演练并按首次扫描时间排序', () => {
  const dir = setupData();
  const result = run(['unfavorite', '--older-than-days', '100', '--age-basis', 'firstSeen', '--limit', '2', '--json', '--data-dir', dir]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.mode, 'dryRun');
  assert.equal(value.eligibleCount, 3);
  assert.deepEqual(value.candidates.map((item) => item.id), ['1004', '1001']);
  assert.equal(value.unknownAgeCount, 0);
});

test('unfavorite --execute 缺少 --confirm 时拒绝执行', () => {
  const dir = setupData();
  const result = run(['unfavorite', '--older-than-days', '10', '--age-basis', 'firstSeen', '--execute', '--json', '--data-dir', dir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--confirm/);
});

test('status 不打开浏览器也能给出账本概况', () => {
  const dir = setupData();
  const result = run(['status', '--json', '--data-dir', dir]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.total, 4);
  assert.equal(value.active, 4);
  assert.equal(value.probed, false);
  assert.equal(value.dataDir, path.resolve(dir));
});

test('未知命令返回非零退出码并打印帮助', () => {
  const result = run(['nope']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未知命令/);
});

test('帮助列出 update 命令与 --check-only', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /update\s+检查 GitHub/);
  assert.match(result.stdout, /--check-only/);
});

test('update --help 只打印帮助，不发起网络请求', () => {
  const result = run(['update', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /检查 GitHub 上的新版本/);
  assert.doesNotMatch(result.stderr, /检查更新失败/);
});
