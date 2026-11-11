# dsh-douyin

A DeepSeek Harness (`dsh`) plugin for your own Douyin (TikTok China) web account:

1. **QR login** — opens a local browser, shows the login QR, stores the session locally.
2. **Favorites digest** — scrolls your favorites page, filters by category or free-text exclusions, and returns structured material an agent can summarize.
3. **Unfavorite by age** — finds favorites older than N days and removes them through Douyin's own bulk-manage UI. Dry run by default; execution requires explicit confirmation.

Everything runs through the regular web UI in your own browser. No reverse-engineered endpoints, no request signing, no captcha bypass.

## Requirements

- dsh `>= 0.2.1` (developed against `0.2.2-rc.1`)
- Node.js `>= 20.11`
- Local Chrome or Edge (the system browser is reused; no Chromium download)
- pnpm: `npm i -g pnpm`

## Install

```bash
npm i -g pnpm
dsh plugin --profile web add github:youzishan6a/dsh-douyin
```

Then add `"dsh-douyin"` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json` and restart dsh. Verify with:

```bash
dsh --profile web --dump-config | grep douyin
```

If the bundle entry does not show up, append this to `~/.dsh/profiles/web/cordis.patch.yml` instead:

```yaml
- insert:
    - id: dsh-douyin
      name: dsh-douyin
```

## Tools

| Tool | Purpose |
| --- | --- |
| `douyin_login` | QR login, persists cookies to `~/.dsh/douyin/state.json` |
| `douyin_status` | Session file, ledger size, last actions; `probe=true` verifies login |
| `douyin_favorites_scan` | Scroll and collect favorites into the local ledger, max 150 new items per batch |
| `douyin_favorites_summarize` | Filter by `types` / `exclude` / `sinceDays`, return grouped material |
| `douyin_unfavorite_old` | Select favorites older than N days and unfavorite them |
| `douyin_check_update` | Check GitHub for a newer version; optionally install it |

Categories: `food`, `travel`, `tech`, `entertainment`, `knowledge`, `fitness`, `finance`, `game`, `life`, `music`, `pet`, `other`. `types` also accepts Chinese labels or arbitrary keywords.

## Time basis

Douyin's web UI does not expose *when* an item was favorited. The plugin therefore offers:

- `publish` (default): the video's publish time — closest to "old videos".
- `firstSeen`: when this plugin first scanned the item — only meaningful after it has been running for a while.

Items without a resolvable date are reported as "unknown age" and are never removed.

## Batch scanning

Each `douyin_favorites_scan` call collects at most **150 new items**. Items already in the ledger are skipped, so repeated calls continue with the next 150 further down the list. The per-session batch counter resets when dsh restarts, but the scanned list is persisted in `ledger.json`, so nothing is lost or duplicated. Every scan starts checking from the top, which also catches newly added favorites.

## Updates

Open dsh Settings → "抖音收藏" and click **检查更新 (Check for updates)**. One click checks GitHub, downloads a newer build, verifies it, replaces the installed files (keeping `.bak` backups), and asks you to restart dsh. The same flow is available to the agent through `douyin_check_update` (`apply=true` installs).

The updater reads versions through the GitHub Contents API first (with a timestamp parameter to bypass edge caching) and falls back to `raw.githubusercontent.com`. The update endpoint only accepts loopback requests and only downloads a fixed file list; it never runs npm/pnpm or installs dependencies.

## Safety

- Dry run by default; execution needs `confirm=true`, `allowDestructive` enabled, and respects `maxUnfavoritePerRun`.
- Only matched cards are selected; never "select all". Every batch is verified by video id.
- Random delays between actions and a 15-item batch cap by default; stops on rate-limit messages.
- All actions are appended to `actions.jsonl`; the ledger marks `unfavoritedAt` instead of deleting records.

## Data

`~/.dsh/douyin/` holds `state.json` (cookies, mode 600), `ledger.json`, `actions.jsonl`, QR/screenshot artifacts. Nothing is uploaded anywhere.

## Limitations

Page selectors can change with Douyin releases; failures are explicit rather than destructive. Sessions expire every few weeks. Headless mode is likely to hit captchas, so a desktop session is required. Captchas must be solved manually.

## Develop

```bash
npm install
npm run build   # src/ -> lib/index.js
npm test        # pure-logic tests, no browser
npm run check
```

## License

MIT
