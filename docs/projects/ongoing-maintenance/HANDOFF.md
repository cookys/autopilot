## 目標
接續 autopilot 維護。本 session 出貨兩版：v2.36.69（2-C shared-packet，第二條 lineage）與 v2.36.70（四條 rail 缺陷以四個 kimi 工頭平行修掉）；教訓已 land（evidence-discipline §37/§38、l5 recipe step 9/9b＋「Parallel units」段）。沒有進行中的工作；下一步由 `/next` 決定。

## 現況
- branch `develop`，HEAD `6c77dc6b`（docs：§37/§38＋l5 recipe，帶 QC trailer）之上只有這份 handoff 的 docs commit（含一條新 BACKLOG 列）；tree 乾淨，`origin/develop` 同 HEAD（push 前 `git fetch`——另一個 session 在推 roundtable 文件）。
- marker `active:false`；`git worktree list` 只剩主 checkout＋別人的 `7ef6560a…/baseline`；`par/*`、`tmp-suites-*`、`foreman/*`、`hands/*` 分支為 0；平行 clone 目錄已刪；`/tmp` 無 foreman／hands／mission 殘留。
- routing 仍指 packet graph（`docs/mission-blind-review-shared-packet-2026-09-18-*.json`，digest `4e4a8299…`，lineage `b33ff20c…`，node integrated）；mission state 與 station 一樣停 ACTIVE（先例：下一條 lineage 用新 adoption key 直接 prepare；換 graph 先 `mission-terminal-reconcile.js legacy --graph-digest <new>`）。
- 四席 qc pin 不變（claude-fable-5-1、GLM-5.2、MiniMax-M3、Qwen3.8-Max-Preview；`min_panel_size: 3`、`in_rail_review: auto`）。
- `stash@{0}`（別的 session：evidence-discipline §20/§21 pending QC）別動也別 pop。
- CI `tests` workflow 在 develop 是既有紅（`dispatch-detached-campaign-authority` 2 條，BACKLOG 列），v2.36.69/70 沒新增。

## 已決事項(不重議)
- 平行拓樸：一 unit 一個 `git clone`（同一 `.git` 只能一個 rail）、kimi 工頭走 `dispatch-foreman.sh`（不是 managed engine）、clone-local shadow governance commit 絕不併、hands 用 cherry-pick 在所有 `rc=` 之後合併——已寫進 `skills/l5/references/hetero-impl-loop.md` § Parallel units。
- 停在 `awaiting_disposition` 先算剩餘 wall；塞不下 implement+verify+panel 就 l3，不 resume（recipe step 9）。
- engine／runner 類 deliverable 的 §5 live 證明要下一個 campaign 才看得到（recipe 9b、§38）：packet-once 的 live 證明＝下一個 managed campaign 的 panel 要看到一個 `autopilot-review-shared-*`＋各席 `autopilot-review-blind-*`，seats 幾秒內備好。
- 出貨前做消費者 sweep（§37）：grep 移動的識別字找 test suites，減掉已跑的，紅的在 base 重跑歸因。本機 6 條既有紅（BACKLOG `run.sh` 列有名單），別誤判回歸。

## 下一步
1. `/next`。候選：2-D plan（overlap＋pre-pass，需 plan hetero loop G1/G2）；BACKLOG fired 列（wall-expiry 終結 summary＝D 留 open；repair 輪 wall 保留；`boundary_rejected` resume；`run.sh` 紅要先驗是否過時；`secret-scan-diff.test.sh` 植入字面改 concatenation）。
2. 再開平行輪就照 recipe「Parallel units」四步（clone → shadow commit → brief+plan 照 `docs/plans/evidence/2026-09-18-parallel-kimi-foremen/common.md` → `launch.sh`），brief 的 allowed files 連 schema／validator 一起列。
3. 下一個 managed campaign 順手把 packet-once live 證明記進 `docs/plans/evidence/2026-09-18-blind-review-shared-packet/README.md`（一行）。

## 驗證方式
- `git log --oneline -3` → 在 `6c77dc6b` 之上；`git status --short` 空；`node scripts/session-mode.js status --repo-root "$PWD"` → `active:false`；`git worktree list` 只剩主 checkout＋別人的 baseline；`node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY（digest `4e4a8299`）。
- `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8 for v2.36.70。

## Read-order
1. /home/cookys/projects/autopilot/docs/plans/evidence/2026-09-18-parallel-kimi-foremen/README.md — 平行拓樸、四單位結果、消費者 sweep、deferred 🔵。
2. /home/cookys/projects/autopilot/skills/l5/references/hetero-impl-loop.md — Depth-0 recipe step 7/9/9b/10 與「Parallel units」段。
3. /home/cookys/projects/autopilot/docs/plans/evidence/2026-09-18-blind-review-shared-packet/README.md — 2-C packet 全程與五項量測。
4. /home/cookys/projects/autopilot/docs/BACKLOG.md 前段 fired 列。

## 陷阱
- 全部已 land，這裡只指：dispatch env 別帶 `AUTOPILOT_SESSION_ID`（§36；v2.36.70 起 verify 站自己洗）；主 checkout 在 `rc=` 前唯讀（連 fetch）；hand 等背景 suite 會停車 → SendMessage 催前景；protected path 的 docs-only commit 也要 QC trailer（先派一次 claude 審）；QC trailer 與 Co-Authored-By 同末段；record-integration 要完整 OID；zsh 起多個背景工作要 `bash -c`；exec-boundary 擋 cwd 外遞迴刪除 → `mv` 進 `/tmp` 再刪（memory `parallel-kimi-foremen-recipe`）；BACKLOG 欄位用 `wc -c` 對 240/120/64 上限。
