/** 本地账本：收藏条目、操作日志、会话状态。 @module dsh-douyin/store */

import fs from 'node:fs';
import path from 'node:path';
import { nowIso, readJson, writeJsonAtomic } from './util.js';

const LEDGER_VERSION = 1;

/**
 * @typedef {object} LedgerItem
 * @property {string} id 视频/图文 id。
 * @property {string} url 页面地址。
 * @property {string} title 标题。
 * @property {string} author 作者。
 * @property {string} [cover] 封面地址。
 * @property {string} [duration] 时长文本。
 * @property {number|null} [likeCount] 点赞数。
 * @property {string|null} [publishAt] 发布时间（ISO）。
 * @property {string} firstSeenAt 首次扫描到的时间（ISO）。
 * @property {string} lastSeenAt 最近一次扫描到的时间（ISO）。
 * @property {string} [kind] video | note。
 * @property {string} [unfavoritedAt] 已取消收藏的时间（ISO）。
 */

/**
 * 读取账本，文件不存在时返回空账本。
 * @param {string} file 账本路径。
 * @returns {{version:number, updatedAt:string|null, items:Record<string, LedgerItem>}} 账本对象。
 */
export function readLedger(file) {
  const raw = readJson(file, null);
  if (!raw || typeof raw !== 'object' || typeof raw.items !== 'object' || raw.items === null) {
    return { version: LEDGER_VERSION, updatedAt: null, items: {} };
  }
  return {
    version: LEDGER_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    items: raw.items,
  };
}

/**
 * 原子写入账本。
 * @param {string} file 账本路径。
 * @param {{version:number, items:Record<string, LedgerItem>}} ledger 账本。
 * @returns {void}
 */
export function writeLedger(file, ledger) {
  writeJsonAtomic(file, { ...ledger, version: LEDGER_VERSION, updatedAt: nowIso() });
}

/**
 * 把新扫描结果合并进账本：新条目补 firstSeenAt，旧条目只更新可变字段。
 * 已标记取消收藏的条目若再次出现，说明用户重新收藏，会清掉标记。
 * @param {Record<string, LedgerItem>} items 现有条目字典。
 * @param {Array<Partial<LedgerItem> & {id:string}>} incoming 本次扫描结果。
 * @param {string} [seenAt] 扫描时间。
 * @returns {{items:Record<string, LedgerItem>, added:number, updated:number}} 合并结果。
 */
export function mergeItems(items, incoming, seenAt = nowIso()) {
  const next = { ...items };
  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    if (!item?.id) continue;
    const existing = next[item.id];
    if (!existing) {
      next[item.id] = {
        id: item.id,
        url: item.url,
        title: item.title ?? '',
        author: item.author ?? '',
        cover: item.cover ?? '',
        duration: item.duration ?? '',
        likeCount: item.likeCount ?? null,
        publishAt: item.publishAt ?? null,
        kind: item.kind ?? 'video',
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      };
      added += 1;
      continue;
    }

    next[item.id] = {
      ...existing,
      url: item.url || existing.url,
      title: item.title || existing.title,
      author: item.author || existing.author,
      cover: item.cover || existing.cover,
      duration: item.duration || existing.duration,
      likeCount: item.likeCount ?? existing.likeCount,
      publishAt: existing.publishAt ?? item.publishAt ?? null,
      lastSeenAt: seenAt,
      unfavoritedAt: undefined,
    };
    updated += 1;
  }

  return { items: next, added, updated };
}

/**
 * 列出账本中仍在收藏的条目。
 * @param {{items:Record<string, LedgerItem>}} ledger 账本。
 * @returns {LedgerItem[]} 条目数组。
 */
export function activeItems(ledger) {
  return Object.values(ledger.items).filter((item) => !item.unfavoritedAt);
}

/**
 * 标记条目已取消收藏，而不是删除，便于追溯。
 * @param {{items:Record<string, LedgerItem>}} ledger 账本。
 * @param {string[]} ids 已成功的 id。
 * @param {string} [at] 时间。
 * @returns {number} 实际改动的条数。
 */
export function markUnfavorited(ledger, ids, at = nowIso()) {
  let changed = 0;
  for (const id of ids) {
    const item = ledger.items[id];
    if (!item) continue;
    ledger.items[id] = { ...item, unfavoritedAt: at };
    changed += 1;
  }
  return changed;
}

/**
 * 追加一行操作日志，失败不影响主流程。
 * @param {string} file JSONL 路径。
 * @param {Record<string, unknown>} record 日志内容。
 * @returns {void}
 */
export function appendActionLog(file, record) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${JSON.stringify({ at: nowIso(), ...record })}\n`, { mode: 0o600 });
  } catch {
    // 日志失败不应中断用户操作。
  }
}

/**
 * 读取会话文件的基本信息，用于判断是否「可能已登录」。
 * 抖音 cookie 会过期，所以这里只能给出保守结论。
 * @param {string} statePath Playwright storageState 路径。
 * @returns {{exists:boolean, savedAt:string|null, cookieCount:number}} 会话概况。
 */
export function describeSession(statePath) {
  try {
    const stat = fs.statSync(statePath);
    const raw = readJson(statePath, null);
    const cookieCount = Array.isArray(raw?.cookies) ? raw.cookies.length : 0;
    return { exists: true, savedAt: stat.mtime.toISOString(), cookieCount };
  } catch {
    return { exists: false, savedAt: null, cookieCount: 0 };
  }
}
