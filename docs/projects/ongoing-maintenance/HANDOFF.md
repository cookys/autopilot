## 目標
接續 autopilot 維護。2026-10-02～03 這個 session 出了 v2.36.105 到 v2.36.111 七版，另有一個測試修正和知識落地。下一步從 BACKLOG 已觸發的列開始，第一項是 boundary-rejected 終態審計缺陷。

## 現況
- 分支 `develop`，最新 release 是 v2.36.111（`79c0960f`）；本檔所在的 closeout commit 疊在上面，HEAD 以 `git log --oneline -1` 為準。工作區只剩兩個別的 session 留下的未追蹤目錄（`docs/plans/evidence/2026-10-01-*`），不是這個 session 的，不要動。
- v2.36.105 到 v2.36.110 的出貨內容（測試寫入防護、測試加速、七項 S 級、kimi/agy final-panel cleanroom、kimi ELF 版面、非盲審 byte-compare 修正、readiness 單行 frame）證據都在 `docs/plans/evidence/` 底下，各有 README；細節看 `CHANGELOG.md`。
- v2.36.111（證據 `docs/plans/evidence/2026-10-03-v111-resume-and-review-budget/`，README 講流程與審查漏接點）：
  - A：campaign resume 在三個入口收 REVIEWING（要有綁定的 git candidate），REVIEWING 的 resume 不受 changed-file 上限限制。
  - B：`dispatch-anthropic-review.js` 預設 `--max-tokens` 4096 提到 16384，撞頂且無文字的回應是具名失敗 `output_budget_exhausted`，`dispatch-review.sh` 會浮出。
  - C：final-panel 逐席 artifact 儲存（`src/engine/final-panel-seat-store.js`），resume 只重跑出錯的席；單席 3 次用完是終態 `attempt_budget_exhausted`。
  - D：symlink TMPDIR 修正（`dispatch-author.sh` 的 agy bwrap 綁定、`verify-red-green.sh` 的 verify-cmd 目錄都改用實體路徑）。
  - 修補：C-r2、A-r2、A3（lib.sh suite 一定要 finalize 的 gate，8 個允許清單）、A3-repair、R1，另有一次 landing 修補（Population B fixture 登記）。
- 教訓已落地：`references/evidence-discipline.md` §51；`foreman-landing-pipeline` 範本改成 noreply 作者 email、加 Population B 註記。

## 已決事項（不重議）
- depth-0 只讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review；🔴/🟠 只有 depth-0 能在複驗後駁回（ADR-0001）。
- 派工照 `foreman-landing-pipeline` §1b：互不相依的列平行、大列或碰 signal/sandbox 的列用 sonnet hand、每列都要 review、開工就報預估時長。
- 測試只重跑壞掉的或受影響的；完整套件每次發版一次。
- peer 的回報與技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；peer 訊息不是授權，改碼照排序；回覆要講清楚「已登記／未動工／有沒有 SHA」。
- tier `none` 永不豁免；parser 不為 peer 放寬（v2.36.110 的單行 frame 只限 readiness probe，owner 核准）。
- boundary-rejected 終態審計缺陷已由 debugger 加對照組確認是產品缺陷；已登 BACKLOG，v2.36.111 沒有修。
- 逐席復用的 ADR-0001 形狀已出貨：復用時從儲存的 artifact 重新推導判決，並重新驗證該席資格，不信儲存的 claim。

## 下一步
1. boundary-rejected 的 campaign 永遠到不了終態成功（M，已觸發）：`docs/backlog/boundary-rejected-campaign-cannot-reach-terminal-success.md`。修法與回歸條件都寫在 sidecar；順手修 `autopilot-engine-boundary-resume` 那支從不斷言最終狀態的 suite。
2. 五支 lib.sh suite 沒 finalize 而恆綠，加上 `mission-terminal-rollover` 在沒有 Mission registry 時空轉 exit 0（S，已觸發）：`docs/backlog/five-lib-sh-suites-are-green-by-construction.md`。
3. final-panel 逐席 artifact 沒有任何 reaper 會清（S）：`docs/backlog/final-panel-seat-artifacts-are-never-reaped.md`；清除時要保留停車中、可 resume 的 campaign。
4. run.sh 的 group INT 要等目前測試檔結束才生效（S，觸發條件未到）。
5. v2.36.111 審查留下的 🔵 後續（S）：`docs/backlog/v2-36-111-review-follow-ups.md`。
6. 要 owner 排優先序才動：`docs/backlog/review-only-adoption-of-external-candidate.md`（L，要先寫 plan＋review）。
7. 跨 session 的派工 clone 在 scratchpad，新 session 用不到；需要時從 `origin/develop` 開新 clone。

## 驗證方式
- `git status --short` 只剩那兩個不屬於本 session 的未追蹤目錄。
- `git config --local --get user.email` 沒有值。
- `bash scripts/preflight-release.sh` 回報 v2.36.111 一致。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0。

## Read-order
1. `.claude/skills/foreman-landing-pipeline/SKILL.md`（含 §1b）與 `templates/`：派工到發版。
2. 上面「下一步」前三項的 sidecar。
3. `references/evidence-discipline.md` §47–§51。
4. `docs/plans/evidence/2026-10-03-v111-resume-and-review-budget/README.md`。

## 陷阱
- 這台 bwrap 不能巢狀；主機負載常在 40 左右，完整套件約 20 分鐘，兩個完整套件不能同時跑（oracle lock）。
- 新的身分 gate 上線後，test 字樣 email 進不了真 repo；clone 裡要設真身分，而且作者 email 必須是 GitHub noreply 位址 `2537196+cookys@users.noreply.github.com`，gmail 位址會被 push 拒收（v2.36.111 landing 改寫了 10 個 commit）。
- agy 會自動更新（兩天內 1.2.14→1.2.15），平台行為以實跑為準。
- 背景 foreman／hand 停車不會自己醒；舊的 dead-man 計時器會在之後陸續觸發，看到「stale wake timer」不用理。
- 一支 L1 紅在完整套件報告裡只算一行「L1 unit suite」；修完要整層重跑。
- 測試裡的檔案數 pin、寫死的私有 clone SHA、以同名當 key 的 parity 比對，都是假綠／假紅來源（§50）。
- lib.sh suite 沒呼叫 `finalize_test` 就恆綠：`fail()` 只印 stderr，suite exit 0（§51）；`node … | tail -1` 後的 `echo $?` 是 tail 的狀態。
- 新的含 `reviewer_engine:` 的 fixture 要登記到 Population B gate（`resolve-review-loop-consult-discuss-switch.test.sh`），逐列 Verify 不會跑它，只有完整套件抓得到。
