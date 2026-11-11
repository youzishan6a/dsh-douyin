---
name: dy-skill
description: 管理抖音（Douyin）网页版收藏：扫码登录抖音、抓取并归纳收藏视频（可按视频类型筛选，也可用自然语言排除某类内容）、按「多少天之前」批量取消收藏，以及检查并更新本技能。当用户提到抖音收藏、抖音喜欢、整理或清理抖音收藏、总结收藏的视频、取消抖音收藏、扫码登录抖音、检查更新或升级抖音技能时使用本技能。
agent_created: true
---

# 抖音收藏管理

## 用途

在本机浏览器里完成三件事，全部走抖音网页版正常界面，不调用逆向接口、不伪造请求签名：

1. 扫码登录抖音，保存登录态；
2. 抓取「我的收藏」，按类型或排除条件筛选，产出可写总结的结构化素材；
3. 按「多少天之前」筛选收藏，走抖音自带的批量管理取消收藏（默认只演练）。

## 前置条件

- Node.js ≥ 20.11。
- 本机安装 Chrome 或 Edge（复用系统浏览器，不下载 Chromium）。
- 首次使用在技能目录执行一次 `npm install`，安装 `playwright-core`（约 10 MB）。
- 不需要抖音开放平台账号，也不需要手工复制 cookies。

所有命令都在**技能根目录**执行，入口是 `scripts/douyin.mjs`。加 `--json` 输出结构化结果，不加则输出中文文本。

## 命令速查

```bash
node scripts/douyin.mjs login                      # 扫码登录
node scripts/douyin.mjs status [--probe]           # 登录态与账本概况
node scripts/douyin.mjs scan                       # 抓取收藏，每批 150 条新的
node scripts/douyin.mjs summarize --types 美食,旅行 --exclude "带货和直播切片"
node scripts/douyin.mjs unfavorite --older-than-days 365          # 演练
node scripts/douyin.mjs unfavorite --older-than-days 365 --execute --confirm
node scripts/douyin.mjs update                     # 检查并更新本技能
node scripts/douyin.mjs update --check-only        # 只检查版本
node scripts/douyin.mjs diagnose                   # 保存页面现场，排查选择器
```

通用参数：`--data-dir <path>`（默认 `~/.dsh/douyin`）、`--json`、`--headless`（不推荐）、`--channel chrome|msedge`。`update` 不启动浏览器，也不需要登录态。

执行提示：

- 命令必须在技能根目录运行；若当前目录不确定，先 `cd` 到技能目录，或用绝对路径调用脚本。
- `login` 会阻塞等待扫码，执行时把命令超时设到 **330 秒以上**；`scan` / `unfavorite` 建议 **300 秒以上**。
- 需要程序化判断结果时加 `--json`，正常对话展示用默认文本输出。

## 流程一：扫码登录

执行：

```bash
node scripts/douyin.mjs login
```

行为与要求：

- 弹出浏览器窗口并显示二维码，命令最多阻塞 300 秒（`--timeout` 可调）。
- 必须告知用户：**在弹出的窗口里用抖音 App 扫码，扫完不要立刻关窗口**；登录成功后窗口会自动关闭。
- 切换账号用 `login --force`，会清掉旧登录态重新扫码。
- 登录态写入 `~/.dsh/douyin/state.json`（权限 600）。抖音 cookie 通常几周后失效，扫描报未登录时重新登录即可。

## 流程二：查看并归纳收藏

先抓取，再归纳：

```bash
node scripts/douyin.mjs scan
node scripts/douyin.mjs summarize --types 美食,旅行 --exclude "带货和直播切片"
```

规则：

- `scan` 会滚动加载收藏页并写入本地账本；**每批最多 150 条新的**，`--limit` 上限也是 150。
- 账本里已扫描过的条目会自动跳过，重复执行会继续取下面的 150 条；不需要手动记位置。
- 每次命令都是独立进程，相当于重启：批次计数从 1 开始；已扫描清单在 `ledger.json` 里，不会丢失或重复入库。
- 每次都从列表顶部开始检查，因此新收藏会先被发现；顶部已扫描的跳过，结果仍是「下一批 150 条新的」。
- 滚动次数不够时输出 `stoppedBy: max-scrolls`，加大 `--max-scrolls` 再跑一次。
- `summarize` 默认只读账本，不启动浏览器；加 `--refresh` 会先重新扫描（同样只收 150 条新的）。
- `--types` 可传分类 id、中文名或任意关键词，逗号分隔；留空表示全部。分类表见 `references/categories.md`。
- 用户说「不要总结 XX」时，把原话直接传给 `--exclude`，脚本会拆成关键词排除。
- `--since-days N` 只看最近 N 天，`--max-items N` 控制明细条数。
- 输出是按类型分组的素材（标题、作者、发布时间、时长、链接）。**必须基于这些素材写中文归纳，不得补充未返回的视频**；素材不足时如实说明。

## 流程三：按时间取消收藏

必须两步，不可跳过演练：

```bash
# 第一步：演练，只列清单，不动账号
node scripts/douyin.mjs unfavorite --older-than-days 365 --exclude 带货

# 第二步：用户确认清单后执行
node scripts/douyin.mjs unfavorite --older-than-days 365 --exclude 带货 --limit 20 --execute --confirm
```

规则：

- 不带 `--execute` 永远是演练；只带 `--execute` 不带 `--confirm` 会直接报错退出。
- **禁止**在用户没有明确确认清单前加 `--execute --confirm`。
- 时间基准：默认 `--age-basis publish`，用视频发布时间近似；用户强调「我什么时候收藏的」时，说明抖音网页版不提供收藏时间，可选 `firstSeen`（本技能首次扫描到它的时间，只对装好之后新增的收藏有效）。
- 时间未知的条目会被跳过，不会因为时间不明被误删。
- 单次建议不超过 30 条；脚本默认每轮勾选 15 条、操作间随机延迟，命中「操作频繁」会自动停止。
- 只勾选命中的视频，绝不全选；成功后账本标记 `unfavoritedAt`，不删除记录。

## 流程四：检查并更新本技能

用户说「检查更新」「升级技能」「更新 skill」时执行：

```bash
node scripts/douyin.mjs update            # 默认检查并直接更新
node scripts/douyin.mjs update --check-only   # 只想看版本差异时
```

规则：

- 版本来源是 GitHub 仓库 `youzishan6a/dsh-douyin` 的 `DYskill/` 目录，先走 GitHub Contents API，失败再退回 raw 地址；两者都有缓存，请求带时间戳参数；
- 只替换固定清单里的技能代码文件（`package.json`、锁文件、`SKILL.md`、`README.md`、`scripts/`、`references/`），**不碰** `state.json`、`ledger.json`、`actions.jsonl`；
- 全部文件下载并校验通过后才替换，旧文件保留 `.bak.<时间戳>` 备份；校验失败会中止，本地文件保持原样；
- 不执行 npm/pnpm，不安装依赖；若以后依赖版本有变化，按提示手动 `npm install`；
- 更新完成后当前进程不变，**下一次命令**自动使用新版本，不需要重启；
- `update` 与取消收藏的安全阀无关：`--check-only` 才是「只看不改」，默认会更新。不要把它和 `--execute --confirm` 混用。

## 结果与错误处理

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| 退出码 2，提示先登录 | 未登录或登录态过期 | 执行 `login`，成功后重试原命令 |
| `update` 提示检查更新失败 | 网络不通、GitHub 限流或仓库路径变化 | 稍后重试；`--check-only` 可先确认连通性，不要手工下载覆盖 |
| 提示验证码 / 滑块 | 被风控拦截 | 去掉 `--headless`，让用户在弹出窗口里手动完成验证 |
| 提示找不到「批量管理」或卡片 | 页面结构变化 | 执行 `diagnose`，保留截图与 HTML |
| 扫描结果为 0 条 | 未进入收藏页或未登录 | 先 `status --probe` 确认登录，再 `scan` |
| 取消收藏提前结束 | 命中风控或勾选失败 | 查看输出的 `stoppedBy`，隔一段时间再试，减小批量 |

退出码：`0` 成功，`1` 参数或执行错误，`2` 需要登录，`130` 用户取消。

## 数据与隐私

- 数据都在 `~/.dsh/douyin/`：`state.json`（cookie）、`ledger.json`（收藏账本）、`actions.jsonl`（操作日志）、`login-qr.png`、`last-page.*`。
- 不上传任何数据；只在本机启动浏览器访问 `douyin.com`。
- 不要把 `state.json`、`ledger.json` 或页面快照发到公开渠道。

## 参考文件

- `references/categories.md`：分类 id、中文名与关键词表；自定义类型与排除词的匹配规则。
- `references/troubleshooting.md`：选择器依赖点、改版后的修复方法、手动验收清单、安全边界。

## 使用边界

仅用于管理用户**本人账号**的收藏。自动化操作可能与平台协议存在冲突，账号风险由使用者承担；不要用于批量操作他人账号、商业爬取，也不要尝试绕过验证码或风控。
