/** 把命令结果渲染成中文文本；CLI 的 --json 模式不经过这里。 @module dy-skill/report */

import { shortTime } from './util.js';

/**
 * 登录结果。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
export function login(value) {
  if (value.alreadyLoggedIn) {
    return `抖音已是登录状态（复用本地登录态）。\n登录态文件：${value.statePath}`;
  }
  return [
    `抖音登录成功，用时 ${value.waitedSeconds} 秒。`,
    `登录态已保存：${value.statePath}`,
    value.qrPath ? `二维码截图：${value.qrPath}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 状态概览。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
export function status(value) {
  return [
    `本地登录态：${value.sessionExists ? `已保存（${shortTime(value.sessionSavedAt)}，cookie ${value.cookieCount} 条）` : '未保存'}`,
    value.probed
      ? `真实登录校验：${value.loggedIn ? '有效' : '已失效，需要重新登录'}`
      : '真实登录校验：未执行（加 --probe 可校验）',
    `收藏账本：共 ${value.total} 条，仍在收藏 ${value.active} 条，其中有发布时间 ${value.withPublishDate} 条`,
    `最近账本更新：${value.lastScanAt ? shortTime(value.lastScanAt) : '从未扫描'}`,
    `数据目录：${value.dataDir}`,
  ].join('\n');
}

/**
 * 扫描结果。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
export function scan(value) {
  const lines = [
    `扫描完成：本批抓到 ${value.scanned} 条（上限 150），跳过已扫描 ${value.skippedKnown} 条，新增 ${value.added} 条，账本累计 ${value.total} 条。`,
    `滚动 ${value.rounds} 次${value.reachedBottom ? '，已到列表底部' : '，未到列表底部'}${
      value.stoppedBy === 'max-scrolls' ? '（达到滚动上限，可加大 --max-scrolls 继续）' : ''
    }。`,
  ];
  if (value.samples.length > 0) {
    lines.push('样例：');
    for (const [index, item] of value.samples.entries()) {
      lines.push(`${index + 1}. ${item.title} — ${item.author || '未知作者'}`);
    }
  }
  lines.push(`账本：${value.ledgerPath}`);
  lines.push('说明：每次命令都是独立进程，批次计数从 1 开始；已扫描清单记在账本里，重复执行会继续往下抓 150 条新的。');
  return lines.join('\n');
}

/**
 * 归纳素材。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
export function summary(value) {
  const lines = [
    '# 抖音收藏归纳素材',
    `筛选后 ${value.matched} 条 / 在收藏 ${value.activeTotal} 条`,
  ];
  if (value.filters.types.length > 0) lines.push(`类型：${value.filters.types.join('、')}`);
  if (value.filters.exclude) lines.push(`排除：${value.filters.exclude}`);
  if (value.filters.sinceDays > 0) lines.push(`时间范围：最近 ${value.filters.sinceDays} 天`);
  lines.push('');

  for (const group of value.groups) {
    lines.push(`## ${group.label}（${group.count} 条）`);
    for (const [index, item] of group.items.entries()) {
      const meta = [item.author, item.publishAt ? item.publishAt.slice(0, 10) : '时间未知', item.duration]
        .filter(Boolean)
        .join('｜');
      lines.push(`${index + 1}. ${item.title}（${meta}）${item.url}`);
    }
    if (group.count > group.items.length) lines.push(`…另有 ${group.count - group.items.length} 条未列出`);
    lines.push('');
  }

  lines.push('以上是原始素材，请据此写归纳；不要补充未列出的视频。');
  return lines.join('\n');
}

/**
 * 版本检查结果。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
export function update(value) {
  if (value.status === 'up-to-date') {
    return `已是最新版本 v${value.currentVersion}（GitHub 上也是 v${value.latestVersion}）。`;
  }
  if (value.status === 'update-available') {
    return [
      `发现新版本 v${value.latestVersion}（当前 v${value.currentVersion}）。`,
      '本次未修改文件；去掉 --check-only 重新执行即可更新。',
    ].join('\n');
  }
  return [
    `已更新 v${value.currentVersion} → v${value.latestVersion}，替换 ${value.updatedFiles.length} 个文件。`,
    `旧文件备份后缀：${value.backupSuffix}`,
    '登录态与收藏账本未改动；下一次命令自动使用新版本。',
    value.backupSuffix ? `如需回退，把对应 ${value.backupSuffix} 文件改回原名即可。` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 取消收藏结果。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
export function unfavorite(value) {
  const lines = [];
  if (value.mode === 'dryRun') {
    lines.push('演练模式（未删除任何收藏）');
  } else {
    lines.push(`已执行取消收藏：成功 ${value.succeeded.length} 条，失败 ${value.failed.length} 条`);
  }
  lines.push(`条件：${value.olderThanDays} 天之前；时间基准：${value.basisNote}`);
  lines.push(`截止时间：${shortTime(value.cutoffIso)}`);
  lines.push(`命中 ${value.eligibleCount} 条，本次处理 ${value.plannedCount} 条，时间未知 ${value.unknownAgeCount} 条（不会处理）`);
  if (value.enrichedCount > 0) lines.push(`本次补全了 ${value.enrichedCount} 条发布时间`);

  if (value.candidates.length > 0) {
    lines.push('');
    lines.push(value.mode === 'dryRun' ? '待处理清单：' : '本次处理清单：');
    for (const [index, item] of value.candidates.entries()) {
      lines.push(`${index + 1}. ${item.title}（${item.author}｜${item.category}｜${item.ageDate}，${item.ageDays} 天）${item.url}`);
    }
  }

  if (value.failed.length > 0) {
    lines.push('');
    lines.push('失败：');
    for (const entry of value.failed.slice(0, 10)) lines.push(`- ${entry.id}：${entry.reason}`);
  }

  if (value.mode === 'dryRun') {
    lines.push('');
    lines.push('确认无误后，追加 --execute --confirm 才会真正执行。');
  } else if (value.stoppedBy !== 'done') {
    lines.push('');
    lines.push(`提前结束原因：${value.stoppedBy}`);
  }
  return lines.join('\n');
}
