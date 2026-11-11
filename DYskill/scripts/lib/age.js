/** 按「多久之前」挑选收藏条目。 @module dsh-douyin/age */

import { normalizeText } from './text.js';

const DAY_MS = 86_400_000;

/**
 * 取用于比较的时间。
 * @param {Record<string, any>} item 收藏条目。
 * @param {'publish'|'firstSeen'} basis 时间基准。
 * @returns {string|null} ISO 时间。
 */
export function ageDateOf(item, basis) {
  if (basis === 'firstSeen') return item.firstSeenAt ?? null;
  return item.publishAt ?? null;
}

/**
 * 拆出「够老」「太新」「时间未知」三组，供工具如实汇报。
 * @param {Array<Record<string, any>>} items 候选条目。
 * @param {{olderThanDays:number, ageBasis?:'publish'|'firstSeen', now?:Date}} options 条件。
 * @returns {{eligible:Array<Record<string, any>>, newer:Array<Record<string, any>>, unknown:Array<Record<string, any>>, cutoffIso:string, ageBasis:string}} 分组结果。
 */
export function selectOlderThan(items, options) {
  const { olderThanDays, ageBasis = 'publish', now = new Date() } = options;
  const cutoff = now.getTime() - Math.max(1, olderThanDays) * DAY_MS;
  const eligible = [];
  const newer = [];
  const unknown = [];

  for (const item of items) {
    const iso = ageDateOf(item, ageBasis);
    const time = iso ? Date.parse(iso) : Number.NaN;
    if (!iso || Number.isNaN(time)) {
      unknown.push(item);
      continue;
    }
    if (time <= cutoff) {
      eligible.push({
        ...item,
        ageBasis,
        ageDate: iso,
        ageDays: Math.floor((now.getTime() - time) / DAY_MS),
      });
    } else {
      newer.push(item);
    }
  }

  eligible.sort((a, b) => Date.parse(a.ageDate) - Date.parse(b.ageDate));
  return { eligible, newer, unknown, cutoffIso: new Date(cutoff).toISOString(), ageBasis };
}

/**
 * 生成人类可读的时间基准说明，避免用户误解「收藏时间」。
 * @param {'publish'|'firstSeen'} basis 时间基准。
 * @returns {string} 说明文本。
 */
export function describeBasis(basis) {
  return basis === 'firstSeen'
    ? '本工具首次扫描到这条收藏的时间（抖音网页版不提供收藏时间，只能自己记账）'
    : normalizeText('视频的发布时间（抖音网页版不提供收藏时间，用发布时间近似）');
}
