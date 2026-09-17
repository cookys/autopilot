## 目標
接續 autopilot 維護。2026-09-17 出貨 v2.36.62（1b-A：cleanroom launcher＋`dispatch-review.sh` seat tiers；merge `94d44940`、release `1cf61c9b`、closeout `d7912c7e`，已 push）。**現在做 1b-B（intake probe＋JS/resolver tier table＋codex pin 條件式回歸）**：plan 已校對到 base、plan hetero loop 待跑／跑中（見「現況」）。

## 現況
- `develop` = `origin/develop`。1b-A 殘留全清：mission worktree 已 reap（bundle 在 `.git/autopilot-reap-bundles/2026-09-17/`）、branch 已 reap、`residue-receipt.json` `zero_residue:true`、session marker `70b3e2b4…` 已 retire。evidence：`docs/plans/evidence/2026-09-17-blind-review-cleanroom-launcher/README.md`（時間線、panel 裁定、GLM 二審 4 🔵、§5 dogfood：真 codex 額度錯誤在邊界內、auth.json sha 不變）。
- **1b-B 已 freeze（`7562cb42`）**：routing → `blind-review-cleanroom-intake-2026-09-17`（graph digest `16ca5f07…`、lineage `lineage-v1-a5c2d5ac…`）；plan loop G1/G2 跑完（各 10／7 條全 fold，receipt rc 0，`evidence/…-intake/g{1,2}-*`）；session marker **l5 active**（session `ed4f4545-3dbb-4256-bdb4-80502ec4d221`）；prepared.json 在 scratchpad。**campaign 跑中或已跑完時：不要動 plan 檔**（source sha 凍結）。
- **1b-B**：plan `docs/plans/2026-09-17-blind-review-cleanroom-intake.md`（Base `d7912c7e`，§0 行號已校對）、rubric R1–R8（frozen）、manifest（GLM-5.2 anthropic-compatible＋claude-fable-5-1 claude-native）。brief `evidence/…-intake/scratch/impl-brief.md`（8 KB 內；派工時 sed `<BASE>` 到 **scratchpad 副本**，repo 副本不動）。base suites 12/12 綠：`evidence/…-intake/base-suites-d7912c7e.txt`。
- 1b-A GLM 二審 carry-in：HOME=DENIED 斷言進 1b-B（cleanroom-launch.test.sh 在 scope）；`_pf_err` unlink＋dead block 登 BACKLOG row（rail 本刀 byte-identical）。
- Peer（openclaw）owner ruling relay 已登 BACKLOG row（(a)=B、(b) 同 refusal 兩次即停）——**要 cookys 在 session 內點頭才實作**。
- v2.36.60 live 資料點（fleet-comms P2 in-loop GLM review 到 `ready`）已寫進 1b-A evidence README。

## 已決事項(不重議)
- 承接上版全部；1b-B 範圍＝plan §1 六條（JS 單一 tier table＋shell parity、intake `cleanroomProbe` adapter 每 runner 一次、`rejected` → `final_panel_seat_cleanroom_unavailable`、resolver ⚠→advisory、engine 不動、codex pin 只在 live verdict 後）。deny-list config 另刀。
- 1b-A rail 觀察（final panel 無 repair 迴圈）已登 BACKLOG，不在 1b-B 修。
- record-integration 的 accepted-sha 要等於 HEAD：release commit 後才跑就用 release/closeout 的 HEAD（1b-A 用 `1cf61c9b`）。

## 下一步（順序）
1. （已做）plan 校對、classify U0、G1/G2、freeze、l5 marker、prepare。
2. grant（`mission grant --repo . --prepared <scratch>/prepared.json --node blind-review-cleanroom-intake-2026-09-17`，一次一 attempt；tree 要乾淨）→ brief 副本填 `base_sha` → dispatch（抄 1b-A `scratch/dispatch.sh`：`AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=<contract.mission_runtime.root_run_id>`，`--max-rounds 3`，**不傳 `--campaign-ledger`**，setsid nohup）。`awaiting_disposition` → `--resume --campaign-disposition-authority <file>`（不帶 policy）。
3. 若這個 session 已派出：看 scratchpad `c1d/impl-run1.{json,err}`（路徑寫在下面「現況」）；worktree 在 `/tmp/hetero-mission-a5c2d5acdd1b-*`。
4. campaign 跑時起草 deny-list config 那刀。
5. 收尾同 1b-A：驗候選 §4.1 十二條＋scope 空 diff → GLM 二審（diff 不加路徑）→ plan §5 dogfood → merge `--no-ff`（trailer 末段）→ `sync-version.js --version 2.36.63 --hook-count 31 --skill-count 30` → CHANGELOG／INDEX／maintenance／BACKLOG redesign row → record-integration（accepted=HEAD）→ reap wt／branch（root-run-id＝campaign_id）→ residue receipt → retire marker → preflight 8/8 → push。
6. 09-19 16:26 後：真 codex 進 launcher 拿 parsed verdict → pin swap（§1.5）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `git worktree list` 只剩主 checkout（另一個 `7ef6560a…/baseline` 是別的 session 的，別動）。
- `node scripts/session-mode.js status --repo-root "$PWD"` → 無 active marker（直到 1b-B set l5）。

## Read-order
1. `docs/plans/2026-09-17-blind-review-cleanroom-intake.md` 全文＋rubric。
2. `docs/plans/evidence/2026-09-17-blind-review-cleanroom-launcher/README.md`、`scratch/{dispatch.sh,run-g1.sh,freeze-c1c.js}`（照抄的配方）。
3. `skills/l5/references/`（managed campaign depth-0 步驟）。
4. `docs/BACKLOG.md` open：final panel 無 repair、dispatch-review hygiene、changed_files cap、openclaw ruling relay。

## 陷阱
- **frozen rubric 一個字都不能動**；receipt 用被審那版 plan bytes（fold 前 `cp`）。
- **二審 diff 不加路徑**；reviewer 說「格式錯」先查 pre-commit（CLAUDE.md 800 B 行上限）。
- `record-integration.js` accepted-sha 必須＝HEAD。reaper 的 root-run-id 給 campaign_id（`impl-run1.json` `campaign_control.campaign_id`），給 mission root 會假乾淨。
- zsh：`echo ===` 會炸（`=` 展開）、`$PIPESTATUS` 要 bash；`load-endpoints-env.sh` 包 `bash -c`。
- 長套件 setsid nohup＋Monitor；套件一次一個（平行會互相干擾）；scratchpad 隨 session 消失——產物先進 repo。
- 隔離 suite 一定要 `AUTOPILOT_HOST_ISOLATION=1` 在**這台**跑；seat root 在 packet 旁（`<packet>/../seat`），不在 /tmp。
