/** 扫码登录：打开有头浏览器、截取二维码、等待扫码并落盘登录态。 @module dsh-douyin/login */

import fs from 'node:fs';
import { ensureDir, randomBetween, sleep } from './util.js';
import { isLoggedIn, openDouyin, persistState } from './browser.js';

/**
 * 打开抖音首页，必要时弹出登录二维码并等待扫码。
 * @param {object} params 参数。
 * @param {import('playwright-core').Page} params.page 页面。
 * @param {import('playwright-core').BrowserContext} params.context 上下文。
 * @param {Record<string, any>} params.cfg 插件配置。
 * @param {number} params.timeoutMs 等待扫码的最长时间。
 * @param {boolean} [params.force] 是否清掉旧登录态重新扫。
 * @param {AbortSignal} [params.signal] 取消信号。
 * @returns {Promise<{alreadyLoggedIn:boolean, qrPath:string|null, waitedMs:number}>} 登录结果。
 */
export async function loginWithQr({ page, context, cfg, timeoutMs, force = false, signal }) {
  if (force) {
    await context.clearCookies();
  }

  await page.bringToFront().catch(() => {});
  await openDouyin(page, cfg, 'https://www.douyin.com/');

  if (!force && await isLoggedIn(context)) {
    await persistState(context, cfg);
    return { alreadyLoggedIn: true, qrPath: null, waitedMs: 0 };
  }

  await revealLoginPanel(page);
  const qrPath = await captureQr(page, cfg);

  const started = Date.now();
  let refreshed = false;
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new Error('登录等待已取消');
    if (page.isClosed()) throw new Error('浏览器窗口被关闭，登录未完成。');
    await sleep(2000, signal);
    if (await isLoggedIn(context)) {
      await sleep(1500);
      await persistState(context, cfg);
      await page.screenshot({ path: cfg.shotPath }).catch(() => {});
      return { alreadyLoggedIn: false, qrPath, waitedMs: Date.now() - started };
    }
    // 二维码约两分钟过期，等在原地超过 120 秒才刷新一次，避免打断正在扫码的用户
    if (!refreshed && Date.now() - started > 120_000 && !page.isClosed()) {
      refreshed = true;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(1500);
      await revealLoginPanel(page);
      await captureQr(page, cfg);
    }
  }

  throw new Error(`等待扫码超时（${Math.round(timeoutMs / 1000)} 秒）。二维码可能已过期，请重新调用 douyin_login。`);
}

/**
 * 确保登录面板可见：没有就点首页右上角的「登录」。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<void>} 完成。
 */
async function revealLoginPanel(page) {
  const hasPanel = await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    return /扫码登录|二维码登录/.test(text);
  }).catch(() => false);
  if (hasPanel) return;

  const loginButton = await page.evaluateHandle(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, '').trim();
    const own = (el) => clean(Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join(''));
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      .filter((el) => visible(el) && /^(登录|立即登录|登录\/注册)$/.test(own(el)));
    return candidates[0] ?? null;
  });
  const button = loginButton.asElement();
  if (button) {
    await button.click({ timeout: 3000 }).catch(() => button.evaluate((el) => el.click()).catch(() => {}));
    await sleep(randomBetween(1200, 2000));
  }
}

/**
 * 截取二维码面板；失败时退化为整页截图。
 * @param {import('playwright-core').Page} page 页面。
 * @param {Record<string, any>} cfg 插件配置。
 * @returns {Promise<string|null>} 截图路径。
 */
async function captureQr(page, cfg) {
  ensureDir(cfg.dataDir);
  const panelHandle = await page.evaluateHandle(() => {
    const selectors = [
      '#login-pannel',
      '[data-e2e="login-panel"]',
      'div[class*="login-panel"]',
      'div[class*="login-container"]',
      'div[class*="login-modal"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().width > 200) return el;
    }
    return null;
  });
  const panel = panelHandle.asElement();
  try {
    if (panel) {
      await panel.screenshot({ path: cfg.qrPath });
    } else {
      await page.screenshot({ path: cfg.qrPath });
    }
    return fs.existsSync(cfg.qrPath) ? cfg.qrPath : null;
  } catch {
    return null;
  }
}
