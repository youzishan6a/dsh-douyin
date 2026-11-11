/**
 * 客户端「检查更新」按钮的后端接口。
 *
 * 走 dsh 的 Connection RPC 约定：POST /api/dsh-douyin/update，
 * 请求体是 {type:'client-request', rpcId, method, payload}，响应是 server-response。
 * 只接受本机来源，避免局域网内其他人触发插件更新。
 *
 * @module dsh-douyin/update-rpc
 */

import { runUpdate } from './update.js';

/** RPC 端点路径（相对 /api）。 */
export const UPDATE_ENDPOINT = 'dsh-douyin/update';

/**
 * 判断 authority 是否为本机地址。
 * @param {string|null} authority Host 头。
 * @returns {boolean} 是否本机。
 */
function isLoopbackAuthority(authority) {
  if (!authority) return false;
  try {
    const url = new URL(`http://${authority}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
    const hostname = url.hostname.replace(/\.$/, '');
    return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  } catch {
    return false;
  }
}

/**
 * 判断请求是否来自本机页面。
 * @param {Request} request 请求。
 * @returns {boolean} 是否本机。
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAuthority(request.headers.get('host'))) return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && isLoopbackAuthority(url.host);
  } catch {
    return false;
  }
}

/**
 * 包装 RPC 响应；客户端要求 error.details 存在。
 * @param {string} rpcId 请求 id。
 * @param {Record<string, any>} result 结果。
 * @returns {Response} HTTP 响应。
 */
function reply(rpcId, result) {
  const value = result.ok === false
    ? { ...result, error: { ...result.error, details: result.error?.details ?? {} } }
    : result;
  return Response.json({ type: 'server-response', rpcId, result: value });
}

/**
 * 注册更新 RPC；没有 connection 服务时返回空清理函数。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文。
 * @param {{pkgRoot:string}} options 插件根目录。
 * @returns {() => void} 注销函数。
 */
export function registerUpdateRpc(ctx, { pkgRoot }) {
  const register = ctx?.connection?.fetch?.register;
  if (typeof register !== 'function') return () => {};

  return register({
    path: `/api/${UPDATE_ENDPOINT}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (!isLoopbackRequest(request)) return new Response('forbidden', { status: 403 });
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 });
      }

      let message;
      try {
        message = await request.json();
      } catch {
        return new Response('body is not JSON', { status: 400 });
      }

      const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request';
      const call = message?.payload;
      if (message?.type !== 'client-request' || message.method !== UPDATE_ENDPOINT
        || !call || typeof call.method !== 'string') {
        return reply(rpcId, { ok: false, error: { code: 'bad-request', message: 'Invalid update request.' } });
      }

      try {
        if (call.method !== 'update.run') {
          return reply(rpcId, { ok: false, error: { code: 'bad-request', message: 'Unknown update method.' } });
        }
        const apply = call.payload?.apply === true;
        const value = await runUpdate({ pkgRoot, apply, signal: request.signal });
        return reply(rpcId, { ok: true, value });
      } catch (error) {
        return reply(rpcId, {
          ok: false,
          error: { code: 'update-failed', message: String(error?.message ?? error) },
        });
      }
    },
  });
}
