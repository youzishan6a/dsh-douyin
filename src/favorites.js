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
 * 滚动收藏列表并累计卡片。
 * @param {object} params 参数。
 * @param {import('playwright-core').Page} params.page 页面。
 * @param {Record<string, any>} params.cfg 插件配置。
 * @param {number} [params.limit] 目标条数。
 * @param {number} [params.maxScrolls] 最大滚动次数。
 * @param {AbortSignal} [params.signal] 取消信号。
 * @returns {Promise<{items:Array<Record<string, any>>, rounds:number, reachedBottom:boolean}>} 扫描结果。
 */
export async function scanFavorites({ page, cfg, limit = cfg.scanLimit, maxScrolls = cfg.maxScrolls, signal }) {
  const collected = new Map();
  let rounds = 0;
  let staleRounds = 0;
  let reachedBottom = false;

  while (rounds < maxScrolls && collected.size < limit) {
    if (signal?.aborted) break;
    const raw = await page.evaluate(extractCardsInPage);
    const before = collected.size;
    for (const item of normalizeExtracted(raw)) {
      if (!collected.has(item.id)) collected.set(item.id, item);
      if (collected.size >= limit) break;
    }
    staleRounds = collected.size === before ? staleRounds + 1 : 0;

    const status = await scrollList(page);
    reachedBottom = status.atBottom;
    rounds += 1;

    if (status.atBottom) {
      // 到底后给懒加载留时间，再判断是否真的没新增
      await sleep(randomBetween(1200, 1800));
      const rawAfter = await page.evaluate(extractCardsInPage);
      for (const item of normalizeExtracted(rawAfter)) {
        if (!collected.has(item.id)) collected.set(item.id, item);
      }
      if (staleRounds >= 2) break;
    } else {
      await sleep(randomBetween(700, 1300));
    }
  }

  return { items: [...collected.values()], rounds, reachedBottom };
}
