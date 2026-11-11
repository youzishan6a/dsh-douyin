import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UPDATE_FILES,
  compareVersions,
  fetchRepoFile,
  parseVersion,
  resolveSkillRoot,
  runUpdate,
} from '../scripts/lib/update.js';
import { update as renderUpdate } from '../scripts/lib/report.js';

/** 本文件创建的临时技能目录，测试结束后统一删除。 */
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 生成一套完整的远端文件。
 * @param {string} version 远端版本号。
 * @param {(file:string, body:string)=>string} [mutate] 可替换某个文件的内容。
 * @returns {Record<string, string>} 文件名到内容。
 */
function remoteFiles(version, mutate = (_file, body) => body) {
  const base = {
    'package.json': JSON.stringify({ name: 'dy-skill', version }, null, 2),
    'package-lock.json': JSON.stringify({ name: 'dy-skill', version, lockfileVersion: 3 }),
    'scripts/douyin.mjs': `// 抖音收藏管理\n// ${'x'.repeat(11_000)}\n`,
  };
  for (const file of UPDATE_FILES) {
    if (base[file] === undefined) base[file] = `// ${file} new\n`;
  }
  return Object.fromEntries(Object.entries(base).map(([file, body]) => [file, mutate(file, body)]));
}

/**
 * 构造按仓库路径返回固定内容的 fetch。
 * @param {Record<string, string>} files 文件名到内容。
 * @param {{api?:boolean, secondManifest?:string}} [options] api=false 模拟 GitHub API 不可用；
 *   secondManifest 用于模拟「检查时一个版本、下载时另一个版本」。
 * @returns {Function} fetch 实现。
 */
function fakeFetch(files, { api = true, secondManifest } = {}) {
  let manifestCalls = 0;
  return async (url) => {
    const pathname = decodeURIComponent(new URL(url).pathname);
    if (!api && pathname.startsWith('/repos/')) {
      return { ok: false, status: 403, text: async () => '' };
    }
    if (pathname.endsWith('/package.json')) {
      const body = manifestCalls === 0 ? files['package.json'] : (secondManifest ?? files['package.json']);
      manifestCalls += 1;
      return { ok: true, status: 200, text: async () => body };
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
 * 建一个临时技能目录，含旧版清单、入口和一个「账本」以验证不会被误改。
 * @param {string} version 本地版本。
 * @returns {string} 目录。
 */
function makeSkill(version = '0.2.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-skill-update-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dy-skill', version }));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'douyin.mjs'), '// old build');
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'update.js'), '// old updater');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# old skill');
  fs.writeFileSync(path.join(dir, 'ledger.json'), '{"personal":"keep me"}');
  fs.writeFileSync(path.join(dir, 'state.json'), '{"cookie":"keep me"}');
  return dir;
}

test('parseVersion 解析正式版与预发布版', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
  assert.deepEqual(parseVersion('1.2.3-rc.1'), { major: 1, minor: 2, patch: 3, pre: ['rc', '1'] });
  assert.equal(parseVersion('abc'), null);
});

test('compareVersions 处理补丁与预发布', () => {
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.3.1-rc.1', '0.3.1'), -1);
});

test('UPDATE_FILES 固定且不含账号数据文件', () => {
  assert.ok(UPDATE_FILES.includes('scripts/lib/update.js'));
  assert.ok(UPDATE_FILES.includes('scripts/douyin.mjs'));
  assert.ok(!UPDATE_FILES.some((file) => file.includes('..') || file.startsWith('/')));
  assert.ok(!UPDATE_FILES.some((file) => /state\.json|ledger\.json|actions\.jsonl/.test(file)));
});

test('resolveSkillRoot 从 CLI 入口推导出技能根目录，而不是仓库根', () => {
  const entry = fileURLToPath(new URL('../scripts/douyin.mjs', import.meta.url));
  const expected = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const root = resolveSkillRoot(entry);
  assert.equal(root, expected);
  assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(root, 'package.json')));
});

test('fetchRepoFile 的地址落在 DYskill 子目录且带缓存破除参数', async () => {
  let seen = '';
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  assert.equal(await fetchRepoFile(fetchImpl, 'package.json'), 'ok');
  const parsed = new URL(seen);
  assert.match(parsed.pathname, /\/contents\/DYskill\/package\.json$/);
  assert.equal(parsed.searchParams.get('ref'), 'main');
  assert.match(parsed.searchParams.get('t') ?? '', /^\d+$/);
});

test('已是最新版本时不改任何文件', async () => {
  const dir = makeSkill('0.3.1');
  const value = await runUpdate({
    pkgRoot: dir,
    apply: true,
    fetchImpl: fakeFetch(remoteFiles('0.3.1')),
  });
  assert.equal(value.status, 'up-to-date');
  assert.equal(value.applied, false);
  assert.match(fs.readFileSync(path.join(dir, 'scripts', 'douyin.mjs'), 'utf8'), /old build/);
});

test('--check-only 只报告新版本且不改文件', async () => {
  const dir = makeSkill();
  const value = await runUpdate({
    pkgRoot: dir,
    apply: false,
    fetchImpl: fakeFetch(remoteFiles('0.3.1')),
  });
  assert.equal(value.status, 'update-available');
  assert.equal(value.latestVersion, '0.3.1');
  assert.equal(value.applied, false);
  assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /old skill/);
});

test('默认应用更新：替换全部清单文件、保留备份、不动个人数据', async () => {
  const dir = makeSkill();
  const value = await runUpdate({
    pkgRoot: dir,
    fetchImpl: fakeFetch(remoteFiles('0.3.1')),
  });
  assert.equal(value.status, 'updated');
  assert.equal(value.applied, true);
  assert.equal(value.restartRequired, false);
  assert.equal(value.updatedFiles.length, UPDATE_FILES.length);

  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.3.1');
  assert.match(fs.readFileSync(path.join(dir, 'scripts', 'douyin.mjs'), 'utf8'), /抖音收藏管理/);
  assert.match(fs.readFileSync(path.join(dir, 'scripts', 'lib', 'update.js'), 'utf8'), /update\.js new/);
  assert.equal(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'), '{"personal":"keep me"}');
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), '{"cookie":"keep me"}');

  const backups = fs.readdirSync(path.join(dir, 'scripts')).filter((name) => name.includes('.bak.'));
  assert.equal(backups.length, 1);
  const stages = fs.readdirSync(dir).filter((name) => name.startsWith('.update-stage-'));
  assert.equal(stages.length, 0);
});

test('GitHub API 不可用时退回 raw 地址', async () => {
  const dir = makeSkill();
  const value = await runUpdate({
    pkgRoot: dir,
    apply: false,
    fetchImpl: fakeFetch(remoteFiles('0.3.1'), { api: false }),
  });
  assert.equal(value.status, 'update-available');
  assert.equal(value.latestVersion, '0.3.1');
});

test('远端清单与检查结果不一致时中止且不改文件', async () => {
  const dir = makeSkill();
  const files = remoteFiles('0.3.1');
  const fetchImpl = fakeFetch(files, {
    secondManifest: JSON.stringify({ name: 'dy-skill', version: '9.9.9' }),
  });
  await assert.rejects(() => runUpdate({ pkgRoot: dir, fetchImpl }), /与检查结果不一致/);
  assert.match(fs.readFileSync(path.join(dir, 'scripts', 'douyin.mjs'), 'utf8'), /old build/);
});

test('远端入口文件损坏时中止且不改文件', async () => {
  const dir = makeSkill();
  const files = remoteFiles('0.3.1', (file, body) => (file === 'scripts/douyin.mjs' ? 'too small' : body));
  await assert.rejects(() => runUpdate({ pkgRoot: dir, fetchImpl: fakeFetch(files) }), /douyin\.mjs 校验失败/);
  assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /old skill/);
});

test('下载清单缺文件时中止，且不留暂存目录', async () => {
  const dir = makeSkill();
  const files = remoteFiles('0.3.1');
  delete files['scripts/lib/update.js'];
  await assert.rejects(() => runUpdate({ pkgRoot: dir, fetchImpl: fakeFetch(files) }), /下载失败/);
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('.update-stage-')).length, 0);
  assert.match(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), /0\.2\.0/);
});

test('报告渲染覆盖三种状态', () => {
  assert.match(renderUpdate({ status: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1' }), /已是最新版本/);
  assert.match(renderUpdate({ status: 'update-available', currentVersion: '0.2.0', latestVersion: '0.3.1' }), /去掉 --check-only/);
  const text = renderUpdate({
    status: 'updated', currentVersion: '0.2.0', latestVersion: '0.3.1',
    updatedFiles: ['package.json'], backupSuffix: '.bak.x',
  });
  assert.match(text, /已更新 v0\.2\.0 → v0\.3\.1/);
  assert.match(text, /账本未改动/);
});
