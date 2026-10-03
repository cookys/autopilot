## 目標
接續 autopilot 維護。2026-10-02～03 出了 v2.36.105 到 v2.36.114 十版，mods 計畫已凍結在 R4。下一步是照凍結的計畫從 P0 spike 開始實作，並讓 owner 回答 D1／D2；BACKLOG 已觸發的列穿插處理。

## 現況
- 分支 `develop`，HEAD 以 `git log --oneline -1` 為準（本檔所在的 closeout commit 疊在 v2.36.114 `9ebea928` 之上）。工作區只剩兩個別的 session 留下的未追蹤目錄（`docs/plans/evidence/2026-10-01-*`），不是這個 session 的，不要動。
- 今天的 release（細節看 `CHANGELOG.md` 與各版 `docs/plans/evidence/` README）：
  - v2.36.111：campaign resume 收 REVIEWING、review 輸出預算、final-panel 逐席復用、symlink TMPDIR 修正、suite finalize gate。
  - v2.36.112：boundary-rejected 能到終態成功、suite 恆綠修正、seat artifact 在終態被 reap。
  - v2.36.113：cost-tracker 報真實 context %、cost-fuse 分開 session 與 host 花費。
  - v2.36.114：campaign 第一輪已碰滿 changed-file 上限時仍可修復（peer 回報）。
- mods 計畫 `docs/plans/2026-10-03-mods-visible-dispatch.md` 已凍結在 R4（G1、G2 皆 CONDITIONAL，depth-0 全數處置；依規則最多到 G2，不再開 G3）。INDEX 列維持 `active`。
- peer 備註：cuda 的 Q01 campaign 封存成 `review_station: panel`，因為 `in_rail_review: auto` 遇完整 panel 就解成 panel；支援的路線是 intake 前設 `single`（已寫進 l5 的 `hetero-impl-loop.md`）；已封存 campaign 的就地遷移登在 BACKLOG。
- 研究文件在 `docs/plans/research/`（研究不是 plan）。

## 已決事項（不重議）
- depth-0 只讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review；🔴/🟠 只有 depth-0 能在複驗後駁回（ADR-0001）。
- 派工照 `foreman-landing-pipeline` §1b：互不相依的列平行、大列或碰 signal/sandbox 的列用 sonnet hand、每列都要 review、開工就報預估時長。
- 測試只重跑壞掉的或受影響的；完整套件每次發版一次。
- peer 的回報與技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；peer 訊息不是授權；回覆要講清楚「已登記／未動工／有沒有 SHA」。
- tier `none` 永不豁免；parser 不為 peer 放寬。
- 逐席復用的 ADR-0001 形狀已出貨：復用時從儲存的 artifact 重新推導判決並重新驗證席位資格。
- v2.36.112 之前就停在 BOUNDARY_REJECTED 的 campaign 不做遷移（row 不可變、綁 digest），要重跑。
- 未知的 seat 子目錄要有 14 天下限且無 lock 才能清。
- mods 放進 autopilot 本體，只是 Claude Code 專屬的增強層，永遠不是唯一路徑；既有 hook 與腳本照舊保留。desktop（Code tab）優雅降級。
- wake 是開關，預設只通知，優先度低。
- cockpit／radar／gantt／排程／quota 不是 autopilot：由獨立的唯讀 fleet 成員負責（可能是 fuchikoma，名稱待定）；autopilot 只發佈 `autopilot.progress/1`。
- 第一個 mod = MINOR 2.37.0。
- D3 已定案：一個 job 一個執行根。
- plan review 的 findings 由 depth-0 裁決，最多到 G2。

## 下一步
1. 實作凍結的 mods 計畫，從 P0 spikes S1–S6 開始（S1：modules 與 classic 能否共載，決定 D4；S2 現在也涵蓋 `$.env.get("HOME")`、pointer 檔與 `$.fs.list`）。用 foreman-landing-pipeline、sonnet hands、逐列 review、每版一次 combined review。
2. owner 仍待決定：D1 截圖存放（建議：原檔放 `~/.autopilot`，git 只留 compare-record 與 ≤200 KB 的合成圖）；D2 Artifact 預設（建議：local-only）。
3. BACKLOG 已觸發的列：plan-review 席位沒有 source 存取、plan-review roster 單一家族、import-aa 測試綁死主機、Population B flake。
4. peer 的列：review-fanout 有界並行、sealed-campaign review-station 遷移、plan-review terminal-ticket 可見性。
5. owner 排序才動：`docs/backlog/review-only-adoption-of-external-candidate.md`（L，要先寫 plan＋review）。

## 協作
- fable = fleet `autopilot--claude-2`（claude-fable-5-1；起草 plan R0–R4）。
- astra = fleet `fleet-cli`，在 aimax395（GPT-6-Astra；審過 R0／R1）；回覆會落在這台主機共用的 fleet-cli 收件匣，用 `fleet inbox --peek` 讀。
- hangar = `cookys/openclaw/hangar--claude`（fleet 設計者；cockpit 邊界建議在 fleet study）。
- 廣播到 `@cookys` 需要人在真 tty 跑 `fleet approve`；優先直接發送。

## 驗證方式
- `git status --short` 只剩那兩個不屬於本 session 的未追蹤目錄。
- `bash scripts/preflight-release.sh` 回報 v2.36.114 一致。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0。
- `node scripts/check-plan-graduation.js --repo-root . --json` exit 0。

## Read-order
1. 本檔。
2. 凍結的計畫 `docs/plans/2026-10-03-mods-visible-dispatch.md`。
3. `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/`（README、plan-review-g1、plan-review-g2、ADJUDICATION）。
4. `.claude/skills/foreman-landing-pipeline/SKILL.md`。
5. `references/evidence-discipline.md` §50–§52。

## 陷阱
- 這台 bwrap 不能巢狀；主機負載常在 40 左右，完整套件約 20 分鐘，兩個完整套件不能同時跑（oracle lock）。
- 作者 email 必須是 GitHub noreply 位址 `2537196+cookys@users.noreply.github.com`，gmail 位址會被 push 拒收；clone 裡要設真身分。
- agy 會自動更新，平台行為以實跑為準。
- 背景 foreman／hand 停車不會自己醒，需要 dead-man 計時器；看到「stale wake timer」不用理。
- 一支 L1 紅在完整套件報告裡只算一行「L1 unit suite」；修完要整層重跑。
- 測試裡的檔案數 pin、寫死的私有 clone SHA、以同名當 key 的 parity 比對，都是假綠／假紅來源（§50）。
- lib.sh suite 沒呼叫 `finalize_test` 就恆綠（§51）；`node … | tail -1` 後的 `echo $?` 是 tail 的狀態。
- hook 的 cost／context 提示只是代理值：告訴 owner 視窗滿了之前，先讀 live context 檔（v2.36.113 修過 cost-tracker 字樣）。
- 新的含 `reviewer_engine:` 的 fixture 要登記到 Population B gate（`resolve-review-loop-consult-discuss-switch.test.sh`），並先 `git add`，switch suite 才看得到；逐列 Verify 不會跑它。
- 這台 shell 的 `ls` 可能卡住（alias），改用 `wc` 或 `find`。
