- 建議門檻值：做法二到位後，交接點設 200k（底線上緣 95k 加工作空間約 100k），autocompact 留在 250k 當保險；做法二到位前照舊 compact，門檻先拉到 250k（若設定值是「窗口」再加 33k）。
- 能砍多少預載：砍不到 100k。照舊 compact 只能砍 22–29k（最大一筆是 Artifact 的 schema，約 12k）；改 /clear 加 resume 再省約 45–55k，底線從 137k 降到約 65–95k，兩者都做是 55–80k。
- 最佳替代做法：**建議做法二**（寫 handoff、/clear、`fleet pm resume`），但有三個上線條件：觸發不靠操作員按、handoff 原文帶上操作員最近的話與未完成事項、先用一次真的 /clear 量到第一回合不超過 95k。三項沒齊之前用做法一。

# PM 席壓縮底線評審（fable 席，依 PM 補件重評）

輸入：preload-inventory.md（PM session 40c62ccf，最後一次 compact 之後）、brief 與其「追加」一節。沒有讀其他檔，沒有看另外兩席的結果。行號指 inventory 的行。token 依補件改用字元數除以 3。

## 0. 先對帳：補件的分類還沒有把 137k 解釋完

實測第一回合用量 136,747（第 40 行）。把補件 (B) 的分類、它沒列到的兩塊加起來：

| 區塊 | 約 token（除以 3） | 來源 |
|---|---:|---|
| 補件 (B) 七項合計 | 56.9k | 19 加 11 加 7.5 加 5 加 3.6 加 3.2 加 7.6 |
| CLAUDE.md 兩份加 MEMORY.md 索引（補件沒列） | 15.1k | 第 12–14 列，共 45,235 字元 |
| system prompt 加 tool schema（補件沒列） | 40.3k | 第 42 行，9,473 加 111,568 字元 |
| 扣掉重複：prompt_snapshot 就是 system prompt | −3.2k | 第 43 行 |
| 可解釋合計 | 約 109k | |
| 仍未解釋 | 約 28k | 136,747 減 109k |

三點判斷：

1. 補件七項大多就是 inventory 表內原有的列，只是換成除以 3 重估，不是新找到的區塊。所以「50k 缺口」有一部分是原表除以 4 低估造成的，並不全是漏列。
2. 仍有約 28k 對不上。最有證據的候選是 compact 保留的對話尾段：摘要結尾（第 240 行）明寫「摘要之後的訊息是 compact 前最近的訊息，原文保留」，而補件的分類裡沒有任何一項是對話訊息。尾段實際多大：未查到，缺 rec 14154 請求本體裡 messages 陣列的逐則字元數。
3. hook 那一項可能重複計算。inventory 第 24 列是 rec 14140 與 14141 兩筆、內容截在 9,999 字元；兩筆各 9,999 加 restored-state 2,733 約等於補件的 22.5k。若 hook_success 與 hook_additional_context 是同一段文字記兩次，進 context 的只有一份，這項實際約 4.2k 而不是 7.5k，未解釋的部分就變成約 31k。哪一筆真的進了 context：未查到，同樣要看 rec 14154。

## 1. 逐項判斷（補件 C）

| 項目 | 約 token | 必要嗎 | /clear 加 resume 能省嗎 | 有沒有設定可關 | 誰決定 |
|---|---:|---|---|---|---|
| deferred_tools_record | 19k | 只有一部分必要。十個工具裡 Artifact 一個佔 64%（第 22 節 61,712 字元中的 39,462），約 12k；fleet 九個合計約 7k，PM 每輪都用 | 開頭全省。之後用到哪個才載回哪個：fleet 九個約 7k 會回來，Artifact 只有要發頁面時才回來 | `ENABLE_TOOL_SEARCH` 不能關：依我對這個設定的了解，關掉是把全部工具 schema 一開始就載入，會更大（本輸入無法驗證）。有效的是在 PM 席停用 Artifact、縮短 fleet 工具說明（dispatch 6,743、send 5,023、task_result 3,394 字元） | compact 後整包重注入是 harness 行為，動不了；載回的內容多大我們動得了 |
| skill_listing | 11k | 大半不必要。70 個 skill，PM 席用不到文件類、3D 類、Artifact 類 | 不能，每個 session 都載 | 在該席停用用不到的 plugin；縮 skill 說明。「改按需載入」的設定：未查到。清單字元上限的設定：未查到，缺 harness 設定文件 | 清單格式是 harness；裝哪些 plugin 是我們 |
| hook_success 加 hook_additional_context | 7.5k（可能實為 4.2k，見 0.3） | 未回訊息與 fleet 狀態必要（標明永不刪，第 795、807 行）；autopilot skill 介紹對 PM 席不必要；restored-state 必要 | 不能省 hook 本身（/clear 也會跑 SessionStart）；restored-state 由 resume 取代 | 是 autopilot 自己的 hook，可對 PM 席關掉介紹段，省 1–3k | 我們 |
| compact 摘要 | 5k | 做法一之下必要，是唯一的脈絡來源 | 全省，由 resume 內容取代 | 可用自訂指示縮短，但會丟掉操作員原話清單，不建議 | 內容由模型寫，格式是 harness |
| 還原檔案四個 | 3.6k | handoff 必要（約 0.9k）；design index 與兩個 memory 是碰巧最近讀過 | 全省 | 未查到有設定 | harness 依最近讀檔決定，動不了 |
| prompt_snapshot | 3.2k | 必要，就是 system prompt，而且與 system 那筆是同一份 | 不能 | 無 | harness |
| deferred_tools_delta、agent_listing、mcp_instructions | 7.6k | 部分必要 | 不能，每個 session 都載 | 拿掉 PM 席用不到的 MCP server（easel、plugin-authoring、文件連接器），三塊一起縮，約省 1–2k | 我們決定掛哪些 server |
| api-request-blob | 排除 | 同意排除，是請求本體的落地紀錄 | — | — | — |
| 補件沒列：CLAUDE.md 兩份加 MEMORY.md | 15.1k | 規則必要；MEMORY 索引可修 | 不能 | MEMORY 修到一半約省 2–3k；Global CLAUDE.md 要操作員的卡 | 我們 |
| 補件沒列：內建 tool schema | 約 37k | 未查到，缺 rec 14154 tools 陣列逐一名稱與大小 | 不能 | 可能可在該席禁用部分工具，省多少未查到 | 多數是 harness |
| 未解釋的約 28k（疑為保留尾段） | 28–31k | 做法一之下它保住操作員剛說的話，有用 | 若確實是尾段，全省 | 尾段大小的設定：未查到 | harness |

## 2. 第 (1) 題：能不能砍掉約 100k

不能。

- 留在 compact 這條路：Artifact 約 12k、skill 清單 4–6k、fleet 說明 2–3k、MEMORY 2–3k、hook 介紹段 1–3k、MCP 1–2k，合計 22–29k。這與 brief 說的「七項 15–25k」很可能重疊（我沒看到七項清單），不能相加；我判斷七項之外新增的主要是 Artifact 這 12k。
- 改走 /clear 加 resume：省掉摘要 5k、還原檔案 3.6k、重注入的 schema 淨省 12k（19k 減回載的 7k）、疑似尾段 28–31k，合計約 49–52k。
- 兩者都做：約 55–80k。離 100k 還差一截，差的是 system 加工具 40k 與 CLAUDE.md 15k 這兩塊動不了或要卡的底盤。

## 3. 第 (3) 題：做法一與做法二

### 底線

- 做法一（compact）：實測 100–150k，這次 136.7k。做完刪減約 108–115k。
- 做法二（/clear 加 resume）：每個 session 都有的部分合計約 79k（CLAUDE 與 MEMORY 15.1k、skill 11k、hook 約 5k、清單三項 7.6k、system 加工具 40.3k、零星 0.5k），加 resume 內容，加用到後回載的 fleet schema 7k。估 65–95k，中間值約 85–90k；做完刪減約 55–80k。這是推算，沒有實測；缺一次真的 /clear 後第一回合用量。

### resume 要多少 token

未查到。輸入裡沒有 `fleet pm resume` 的輸出或說明。可參考的只有現有交接檔 2,733 字元約 0.9k（第 16 列）。它若要補上做法二會遺失的東西（見下），我估要 3–8k；超過 10k 就失去意義，因為 compact 摘要也才 5k。

### 會遺失什麼

- 做法一：摘要沒寫到的細節。但保留三樣做法二沒有的東西：原文尾段、摘要第 6 節的「所有使用者訊息」逐句清單（第 165–203 行）、第 4 節的錯誤與操作員糾正清單（第 118–136 行）。
- 做法二：上面三樣全丟，除非寫進 handoff。另外還有：已載入的工具（要重新 ToolSearch）、已讀檔案的狀態、session 內掛的 cron（第 23 列是 compact 才帶過去的；/clear 後還在不在：未查到）、以 session id 命名的 scratchpad 與交接檔路徑（第 26、27 列；/clear 後 session id 變不變：未查到，若會變，resume 必須能找到上一個 id 的檔）。

### 多久做一次

次數由「門檻減底線」決定。同樣 200k 門檻：做法一可用 50–100k，做法二可用 105–135k，做法二的次數約為做法一的一半。換算成幾小時一次：未查到，缺 PM session 逐回合的用量序列（每回合 context 增量）。

### 失敗模式

| 情境 | 做法一 | 做法二 |
|---|---|---|
| 未讀或未回的 fleet 訊息 | 尾段與摘要第 7 節都帶著；SessionStart hook 另有「未回訊息」區塊 | 只剩 hook 的「未回訊息」區塊與 inbox 的未讀標記。已讀但還沒處理完的訊息會漏，handoff 必須逐則列出 |
| 進行中的子代理與背景工作 | 留在同一個 session，完成通知照收 | /clear 後背景子代理是否還在、通知送到哪：未查到。必須規定只有在沒有進行中的子代理與派工時才觸發；摘要裡的 workflow state 已有這兩個欄位（第 228–229 行），可以機械檢查 |
| 操作員剛說的話 | 原文尾段保住 | 會漏，除非 handoff 把最近幾則操作員訊息原文寫入，且規定有未回覆的操作員訊息時不觸發 |
| 交接內容寫錯或太薄 | 不適用 | 交接檔由模型在 context 最滿時寫，品質最差的時刻做最關鍵的事。這次摘要列了七條操作員抓到的錯，交接檔只有摘要的五分之一大 |
| 觸發卡住 | harness 自動，不會卡 | 送鍵失敗或 resume 沒跑，席位會停在空白 session；要有 autocompact 當保險，且 resume 失敗要報出來 |

### 觸發 /clear 需要什麼機制

- harness 有沒有「到門檻自動 /clear」的設定：未查到；就我所知自動的只有 autocompact。
- 模型自己不能執行 /clear（它是 CLI 內建指令，不是工具也不是 skill）。
- 所以只剩外部送鍵：由腳本看 context 用量，到交接點且符合上述閒置條件時，請模型寫 handoff，再由 hangar 的輸入 broker 對該 pane 送 `/clear`，新 session 的 SessionStart hook 自動跑 `fleet pm resume`。摘要提到 seat-fresh-restart 已修好、遠端經 hub 端 broker 送鍵（第 95 行），可重用。
- 兩個要先解的限制：broker 白名單要加這個鍵，由 hangar 維護，成員不能自己加；摘要第 201 行有「不對操作員的 pane 送鍵」的規則，PM 席的 pane 算不算操作員的 pane 要先釐清。若算，做法二就只能由操作員自己按，那就不該採用。

### 成本比較

| | 做法一 | 做法二 |
|---|---|---|
| 每次之後的底線 | 137k（刪減後約 110k） | 約 85k（刪減後約 65k） |
| 每次的固定花費 | 摘要回合讀整個 context，再重寫約 118k cache（第 40 行） | 寫 handoff 一回合，再重寫約 85k cache |
| 次數 | 基準 | 約一半 |
| 要新做的東西 | 無 | 觸發腳本、broker 白名單、handoff 格式擴充、resume 接到 SessionStart |
| 主要風險 | 底線太高，做沒幾步又 compact | 漏掉操作員的話與進行中的工作；觸發機制失靈 |

## 4. 第 (2) 題：門檻

公式：門檻 = 底線（取上緣）＋ 工作空間。工作空間取 100k：比底線小的話，每次重寫的 cache 比兩次壓縮之間做的事還多。

- 做法一，現況：150k ＋ 100k = **250k**。刪減落地、實測上緣降到 125k 後改 **225k**。
- 做法二：95k ＋ 100k = 195k，取 **200k** 當交接點；autocompact 設 250k 當保險，正常不該碰到。也就是做法二可以讓 200k 這個數字留著。

兩個未查到、會改變結論的條件：該模型超過 200k 是否有長 context 加價（有的話做法一的 250k 不成立，只能走做法二）；每小時巡查之間 cache 是否過期（過期的話每次喚醒都重付整個 context，底線低的做法二優勢更大）。前者缺計價表，後者缺巡查回合的 cache 讀寫比例。

## 5. 建議

建議做法二，分兩步：

1. 現在：做法一，門檻 250k，同時做刪減（先停用 PM 席的 Artifact，一項就約 12k）。都可逆，不需要新機制。
2. 做法二上線的三個條件，全過才切換：
   - 觸發全自動，不需要操作員按鍵；pane 送鍵規則已釐清。
   - handoff 原文帶最近的操作員訊息、已讀未處理的 fleet 訊息、進行中的單；且有子代理在跑或操作員訊息未回時不觸發。
   - 實測一次 /clear 加 resume 的第一回合用量不超過 95k。超過就代表推算錯了，省不到一半，不值得換。

若第一個條件過不了（只能操作員按），維持做法一。

## 6. 還缺的證據

1. rec 14154 的 messages 陣列逐則字元數與 tools 陣列逐一大小：確認 28k 是不是尾段、hook 是否重複計算、內建工具能省多少。
2. `fleet pm resume` 的實際輸出大小與內容。
3. 一次真的 /clear 後第一回合用量；/clear 後 session id、cron、背景子代理的實際行為。
4. PM session 逐回合用量序列與巡查回合的 cache 讀寫比例。
5. 該模型 200k 以上的計價。
6. 七項刪減的清單（判斷與本檔第 2 節重疊多少）。
