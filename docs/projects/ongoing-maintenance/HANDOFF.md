## 目標
接續 autopilot 維護。2026-09-24～29 這個 session 出貨了 v2.36.95 到 v2.36.101，另外有知識落地 commit、一個專案 skill、多個 closeout commit。下一步從 BACKLOG 裡已觸發的 S 級開始。

## 現況
- 分支 `develop`，v2.36.101 已發布並 push（release commit `27b2e583`：dispatch-hetero wall-timeout watchdog）；本檔案所在的 closeout commit（docs-only：evidence、doc drift、evidence-discipline §48、HANDOFF）疊在它上面，HEAD 以 `git log --oneline -1` 為準。工作區乾淨，沒有 stash，只有主 checkout 一個 worktree。
- 這個 session 出貨的東西：
  - v2.36.95：wave-1b，10 個 backlog 列。
  - v2.36.96：B1 resolver-a，7 列。09-21 開的六包 bundle 全部結案。
  - v2.36.97：foreman-guard 依角色設上限（worker／reviewer 120）、最後 8 次的收尾保留、提醒走 `additionalContext`（不帶 `permissionDecision`）。
  - v2.36.98：14 個 hook 的提醒改走 `additionalContext`；Stop 提醒改由新的 `advisory-relay`（UserPromptSubmit）在下一次送出訊息時送達；multiplexer 會合併提醒，並保留 deny／ask。
  - v2.36.99：`AUTOPILOT_TEST_RUN_GUARD`，跑測試時不准寫入真實的 capability store。
  - v2.36.100：context-budget 讀的 live dir 跟 statusline 寫的對上了——`resolveLiveDir()` 在 `XDG_RUNTIME_DIR` 缺席時新增 `xdg-inferred` 推斷 `/run/user/<uid>/autopilot`，並且只在父目錄私有時才 chmod 0700 接受帶 group/other 位的候選目錄。落地走了三輪 impl review + 兩輪 landing combined review，過程中規則被複審打回重訂一次（細節見 `references/evidence-discipline.md` §47、`docs/plans/evidence/2026-09-28-context-budget-live-dir/`）。
  - `370a9723`：portability 文件補上 hook 輸出管道的實測表；evidence-discipline 補上 §42–§46（stash 裡的舊內容以 §45/§46 重新落地）；sonnet 工頭配方補上新條款。
  - `fd6f1c1d`：專案 skill `.claude/skills/foreman-landing-pipeline/`（流程檢查清單加四份 brief 範本）。
  - v2.36.101：`dispatch-hetero.sh --timeout` 從「接受但不對每個 rail 生效」改成用中央 `run_worker` watchdog 強制（呼叫端帶 `--timeout` 或落在 contract wall 內才會武裝；裸預設 9m 仍不強制）。結果 JSON 新增 `timed_out`/`timeout_enforced`，manifest 新增 `timeout_enforced`/`timeout_source`。落地經 implement foreman + cursor grok hands r1–r6、landing foreman 兩輪；round 3 的 stub 套件曾全綠但漏裝 detached-path 的 `normalize_timeout_seconds`（real-rail proof 322 秒抓到），landing combined review 另外在一個逐輪審查放行過的 diff 上抓到 bare-pid fallback 的 🟠。證據見 `docs/plans/evidence/2026-09-29-dispatch-hetero-wall-timeout/README.md`；教訓見 `references/evidence-discipline.md` §48。

## 已決事項（不重議）
- depth-0 只做三件事：讀報告、下裁決、派工。產品碼、落地、release 都交給 sonnet 工頭在 clone 裡做。流程照 `foreman-landing-pipeline` skill 走。
- 工頭不能自己駁回審查的 🔴／🟠，只有 depth-0 能在重新核對後駁回（ADR-0001）。最後一定要做一次 `origin/develop..HEAD` 的整包審查。
- 發版 clone 一定要 `git config core.hooksPath .githooks`；QC trailer 的審查編號要從 manifest 填（v2.36.99 曾經帶著字面上的 `<id>` 推上去）。
- 沒有 l4–l6 marker 時，foreman-guard 只提醒、不擋（operator 2026-09-25 的決定）。
- 只負責提醒的 hook 絕對不能送 `permissionDecision:"allow"`；Stop 不能用 `additionalContext`，也不能用 exit 2 送提醒。
- 2026-09-26 那筆 capability「污染」判定為不成立：絆線實驗跑兩次完整套件都零觸發。

## 下一步
1. ~~context-budget 讀錯 live dir~~ 已完成，v2.36.100 出貨（見上）。回報這件事的本機 session 308-d1 只要求「修好後告訴 owner」——owner 已經知會，不需要回覆 308-d1。
2. ~~`docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`~~ 已完成，v2.36.101 出貨（見上），該 row 及其 sidecar 已刪。
3. 候選（依序）：
   - ~~兩筆 pre-existing-red 列~~ 已完成（docs/tests-only，未出貨版號）：`engine-qualify-verdict-stability` 的 KR7 base 從 `b24d900a` 前進到 `dbf0e123`（implementer grader 在 09-24 重釘，舊 base 的 pin 比對必紅）；`migrate-backlog-entries` 的 `>=100` 下限隨 BACKLOG 變 queue 必然衰減（fixture 量到刪列後恰為 100、貼著下限，再出貨一列就會變無 FAIL 行的靜默紅），改 `>=20`。兩列與 sidecar 已刪。
   - ~~codeforge 0700 列~~ 已完成：codeforge `1b388ed`（DirBuilder mode 0700，新建的上層目錄也是 0700；BACKLOG 列已關）。原說明：`docs/backlog/context-budget-live-dir-mismatch.md` 原位置已刪，新內容併入 v2.36.100 CHANGELOG——codeforge 建立 `$XDG_RUNTIME_DIR/autopilot` 時目前是 0775，應該一開始就 mkdir 0700。
   - 新的 watchdog follow-ups 列：`docs/backlog/dispatch-hetero-watchdog-followups.md`（v2.36.101 combined review 抓到、與本次修復不重疊的其餘項目）。
4. `docs/backlog/foreman-guard-cost-shaped-gate.md`（觸發條件還沒成立，不要先做）。

## 驗證方式
- `git status --short` 是空的；`git log --oneline -1` 是這份 closeout commit 或之後的 commit。
- `node scripts/check-plan-graduation.js --repo-root . --json` 的 exit 是 0（有 44 條 `plan_reference_dangling` 是原本就有的）。
- `bash scripts/preflight-release.sh` 回報 v2.36.101 一致。
- `node scripts/check-hook-inventory.js --check` 顯示 32 個 hook（19 個預設開啟）。

## Read-order
1. /home/cookys/projects/autopilot/.claude/skills/foreman-landing-pipeline/SKILL.md：派工到發版的流程和範本。
2. /home/cookys/projects/autopilot/docs/plans/evidence/2026-09-28-context-budget-live-dir/README.md：v2.36.100 落地的完整證據索引。
3. /home/cookys/projects/autopilot/docs/plans/evidence/2026-09-29-dispatch-hetero-wall-timeout/README.md：v2.36.101 落地的完整證據索引。
4. /home/cookys/projects/autopilot/references/evidence-discipline.md §42–§48：這幾天的教訓。
5. /home/cookys/projects/autopilot/hooks/README.md § Hook Output Channels：哪些 hook 輸出模型看得到。

## 陷阱
- 工頭停下來後不會被自己的背景工作叫醒。depth-0 要自己設 dead-man 計時器，時間到先去 git 查狀態，再用 `SendMessage` 叫醒它（記憶：background-dispatch-pickup-gate）。
- exec-boundary 會攔下出現在 heredoc 或字串裡的破壞性字樣，這類腳本要先寫成檔案再跑（記憶：exec-boundary-literal-text-trap）。
- `pgrep -f` 會比對到自己（記憶：pkill-self-match-trap）。
- 一個「等背景 monitor 通知」的工頭可能整個停下來、什麼都沒在跑，卻不會回報任何錯誤——depth-0 的 dead-man 檢查要看行程（是不是真的還有東西在跑），不能只看 git 狀態，因為乾淨的 git 狀態也可能只是「還沒開始動」。
- 停放中、等 owner 決定的事項：`origin/main` 大幅落後 develop。
