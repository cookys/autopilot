## 目標
接續 autopilot 維護。2026-09-17／18 已出 v2.36.62（1b-A）、v2.36.63（1b-B）、v2.36.64（1c）、v2.36.65（2-A，merge `67e3a560`），全部 push。**2-B（quorum panel＋standby seat＋panel snapshot at intake）已 freeze、grant（attempt 1 claimed），尚未 dispatch**——上個 session 在 context T2 停下。接手：dispatch → 等 rail → 收尾 → v2.36.66。

## 現況
- `develop` 領先 `origin/develop`（2-B prep commits 未 push；push 前先 `git fetch` 查 canonical version，2-A 是 2.36.65）。
- session marker **l5 active**（session `ed4f4545-3dbb-4256-bdb4-80502ec4d221`）；routing → `blind-review-panel-standby-2026-09-18`（graph `54093811…`、lineage `lineage-v1-1077fd40…`）。grant：branch `mission/1077fd40c74c/blind-review-panel-standby-2026-09-18-a1`，base `83e3ac9c`（＝freeze commit；HEAD 之後多了 handoff commit，intake 不要求 HEAD＝base——1c 也是這樣過的；若 intake pre-spend 拒絕，grant 回 `replay` 不燒 attempt）。
- **dispatch 指令**（自含、絕對路徑）：`SCRATCH=/tmp/claude-1000/<你的 scratchpad>/c2b bash docs/plans/evidence/2026-09-18-blind-review-panel-standby/scratch/dispatch.sh`（用 `setsid nohup … &`）。派出前 `git status --short` 必須空；**派出後到 `rc=` 出現前主 checkout 完全唯讀（不 commit、不 fetch、不 checkout）**——2-A 就是被我 mid-run 的 docs commit 打成 `boundary_rejected` 丟掉 91 分鐘。
- plan：`docs/plans/2026-09-18-blind-review-panel-standby.md`（SHIPPED 前狀態 draft；G1 6 折／G2 3 折、receipts rc 0）；rubric R1–R8 frozen；brief `evidence/…-panel-standby/impl-brief.md`（已填 base）；base suites 11/11 `base-suites-aeea2ca7.txt`。
- **新發現的 2-A live 缺陷（登 BACKLOG，closeout 時）**：graph node 的 `final_panel_reserve_seconds: 900`／`full_suite_reuse: true` 沒有進 contract（`mission-convergence.js:1469-1481` 的 `expectedDispatch` 與 draft 都不帶這兩欄；2-A 的 hand 只加了驗證沒加投影）→ intake 封的是預設 0／true。這場 campaign 因此**沒有 pocket**；verify-once 預設 true 仍會生效（`full_suite` reuse 看 limits.full_suite_reuse === 0）。2-B 不修（rail byte-identical 是 R5）；下一刀或 BACKLOG row。
- 2-A 剩餘 §5 live 證明（pocket）要等這缺陷修好。

## 已決事項(不重議)
- 承接上版全部。2-B 範圍＝plan §1 兩條（quorum：`min_panel_size` 是 quorum、failed seat 留 row 標 `load_bearing:false`、terminal `final_panel_quorum_met`＋`sealed_required_review_families`＋`implementer_family`、validator 從 rows 重導、schema 四欄 optional＋legacy 語意；snapshot：`qc_panel_snapshot.json` O_EXCL 寫在 contract 旁、resume 永不重畫、live drift 記 step、panel 從 snapshot 取席）。in-rail off＋panel repair＋shared packet ＝ 2-C。
- 收尾照 2-A：降級 l3（若 rail 停）、驗候選十一條（`evidence/…/scratch/suites.sh` 沒存——照 §4.1 寫）、二審 full diff `git diff 83e3ac9c..<head>` 不加路徑（GLM anthropic-compatible＋claude-native；20m）、§5 dogfood、merge `--no-ff` trailer 末段、`sync-version.js --version 2.36.66 --hook-count 31 --skill-count 30`、CHANGELOG／INDEX／maintenance／BACKLOG（redesign row Context 224 B 字串在 brief）、evidence README、**record-integration（accepted＝HEAD、source 要活 ref）→ reap wt／branch（root-run-id＝`campaign_control.campaign_id`）→ residue receipt → retire marker** → preflight 8/8 → push。

## 下一步（順序）
1. dispatch（上面指令）→ Monitor `impl-run1.err` 出 `rc=`（30 分鐘會過期要重掛）。
2. rail 停了照「已決事項」收尾。
3. closeout 時 BACKLOG 新增：2-A knobs 沒進 contract（M）。
4. 之後 2-C plan（in-rail off when panel＋panel-driven repair round＋shared packet per candidate）。

## 驗證方式
- `node scripts/session-mode.js status --repo-root "$PWD"` → `"active": true, "level": "l5"`。
- `git status --short` 空；`git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 是別的 session 的，別動）。
- `ls .git/autopilot/mission/artifacts/1077fd40c74c*/blind-review-panel-standby-2026-09-18/attempt-1/` 有 `campaign.json`、`campaign.seal.json`。

## Read-order
1. `docs/plans/2026-09-18-blind-review-panel-standby.md`＋rubric、`evidence/…-panel-standby/impl-brief.md`。
2. `docs/plans/evidence/2026-09-18-blind-review-panel-parallel/README.md`（2-A 全程：boundary_rejected 教訓、二審裁決、helper 三 bug）。
3. `skills/l5/references/hetero-impl-loop.md` Depth-0 recipe。
4. memory：`campaign-running-main-checkout-frozen`、`managed-campaign-depth0-recipe`。

## 陷阱
- **主 checkout 在 campaign 跑中唯讀**（見上）。handoff 寫 scratchpad，`rc=` 後再進 repo。
- BACKLOG Context／Title 上限（240／120 B）**用 `wc -c` 量**，別心算（2-B G2 就是我算錯兩次）。
- frozen rubric 一字不動；receipt 用被審那版 bytes（`plan.as-reviewed-gN.md`）；G2 要 `--disposition-file`（`generation:1`）。
- 二審 diff 不加路徑；reviewer 說格式錯先查 pre-commit（CLAUDE.md 800 B 行）。
- resume：REVIEWING 與 BOUNDARY_REJECTED 都 resume 不了（BACKLOG）；rail 停就降級 l3 用保留 worktree 的 hand commit。
- record-integration 要在 reap branch 之前；反了從 `.git/autopilot-reap-bundles/` `git fetch <bundle> "refs/heads/${B}:refs/heads/${B}"`（zsh 要 `${B}:` 避免 `:r` 修飾子）。
- zsh：`echo ===` 炸、`$PIPESTATUS` 要 bash、`load-endpoints-env.sh` 包 `bash -c`；套件一次一個；長工作 setsid nohup＋Monitor。
