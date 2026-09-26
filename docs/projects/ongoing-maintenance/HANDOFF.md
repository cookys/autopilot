## 目標
接續 autopilot 維護。2026-09-25 這個 session 把 peer 回報的 `foreman-guard-role-aware-caps` backlog 候選做完，出貨 **v2.36.97**（`edc0e9cc` 之後的 closeout commit）。
09-21 那份 handoff 裡的事項都已結案：wave-1 在 v2.36.81 落地，depth-0 委派閘門在 v2.36.82 出貨，wave-1b 在 v2.36.95 出貨，B1 在 v2.36.96 出貨。

## 鐵律（沿用 owner 09-21 的規定）
- depth-0 只做三件事：讀報告、下裁決、派工。產品碼、落地、release 都交給工頭（sonnet Agent，在 clone 裡做）。
- BACKLOG 是佇列：有 plan 或已出貨就刪列。plan 要登記在 INDEX（`active`）。🔵 不進 BACKLOG。
- rail 有缺陷時，一律先出 Fix 版再重派，或依文件降級。

## 現況（HEAD = v2.36.98 + closeout commit，已 push）
0. **hook advisories 現在會送到模型（v2.36.98，`5a838b2d` + closeout commit）**：origin
   `docs/backlog/hook-stderr-advisories-invisible.md` 那批「stderr + exit 0 模型看不到」的建議
   （cost-fuse、context-budget T1、depth0-delegate-gate、reload-watch、dispatch-model-guard warn 等）
   全部改走 `hookSpecificOutput.additionalContext`；Stop 事件（cost-tracker、check-console、
   batch-format）沒有乾淨的同回合通道，改成寫進一個以 session 為 key 的佇列檔，由新的預設開啟 hook
   `advisory-relay`（`UserPromptSubmit`）在下一次送出訊息時原樣讀出來當 `additionalContext` 送達
   （退出開關 `AUTOPILOT_ADVISORY_RELAY=off`）；`dirty-protected-paths` 的 `systemMessage` 確認是
   human-UI-only、故意不進佇列。兩輪 combined-diff review（fable）分別抓到 multiplexer 誤丟
   deny/ask、exit-1 路徑被吞、queue race、`tsc` 沒排進 relay（round 1），以及一則過時文件字句
   （round 2）——**單列 review 抓不到的東西，combined review 抓到了**。落地時 land-phase 全套重跑
   出現一次 REAL-STORE POLLUTION（見下方候選 1），已手動清乾淨，歸因未證實。evidence 全在
   `docs/plans/evidence/2026-09-26-hook-channel-probe/landing/README.md`。
1. **foreman-guard 角色感知上限 + close-out reserve 已出貨（v2.36.97，`edc0e9cc`）**：`docs/backlog/foreman-guard-role-aware-caps.md` 那個候選（B1 落地後即可排入的觸發條件已滿足）做完了——角色感知 Bash 上限（`Role: worker`/`Role: reviewer` 120、工頭與未宣告角色 40）、收尾前保留額度（close-out reserve）、無 marker 的 `Engine:` 派工子代理改一律不擋＋每 40 次建議。落地前複審抓到一個 🟠 allow-bypass（`emitAllowContext()` 誤帶 `permissionDecision:"allow"`，等於幫每則建議自動放行底下的指令）並已修正——**這是本輪的關鍵教訓：advisory hook 絕不能帶 `permissionDecision:"allow"`**，只有真拒絕才設這個欄位。收尾 pass（本 session）修了三個已知後續：CHANGELOG v2.36.97 段落的簡體字 `没`→`沒`、`hooks/README.md` foreman-guard 行的過時措辭（「depth-0 and plain sessions are untouched」與新的無 marker 建議路徑矛盾）、`foreman-guard-roles.test.sh` 的 TMPDIR-unset 案例在沒有 `/dev/shm` 的主機上改成印 SKIP 而不是 fail。全套 evidence 在
   `docs/plans/evidence/2026-09-25-foreman-guard-roles/landing/README.md`。
1a. **09-21 的六個 backlog bundle 全數出貨**：B1 `review-loop-resolver-a`（wave 2，7 列）落地為 v2.36.96，plan 已歸檔到
   `docs/plans/_archive/2026/09/`，evidence 見 `docs/plans/evidence/2026-09-25-backlog-b1/README.md`。
   其餘 5 個 bundle 的 plan 也都已歸檔到 `docs/plans/_archive/2026/09/`。
1b. **下一輪候選**：
   - `docs/backlog/suite-pollutes-real-capability-store.md`（S，已 FIRED 2026-09-26：`run.sh --parallel 8`
     時一列 cc-shim/MiniMax-M3 的被動 capture 寫進了操作者真的
     `~/.autopilot/engine-capability/capability.jsonl`，已手動清除；懷疑是 engine-qualify /
     dispatch-review 被動 capture 沒有 guarded HOME，歸因未證實，需要找出那個套件並做成 hermetic）；
   - `docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`（S，grok 的兩個分支沒把 `$TIMEOUT` 轉給
     `run_worker`，manifest 卻照樣記 `timeout_seconds`）；
   - `docs/backlog/foreman-guard-cost-shaped-gate.md`（cost-shaped gate 尚未觸發，仍是 shadow-only）。
2. **平行派工配方**：證據與教訓在 `docs/plans/evidence/2026-09-24-backlog-wave-1b/README.md`。重點有兩條：
   - clone-local 的 shadow commit 要一開始就寫進 brief，不能事後用訊息補，工頭會（也應該）拒收。
   - 每列的 Verify 要涵蓋它所改契約的使用端套件，不能只跑 bundle 套件。
3. v2.36.95 最終審查留了三個 🔵：
   - `--exclude` 白名單判定過寬；
   - `runnerConsumesEffort` 的名單與 probe 的 `_EFFORT_CONSUMER` 是兩份手抄；
   - `admit-backlog-follow-ups` 的 finally 裡 releaseLock 沒有 try/catch。
   照規則不進 BACKLOG，有人碰到這些檔案時順手處理。
4. 停放：
   - `origin/main` 大幅落後 develop，等 owner 決定；
   - `stash@{0}`（evidence-discipline §20/§21，需要 QC 才能進 protected references/）別動；
   - `check-plan-graduation` 有 44 條 `plan_reference_dangling`，這次之前就存在、不擋；
   - 一個 5 天前的 `dispatch-review` 測試 mock node 程序（`/tmp/autopilot-test-dispatch-review-6PySJr`）還活著，owner 決定要不要清。

## 驗證方式
- `git status --short` 空；
- `git log --oneline -1` 是 v2.36.95 或其後；
- `node scripts/check-plan-graduation.js --repo-root . --json` 的 exit 為 0；
- `bash scripts/preflight-release.sh` 通過。

## 陷阱
- 引用改寫別碰 sha-bound plan（`docs/mission-*-sources.json` 封印的）。
- zsh 的 `set -- $var` 不會切詞，要用 `bash -c`。
- 工頭停車後不會被自己的背景工作叫醒：depth-0 要自己設 dead-man，時間到去看 git，再用 `SendMessage` 戳它。
- 1M session 沒有 statusline tee 時，context-budget 會在約 150K 報假 T2（v2.36.89 的 `statusline-live-tee.js` 可以修）。
