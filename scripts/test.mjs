/**
 * 测试入口：显式收集 test/ 下的用例文件。
 * Windows 的 npm script 不会展开通配符，所以用脚本列文件再交给 node --test。
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync(new URL('../test/', import.meta.url))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => `test/${name}`);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
