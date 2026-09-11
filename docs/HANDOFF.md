## 目標

實作 `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md` 的 P0 起全部階段。
**P0/P1/P2/P2b 已出貨**（v2.36.23–26，在 `origin/develop`）。**D4（plan P3）實作完成、未出貨**，
分支 `feat/d4-strike-fold-pending-revocation`，HEAD `3faffd27`，工作樹乾淨。

停在這裡是因為 context 到 T2（751k/1000k）。

## 接手第一件事：修一條已出貨的 admission 繞道（owner 2026-09-11 已裁示）

**這是最重要的一段，先讀完再動手。**

已出貨的 **v2.36.26 可以被繞過**。未 pin、且（a）完全沒有 scorecard row 或（b）ordinary strike
超過門檻的席位，只要餵一份 `--resolved-live` 文件，契約就回 `GO` + `assurance: operator-pin`，
並**憑空生出一筆 `operator_pin`**。兩份執行證據都在
`docs/plans/evidence/2026-09-11-operator-pin-supersedes-qualification/d4-qc-panel.md`。

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

繞道修完、D4 出貨之後做這個，不要平行開。細節在 `docs/BACKLOG.md` 的
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
cd /home/cookys/projects/autopilot
git status --porcelain                                          # 空
git log --oneline -1                                            # 3faffd27
bash hooks/tests/pending-revocation-fold.test.sh | tail -1      # 63 passed, 0 failed
grep -c "strikes.jsonl" scripts/resolve-dispatch-topology.js    # 0
node scripts/check-supersession-anchors.js; echo $?             # 0
bash scripts/sync-codex-plugin-skills.sh --check; echo $?       # 0
```

## Read-order

1. 本檔「接手第一件事」整段。
2. `docs/plans/evidence/2026-09-11-operator-pin-supersedes-qualification/d4-qc-panel.md`（PROBE B/C 的實跑輸出）。
3. `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md` §2（KR1/KR3/KR4/KR11）與 §2.5（硬約束）。
4. `docs/BACKLOG.md` 的 managed-campaign 那列與 L5-24h 那列。
5. `references/evidence-discipline.md` §32。
