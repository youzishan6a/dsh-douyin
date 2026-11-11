/** 收藏页扫描：滚动加载 + 提取卡片。 @module dsh-douyin/favorites */

import { isLoggedIn, openDouyin, scrollList } from './browser.js';
import { extractCardsInPage, normalizeExtracted } from './extract.js';
import { randomBetween, sleep } from './util.js';

/** 未登录时抛出，供工具层转成可执行的提示。 */
export class LoginRequiredError extends Error {
  constructor(message = '尚未登录抖音，请先调用 douyin_login 扫码登录。') {
    super(message);
    this.name = 'LoginRequiredError';
    this.code = 'LOGIN_REQUIRED';
  }
}

/**
 * 打开收藏页，并确认登录态。
 * @param {import('playwright-core').Page} page 页面。
 * @param {import('playwright-core').BrowserContext} context 上下文。
 * @param {Record<string, any>} cfg 插件配置。
 * @returns {Promise<void>} 打开完成。
 */
export async function openFavorites(page, context, cfg) {
  if (!(await isLoggedIn(context))) throw new LoginRequiredError();
  await openDouyin(page, cfg, cfg.favoritesUrl);
  if (!(await isLoggedIn(context))) throw new LoginRequiredError('登录态已失效，请重新执行 douyin_login。');
  if (/login/i.test(page.url())) throw new LoginRequiredError('抖音跳转到了登录页，请重新执行 douyin_login。');
  await ensureVideoTab(page);
}

/**
 * 收藏页有「视频 / 图文 / 合集」子标签，尽量切到「视频」。
 * 找不到标签时静默放过：不同版本页面结构不同，不该因此中断扫描。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<void>} 完成。
 */
async function ensureVideoTab(page) {
  try {
    const state = await page.evaluate(() => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, '').trim();
      const own = (el) => clean(Array.from(el.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join(''));
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      };
      const selected = (el) => {
        let node = el;
        for (let i = 0; i < 3 && node; i += 1) {
          if (node.getAttribute?.('aria-selected') === 'true') return true;
          const cls = typeof node.className === 'string' ? node.className : '';
          if (/active|selected/i.test(cls)) return true;
          node = node.parentElement;
        }
        return false;
      };

      const candidates = Array.from(document.querySelectorAll(
        '[role="tab"], [data-e2e*="tab"], div[class*="tab"] span, div[class*="tab"] div',
      ));
      const target = candidates.find((el) => own(el) === '视频' && visible(el));
      if (!target) return 'not-found';
      if (selected(target)) return 'already';
      target.click();
      return 'clicked';
    });
    if (state === 'clicked') await sleep(randomBetween(800, 1400));
  } catch {
    // 子标签属于增强项，失败不影响主流程。
  }
}

/**
 * 从一批卡片里挑出尚未扫描过的条目。
 * 纯函数，方便单测；已扫描集合既包括账本，也包括本次扫描已收集的条目。
 * @param {Array<Record<string, any>>} items 页面提取结果。
 * @param {Set<string>} knownIds 账本里已扫描过的 id。
 * @param {Map<string, Record<string, any>>} collected 本次已收集的条目。
 * @param {number} remaining 本次还剩多少配额。
 * @returns {Array<Record<string, any>>} 需要新增的条目。
 */
export function pickNewItems(items, knownIds, collected, remaining) {
  const picked = [];
  if (remaining <= 0) return picked;
  for (const item of items) {
    if (!item?.id) continue;
    if (knownIds.has(item.id) || collected.has(item.id)) continue;
    picked.push(item);
    if (picked.length >= remaining) break;
  }
  return picked;
}

/**
 * 滚动收藏列表，只收集尚未扫描过的卡片。
 * 每次最多 limit 条（默认 150），已扫描的条目会被跳过，因此下一批会自然落到更下面。
 * @param {object} params 参数。
 * @param {import('playwright-core').Page} params.page 页面。
 * @param {Record<string, any>} params.cfg 配置。
 * @param {number} [params.limit] 本批目标条数，上限 150。
 * @param {number} [params.maxScrolls] 最大滚动次数。
 * @param {Set<string>} [params.knownIds] 账本里已扫描过的 id。
 * @param {AbortSignal} [params.signal] 取消信号。
 * @returns {Promise<{items:Array<Record<string, any>>, rounds:number, reachedBottom:boolean, skippedKnown:number, stoppedBy:string}>} 扫描结果。
 */
export async function scanFavorites({
  page,
  cfg,
  limit = cfg.scanLimit,
  maxScrolls = cfg.maxScrolls,
  knownIds = new Set(),
  signal,
}) {
  const collected = new Map();
  const skipped = new Set();
  let rounds = 0;
  let staleRounds = 0;
  let reachedBottom = false;
  let stoppedBy = 'limit';

  while (rounds < maxScrolls && collected.size < limit) {
    if (signal?.aborted) {
      stoppedBy = 'aborted';
      break;
    }

    const normalized = normalizeExtracted(await page.evaluate(extractCardsInPage));
    for (const item of normalized) {
      if (knownIds.has(item.id)) skipped.add(item.id);
    }
    const fresh = pickNewItems(normalized, knownIds, collected, limit - collected.size);
    for (const item of fresh) collected.set(item.id, item);
    staleRounds = fresh.length === 0 ? staleRounds + 1 : 0;

    if (collected.size >= limit) {
      stoppedBy = 'limit';
      break;
    }

    const status = await scrollList(page);
    reachedBottom = status.atBottom;
    rounds += 1;

    if (status.atBottom) {
      // 到底后给懒加载留时间，再判断是否真的没新增
      await sleep(randomBetween(1200, 1800));
      const after = normalizeExtracted(await page.evaluate(extractCardsInPage));
      for (const item of after) {
        if (knownIds.has(item.id)) skipped.add(item.id);
      }
      for (const item of pickNewItems(after, knownIds, collected, limit - collected.size)) {
        collected.set(item.id, item);
      }
      if (collected.size >= limit) {
        stoppedBy = 'limit';
        break;
      }
      if (staleRounds >= 2) {
        stoppedBy = 'bottom';
        break;
      }
    } else {
      await sleep(randomBetween(700, 1300));
    }

    if (rounds >= maxScrolls) stoppedBy = 'max-scrolls';
  }

  return {
    items: [...collected.values()],
    rounds,
    reachedBottom,
    skippedKnown: skipped.size,
    stoppedBy: collected.size >= limit ? 'limit' : stoppedBy,
  };
}
