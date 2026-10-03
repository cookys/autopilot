## 目標
接續 autopilot 維護。2026-10-02～04 出了 v2.36.105 到 v2.36.115 十一版。mods 計畫凍結在 R4.3：P0 spike 已跑完並回寫，D1／D2／D4 都已決，P1a 已在 v2.36.115 出貨。下一步是 P1b（renderer 與 host review server）；BACKLOG 已觸發的列穿插處理。

## 現況
- 分支 `develop`，HEAD 以 `git log --oneline -1` 為準（本檔所在的 closeout commit 疊在 v2.36.115 `97be7170` 之上）。工作區只剩兩個別的 session 留下的未追蹤目錄（`docs/plans/evidence/2026-10-01-*`），不是這個 session 的，不要動。
- 今天的 release（細節看 `CHANGELOG.md` 與各版 `docs/plans/evidence/` README）：
  - v2.36.111：campaign resume 收 REVIEWING、review 輸出預算、final-panel 逐席復用、symlink TMPDIR 修正、suite finalize gate。
  - v2.36.112：boundary-rejected 能到終態成功、suite 恆綠修正、seat artifact 在終態被 reap。
  - v2.36.113：cost-tracker 報真實 context %、cost-fuse 分開 session 與 host 花費。
  - v2.36.114：campaign 第一輪已碰滿 changed-file 上限時仍可修復（peer 回報）。
  - v2.36.115：mods P1a。`status runs` 回報耗時、rc、scope、新鮮度；每個 project 一支 watcher 發布 scoped 即時快照；run manifest 帶 `repo_identity`；session-mode marker 帶 scope 欄位並寫 live pointer；`references/mods.md`。三輪 combined review，第三輪 SHIP-AS-IS。證據在 `docs/plans/evidence/2026-10-04-mods-p1a/`。
- **副作用要知道**：已安裝的 plugin symlink 到這個 checkout，所以每次 `/l3`～`/l6` 的 `session-mode set` 現在都會啟動一支 per-project watcher，活到 idle-exit 為止（marker 過期後最多 24 小時）。停掉用 `node bin/autopilot.js status runs --stop --project <key>`；整個關掉用 `AUTOPILOT_RUNS_WATCH_AUTOSTART=0`。
- mods 計畫 `docs/plans/2026-10-03-mods-visible-dispatch.md` 已凍結（G1、G2 皆 CONDITIONAL，depth-0 全數處置；依規則最多到 G2，不再開 G3）。凍結後有兩次有界修補：R4.1 回寫 owner 對 D1／D2 的裁決，R4.2 回寫 P0 spike 結果。凍結後又有 R4.3：P1a 出貨後更正「鎖的前提」二擇一 (ii) 的錯誤句（node 不會成為 `/proc/locks` 的 pid）。INDEX 列維持 `active`。
- P0 spike（`docs/plans/evidence/2026-10-03-mods-spikes/README.md`）：S1 yes（modules 與 classic 能共載，D4 結案）、S2 partial、S5(a) partial（desktop 這台跑不到）、S5(b) yes、S6 no（P2 要新寫量測儀器）、S3 yes、S4 no（owner 經 ssh 進 tmux，終端內圖片不可行）。depth-0 從原始檔複驗了 S1、S5(a)、S5(b)，並推翻計畫一處事實：`flock(1)` 是 fork 不是 exec，P1a 的鎖驗收不能拿 `/proc/locks` 的 pid 比 `writer.pid`；P1a 的 R4／R5 實測證實這一點（驗持有者要看 `writer.pid` 的 fd 9）。
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
- D1 已定案：原圖與 bundle 留 `~/.autopilot/review/<project_key>/`，git 只收 compare-record 與 ≤200 KB 預覽。
- D2 已定案：整台機器一個 review server、一個 port，只綁 127.0.0.1；各專案頁在 `/<project_key>/…` 底下，根目錄有靜態專案索引（不是 cockpit）；遠端看走 owner 自己的反向代理（tailscale serve／caddy／ssh -L），autopilot 只寫文件、不內建，也不做 auth／TLS。
- D4 結案：S1 = yes，不需要第二個 plugin。
- `references/mods.md`（spike 結果與 surface 降級表）跟 P1a 一起出，P0 本身不升版。
- plan review 的 findings 由 depth-0 裁決，最多到 G2。

## 下一步
1. P1b：`scripts/render-review-page.js` 與 host review server（單一 port、只綁 127.0.0.1、根目錄索引），細節照計畫 R4.1。用 foreman-landing-pipeline：sonnet hands、互不相依的列平行、逐列 review、落地前一次 combined review。P1a 留下的 🔵 項目在 `docs/backlog/mods-p1a-known-follow-ups.md`，P1b 動到 `runs-watch.js` 時順手處理。
2. owner 的工作環境是 ssh 進 tmux：任何「在終端裡顯示圖片」的設計都不適用，圖一律走瀏覽器 review 頁（反向代理）。
3. BACKLOG 已觸發的列（另加一列：被拒的 `AUTOPILOT_LIVE_DIR` override 會靜默落到真的 live dir）：plan-review 席位沒有 source 存取、plan-review roster 單一家族、import-aa 測試綁死主機、Population B flake。
4. peer 的列：review-fanout 有界並行、sealed-campaign review-station 遷移、plan-review terminal-ticket 可見性。
5. owner 排序才動：`docs/backlog/review-only-adoption-of-external-candidate.md`（L，要先寫 plan＋review）。

## 協作
- fable = fleet `autopilot--claude-2`（claude-fable-5-1；起草 plan R0–R4）。
- astra = fleet `fleet-cli`，在 aimax395（GPT-6-Astra；審過 R0／R1）；回覆會落在這台主機共用的 fleet-cli 收件匣，用 `fleet inbox --peek` 讀。
- hangar = `cookys/openclaw/hangar--claude`（fleet 設計者；cockpit 邊界建議在 fleet study）。
- 廣播到 `@cookys` 需要人在真 tty 跑 `fleet approve`；優先直接發送。

## 驗證方式
- `git status --short` 只剩那兩個不屬於本 session 的未追蹤目錄。
- `bash scripts/preflight-release.sh` 回報 v2.36.115 一致。
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
- 平行派 hand 寫證據檔時，brief 要給每個 hand 互不重疊的檔名；這次兩個 hand 都寫 `S5.md`，後寫的蓋掉先寫的。
- 隔離的 `CLAUDE_CONFIG_DIR` 只放 `.credentials.json` 的話，互動 session 會卡在登入精靈，要另外 seed `.claude.json`；跑完要刪掉 scratch 裡的憑證副本。`claude plugin test` 對真的 `~/.claude` 會拒跑。
- 當 classic 見證用的 `cost-tracker` 需要持久化的 transcript，`--no-session-persistence` 下不會寫列。
- `AUTOPILOT_LIVE_DIR` 設在 `/tmp` 或權限 755 的目錄會被 `live-state-dir.js` 靜默拒絕，接著落到真的 `$XDG_RUNTIME_DIR/autopilot`，測試就寫進真 store。測試要用 `/dev/shm` 底下 0700 的目錄（`lib.sh` 預設已這樣做），並在跑前後 diff 真 store（`references/evidence-discipline.md` §53）。
- 送 review 的 spec 只能寫需求；夾帶 depth-0 裁決敘事會被 blind-evidence K1 擋下（R7 第一次就這樣被拒）。
- 完整套件目前有 3 個既存的紅，origin/develop 上也紅，不是新回歸：L1 unit suite（22 個）、`qualification-feed-adopt`、`qualification-scorecard-tools`。判紅只看 Summary 段。
