/** 「检查更新」工具：与客户端按钮共用同一套更新逻辑。 @module dsh-douyin/tool-update */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { runUpdate } from './update.js';

/**
 * 生成检查更新工具。
 * @param {string} pkgRoot 插件根目录。
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 工具定义。
 */
export function createUpdateTool(pkgRoot) {
  return defineTool({
    name: 'douyin_check_update',
    description:
      '检查 GitHub 仓库 youzishan6a/dsh-douyin 是否有新版本。'
      + 'apply=false（默认）只检查并返回版本；apply=true 会下载新版本文件替换当前插件，'
      + '替换后需要重启 dsh 才会生效。仅在用户明确要求更新时传 apply=true。',
    timeoutMs: 120_000,
    parameters: {
      apply: { type: 'boolean', description: '为 true 时下载并安装新版本；默认只检查。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          currentVersion: { type: 'string', required: true },
          latestVersion: { type: 'string', required: true },
          applied: { type: 'boolean', required: true },
          restartRequired: { type: 'boolean', required: true },
          updatedFiles: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: render(value) }],
    },
    async execute(args, exec) {
      try {
        const value = await runUpdate({ pkgRoot, apply: args.apply === true, signal: exec.signal });
        return {
          status: value.status,
          currentVersion: value.currentVersion,
          latestVersion: value.latestVersion,
          applied: Boolean(value.applied),
          restartRequired: Boolean(value.restartRequired),
          updatedFiles: Array.isArray(value.updatedFiles) ? value.updatedFiles : [],
        };
      } catch (error) {
        throw new Error(`检查更新失败：${error?.message ?? error}\n可以稍后重试，或手动在插件目录执行更新。`);
      }
    },
  });
}

/**
 * 渲染更新结果。
 * @param {Record<string, any>} value 结果。
 * @returns {string} 文本。
 */
function render(value) {
  if (value.status === 'updated') {
    return [
      `已更新：v${value.currentVersion} → v${value.latestVersion}`,
      `替换文件：${value.updatedFiles.join('、')}`,
      '请重启 dsh 让新版本生效；旧文件已保留 .bak 备份。',
    ].join('\n');
  }
  if (value.status === 'update-available') {
    return `发现新版本 v${value.latestVersion}（当前 v${value.currentVersion}）。需要更新时传 apply=true。`;
  }
  return `已是最新版本 v${value.currentVersion}。`;
}
