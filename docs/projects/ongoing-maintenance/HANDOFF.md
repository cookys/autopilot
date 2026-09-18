## 目標
接續 autopilot 維護：blind review redesign 2-C 第二條 lineage **`shared-packet`**（plan §1.2：每候選一份 packet、每席 per-file 材化＋launch 前重 hash、批次 tree hash），跑 managed campaign → 收尾 → v2.36.69。2-C station 已出 v2.36.68（merge `21ecc030`）。

## 現況
- branch `develop`，HEAD `e82d1134`（docs：evidence-discipline §36＋l5 recipe 三條），tree 乾淨，全部 push（`origin/develop` = `e82d1134`）。
- routing 仍指 2-C station graph（node integrated、marker retired、worktree／branch reaped、zero residue）。`docs/plans/2026-09-18-blind-review-panel-station.md` 是兩條 lineage 共用的 frozen 來源——**一字不動**。
- 四席 qc 已 pin（`.claude/review-loop-config.md`：claude-fable-5-1、GLM-5.2、MiniMax-M3、Qwen3.8-Max-Preview@qoderclicn；`min_panel_size: 3`）。
- 四件量測都還沒發生（2-A pocket、2-B 四席 §5、v2.36.41 resume e2e、2-C station §5）——shared-packet campaign 跑在 station 之上，會是第一次真的走 panel station。
- `stash@{0}`（別的 session 留的：evidence-discipline §20/§21 pending QC）別動也別 pop。

## 已決事項(不重議)
- 2-C plan §1.2 是 shared-packet 的規範（G1/G2 已折：per-file copy 禁 hardlink、launch 前逐席重 hash 對 `packet_hash`、LF/CR 檔名逐檔 hash 其餘批次且保序、`buildReviewPacket` 1 次／`hashPacketDir` N 次分開計、evidence 放 campaign 外）。
- 一份 plan 一個 graph node → 第二條 lineage 用 `NODE=packet` 跑同一支 freeze 腳本（slug 換 `blind-review-shared-packet-2026-09-18`，routing 跟著換）。
- 收尾程序照 station evidence README（record-integration 在 reap 前；root-run-id＝`campaign_control.campaign_id`；marker retire）。

## 下一步
1. `cd /home/cookys/projects/autopilot && git fetch && git status --short`（要空）；`SCRATCH=<scratchpad>/c2p NODE=packet node docs/plans/evidence/2026-09-18-blind-review-panel-station/scratch/freeze-c2c.js` → 看到 `graph-check READY`、`reconcile`、`authority`；commit `mission(2-C packet): …`（含 `.claude/mission-routing-config.json`、三個 `docs/mission-blind-review-shared-packet-…json`）。
2. `node scripts/session-mode.js set --level l5 --repo-root "$PWD"` → READY；`node bin/autopilot.js mission prepare --repo "$PWD" --authority docs/mission-blind-review-shared-packet-2026-09-18-task-authority.json --graph docs/mission-blind-review-shared-packet-2026-09-18-execution-graph.json --out <scratch>/prepared.json`；`mission grant --prepared … --node shared-packet` → contract/seal/branch/base；確認 contract `final_panel_reserve_seconds: 900`。
3. brief（≤8 KB）照 `docs/plans/evidence/2026-09-18-blind-review-panel-station/impl-brief.md` 的形狀改寫：§1.2 items 1–4 NORMATIVE、§2.2、§2.5 第二張清單（13 個 path）、13 條 verify、base sha；evidence dir 用 `docs/plans/evidence/2026-09-18-blind-review-shared-packet/`（新建，README 先寫一段）；commit 讓 tree 乾淨。
4. dispatch：`AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=<contract.mission_runtime.root_run_id> node bin/autopilot.js engine implement-review --campaign-contract … --campaign-seal … --mission-prepared … --prompt-file … --branch … --base … --cwd "$PWD" --max-rounds 3`（用 `setsid nohup`；**不要 export `AUTOPILOT_SESSION_ID`**）；`rc=` 出現前主 checkout 唯讀；等待用 `run_in_background` 的 `until grep -q '^rc=' …`。
5. `awaiting_disposition` 落地：findings 在 `campaign_receipt.review.findings`、`review_digest` 在 `campaign_receipt.review.review_digest`；照 `docs/plans/evidence/2026-09-18-blind-review-panel-standby/disposition-authority.json` 的 shape 寫 authority（`loadCampaignDispositionAuthority` 先驗）→ `--resume --campaign-disposition-authority`（時鐘已停，v2.36.67；這是 v2.36.41 e2e 量測點）。
6. rail 停就照 station README 的 l3 路徑；收尾 → v2.36.69；README 記四件量測結果。

## 驗證方式
- `git log --oneline -1` → `e82d1134`；`node scripts/session-mode.js status --repo-root "$PWD"` → `active:false`；`git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 是別的 session 的，別動）；`node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY（現在指 station graph；步驟 1 之後指 packet graph）。
- 出貨後：`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` 8/8。

## Read-order
1. /home/cookys/projects/autopilot/docs/plans/evidence/2026-09-18-blind-review-panel-station/README.md — station 全程、env 教訓、兩條 lineage 說明、收尾順序。
2. /home/cookys/projects/autopilot/docs/plans/2026-09-18-blind-review-panel-station.md — §1.2、§2.2、§2.5 第二清單、§4.1、§5（不要改）。
3. /home/cookys/projects/autopilot/skills/l5/references/hetero-impl-loop.md — Depth-0 recipe 步驟 6–10（含新加的 env／clock／one-node 注記）。
4. memory `dispatch-env-no-session-id`、`disposition-resume-within-wall-budget`、`campaign-running-main-checkout-frozen`。

## 陷阱
- 已 land，這裡只指：dispatch env 別帶 `AUTOPILOT_SESSION_ID`（memory `dispatch-env-no-session-id`、evidence-discipline §36、BACKLOG 列）；候選驗證 suites 也 `env -u AUTOPILOT_SESSION_ID`。
- GLM 席 parser 拒收（`duplicate derived BEGIN marker`）但 raw log 判決完整 → 從 raw 採用並存證（BACKLOG 列已開）。
- hand 等背景 suite 會停車 → SendMessage 催前景跑完再 commit（memory `hetero-review-loop-dogfood-lessons`）。
- frozen plan 合併前後都不動；BACKLOG Context／Title 用 `wc -c`；record-integration 在 reap 之前；zsh 雷區照舊。
