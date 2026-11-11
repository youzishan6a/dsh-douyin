/** 通用小工具：等待、限幅、随机延迟、目录创建。 @module dsh-douyin/util */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 可被中断的 sleep。工具调用被取消时立刻抛出，避免挂住会话。
 * @param {number} ms 毫秒。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<void>} 计时结束或被取消。
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** @returns {Error} 统一的取消错误。 */
export function abortError() {
  const err = new Error('操作已取消');
  err.name = 'AbortError';
  return err;
}

/**
 * 把未知输入裁成区间内的整数。
 * @param {unknown} value 原始值。
 * @param {number} min 下界。
 * @param {number} max 上界。
 * @param {number} fallback 非法输入时的默认值。
 * @returns {number} 合法整数。
 */
export function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * 区间随机整数，用于给页面操作加自然抖动。
 * @param {number} min 下界（含）。
 * @param {number} max 上界（含）。
 * @returns {number} 随机整数。
 */
export function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 递归创建目录（已存在则忽略）。
 * @param {string} dir 目录绝对路径。
 * @returns {void}
 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * 原子写入 JSON：先写临时文件再重命名，避免半截文件。
 * @param {string} file 目标文件。
 * @param {unknown} value 可序列化数据。
 * @returns {void}
 */
export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * 读取 JSON，文件不存在或损坏时返回兜底值。
 * @param {string} file 文件路径。
 * @param {unknown} fallback 兜底值。
 * @returns {unknown} 解析结果或兜底值。
 */
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * 当前时间的 ISO 字符串。
 * @returns {string} 例如 2026-11-12T02:30:00.000Z。
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * 把 ISO 时间格式化成「2026-11-12 02:30」这类本地短格式。
 * @param {string|null|undefined} iso ISO 时间。
 * @returns {string} 本地时间，未知则返回空字符串。
 */
export function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
