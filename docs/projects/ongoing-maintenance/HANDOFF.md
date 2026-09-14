## 目標
接續 autopilot 維護。2026-09-14 出貨到 v2.36.41（backlog schema 四 phase、gate 進 pre-commit、disposition resume 修好）；下一步是 BACKLOG 裡剩下兩條 2026-09-14 managed-rail 缺陷（`--campaign-ledger` 拒絕燒 grant、reviewer no_verdict 釋放 claim），或 operator 指名的新工作。

## 現況
- 分支 `develop` = `origin/develop` @ `9fd24051`（merge v2.36.41）。工作樹乾淨；另有一個別的 session 的 detached worktree（`…/7ef6560a…/scratchpad/baseline`），不是本 session 的、別動。
- DONE 並已推：v2.36.41（disposition resume：根因在 `campaign-composition.js` 字串/陣列錯配、不在 engine；routing test +3；reviewer sonnet PASS、一條後續 gap 登 BACKLOG；**只驗到 composition 層**，CLI `--resume --campaign-disposition-authority` e2e 未量，下個 managed campaign 第一個非空 review 就是量測點，量到才把 BACKLOG row 的「待量」拿掉）、v2.36.38（schema／gate warn／DI／寫入者連結，/l5 mission-3b68ecb09a61）、v2.36.39（`migrate-backlog-entries.js`、真 BACKLOG 遷移 237 KB→104 KB、154 sidecar、allowlist 30、gate flip block，/l5 mission-5c34ed65c6a4 + depth-0 4b）、v2.36.40（gate 進 pre-commit ritual、l5 reference 加 depth-0 11 步 runbook）。
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
1. `grep -n 'Status\*\*: fired' docs/BACKLOG.md | head` 看剩兩條 2026-09-14 rail 缺陷 row：`--campaign-ledger` 拒絕燒 grant（Fix；intake 拒絕前不該 consume claim）、reviewer no_verdict 釋放 claim（S；應重試席位）。composition 層的 review→wait→resume 測試骨架已在 `implementation-campaign-routing.test.sh`「Disposition resume must rebind」段，可直接抄。
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
