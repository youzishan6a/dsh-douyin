/** 插件入口：向 dsh 的 tools 服务注册抖音相关工具。 @module dsh-douyin */

import { createTools } from './tools.js';
import { resolveConfig } from './config.js';

/** Cordis 插件名。 */
export const name = 'dsh-douyin';

/** 依赖的工具注册服务。 */
export const inject = ['tools'];

/**
 * 挂载插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文。
 * @param {Record<string, unknown>} [config] cordis.patch.yml 里的 config 段。
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const cfg = resolveConfig(config ?? {});
  for (const tool of createTools(cfg)) {
    ctx.tools.register(tool);
  }
}
