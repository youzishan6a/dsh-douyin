/** 文本清洗与轻量解析：标题、点赞数、日期、排除词。 @module dsh-douyin/text */

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\ufeff]/g;

/**
 * 去掉零宽字符、压缩空白。
 * @param {unknown} input 任意文本。
 * @returns {string} 规整后的文本。
 */
export function normalizeText(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

/**
 * 截断过长文本，保留完整语义单位。
 * @param {string} input 原文。
 * @param {number} max 最大长度。
 * @returns {string} 截断结果。
 */
export function truncate(input, max) {
  const text = normalizeText(input);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * 把「1.2万」「3.4w」「12,345」解析成整数。
 * @param {unknown} input 页面上的计数文本。
 * @returns {number|null} 数值，无法解析时为 null。
 */
export function parseCount(input) {
  const text = normalizeText(input).toLowerCase().replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*([万亿wkm]?)/);
  if (!match) return null;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = match[2];
  const scale = unit === '万' || unit === 'w' ? 10_000 : 0;
  const kScale = unit === 'k' ? 1_000 : 0;
  const mScale = unit === 'm' ? 1_000_000 : 0;
  const yiScale = unit === '亿' ? 100_000_000 : 0;
  return Math.round(base * (scale + kScale + mScale + yiScale || 1));
}

/**
 * 解析抖音卡片上可能出现的日期/相对时间。
 * 卡片本身多数不显示日期，因此失败是常态，调用方需容忍 null。
 * @param {unknown} input 文本。
 * @param {Date} [now] 参照时间。
 * @returns {string|null} ISO 时间。
 */
export function parseDateText(input, now = new Date()) {
  const text = normalizeText(input);
  if (!text) return null;

  const absolute = text.match(/(20\d{2})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})/);
  if (absolute) {
    const [, y, m, d] = absolute;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const monthDay = text.match(/^(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?$/);
  if (monthDay) {
    const date = new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), 12, 0, 0);
    if (date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1);
    return date.toISOString();
  }

  if (/刚刚|刚才/.test(text)) return new Date(now.getTime() - 60_000).toISOString();
  if (/昨天/.test(text)) return new Date(now.getTime() - 86_400_000).toISOString();
  if (/前天/.test(text)) return new Date(now.getTime() - 2 * 86_400_000).toISOString();

  const relative = text.match(/(\d+)\s*(分钟|小时|天|周|个月|月|年)前/);
  if (relative) {
    const value = Number(relative[1]);
    const unit = relative[2];
    const table = {
      分钟: 60_000,
      小时: 3_600_000,
      天: 86_400_000,
      周: 7 * 86_400_000,
      个月: 30 * 86_400_000,
      月: 30 * 86_400_000,
      年: 365 * 86_400_000,
    };
    return new Date(now.getTime() - value * table[unit]).toISOString();
  }

  return null;
}

const EXCLUDE_STOPWORDS = new Set([
  '不要', '别', '不', '除了', '排除', '去掉', '不看', '不要总结', '总结', '视频', '内容',
  '的', '了', '和', '与', '及', '或者', '或', '类型', '这类', '这种', '那些', '还有', '以及',
]);

/**
 * 把用户自由描述的排除条件拆成关键词。
 * 例：「不要总结带货和直播切片」→ ['带货', '直播切片']。
 * 对「和平精英」这类含连接词但不可拆的词，会整体保留。
 * @param {unknown} input 自然语言描述。
 * @returns {string[]} 去重后的关键词。
 */
export function splitExcludeKeywords(input) {
  const text = normalizeText(input);
  if (!text) return [];

  const trimmed = text
    .replace(/^(不要|别|不用|除了|排除|去掉|不看|不想看|不需要)\s*/g, '')
    .replace(/^(总结|归纳|整理)(一下)?\s*/g, '');

  const cleanPart = (part) => normalizeText(part)
    .replace(/^(不要|别|除了|排除|去掉|不看|不想看|不需要)/, '')
    .replace(/(类型|类|的视频|视频|内容)$/g, '')
    .trim();

  const rawParts = trimmed
    .split(/[，,、;；。\s]+|以及|还有|和|与|跟/)
    .map(cleanPart)
    .filter(Boolean);

  // 只要有一侧过短，就说明这个连接词属于词本身（如「和牛」「和平精英」），整体保留
  const parts = rawParts.length > 1 && rawParts.some((part) => part.length < 2)
    ? [cleanPart(trimmed)]
    : rawParts;

  return [...new Set(parts.filter((part) => part.length > 0 && !EXCLUDE_STOPWORDS.has(part)))];
}

/**
 * 判断一条收藏是否命中排除词。
 * @param {{title?:string,author?:string,tags?:string[]}} item 收藏条目。
 * @param {string[]} keywords 排除关键词。
 * @returns {string|null} 命中的关键词，未命中为 null。
 */
export function matchExclude(item, keywords) {
  if (!keywords?.length) return null;
  const haystack = [item.title, item.author, ...(item.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) return keyword;
  }
  return null;
}
