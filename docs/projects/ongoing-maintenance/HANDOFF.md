## 目標
接續 autopilot 維護。2026-09-16 出貨到 v2.36.51。operator 2026-09-15 下令「CEO 模式把 fired backlog 依序做完、可平行就平行、走 /l5」：8 條 fired 裡 6 條其實早已出貨（狀態翻正），真正開著的兩條合成一個 managed campaign 出了 v2.36.45。**BACKLOG 現在沒有 fired 的工作 row 了**（剩的 fired 都是這輪量到的 rail 缺陷：final panel exact-tuple、pre-spend 燒 claim、marker bridge、l5 marker 順序）。下一步：operator 指名，或依序做那幾條 rail 缺陷（它們讓 /l5 每次都要降 l3 收尾）。

## 現況
- 分支 `develop` = `origin/develop` @ `92463677`（v2.36.51 merge `70eea675`；v2.36.50 `5125bb5d`；v2.36.49 `41a989df`；v2.36.48 `3f4eb339`；v2.36.47 `f88a7f53`；v2.36.46 `3be9ad53`）。工作樹乾淨；另有一個別的 session 的 detached worktree（`…/7ef6560a…/scratchpad/baseline`），不是本 session 的、別動。
- DONE 並已推：**v2.36.51**（`migrate-backlog-entries.js` table style，revival.3d 請求；`## Columns`／`## Status map` 對映，lossy 列原行進 sidecar；reviewer 四條 MUST-FIX 全摺入；已回 cuda 用法，等他們對 196 KB 真檔跑 dry-run）、**v2.36.50**（`dispatch-hetero.sh --sibling-path-prefix <dir>/`，308-8f 第二條）、**v2.36.49**（review-loop 契約 schema 補 `plan_review_same_family_as_depth0`（v2.36.33 起就漂）；profiles 基線對 ceo-agent／dev-flow 重釘，migration 814→815、七條 rewritten disposition；codex-plugin-package 9 紅、profile-context-isolation 2 紅歸零）＋ 兩個 tests-only commit：autopilot-engine 10 紅歸零（真因是 live config 的 cursor pin 在隔離 capability dir 不存在、不是 marker；改讀凍結 fixture＋在隔離 store 種 pin）、兩個 suite 補回 +x（run.sh L2 才跑得到）。**現在沒有已知的既有紅 suite。**）、**v2.36.48**（pre-claim repo facts：dirty／base／required_paths 在 Mission claim 前重推，`src/engine/repo-preconditions.js` 一份陳述、`dispatch-contract.js` 照舊呼叫；`session-mode.js retire --session <id> --integration-receipt <f> [--lineage <key>]` 用 registry＋git 證據退別的 session 的已整合 marker，bridge fence 依裁定不改；routing config 回指 `mission-backlog-entry-migration`（**教訓：凍結後改 plan（連 Review log 都算）source sha 就漂，`session-mode set` 全部 level 被拒、兩個 suite 紅——收尾要回指未漂移的已完成 graph＋legacy reconcile，或別在 merge 後改 plan**））、**v2.36.47**（`--mirror-roots-json` 列 projected skills）、**v2.36.46**（/l5 managed campaign final-panel-pins：qc_panel 常設 pin 一席一列、resolver 記錄 `qc_panel[N]` 准入、`finalPanelSeatQualified` 單一模組、intake 在 claim 前拒未准入席位。owner 裁定「一次到位」走 L 不走 Fix。rail 這輪：lineage 1 attempt 1 燒在 `required_paths` 列了新檔（pre-spend row 第三例）、同 adoption key 換 digest 是 `MISSION_BINDING_MISMATCH` → 開新 lineage（舊 lineage `a5847a…` 留 ACTIVE、attempt 2 never-started withdraw，殘留不阻擋）；lineage 2 的 hand 做完全部工作但 commit 被 boundary gate 拒（skills 鏡像沒列、`--mirror-roots-json` 漏 `skills`）→ depth-0 從 retained worktree 原樣接手 `fa2a0c50`，base-run 紅／12 verify 綠／3 mutant 紅／GLM 二家族 SHIP-AS-IS。**本機已記兩個 qc pin**（GLM-5.2/cc-shim@glm、gpt-5.6-sol/codex@none）；從這版起 managed campaign 沒 pin 會在 intake 就被拒——設計如此。下一個 managed campaign 的 final panel 是這版的真正量測點：三席都應 `reviewed`，不再 `precondition_failed`。）、v2.36.45（/l5 managed campaign peer-residue：config ladder tier 3 dogfood-only、qc-panel 輸出按 node、wrapper subject 契約；rail 在 final panel 停、depth-0 在 retained worktree 修兩刀後以 git 證據 merge；GLM 二輪 SHIP-AS-IS；**rail 的 MiniMax full-diff 席對 57 紅的候選 `61541082` 判 SHIP-AS-IS＝reviewer miss，目前真正的閘是 depth-0 驗證不是 panel**；`record-integration.js` 收據補在 `docs/plans/evidence/2026-09-15-peer-residue/`——這工具要在砍分支前跑，accepted 必須是 checkout HEAD、source 要有活 ref）、v2.36.44（dispatch-hetero `--sibling-ref-prefix`，308-8f 平行派工互殺；reviewer SHIP-AS-IS）、v2.36.43（reviewer no_verdict → `VERTICAL_VERIFICATION` checkpoint 的 durable wait；分類器 `classifyFullDiffReviewFault` 讀 `raw.reviewResult.result.status`——第一版讀 `raw.status` 在 production 永遠不命中，reviewer 抓到後重寫並加了走真 `engine.reviewDiff` 的測試；同樣只驗到 composition/engine 單元層，CLI e2e 待量）、v2.36.42（`campaign-intake.js` ledger 路徑驗證搬到 Mission claim 之前；reviewer sonnet PASS、一條 sibling 缺陷「非 git `--repo` 也燒 claim」登 BACKLOG）、v2.36.41（disposition resume：根因在 `campaign-composition.js` 字串/陣列錯配、不在 engine；routing test +3；reviewer sonnet PASS、一條後續 gap 登 BACKLOG；**只驗到 composition 層**，CLI `--resume --campaign-disposition-authority` e2e 未量，下個 managed campaign 第一個非空 review 就是量測點，量到才把 BACKLOG row 的「待量」拿掉）、v2.36.38（schema／gate warn／DI／寫入者連結，/l5 mission-3b68ecb09a61）、v2.36.39（`migrate-backlog-entries.js`、真 BACKLOG 遷移 237 KB→104 KB、154 sidecar、allowlist 30、gate flip block，/l5 mission-5c34ed65c6a4 + depth-0 4b）、v2.36.40（gate 進 pre-commit ritual、l5 reference 加 depth-0 11 步 runbook）。
- IN-FLIGHT：無。session marker 停在 l3（l5 降級），2026-09-15 到期自清；不要手刪。
- 鬆散端：`stash@{0}`（2026-08-30 evidence-discipline §20/§21 草稿，落地要過 QC review，非本輪產物）。
- cuda／revival.3d 已收到 v2.36.38–39 通知（送達≠已讀）；他們是 table style，遷移腳本目前只支援 heading。

## 已決事項(不重議)
- Backlog 一列＝index row：七欄 byte cap、Pointer 必填（≤600 B 才准 none）、整列 900 B、`shipped <version> <date>`；schema 只在 `references/backlog-entry.md` 一份。
- Title 超長不遷移、不自動改（標題是身分），進 allowlist 由人裁。
- Gate 在本 repo 是 block 模式且是 pre-commit ritual；allowlist 只減不增。
- Phase 4 驗收「≤40 KB」是猜的數字，cap 是契約；偏離已記在母 plan Review log，不補救。
- Managed rail 停了就照文件 `--fallback precondition_failed` 降級、在 mission 分支的 retained worktree 修、git 證據 merge、缺陷登 BACKLOG——不繞 rail、不手改 rail。
- Review 停止規則：三輪；reviewer MUST-FIX 一律 probe＋mutation 重新推導後才接受或駁回。

## 下一步
1. v2.36.41–43 的 rail 修正：這次 campaign 的 review 是 SHIP-AS-IS（無 disposition 路徑）、reviewer 沒 no_verdict，所以 e2e 仍未量到；「待量」維持。這次 campaign 的完整過程（三次 attempt 各被什麼擋、怎麼降級）在 CHANGELOG v2.36.45 與 `skills/l5/references/hetero-impl-loop.md` recipe 5b/6/8/11。
1b. rail 缺陷（fired 2026-09-15）全部出貨：final panel exact-tuple v2.36.46、pre-spend 燒 claim v2.36.48、marker bridge／retire v2.36.48、mirror-roots skills v2.36.47。剩：rail 不傳 scorecard scope 檔（S，open，trigger 未到）。既有紅 suite 全部歸零（v2.36.49 ＋ 兩個 tests-only commit）。**兩條在 pre-commit 之外的鏈**：改 ceo-agent／dev-flow SKILL.md 要跑 `build-profile-payload.js catalog --check`；resolver 多吐欄位要跑 `check-contract-schema.js`——這次各漂了兩天。本 session 的 l5 marker 已用 retire 退掉（dogfood），目前無 marker。
2. 308-8f 剩一條：agy hand 不帶 `--effort` 只 edit（Fix，未在本機重現，`agy_effort_clamp` 預設待查）。stat-walk 那條 v2.36.50 出了。可通知 308-8f v2.36.44 出了 `--sibling-ref-prefix refs/heads/hands/kr1/`（送達≠已讀）。
2b. `dispatch-foreman.test.sh` 在 origin/develop 就 62/40 紅（case 3 後 TEST_TMP 消失，BACKLOG 有 row）——foreman 側 boundary 案例（6/9/12）因此量不到；判紅先看是不是這個。
3. `autopilot-engine.test.sh` 本機 10 條既有紅燈（strict-l5 bootstrap 讀 live `~/.autopilot/session-mode/_home_cookys_projects_autopilot.json`，該 marker 是 l5、2026-08-05 已過期但還在）——測試不 hermetic，BACKLOG 有 row；判紅先看是不是這 10 條。composition 層的 review→wait→resume 測試骨架已在 `implementation-campaign-routing.test.sh`「Disposition resume must rebind」段，可直接抄。
2. 若 revival.3d 要用遷移腳本：`scripts/migrate-backlog-entries.js` 加 table style（parser 已在 gate 匯出；`planMigration` 開頭的 `exit 2 not supported yet` 就是入口）。
3. 30 條 Title >120 B 的 allowlist 殘留：人手改標題（改了 fingerprint 會變，`--update-allowlist` 會自動移除舊 pair）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop` 無 ahead/behind。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（block 模式、new 0、allowed 30）。
- 塞一列 `- stray bullet` 進任一 row 後 `git commit` → pre-commit `✗ check-backlog-entries FAILED`（改回來）。
- `bash hooks/tests/migrate-backlog-entries.test.sh` → `PASS 45`；`bash hooks/tests/check-backlog-entries.test.sh` → `PASS 29`。

## Read-order
1. /home/cookys/projects/autopilot/docs/BACKLOG.md — 現在是 index rows；證據在各列 Pointer（`docs/backlog/*.md`）。
2. /home/cookys/projects/autopilot/skills/l5/references/hetero-impl-loop.md — § Depth-0 recipe，開下一個 managed campaign照這 11 步。
3. /home/cookys/projects/autopilot/docs/plans/2026-09-14-backlog-entry-schema.md — Review log 有兩次 campaign 的完整裁決紀錄與偏離。
4. /home/cookys/projects/autopilot/CHANGELOG.md — v2.36.38–40 三節。

## 陷阱
- 全部已落地，這裡只放指標：memory `managed-campaign-depth0-recipe`（三個燒 grant 的坑）、`node-exit-truncates-pipe-stdout`（>64 KiB 走 fs.writeSync）、`parallel-suites-interfere`、`contract-pin-test-leaves-pre-js`、`dispatch-review-runner-setup`（MiniMax no_verdict 換席）。
- 測試套件有 `set -e` 的話，預期非零的 node 呼叫要 `set +e … set -e` 包起來，否則整個 suite 靜默死掉、summary 都不印。
- `git checkout -- <file>` 在 mission worktree 做紅燈驗證會把自己的修補洗掉——先 `git stash`？不行（worktree 共用 stash）；用 `git diff > patch` 再 `git apply -R` 或直接複製檔案。
