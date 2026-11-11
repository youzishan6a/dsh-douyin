/** 客户端设置页：显示版本号与「检查更新」按钮。 @module dsh-douyin/client */

import * as React from 'react';

/** 客户端插件名。 */
export const name = 'dsh-douyin-client';

/** 需要客户端运行时提供的服务。 */
export const inject = ['slots', 'connection'];

const h = React.createElement;

/** 构建时注入的版本号。 */
const LOCAL_VERSION = typeof __DSH_DOUYIN_VERSION__ === 'string' ? __DSH_DOUYIN_VERSION__ : '0.0.0';

/**
 * 注册「抖音收藏」设置区块。
 * @param {any} ctx 客户端上下文。
 * @returns {void}
 */
export function apply(ctx) {
  const connection = ctx.connection;

  /** 面板组件：一个按钮完成检查 + 更新。 */
  function UpdatePanel() {
    const [state, setState] = React.useState({ phase: 'idle', message: '' });

    const checkAndUpdate = React.useCallback(async () => {
      setState({ phase: 'running', message: '正在检查 GitHub 上的最新版本…' });
      const controller = new AbortController();
      try {
        const result = await connection.rpc.call(
          '/api',
          'dsh-douyin/update',
          { method: 'update.run', payload: { apply: true } },
          controller.signal,
        );
        if (!result || result.ok !== true) {
          throw new Error(result?.error?.message || '更新请求失败');
        }
        const value = result.value ?? {};
        if (value.status === 'updated') {
          setState({
            phase: 'done',
            message: `已更新 v${value.currentVersion} → v${value.latestVersion}，请重启 dsh 生效。`,
          });
        } else if (value.status === 'update-available') {
          setState({ phase: 'done', message: `发现新版本 v${value.latestVersion}，再次点击可更新。` });
        } else {
          setState({ phase: 'done', message: `已是最新版本 v${value.currentVersion}。` });
        }
      } catch (error) {
        setState({ phase: 'error', message: `检查失败：${error?.message ?? error}` });
      }
    }, []);

    const running = state.phase === 'running';

    return h('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '4px 2px',
        fontSize: '13px',
        lineHeight: 1.6,
      },
    },
    h('div', { style: { fontSize: '15px', fontWeight: 600 } }, '抖音收藏插件'),
    h('div', null, `当前版本：v${LOCAL_VERSION}`),
    h('div', { style: { opacity: 0.72 } },
      '点击按钮会检查 GitHub 仓库，有新版本时自动下载并替换插件文件；重启 dsh 后生效。'),
    h('button', {
      type: 'button',
      onClick: checkAndUpdate,
      disabled: running,
      style: {
        alignSelf: 'flex-start',
        padding: '6px 16px',
        borderRadius: '8px',
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        cursor: running ? 'default' : 'pointer',
        opacity: running ? 0.6 : 1,
        font: 'inherit',
      },
    }, running ? '正在检查…' : '检查更新'),
    state.message
      ? h('div', { style: { opacity: 0.85, whiteSpace: 'pre-wrap' } }, state.message)
      : null);
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-douyin',
    order: 56,
    label: () => '抖音收藏',
  }, UpdatePanel));
}
