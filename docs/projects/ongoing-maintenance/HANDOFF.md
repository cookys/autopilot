## 目標
接續 autopilot 維護。2026-09-15 出貨到 v2.36.45。operator 2026-09-15 下令「CEO 模式把 fired backlog 依序做完、可平行就平行、走 /l5」：8 條 fired 裡 6 條其實早已出貨（狀態翻正），真正開著的兩條合成一個 managed campaign 出了 v2.36.45。**BACKLOG 現在沒有 fired 的工作 row 了**（剩的 fired 都是這輪量到的 rail 缺陷：final panel exact-tuple、pre-spend 燒 claim、marker bridge、l5 marker 順序）。下一步：operator 指名，或依序做那幾條 rail 缺陷（它們讓 /l5 每次都要降 l3 收尾）。

## 現況
- 分支 `develop` = `origin/develop` @ `c6a2c8e3`（v2.36.45 merge `298669ac` ＋ 兩個 docs commit）。工作樹乾淨；另有一個別的 session 的 detached worktree（`…/7ef6560a…/scratchpad/baseline`），不是本 session 的、別動。
- DONE 並已推：v2.36.45（/l5 managed campaign peer-residue：config ladder tier 3 dogfood-only、qc-panel 輸出按 node、wrapper subject 契約；rail 在 final panel 停、depth-0 在 retained worktree 修兩刀後以 git 證據 merge；GLM 二輪 SHIP-AS-IS；**rail 的 MiniMax full-diff 席對 57 紅的候選 `61541082` 判 SHIP-AS-IS＝reviewer miss，目前真正的閘是 depth-0 驗證不是 panel**；`record-integration.js` 收據補在 `docs/plans/evidence/2026-09-15-peer-residue/`——這工具要在砍分支前跑，accepted 必須是 checkout HEAD、source 要有活 ref）、v2.36.44（dispatch-hetero `--sibling-ref-prefix`，308-8f 平行派工互殺；reviewer SHIP-AS-IS）、v2.36.43（reviewer no_verdict → `VERTICAL_VERIFICATION` checkpoint 的 durable wait；分類器 `classifyFullDiffReviewFault` 讀 `raw.reviewResult.result.status`——第一版讀 `raw.status` 在 production 永遠不命中，reviewer 抓到後重寫並加了走真 `engine.reviewDiff` 的測試；同樣只驗到 composition/engine 單元層，CLI e2e 待量）、v2.36.42（`campaign-intake.js` ledger 路徑驗證搬到 Mission claim 之前；reviewer sonnet PASS、一條 sibling 缺陷「非 git `--repo` 也燒 claim」登 BACKLOG）、v2.36.41（disposition resume：根因在 `campaign-composition.js` 字串/陣列錯配、不在 engine；routing test +3；reviewer sonnet PASS、一條後續 gap 登 BACKLOG；**只驗到 composition 層**，CLI `--resume --campaign-disposition-authority` e2e 未量，下個 managed campaign 第一個非空 review 就是量測點，量到才把 BACKLOG row 的「待量」拿掉）、v2.36.38（schema／gate warn／DI／寫入者連結，/l5 mission-3b68ecb09a61）、v2.36.39（`migrate-backlog-entries.js`、真 BACKLOG 遷移 237 KB→104 KB、154 sidecar、allowlist 30、gate flip block，/l5 mission-5c34ed65c6a4 + depth-0 4b）、v2.36.40（gate 進 pre-commit ritual、l5 reference 加 depth-0 11 步 runbook）。
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
1b. rail 缺陷優先序（都在 BACKLOG，fired 2026-09-15）：final panel exact-tuple（S，讓 /l5 永遠停在 final_panel）＞ pre-spend 燒 claim（Fix）＞ marker bridge 掃到死 session 的 marker（S）。
2. 308-8f 剩兩條（BACKLOG PEER-REPORTED (308-8f)）：stat walk 把 caller 寫進 checkout 的 rail I/O 當 mutation（S；文件已寫「rail I/O 落 checkout 外」，機制面可加 caller 宣告的排除路徑）；agy hand 不帶 `--effort` 只 edit（Fix，未驗）。可通知 308-8f v2.36.44 出了 `--sibling-ref-prefix refs/heads/hands/kr1/`（送達≠已讀）。
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
