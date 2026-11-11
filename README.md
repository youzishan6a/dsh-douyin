# dsh-douyin

DeepSeek Harness（dsh）插件，把抖音网页版的三件事交给 Agent：

1. **扫码登录**：弹出本机浏览器显示抖音登录二维码，扫码后把登录态存在本地。
2. **收藏归纳**：抓取「我的收藏」，按视频类型或自然语言描述的排除条件筛选，输出可直接写总结的结构化素材。
3. **按时间取消收藏**：筛选「多少天之前」的收藏，走抖音自带的批量管理流程取消收藏。默认只演练，确认后才执行。

插件只操作**你自己登录的账号**，不调用逆向接口、不伪造签名，全部通过浏览器页面完成。

---

## 环境要求

- dsh `>= 0.2.1`（在 `0.2.2-rc.1` 上开发验证）
- Node.js `>= 20.11`
- 本机安装 **Chrome 或 Edge**（默认使用系统浏览器，不额外下载 Chromium）
- pnpm（`dsh plugin` 依赖它）：`npm i -g pnpm`

---

## 安装

### 方式一：从 GitHub 安装（推荐）

```bash
npm i -g pnpm
dsh plugin --profile web add github:youzishan6a/dsh-douyin
```

然后把插件加进 profile 的 bundle 列表。编辑 `~/.dsh/profiles/web/package.json`：

```json
{
  "dependencies": {
    "dsh-douyin": "github:youzishan6a/dsh-douyin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-douyin"
      ]
    }
  }
}
```

保存后重新启动 dsh，检查是否加载：

```bash
dsh --profile web --dump-config | grep douyin
```

能看到 `dsh-douyin` 条目即成功。

### 方式二：手动挂载

如果 `bundles` 方式没有生效，直接在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-douyin
      name: dsh-douyin
```

两种方式等价，任选其一，不要同时写两遍（重复 id 会报错）。

安装完成后重启 dsh，在对话里问「抖音插件有哪些工具」或直接说「帮我登录抖音」即可触发。

## 版本更新

插件带一个自更新按钮：

1. 打开 dsh 设置 → 左侧「抖音收藏」；
2. 点击「检查更新」；
3. 有新版本会自动下载并替换文件，提示「请重启 dsh 生效」；已是最新则直接提示版本号。

也可以让 Agent 调用 `douyin_check_update`：默认只检查，传 `apply=true` 才会安装。

实现细节：

- 读取 `https://raw.githubusercontent.com/youzishan6a/dsh-douyin/main/package.json` 的版本号，与本地比较；
- 只下载固定清单：`package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`；
- 校验文件名、版本号、`lib/index.js` 体积与标记后才替换，旧文件保留 `.bak.<时间戳>` 备份；
- 更新接口只接受本机请求（`localhost`/`127.0.0.1`），局域网访问会被拒绝；
- 替换的是当前安装目录里的文件，不执行 npm/pnpm，不联网安装依赖。

注意：自更新会加载 GitHub 上的最新代码。如果 fork 或改了仓库地址，需要同步修改 `src/update.js` 里的 `UPDATE_REPO`。

---

## 首次使用

```
你：帮我登录抖音
Agent：调用 douyin_login → 弹出浏览器窗口显示二维码
你：用抖音 App 扫码
Agent：登录成功，登录态保存到 ~/.dsh/douyin/state.json
```

接着：

```
你：看看我最近收藏了什么，帮我总结一下美食类的
Agent：douyin_favorites_scan → douyin_favorites_summarize(types=["美食"])
```

```
你：把一年前收藏的、已经不想看的带货视频取消收藏
Agent：douyin_unfavorite_old(olderThanDays=365, exclude="带货", dryRun=true)
       → 给你清单确认
你：确认，执行
Agent：douyin_unfavorite_old(..., dryRun=false, confirm=true)
```

---

## 工具一览

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `douyin_login` | 打开浏览器扫码登录，保存登录态 | `force` 切换账号；`timeoutSeconds` |
| `douyin_status` | 查看登录态、账本规模、最近操作 | `probe=true` 才真实校验登录 |
| `douyin_favorites_scan` | 滚动抓取收藏并写入账本，每批最多 150 条新的 | `limit`（上限 150）、`maxScrolls` |
| `douyin_favorites_summarize` | 按类型/排除词筛选并分组，返回归纳素材 | `types`、`exclude`、`sinceDays`、`maxItems`、`refresh` |
| `douyin_unfavorite_old` | 按时间批量取消收藏 | `olderThanDays`、`ageBasis`、`types`、`exclude`、`limit`、`dryRun`、`confirm` |
| `douyin_check_update` | 检查 GitHub 是否有新版本，可一键更新 | `apply` |

### 类型取值

`types` 支持分类 id、中文名，也支持直接写关键词：

`food` 美食、`travel` 旅行、`tech` 科技数码、`entertainment` 影视娱乐、`knowledge` 知识教育、`fitness` 健身运动、`finance` 财经商业、`game` 游戏、`life` 生活vlog、`music` 音乐舞蹈、`pet` 萌宠、`other` 其他。

`exclude` 用一句自然语言即可，例如「不要总结带货和直播切片」，插件会拆成关键词逐个排除。

---

## 时间基准（重要）

抖音网页版**不提供「收藏时间」**。所以「多久之前的收藏」只能用两种近似：

| `ageBasis` | 含义 | 适用场景 |
| --- | --- | --- |
| `publish`（默认） | 视频的**发布时间** | 清理「老视频」，语义最接近大多数人的需求 |
| `firstSeen` | 插件**首次扫描到**这条收藏的时间 | 想精确按「我什么时候收的」清理，需要插件运行足够久 |

`firstSeen` 只会从第一次扫描开始记账，刚装插件时所有条目都是「今天」，无法回溯历史收藏时间。这是平台限制，不是插件偷懒。

缺少发布时间时，插件会打开视频详情页补全（每次最多 `enrichLimit` 条，默认 20）。补不到的条目会被归入「时间未知」并**跳过**，绝不会因为时间不明被误删。

---

## 分批扫描规则

- **每批最多 150 条**：`douyin_favorites_scan` 单次只收 150 条新的，`limit` 上限也是 150。
- **自动跳过已扫描**：账本里已有的条目不会重复入库，扫描会越过它们，继续取下面的 150 条。
- **重复调用即续批**：连续调用两次，第一批 1–150，第二批 151–300；不需要手动记位置。
- **重启重置会话计数**：dsh 重启后「本会话第几批 / 累计新增」归零，但已扫描清单保存在 `ledger.json` 里，不会丢失，也不会重扫。
- **每次从列表顶部开始检查**：这样能发现新收藏（新收藏在最上面）；顶部已扫描的会被跳过，所以结果仍是「下一批 150 条新的」。
- 已经取消收藏的条目不算「已扫描」，如果重新收藏会再次被收进来。
- 滚动次数不够时会返回 `stoppedBy: max-scrolls`，加大 `maxScrolls` 再跑一次即可接着往后取。

---

## 安全设计

取消收藏是不可逆操作，插件做了这些约束：

- 工具默认 `dryRun=true`，只列清单不动手；
- 真正执行必须同时满足：`confirm=true`、`allowDestructive` 未被关闭、条数不超过 `maxUnfavoritePerRun`；
- **只勾选命中的视频，绝不全选**，每一轮都核对卡片 id；
- 每轮勾选量默认 15 条，操作之间 0.6–2.4 秒随机间隔；
- 命中「操作频繁/稍后再试」等风控提示立即停止；
- 每一条成功/失败都写入 `actions.jsonl`，账本里标记 `unfavoritedAt` 而不是直接删除。

建议每次不超过 20–30 条，分几天清理。短时间大量取消收藏可能触发平台限制，这不是插件能绕过的。

---

## 数据与隐私

所有数据都在本机 `~/.dsh/douyin/`（可通过 `dataDir` 改）：

| 文件 | 内容 | 敏感 |
| --- | --- | --- |
| `state.json` | 登录 cookie，权限 600 | 是，切勿提交或分享 |
| `ledger.json` | 收藏账本（标题、作者、链接、时间） | 是，属于个人数据 |
| `actions.jsonl` | 操作日志 | 否 |
| `login-qr.png` | 最近一次登录二维码截图 | 否（会过期） |
| `last-page.png` / `last-page.html` | 排查用的页面快照 | 可能含个人信息 |

插件不向任何服务器上传数据，只在本机启动浏览器访问 `douyin.com`。

---

## 配置

在 `cordis.patch.yml` 的条目里加 `config`：

```yaml
- insert:
    - id: dsh-douyin
      name: dsh-douyin
      config:
        dataDir: "~/.dsh/douyin"
        browserChannel: auto        # auto | chrome | msedge | chromium
        headless: false             # 无头模式容易被验证码拦截
        allowDestructive: true      # 改成 false 可彻底禁用取消收藏
        maxUnfavoritePerRun: 50     # 单次上限，最大 100
        chunkSize: 15               # 每轮勾选条数，最大 30
        enrichLimit: 20             # 每次最多补全多少条发布时间
        maxScrolls: 120             # 单批最多滚动次数，后面的批次需要更多滚动
        scanLimit: 150              # 单批扫描条数，上限 150
        favoritesUrl: "https://www.douyin.com/user/self?showTab=favorite_collection"
```

---

## 已知限制

- **页面结构会变**。插件依赖 `data-e2e` 属性、链接结构和按钮文案（批量管理 / 取消收藏 / 确认）。抖音改版后可能失效，此时会返回明确错误而不是乱点。把 `~/.dsh/douyin/last-page.html` 和截图留好，便于修选择器。
- **登录态会过期**。抖音 cookie 通常几周失效，扫描报「未登录」就重新 `douyin_login`。
- **无头模式容易被拦**。默认有头；服务器/远程环境没有桌面时不适用。
- **验证码需人工通过**。插件不会尝试绕过滑块或验证码，遇到就提示你在窗口里手动完成。
- **收藏时间不可得**，见上一节。
- 只支持网页版能看到的收藏（视频、图文），不含私密收藏、合集内条目。

---

## 开发

```bash
npm install
npm run build     # src/ → lib/index.js（esbuild 单文件）
npm test          # 纯逻辑单测，不启动浏览器
npm run check     # build + test
```

源码结构：

```
src/
  index.js       插件入口（name / inject / apply）
  tools.js       五个工具的定义与编排
  browser.js     Chrome/Edge 启动、登录判断、点击与滚动助手
  login.js       扫码登录
  favorites.js   收藏页扫描
  extract.js     页面内提取逻辑
  unfavorite.js  批量取消收藏
  enrich.js      详情页补全发布时间
  classify.js    分类与筛选
  age.js         时间筛选
  store.js       本地账本
  text.js        文本解析
  config.js      配置默认值
```

修改选择器时优先动 `extract.js` 与 `unfavorite.js`，两处都有中文注释说明依赖了哪些页面信号。

---

## 卸载

```bash
dsh plugin --profile web remove dsh-douyin
```

再从 profile 的 `bundles` 或 `cordis.patch.yml` 里删掉对应条目，最后按需删除 `~/.dsh/douyin/`。

---

## 使用边界

- 仅用于管理**你自己账号**的收藏，不要用于批量操作他人账号或商业爬取。
- 自动化操作可能与抖音用户协议存在冲突，账号风险由使用者自行承担；建议控制频率、小批量操作。
- 插件不提供任何绕过风控、验证码或登录保护的能力。

## License

MIT
