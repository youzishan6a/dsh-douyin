/** 浏览器会话：启动本地 Chrome/Edge、复用登录态、页面操作助手。 @module dsh-douyin/browser */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureDir, randomBetween, sleep } from './util.js';

/** 同一时刻只允许一个抖音操作，避免两个窗口抢同一个登录态文件。 */
let busy = false;

/**
 * 独占执行一段浏览器操作。
 * @template T
 * @param {Record<string, any>} cfg 插件配置。
 * @param {(session: {browser: import('playwright-core').Browser, context: import('playwright-core').BrowserContext, page: import('playwright-core').Page}) => Promise<T>} fn 操作体。
 * @param {{signal?: AbortSignal}} [options] 取消信号。
 * @returns {Promise<T>} 操作结果。
 */
export async function withBrowser(cfg, fn, options = {}) {
  if (busy) {
    throw new Error('已有另一个抖音操作正在进行（登录/扫描/取消收藏），请等它结束后再试。');
  }
  busy = true;
  let browser;
  try {
    browser = await launchBrowser(cfg);
    const context = await createContext(cfg, browser);
    const page = await context.newPage();
    page.setDefaultTimeout(cfg.navTimeoutMs);
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    const onAbort = () => {
      browser?.close().catch(() => {});
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fn({ browser, context, page });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    await browser?.close().catch(() => {});
    busy = false;
  }
}

/**
 * 依次尝试本机 Chrome、Edge；都不可用时再退回 Playwright 自带 Chromium。
 * @param {Record<string, any>} cfg 插件配置。
 * @returns {Promise<import('playwright-core').Browser>} 浏览器实例。
 */
async function launchBrowser(cfg) {
  const preferred = cfg.browserChannel && cfg.browserChannel !== 'auto'
    ? [cfg.browserChannel]
    : ['chrome', 'msedge'];
  const failures = [];

  for (const channel of preferred) {
    try {
      return await chromium.launch({
        channel,
        headless: cfg.headless,
        args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
      });
    } catch (error) {
      failures.push(`${channel}: ${String(error.message).split('\n')[0]}`);
    }
  }

  try {
    return await chromium.launch({ headless: cfg.headless });
  } catch (error) {
    failures.push(`chromium: ${String(error.message).split('\n')[0]}`);
  }

  throw new Error(
    `无法启动浏览器。已尝试：${failures.join(' | ')}\n`
    + '请确认本机装有 Chrome 或 Edge；也可以执行 npx playwright install chromium 安装内置浏览器。',
  );
}

/**
 * 建立浏览器上下文，自动复用已保存的登录态。
 * @param {Record<string, any>} cfg 插件配置。
 * @param {import('playwright-core').Browser} browser 浏览器。
 * @returns {Promise<import('playwright-core').BrowserContext>} 上下文。
 */
async function createContext(cfg, browser) {
  const hasState = fs.existsSync(cfg.statePath);
  return browser.newContext({
    locale: 'zh-CN',
    viewport: { width: cfg.viewportWidth, height: cfg.viewportHeight },
    ...(hasState ? { storageState: cfg.statePath } : {}),
  });
}

/**
 * 判断当前上下文是否已登录抖音。
 * 抖音登录后一定会下发 sessionid 系 cookie，用它判断比看页面元素稳定。
 * @param {import('playwright-core').BrowserContext} context 上下文。
 * @returns {Promise<boolean>} 是否已登录。
 */
export async function isLoggedIn(context) {
  const cookies = await context.cookies(['https://www.douyin.com', 'https://www.douyin.com/']);
  const names = new Set(cookies.filter((c) => c.value).map((c) => c.name));
  return names.has('sessionid') || names.has('sessionid_ss');
}

/**
 * 把当前登录态写入磁盘（权限 600，含 cookie，切勿提交到 git）。
 * @param {import('playwright-core').BrowserContext} context 上下文。
 * @param {Record<string, any>} cfg 插件配置。
 * @returns {Promise<void>} 写入完成。
 */
export async function persistState(context, cfg) {
  ensureDir(path.dirname(cfg.statePath));
  await context.storageState({ path: cfg.statePath });
  try {
    fs.chmodSync(cfg.statePath, 0o600);
  } catch {
    // Windows 上 chmod 可能无效，忽略。
  }
}

/**
 * 打开抖音页面并做基础风控检查。
 * @param {import('playwright-core').Page} page 页面。
 * @param {Record<string, any>} cfg 插件配置。
 * @param {string} url 目标地址。
 * @returns {Promise<void>} 打开完成。
 */
export async function openDouyin(page, cfg, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.navTimeoutMs });
  await sleep(randomBetween(1200, 2200));
  await assertNoCaptcha(page);
  const title = await page.title();
  if (title.includes('验证码')) {
    throw new Error('抖音返回了验证码中间页。请在有头模式下打开一次浏览器手动通过验证，再重试。');
  }
}

/**
 * 检测是否被拦到验证码/滑块页。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<void>} 命中则抛错。
 */
async function assertNoCaptcha(page) {
  const url = page.url();
  if (/captcha|verify/i.test(url)) {
    throw new Error('抖音要求完成人机验证。请设置 headless: false，在弹出的窗口里手动验证后重试。');
  }
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '').catch(() => '');
  if (/请完成下列验证|拖动滑块|滑动验证/.test(text)) {
    throw new Error('抖音要求完成滑块验证。请设置 headless: false，在弹出的窗口里手动验证后重试。');
  }
}

/**
 * 在页面里按「元素自身文本」查找可点击元素。
 * 只看直接文本节点，避免匹配到包着一堆卡片的父容器。
 * @param {import('playwright-core').Page} page 页面。
 * @param {string} regexSource 正则源码（不带斜杠），按整段文本匹配。
 * @returns {Promise<import('playwright-core').ElementHandle|null>} 元素句柄。
 */
export async function findClickable(page, regexSource) {
  const handle = await page.evaluateHandle((src) => {
    const re = new RegExp(src, 'i');
    const ownText = (el) => Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? '')
      .join('')
      .replace(/\s+/g, '')
      .trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    const all = Array.from(document.querySelectorAll('button, [role="button"], a, span, div, label'));
    const hits = all.filter((el) => re.test(ownText(el)) && visible(el));
    // 优先取最内层：没有子元素也命中同一正则
    const deepest = hits.find((el) => !Array.from(el.children).some((child) => re.test(ownText(child))));
    return deepest ?? hits[0] ?? null;
  }, regexSource);
  return handle.asElement();
}

/**
 * 点击元素；Playwright 的真实点击失败时退回 DOM click。
 * @param {import('playwright-core').ElementHandle|null} handle 元素句柄。
 * @returns {Promise<boolean>} 是否点到了。
 */
export async function clickHandle(handle) {
  if (!handle) return false;
  try {
    await handle.click({ timeout: 3000 });
    return true;
  } catch {
    try {
      await handle.evaluate((el) => el.click());
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 滚动收藏列表。抖音个人页的滚动容器是 div.route-scroll-container，不是 window。
 * @param {import('playwright-core').Page} page 页面。
 * @param {number} [ratio] 滚动比例（相对可视高度）。
 * @returns {Promise<{atBottom:boolean, scrollTop:number, scrollHeight:number}>} 滚动状态。
 */
export async function scrollList(page, ratio = 0.9) {
  return page.evaluate((r) => {
    const findScrollable = () => {
      const direct = document.querySelector('div.route-scroll-container');
      if (direct && direct.scrollHeight > direct.clientHeight + 50) return direct;
      let node = document.querySelector('div.route-scroll-container') ?? document.body;
      while (node && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 50) return node;
        node = node.parentElement;
      }
      return document.scrollingElement ?? document.documentElement;
    };
    const el = findScrollable();
    const step = Math.round(el.clientHeight * r);
    el.scrollBy({ top: step, behavior: 'instant' });
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 240;
    return { atBottom, scrollTop: Math.round(el.scrollTop), scrollHeight: Math.round(el.scrollHeight) };
  }, ratio);
}

/**
 * 回到列表顶部。
 * @param {import('playwright-core').Page} page 页面。
 * @returns {Promise<void>} 完成。
 */
export async function scrollToTop(page) {
  await page.evaluate(() => {
    const el = document.querySelector('div.route-scroll-container');
    if (el) el.scrollTo({ top: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await sleep(400);
}

/**
 * 保存页面截图与 HTML，用于选择器失效时排查。
 * @param {import('playwright-core').Page} page 页面。
 * @param {Record<string, any>} cfg 插件配置。
 * @returns {Promise<{screenshot:string, html:string}>} 落盘路径。
 */
export async function dumpPage(page, cfg) {
  ensureDir(cfg.dataDir);
  await page.screenshot({ path: cfg.shotPath, fullPage: false }).catch(() => {});
  const html = await page.content().catch(() => '');
  fs.writeFileSync(cfg.dumpPath, html, 'utf8');
  return { screenshot: cfg.shotPath, html: cfg.dumpPath };
}
