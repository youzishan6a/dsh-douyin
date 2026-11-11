# 排查与维护

## 依赖与运行环境

```bash
cd <技能目录>
npm install          # 只装 playwright-core
node scripts/douyin.mjs status
```

- 需要 Node.js ≥ 20.11。
- 浏览器优先使用系统 Chrome，其次 Edge；都没有时尝试 Playwright 自带 Chromium（需 `npx playwright install chromium`）。
- 默认有头模式。抖音对无头浏览器会返回「验证码中间页」，因此不要用 `--headless` 跑登录或扫描。

## 页面交互依赖点

| 环节 | 依赖的页面信号 | 代码位置 |
| --- | --- | --- |
| 收藏页入口 | `https://www.douyin.com/user/self?showTab=favorite_collection` | `scripts/lib/config.js` |
| 收藏子标签 | 文本「视频」的 tab 元素 | `scripts/lib/favorites.js` |
| 滚动容器 | `div.route-scroll-container`，找不到时回退到可滚动祖先 | `scripts/lib/browser.js` |
| 收藏卡片 | `a[href*="/video/"]`、`a[href*="/note/"]`，向上找带 `img` 的容器 | `scripts/lib/extract.js` |
| 标题 | `[data-e2e="video-desc"]`、`p`、`span[class*="title"]`、链接 title、图片 alt | `scripts/lib/extract.js` |
| 批量管理 | 自身文本精确匹配「批量管理」 | `scripts/lib/unfavorite.js` |
| 勾选框 | `input[type="checkbox"]`、`.semi-checkbox` | `scripts/lib/unfavorite.js` |
| 取消按钮 | `取消收藏(N)`、`移出收藏(N)` | `scripts/lib/unfavorite.js` |
| 二次确认 | 弹窗内「确认取消 / 确定 / 确认」 | `scripts/lib/unfavorite.js` |
| 风控提示 | 操作频繁 / 请求过于频繁 / 稍后再试 / 网络繁忙 | `scripts/lib/unfavorite.js` |

## 常见问题

### 退出码 2：需要登录

```bash
node scripts/douyin.mjs login
```

cookie 通常几周失效。若刚登录仍报错，用 `status --probe` 看真实登录校验结果。

### 提示验证码或滑块

1. 确认没有加 `--headless`；
2. 在弹出的窗口里手动完成验证；
3. 重新执行原命令。

脚本不会尝试绕过验证码。

### 扫描到 0 条

- 先 `status --probe` 确认登录有效；
- 手动打开收藏页确认确实有内容、且「视频」子标签被选中；
- 如果账本已经覆盖了全部收藏，`scan` 会返回 0 条新增，这是正常结果；
- 执行 `diagnose`，看截图里页面停在哪个状态。

### 为什么一次只抓 150 条

每批上限 150 条，已扫描的条目会被跳过，所以重复执行会继续往下取。若某一批返回 0 条且 `stoppedBy=max-scrolls`，说明滚动次数不够（后面的批次要越过大量已扫描条目），加大 `--max-scrolls` 再跑。

想从头重扫，换一个空的数据目录即可：

```bash
node scripts/douyin.mjs scan --data-dir ~/.dsh/douyin-reset
```

或删除旧账本（会丢失首次扫描时间，`firstSeen` 基准会重置）。

### 找不到「批量管理」或卡片

抖音改版后，文本或属性可能变化。执行：

```bash
node scripts/douyin.mjs diagnose
```

会保存 `~/.dsh/douyin/last-page.png` 与 `last-page.html`。按 HTML 里的真实结构修改 `scripts/lib/extract.js` 或 `scripts/lib/unfavorite.js`，优先使用 `data-e2e` 属性和链接结构，避免写死 hash 类名。

### 取消收藏提前结束

看输出里的 `stoppedBy`：

- `risk-control: 操作频繁`：等几小时到一天，减小 `--limit`；
- `select-failed`：勾选框结构变了，按上一节更新；
- `targets-not-found`：目标不在当前列表（可能已被删/取消收藏），或少见的分页问题；
- `batch-mode-unavailable`：「批量管理」入口变化，需要更新选择器。

### 登录窗口没有出现

- 检查是否有其他抖音操作正在运行（同一时刻只允许一个）；
- 检查 Chrome/Edge 是否被安全软件拦截；
- 换浏览器通道：`--channel msedge`。

### 检查更新提示失败 / 一直显示已是最新

1. 先执行 `update --check-only --json`，看 `latestVersion` 与 `currentVersion`；
2. 网络不通或 GitHub 限流时，稍后重试；`raw.githubusercontent.com` 有 CDN 缓存，脚本已优先改走 GitHub Contents API；
3. 若仓库被 fork 或改名，修改 `scripts/lib/update.js` 里的 `UPDATE_REPO` / `UPDATE_BRANCH` / `SKILL_DIR`；
4. 更新只替换固定清单里的文件，`test/` 不在清单内；需要最新测试时从仓库重新复制整个目录；
5. 每次更新会留下 `.bak.<时间戳>` 备份（已 gitignore）。回退时把对应备份改回原文件名，或直接用 `git checkout` 恢复；
6. 更新完成后当前进程仍用旧代码，重跑一次命令即可验证新版本。

## 数据文件

| 文件 | 作用 | 注意 |
| --- | --- | --- |
| `state.json` | 登录 cookie | 敏感，勿分享 |
| `ledger.json` | 收藏账本（首次扫描时间在这里） | 个人数据 |
| `actions.jsonl` | 操作日志 | 可用于核对执行条数 |
| `login-qr.png` | 最近一次登录二维码 | 会过期 |
| `last-page.png/html` | `diagnose` 保存的现场 | 可能含个人信息 |

默认目录 `~/.dsh/douyin`，可用 `--data-dir` 或环境变量 `DY_DATA_DIR` 改。

## 手动验收清单

首次在真实账号上使用时，按顺序确认：

1. `login`：窗口出现二维码，扫码后提示登录成功；
2. `status --probe`：显示登录有效；
3. `scan --limit 50`：新增条数大于 0，样例标题与网页一致；
4. `summarize --types 美食`：分组与条数合理；
5. `unfavorite --older-than-days 365`：演练清单里的视频确实在收藏页存在；
6. 挑 1–2 条执行：`--limit 2 --execute --confirm`，回到网页确认已取消；
7. 检查 `actions.jsonl` 有对应记录。

## 安全边界

- 只操作当前登录账号本人的收藏；
- 不做全选，不删除视频，只取消收藏；
- 单次上限 100 条（默认 20，建议 ≤30）；
- 命中风控立即停止，不重试轰炸；
- 不提供绕过验证码、风控或登录保护的能力。
