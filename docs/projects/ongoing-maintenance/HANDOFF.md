## 目標
接續 autopilot 維護。2026-10-02 這個 session 出貨了 v2.36.105（測試套件寫入防護）；兩條線正在進行：測試套件加速、kimi/agy final-panel 隔離。

## 現況
- 分支 `develop`。2026-10-02～03 出貨：v2.36.105（測試套件寫入防護）、v2.36.106（測試加速）、v2.36.107（七項 S 級：VA pin 可達 dispatch-author、kimi author timeout 轉發、context-budget 未知 window 降級 advisory、readiness 逐席診斷、`.opencode` 測試漂移、run.sh 忽略 SIGINT 的 setsid 競態、watchdog fixture 競態）、v2.36.108（kimi/agy final-panel cleanroom，兩個 runner 都實打通過；plan 已歸檔）。
- 之後又出：v2.36.109（kimi 獨立 ELF 安裝版面；cuda 主機實測 ELF kimi 2.1.1 + agy 1.2.15 model-free preflight 皆 exit 0）、測試修正 `24c97d2b`（非盲審 byte-compare 原本拿檔案比自己，§50）、v2.36.110（readiness probe：嚴格單行 frame 只限 probe 接受；`frame_format` 具名失敗並保留 stderr/envelope 診斷）。
- landing 範本（`.claude/skills/foreman-landing-pipeline/templates/land-brief.md`）已改：完整套件每版一次 `--parallel 16`；之後只重跑紅的與改到的；L1 一紅就整層重跑。
- hand 共用 brief 規則（寫在 scratchpad，新 session 要自己帶）：RED-first、只跑改到的套件 + 強制 consumer sweep（含 L1 `.test.js`）、不跑完整套件、真身分不 `--no-verify`。

## 已決事項（不重議）
- depth-0 讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review。
- **派工前先估規模**（operator 2026-10-02 兩度抱怨太久）：獨立的列平行派；大列或碰 signal/trap 的列 hand 用 sonnet；開工就報預估時長。
- **測試只重跑壞掉的或受影響的**；完整套件每次發版一次。
- peer 的回報／技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；改碼的修正照排序。
- kimi/agy 隔離排在測試加速之後；tier `none` 永不豁免。

## 下一步
1. cuda 正在隔離環境驗 v2.36.110；有回報再處理。
2. BACKLOG 已觸發、peer 等著的（依序）：`campaign-resume-reviewing-phase-and-zero-write-budget`（S）、`review-seat-max-tokens-exhausted-by-thinking`（S，先找 4096 在哪設）、`final-panel-resume-reruns-all-seats`（M）、run.sh group INT 延遲（S）。
3. 需要 owner 排優先序才動：`review-only-adoption-of-external-candidate`（L，要先寫 plan）。
4. 派工照記憶「foreman 派工規模」：獨立項平行、sonnet hand、每 phase 都要 review（v2.36.108 為省時間跳過逐 phase review，問題全堆到 combined review，多三輪）。

## 驗證方式
- `git status --short` 乾淨；`git config --local --get user.email` 沒有值。
- `bash scripts/preflight-release.sh` 回報當前版號一致。

## 陷阱
- 這台 bwrap 不能巢狀（`apparmor_restrict_unprivileged_userns=1`）。
- 新的身分 gate 上線後，任何 test 字樣 email 都 commit／push 不進真 repo；clone 裡要用真身分。
- 背景 foreman 停車不會自己醒；dead-man 計時器要配合查行程，不只看 git。
- cost-tracker：這個 session 已超過 1 億 cache tokens，下一個 session 從本檔接手。
