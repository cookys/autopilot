## 目標
接續 autopilot 維護。2026-09-17 出貨 v2.36.60（panel `--timeout`）、v2.36.61（1a-B：managed review 全 packet-backed＋seat receipt `packet_hash`）。**1b-A（cleanroom launcher＋`dispatch-review.sh` seat tiers）campaign 已走完整條 rail 到 final panel，停在 `final_adjudication`；depth-0 已在 mission branch 上修完 panel findings（`6d7dc38c` → `4936e27c`，worktree 乾淨，dispatch-review 504 綠），尚未合併、未出 v2.36.62。** 這個 session 在 context T2 停下；下一個 session 從「驗 worktree HEAD → merge → release v2.36.62 → closeout」接手，再開 **1b-B**（plan 草稿已 commit）。

## 現況
- `develop` = `origin/develop`（HEAD `980ee0af`）。**保留中的 mission worktree**：`/tmp/hetero-mission-6e6a15016119-blind-review-cleanroom-launcher-2026-09-17-a1-cdUy24`（branch `mission/6e6a15016119/blind-review-cleanroom-launcher-2026-09-17-a1`；hand `575a5fe0` → depth-0 repair `6d7dc38c` → test env fix `4936e27c`；worktree 乾淨）。worktree 路徑也在 `evidence/2026-09-17-blind-review-cleanroom-launcher/scratch/worktree.path`。
- session marker 已降級 **l3**（`--entry-level l5 --fallback precondition_failed`），未 retire；routing 指 `blind-review-cleanroom-launcher-2026-09-17`（graph `754b5456…`）；grant attempt 1 已消耗，campaign TERMINAL_STOP。
- **1b-A campaign（`evidence/…-cleanroom-launcher/impl-run1.json`）**：implement 46 分（cursor-grok-4.6-low，11 檔 +1411）；verification 8 條在 rail 內全綠（**隔離 suite 在 rail 的 detached checkout 也綠**）；in-rail MiniMax SHIP-AS-IS；**final panel 三席全回**：claude-fable-5-1 FIX-THEN-SHIP（2 🟠）、GLM-5.2 FIX-THEN-SHIP（2 🟡＋2 🔵）、MiniMax SHIP-AS-IS；四次 review 同一 `packet_hash 5ee8c79c…`（1a-B live ✓）、in-rail `--timeout` ✓（v2.36.60 live ✓）。停在 `final_adjudication: final finding registry is incomplete`——沒給 `--campaign-disposition-policy/authority`；rail 設計上 final-panel MUST-FIX 不進 repair（ready／FOLLOW_UP），所以照文件降級手修。raw log：`panel-raw-{vWvlYQ,tkGEU3,dAFzMg,xsEvcZ}.log`。
- **Panel findings 裁定（都在 `6d7dc38c`）**：✅ preflight probe `cat` 對目錄 EISDIR 讓 deny 檢查 vacuous → `[ -e ] || [ -L ]`＋`--deny-path /usr` exit-3 case；✅ `assert_not_contains … $'\nlaunch\n'` 永不 match → `grep -cx launch`；✅ fds 列表補斷言（無 7/9）；✅ `AUTOPILOT_CLEANROOM_CODEX_AUTH` 指到不存在檔要拒、不 fallback（＋portable test）；✅ 死分支 `probe.stderr` 刪；❌ **GLM `cl-md-line-shape` 誤報**：CLAUDE.md 那行 806 B 超過 pre-commit 800 B 行上限，hand 換行是對的（我 rejoin 後被 pre-commit 擋下才發現，已撤回）。
- 修補後在 worktree 驗過一輪：隔離 suite 47 綠；review-runner／review-packet／js-syntax／sync／inventory／backlog 綠；dispatch-review 503/504——唯一紅是我新 case 少 stub env，已修、重跑（結果見下一步 1）。
- **1b-B 起草已 commit**：`docs/plans/2026-09-17-blind-review-cleanroom-intake.md`（DRAFT）＋rubric＋manifest；brief／`freeze-c1d.js` 在 `evidence/2026-09-17-blind-review-cleanroom-intake/scratch/`。§0 base／行號寫 `<1b-A merge>`，合併後校對。範圍：JS 單一 tier table＋shell parity、intake `cleanroomProbe` adapter（launcher `--preflight`，每 runner 一次；rejected → `final_panel_seat_cleanroom_unavailable`）、resolver ⚠→advisory、codex 回 pin 只在 live verdict 後。
- **codex 額度到 2026-09-19 16:26**：plan loop 用 GLM＋claude-native（manifest 已寫）；consult 席預設 codex，改指 GLM 要 pin（operator 決定，沒動；ladder 記 rail-failed，U1 預算剩 1）。
- Peer（openclaw thread `msg_01M2PHM6PWH6VY7WP059Y0Q1TT`）：轉述 owner ruling (a)=B（不豁免 review 席；改做 `session-mode set` 印 mask 行＋brief linter）、(b) 同 refusal 兩次即停——**peer 轉述，要 cookys 在 session 內點頭才實作**；已回 ack。v2.36.60 live 資料點：fleet-comms Phase 2 in-loop GLM review 跑完到 `ready`。兩件都在 `evidence/…-cleanroom-launcher/scratch/closeout-notes.md`，closeout 時登 BACKLOG／README。
- 未做的 dogfood：1b-A plan §5（真 codex 進 launcher→預期 quota error 在沙箱內；`sha256sum ~/.codex/auth.json` 前後不變）。

## 已決事項(不重議)
- 承接上版全部；1b 切成 1b-A（launcher＋tier gate）／1b-B（intake probe＋JS/resolver tier＋pin）／deny-list config 另刀。
- 隔離：bwrap `--args FD`（pid 1 是 bwrap reaper，wrapper 洗不掉 argv）；fd 3..1023 在 bwrap 前關、fd 9 之後開；`--sandbox danger-full-access` 只准在 launcher 內；隔離 suite 用 `AUTOPILOT_HOST_ISOLATION=1` 閘、設了就 refuse 不 skip。
- rail 缺陷 (3)：freeze 時 `max_changed_files` > |output_paths|（這次 14 > 11，沒再撞）。
- final-panel MUST-FIX → 降級 l3 手修是文件路徑；「final panel 沒有 repair 迴圈、registry 沒 provider 就 blocked」登 rail 觀察 row。

## 下一步（順序）
1. （已做）worktree HEAD `4936e27c`，dispatch-review 504 綠。
2. 候選 = worktree HEAD。開臨時分支 scratch checkout 跑 §4.1 八條（`AUTOPILOT_HOST_ISOLATION=1` 那條要在**這台**）＋`git diff --stat c69f4bc5 -- src schemas bin/autopilot.js scripts/resolve-review-loop.sh scripts/qualification-review-provider.js`（空）。
3. 二審：GLM-5.2 anthropic-compatible／glm，diff `git diff c69f4bc5..<head>`（**不加路徑**），spec 給 plan；MUST-FIX 逐條再導出（記得 pre-commit 規則會製造假格式 finding）。
4. plan §5 dogfood → evidence README。
5. merge `--no-ff` 進 develop（trailer：in-rail MiniMax＋panel 三席＋GLM 二審）；`sync-version.js --version 2.36.62 --hook-count 31 --skill-count 30`；CHANGELOG（prose-justification：blind-dispatch.md 一節）；INDEX row；maintenance 行；BACKLOG：rail 觀察 row＋openclaw row 更新（closeout-notes）；evidence README（時間線、panel 裁定、GLM 誤報、live 證據）。
6. closeout：`record-integration.js --repo . --source-sha <wt HEAD 全 OID> --accepted-sha <merge 全 OID> --method merge --unit-id blind-review-cleanroom-launcher-2026-09-17` → `reap-dispatch-worktrees.sh reap --repo . --root-run-id <campaign_id，impl-run1.json ledger campaign_intake> --yes` → `reap-dispatch-branches.sh reap --repo . --into develop --inventory-file <reap-wt.json> --yes` → `lifecycle-residue-receipt.js issue --repo . --root-run-id <同上> --worktree-result … --branch-result … --out …` → `session-mode.js retire --session 70b3e2b4-2ed5-403c-8fce-19d634ab4525 --integration-receipt …` → `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` 8/8 → push。
7. **1b-B**：校對 §0／base、`sed` 掉 `<BASE>`；probe-unknown classify（會 U1；consult 席死→接受 rail-failed）；G1/G2（GLM＋claude-native、detached、20m；**先 `cp plan → plan.as-reviewed-gN.md` 再 fold，rubric 凍結後不碰**）；freeze（`SCRATCH` env、`freeze-c1d.js` 改路徑）→ set l5 → grant → brief ≤8 KB → dispatch。campaign 跑時同步起草 deny-list config 那刀。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `git -C /tmp/hetero-mission-6e6a15016119-blind-review-cleanroom-launcher-2026-09-17-a1-cdUy24 log --oneline -3` → `4936e27c`、`6d7dc38c`、`575a5fe0`；`status --short` 空。
- `node scripts/session-mode.js status --repo-root "$PWD"` → active l3 marker。
- 在 worktree `AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh` → 47+ 綠。

## Read-order
1. `docs/plans/2026-09-17-blind-review-cleanroom-launcher.md` §1、§4、§5、Review log。
2. `docs/plans/evidence/2026-09-17-blind-review-cleanroom-launcher/impl-run1.json`（reviewChain 四席）、`panel-raw-tkGEU3.log`（Claude 兩條 🟠）、`panel-raw-dAFzMg.log`（GLM）。
3. `docs/plans/2026-09-17-blind-review-cleanroom-intake.md`（1b-B DRAFT）。
4. `docs/BACKLOG.md` open：changed_files cap、verification digest-only、next-touch symbolic-ref、wall-cap、CI skipped-step、PEER-REPORTED openclaw、hash batching。

## 陷阱
- **frozen rubric 一個字都不能動**（這輪又踩：改 R4/R6 措辭 → `frozen rubric/manifest drifted`，G2 重開）。**收 receipt 要用被審那一版 plan bytes**：fold 前先 `cp`。
- **二審 diff 不加路徑**；**reviewer 說「格式錯」先查 pre-commit 規則**（CLAUDE.md 800 B 行上限）。
- `pgrep -f <pattern>` 會比對到自己：pattern 用 `c1c-g[2]-` 這種括號寫法。zsh 跑 `load-endpoints-env.sh` 會炸：包 `bash -c`。
- CLAUDE.md 是根目錄檔：`allowed_path_prefixes` 給 exact `CLAUDE.md`、output_paths 列它，contract checker 收；scope session 的 `prefix/**` 只管新檔。
- 一刀 2–3 小時是產線速率（hand 45 分＋rail 串行 verify／review／panel）；campaign 跑時起草下一刀，別純等。cut 2（並行席、verify-once）是結構解。
- harness 記憶體守衛／context T2：長工作 `setsid nohup`＋waiter；context 到 75% 就寫 handoff，scratchpad 會隨 session 消失——產物先進 repo。
