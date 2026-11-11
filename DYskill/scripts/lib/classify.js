/** 收藏视频的粗分类与筛选：全部靠关键词，可离线运行。 @module dsh-douyin/classify */

import { normalizeText } from './text.js';

/**
 * @typedef {object} Category
 * @property {string} id 稳定标识，作为工具参数 types 的取值。
 * @property {string} label 中文名。
 * @property {string[]} keywords 命中词。
 */

/** @type {readonly Category[]} 分类表；顺序影响并列时的优先级。 */
export const CATEGORIES = Object.freeze([
  {
    id: 'food',
    label: '美食',
    keywords: ['美食', '好吃', '探店', '菜谱', '做饭', '烹饪', '厨房', '餐厅', '火锅', '烧烤', '烘焙', '甜点', '咖啡', '奶茶', '早餐', '宵夜', '小吃', '面食', '下饭'],
  },
  {
    id: 'travel',
    label: '旅行',
    keywords: ['旅行', '旅游', '攻略', '自驾', '景点', '酒店', '民宿', '环游', '签证', '机票', '大理', '三亚', '西藏', '新疆', '云南', '川西', '露营', '出游'],
  },
  {
    id: 'tech',
    label: '科技数码',
    keywords: ['手机', '电脑', '评测', '数码', '芯片', '相机', '显卡', '苹果', 'iphone', '华为', '小米', '人工智能', 'ai', '编程', '代码', '软件', '科技', '开源', '模型', '算法'],
  },
  {
    id: 'entertainment',
    label: '影视娱乐',
    keywords: ['电影', '电视剧', '综艺', '解说', '影评', '剧情', '明星', '演唱会', '追剧', '动漫', '番剧', '名场面', '混剪', '剪辑'],
  },
  {
    id: 'knowledge',
    label: '知识教育',
    keywords: ['科普', '知识', '学习', '教程', '英语', '数学', '考试', '历史', '法律', '心理', '读书', '干货', '如何', '为什么', '方法', '思维', '职场', '面试'],
  },
  {
    id: 'fitness',
    label: '健身运动',
    keywords: ['健身', '减脂', '增肌', '跑步', '瑜伽', '训练', '运动', '篮球', '足球', '游泳', '骑行', '拉伸', '体重', '自律', '腹肌'],
  },
  {
    id: 'finance',
    label: '财经商业',
    keywords: ['财经', '股票', '基金', '投资', '理财', '经济', '商业', '创业', '赚钱', '副业', '房产', '保险', '汇率', '消费', '生意'],
  },
  {
    id: 'game',
    label: '游戏',
    keywords: ['游戏', '攻略', '王者', '原神', '吃鸡', '英雄联盟', '主机', 'steam', '手游', '电竞', '开黑'],
  },
  {
    id: 'life',
    label: '生活vlog',
    keywords: ['vlog', '日常', '生活', '记录', '家庭', '装修', '收纳', '亲子', '育儿', '独居', '搬家', '好物'],
  },
  {
    id: 'music',
    label: '音乐舞蹈',
    keywords: ['音乐', '歌曲', '翻唱', '舞蹈', '街舞', '乐器', '吉他', '钢琴', '唱歌', '现场', 'live'],
  },
  {
    id: 'pet',
    label: '萌宠',
    keywords: ['宠物', '猫咪', '狗狗', '萌宠', '铲屎', '猫', '狗'],
  },
  {
    id: 'other',
    label: '其他',
    keywords: [],
  },
]);

/** 分类 id 到 label 的映射。 */
const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * 把用户传入的 types 归一化成 { ids, keywords }。
 * 支持分类 id、中文名，也支持直接写关键词（如「带货」）。
 * @param {string[]} [types] 工具参数。
 * @returns {{ids: Set<string>, keywords: string[]}} 归一化结果。
 */
export function normalizeTypes(types) {
  const ids = new Set();
  const keywords = [];
  for (const raw of types ?? []) {
    const value = normalizeText(raw).toLowerCase();
    if (!value) continue;
    const byId = BY_ID.get(value);
    const byLabel = CATEGORIES.find((c) => c.label.toLowerCase() === value);
    if (byId) ids.add(byId.id);
    else if (byLabel) ids.add(byLabel.id);
    else keywords.push(value);
  }
  return { ids, keywords };
}

/**
 * 给一条收藏打分类标签。
 * @param {{title?:string,author?:string,tags?:string[]}} item 收藏条目。
 * @returns {{type:string,label:string,score:number,hit:string}} 分类结果。
 */
export function classifyItem(item) {
  const title = normalizeText(item.title).toLowerCase();
  const rest = [item.author, ...(item.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
  let best = { type: 'other', label: '其他', score: 0, hit: '' };

  for (const category of CATEGORIES) {
    if (category.id === 'other') continue;
    let score = 0;
    let hit = '';
    for (const keyword of category.keywords) {
      const k = keyword.toLowerCase();
      if (title.includes(k)) {
        score += 2;
        if (!hit) hit = keyword;
      } else if (rest.includes(k)) {
        score += 1;
        if (!hit) hit = keyword;
      }
    }
    if (score > best.score) best = { type: category.id, label: category.label, score, hit };
  }
  return best;
}

/**
 * 按类型与排除词筛选收藏。
 * @param {Array<Record<string, any>>} items 收藏条目。
 * @param {{types?: string[], excludeKeywords?: string[], excludeMatcher?: (item: any, keywords: string[]) => (string|null)}} [options] 筛选条件。
 * @returns {Array<Record<string, any> & {category: string, categoryLabel: string}>} 命中条目（带分类）。
 */
export function filterItems(items, options = {}) {
  const { ids, keywords } = normalizeTypes(options.types);
  const excludeKeywords = options.excludeKeywords ?? [];
  const matcher = options.excludeMatcher;
  const result = [];

  for (const item of items) {
    const category = classifyItem(item);
    const text = [item.title, item.author, ...(item.tags ?? [])].filter(Boolean).join(' ').toLowerCase();

    let typeOk = ids.size === 0 && keywords.length === 0;
    if (!typeOk) typeOk = ids.has(category.type) || keywords.some((k) => text.includes(k));
    if (!typeOk) continue;

    if (excludeKeywords.length > 0) {
      const hit = matcher ? matcher(item, excludeKeywords) : excludeKeywords.find((k) => text.includes(k.toLowerCase()));
      if (hit) continue;
    }

    result.push({ ...item, category: category.type, categoryLabel: category.label });
  }
  return result;
}

/**
 * 按分类分组，组内按时间倒序、组间按数量倒序。
 * @param {Array<Record<string, any> & {category: string, categoryLabel: string}>} items 已分类条目。
 * @param {number} [perGroup] 每组最多保留多少条。
 * @returns {Array<{type:string,label:string,count:number,items:Array<Record<string, any>>}>} 分组结果。
 */
export function groupByCategory(items, perGroup = 12) {
  const groups = new Map();
  for (const item of items) {
    const key = item.category ?? 'other';
    if (!groups.has(key)) {
      groups.set(key, { type: key, label: item.categoryLabel ?? '其他', count: 0, items: [] });
    }
    const group = groups.get(key);
    group.count += 1;
    if (group.items.length < perGroup) group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * 分类 id 对应的中文名。
 * @param {string} type 分类 id。
 * @returns {string} 中文名。
 */
export function labelOf(type) {
  return BY_ID.get(type)?.label ?? type;
}
