/** 插件入口：注册抖音工具与「检查更新」按钮的后端接口。 @module dsh-douyin */

import { fileURLToPath } from 'node:url';
import { createTools } from './tools.js';
import { resolveConfig } from './config.js';
import { registerUpdateRpc } from './update-rpc.js';

/** Cordis 插件名。 */
export const name = 'dsh-douyin';

/** 依赖：工具注册服务 + 客户端连接（用于设置页按钮的更新接口）。 */
export const inject = ['tools', 'connection'];

/**
 * 挂载插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文。
 * @param {Record<string, unknown>} [config] cordis.patch.yml 里的 config 段。
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const cfg = resolveConfig(config ?? {});
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url));

  for (const tool of createTools(cfg, { pkgRoot })) {
    ctx.tools.register(tool);
  }

  // 客户端「检查更新」按钮通过 /api/dsh-douyin/update 调到宿主侧
  ctx.effect(() => registerUpdateRpc(ctx, { pkgRoot }), 'dsh-douyin: update rpc');
}
