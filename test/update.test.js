import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, fetchRepoFile, parseVersion, runUpdate } from '../src/update.js';

/**
 * 构造一个按路径返回固定内容的 fetch。
 * @param {Record<string, string>} files 文件名到内容。
 * @param {{api?:boolean}} [options] api=false 时模拟 API 不可用，只走 raw 兜底。
 * @returns {Function} fetch 实现。
 */
function fakeFetch(files, { api = true } = {}) {
  return async (url) => {
    const pathname = decodeURIComponent(new URL(url).pathname);
    if (!api && pathname.startsWith('/repos/')) {
      return { ok: false, status: 403, text: async () => '' };
    }
    for (const [file, body] of Object.entries(files)) {
      if (pathname.endsWith(`/${file}`)) {
        return { ok: true, status: 200, text: async () => body };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

/**
 * 建一个临时插件目录。
 * @param {{version?:string, lib?:string}} [options] 初始内容。
 * @returns {string} 目录。
 */
function makePkg({ version = '0.2.0', lib = '// old build\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-douyin-update-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-douyin', version }, null, 2));
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), lib);
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '- insert: []\n');
  return dir;
}

const remotePkg = (version) => JSON.stringify({ name: 'dsh-douyin', version });
const remoteLib = `// dsh-douyin ${'x'.repeat(60_000)}`;

test('parseVersion 解析正式版与预发布版', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
  assert.deepEqual(parseVersion('1.2.3-rc.1'), { major: 1, minor: 2, patch: 3, pre: ['rc', '1'] });
  assert.equal(parseVersion('abc'), null);
});

test('compareVersions 处理主版本、补丁与预发布', () => {
  assert.equal(compareVersions('0.3.0', '0.2.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.2.0-rc.1', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.0', '0.2.0-rc.2'), 1);
});

test('runUpdate 相等版本返回 up-to-date', async () => {
  const dir = makePkg({ version: '0.3.0' });
  const value = await runUpdate({
    pkgRoot: dir,
    fetchImpl: fakeFetch({ 'package.json': remotePkg('0.3.0') }),
  });
  assert.equal(value.status, 'up-to-date');
  assert.equal(value.applied, false);
});

test('runUpdate 只检查时返回 update-available 且不改文件', async () => {
  const dir = makePkg({ version: '0.2.0' });
  const value = await runUpdate({
    pkgRoot: dir,
    fetchImpl: fakeFetch({ 'package.json': remotePkg('0.3.0') }),
  });
  assert.equal(value.status, 'update-available');
  assert.equal(value.latestVersion, '0.3.0');
  assert.match(fs.readFileSync(path.join(dir, 'lib', 'index.js'), 'utf8'), /old build/);
});

test('runUpdate 应用更新会替换文件并保留备份', async () => {
  const dir = makePkg({ version: '0.2.0' });
  const value = await runUpdate({
    pkgRoot: dir,
    apply: true,
    fetchImpl: fakeFetch({
      'package.json': remotePkg('0.3.0'),
      'cordis.patch.yml': '- insert: [{ id: x }]\n',
      'lib/index.js': remoteLib,
    }),
  });
  assert.equal(value.status, 'updated');
  assert.equal(value.restartRequired, true);
  assert.deepEqual(value.updatedFiles.sort(), ['cordis.patch.yml', 'lib/index.js', 'package.json']);

  assert.match(fs.readFileSync(path.join(dir, 'lib', 'index.js'), 'utf8'), /^\/\/ dsh-douyin/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.3.0');

  const backups = fs.readdirSync(path.join(dir, 'lib')).filter((name) => name.includes('.bak.'));
  assert.equal(backups.length, 1);
});

test('fetchRepoFile 给 Contents API 地址加缓存破除参数', async () => {
  let seen = '';
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  assert.equal(await fetchRepoFile(fetchImpl, 'package.json'), 'ok');
  const parsed = new URL(seen);
  assert.match(parsed.pathname, /\/contents\/package\.json$/);
  assert.equal(parsed.searchParams.get('ref'), 'main');
  assert.match(parsed.searchParams.get('t') ?? '', /^\d+$/);
});

test('GitHub API 不可用时退回 raw 地址', async () => {
  const dir = makePkg({ version: '0.2.0' });
  const value = await runUpdate({
    pkgRoot: dir,
    fetchImpl: fakeFetch({ 'package.json': remotePkg('0.3.0') }, { api: false }),
  });
  assert.equal(value.status, 'update-available');
  assert.equal(value.latestVersion, '0.3.0');
});

test('远端 lib 校验失败时中止且不改本地文件', async () => {
  const dir = makePkg({ version: '0.2.0' });
  await assert.rejects(() => runUpdate({
    pkgRoot: dir,
    apply: true,
    fetchImpl: fakeFetch({
      'package.json': remotePkg('0.3.0'),
      'cordis.patch.yml': '- insert: []\n',
      'lib/index.js': 'too small',
    }),
  }), /校验失败/);
  assert.match(fs.readFileSync(path.join(dir, 'lib', 'index.js'), 'utf8'), /old build/);
});
