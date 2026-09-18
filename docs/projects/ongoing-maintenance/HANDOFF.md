## 目標
接續 autopilot 維護。2026-09-18 已出 v2.36.62（1b-A）、v2.36.63（1b-B）、v2.36.64（1c）、v2.36.65（2-A）、**v2.36.66（2-B，merge `9f17bdc1`，release `3145207c`）**。下一刀 **2-C**：有 panel 時關 in-rail 單席 review＋panel 驅動的 repair round＋每候選一份共用 packet。

## 現況
- 2-B campaign 走完 hand（`3641cbef`）→ verify → MiniMax 二審 → full_suite，在 sealed 7200 s 的第 6686 s 停 `awaiting_disposition`；depth-0 寫 authority 後 `--resume` 12 分鐘後被 intake `WALL_BUDGET_EXCEEDED` 擋 → 降級 l3 收尾（evidence README 有全程）。兩個 l5 marker（`ed4f4545`、`71623dad`）都已用 integration receipt retire；worktree／branch 已 reap（bundle 在 `.git/autopilot-reap-bundles/2026-09-18/`）。
- **`docs/plans/2026-09-18-blind-review-panel-standby.md` header 仍寫 draft，是故意的**：sources manifest 綁 plan bytes，routing 還指著 2-B graph；2-C 的 mission commit 換 routing 時順手把 header 翻成 `SHIPPED v2.36.66 (merge 9f17bdc1)`。在那之前不要動這個檔（動了所有 `session-mode set` 都被拒）。
- BACKLOG 新增兩列（2-A knobs 不投影進 contract；durable wait 算進 wall budget）。2-A §5 pocket 證明、2-B §5 live 證明（四席 min 3＋intake 後改 pin）、v2.36.41 disposition-resume e2e 三件都還**沒量到**——都指向下一場 managed campaign。

## 已決事項(不重議)
- 2-B 範圍已出貨；2-C 三項如上。r2/r3 二審給 2-C 的三條備忘：snapshot 寫在 claim 之後（現在在 claim 前，spec 如此）、resume 時驗 snapshot 自身 digest、live roster 翻 `qc_panel_seats_complete=false` 仍要讀既有 snapshot（現在直接跳過，fail-closed）。
- 收尾程序照 2-A／2-B evidence README（record-integration 在 reap 之前；root-run-id＝`campaign_control.campaign_id`）。

## 下一步（順序）
1. `git fetch`、確認 origin 已是 3145207c（本 session push 過）。
2. 2-C plan（照 2-B plan 格式；先修 BACKLOG「durable wait 算進 wall budget」與「2-A knobs 不投影」兩列——不然下一場 campaign 又沒 pocket、又不能晚 resume；兩列都是 S/M 可併進 2-C 或先出 patch）。
3. 2-C campaign 前：第四個 qc family 先 `engine-capability-state.js pin-seat --role qc_panel`，`min_panel_size: 3` 四席，才能產 2-B §5 live 證明。

## 驗證方式
- `git log --oneline -3` 頂端 `3145207c`、`9f17bdc1`；`node scripts/session-mode.js status --repo-root "$PWD"` → `active:false`。
- `git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 是別的 session 的）；`git branch --list 'mission/1077fd40c74c/*'` 空。
- `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` 8/8。

## Read-order
1. `docs/plans/evidence/2026-09-18-blind-review-panel-standby/README.md`（2-B 全程＋rail 缺陷）。
2. `docs/plans/2026-09-18-blind-review-panel-standby.md` §1.3（2-C 範圍）、BACKLOG 兩列。
3. `skills/l5/references/hetero-impl-loop.md` Depth-0 recipe；memory `campaign-running-main-checkout-frozen`、`managed-campaign-depth0-recipe`。

## 陷阱
- **`awaiting_disposition` 落地時先看 run JSON `campaign_receipt` 的 `elapsed_wall_seconds` 對 `max_wall_seconds`**：剩多少就在多少內裁完並 resume，否則整場不可恢復（2-B 剩 514 s）。
- Monitor 用 `tail -f | grep | grep -v` 連兩次漏掉 `rc=`（各燒 30 分）；等 `rc=` 用 Bash `run_in_background` 的 `until grep -q` 迴圈。
- 主 checkout 在 campaign 跑中唯讀（含 fetch）；handoff 寫 scratchpad。
- BACKLOG Context／Title 上限用 `wc -c` 量；frozen plan 合併後不動；二審 diff 不加路徑；record-integration 在 reap 之前；zsh 雷區（`echo ===`、`$PIPESTATUS`、`load-endpoints-env.sh` 包 `bash -c`）。
