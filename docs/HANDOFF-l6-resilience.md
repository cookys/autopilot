# HANDOFF — l6-resilience campaign（mid-work，2026-07-08）

> 給接手 session。這是 autopilot /l6 韌性改善的續作交接。**先讀 `docs/BACKLOG.md` 三個 l6 條目**（權威技術狀態，可攜）。

## ⚠️ 最高優先：多-agent 同機協作（本 session 最痛教訓）
- **同一台機器有另一個 agent 在動這個 autopilot repo**（observation-first 軌，job `31d0d311`，branch `plan/observation-first`，在修 engine verify-cwd/ratchet bug）。
- **任何 `git commit` 前必做**：`git -C <repo> branch --show-current` 確認在自己的 branch；**開 worktree 隔離**（`git worktree add /tmp/<mine> <base>`）作業。本 session 因主 checkout 被別人留在 `plan/observation-first` 而**誤 commit 到別人分支兩次**。
- **絕不碰** `plan/observation-first`、其 worktree、或其 running codex process（別 kill、別 rebase、別 reset）。要動別人分支＝先協調。
- doc/backlog 寫入用「隔離 worktree off develop → commit develop → remove worktree」pattern（本 session 驗證乾淨）。

## 進度
- **Plan**：`docs/plans/2026-07-08-l6-resilience-improvements.md`，4 版 hetero loop-review（agy/codex/MiniMax）收斂 SHIP-AS-IS。R0 ledger 地基 + R1-R5 handler，依賴鏈 R0→R2/R3→R1→R4，R5 正交。
- **實作**：6 支全實作，在 **`feat/l6-r1r5` @ `3cf9f92`（未 merge develop）**。4 支測試綠（run-ledger 25 / autopilot-engine 287 / dispatch-review 129 / classify-diff-risk 18）。
- **depth-0 qc panel**（三家族）抓到**測試未覆蓋的 verified Critical**→ **HOLD merge**（不 ship 半熟併發 code 到 harness mainline）。findings 全在 `docs/BACKLOG.md`「l6-resilience R0-R5 impl 有 qc verified Critical」條。

## 下一步＝fix pass（獨立 L 專案）
修 backlog 列的 verified Critical（R0 ledger shared-檔+per-run 鎖丟記錄=最關鍵、stage-apply 冪等 crash-ordering、R2 gate files_changed 遮蔽、engine round 冪等 + Majors）→ **re-qc 必須涵蓋全 6 支含 R1**（R1 在 qc 後才 merge、未經 depth-0 qc）→ 過了才 merge feat/l6-r1r5→develop。建議 hetero implementer + 四支測試擴充含併發/crash-ordering case。

## 環境/機具
- roster override（gpt-5.3-codex-spark implementer + agy reviewer + 三家族 qc panel）：`/tmp/claude-1000/-home-cookys-project-PEACE/9a04f9a3-4f6b-4b23-a32d-7591c9a1ff10/scratchpad/review-loop-config-override.md`（本機、clear 後需重建或改用 repo 內 config）。
- 已固化操作教訓在 memory `feedback_hetero_worktree_tmp_gc_and_dispatch_rails.md`（detach 免 15min 牆 / root 容器 GC / cross-repo commit 前建 branch / foreman-death recovery / idle≠stall）。
- ⚠️ codex 偶發 OpenAI transport 斷線（R1 兩次 648k tokens 斷）——大 diff 改 inline fallback。
- 另兩 backlog 條：R6-research（foreman↔depth-0 協調機制）、R1 已 land 更正。
