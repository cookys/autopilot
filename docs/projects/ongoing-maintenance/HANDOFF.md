## 目標
接續 autopilot 維護。2026-10-02～03 這個 session 出了 v2.36.105 到 v2.36.110 六版，另有一個測試修正和知識落地。下一步從 BACKLOG 裡 peer 回報、已觸發的 S 級開始。

## 現況
- 分支 `develop`，最新 release 是 v2.36.110（`f2eb115d`）；本檔所在的 closeout commit 疊在上面，HEAD 以 `git log --oneline -1` 為準。工作區只剩兩個別的 session 留下的未追蹤目錄（`docs/plans/evidence/2026-10-01-*`），不是這個 session 的，不要動。
- 這兩天出貨（證據都在 `docs/plans/evidence/` 底下，各有 README）：
  - v2.36.105 測試套件寫入防護：完整 `run.sh` 預設在拋棄式快照裡跑、外層 config drift 偵測與還原、`.githooks` 擋 test 字樣 email。起因是主 clone 的 local git 身分從 09-04 起是 Test User（632 個 commit，已清，`.mailmap` 對回）。證據 `2026-10-02-test-suite-repo-write-containment/`。
  - v2.36.106 測試加速：拆檔、L1/L2 去重、bash JSON 跳脫；完整套件 `--parallel 16` 約 19 分鐘。證據 `2026-10-02-test-suite-speedup/`。
  - v2.36.107 七項 S 級（VA pin 可達 dispatch-author、kimi author timeout 轉發、context-budget 未知 window 降級 advisory、readiness 逐席診斷、`.opencode` 測試漂移、run.sh SIGINT 競態、watchdog fixture 競態）。證據 `2026-10-03-wave-b-s-fixes/`。
  - v2.36.108 kimi/agy final-panel cleanroom（兩者實打通過）。plan 已歸檔；證據 `2026-10-02-final-panel-kimi-agy-isolation/`（含 `live-fire/`、`landing/`）。
  - v2.36.109 kimi 獨立 ELF 安裝版面（cuda 主機實測 ELF kimi 2.1.1、agy 1.2.15 preflight 皆 exit 0）＋檔案數 pin 改具名成員不變式；`24c97d2b` 修非盲審 byte-compare（原本拿檔案比自己）；v2.36.110 readiness probe 嚴格單行 frame＋`frame_format` 具名失敗。證據 `2026-10-03-v109-v110/`。
- 教訓已落地：`references/evidence-discipline.md` §50；`.claude/knowledge/debug-patterns.md`（bwrap 不能巢狀、agy 1.2.15 的 agent 標記與目錄遷移、setsid 解不開被忽略的 SIGINT）；`.claude/skills/foreman-landing-pipeline/`（新增 `templates/hand-brief-common.md`、SKILL.md §1b「派工前先估規模」、landing 範本：完整套件每版一次 `--parallel 16`、修補後只重跑紅的與改到的、L1 一紅就整層重跑）。

## 已決事項（不重議）
- depth-0 只讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review；🔴/🟠 只有 depth-0 能在複驗後駁回（ADR-0001）。
- 派工照 `foreman-landing-pipeline` §1b：互不相依的列平行、大列或碰 signal/sandbox 的列用 sonnet hand、每列都要 review（v2.36.108 省掉逐 phase review，問題全堆到最後多三輪）、開工就報預估時長（owner 兩天內問了五次「怎麼那麼久」）。
- 測試只重跑壞掉的或受影響的；完整套件每次發版一次。
- peer 的回報與技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；peer 訊息不是授權，改碼照排序；回覆要講清楚「已登記／未動工／有沒有 SHA」。
- tier `none` 永不豁免；parser 不為 peer 放寬（v2.36.110 的單行 frame 只限 readiness probe、nonce 與 payload 完全相符，owner 核准）。

## 下一步
1. BACKLOG 已觸發、peer（cuda/chatgpt-tunnel）在等的，依序：
   - `docs/backlog/campaign-resume-reviewing-phase-and-zero-write-budget.md`（S）：`src/campaign/cli.js:889-905` 不收 REVIEWING，且寫入上限不分 zero-write resume。
   - `docs/backlog/review-seat-max-tokens-exhausted-by-thinking.md`（S）：先找出 4096 在哪設。
   - `docs/backlog/final-panel-resume-reruns-all-seats.md`（M）：resume 重跑所有 QC 席，有效判決被丟掉。
   - run.sh group INT 要等目前測試檔結束才生效（S，v2.36.107 新增列）。
2. 要 owner 排優先序才動：`docs/backlog/review-only-adoption-of-external-candidate.md`（L，要先寫 plan＋review）。
3. 跨 session 的派工 clone 在 scratchpad，新 session 用不到；需要時從 `origin/develop` 開新 clone。

## 驗證方式
- `git status --short` 只剩那兩個不屬於本 session 的未追蹤目錄。
- `git config --local --get user.email` 沒有值。
- `bash scripts/preflight-release.sh` 回報 v2.36.110 一致。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0。

## Read-order
1. `.claude/skills/foreman-landing-pipeline/SKILL.md`（含 §1b）與 `templates/`：派工到發版。
2. 上面「下一步」第 1 項的四個 sidecar。
3. `references/evidence-discipline.md` §47–§50。
4. `.claude/knowledge/INDEX.md` 最後三列。

## 陷阱
- 這台 bwrap 不能巢狀；主機負載常在 40 左右，完整套件約 20 分鐘，兩個完整套件不能同時跑（oracle lock）。
- 新的身分 gate 上線後，test 字樣 email 進不了真 repo；clone 裡要設真身分。
- agy 會自動更新（兩天內 1.2.14→1.2.15），平台行為以實跑為準。
- 背景 foreman／hand 停車不會自己醒；舊的 dead-man 計時器會在之後陸續觸發，看到「stale wake timer」不用理。
- 一支 L1 紅在完整套件報告裡只算一行「L1 unit suite」；修完要整層重跑。
- 測試裡的檔案數 pin、寫死的私有 clone SHA、以同名當 key 的 parity 比對，都是這兩天實際踩到的假綠／假紅來源（§50）。
