/** 五个模型可调用的工具：登录、状态、扫描、归纳、按时间取消收藏。 @module dsh-douyin/tools */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { dumpPage, isLoggedIn, withBrowser } from './browser.js';
import { activeItems, appendActionLog, describeSession, markUnfavorited, mergeItems, readLedger, writeLedger } from './store.js';
import { filterItems, groupByCategory } from './classify.js';
import { describeBasis, selectOlderThan } from './age.js';
import { matchExclude, normalizeText, splitExcludeKeywords, truncate } from './text.js';
import { LoginRequiredError, openFavorites, scanFavorites } from './favorites.js';
import { loginWithQr } from './login.js';
import { unfavoriteIds } from './unfavorite.js';
import { enrichPublishDates } from './enrich.js';
import { clampInt, shortTime } from './util.js';

const DESTRUCTIVE_HINT = '默认只演练不执行；真正执行必须传 confirm=true，且用户已明确同意。';

/**
 * 把未登录错误换成带操作指引的提示。
 * @param {unknown} error 原始错误。
 * @returns {never} 抛出可读错误。
 */
function rethrowFriendly(error) {
  if (error instanceof LoginRequiredError) {
    throw new Error(`${error.message}\n提示：先调用 douyin_login 扫码；如果刚登录过，可能是登录态过期。`);
  }
  throw error;
}

/**
 * @param {Record<string, any>} cfg 插件配置。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition[]} 工具定义列表。
 */
export function createTools(cfg) {
  return [
    createLoginTool(cfg),
    createStatusTool(cfg),
    createScanTool(cfg),
    createSummarizeTool(cfg),
    createUnfavoriteTool(cfg),
  ];
}

/**
 * 登录工具。
 * @param {Record<string, any>} cfg 配置。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 工具定义。
 */
function createLoginTool(cfg) {
  return defineTool({
    name: 'douyin_login',
    description:
      '打开本机浏览器并显示抖音登录二维码，等待用户用抖音 App 扫码。'
      + '首次使用、登录过期或需要切换账号时调用；登录态会保存到本地，后续扫描和取消收藏自动复用。'
      + '调用后要提醒用户：在弹出的浏览器窗口里用抖音 App 扫码，扫完不要立刻关窗口。',
    timeoutMs: 330_000,
    parameters: {
      force: { type: 'boolean', description: '为 true 时清掉现有登录态，重新扫码（切换账号用）。' },
      timeoutSeconds: { type: 'integer', description: '等待扫码的秒数，默认 300，范围 30–600。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          loggedIn: { type: 'boolean', required: true },
          alreadyLoggedIn: { type: 'boolean', required: true },
          qrPath: { type: 'string', required: true },
          waitedSeconds: { type: 'integer', required: true },
          statePath: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.alreadyLoggedIn
          ? `抖音已是登录状态（复用本地登录态）。\n登录态文件：${value.statePath}`
          : `抖音登录成功，用时 ${value.waitedSeconds} 秒。\n登录态已保存：${value.statePath}\n二维码截图：${value.qrPath || '未截取到'}`,
      }],
    },
    async execute(args, exec) {
      const timeoutMs = clampInt(args.timeoutSeconds, 30, 600, Math.round(cfg.loginTimeoutMs / 1000)) * 1000;
      const headed = { ...cfg, headless: false };
      return withBrowser(headed, async ({ page, context }) => {
        const result = await loginWithQr({
          page,
          context,
          cfg: headed,
          timeoutMs,
          force: args.force === true,
          signal: exec.signal,
        });
        return {
          loggedIn: true,
          alreadyLoggedIn: result.alreadyLoggedIn,
          qrPath: result.qrPath ?? '',
          waitedSeconds: Math.round(result.waitedMs / 1000),
          statePath: cfg.statePath,
        };
      }, { signal: exec.signal });
    },
  });
}

/**
 * 状态工具。
 * @param {Record<string, any>} cfg 配置。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 工具定义。
 */
function createStatusTool(cfg) {
  return defineTool({
    name: 'douyin_status',
    description:
      '查看抖音插件状态：本地登录态、收藏账本规模、最近操作记录。默认不打开浏览器；'
      + '把 probe 设为 true 才会启动浏览器真实验证登录是否有效。',
    timeoutMs: 120_000,
    parameters: {
      probe: { type: 'boolean', description: '为 true 时打开浏览器访问抖音，验证登录态是否仍然有效。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionExists: { type: 'boolean', required: true },
          sessionSavedAt: { type: 'string', required: true },
          cookieCount: { type: 'integer', required: true },
          probed: { type: 'boolean', required: true },
          loggedIn: { type: 'boolean', required: true },
          total: { type: 'integer', required: true },
          active: { type: 'integer', required: true },
          withPublishDate: { type: 'integer', required: true },
          lastScanAt: { type: 'string', required: true },
          dataDir: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `本地登录态：${value.sessionExists ? `已保存（${shortTime(value.sessionSavedAt)}）` : '未保存'}`,
          `收藏账本：共 ${value.total} 条，仍在收藏 ${value.active} 条，其中有发布时间 ${value.withPublishDate} 条`,
          `最近账本更新：${value.lastScanAt ? shortTime(value.lastScanAt) : '从未扫描'}`,
          value.probed ? `真实登录校验：${value.loggedIn ? '有效' : '已失效，需要重新登录'}` : '真实登录校验：未执行（probe=false）',
          `数据目录：${value.dataDir}`,
          '提示：登录态失效不会自动发现，扫描前若报未登录，请重新 douyin_login。',
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const session = describeSession(cfg.statePath);
      const ledger = readLedger(cfg.ledgerPath);
      const active = activeItems(ledger);
      let probed = false;
      let loggedIn = false;

      if (args.probe === true) {
        probed = true;
        loggedIn = await withBrowser(cfg, async ({ page, context }) => {
          await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: cfg.navTimeoutMs });
          return isLoggedIn(context);
        }, { signal: exec.signal });
      }

      return {
        sessionExists: session.exists,
        sessionSavedAt: session.savedAt ?? '',
        cookieCount: session.cookieCount,
        probed,
        loggedIn,
        total: Object.keys(ledger.items).length,
        active: active.length,
        withPublishDate: active.filter((item) => item.publishAt).length,
        lastScanAt: ledger.updatedAt ?? '',
        dataDir: cfg.dataDir,
      };
    },
  });
}

/**
 * 扫描工具。
 * @param {Record<string, any>} cfg 配置。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 工具定义。
 */
function createScanTool(cfg) {
  return defineTool({
    name: 'douyin_favorites_scan',
    description:
      '打开抖音收藏页，自动滚动加载并抓取收藏视频清单，合并进本地账本（保留首次出现时间）。'
      + '需要已登录。结果会返回新增/累计数量与样例；完整清单供 douyin_favorites_summarize 使用。',
    timeoutMs: 420_000,
    parameters: {
      limit: { type: 'integer', description: '本次最多抓取多少条，默认 800，上限 3000。' },
      maxScrolls: { type: 'integer', description: '最多滚动多少次，默认 60，上限 400。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scanned: { type: 'integer', required: true },
          added: { type: 'integer', required: true },
          updated: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          rounds: { type: 'integer', required: true },
          reachedBottom: { type: 'boolean', required: true },
          ledgerPath: { type: 'string', required: true },
          samples: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                author: { type: 'string', required: true },
                url: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `扫描完成：本次抓到 ${value.scanned} 条，新增 ${value.added} 条，更新 ${value.updated} 条，账本累计 ${value.total} 条。`,
          `滚动 ${value.rounds} 次${value.reachedBottom ? '，已到列表底部' : '，未到列表底部（可加大 maxScrolls）'}。`,
          value.samples.length > 0 ? `样例：\n${value.samples.map((item, index) => `${index + 1}. ${item.title} — ${item.author || '未知作者'}`).join('\n')}` : '',
          `账本：${value.ledgerPath}`,
        ].filter(Boolean).join('\n'),
      }],
    },
    async execute(args, exec) {
      const limit = clampInt(args.limit, 1, 3000, cfg.scanLimit);
      const maxScrolls = clampInt(args.maxScrolls, 1, 400, cfg.maxScrolls);
      try {
        return await withBrowser(cfg, async ({ page, context }) => {
          try {
            await openFavorites(page, context, cfg);
            const scan = await scanFavorites({ page, cfg, limit, maxScrolls, signal: exec.signal });
            const ledger = readLedger(cfg.ledgerPath);
            const merged = mergeItems(ledger.items, scan.items);
            writeLedger(cfg.ledgerPath, { version: 1, items: merged.items });
            appendActionLog(cfg.actionLogPath, {
              action: 'scan',
              scanned: scan.items.length,
              added: merged.added,
              updated: merged.updated,
            });
            return {
              scanned: scan.items.length,
              added: merged.added,
              updated: merged.updated,
              total: Object.keys(merged.items).length,
              rounds: scan.rounds,
              reachedBottom: scan.reachedBottom,
              ledgerPath: cfg.ledgerPath,
              samples: scan.items.slice(0, 6).map((item) => ({
                title: truncate(item.title, 60),
                author: truncate(item.author, 30),
                url: item.url,
              })),
            };
          } catch (error) {
            // 选择器失效时留下现场，方便按真实 DOM 修 extract.js
            if (!(error instanceof LoginRequiredError)) {
              const dump = await dumpPage(page, cfg).catch(() => null);
              if (dump) {
                error.message += `\n已保存页面快照：${dump.screenshot} 与 ${dump.html}`;
              }
            }
            throw error;
          }
        }, { signal: exec.signal });
      } catch (error) {
        rethrowFriendly(error);
      }
    },
  });
}

/**
 * 归纳工具。
 * @param {Record<string, any>} cfg 配置。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 工具定义。
 */
function createSummarizeTool(cfg) {
  return defineTool({
    name: 'douyin_favorites_summarize',
    description:
      '读取本地收藏账本（可选先重新扫描），按视频类型和排除条件筛选，返回按类型分组的素材与统计。'
      + 'types 可传分类 id（food/travel/tech/entertainment/knowledge/fitness/finance/game/life/music/pet/other）或中文名，'
      + '也可传任意关键词（如「带货」）。exclude 用一句自然语言描述不想总结的类型。'
      + '拿到结果后请直接写出中文归纳（每类一段，指出高频主题与代表视频），不要编造未返回的内容。',
    timeoutMs: 420_000,
    parameters: {
      types: {
        type: 'array',
        description: '要总结的类型；留空表示全部。可混合分类 id、中文名或自定义关键词。',
        items: { type: 'string' },
      },
      exclude: { type: 'string', description: '不想总结的类型，用自然语言描述，例如「带货和直播切片」。' },
      sinceDays: { type: 'integer', description: '只看最近 N 天的内容（按发布时间，缺失时按首次扫描时间）。' },
      maxItems: { type: 'integer', description: '最多返回多少条明细，默认 40，上限 200。' },
      refresh: { type: 'boolean', description: '为 true 时先打开抖音重新扫描，再归纳。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          generatedAt: { type: 'string', required: true },
          fetchedAt: { type: 'string', required: true },
          activeTotal: { type: 'integer', required: true },
          matched: { type: 'integer', required: true },
          filters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              types: { type: 'array', required: true, items: { type: 'string' } },
              exclude: { type: 'string', required: true },
              sinceDays: { type: 'integer', required: true },
            },
          },
          groups: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', required: true },
                label: { type: 'string', required: true },
                count: { type: 'integer', required: true },
                items: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      title: { type: 'string', required: true },
                      author: { type: 'string', required: true },
                      url: { type: 'string', required: true },
                      publishAt: { type: 'string', required: true },
                      duration: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSummary(value) }],
    },
    async execute(args, exec) {
      const maxItems = clampInt(args.maxItems, 1, 200, 40);
      let ledger = readLedger(cfg.ledgerPath);

      if (args.refresh === true) {
        try {
          await withBrowser(cfg, async ({ page, context }) => {
            await openFavorites(page, context, cfg);
            const scan = await scanFavorites({ page, cfg, signal: exec.signal });
            const merged = mergeItems(ledger.items, scan.items);
            writeLedger(cfg.ledgerPath, { version: 1, items: merged.items });
            appendActionLog(cfg.actionLogPath, { action: 'scan', scanned: scan.items.length, reason: 'summarize-refresh' });
          }, { signal: exec.signal });
          ledger = readLedger(cfg.ledgerPath);
        } catch (error) {
          rethrowFriendly(error);
        }
      }

      const all = activeItems(ledger);
      if (all.length === 0) {
        throw new Error('本地账本还没有收藏数据。请先调用 douyin_favorites_scan（或 summarize 时传 refresh=true）。');
      }

      const matched = selectForSummary(all, args);
      const groups = trimGroups(groupByCategory(matched.items, 12), maxItems);
      const value = {
        generatedAt: new Date().toISOString(),
        fetchedAt: ledger.updatedAt ?? '',
        activeTotal: all.length,
        matched: matched.items.length,
        filters: {
          types: Array.isArray(args.types) ? args.types.map((t) => normalizeText(t)).filter(Boolean) : [],
          exclude: normalizeText(args.exclude),
          sinceDays: clampInt(args.sinceDays, 0, 3650, 0),
        },
        groups: groups.map((group) => ({
          type: group.type,
          label: group.label,
          count: group.count,
          items: group.items.map((item) => ({
            title: truncate(item.title, 80),
            author: truncate(item.author || '未知作者', 30),
            url: item.url,
            publishAt: item.publishAt ?? '',
            duration: item.duration ?? '',
          })),
        })),
      };
      appendActionLog(cfg.actionLogPath, { action: 'summarize', matched: value.matched, filters: value.filters });
      return value;
    },
  });
}

/**
 * 按类型/排除词/时间筛选出用于归纳的条目，并按发布时间倒序排列。
 * @param {Array<Record<string, any>>} all 全部在收藏条目。
 * @param {{types?:string[], exclude?:string, sinceDays?:number}} args 工具参数。
 * @returns {{items:Array<Record<string, any>>}} 筛选结果。
 */
function selectForSummary(all, args) {
  const excludeKeywords = splitExcludeKeywords(args.exclude);
  let items = filterItems(all, {
    types: Array.isArray(args.types) ? args.types : [],
    excludeKeywords,
    excludeMatcher: matchExclude,
  });

  const sinceDays = clampInt(args.sinceDays, 0, 3650, 0);
  if (sinceDays > 0) {
    const cutoff = Date.now() - sinceDays * 86_400_000;
    items = items.filter((item) => {
      const time = Date.parse(item.publishAt ?? item.firstSeenAt ?? '');
      return Number.isFinite(time) && time >= cutoff;
    });
  }

  items.sort((a, b) => {
    const ta = Date.parse(a.publishAt ?? a.firstSeenAt ?? '') || 0;
    const tb = Date.parse(b.publishAt ?? b.firstSeenAt ?? '') || 0;
    return tb - ta;
  });
  return { items };
}

/**
 * 按总条数预算裁剪各分组明细，组内计数保持真实。
 * @param {Array<{items:Array<any>, count:number}>} groups 分组。
 * @param {number} maxItems 明细总预算。
 * @returns {Array<any>} 裁剪后的分组。
 */
function trimGroups(groups, maxItems) {
  let budget = maxItems;
  return groups.map((group) => {
    const take = Math.max(0, Math.min(group.items.length, budget, 8));
    budget -= take;
    return { ...group, items: group.items.slice(0, take) };
  });
}

/**
 * 生成归纳工具的可读输出。
 * @param {Record<string, any>} value 工具返回值。
 * @returns {string} Markdown 文本。
 */
function renderSummary(value) {
  const lines = [
    `# 抖音收藏归纳素材`,
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
 * 按时间取消收藏工具。
 * @param {Record<string, any>} cfg 配置。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 工具定义。
 */
function createUnfavoriteTool(cfg) {
  return defineTool({
    name: 'douyin_unfavorite_old',
    description:
      '按「多久之前」筛选收藏并批量取消收藏，走抖音自带的批量管理流程，只勾选命中的视频，绝不全选。'
      + DESTRUCTIVE_HINT
      + ' ageBasis=publish 用视频发布时间近似（抖音网页版拿不到收藏时间），firstSeen 用插件首次扫描到它的时间。'
      + ' 建议先 dryRun=true 把清单给用户确认，再 confirm=true 执行。中文输出里必须如实说明时间基准。',
    timeoutMs: 600_000,
    parameters: {
      olderThanDays: { type: 'integer', required: true, description: '取消「多少天之前」的收藏，必填，1–3650。' },
      ageBasis: {
        type: 'string',
        enum: ['publish', 'firstSeen'],
        description: 'publish=按发布时间（默认）；firstSeen=按插件首次扫描时间。',
      },
      types: { type: 'array', description: '只处理这些类型，留空表示全部。', items: { type: 'string' } },
      exclude: { type: 'string', description: '排除某些类型，自然语言描述，例如「带货」。' },
      limit: { type: 'integer', description: '本次最多取消多少条，默认 20，上限 100（同时受配置上限约束）。' },
      dryRun: { type: 'boolean', description: '默认 true，只列清单不执行。' },
      confirm: { type: 'boolean', description: '真正执行时必须为 true，且用户已明确同意。' },
      enrich: { type: 'boolean', description: '缺少发布时间时是否打开详情页补全，默认 true。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          olderThanDays: { type: 'integer', required: true },
          ageBasis: { type: 'string', required: true },
          basisNote: { type: 'string', required: true },
          cutoffIso: { type: 'string', required: true },
          eligibleCount: { type: 'integer', required: true },
          plannedCount: { type: 'integer', required: true },
          unknownAgeCount: { type: 'integer', required: true },
          enrichedCount: { type: 'integer', required: true },
          candidates: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                author: { type: 'string', required: true },
                url: { type: 'string', required: true },
                category: { type: 'string', required: true },
                ageDate: { type: 'string', required: true },
                ageDays: { type: 'integer', required: true },
              },
            },
          },
          succeeded: { type: 'array', required: true, items: { type: 'string' } },
          failed: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
          stoppedBy: { type: 'string', required: true },
          allowDestructive: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderUnfavorite(value) }],
    },
    async execute(args, exec) {
      const olderThanDays = clampInt(args.olderThanDays, 0, 3650, 0);
      if (olderThanDays < 1) throw new Error('olderThanDays 必须是 1–3650 的整数。');
      if (!cfg.allowDestructive) throw new Error('插件配置 allowDestructive=false，已禁用取消收藏。');

      const dryRun = args.dryRun !== false;
      if (!dryRun && args.confirm !== true) {
        throw new Error('真正执行取消收藏必须同时传 confirm=true（且用户已明确同意）。建议先 dryRun=true 让用户确认清单。');
      }

      const basis = args.ageBasis === 'firstSeen' ? 'firstSeen' : 'publish';
      const limit = Math.min(clampInt(args.limit, 1, 100, 20), cfg.maxUnfavoritePerRun);
      const ledger = readLedger(cfg.ledgerPath);
      const all = activeItems(ledger);
      if (all.length === 0) {
        throw new Error('账本里没有收藏记录。请先执行 douyin_favorites_scan。');
      }

      const excludeKeywords = splitExcludeKeywords(args.exclude);
      const filtered = filterItems(all, {
        types: Array.isArray(args.types) ? args.types : [],
        excludeKeywords,
        excludeMatcher: matchExclude,
      });

      let selection = selectOlderThan(filtered, { olderThanDays, ageBasis: basis });
      const wantEnrich = args.enrich !== false && basis === 'publish' && selection.unknown.length > 0 && cfg.enrichLimit > 0;

      let enrichedCount = 0;
      if (wantEnrich) {
        try {
          await withBrowser(cfg, async ({ page, context }) => {
            await openFavorites(page, context, cfg);
            const result = await enrichPublishDates({
              page,
              items: selection.unknown,
              limit: cfg.enrichLimit,
              signal: exec.signal,
            });
            enrichedCount = result.resolved;
            // 用补全后的时间替换账本里的空值
            for (const item of result.items) {
              if (item.publishAt && ledger.items[item.id] && !ledger.items[item.id].publishAt) {
                ledger.items[item.id] = { ...ledger.items[item.id], publishAt: item.publishAt };
              }
            }
            if (enrichedCount > 0) writeLedger(cfg.ledgerPath, { version: 1, items: ledger.items });
          }, { signal: exec.signal });
          // 重新按同一条件筛选，避免用补全前的时间判断
          const refreshed = filterItems(activeItems(readLedger(cfg.ledgerPath)), {
            types: Array.isArray(args.types) ? args.types : [],
            excludeKeywords,
            excludeMatcher: matchExclude,
          });
          selection = selectOlderThan(refreshed, { olderThanDays, ageBasis: basis });
        } catch (error) {
          rethrowFriendly(error);
        }
      }

      const candidates = selection.eligible.slice(0, limit);

      if (dryRun) {
        const value = {
          mode: 'dryRun',
          olderThanDays,
          ageBasis: basis,
          basisNote: describeBasis(basis),
          cutoffIso: selection.cutoffIso,
          eligibleCount: selection.eligible.length,
          plannedCount: candidates.length,
          unknownAgeCount: selection.unknown.length,
          enrichedCount,
          candidates: candidates.map(toCandidate),
          succeeded: [],
          failed: [],
          stoppedBy: 'dry-run',
          allowDestructive: cfg.allowDestructive,
        };
        appendActionLog(cfg.actionLogPath, { action: 'unfavorite-dry-run', olderThanDays, ageBasis: basis, planned: candidates.length });
        return value;
      }

      if (candidates.length === 0) {
        return {
          mode: 'executed',
          olderThanDays,
          ageBasis: basis,
          basisNote: describeBasis(basis),
          cutoffIso: selection.cutoffIso,
          eligibleCount: selection.eligible.length,
          plannedCount: 0,
          unknownAgeCount: selection.unknown.length,
          enrichedCount,
          candidates: [],
          succeeded: [],
          failed: [],
          stoppedBy: 'nothing-to-do',
          allowDestructive: cfg.allowDestructive,
        };
      }

      try {
        const result = await withBrowser(cfg, async ({ page, context }) => {
          await openFavorites(page, context, cfg);
          return unfavoriteIds({
            page,
            cfg,
            ids: candidates.map((item) => item.id),
            signal: exec.signal,
          });
        }, { signal: exec.signal });

        markUnfavorited(ledger, result.succeeded);
        writeLedger(cfg.ledgerPath, { version: 1, items: ledger.items });
        appendActionLog(cfg.actionLogPath, {
          action: 'unfavorite',
          olderThanDays,
          ageBasis: basis,
          succeeded: result.succeeded.length,
          failed: result.failed.length,
          stoppedBy: result.stoppedBy,
        });

        return {
          mode: 'executed',
          olderThanDays,
          ageBasis: basis,
          basisNote: describeBasis(basis),
          cutoffIso: selection.cutoffIso,
          eligibleCount: selection.eligible.length,
          plannedCount: candidates.length,
          unknownAgeCount: selection.unknown.length,
          enrichedCount,
          candidates: candidates.map(toCandidate),
          succeeded: result.succeeded,
          failed: result.failed.map((entry) => ({ id: entry.id, reason: entry.reason })),
          stoppedBy: result.stoppedBy,
          allowDestructive: cfg.allowDestructive,
        };
      } catch (error) {
        rethrowFriendly(error);
      }
    },
  });
}

/**
 * 把候选条目转成输出结构。
 * @param {Record<string, any>} item 条目。
 * @returns {Record<string, any>} 输出对象。
 */
function toCandidate(item) {
  return {
    id: item.id,
    title: truncate(item.title, 80),
    author: truncate(item.author || '未知作者', 30),
    url: item.url,
    category: item.categoryLabel ?? '其他',
    ageDate: (item.ageDate ?? '').slice(0, 10),
    ageDays: item.ageDays ?? 0,
  };
}

/**
 * 生成取消收藏工具的可读输出。
 * @param {Record<string, any>} value 工具返回值。
 * @returns {string} 文本。
 */
function renderUnfavorite(value) {
  const lines = [];
  if (value.mode === 'dryRun') {
    lines.push(`演练模式（未删除任何收藏）`);
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
    lines.push('确认无误后，用相同条件并传 confirm=true 才会真正执行。');
  } else if (value.stoppedBy !== 'done') {
    lines.push('');
    lines.push(`提前结束原因：${value.stoppedBy}`);
  }
  return lines.join('\n');
}
