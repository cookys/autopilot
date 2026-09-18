## 目標
接續 autopilot 維護。2026-09-18 已出 v2.36.66（2-B）、v2.36.67（rail 兩缺陷）、**v2.36.68（2-C station，merge `21ecc030`）**。下一步：**2-C 第二條 lineage `shared-packet`**（同一份 plan，`NODE=packet`），之後 2-D。

## 現況
- routing 仍指 2-C station graph（node 已 integrated、marker 已 retire）；`docs/plans/2026-09-18-blind-review-panel-station.md` 是 frozen 來源，**合併前後都不要動**（兩條 lineage 都封它的 bytes）。
- station campaign 實況：hand 綠但 rail acceptance 被我 export 的 `AUTOPILOT_SESSION_ID` 打紅（BACKLOG 新列）→ l3 收尾。**dispatch 時不要 export `AUTOPILOT_SESSION_ID`**——intake 用 `CLAUDE_CODE_SESSION_ID` 就能對上 marker（2-B 就是這樣過的）。
- 四席 qc 已 pin（第四席 Qwen3.8-Max-Preview@qoderclicn，`.claude/review-loop-config.md`）。
- 四件未量到（2-A pocket、2-B 四席 §5、v2.36.41 resume e2e、2-C station §5）全留給 shared-packet campaign——它跑在 station 之上，第一次真的會走 panel station。

## 已決事項(不重議)
- 2-C plan §1.2 為 shared-packet 的規範（per-file copy 禁 hardlink、launch 前逐席重 hash、批次 tree hash 但 LF/CR 檔名逐檔、`buildReviewPacket` 1 次／`hashPacketDir` N 次分開計）。
- 收尾程序照 station evidence README。

## 下一步（順序）
1. `git fetch`；`SCRATCH=<scratch> NODE=packet node docs/plans/evidence/2026-09-18-blind-review-panel-station/scratch/freeze-c2c.js` → 新 graph `docs/mission-blind-review-shared-packet-2026-09-18-*.json`、routing 換過去、legacy reconcile、authority；commit（mission commit）。
2. `session-mode set --level l5` → `mission prepare` → `mission grant --node shared-packet`；brief 照 station 的 `impl-brief.md` 改寫（§1.2 normative、§2.5 第二張清單、13 條 verify）；commit evidence；dispatch **不帶 AUTOPILOT_SESSION_ID**；主 checkout 唯讀到 `rc=`；`awaiting_disposition` 落地照 2-B authority 檔格式裁決後 resume（時鐘已停）。
3. 收尾 → v2.36.69；README 記四件量測結果（有就有、沒有就寫沒有）。

## 驗證方式
- `git log --oneline -2` 頂端 `edc679ed`、`21ecc030`；`session-mode.js status` → `active:false`；`git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 別人的）；`git branch --list 'mission/07f86eff432f/*'` 空。

## Read-order
1. `docs/plans/evidence/2026-09-18-blind-review-panel-station/README.md`（station 全程＋env 教訓）。
2. plan §1.2、§2.2、§2.5 第二清單、§4.1；`scratch/freeze-c2c.js`（NODE 切換）。
3. memory：`disposition-resume-within-wall-budget`、`campaign-running-main-checkout-frozen`。

## 陷阱
- dispatch env 只放 `AUTOPILOT_LEVEL`、`AUTOPILOT_ROOT_RUN_ID`；**不要** `AUTOPILOT_SESSION_ID`。
- 候選驗證跑 suites 也要 `env -u AUTOPILOT_SESSION_ID`（mission-runtime-v2 對它敏感）。
- hand 等背景 suite 會停車 → SendMessage 催前景跑完再 commit。
- GLM 席 parser 拒收（重複 BEGIN marker）時先看 raw log，判決完整就採用並存證。
- 其餘照舊：frozen plan 不動、Monitor 用 until-grep、BACKLOG 用 `wc -c`、record-integration 在 reap 前、zsh 雷區。
