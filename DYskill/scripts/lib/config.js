/** 插件配置解析：所有可调项都有安全默认值。 @module dsh-douyin/config */

import os from 'node:os';
import path from 'node:path';
import { clampInt } from './util.js';

/** 默认收藏页地址；抖音网页版这个地址只对当前登录账号有效。 */
export const DEFAULT_FAVORITES_URL = 'https://www.douyin.com/user/self?showTab=favorite_collection';

/**
 * 展开 path 里的 ~ 前缀。
 * @param {string} input 用户填写的路径。
 * @returns {string} 绝对路径。
 */
function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/**
 * 合并用户配置与默认值。
 * @param {Record<string, unknown>} [raw] 命令行或环境变量派生出的配置。
 * @returns {Readonly<Record<string, any>>} 规范化后的配置。
 */
export function resolveConfig(raw = {}) {
  const envDataDir = process.env.DY_DATA_DIR ?? process.env.DSH_DOUYIN_DATA_DIR ?? '';
  const dataDirInput = raw.dataDir ?? envDataDir;
  const dataDir = dataDirInput
    ? path.resolve(expandHome(String(dataDirInput)))
    : path.join(os.homedir(), '.dsh', 'douyin');

  return Object.freeze({
    dataDir,
    statePath: path.join(dataDir, 'state.json'),
    ledgerPath: path.join(dataDir, 'ledger.json'),
    actionLogPath: path.join(dataDir, 'actions.jsonl'),
    qrPath: path.join(dataDir, 'login-qr.png'),
    shotPath: path.join(dataDir, 'last-page.png'),
    dumpPath: path.join(dataDir, 'last-page.html'),

    /** auto = 依次尝试 Chrome、Edge；也可写 chrome / msedge / chromium。 */
    browserChannel: typeof raw.browserChannel === 'string' ? raw.browserChannel : 'auto',
    /** 无头模式容易被抖音验证码拦截，默认有头。 */
    headless: raw.headless === true,
    /** 浏览器窗口尺寸，仅影响布局，不改变账号环境。 */
    viewportWidth: clampInt(raw.viewportWidth, 1024, 2560, 1440),
    viewportHeight: clampInt(raw.viewportHeight, 700, 1600, 900),

    favoritesUrl: typeof raw.favoritesUrl === 'string' && raw.favoritesUrl.startsWith('https://')
      ? raw.favoritesUrl
      : DEFAULT_FAVORITES_URL,

    /** 单次批量取消的上限，配置项本身也收窄到 100。 */
    maxUnfavoritePerRun: clampInt(raw.maxUnfavoritePerRun, 1, 100, 50),
    /** 一轮勾选多少条再点「取消收藏」，太大容易触发风控。 */
    chunkSize: clampInt(raw.chunkSize, 1, 30, 15),
    /** 是否允许真正执行取消收藏；false 时只做演练。 */
    allowDestructive: raw.allowDestructive !== false,
    /** 缺少发布时间时，最多为多少条候选去详情页补时间。 */
    enrichLimit: clampInt(raw.enrichLimit, 0, 60, 20),
    /** 单批扫描条数：每次只抓 150 条新的，上限也是 150。 */
    scanLimit: clampInt(raw.scanLimit, 1, 150, 150),
    /** 单批扫描最多滚动多少次；越往后批次需要越多滚动。 */
    maxScrolls: clampInt(raw.maxScrolls, 1, 600, 120),

    navTimeoutMs: clampInt(raw.navTimeoutMs, 10_000, 120_000, 45_000),
    loginTimeoutMs: clampInt(raw.loginTimeoutMs, 30_000, 600_000, 300_000),
  });
}
