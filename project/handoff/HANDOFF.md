# HANDOFF

> Two live handoff documents were merged here (3.0.0 relayout P1). Each keeps its original text verbatim under its own heading; the originals are in git history.

## A. Operator-pin work (was docs/HANDOFF.md)

<!-- merged from docs/HANDOFF.md; the original file's history is in git -->

## 目標

實作 `project/plans/_archive/2026/09/2026-09-11-operator-pin-supersedes-qualification.md` 的 P0 起全部階段。
**P0/P1/P2/P2b 已出貨**（v2.36.23–26，在 `origin/develop`）。**D4（plan P3）實作完成、未出貨**，
分支 `feat/d4-strike-fold-pending-revocation`，HEAD `3faffd27`，工作樹乾淨。

停在這裡是因為 context 到 T2（751k/1000k）。

## 接手第一件事：修一條已出貨的 admission 繞道（owner 2026-09-11 已裁示）

**這是最重要的一段，先讀完再動手。**

已出貨的 **v2.36.26 可以被繞過**。未 pin、且（a）完全沒有 scorecard row 或（b）ordinary strike
超過門檻的席位，只要餵一份 `--resolved-live` 文件，契約就回 `GO` + `assurance: operator-pin`，
並**憑空生出一筆 `operator_pin`**。兩份執行證據都在
`docs/plans/_archive/2026/09/evidence/2026-09-11-operator-pin-supersedes-qualification/d4-qc-panel.md`。

**根因（一句話）**：`pinAdmitsPreferred = resolvedLive && preferredTupleMatchesResolved(...)`
把「preferred tuple 等於解析出的引擎」當成「有 pin 的證據」。但**未 pin 時 resolver 一樣會給
preferred_tuple**（那是 ladder 的選擇）。兩條分支都這樣寫：
- `scripts/dispatch-contract.js:1482`（D3/P2b，KR1，**已出貨**）
- `scripts/dispatch-contract.js:1458`（D4/KR3，本分支）

對照組：**KR4 那條是對的**——resolver 只在 `if (pin && critical_trigger)` 時才設
`substitution_reason = 'critical_strike'`（`resolve-dispatch-topology.js:305`），所以它是
transitively pin-gated。KR3/KR1 少了對應的閘。

### owner 裁示：兩條分支一起修，隨 D4 出一個版

### 修法（設計已定，尚未動工）

1. **resolver 發出顯式的 pin**：`resolve-dispatch-topology.js` 已經有 `pin` 變數。在 `--resolve-live`
   的回傳裡加 `operator_pin`——有 pin 時是 `{engine, runner, role, operator, reason}`，沒有時是 `null`。
2. **契約要求它**：`isCompleteTuple` 旁邊的 `--resolved-live` 驗證加上「`operator_pin` 必須存在，
   且為 null 或五個字串欄位的物件」。**兩條分支**的 `pinAdmitsPreferred` 都改成
   `resolvedLive.operator_pin && preferredTupleMatchesResolved(...)`。
3. **`operatorPinFromLive` 改讀 pin 本身**（`dispatch-contract.js:260` 現在讀的是 `preferred_tuple`，
   那正是它誤把 ladder 選擇當成 operator 意圖的地方）。
4. **順便修 endpoint**：resolver 送 `endpoint: null`，契約的 `isCompleteTuple` 拒絕非字串
   （`dispatch-contract.js:184`）。**沒有具名 endpoint 的席位，整條 `--resolve-live → check
   --resolved-live` 走不通**。resolver 改送 `""`（契約註解明說那是 `@none` wallet）。
   **動之前先 `grep -n endpoint hooks/tests/resolve-live-tuple.test.sh`**——若那裡釘了 null，
   那條斷言要一起移，並在 commit 說明。
5. **紅案（這是 D3 漏掉的那一格）**：未 pin + `--resolved-live`，兩種都要——無 row（P2b）與
   三條 ordinary strike（KR3）。各自斷言 exit 3、pre-change 的拒絕字串在、輸出裡**沒有** `operator_pin`。

**爆炸半徑（誠實說）**：`hooks/tests/dispatch-contract-pin.test.sh` 要重做 fixture——每份手工的
live 文件都要加 `operator_pin` 欄位，已 pin 的案例填物件，再加上兩個未 pin 紅案。

### D3 的測試為什麼沒抓到——第五種空洞型態

`dispatch-contract-pin.test.sh` 裡**每一份 `--resolved-live` fixture 都是為已 pin 的席位手工建的**，
而**每個未 pin 的紅案完全不帶 `--resolved-live`**。沒有任何測試把「未 pin 的 resolver 文件」交給契約。
這不是「不可能失敗的斷言」，是**紅案從不餵入 GO 路徑實際消費的那個輸入**。前四種都是斷言層的，
這一種在輸入層——找空洞時要連「紅案走的是不是同一條路徑」一起問。

## 接手第二件事：openclaw 回報的 l5 marker gate（owner 2026-09-12 已授權，排在後面）

繞道修完、D4 出貨之後做這個，不要平行開。細節在 `project/backlog/BACKLOG.md` 的
`PEER-REPORTED … bounded non-Mission campaigns` 那列（commit `1cb55127`）。

一句話：`check_session_mode_gate` 要求一份 bounded contract 不會帶的 strict projection，
於是 `/l5` 自己啟動的 campaign 被 `/l5` 自己的 marker 擋死。v2.34.8 在 admission 側修過同一類
（`session-mode.js campaignCarriesMissionProjection`），dispatcher 側沒跟上。

**授權的是動手，不是跳過證據**：那列的每一項都是 peer 在別台機器上的觀察，本機一行都沒複驗。
**先在本機複現**，讓本機的執行結果——而不是那份回報——定義要修的缺陷。

**而且它和本檔上面那條 marker 陷阱不是同一個機制**（那條是 `check_marker_campaign_admission_bridge`
比對 digest；這條是 strict-projection gate 拒絕 bounded contract），**修一個不會修到另一個**。
測試矩陣要同時涵蓋「bounded campaign + 活的 l5 marker」與「strict campaign + 舊 graph 的殘留 marker」。

## D4 已完成的部分（分支上）

| commit | 內容 |
|---|---|
| `ae40d340` | mission 執行圖換成 D4 節點（digest `96318e7c`） |
| `62a58071` | BACKLOG：出一個 L5 交付項會把 repo 鎖住 24h |
| `674afe47` | BACKLOG：`awaiting_disposition` 是第三個無 CLI 出口的狀態 |
| `de2af3f5` | grok-4.5 實作 |
| `7f5ae517` | merge（含 depth-0 的 git-artifact 驗證） |
| `07dc63ad` | depth-0 修補：空洞斷言、多餘 export、`.pre.js` gitignore |
| `3faffd27` | QC panel 裁決證據 |

**KR7 的單一 fold 成立**（機械確認）：`grep -c strikes.jsonl scripts/resolve-dispatch-topology.js` = **0**，
rows 走 `computeSeatProjection().active_strike_rows`。

**測試**：`hooks/tests/pending-revocation-fold.test.sh` 63 assertions 綠。
兩條紅證：(a) 把 check payload 指向不存在的檔案——**修補前 41 passed / exit 0**，修補後 11 條具名失敗；
(b) 讓被拒絕的 row 洩漏——16 條具名失敗，每條指名洩漏的 row。

## 出貨清單（修完繞道之後）

下一個版號是 **v2.36.27**（推前先 `git show origin/develop:.claude-plugin/plugin.json` 對號）。
CHANGELOG 要單獨一段講「修正已出貨的 v2.36.26 繞道」。INDEX 列、`sync-version.js`、`sync-all.sh`、
`preflight-release.sh` 8/8（版號 commit **之後**才會過第 6 項）。

## 陷阱（這輪新學到的，rail）

- **出一個 L5 交付項會把 repo 鎖住 24 小時**。marker bridge（`dispatch-hetero.sh:1265`）會掃**整個**
  session-mode marker 目錄，任何一張活的、graph digest 不同的 marker 都讓派工 `precondition_failed`。
  一個 plan id 對一個 graph node，所以出完一個必然改 digest。`session-mode.js clear` 要
  `--task-status-receipt`，而那份 input bundle **全 repo 沒有任何產出者**（只有 reader，
  `src/status/task-runtime.js:97`）。2026-09-11 經 owner 裁示手動刪掉 D3 的 marker
  （備份在當時的 scratchpad）。**這是 workaround 不是慣例**，機制解法寫在 BACKLOG。
  **你自己這張 marker（`d1423f91…`，l5，到期 2026-09-12T13:08Z）在 D4 出貨後會變成下一個交付項的障礙。**
- **managed campaign 有三個「狀態機進得去、CLI 出不來」的狀態**：repair 死結、
  `mission_grant_ref_mismatch` 不釋放 claim、以及新記的 `awaiting_disposition`
  （合法 disposition + `--resume` 被 `campaign_intake` 拒絕，連 `campaign status` 都回同一個字串）。
- **`AUTOPILOT_ROOT_RUN_ID` 必填**，值是 contract 的 `mission_runtime.root_run_id`。漏了會在
  `prepare_implementation` blocked，**而且那次 block 會釋放 claim**，要重取 grant。
- **grant 要在最後一個 commit 之後才拿**（契約釘死 `base_sha`），brief 裡的 in-run baseline SHA
  要跟著 attempt base 一起重標。
- 三家族 panel 從 `qc_panel_seats` 派：codex/gpt-5.6-sol/max、cc-shim/GLM-5.2/high@glm、
  cc-shim/MiniMax-M3/high@minimax。67KB diff 給 20m。**seat JSON 後面別 append 東西**，
  會讓 `require()` 解析失敗（用 `head -1`）。

## 陷阱（自己）

- **panel 說的要自己跑過才算**。這輪 sol/GLM 的 MUST-FIX 屬實（PROBE B 確認），但**第一次 probe
  沒打到守衛**——被更早的 endpoint 驗證擋掉，於是又挖出一條兩席都沒找到的缺陷。
  跑不出預期結果時，先看是不是根本沒走到那條路徑。
- **不要在 commit 訊息裡把加強講成補洞**。這輪寫了「`cmp` 兩處也是空洞」，實跑後發現現實情境被
  上游的 `assert_contains` 擋住，訊息已改正。宣稱之前先跑變異。
- **`MiniMax-M3` 連續第四次在別家抓到缺陷時回 SHIP-AS-IS 零 finding**。這是 scorecard 訊號，
  交給資格機制處理，不要手動改 roster。

## 驗證方式

```bash
cd $HOME/projects/autopilot
git status --porcelain                                          # 空
git log --oneline -1                                            # 3faffd27
bash hooks/tests/pending-revocation-fold.test.sh | tail -1      # 63 passed, 0 failed
grep -c "strikes.jsonl" scripts/resolve-dispatch-topology.js    # 0
node scripts/check-supersession-anchors.js; echo $?             # 0
bash scripts/sync-codex-plugin-skills.sh --check; echo $?       # 0
```

## Read-order

1. 本檔「接手第一件事」整段。
2. `docs/plans/_archive/2026/09/evidence/2026-09-11-operator-pin-supersedes-qualification/d4-qc-panel.md`（PROBE B/C 的實跑輸出）。
3. `project/plans/_archive/2026/09/2026-09-11-operator-pin-supersedes-qualification.md` §2（KR1/KR3/KR4/KR11）與 §2.5（硬約束）。
4. `project/backlog/BACKLOG.md` 的 managed-campaign 那列與 L5-24h 那列。
5. `references/evidence-discipline.md` §32。

## B. Ongoing maintenance (was docs/projects/ongoing-maintenance/HANDOFF.md)

<!-- merged from docs/projects/ongoing-maintenance/HANDOFF.md; the original file's history is in git -->

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
- mods 計畫 `project/plans/2026-10-03-mods-visible-dispatch.md` 已凍結（G1、G2 皆 CONDITIONAL，depth-0 全數處置；依規則最多到 G2，不再開 G3）。凍結後有兩次有界修補：R4.1 回寫 owner 對 D1／D2 的裁決，R4.2 回寫 P0 spike 結果。凍結後又有 R4.3：P1a 出貨後更正「鎖的前提」二擇一 (ii) 的錯誤句（node 不會成為 `/proc/locks` 的 pid）。INDEX 列維持 `active`。
- P0 spike（`docs/plans/evidence/2026-10-03-mods-spikes/README.md`）：S1 yes（modules 與 classic 能共載，D4 結案）、S2 partial、S5(a) partial（desktop 這台跑不到）、S5(b) yes、S6 no（P2 要新寫量測儀器）、S3 yes、S4 no（owner 經 ssh 進 tmux，終端內圖片不可行）。depth-0 從原始檔複驗了 S1、S5(a)、S5(b)，並推翻計畫一處事實：`flock(1)` 是 fork 不是 exec，P1a 的鎖驗收不能拿 `/proc/locks` 的 pid 比 `writer.pid`；P1a 的 R4／R5 實測證實這一點（驗持有者要看 `writer.pid` 的 fd 9）。
- peer 備註：<host> 的 Q01 campaign 封存成 `review_station: panel`，因為 `in_rail_review: auto` 遇完整 panel 就解成 panel；支援的路線是 intake 前設 `single`（已寫進 l5 的 `hetero-impl-loop.md`）；已封存 campaign 的就地遷移登在 BACKLOG。
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
1. P1b：`scripts/render-review-page.js` 與 host review server（單一 port、只綁 127.0.0.1、根目錄索引），細節照計畫 R4.1。用 foreman-landing-pipeline：sonnet hands、互不相依的列平行、逐列 review、落地前一次 combined review。P1a 留下的 🔵 項目在 `project/backlog/mods-p1a-known-follow-ups.md`，P1b 動到 `runs-watch.js` 時順手處理。
2. owner 的工作環境是 ssh 進 tmux：任何「在終端裡顯示圖片」的設計都不適用，圖一律走瀏覽器 review 頁（反向代理）。
3. BACKLOG 已觸發的列（另加一列：被拒的 `AUTOPILOT_LIVE_DIR` override 會靜默落到真的 live dir）：plan-review 席位沒有 source 存取、plan-review roster 單一家族、import-aa 測試綁死主機、Population B flake。
4. peer 的列：review-fanout 有界並行、sealed-campaign review-station 遷移、plan-review terminal-ticket 可見性。
5. owner 排序才動：`project/plans/_archive/2026/10/2026-10-13-review-only-external-candidate.md`（該 plan 已出貨歸檔）。

## 協作
- fable = fleet `autopilot--claude-2`（claude-fable-5-1；起草 plan R0–R4）。
- astra = fleet `fleet-cli`，在 <host>（GPT-6-Astra；審過 R0／R1）；回覆會落在這台主機共用的 fleet-cli 收件匣，用 `fleet inbox --peek` 讀。
- hangar = `cookys/openclaw/hangar--claude`（fleet 設計者；cockpit 邊界建議在 fleet study）。
- 廣播到 `@cookys` 需要人在真 tty 跑 `fleet approve`；優先直接發送。

## 驗證方式
- `git status --short` 只剩那兩個不屬於本 session 的未追蹤目錄。
- `bash scripts/preflight-release.sh` 回報 v2.36.115 一致。
- `node scripts/check-backlog-entries.js --backlog project/backlog/BACKLOG.md` exit 0。
- `node scripts/check-plan-graduation.js --repo-root . --json` exit 0。

## Read-order
1. 本檔。
2. 凍結的計畫 `project/plans/2026-10-03-mods-visible-dispatch.md`。
3. `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/`（README、plan-review-g1、plan-review-g2、ADJUDICATION）。
4. `.claude/skills/foreman-landing-pipeline/SKILL.md`。
5. `references/evidence-discipline.md` §50–§52。

## 陷阱
- 這台 bwrap 不能巢狀；主機負載常在 40 左右，完整套件約 20 分鐘，兩個完整套件不能同時跑（oracle lock）。
- 作者 email 必須是 GitHub noreply 位址 `<email>`（形如 `<id>+<user>@users.noreply.github.com`，用 git log 查 owner 的提交），gmail 位址會被 push 拒收；clone 裡要設真身分。
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
