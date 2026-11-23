# PM 席省額度計畫的 replay 量測：同一批輸入量出每個開關 ON 和 OFF 的差

Status: 計畫 v1（待 plan review）；fleet 單 01M838P3WFXNM885HK3S6ZGSXP；PM 省額度計畫 01M8350QM7GTW20VH5YP2EAK0H 的量測方法。
出處：操作員 11-23 原話「你如果是要比量，每天的任務也不同，這樣比也沒意義吧？想辦法設計 replay 方式？」

## 1. 問題（不做會壞什麼）

用 S1 每天的數字前後比較，會被當天的工作量和工作種類干擾：某天操作員問的事多，加權成本就高，和哪個開關無關。
反例：S2 上線那天剛好有 3 個 patrol 風暴，成本上升，會被誤判成 S2 無效而關掉有效的開關；反過來，某開關上線那天剛好很安靜，會被誤判有效。
replay 把輸入固定，只改一個開關，差就只來自那個開關。

## 2. 語料（corpus）

- **切片單位**：一個「事件」＝一則進來的訊息（操作員、lane 結果、patrol、inbox 批次、stop-hook 回饋、task 通知）加上它引發的所有回合，直到下一則進來的訊息為止。
- **切片器**：新腳本 `scripts/pm-replay-slice.js`，輸入 PM 席的 session jsonl 目錄，輸出 fixture 目錄。邊界是「不是 tool_result 的 user 訊息」。類型用訊息頭固定規則判定（channel kind、wake、`[操作員]` 等），判不出的歸 `other` 並計數，不猜。
- **誰跑**：PM 席的 transcript 內容屬別席資料，讀取要操作員的卡。因此切片器由 PM 自己的帳號跑，只把 fixture 和 manifest 交出來；本席不讀原始 transcript。fixture 先過一次祕密掃描（金鑰、token、私有主機名），掃出就整段丟棄並記數。
- **抽樣**：依類型分層，30 段：operator 8、lane 結果 7、patrol 5、inbox 批次 5、stop-hook 回饋 3、task 通知 2；每層用固定種子抽。凍結：manifest 記每段的 sha256 和整批的 sha256，之後不改；要換批就換新 manifest 和新編號。
- **fixture 內容**：事件輸入文字、錄到的每一次工具呼叫（名稱、正規化參數、原始結果）、錄到的最終動作類別（accept、mark、comment、dispatch、answer、none）。

## 3. 重放（replay）

- **執行方式**：用 Claude Agent SDK 在 sandbox HOME 裡跑一席 PM：同模型、同一份 CLAUDE.md 和 memory 快照（凍結並記 sha）、同一版 plugin（ON/OFF 臂各釘自己的 commit）。
- **工具全 stub**：所有對外工具（fleet 各工具、卡片、git、Bash）由 SDK 自訂 tool 實作，不接真工具。查表鍵＝（工具名，正規化參數的 hash）；命中回錄到的原始結果；沒命中回一個標準化 stub（`{"stub":"no_recording"}`）並把該事件標「分歧」。絕不送出真訊息、不寫真 repo、不讀真的設定目錄。
- **負控制**：放一個「會呼叫真 fleet」的測試事件，確認 stub 層攔住且 fleet 端零訊息；沒攔住就整個 harness 不通過。
- **分歧事件**：計數並單獨報，不併入成本比較的分母；分歧超過 30% 的臂視為無效，回頭修 stub 覆蓋。

## 4. 每個開關的 ON/OFF

每個開關在同一批 fixture 上跑 ON 與 OFF，OFF 臂共用一次（基準臂），所以 N 個開關只要 N+1 個臂。比四項：

1. token 與加權成本（read 0.1、cache write 5m 1.25／1h 2.0、input 1、output 5，同 S1）；
2. 回合數；
3. 機械呼叫數（inbox 標記、task accept/comment/show、date、短回覆）；
4. 決策一致率：重放的最終動作類別與錄到的相同的事件比例，另列「工具呼叫序列相同」比例。不為省而亂裁：一致率比基準臂低超過 5 個百分點的開關不得上線，不論省多少。

| 開關 | 在 replay 裡怎麼切 |
|---|---|
| S2 失敗修正 | 臂釘含／不含 S2 的 plugin commit；失敗率與重試回合數 |
| S5b stop-hook 每回合最多一次 | `AUTOPILOT_STOP_ONCE` 1 對 0，stop-hook 回饋事件要重放 hook 輸入 |
| S4 courier 預濾、S5a 批次 | 發生在 PM 之前，replay 無法重跑它們；改為對 fixture 用規則判定「這個事件在 ON 下是否還會喚醒 PM」，只算被攔下的事件占比，報成「模擬」並標明（不當成實測成本） |
| S6 兩席拆分 | 兩個臂的事件路由不同：operator 事件到 PM-chat 臂（預填 context 100k），其餘到 PM-ops 臂（預填 300k）；比的是各事件的成本 |
| autocompact 視窗 | 見 §5 |

## 5. 長 session 效果的模擬：預填 context

autocompact 的效果要在 context 很長時才看得到。做法：每個臂在跑事件前，先把 context 預填到指定長度 L（150k、250k、350k、450k），預填內容是 PM 席 transcript 裡凍結的一段真實前綴（取自同一批 fixture 之前的回合，截到 L），並讓 prompt cache 先暖好（預填呼叫的成本不計入量測，另記）。之後在同一 L 下重放同一批事件，量每事件成本。這樣可以直接讀出「平均 context 從 300k 降到 150k」的實際加權成本差，不必等長 session。壓縮點本身（到 233k 觸發）用 L 掃描間接表示：成本對 L 的曲線，加上 PM 席實測的壓縮間隔（每 3.8 小時一次）估算整天的平均 L。

## 6. 成本上限與用哪個池

- 估算 [a]：一個事件在 300k context 約 1.5 回合、加權約 170k；30 個事件一臂約 5M。基準臂加 5 個開關臂共 6 臂約 30M，加 autocompact 4 個 L 約 20M，合計約 50M 加權單位，約為 PM 席 4 天基準（317M）的 16%，約 0.6 個 PM 日。
- 這比單日省下的量（目標 45% 約 36M/日）大，所以不能整批常跑：先做「篩選輪」12 個事件、只跑基準臂與有疑問的開關，約 15M；有疑問才擴到 30 個事件。完整輪一個計畫階段最多跑 1 次。
- **硬停損**：每輪預估成本寫進 manifest；實際累計超過預估的 150% 就停，整輪標廢，不續跑（付費批次要留餘裕，見記憶）。
- 用哪個池：不用 PM 席的池。用本席派的池引擎（同模型的席位，依 dispatch-hetero 的 pace-select 選），並在派前確認池有餘量；PM 席的額度是被省的對象，不拿來量。
- 若同模型在池裡跑不起來，退而求其次用小一級模型做 harness 的 dry run（只驗 stub 與一致率計算，成本不當成果），正式量測仍要同模型。

## 7. S1 每日數字的角色

S1 的每日列改成輔助：另算「每類事件的平均成本」（事件類型同 §2 的分類規則，同一支切片器邏輯），只用來看趨勢，不當判準。判準是 replay 的 ON/OFF 差加一致率。

## 8. 交付與日期

- 計畫凍結後才做 harness（`scripts/pm-replay-slice.js`、`scripts/pm-replay-run.js`、stub 層與測試）。
- harness 交便宜席實作，本席審；每個腳本附負控制（見 §3），變更記 CHANGELOG。
- 日期：計畫初稿 11-23；plan loop 最多 2 代，凍結 11-24；harness 11-26 完成；篩選輪 11-27 執行並交報告；上線日以 fleet 單的 next_evidence_due 為準。

## 9. 不做

- 不重放 courier 與 bus（S4、S5a 只做模擬判定）。
- 不用真工具、不送真訊息。
- 不改 PM 席的 prompt 來「配合」重放。
- 不把 replay 結果當唯一依據：S6 判定另看真實一週的 S1 列，兩者要方向一致才算過。
