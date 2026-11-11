/**
 * 技能版本检查与自更新：从 GitHub 仓库的 DYskill 目录读取版本，比本地新就替换技能文件。
 *
 * 与 dsh 插件版的差别：插件有设置页按钮，技能没有 GUI，因此由 CLI 的 `update` 命令承担。
 * 只下载固定清单里的文件，先全部下载并校验，再落盘替换，旧文件保留 .bak 备份。
 * 清单不含 state.json / ledger.json 等个人数据，更新不会碰账号数据和收藏账本。
 *
 * @module dy-skill/update
 */

import fs from 'node:fs';
import path from 'node:path';

/** 插件与技能共用的仓库。 */
export const UPDATE_REPO = 'youzishan6a/dsh-douyin';
/** 跟随的分支。 */
export const UPDATE_BRANCH = 'main';
/** 技能在仓库里的子目录。 */
export const SKILL_DIR = 'DYskill';
/** 技能清单名。 */
export const SKILL_NAME = 'dy-skill';
/**
 * 允许替换的文件清单，均为技能目录内的相对路径；路径不可由外部指定。
 * 测试文件不随更新安装，避免把测试写进用户目录。
 */
export const UPDATE_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'SKILL.md',
  'README.md',
  'scripts/douyin.mjs',
  'scripts/lib/age.js',
  'scripts/lib/browser.js',
  'scripts/lib/classify.js',
  'scripts/lib/config.js',
  'scripts/lib/enrich.js',
  'scripts/lib/extract.js',
  'scripts/lib/favorites.js',
  'scripts/lib/login.js',
  'scripts/lib/report.js',
  'scripts/lib/store.js',
  'scripts/lib/text.js',
  'scripts/lib/unfavorite.js',
  'scripts/lib/update.js',
  'scripts/lib/util.js',
  'references/categories.md',
  'references/troubleshooting.md',
]);
/** 单文件大小上限，防止误下载大文件。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 入口文件的最小体积，用于识别明显损坏的下载内容。 */
const MIN_ENTRY_BYTES = 10_000;

/**
 * 解析 x.y.z 或 x.y.z-pre 版本号。
 * @param {unknown} input 版本字符串。
 * @returns {{major:number,minor:number,patch:number,pre:string[]}|null} 解析结果。
 */
export function parseVersion(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(input ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

/**
 * 比较两个版本号。
 * @param {string} left 左版本。
 * @param {string} right 右版本。
 * @returns {number} 左大于右返回 1，相等 0，小于 -1。
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`无法比较版本号：${left} / ${right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  // 正式版大于同号预发布版
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y) ? 1 : -1;
    if (nx) return -1;
    if (ny) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 读取本地 package.json。
 * @param {string} pkgRoot 技能根目录。
 * @returns {{name:string,version:string}} 清单。
 */
export function readLocalManifest(pkgRoot) {
  const file = path.join(pkgRoot, 'package.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (json?.name !== SKILL_NAME || !parseVersion(json.version)) {
    throw new Error(`本地 package.json 不是有效的 ${SKILL_NAME} 清单：${file}`);
  }
  return { name: json.name, version: json.version };
}

/**
 * 下载一个文本文件，带缓存破除和大小上限。
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl fetch 实现。
 * @param {string} url 地址。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<string>} 文件内容。
 */
async function fetchText(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error(`文件过大，已拒绝：${url}`);
  return text;
}

/**
 * 读取仓库里 DYskill 目录下的一个文件。
 * 优先走 GitHub Contents API（推送后立即可见），失败再退回 raw.githubusercontent（有 CDN 缓存）。
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl fetch 实现。
 * @param {string} file 技能目录内相对路径。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<string>} 文件内容。
 */
export async function fetchRepoFile(fetchImpl, file, signal) {
  const repoPath = `${SKILL_DIR}/${file}`;
  const api = `https://api.github.com/repos/${UPDATE_REPO}/contents/${repoPath}?ref=${UPDATE_BRANCH}`;
  try {
    const response = await fetchImpl(api, {
      headers: {
        accept: 'application/vnd.github.raw',
        'user-agent': 'dy-skill-updater',
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error(`文件过大，已拒绝：${file}`);
      return text;
    }
  } catch {
    // 落到 raw 兜底；如果 raw 也失败，错误由 fetchText 抛出
  }
  const raw = `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_BRANCH}/${repoPath}`;
  return fetchText(fetchImpl, `${raw}?t=${Date.now()}`, signal);
}

/**
 * 读取远端最新清单。
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl fetch 实现。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<{name:string,version:string}>} 远端清单。
 */
export async function fetchRemoteManifest(fetchImpl, signal) {
  const text = await fetchRepoFile(fetchImpl, 'package.json', signal);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('远端 package.json 不是合法 JSON');
  }
  if (json?.name !== SKILL_NAME || !parseVersion(json.version)) {
    throw new Error(`远端 package.json 不是有效的 ${SKILL_NAME} 清单`);
  }
  return { name: json.name, version: json.version };
}

/**
 * 检查是否有新版本。
 * @param {{pkgRoot:string, fetchImpl?:Function, signal?:AbortSignal}} options 参数。
 * @returns {Promise<{currentVersion:string, latestVersion:string, hasUpdate:boolean}>} 检查结果。
 */
export async function checkForUpdate({ pkgRoot, fetchImpl = globalThis.fetch, signal }) {
  const local = readLocalManifest(pkgRoot);
  const remote = await fetchRemoteManifest(fetchImpl, signal);
  return {
    currentVersion: local.version,
    latestVersion: remote.version,
    hasUpdate: compareVersions(remote.version, local.version) > 0,
  };
}

/**
 * 校验下载内容，避免把错误文件或半成品写进技能目录。
 * @param {Map<string, string>} contents 文件路径到内容。
 * @param {string} version 期望的远端版本。
 * @returns {void}
 */
function validateContents(contents, version) {
  const manifest = JSON.parse(contents.get('package.json') ?? '{}');
  if (manifest?.name !== SKILL_NAME || manifest.version !== version) {
    throw new Error('远端 package.json 与检查结果不一致，已中止更新');
  }
  try {
    const lock = JSON.parse(contents.get('package-lock.json') ?? '{}');
    if (lock?.name !== SKILL_NAME) throw new Error('package-lock.json 不属于本技能');
  } catch (error) {
    throw new Error(`远端 package-lock.json 校验失败：${error.message}`);
  }
  const entry = contents.get('scripts/douyin.mjs') ?? '';
  if (!entry.includes('抖音收藏管理') || Buffer.byteLength(entry, 'utf8') < MIN_ENTRY_BYTES) {
    throw new Error('远端 scripts/douyin.mjs 校验失败，已中止更新');
  }
  for (const [file, text] of contents) {
    if (!text.trim()) throw new Error(`远端文件为空，已中止更新：${file}`);
    if (/[\\/]\.\.[\\/]/.test(file)) throw new Error(`非法文件路径：${file}`);
  }
}

/**
 * 下载并替换技能文件。全部下载校验通过后才落盘；失败时保持原文件不动。
 * @param {{pkgRoot:string, version:string, fetchImpl:Function, signal?:AbortSignal}} options 参数。
 * @returns {Promise<{updatedFiles:string[], backupSuffix:string}>} 更新结果。
 */
export async function installUpdate({ pkgRoot, version, fetchImpl, signal }) {
  const stage = path.join(pkgRoot, `.update-stage-${Date.now()}`);
  const contents = new Map();

  try {
    for (const file of UPDATE_FILES) {
      contents.set(file, await fetchRepoFile(fetchImpl, file, signal));
    }
    validateContents(contents, version);

    fs.mkdirSync(stage, { recursive: true });
    for (const [file, text] of contents) {
      const target = path.join(stage, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text, 'utf8');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const updatedFiles = [];
    for (const file of contents.keys()) {
      const dest = path.join(pkgRoot, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) fs.copyFileSync(dest, `${dest}.bak.${stamp}`);
      const tmp = `${dest}.tmp-${process.pid}`;
      fs.copyFileSync(path.join(stage, file), tmp);
      fs.renameSync(tmp, dest);
      updatedFiles.push(file);
    }

    return { updatedFiles, backupSuffix: `.bak.${stamp}` };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * 检查并按需更新。默认 apply=true，对应「点一下就检查并更新」；--check-only 可只看不改。
 * @param {{pkgRoot:string, apply?:boolean, fetchImpl?:Function, signal?:AbortSignal}} options 参数。
 * @returns {Promise<Record<string, any>>} 更新状态。
 */
export async function runUpdate({ pkgRoot, apply = true, fetchImpl = globalThis.fetch, signal }) {
  const local = readLocalManifest(pkgRoot);
  const remote = await fetchRemoteManifest(fetchImpl, signal);
  const hasUpdate = compareVersions(remote.version, local.version) > 0;

  if (!hasUpdate) {
    return {
      status: 'up-to-date',
      currentVersion: local.version,
      latestVersion: remote.version,
      applied: false,
      restartRequired: false,
      updatedFiles: [],
    };
  }

  if (!apply) {
    return {
      status: 'update-available',
      currentVersion: local.version,
      latestVersion: remote.version,
      applied: false,
      restartRequired: false,
      updatedFiles: [],
    };
  }

  const installed = await installUpdate({ pkgRoot, version: remote.version, fetchImpl, signal });
  return {
    status: 'updated',
    currentVersion: local.version,
    latestVersion: remote.version,
    applied: true,
    restartRequired: false,
    updatedFiles: installed.updatedFiles,
    backupSuffix: installed.backupSuffix,
  };
}
