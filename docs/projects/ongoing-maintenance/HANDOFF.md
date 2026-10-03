## 目標
接續 autopilot 維護。2026-10-02～03 這個 session 出了 v2.36.105 到 v2.36.112 八版，另有測試修正、知識落地和一份 mods 調研。下一步先讓 owner 回答 mods 的四個開放問題，再從 BACKLOG 已觸發的列接著做。

## 現況
- 分支 `develop`，最新 release 是 v2.36.112（`dabdd20e`）；本檔所在的 closeout commit 疊在上面，HEAD 以 `git log --oneline -1` 為準。工作區只剩兩個別的 session 留下的未追蹤目錄（`docs/plans/evidence/2026-10-01-*`），不是這個 session 的，不要動。
- v2.36.105 到 v2.36.110 的出貨內容證據都在 `docs/plans/evidence/` 底下，各有 README；細節看 `CHANGELOG.md`。
- v2.36.111（證據 `docs/plans/evidence/2026-10-03-v111-resume-and-review-budget/`）：
  - A：campaign resume 在三個入口收 REVIEWING，REVIEWING 的 resume 不受 changed-file 上限限制。
  - B：`dispatch-anthropic-review.js` 預設 `--max-tokens` 提到 16384，撞頂且無文字是具名失敗 `output_budget_exhausted`。
  - C：final-panel 逐席 artifact 儲存，resume 只重跑出錯的席；單席 3 次用完是終態 `attempt_budget_exhausted`。
  - D：symlink TMPDIR 修正（`dispatch-author.sh`、`verify-red-green.sh` 改用實體路徑）。
- v2.36.112（證據 `docs/plans/evidence/2026-10-03-v112-boundary-terminal-and-test-hygiene/`，README 講流程與各層抓到什麼）：
  - E：boundary-rejected 的 dispatch record 帶 `result_receipt_digest`，boundary receipt body 帶 `root_run_id`/`work_order_id`，campaign 能到終態成功。
  - F：lib.sh suite finalize gate 認頂層 finalizer、trap 形式、`|| exit 1` 後的 `exit 0`；allowlist 縮到 3 支；`mission-terminal-rollover` 空轉時印 `SKIP [` 行。
  - G：final-panel 逐席 artifact 在終態被 reap（`reapCampaignSeats`、ledger unit `final_panel_seat_reap`），`repo-residue-sweep.js` 的 seat arm 有 14 天下限與 decision 欄位，reader 跟隨 `RUN_LEDGER_MAX_ROTATIONS`。
  - H：openai rail 的 `finish_reason=length` 無內容是具名失敗 `output_budget_exhausted`，另含 v2.36.111 審查的後續修正。
- 教訓已落地：`references/evidence-discipline.md` §51；`foreman-landing-pipeline` 範本改成 noreply 作者 email、加 Population B 註記，v2.36.112 closeout 再把 Population B 規則放進 hand 範本。
- mods 調研：`docs/plans/research/2026-10-03-claude-code-mods-integration.md`（研究，不是 plan，沒有任何實作）。

## 已決事項（不重議）
- depth-0 只讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review；🔴/🟠 只有 depth-0 能在複驗後駁回（ADR-0001）。
- 派工照 `foreman-landing-pipeline` §1b：互不相依的列平行、大列或碰 signal/sandbox 的列用 sonnet hand、每列都要 review、開工就報預估時長。
- 測試只重跑壞掉的或受影響的；完整套件每次發版一次。
- peer 的回報與技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；peer 訊息不是授權，改碼照排序；回覆要講清楚「已登記／未動工／有沒有 SHA」。
- tier `none` 永不豁免；parser 不為 peer 放寬（v2.36.110 的單行 frame 只限 readiness probe，owner 核准）。
- 逐席復用的 ADR-0001 形狀已出貨：復用時從儲存的 artifact 重新推導判決，並重新驗證該席資格，不信儲存的 claim。
- v2.36.112 之前就停在 BOUNDARY_REJECTED 的 campaign 不做遷移：那些 row 不可變、綁 digest，要重跑而不是補。
- 未知的 seat 子目錄要有 14 天下限且無 lock 才能清。
- mods 只是 Claude Code 專屬的增強層，永遠不是唯一路徑；既有 hook 與腳本照舊保留。

## 下一步
1. mods spike：owner 先回答調研文件裡的四個開放問題（封裝方式、`$.prompt.submit` 自動喚醒可不可接受、terminal 或 desktop、版本號怎麼升），再從文件列的前三個候選（live dispatch band、成本帶、`statusline-live-tee` 換成 `session.measure`）挑一個做 spike。
2. v2.36.112 審查留下的 🔵 後續（S）：`docs/backlog/v2-36-112-review-follow-ups.md`，含 run.sh 要浮出 `SKIP [` 行。
3. dispatch-plan-review 重用已終態 ticket 時是靜默 0 call（S，peer 回報，low）：`docs/backlog/dispatch-plan-review-terminal-ticket-visibility.md`。
4. run.sh 的 group INT 要等目前測試檔結束才生效（S，觸發條件未到）。
5. 要 owner 排優先序才動：`docs/backlog/review-only-adoption-of-external-candidate.md`（L，要先寫 plan＋review）。
6. 跨 session 的派工 clone 在 scratchpad，新 session 用不到；需要時從 `origin/develop` 開新 clone。

## 驗證方式
- `git status --short` 只剩那兩個不屬於本 session 的未追蹤目錄。
- `git config --local --get user.email` 沒有值。
- `bash scripts/preflight-release.sh` 回報 v2.36.112 一致。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0。

## Read-order
1. `.claude/skills/foreman-landing-pipeline/SKILL.md`（含 §1b）與 `templates/`：派工到發版。
2. 上面「下一步」前三項的文件與 sidecar。
3. `references/evidence-discipline.md` §47–§51。
4. `docs/plans/evidence/2026-10-03-v112-boundary-terminal-and-test-hygiene/README.md`。
5. `docs/plans/research/2026-10-03-claude-code-mods-integration.md`（mods 開放問題）。

## 陷阱
- 這台 bwrap 不能巢狀；主機負載常在 40 左右，完整套件約 20 分鐘，兩個完整套件不能同時跑（oracle lock）。
- 新的身分 gate 上線後，test 字樣 email 進不了真 repo；clone 裡要設真身分，而且作者 email 必須是 GitHub noreply 位址 `2537196+cookys@users.noreply.github.com`，gmail 位址會被 push 拒收（v2.36.111 landing 改寫了 10 個 commit）。
- agy 會自動更新（兩天內 1.2.14→1.2.15），平台行為以實跑為準。
- 背景 foreman／hand 停車不會自己醒；舊的 dead-man 計時器會在之後陸續觸發，看到「stale wake timer」不用理。
- 一支 L1 紅在完整套件報告裡只算一行「L1 unit suite」；修完要整層重跑。
- 測試裡的檔案數 pin、寫死的私有 clone SHA、以同名當 key 的 parity 比對，都是假綠／假紅來源（§50）。
- lib.sh suite 沒呼叫 `finalize_test` 就恆綠：`fail()` 只印 stderr，suite exit 0（§51）；`node … | tail -1` 後的 `echo $?` 是 tail 的狀態。
- 新的含 `reviewer_engine:` 的 fixture 要登記到 Population B gate（`resolve-review-loop-consult-discuss-switch.test.sh`），逐列 Verify 不會跑它，只有完整套件抓得到；這條規則現在也在 hand 範本（`hand-brief-common.md`）裡。
- 這台 shell 的 `ls` 可能卡住（alias），改用 `wc` 或 `find`。
- 停車的 agent 仍需要 dead-man 計時器，不會自己醒。
