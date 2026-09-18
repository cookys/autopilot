## 目標
接續 autopilot 維護。2026-09-18 已出 v2.36.66（2-B，merge `9f17bdc1`）、**v2.36.67（rail 兩缺陷 Fix，merge `1f638a5d`）**。**2-C plan 已審完凍結、graph 已 freeze、routing 已切**（`blind-review-panel-station-2026-09-18`，graph `ed90f54a…`，lineage `lineage-v1-07f86eff…`），**尚未 grant／dispatch**。接手：pin 第四個 qc family → marker → prepare/grant → brief → dispatch station campaign → 收尾 → v2.36.68；之後第二條 lineage `NODE=packet`。

## 現況
- 2-C plan：`docs/plans/2026-09-18-blind-review-panel-station.md`（frozen，**合併前一字不動**）；rubric R1–R8；G1 1 折／G2 7 折，receipts rc 0；base 13 條 `evidence/…-panel-station/base-suites-9a0dac5b.txt` 全綠。
- **一份 plan 只能對一個 graph node**（checker：plan id ↔ node 一對一）→ 兩個 deliverable 走兩條 lineage：`scratch/freeze-c2c.js` `NODE=station`（已跑）、`NODE=packet`（station merge 後再跑；它會換 slug 為 `blind-review-shared-packet-2026-09-18`、routing 也換）。每張圖都得 claim 全部 8 個 rubric id（checker 覆蓋規則，非驗收）。
- 2-B／2-A 三件未量到（2-A pocket、2-B §5 四席、v2.36.41 resume e2e）都在 station campaign 量：pocket 現在會投影（v2.36.67）、wall clock 停在 awaiting_disposition（v2.36.67）。
- marker 目前 `active:false`；admission `--level l5` READY。

## 已決事項(不重議)
- 2-C ruling 如 plan §1（panel 是迴圈 review 站、終局 panel 以 identity 重用、`in_rail_review` 封進 snapshot、每候選一份 packet＋每席 per-file copy＋launch 前重 hash、批次 tree hash 但 LF/CR 檔名走逐檔）。
- 收尾程序照 2-B evidence README（record-integration 在 reap 前；root-run-id＝`campaign_control.campaign_id`；兩個 marker 都 retire）。

## 下一步（順序）
1. `bash scripts/resolve-review-loop.sh --check-scorecard --field override_admitted_seats`；四席：現有三席＋第四 family（例如 gpt-5.6-sol/codex 若配額回來，否則 Qwen@qoderclicn——先查 blind allowlist／tier；`engine-capability-state.js pin-seat --role qc_panel …`）；`.claude/review-loop-config.md` `min_panel_size: 3`、`in_rail_review` 這刀還沒有欄位（campaign 自己會加）。
2. `node scripts/session-mode.js set --level l5 --repo-root "$PWD"` → READY；`mission prepare` → `mission grant --node panel-review-station`（照 `skills/l5/references/hetero-impl-loop.md` 步驟 7–9；brief ≤8 KB 貼 output_paths、禁 stash/push、列 13 條 verify）。
3. dispatch 後主 checkout 唯讀到 `rc=`；等 `rc=` 用 `run_in_background` until-grep。`awaiting_disposition` 落地時（clock 已停）照 2-B 的 authority 檔格式裁決後 `--resume --campaign-disposition-authority`——這次應該走得通（v2.36.41 e2e 量測點）。
4. 收尾 → v2.36.68；然後 `NODE=packet` freeze → 第二 campaign。

## 驗證方式
- `git log --oneline -3` 頂端含 `3d743bda`（mission freeze）；`cat .claude/mission-routing-config.json` 指 `…panel-station…`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY。
- `git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 是別的 session 的）。

## Read-order
1. `docs/plans/2026-09-18-blind-review-panel-station.md` §1、§2.5、§4.1、§5；`evidence/…-panel-station/README.md`。
2. `docs/plans/evidence/2026-09-18-blind-review-panel-standby/README.md`（2-B 全程含 rail 停在 awaiting_disposition 的處置）。
3. memory：`disposition-resume-within-wall-budget`、`campaign-running-main-checkout-frozen`、`managed-campaign-depth0-recipe`。

## 陷阱
- frozen plan 合併前不動（動了 admission drift、`session-mode set` 全拒）；post-merge 筆記寫 CHANGELOG／evidence README。
- Monitor `tail -f | grep` 漏 `rc=`；用 until-grep。BACKLOG Context／Title 用 `wc -c`。二審 diff 不加路徑。record-integration 在 reap 之前。zsh 雷區照舊。
- `--campaign-ledger` 別傳；grant 後 HEAD 可前進（intake 不要求 HEAD＝base，1c／2-B 都過）但 campaign 跑中一律唯讀。
