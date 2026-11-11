/** 补齐发布时间：收藏卡片通常不显示日期，只能去详情页的页面数据里找。 @module dsh-douyin/enrich */

import { randomBetween, sleep } from './util.js';

/**
 * 打开视频详情页，从内联 JSON 或 meta 标签里取发布时间。
 * @param {import('playwright-core').Page} page 当前页面（用于创建新标签）。
 * @param {string} id 视频 id。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<string|null>} ISO 时间，取不到为 null。
 */
export async function resolvePublishAt(page, id, signal) {
  let detail;
  try {
    detail = await page.context().newPage();
    await detail.goto(`https://www.douyin.com/video/${id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(randomBetween(900, 1600), signal);
    const seconds = await detail.evaluate(() => {
      const texts = [];
      const render = document.querySelector('script#RENDER_DATA');
      if (render?.textContent) {
        try {
          texts.push(decodeURIComponent(render.textContent));
        } catch {
          texts.push(render.textContent);
        }
      }
      for (const script of document.querySelectorAll('script')) {
        const content = script.textContent ?? '';
        if (content.includes('create_time') || content.includes('createTime')) texts.push(content);
      }
      for (const text of texts) {
        const match = text.match(/"(?:create_time|createTime)"\s*:\s*(\d{9,11})/);
        if (match) return Number(match[1]);
      }
      const meta = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content');
      if (meta) {
        const time = Date.parse(meta);
        if (!Number.isNaN(time)) return Math.floor(time / 1000);
      }
      return null;
    }).catch(() => null);
    return seconds ? new Date(seconds * 1000).toISOString() : null;
  } catch {
    return null;
  } finally {
    await detail?.close().catch(() => {});
  }
}

/**
 * 批量补齐缺少发布时间的条目。
 * @param {object} params 参数。
 * @param {import('playwright-core').Page} params.page 页面。
 * @param {Array<Record<string, any>>} params.items 待补条目。
 * @param {number} params.limit 最多补多少条。
 * @param {AbortSignal} [params.signal] 取消信号。
 * @param {(message:string)=>void} [params.log] 进度回调。
 * @returns {Promise<{items:Array<Record<string, any>>, resolved:number, attempted:number}>} 补齐结果。
 */
export async function enrichPublishDates({ page, items, limit, signal, log = () => {} }) {
  const targets = items.filter((item) => !item.publishAt).slice(0, Math.max(0, limit));
  let resolved = 0;
  const byId = new Map();

  for (const [index, item] of targets.entries()) {
    if (signal?.aborted) break;
    const iso = await resolvePublishAt(page, item.id, signal);
    if (iso) {
      byId.set(item.id, iso);
      resolved += 1;
    }
    if ((index + 1) % 5 === 0) log(`已补全 ${index + 1}/${targets.length} 条发布时间`);
    await sleep(randomBetween(500, 900), signal);
  }

  return {
    items: items.map((item) => (byId.has(item.id) ? { ...item, publishAt: byId.get(item.id) } : item)),
    resolved,
    attempted: targets.length,
  };
}
