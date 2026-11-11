/** 在页面内提取收藏卡片（这段函数会被序列化进浏览器执行）。 @module dsh-douyin/extract */

import { normalizeText, parseCount, parseDateText } from './text.js';

/**
 * 页面内执行的提取逻辑。
 * 依赖 data-e2e 与链接结构，尽量不写死 hash 类名（抖音会变）。
 * @returns {Array<Record<string, any>>} 原始卡片数据。
 */
export function extractCardsInPage() {
  const clean = (value) => String(value ?? '')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const textOf = (root, selectors) => {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      const text = clean(el?.textContent);
      if (text) return text;
    }
    return '';
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };

  const anchors = Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]'));
  const result = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const href = anchor.href || '';
    const match = href.match(/\/(video|note)\/(\d{6,})/);
    if (!match) continue;
    const [, kind, id] = match;
    if (seen.has(id)) continue;

    // 从链接向上找到「带封面图、有文字」的最小卡片容器
    let card = anchor;
    for (let depth = 0; depth < 7; depth += 1) {
      if (card.querySelector('img') && clean(card.innerText).length > 3) break;
      if (!card.parentElement) break;
      card = card.parentElement;
    }
    if (!visible(card)) continue;

    const cardText = clean(card.innerText);
    const image = card.querySelector('img');
    const title = textOf(card, [
      '[data-e2e="video-desc"]',
      '[data-e2e="video-title"]',
      'p',
      'span[class*="title"]',
      'div[class*="title"]',
    ]) || clean(anchor.getAttribute('title')) || clean(image?.getAttribute('alt'));

    if (!title) continue;

    const authorLink = card.querySelector('a[href*="/user/"]');
    const author = clean(authorLink?.textContent)
      || textOf(card, ['[data-e2e="video-author"]', 'span[class*="author"]', 'div[class*="author"]']);

    const likeText = textOf(card, ['[data-e2e="video-like-count"]', '[data-e2e*="like"]']);
    const duration = (cardText.match(/\b\d{1,2}:\d{2}\b/) ?? [''])[0];
    const dateMatch = cardText.match(/20\d{2}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}|\d+\s*(?:分钟|小时|天|周|个月|月|年)前|昨天|前天|刚刚/);

    seen.add(id);
    result.push({
      id,
      kind,
      url: `https://www.douyin.com/${kind}/${id}`,
      title,
      author,
      cover: image?.currentSrc || image?.src || '',
      likeText,
      duration,
      dateText: dateMatch ? dateMatch[0] : '',
    });

    if (result.length >= 3000) break;
  }

  return result;
}

/**
 * 把页面原始数据规整成账本条目。
 * @param {Array<Record<string, any>>} raw 页面提取结果。
 * @param {Date} [now] 参照时间。
 * @returns {Array<Record<string, any>>} 规整条目。
 */
export function normalizeExtracted(raw, now = new Date()) {
  const out = [];
  for (const item of raw ?? []) {
    const title = normalizeText(item.title);
    if (!item.id || !title) continue;
    out.push({
      id: String(item.id),
      kind: item.kind === 'note' ? 'note' : 'video',
      url: item.url || `https://www.douyin.com/video/${item.id}`,
      title,
      author: normalizeText(item.author),
      cover: item.cover || '',
      duration: normalizeText(item.duration),
      likeCount: parseCount(item.likeText),
      publishAt: parseDateText(item.dateText, now),
    });
  }
  return out;
}
