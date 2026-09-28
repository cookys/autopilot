## 目標
接續 autopilot 維護。2026-09-24～28 這個 session（ee9eb17b，opus）出貨了 v2.36.95 到 v2.36.99，另外有一個知識落地 commit 和一個專案 skill。下一步從 BACKLOG 裡已觸發的 S 級開始。

## 現況
- 分支 `develop`，HEAD `370a9723`（docs(knowledge): hook output-channel facts, evidence-discipline §42-46…），已 push，工作區乾淨，沒有 stash，只有主 checkout 一個 worktree。
- 這個 session 出貨的東西：
  - v2.36.95：wave-1b，10 個 backlog 列。
  - v2.36.96：B1 resolver-a，7 列。09-21 開的六包 bundle 全部結案。
  - v2.36.97：foreman-guard 依角色設上限（worker／reviewer 120）、最後 8 次的收尾保留、提醒走 `additionalContext`（不帶 `permissionDecision`）。
  - v2.36.98：14 個 hook 的提醒改走 `additionalContext`；Stop 提醒改由新的 `advisory-relay`（UserPromptSubmit）在下一次送出訊息時送達；multiplexer 會合併提醒，並保留 deny／ask。
  - v2.36.99：`AUTOPILOT_TEST_RUN_GUARD`，跑測試時不准寫入真實的 capability store。
  - `370a9723`：portability 文件補上 hook 輸出管道的實測表；evidence-discipline 補上 §42–§46（stash 裡的舊內容以 §45/§46 重新落地）；sonnet 工頭配方補上新條款。
  - `fd6f1c1d`：專案 skill `.claude/skills/foreman-landing-pipeline/`（流程檢查清單加四份 brief 範本）。

## 已決事項（不重議）
- depth-0 只做三件事：讀報告、下裁決、派工。產品碼、落地、release 都交給 sonnet 工頭在 clone 裡做。流程照 `foreman-landing-pipeline` skill 走。
- 工頭不能自己駁回審查的 🔴／🟠，只有 depth-0 能在重新核對後駁回（ADR-0001）。最後一定要做一次 `origin/develop..HEAD` 的整包審查。
- 發版 clone 一定要 `git config core.hooksPath .githooks`；QC trailer 的審查編號要從 manifest 填（v2.36.99 曾經帶著字面上的 `<id>` 推上去）。
- 沒有 l4–l6 marker 時，foreman-guard 只提醒、不擋（operator 2026-09-25 的決定）。
- 只負責提醒的 hook 絕對不能送 `permissionDecision:"allow"`；Stop 不能用 `additionalContext`，也不能用 exit 2 送提醒。
- 2026-09-26 那筆 capability「污染」判定為不成立：絆線實驗跑兩次完整套件都零觸發。

## 下一步
1. **context-budget 讀錯 live dir（S 級，已觸發）**：`docs/backlog/context-budget-live-dir-mismatch.md`。hook 執行時沒有 `XDG_RUNTIME_DIR`，所以選了 `/dev/shm`；statusline 寫的卻是 `/run/user/<uid>`。結果是 1M 的 session 在大約 150k 被誤報 T2。
   這是本機 session 308-d1 回報的，它要求修好後告訴 owner，不需要回覆那個 session。修法候選：讀取時把每個候選目錄都掃一遍，或是用 `/run/user/<uid>` 推回 xdg，再加一個 XDG 有／無的組合測試。走 Fix 流程，派工頭處理。
2. `docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`（S 級）。
3. `docs/backlog/foreman-guard-cost-shaped-gate.md`（觸發條件還沒成立，不要先做）。

## 驗證方式
- `git status --short` 是空的；`git log --oneline -1` 是 `370a9723` 或之後的 commit。
- `node scripts/check-plan-graduation.js --repo-root . --json` 的 exit 是 0（有 44 條 `plan_reference_dangling` 是原本就有的）。
- `bash scripts/preflight-release.sh` 回報 v2.36.99 一致。
- `node scripts/check-hook-inventory.js --check` 顯示 32 個 hook（19 個預設開啟）。

## Read-order
1. /home/cookys/projects/autopilot/.claude/skills/foreman-landing-pipeline/SKILL.md：派工到發版的流程和範本。
2. /home/cookys/projects/autopilot/docs/backlog/context-budget-live-dir-mismatch.md：下一步第 1 項的證據。
3. /home/cookys/projects/autopilot/references/evidence-discipline.md §42–§46：這兩天的教訓。
4. /home/cookys/projects/autopilot/hooks/README.md § Hook Output Channels：哪些 hook 輸出模型看得到。

## 陷阱
- 工頭停下來後不會被自己的背景工作叫醒。depth-0 要自己設 dead-man 計時器，時間到先去 git 查狀態，再用 `SendMessage` 叫醒它（記憶：background-dispatch-pickup-gate）。
- exec-boundary 會攔下出現在 heredoc 或字串裡的破壞性字樣，這類腳本要先寫成檔案再跑（記憶：exec-boundary-literal-text-trap）。
- `pgrep -f` 會比對到自己（記憶：pkill-self-match-trap）。
- 停放中、等 owner 決定的事項：`origin/main` 大幅落後 develop。
- 1M 的 session 在修好第 1 項之前，還是可能收到假 T2。T1 和其他提醒從 v2.36.98 起已經看得到了。
