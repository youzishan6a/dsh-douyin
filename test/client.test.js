import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const CLIENT_BUNDLE = 'lib/client.js';

/**
 * 在模拟的 ModuleLoader 环境里加载客户端 bundle。
 * @returns {any} 客户端插件导出。
 */
function loadClientModule() {
  const code = fs.readFileSync(CLIENT_BUNDLE, 'utf8');
  let factory = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ id, factory: create }) {
          factory = { id, create };
        },
      },
    },
    console,
  };
  vm.runInNewContext(code, sandbox);
  assert.ok(factory, '客户端 bundle 没有调用 ModuleLoader.load');
  assert.equal(factory.id, 'dsh-douyin');
  return factory.create((name) => {
    if (name === 'react') return React;
    return require(name);
  });
}

test('客户端 bundle 可在 ModuleLoader 环境加载', { skip: !fs.existsSync(CLIENT_BUNDLE) }, () => {
  const mod = loadClientModule();
  assert.equal(mod.name, 'dsh-douyin-client');
  assert.equal(mod.inject.join(','), 'slots,connection');
  assert.equal(typeof mod.apply, 'function');
});

test('设置区块注册到 settings.section 且渲染出检查更新按钮', { skip: !fs.existsSync(CLIENT_BUNDLE) }, () => {
  const mod = loadClientModule();
  let registered = null;
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.section');
        return callback();
      },
      register(options, component) {
        registered = { options, component };
        return () => {};
      },
    },
    connection: { rpc: { call: async () => ({ ok: true, value: { status: 'up-to-date' } }) } },
  };

  mod.apply(ctx);
  assert.ok(registered, '没有注册设置区块');
  assert.equal(registered.options.id, 'dsh-douyin');
  assert.equal(registered.options.label(), '抖音收藏');

  const html = renderToStaticMarkup(React.createElement(registered.component));
  assert.match(html, /当前版本：v\d+\.\d+\.\d+/);
  assert.match(html, /检查更新/);
});
