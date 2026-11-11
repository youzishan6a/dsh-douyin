# DYskill · 抖音收藏管理技能

把原 dsh 插件（`dsh-douyin`）的三项能力封装成 WorkBuddy 技能：扫码登录抖音、归纳收藏视频、按时间批量取消收藏。区别在于，插件版把能力注册成 dsh 工具，技能版是一个独立 CLI，任何能执行命令的 Agent 都能用。

## 安装

```bash
cd DYskill
npm install          # 只安装 playwright-core
```

> 需要 Node.js ≥ 20.11，本机装有 Chrome 或 Edge。

若要让 WorkBuddy 自动发现这个技能，把整个目录复制或链接到用户技能目录：

```bash
# Windows（Git Bash）
cp -r DYskill ~/.workbuddy/skills/dy-skill

# macOS / Linux
cp -r DYskill ~/.workbuddy/skills/dy-skill
```

也可以按项目放置：复制到 `<项目>/.workbuddy/skills/dy-skill/`。

## 使用

```bash
node scripts/douyin.mjs login
node scripts/douyin.mjs scan
node scripts/douyin.mjs summarize --types 美食,旅行 --exclude "带货和直播切片"
node scripts/douyin.mjs unfavorite --older-than-days 365 --exclude 带货
node scripts/douyin.mjs unfavorite --older-than-days 365 --limit 20 --execute --confirm
node scripts/douyin.mjs update                    # 检查并更新本技能
node scripts/douyin.mjs update --check-only       # 只检查版本
```

完整参数见 `node scripts/douyin.mjs --help`，Agent 使用规范见 `SKILL.md`。

## 分批扫描

- 每次 `scan` 最多收 **150 条新的**，`--limit` 上限也是 150。
- 账本里已扫描过的条目会自动跳过，重复执行会继续取下面的 150 条。
- 每次命令都是独立进程，相当于「重启」：批次计数从 1 开始；但已扫描清单在 `ledger.json` 里，不会重复入库。
- 每次都从列表顶部开始检查，因此新收藏会先被发现，已扫描的跳过。
- 滚动次数不够时输出 `stoppedBy: max-scrolls`，加大 `--max-scrolls` 再跑一次。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `login` | 弹出浏览器扫码登录，保存登录态 |
| `status [--probe]` | 登录态、账本规模、最近更新 |
| `scan` | 滚动抓取收藏，每批最多 150 条新的，自动跳过已扫描 |
| `summarize` | 按类型/排除词/时间筛选，输出分组素材 |
| `unfavorite` | 按时间筛选并取消收藏（默认演练） |
| `update [--check-only]` | 从 GitHub 检查并更新本技能（默认直接更新） |
| `diagnose` | 保存页面截图与 HTML，排查选择器 |

## 检查更新

```bash
node scripts/douyin.mjs update              # 检查版本，有新版本就替换文件
node scripts/douyin.mjs update --check-only # 只报告版本差异
```

- 更新源是同一仓库的 `DYskill/` 目录，版本以 `DYskill/package.json` 为准；优先走 GitHub Contents API，失败才退回 raw 地址。两者都有缓存，请求统一带时间戳参数破除。
- 只下载固定清单里的技能代码文件，逐个校验后才落盘；旧文件保留 `.bak.<时间戳>` 备份，校验失败则原文件不动。
- **不会**改动 `~/.dsh/douyin/` 里的登录态、账本、日志，也不会执行 `npm install` 或运行任何下载来的脚本。
- 当前进程继续用旧代码，**下一次命令**自动使用新版本；无需重启。
- 依赖版本若有变化，更新后手动执行一次 `npm install`。
- 插件版（`dsh-douyin`）有设置页的「检查更新」按钮，与本命令各自独立：按钮更新插件，命令更新技能。

## 数据

默认 `~/.dsh/douyin/`，与 dsh 插件共用同一份账本和登录态，两个入口可以混用。

| 文件 | 内容 |
| --- | --- |
| `state.json` | 登录 cookie（权限 600） |
| `ledger.json` | 收藏账本 |
| `actions.jsonl` | 操作日志 |
| `login-qr.png` | 登录二维码截图 |
| `last-page.png/html` | diagnose 现场快照 |

改目录：`--data-dir <path>` 或环境变量 `DY_DATA_DIR`。

## 安全约束

- 取消收藏默认只演练，必须同时给 `--execute --confirm`；
- 只勾选命中的视频，绝不全选；
- 单次上限 100 条（默认 20），每轮 15 条，操作间随机延迟；
- 命中「操作频繁」立即停止；
- 不做逆向接口、不伪造签名、不绕过验证码。

## 目录结构

```
DYskill/
├── SKILL.md                 # Agent 使用说明（技能入口）
├── README.md                # 本文件
├── package.json
├── scripts/
│   ├── douyin.mjs           # CLI 入口
│   └── lib/                 # 浏览器、抓取、账本、筛选、取消收藏、自更新
├── references/
│   ├── categories.md        # 分类与排除规则
│   └── troubleshooting.md   # 排查、选择器维护、验收清单
└── test/                    # 纯逻辑与 CLI 测试（node --test）
```

## 开发

```bash
npm test
node scripts/douyin.mjs --help
```

## License

MIT
