## 目標

無進行中工作。這份 handoff 是 2026-09-05 收尾快照：**v2.36.1「statusline → hook live context feed」已出貨、歸檔、兩個 repo 都已 push**。
（取代前一版 handoff。）

## 現況

- **autopilot**: `develop` = `9b6596fd`，與 `origin/develop` 同步；working tree 乾淨；無 feature 分支、無 worktree（只剩舊 session 的 scratchpad baseline）；
  session marker `active: false`；`~/.autopilot/config.json` 是預設（KR2 探針的暫時 T2 已還原）。
  stash@{0}「evidence-discipline §20/§21 (needs QC review)」是更早 session 留的，本次沒動。
- **codeforge**: `main` = `f036dd2`，與 origin 同步（含 live writer merge `f69a52e`、vectors 同步 `d080ca7`、origin 的 mnemos fix merge）；remote 已改 ssh；binary 已 `cargo install`。
- **version**: autopilot 2.36.1（30 skills，29 hooks：16 default-on／13 opt-in）。
- **這台已上線**：codeforge 每 tick 寫 `/run/user/1000/autopilot/context/<sid>.json` 與 `<sid>.tasks.json`；`~/.claude/settings.json` 有 `subagentStatusLine`；
  `context-budget` 用真窗口、state 在 tmpfs；`foreman-guard` 在 l4–l6 marker 下用子代理自己的 tokenCount 於 T2 deny；`depth0-delegate-gate` 連續 8 次 read 類呼叫提醒改派。
- **DONE**: P0–P4、finish-flow L-5.1–5.7、docs follow-through（hooks/README § Live context feed、coexistence 節、settings.example、front-door 過時段）。
- **IN-FLIGHT**: 無。

## 已決事項(不重議)

- live 檔走 RAM，路徑逐一探測（`findmnt` argv／`/proc/mounts`）只收 tmpfs|ramfs，全不過退 `~/.autopilot` 並警告一次 — owner：不磨 SSD、路徑不能假設。
- 兩個 live 檔各一個 writer、各自 `written_at`；`schema_version` 只收整數 1；120 s freshness；沉默永不是通過 — plan loop g1 R4/R5/R12。
- `depth0-delegate-gate` 無 live 檔也提醒、只在 `block`＋guarded 家族才 deny；`Bash` matcher 是對 plan 的接受擴充 — owner 要的是一般 session 也有 gate。
- depth-0 deny tier 不做（BACKLOG T3 row）；tmpfs 擁有者檢查等六項 cut 進 BACKLOG 帶觸發條件 — reviewer 裁決，單人主機無在範圍失效。
- plan-loop freeze 對「審過的位元組」跑 checker、ledger 記 delta — dispatcher／checker disposition 形狀不同（BACKLOG row）。

## 下一步

1. 沒有必做項。若接續：`grep -n "^### " docs/BACKLOG.md | tail -8` 看本版新增的五筆，優先「Live-state base on world-writable tmpfs — ownership/mode check」（多人主機前）。
2. P5 fleet rollout 仍待 owner 在 cuda 授權；其他主機 `dev-update.sh` 後要 codeforge 也更新（`cargo install --path .`＋`codeforge install --subagent-statusline`）才有 feed，沒有就是 v2.36.0 行為。
3. 上一版留的：`normalize_agy_alias` 排除比對、stale topology cache、g1 finding `42864072`、ladder auto 未決。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain && git log --oneline -1          # 空；9b6596fd
git log --oneline develop..origin/develop | wc -l       # 0
node -p "require('./.claude-plugin/plugin.json').version" # 2.36.1
node scripts/check-hook-inventory.js --check             # 29 hooks (16/13)
ls /run/user/1000/autopilot/context/                     # <sid>.json + <sid>.tasks.json
git -C ~/projects/codeforge status -sb | head -1         # ## main...origin/main
```

## Read-order

1. /home/cookys/projects/autopilot/CHANGELOG.md — v2.36.1 節，含 QC 帳與 hands 停車病。
2. /home/cookys/projects/autopilot/hooks/README.md — § Live context feed，接 feed 的唯一說明。
3. /home/cookys/projects/autopilot/docs/projects/_archive/2026-09-05-statusline-live-context-feed/README.md — 決策與 ledger 入口。

## 陷阱

- 本次 session 的陷阱已全部路由：hands 停車／`/proc` 撈 log／MiniMax 席換席／freeze drift → memory `hetero-review-loop-dogfood-lessons`；
  depth-0 不自己調研 → memory `depth0-delegates-research`；tmpfs 探測 → memory `live-state-goes-tmpfs`；harness 另一通道已公布的值不該推斷 → `references/evidence-discipline.md` §26；
  worktree 內 merge 再 remove 砍掉 cwd → memory `background-agent-parking-worktree-traps`；`exec-boundary` 擋 `rm -rf` 到 `$XDG_RUNTIME_DIR` → memory `residue-cleanup-evidence-traps`。
- statusline 只讀一行 stdin：ledger 的 pretty-printed payload 要壓成單行才能餵 binary（ledger p1 README 有記）。
