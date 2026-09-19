## 目標
接續 autopilot 維護。本 session 出貨 v2.36.71：`/next` 排出的七條 fired BACKLOG 列以六個 sonnet 工頭（Agent 子代理）平行修掉，
另關兩條狀態過時的列、新增一條 S 列（impl dispatch timeout floor）。教訓已 land（evidence-discipline §39–41、l5 recipe
「Parallel units」加 sonnet 工頭段）。沒有進行中的工作；下一步由 `/next` 決定。

## 現況
- branch `develop`，release commit `2263ab90`（v2.36.71，QC trailer）已 push；之上只有這份 handoff＋lessons 的 docs commit。
  push 前 `git fetch`——roundtable session 仍在推文件。
- marker 已清（`session-mode.js` 以 `set --level l3 --entry-level l5 --fallback precondition_failed` 降級後 `clear`：平行 clone rail
  沒有 managed campaign，l5 receipt 路徑不可得）；`git worktree list` 只剩主 checkout＋別人的 `7ef6560a…/baseline`；
  `/home/cookys/projects/autopilot-par2/` 已刪；`/tmp` 無 `par3`／hetero-hands-par3 殘留；dispatch-run manifests 已刪。
- routing 仍指 packet graph（digest `4e4a8299…`）；mission state 停 ACTIVE（先例同前）。
- 四席 qc pin 不變。`stash@{0}`（別的 session）別動。
- 主機 run.sh 紅名單（16/358，全部 base 既有）：`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/full-run-summary.txt`；
  BACKLOG `run.sh` 列 Context 指向它。autopilot-cli／provider-readiness-consumer 兩條已從紅名單消失。

## 已決事項(不重議)
- sonnet 工頭拓樸（clone-per-unit、`run_in_background`＋死人開關、`env -u CLAUDE_CODE_SESSION_ID`、marker 不管 clone、
  engine unit 開新 suite 檔）已寫進 l5 recipe；下次同形直接抄 `docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`。
- 改 rail 輸出契約的 brief，Verify 必含 §37 消費者 grep 的全部 suite＋新 `*.test.sh` 的 `test -x`（§39／§41）。
- 消費者 sweep 迴圈每個子行程 `< /dev/null`，row 數要對 list 長度（§40）。

## 下一步
1. `/next`。候選：2-D plan（overlap＋pre-pass，需 plan hetero loop G1/G2）；BACKLOG fired 列剩：`run.sh` 紅（L，名單已更新）、
   `Managed rail: already-scrambled carry-only ledger segments`（Fix）、`disposition resume refuses caller --branch`（Fix）、
   `backlog table migration`（Fix）、intake claim release inconsistency（S）、check-phase-review-receipt 驗證列（S）；新 S 列 timeout floor。
2. 下一個 managed campaign：記 packet-once live 證明（2-C README 一行）＋ A 的 `wall_expired`／C 的 `repair_round_fits` 第一次 live 觀察。

## 驗證方式
- `git log --oneline -3` → `2263ab90` 之上只有 docs commit；`git status --short` 空；`node scripts/session-mode.js status --repo-root "$PWD"` → `active:false`。
- `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8 for v2.36.71。

## Read-order
1. docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/README.md — 拓樸、六 unit 結果、sweep、deferred。
2. skills/l5/references/hetero-impl-loop.md § Parallel units（kimi 段＋sonnet 段）。
3. references/evidence-discipline.md §39–41。
4. docs/BACKLOG.md 前段。

## 陷阱
- 全部已 land；這裡只指：Agent 派工第一行 `Engine: <model>`；hand 建的 test 檔要 `test -x`；`while read` sweep 要 `< /dev/null`；
  `record-integration.js` 要 accepted==HEAD 且要在 branch 上（detached 會 `symbolic-ref failed`）——整合當下就記，別事後補；
  exec-boundary 擋 cwd 外遞迴刪除 → `mv` 進 `/tmp` 再刪；BACKLOG 欄位 240/120/64 上限；Status 文法只有 `open|fired|shipped|dropped <date>`。
