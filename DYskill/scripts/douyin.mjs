#!/usr/bin/env node
/**
 * 抖音收藏命令行：扫码登录、抓取收藏、按类型归纳、按时间取消收藏。
 *
 * 设计原则：
 * - 所有操作都在本机浏览器里完成，不调用逆向接口；
 * - 取消收藏默认只演练，必须同时给 --execute 与 --confirm；
 * - 文本输出给人看，--json 输出给程序解析。
 *
 * @module dy-skill/cli
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './lib/config.js';
import { resolveSkillRoot, runUpdate } from './lib/update.js';
import { dumpPage, isLoggedIn, withBrowser } from './lib/browser.js';
import { loginWithQr } from './lib/login.js';
import { LoginRequiredError, openFavorites, scanFavorites } from './lib/favorites.js';
import {
  activeItems,
  appendActionLog,
  describeSession,
  markUnfavorited,
  mergeItems,
  readLedger,
  writeLedger,
} from './lib/store.js';
import { filterItems, groupByCategory } from './lib/classify.js';
import { describeBasis, selectOlderThan } from './lib/age.js';
import { enrichPublishDates } from './lib/enrich.js';
import { unfavoriteIds } from './lib/unfavorite.js';
import { matchExclude, normalizeText, splitExcludeKeywords, truncate } from './lib/text.js';
import { clampInt } from './lib/util.js';
import * as report from './lib/report.js';

/** 技能根目录（scripts/douyin.mjs 的上一级），自更新以它为边界。 */
const SKILL_ROOT = resolveSkillRoot(fileURLToPath(import.meta.url));

const HELP = `抖音收藏管理

用法：
  node scripts/douyin.mjs <命令> [选项]

命令：
  login        扫码登录抖音（弹出浏览器窗口）
  status       查看登录态与账本概况
  scan         抓取收藏清单并写入本地账本（每批最多 150 条新的）
  summarize    按类型/排除条件筛选，输出归纳素材
  unfavorite   按时间批量取消收藏（默认演练）
  update       检查 GitHub 上的新版本并更新本技能（默认直接更新）
  diagnose     保存当前页面截图与 HTML，排查选择器失效

通用选项：
  --data-dir <path>   数据目录，默认 ~/.dsh/douyin
  --json              以 JSON 输出（便于程序解析）
  --headless          无头模式（容易被验证码拦截，不推荐）
  --channel <name>    chrome | msedge | chromium，默认自动
  --help              显示帮助

login：
  --force             清掉旧登录态重新扫码（切换账号）
  --timeout <秒>      等待扫码时间，默认 300

status：
  --probe             打开浏览器真实验证登录是否有效

scan：
  --limit <n>         本批最多抓多少条，默认 150，上限 150
  --max-scrolls <n>   最多滚动次数，默认 120

summarize：
  --types <a,b>       类型 id/中文名/关键词，逗号分隔；留空为全部
  --exclude <文本>    不想总结的类型，如 "带货和直播切片"
  --since-days <n>    只看最近 n 天
  --max-items <n>     最多返回多少条明细，默认 40
  --refresh           先重新扫描再归纳（同样只抓 150 条新的）

unfavorite：
  --older-than-days <n>  必填，多少天之前
  --age-basis <publish|firstSeen>  时间基准，默认 publish
  --types <a,b>       只处理这些类型
  --exclude <文本>    排除某些类型
  --limit <n>         本次最多处理多少条，默认 20
  --no-enrich         不打开详情页补全发布时间
  --execute           真正执行（不加则只演练）
  --confirm           执行时必须同时提供

update：
  （默认）            检查版本，发现新版本就下载替换，旧文件留 .bak 备份
  --check-only        只报告是否有新版本，不改任何文件

示例：
  node scripts/douyin.mjs login
  node scripts/douyin.mjs scan
  node scripts/douyin.mjs scan            # 再执行一次，自动跳过已扫描，继续下面 150 条
  node scripts/douyin.mjs summarize --types 美食,旅行 --exclude 探店广告
  node scripts/douyin.mjs unfavorite --older-than-days 365 --exclude 带货
  node scripts/douyin.mjs unfavorite --older-than-days 365 --limit 20 --execute --confirm
  node scripts/douyin.mjs update                  # 检查并更新本技能
  node scripts/douyin.mjs update --check-only     # 只检查
`;

/**
 * 解析 --key value / --flag / --no-flag；重复的键收集成数组。
 * @param {string[]} argv 参数列表。
 * @returns {Record<string, string|boolean|string[]>} 解析结果。
 */
function parseFlags(argv) {
  const out = {};
  const put = (key, value) => {
    if (key in out) out[key] = [].concat(out[key], value);
    else out[key] = value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const rawKey = token.slice(2);
    if (rawKey.startsWith('no-')) {
      put(rawKey.slice(3), false);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      put(rawKey, true);
      continue;
    }
    put(rawKey, next);
    i += 1;
  }
  return out;
}

/**
 * 解析类型参数，支持逗号分隔与重复传入。
 * @param {unknown} value 原始值。
 * @returns {string[]} 类型列表。
 */
function parseTypes(value) {
  if (value === undefined || value === true || value === false) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((item) => String(item).split(/[,，]/))
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

/**
 * 输出结果。
 * @param {Record<string, any>} value 结构化结果。
 * @param {string} text 文本结果。
 * @param {boolean} asJson 是否 JSON 输出。
 * @returns {void}
 */
function emit(value, text, asJson) {
  process.stdout.write(`${asJson ? JSON.stringify(value, null, 2) : text}\n`);
}

/**
 * 主流程。
 * @returns {Promise<void>} 完成。
 */
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const flags = parseFlags(rest);
  if (flags.help === true) {
    process.stdout.write(HELP);
    return;
  }
  const asJson = flags.json === true;
  const cfg = resolveConfig({
    dataDir: typeof flags['data-dir'] === 'string' ? flags['data-dir'] : undefined,
    headless: flags.headless === true,
    browserChannel: typeof flags.channel === 'string' ? flags.channel : undefined,
  });

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);

  try {
    switch (command) {
      case 'login':
        await runLogin(cfg, flags, asJson, controller.signal);
        break;
      case 'status':
        await runStatus(cfg, flags, asJson, controller.signal);
        break;
      case 'scan':
        await runScan(cfg, flags, asJson, controller.signal);
        break;
      case 'summarize':
        await runSummarize(cfg, flags, asJson, controller.signal);
        break;
      case 'unfavorite':
        await runUnfavorite(cfg, flags, asJson, controller.signal);
        break;
      case 'update':
        await runUpdateCommand(flags, asJson, controller.signal);
        break;
      case 'diagnose':
        await runDiagnose(cfg, flags, asJson, controller.signal);
        break;
      default:
        process.stderr.write(`未知命令：${command}\n\n${HELP}`);
        process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
  }
}

/**
 * 扫码登录。
 * @param {Record<string, any>} cfg 配置。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runLogin(cfg, flags, asJson, signal) {
  const headed = { ...cfg, headless: false };
  const timeoutMs = clampInt(flags.timeout, 30, 600, Math.round(cfg.loginTimeoutMs / 1000)) * 1000;
  const result = await withBrowser(headed, async ({ page, context }) => {
    const value = await loginWithQr({
      page,
      context,
      cfg: headed,
      timeoutMs,
      force: flags.force === true,
      signal,
    });
    return {
      loggedIn: true,
      alreadyLoggedIn: value.alreadyLoggedIn,
      qrPath: value.qrPath ?? '',
      waitedSeconds: Math.round(value.waitedMs / 1000),
      statePath: cfg.statePath,
    };
  }, { signal });
  emit(result, report.login(result), asJson);
}

/**
 * 查看状态。
 * @param {Record<string, any>} cfg 配置。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runStatus(cfg, flags, asJson, signal) {
  const session = describeSession(cfg.statePath);
  const ledger = readLedger(cfg.ledgerPath);
  const active = activeItems(ledger);
  let probed = false;
  let loggedIn = false;

  if (flags.probe === true) {
    probed = true;
    loggedIn = await withBrowser(cfg, async ({ page, context }) => {
      await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: cfg.navTimeoutMs });
      return isLoggedIn(context);
    }, { signal });
  }

  const value = {
    sessionExists: session.exists,
    sessionSavedAt: session.savedAt ?? '',
    cookieCount: session.cookieCount,
    probed,
    loggedIn,
    total: Object.keys(ledger.items).length,
    active: active.length,
    withPublishDate: active.filter((item) => item.publishAt).length,
    lastScanAt: ledger.updatedAt ?? '',
    dataDir: cfg.dataDir,
  };
  emit(value, report.status(value), asJson);
}

/**
 * 扫描收藏。
 * @param {Record<string, any>} cfg 配置。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runScan(cfg, flags, asJson, signal) {
  const limit = clampInt(flags.limit, 1, 150, cfg.scanLimit);
  const maxScrolls = clampInt(flags['max-scrolls'], 1, 600, cfg.maxScrolls);

  const value = await withBrowser(cfg, async ({ page, context }) => {
    try {
      await openFavorites(page, context, cfg);
      // 已扫描清单：账本里仍在收藏的条目；已取消收藏的允许重新收集
      const knownIds = new Set(activeItems(readLedger(cfg.ledgerPath)).map((item) => item.id));
      const scan = await scanFavorites({ page, cfg, limit, maxScrolls, knownIds, signal });
      const ledger = readLedger(cfg.ledgerPath);
      const merged = mergeItems(ledger.items, scan.items);
      writeLedger(cfg.ledgerPath, { version: 1, items: merged.items });
      appendActionLog(cfg.actionLogPath, {
        action: 'scan',
        scanned: scan.items.length,
        added: merged.added,
        updated: merged.updated,
        skippedKnown: scan.skippedKnown,
        stoppedBy: scan.stoppedBy,
      });
      return {
        scanned: scan.items.length,
        added: merged.added,
        updated: merged.updated,
        skippedKnown: scan.skippedKnown,
        total: Object.keys(merged.items).length,
        rounds: scan.rounds,
        reachedBottom: scan.reachedBottom,
        stoppedBy: scan.stoppedBy,
        ledgerPath: cfg.ledgerPath,
        samples: scan.items.slice(0, 6).map((item) => ({
          title: truncate(item.title, 60),
          author: truncate(item.author, 30),
          url: item.url,
        })),
      };
    } catch (error) {
      if (!(error instanceof LoginRequiredError)) {
        const dump = await dumpPage(page, cfg).catch(() => null);
        if (dump) error.message += `\n已保存页面快照：${dump.screenshot} 与 ${dump.html}`;
      }
      throw error;
    }
  }, { signal });

  emit(value, report.scan(value), asJson);
}

/**
 * 按条件筛选并输出归纳素材。
 * @param {Record<string, any>} cfg 配置。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runSummarize(cfg, flags, asJson, signal) {
  const types = parseTypes(flags.types ?? flags.type);
  const exclude = typeof flags.exclude === 'string' ? flags.exclude : '';
  const sinceDays = clampInt(flags['since-days'], 0, 3650, 0);
  const maxItems = clampInt(flags['max-items'], 1, 200, 40);

  if (flags.refresh === true) {
    await withBrowser(cfg, async ({ page, context }) => {
      await openFavorites(page, context, cfg);
      const knownIds = new Set(activeItems(readLedger(cfg.ledgerPath)).map((item) => item.id));
      const scan = await scanFavorites({ page, cfg, knownIds, signal });
      const ledger = readLedger(cfg.ledgerPath);
      const merged = mergeItems(ledger.items, scan.items);
      writeLedger(cfg.ledgerPath, { version: 1, items: merged.items });
      appendActionLog(cfg.actionLogPath, {
        action: 'scan',
        scanned: scan.items.length,
        added: merged.added,
        skippedKnown: scan.skippedKnown,
        reason: 'summarize-refresh',
      });
    }, { signal });
  }

  const ledger = readLedger(cfg.ledgerPath);
  const all = activeItems(ledger);
  if (all.length === 0) {
    throw new Error('本地账本还没有收藏数据。请先执行 scan（或 summarize --refresh）。');
  }

  const excludeKeywords = splitExcludeKeywords(exclude);
  let items = filterItems(all, { types, excludeKeywords, excludeMatcher: matchExclude });

  if (sinceDays > 0) {
    const cutoff = Date.now() - sinceDays * 86_400_000;
    items = items.filter((item) => {
      const time = Date.parse(item.publishAt ?? item.firstSeenAt ?? '');
      return Number.isFinite(time) && time >= cutoff;
    });
  }
  items.sort((a, b) => (Date.parse(b.publishAt ?? b.firstSeenAt ?? '') || 0) - (Date.parse(a.publishAt ?? a.firstSeenAt ?? '') || 0));

  const groups = trimGroups(groupByCategory(items, 12), maxItems);
  const value = {
    generatedAt: new Date().toISOString(),
    fetchedAt: ledger.updatedAt ?? '',
    activeTotal: all.length,
    matched: items.length,
    filters: { types, exclude: normalizeText(exclude), sinceDays },
    groups: groups.map((group) => ({
      type: group.type,
      label: group.label,
      count: group.count,
      items: group.items.map((item) => ({
        title: truncate(item.title, 80),
        author: truncate(item.author || '未知作者', 30),
        url: item.url,
        publishAt: item.publishAt ?? '',
        duration: item.duration ?? '',
      })),
    })),
  };

  appendActionLog(cfg.actionLogPath, { action: 'summarize', matched: value.matched, filters: value.filters });
  emit(value, report.summary(value), asJson);
}

/**
 * 按总条数预算裁剪分组明细。
 * @param {Array<{items:Array<any>, count:number}>} groups 分组。
 * @param {number} maxItems 总预算。
 * @returns {Array<any>} 裁剪结果。
 */
function trimGroups(groups, maxItems) {
  let budget = maxItems;
  return groups.map((group) => {
    const take = Math.max(0, Math.min(group.items.length, budget, 8));
    budget -= take;
    return { ...group, items: group.items.slice(0, take) };
  });
}

/**
 * 按时间取消收藏。默认演练，--execute 与 --confirm 同时存在才真正执行。
 * @param {Record<string, any>} cfg 配置。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runUnfavorite(cfg, flags, asJson, signal) {
  const olderThanDays = clampInt(flags['older-than-days'], 0, 3650, 0);
  if (olderThanDays < 1) throw new Error('必须提供 --older-than-days（1–3650 的整数）。');

  const execute = flags.execute === true;
  const confirmed = flags.confirm === true;
  if (execute && !confirmed) {
    throw new Error('真正执行必须同时提供 --confirm。建议先不带 --execute 跑一次演练。');
  }

  const basis = flags['age-basis'] === 'firstSeen' ? 'firstSeen' : 'publish';
  const limit = Math.min(clampInt(flags.limit, 1, 100, 20), cfg.maxUnfavoritePerRun);
  const types = parseTypes(flags.types ?? flags.type);
  const exclude = typeof flags.exclude === 'string' ? flags.exclude : '';
  const excludeKeywords = splitExcludeKeywords(exclude);

  const ledger = readLedger(cfg.ledgerPath);
  const all = activeItems(ledger);
  if (all.length === 0) throw new Error('账本里没有收藏记录。请先执行 scan。');

  const filtered = filterItems(all, { types, excludeKeywords, excludeMatcher: matchExclude });
  let selection = selectOlderThan(filtered, { olderThanDays, ageBasis: basis });
  const wantEnrich = flags.enrich !== false && basis === 'publish' && selection.unknown.length > 0 && cfg.enrichLimit > 0;
  let enrichedCount = 0;

  if (wantEnrich) {
    await withBrowser(cfg, async ({ page, context }) => {
      await openFavorites(page, context, cfg);
      const result = await enrichPublishDates({ page, items: selection.unknown, limit: cfg.enrichLimit, signal });
      enrichedCount = result.resolved;
      for (const item of result.items) {
        if (item.publishAt && ledger.items[item.id] && !ledger.items[item.id].publishAt) {
          ledger.items[item.id] = { ...ledger.items[item.id], publishAt: item.publishAt };
        }
      }
      if (enrichedCount > 0) writeLedger(cfg.ledgerPath, { version: 1, items: ledger.items });
    }, { signal });

    const refreshed = filterItems(activeItems(readLedger(cfg.ledgerPath)), {
      types,
      excludeKeywords,
      excludeMatcher: matchExclude,
    });
    selection = selectOlderThan(refreshed, { olderThanDays, ageBasis: basis });
  }

  const candidates = selection.eligible.slice(0, limit);
  const base = {
    olderThanDays,
    ageBasis: basis,
    basisNote: describeBasis(basis),
    cutoffIso: selection.cutoffIso,
    eligibleCount: selection.eligible.length,
    plannedCount: candidates.length,
    unknownAgeCount: selection.unknown.length,
    enrichedCount,
    candidates: candidates.map((item) => ({
      id: item.id,
      title: truncate(item.title, 80),
      author: truncate(item.author || '未知作者', 30),
      url: item.url,
      category: item.categoryLabel ?? '其他',
      ageDate: (item.ageDate ?? '').slice(0, 10),
      ageDays: item.ageDays ?? 0,
    })),
  };

  if (!execute) {
    const value = {
      mode: 'dryRun',
      ...base,
      succeeded: [],
      failed: [],
      stoppedBy: 'dry-run',
      allowDestructive: true,
    };
    appendActionLog(cfg.actionLogPath, { action: 'unfavorite-dry-run', olderThanDays, ageBasis: basis, planned: candidates.length });
    emit(value, report.unfavorite(value), asJson);
    return;
  }

  const result = candidates.length === 0
    ? { succeeded: [], failed: [], stoppedBy: 'nothing-to-do', rounds: 0 }
    : await withBrowser(cfg, async ({ page, context }) => {
      await openFavorites(page, context, cfg);
      return unfavoriteIds({ page, cfg, ids: candidates.map((item) => item.id), signal });
    }, { signal });

  markUnfavorited(ledger, result.succeeded);
  writeLedger(cfg.ledgerPath, { version: 1, items: ledger.items });
  appendActionLog(cfg.actionLogPath, {
    action: 'unfavorite',
    olderThanDays,
    ageBasis: basis,
    succeeded: result.succeeded.length,
    failed: result.failed.length,
    stoppedBy: result.stoppedBy,
  });

  const value = {
    mode: 'executed',
    ...base,
    succeeded: result.succeeded,
    failed: result.failed.map((entry) => ({ id: entry.id, reason: entry.reason })),
    stoppedBy: result.stoppedBy,
    allowDestructive: true,
  };
  emit(value, report.unfavorite(value), asJson);
}

/**
 * 检查并更新本技能。默认应用更新，--check-only 只报告版本差异。
 * 只替换技能代码文件，不触碰 ~/.dsh/douyin 下的登录态与收藏账本。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runUpdateCommand(flags, asJson, signal) {
  const apply = flags['check-only'] !== true;
  let value;
  try {
    value = await runUpdate({ pkgRoot: SKILL_ROOT, apply, signal });
  } catch (error) {
    throw new Error(`检查更新失败：${error.message}。请确认能访问 github.com 后重试。`);
  }
  emit({ ...value, skillRoot: SKILL_ROOT, mode: apply ? 'apply' : 'check-only' }, report.update(value), asJson);
}

/**
 * 保存当前页面现场，便于排查选择器。
 * @param {Record<string, any>} cfg 配置。
 * @param {Record<string, any>} flags 参数。
 * @param {boolean} asJson 是否 JSON 输出。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<void>} 完成。
 */
async function runDiagnose(cfg, flags, asJson, signal) {
  const result = await withBrowser(cfg, async ({ page, context }) => {
    if (!(await isLoggedIn(context))) {
      await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: cfg.navTimeoutMs });
    } else {
      await page.goto(cfg.favoritesUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navTimeoutMs });
      await page.waitForTimeout(2000);
    }
    const dump = await dumpPage(page, cfg);
    return {
      url: page.url(),
      title: await page.title(),
      screenshot: dump.screenshot,
      html: dump.html,
      dataDir: cfg.dataDir,
    };
  }, { signal });

  const text = [
    `页面：${result.title}`,
    `地址：${result.url}`,
    `截图：${result.screenshot}`,
    `HTML：${result.html}`,
    '把这两个文件发给维护者，可据此修选择器。',
  ].join('\n');
  emit(result, text, asJson);
}

try {
  await main();
} catch (error) {
  if (error instanceof LoginRequiredError) {
    process.stderr.write(`${error.message}\n提示：先运行 node scripts/douyin.mjs login。\n`);
    process.exitCode = 2;
  } else if (error?.name === 'AbortError') {
    process.stderr.write('已取消。\n');
    process.exitCode = 130;
  } else {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
