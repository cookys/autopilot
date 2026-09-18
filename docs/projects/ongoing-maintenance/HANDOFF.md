## 目標
接續 autopilot 維護。blind review redesign 2-C 兩條 lineage 都已出貨（station v2.36.68 `21ecc030`、shared-packet v2.36.69 `03a5666e`）。下一步是 2-D（overlap／pre-pass，plan §1.3 列的候選）或 BACKLOG 的 rail 缺陷——由 `/next` 決定，不預設。

## 現況
- branch `develop`，HEAD `59816bfe`（release v2.36.69，帶 QC-Verdict trailer），tree 乾淨，`origin/develop` = `59816bfe`。
- routing 指 packet graph（`docs/mission-blind-review-shared-packet-2026-09-18-*.json`，digest `4e4a8299…`，lineage `b33ff20c…`）；node 已 integrated、marker 已 retire、worktree／branch 已 reap、zero residue。mission state 跟 station 一樣停在 ACTIVE（非 terminal）——先例是下一條 lineage 用新 adoption key 直接 prepare，不需要 reconcile；若要換到別的 graph，先 `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- 四席 qc 仍 pin（claude-fable-5-1、GLM-5.2、MiniMax-M3、Qwen3.8-Max-Preview；`min_panel_size: 3`、`in_rail_review: auto`）。
- `stash@{0}`（別的 session：evidence-discipline §20/§21 pending QC）別動也別 pop；`7ef6560a…/baseline` worktree 是別的 session 的。

## 已決事項(不重議)
- 一份 plan 兩條 lineage：freeze 腳本以 `intent.objective` 區分（adoption key = hash{repo, intent, acceptance hashes}）——否則第二條撞 `MISSION_BINDING_MISMATCH`。已寫進 `freeze-c2c.js` 註解與 packet README。
- 停在 `awaiting_disposition` 時先算 wall：剩餘 < implement+verify+panel（本 repo 實測 60+21+9 分）就不 resume，直接 l3（BACKLOG 列「a park reserves no wall for the repair round」）。
- rail 跑的是主 checkout 的 engine：engine 類 deliverable 的 §5 live 證明要等下一個 campaign（BACKLOG 列「engine-touching deliverables cannot self-prove live」）。packet-once live 證明＝下一個 managed campaign 的 panel 要看到 `autopilot-review-shared-*` 一個、各席 `autopilot-review-blind-*`，seats 準備幾秒內完成。

## 下一步
1. `/next`。候選：2-D plan（overlap＋pre-pass，需 plan hetero loop G1/G2）；或先收 BACKLOG rail 列（repair-round wall reserve；acceptance runner 洗 `AUTOPILOT_*`；GLM parser 重複 BEGIN marker）。
2. 下一個 managed campaign 順便記錄 packet-once live 證明到 `docs/plans/evidence/2026-09-18-blind-review-shared-packet/README.md`（一行）。
3. 五個 deferred 🔵（README 末段）不急，下次碰 `runPanel`／`verifyTreeIntegrity` 順手。

## 驗證方式
- `git log --oneline -1` → `59816bfe`；`node scripts/session-mode.js status --repo-root "$PWD"` → `active:false`；`git worktree list` 只剩主 checkout＋別人的 baseline；`node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY（digest `4e4a8299`）。
- `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8 for v2.36.69。

## Read-order
1. /home/cookys/projects/autopilot/docs/plans/evidence/2026-09-18-blind-review-shared-packet/README.md — 全程、五項量測結果、deferred。
2. /home/cookys/projects/autopilot/docs/BACKLOG.md 前段的兩條新 rail 列。
3. /home/cookys/projects/autopilot/skills/l5/references/hetero-impl-loop.md — Depth-0 recipe（step 7 兩條 lineage、step 9 env）。

## 陷阱
- 已 land，這裡只指：dispatch env 別帶 `AUTOPILOT_SESSION_ID`；候選驗證 `env -u AUTOPILOT_SESSION_ID`；主 checkout 在 `rc=` 前唯讀（連 fetch）；hand 等背景 suite 會停車 → SendMessage 催前景；QC-Verdict trailer 要在 landing range 內任一 commit 的末段（和 Co-Authored-By 同段）；record-integration 要完整 OID；reap 用 `campaign_control.campaign_id` 當 root-run-id。
