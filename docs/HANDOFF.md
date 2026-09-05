## 目標

無進行中工作。這份 handoff 記錄 2026-09-05：**v2.36.1「statusline → hook live context feed」已 merge 到 `develop`（`d926184e`）、歸檔、分支已刪**，
尚未 push。同日 codeforge `main` 也有兩個 commit（`f69a52e` live writer merge、`d080ca7` vectors 同步）已安裝到這台。

## 現況

- **branch**: `develop`，比 `origin/develop` 領先約 27 個 commit（含 merge），working tree 乾淨；feature 分支已刪；session marker `active: false`；
  `~/.autopilot/config.json` 已從 KR2 探針的暫時 T2=1000 還原（`context_budget` 現為 null＝預設）。
- **version**: 2.36.1（30 skills，29 hooks：16 default-on／13 opt-in）。新 hook `depth0-delegate-gate`（default-on，不綁 marker），新 lib `scripts/lib/live-state-dir.js`。
- **這台已上線的行為**：codeforge 每 tick 寫 `/run/user/1000/autopilot/context/<sid>.json` 與 `<sid>.tasks.json`；`~/.claude/settings.json` 多了 `subagentStatusLine`；
  `context-budget` 用真窗口（訊息帶 `(statusline)`），state 在 tmpfs；`foreman-guard` 在 l4–l6 marker 下用子代理自己的 tokenCount 於 T2 deny；depth-0 連續 8 次 read 類呼叫會被提醒改派。
- **測試**: 全套 `run.sh --parallel 4` 平行段綠、`scripts/lib/*.test.js` 已進 suite；紅的只有 develop 既有四檔（`context-window` 2、`resolve-review-loop-consult-discuss-switch` 2、
  `resolve-review-loop-role-admission` 1、`slash-entry-probe` 負載 0-byte）加 `contract-parity` 8（reviewer 在 base 上重現）。
- **IN-FLIGHT**: 無派工、無 worktree（除舊 session 的 scratchpad baseline）。

## 已決事項（不重議）

- live 檔走 RAM，路徑逐一 `findmnt`（argv，無 shell）／`/proc/mounts` 探測只收 tmpfs|ramfs，全不過退 `~/.autopilot` 並警告一次；兩檔各一 writer；`schema_version` 只收整數 1；120 s freshness；沉默永不是通過。
- `depth0-delegate-gate` 無 live 檔也提醒（owner 需求），只有 `block` 模式＋live 模型家族在 guarded 才 deny；`Bash` matcher 是對 plan 的接受擴充（BACKLOG 記錄）。
- depth-0 deny tier 仍不做（BACKLOG T3 row）；tmpfs 目錄擁有者檢查、`> 0` 窗口、計數鎖、0-row 診斷節流、測試強度四項都在 BACKLOG，有觸發條件。
- plan-loop freeze 遇 dispatcher／checker disposition 形狀不同：對審過的位元組跑 checker、ledger 記 delta（BACKLOG row）。

## 下一步

1. `git push origin develop`（push 前照慣例 `git show origin/develop:.claude-plugin/plugin.json` 看有沒有人搶了 2.36.1）；codeforge `main` 也要 push。
2. P5 fleet rollout 仍待 owner 在 cuda 授權；v2.36.1 在其他主機需要 codeforge 也更新才有 live 檔（沒有就是舊行為，安全）。
3. BACKLOG 新增 5 筆（本版）：tmpfs 擁有者檢查最值得先做（多人主機前）。
4. 上一版留的：`normalize_agy_alias` 排除比對、stale topology cache、g1 finding `42864072`、ladder auto 未決。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 空
git log --oneline -1                # 7549a0ae (archive) 之上或 d926184e merge 在歷史裡
node -p "require('./.claude-plugin/plugin.json').version"   # 2.36.1
node scripts/check-hook-inventory.js --check                # 29 hooks (16/13)
ls /run/user/1000/autopilot/context/                        # <sid>.json + <sid>.tasks.json（statusline 每 tick 寫）
bash scripts/preflight-release.sh | tail -1                 # 8/8
```

## Read-order

1. `CHANGELOG.md` v2.36.1 節。
2. `docs/projects/_archive/2026-09-05-statusline-live-context-feed/README.md` 與 `ledger/`（p0 spike、kr2 receipt、plan-review freeze）。
3. memory `depth0-delegates-research`、`live-state-goes-tmpfs`、`hetero-review-loop-dogfood-lessons`（本日補充段）。

## 陷阱

- hands 等自己的背景 suite 通知必停車；brief 要寫前景 `timeout` 跑 suite，depth-0 自掛 pgrep waiter。hands 會覆蓋自己在寫的 log；`cp /proc/<pid>/fd/1` 撈到**新檔名**。
- statusline 只讀一行 stdin：用 ledger 的 pretty-printed payload 餵 binary 會什麼都不寫，要先壓成單行。
- `exec-boundary` 會擋 `rm -rf` 到 cwd／tmp 之外（含 `$XDG_RUNTIME_DIR`）；用 `rm -f` 檔案＋`rmdir`。
- zsh Bash 工具：`=====` 開頭 echo 失敗、`--include=*.rs` glob 爆；要 bash 語意就 `bash -c`。
- 在 worktree 裡 `git merge` 再 `git worktree remove` 會砍掉自己的 cwd；merge 一律從主樹做。

## 上一段（2026-09-04，已出貨）

v2.36.0 dev-flow hetero loops as default（`f756fcf5`）。
