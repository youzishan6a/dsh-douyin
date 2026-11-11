/** 批量取消收藏：走抖音自带的「批量管理 → 勾选 → 取消收藏 → 确认」流程。 @module dsh-douyin/unfavorite */

import { clickHandle, findClickable, scrollList, scrollToTop } from './browser.js';
import { randomBetween, sleep } from './util.js';

const RISK_PATTERN = /操作频繁|请求过于频繁|访问频繁|操作太快|稍后再试|网络繁忙|系统繁忙/;

/**
 * 执行批量取消收藏。
 * 只勾选传入的 id，绝不全选；每轮都会校验并记录成功/失败。
 * @param {object} params 参数。
 * @param {import('playwright-core').Page} params.page 页面。
 * @param {Record<string, any>} params.cfg 插件配置。
 * @param {string[]} params.ids 目标视频 id。
 * @param {AbortSignal} [params.signal] 取消信号。
 * @param {(message:string)=>void} [params.log] 进度回调。
 * @returns {Promise<{succeeded:string[], failed:Array<{id:string,reason:string}>, stoppedBy:string, rounds:number}>} 执行结果。
 */
export async function unfavoriteIds({ page, cfg, ids, signal, log = () => {} }) {
  const remaining = new Set(ids);
  const succeeded = [];
  const failed = [];
  let stoppedBy = 'done';
  let rounds = 0;

  const entered = await ensureBatchMode(page);
  if (!entered) {
    return {
      succeeded,
      failed: ids.map((id) => ({ id, reason: '未能进入批量管理模式（页面结构可能已更新）' })),
      stoppedBy: 'batch-mode-unavailable',
      rounds,
    };
  }

  await scrollToTop(page);
  const maxRounds = Math.ceil(ids.length / cfg.chunkSize) + 12;
  let emptyScrolls = 0;

  while (remaining.size > 0 && rounds < maxRounds) {
    if (signal?.aborted) {
      stoppedBy = 'aborted';
      break;
    }
    rounds += 1;

    const visibleIds = await page.evaluate((wanted) => {
      const set = new Set(wanted);
      const found = [];
      for (const anchor of document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]')) {
        const match = anchor.href.match(/\/(video|note)\/(\d{6,})/);
        if (match && set.has(match[2])) found.push(match[2]);
      }
      return [...new Set(found)];
    }, [...remaining]);

    if (visibleIds.length === 0) {
      const status = await scrollList(page);
      if (status.atBottom) {
        emptyScrolls += 1;
        if (emptyScrolls >= 2) {
          stoppedBy = 'targets-not-found';
          break;
        }
        await sleep(randomBetween(1200, 1800));
      } else {
        await sleep(randomBetween(700, 1100));
      }
      continue;
    }
    emptyScrolls = 0;

    const selected = await selectCards(page, visibleIds.slice(0, cfg.chunkSize), log);
    if (selected.length === 0) {
      stoppedBy = 'select-failed';
      break;
    }
    log(`已勾选 ${selected.length} 条，准备取消收藏`);

    const action = await performBatchCancel(page);
    if (!action.clicked) {
      stoppedBy = 'cancel-button-missing';
      break;
    }
    await sleep(randomBetween(1500, 2400));

    for (const id of selected) {
      const exists = await cardExists(page, id);
      if (!exists) {
        succeeded.push(id);
        remaining.delete(id);
      } else {
        failed.push({ id, reason: action.confirmed ? '点击确认后仍未消失' : '未出现确认弹窗' });
        remaining.delete(id);
      }
    }

    const risk = await detectRisk(page);
    if (risk) {
      stoppedBy = `risk-control: ${risk}`;
      break;
    }

    await sleep(randomBetween(1200, 2400));
  }

  if (remaining.size > 0 && stoppedBy === 'done') stoppedBy = 'round-limit';
  await exitBatchMode(page);

  return {
    succeeded,
    failed: [...failed, ...[...remaining].map((id) => ({ id, reason: '未执行（提前结束）' }))],
    stoppedBy,
    rounds,
  };
}

/**
 * 进入批量管理模式。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<boolean>} 是否已进入。
 */
async function ensureBatchMode(page) {
  if (await hasCheckbox(page)) return true;
  // 「批量管理」偶尔点一次不生效，最多重试三次
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const button = await findClickable(page, '^批量管理$');
    if (!button) {
      await sleep(400);
      continue;
    }
    await clickHandle(button);
    for (let i = 0; i < 8; i += 1) {
      await sleep(350);
      if (await hasCheckbox(page)) return true;
    }
    await sleep(500);
  }
  return false;
}

/**
 * 退出批量管理模式（尽力而为，失败不影响结果）。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<void>} 完成。
 */
async function exitBatchMode(page) {
  try {
    const button = await findClickable(page, '^(退出管理|取消管理|完成)$');
    if (button) await clickHandle(button);
  } catch {
    // 忽略。
  }
}

/**
 * 页面上是否存在勾选框。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<boolean>} 是否存在。
 */
async function hasCheckbox(page) {
  return page.evaluate(() => Boolean(document.querySelector('input[type="checkbox"], .semi-checkbox'))).catch(() => false);
}

/**
 * 找到某条视频所在的卡片容器。
 * @param {import('playwright-core').Page} page 页面。
 * @param {string} id 视频 id。
 * @returns {Promise<import('playwright-core').ElementHandle|null>} 卡片元素。
 */
async function findCard(page, id) {
  const handle = await page.evaluateHandle((videoId) => {
    const anchors = Array.from(document.querySelectorAll(`a[href*="/video/${videoId}"], a[href*="/note/${videoId}"]`));
    const anchor = anchors.find((el) => el.getBoundingClientRect().width > 1) ?? anchors[0];
    if (!anchor) return null;
    let node = anchor;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      if (node.querySelector?.('input[type="checkbox"], .semi-checkbox')) return node;
      node = node.parentElement;
    }
    return anchor.parentElement;
  }, id);
  return handle.asElement();
}

/**
 * 读取卡片当前的勾选状态。
 * @param {import('playwright-core').ElementHandle} card 卡片元素。
 * @returns {Promise<boolean>} 是否已勾选。
 */
async function isChecked(card) {
  return card.evaluate((el) => {
    const input = el.querySelector('input[type="checkbox"]');
    if (input) return Boolean(input.checked);
    const box = el.querySelector('.semi-checkbox, [class*="checkbox"]');
    const cls = typeof box?.className === 'string' ? box.className : '';
    return /-checked|checkbox-checked/.test(cls);
  }).catch(() => false);
}

/**
 * 依次勾选目标卡片。
 * @param {import('playwright-core').Page} page 页面。
 * @param {string[]} ids 目标 id。
 * @param {(message:string)=>void} log 日志回调。
 * @returns {Promise<string[]>} 已勾选的 id。
 */
async function selectCards(page, ids, log) {
  const selected = [];
  for (const id of ids) {
    const card = await findCard(page, id);
    if (!card) continue;
    if (await isChecked(card)) {
      selected.push(id);
      continue;
    }
    const box = (await card.$('.semi-checkbox')) ?? (await card.$('input[type="checkbox"]'));
    if (!box) {
      log(`第 ${id} 条未找到勾选框`);
      continue;
    }
    const clicked = await clickHandle(box);
    await sleep(randomBetween(180, 420));
    if (clicked && await isChecked(card)) selected.push(id);
    else log(`第 ${id} 条勾选失败`);
  }
  return selected;
}

/**
 * 点击顶部「取消收藏(N)」并在弹窗中确认。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<{clicked:boolean, confirmed:boolean}>} 操作结果。
 */
async function performBatchCancel(page) {
  const button = await findClickable(page, '^(批量)?取消(收藏|喜欢)(\\s*[\\(（]\\d+[\\)）])?$')
    ?? await findClickable(page, '^移出(收藏|喜欢)(\\s*[\\(（]\\d+[\\)）])?$');
  if (!button) return { clicked: false, confirmed: false };
  const clicked = await clickHandle(button);
  if (!clicked) return { clicked: false, confirmed: false };

  await sleep(randomBetween(600, 1000));
  const confirm = await findConfirmButton(page);
  if (!confirm) {
    // 少数情况下没有二次确认，视为已完成。
    return { clicked: true, confirmed: false };
  }
  let confirmed = await clickHandle(confirm);
  await sleep(700);
  // 部分版本弹窗不会立刻关闭，需要再点一次
  if (await dialogVisible(page)) {
    const again = await findConfirmButton(page);
    if (again) confirmed = await clickHandle(again) || confirmed;
  }
  return { clicked: true, confirmed };
}

/**
 * 是否仍有可见弹窗。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<boolean>} 是否存在。
 */
async function dialogVisible(page) {
  return page.evaluate(() => {
    const scopes = Array.from(document.querySelectorAll('[role="dialog"], .semi-modal, div[class*="modal"], div[class*="dialog"]'));
    return scopes.some((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });
  }).catch(() => false);
}

/**
 * 在弹窗范围内找确认按钮，避免误点页面上的其他「取消」。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<import('playwright-core').ElementHandle|null>} 确认按钮。
 */
async function findConfirmButton(page) {
  const handle = await page.evaluateHandle(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, '').trim();
    const own = (el) => clean(Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join(''));
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const scopes = Array.from(document.querySelectorAll('[role="dialog"], .semi-modal, div[class*="modal"], div[class*="dialog"]'))
      .filter(visible);
    const re = /^(确认取消|确定|确认|确认取消收藏)$/;
    for (const scope of scopes) {
      const hit = Array.from(scope.querySelectorAll('button, [role="button"], span, div'))
        .find((el) => visible(el) && re.test(own(el)));
      if (hit) return hit;
    }
    return null;
  });
  return handle.asElement();
}

/**
 * 判断卡片是否还在页面上。
 * @param {import('playwright-core').Page} page 页面。
 * @param {string} id 视频 id。
 * @returns {Promise<boolean>} 是否仍存在。
 */
async function cardExists(page, id) {
  return page.evaluate((videoId) => Boolean(
    document.querySelector(`a[href*="/video/${videoId}"], a[href*="/note/${videoId}"]`),
  ), id).catch(() => true);
}

/**
 * 检测风控提示文案。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<string|null>} 命中的提示，未命中为 null。
 */
async function detectRisk(page) {
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '').catch(() => '');
  const match = text.match(RISK_PATTERN);
  return match ? match[0] : null;
}
