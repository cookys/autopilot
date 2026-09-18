## 目標
接續 autopilot 維護。2026-09-17／18 連出三刀：v2.36.62（1b-A cleanroom launcher，merge `94d44940`）、v2.36.63（1b-B intake probe，merge `bc4ea99e`）、**v2.36.64（1c 可設定 packet deny-list，merge `f6cb9a1a`、release `d85f4710`）**。三刀 closeout 全清（record-integration → reap wt／branch → residue receipt zero → marker retire）。**v2.36.65（2-A：fan-out helper、並行 final panel、sealed panel pocket、verify-once，merge `67e3a560`、release `b247e2e4`）也出了**，closeout 全清。blind review redesign 剩 **2-B**（standby seat、panel snapshot at intake、有 panel 時關 in-rail 單席 review、packet build 與 implementer commit 重疊）——沒有 plan。

## 現況
- 無 active marker；routing 仍指 2-A graph（campaign terminal 於 boundary_rejected，adoption 非 COMPLETE → 下一刀 freeze 走 legacy reconcile）。2-A evidence：`docs/plans/evidence/2026-09-18-blind-review-panel-parallel/README.md`（**我在 campaign 跑中 commit handoff 害 rail boundary_rejected** 的完整記錄、resume 走不了的 rail 觀察、四條二審裁決、dogfood 抓到 helper 三 bug）。
- 下一個 managed campaign 可在 graph node 放 `final_panel_reserve_seconds: 900`（0..1800）與 `full_suite_reuse: true` 實測 pocket／verify-once（§5 後半）。1c evidence：`docs/plans/evidence/2026-09-17-blind-review-packet-deny-config/README.md`（G1 attempt 1 transport-exhausted 教訓、dirty-tree pre-spend 拒絕、panel 兩席 rc=124、panel 🟡 與 GLM 🟠 駁回證據、§5 dogfood）。
- 1b-B evidence：`docs/plans/evidence/2026-09-17-blind-review-cleanroom-intake/README.md`（時間線、MiniMax／GLM 工具病、claude 🟡 修補 `af1879cb`、§5 dogfood、resume rail 缺陷）。
- **1c plan**：`docs/plans/2026-09-17-blind-review-packet-deny-config.md`＋`.rubric.md`（DRAFT；§0 行號以 `130b97a8` 校對，plan loop 前用 `d7912c7e`…`f15e9e1e` 之間的 HEAD 再校對一次、Base 釘 release commit）。範圍：`review_packet_deny_extra`（additive、單一 grammar owner＝`normalizeDenyList`、resolver conditional 欄位如 `qc_panel_endpoints`、engine `reviewPacketIdentity` 收 `denyExtra`、review.js 合成 effective list；builder／rail／launcher／intake byte-identical）。manifest／brief／freeze 尚未寫（抄 1b-B 的：`evidence/…-intake/scratch/{run-g.sh,dispatch.sh,freeze-c1d.js}`＋`impl-brief.md`）。
- BACKLOG open rows（多數已 fired；openclaw row 等 cookys 點頭）：final panel 無 repair 迴圈（1b-A）、reviewer no_verdict 留 REVIEWING 不能 resume（1b-B）、**boundary_rejected 後 `--resume` 必 terminal**（2-A）、secret-scan `--range` fail-open（S）、codex pin swap 等 live cleanroom verdict（09-19 16:26 後）、dispatch-review cleanroom path hygiene（S）、openclaw ruling relay（要 cookys 點頭）。panel 餓死 row 已 shipped v2.36.65。
- codex 額度 2026-09-19 16:26 回來後：plan §5 尾段——`cleanroom-launch.sh --profile codex` 對真 packet 拿 parsed verdict → `engine-capability-state.js pin-seat --role qc_panel --engine gpt-5.6-sol --runner codex --effort max …`＋`review-loop-config.md qc_panel[0]` 換回；也可讓 consult 席回 codex。

## 已決事項(不重議)
- 承接上版全部。1c＝additive deny-list（不能拿掉預設）、一個 grammar owner、conditional 欄位不動 `x-field-order`。
- 兩個 in-rail／二審工具病（MiniMax tautological、GLM END 後多字）都不算票；換席補乾淨判決（claude-native）。
- record-integration 要在 reap branch **之前**（需要活 ref）；做反了就從 `.git/autopilot-reap-bundles/` 的 bundle `git fetch <bundle> refs/heads/<b>:refs/heads/<b>` 還原再 record 再刪。

## 下一步（順序）
1. **2-B plan**（parent §7 item 4 剩餘：standby seat、panel snapshot at intake、in-rail off when panel、overlap packet build）：先 subagent 校對 §0（`performFinalPanel` batch path 現況、intake 的 qc_panel_seats 快照點、in-rail review 站的 skip 條件），寫 plan＋rubric → 同 2-A 流程。或先收 BACKLOG fired rows（resume-from-boundary、REVIEWING resume、final panel repair 迴圈、secret-scan fail-open、dispatch-review hygiene）。
1b. 或先收 BACKLOG fired rows：REVIEWING resume（M）、panel 預算 floor（M，可能併進 cut 2）、final panel repair 迴圈（M）、dispatch-review hygiene（S）。
2. campaign 跑時：起草 cut 2（verify-once、並行席）或處理 BACKLOG fired rows。
3. 收尾同 1b-A／1b-B（驗候選、二審 full diff 不加路徑、§5 dogfood、merge trailer 末段、`sync-version.js --version 2.36.64 --hook-count 31 --skill-count 30`、CHANGELOG／INDEX／maintenance／BACKLOG、**record-integration → reap → receipt → retire**、preflight 8/8、push）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/session-mode.js status --repo-root "$PWD"` → `"active": false`。
- `git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 是別的 session 的，別動）；`git branch --list 'mission/*'` 空。

## Read-order
1. `docs/plans/2026-09-17-blind-review-packet-deny-config.md`＋rubric。
2. `docs/plans/evidence/2026-09-17-blind-review-cleanroom-intake/README.md`、`scratch/`（配方）。
3. `skills/l5/references/hetero-impl-loop.md` Depth-0 recipe。
4. `docs/BACKLOG.md` open rows（上面列的）。

## 陷阱
- **frozen rubric 一字不動**；receipt 用被審那版 bytes；G2 要 `--disposition-file <g1-dispositions.json>`（`generation: 1`），漏了 rc=3 不派。
- disposition 詞彙：`accepted_blocker`／`accepted_nonblocking`／`deferred`／`rejected`（沒有 `accepted`）。
- **二審 diff 不加路徑**；reviewer 說格式錯先查 pre-commit（CLAUDE.md 800 B 行）。
- zsh：`echo ===` 炸、`$PIPESTATUS` 要 bash、**`"$B:refs/…"` 會被 `:r` 修飾子吃掉**（用 `${B}:` 或 bash -c）；`load-endpoints-env.sh` 包 `bash -c`。
- 套件一次一個；長工作 setsid nohup＋Monitor（30 分鐘會過期要重掛）；scratchpad 隨 session 消失——產物先進 repo。
- **campaign 派出前 `git status --short` 必須空**（1c：未追蹤檔 → intake 拒，pre-spend 不燒 attempt）；**跑中主 checkout 完全唯讀——連 docs-only commit、fetch 都不行**（2-A：我 commit 了 handoff → rail `boundary_rejected` 丟掉 91 分鐘的 hand 輪，且 resume 走不了）。handoff 寫 scratchpad，`rc=` 出來再進 repo。
- plan review 的 claude-native 席會想在 scratch cwd 跑工具（1c G1 attempt 1）：plan §2.6 放「citations are provenance, not reading assignments」條款，manifest 給 MiniMax fallback，重跑用 fresh `--state-dir`。
- bash `[[ == *[\?\[\]\{\}]* ]]` 裡反斜線是引號不是成員（GLM 二審誤報）；reviewer 講 shell 語意先實測。
- reaper root-run-id 給 campaign_id（`impl-run1*.json` `campaign_control.campaign_id`）。
