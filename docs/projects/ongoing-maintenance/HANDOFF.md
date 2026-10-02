## 目標
接續 autopilot 維護。2026-10-02 這個 session 出貨了 v2.36.105（測試套件寫入防護）；兩條線正在進行：測試套件加速、kimi/agy final-panel 隔離。

## 現況
- 分支 `develop`。2026-10-02 出貨兩版：v2.36.105（測試套件寫入防護，`a8e4045c`）、v2.36.106（測試加速，`d15a45a5`；完整套件 `--parallel 16` 實測 19.4 分鐘，主機負載約 40 時）。HEAD 以 `git log --oneline -1` 為準。
- 主 checkout 的 local git 身分已清；`/tmp/.git` 已刪。三層防護見 `docs/plans/evidence/2026-10-02-test-suite-repo-write-containment/README.md`。
- landing 範本已改（`d5b7eae2`）：完整套件每次發版只跑一次、`--parallel 16`，之後只重跑紅的與改到的。
- **下一個要做 — kimi/agy final-panel 隔離**：plan 已凍結 `docs/plans/2026-10-02-final-panel-kimi-agy-isolation.md`（G1/G2 artifacts + dispositions 在旁邊；spike 證據在 `docs/plans/evidence/2026-10-02-final-panel-kimi-agy-isolation/spike-log.md`）。5 個 phase；兩者都只到 cleanroom，工具關閉靠 post-run audit 加每 runner 的正向標記。operator 三題預設寫在 §8。實作照「派工規模」記憶：互不相依的 phase 平行、碰 bwrap/audit 的 phase 用 sonnet hand。
- 已觸發、排在 kimi/agy 之後或可平行的 S 級：`verification-author-pin-unreachable`、`dispatch-author-kimi-timeout-not-forwarded`、`context-budget-unknown-window-t2-on-1m-without-live-file`、`opencode-package-json-test-drift`。
- 已知偶發紅：`test-snapshot` 的 `P4 pgid` SIGINT 案例、`dispatch-hetero-watchdog-followups` 的 zombie 時序案例（都單跑綠）。

## 已決事項（不重議）
- depth-0 讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review。
- **派工前先估規模**（operator 2026-10-02 兩度抱怨太久）：獨立的列平行派；大列或碰 signal/trap 的列 hand 用 sonnet；開工就報預估時長。
- **測試只重跑壞掉的或受影響的**；完整套件每次發版一次。
- peer 的回報／技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；改碼的修正照排序。
- kimi/agy 隔離排在測試加速之後；tier `none` 永不豁免。

## 下一步
1. kimi/agy 隔離實作（見上）。完成後回報 cuda/chatgpt-tunnel（peer 有在等 SHA）。
2. 上面四個 S 級 BACKLOG 列。
3. 兩個偶發紅。

## 驗證方式
- `git status --short` 乾淨；`git config --local --get user.email` 沒有值。
- `bash scripts/preflight-release.sh` 回報 v2.36.106 一致。

## 陷阱
- 這台 bwrap 不能巢狀（`apparmor_restrict_unprivileged_userns=1`）。
- 新的身分 gate 上線後，任何 test 字樣 email 都 commit／push 不進真 repo；clone 裡要用真身分。
- 背景 foreman 停車不會自己醒；dead-man 計時器要配合查行程，不只看 git。
- cost-tracker：這個 session 已超過 1 億 cache tokens，下一個 session 從本檔接手。
