# 專案全貌框架（PM 計畫，2026-11-21）

操作員原話：「我覺得你應該把維持每個專案全貌這件事情當成一項完整任務大家才不會大海撈針? 我們可以怎樣做? 我一定是想到什麼說什麼；你或專案負責人或團隊應該告訴我已經有什麼建議怎麼做，或是需要重構之類的? 怎樣架構這樣的框架?」
操作員對方向的回覆：「方向對，先把 plan 寫好過 hetero loop review」。Ledger 81442df8。第三版：處理 r2 審查（fable 5.2、astra、grok 的共同阻擋意見，見 plans/evidence/project-full-picture/run-r2.out）。

## 1. 要解決的問題

- 操作員想到什麼就說什麼。PM 和各 lane 每次都要從 ledger、161 份以上的 plans 和程式碼裡重新翻找，才知道這件事做了沒有、做到哪裡。
- 實際發生過的失敗（回歸案例）：
  - F1：操作員要 Flash-Next 模型跑在 V100 主機，PM 把它跟 flashnext-sm120 搞混，因為沒有一份文件能查到「哪個名字是哪個專案、在哪台主機」（11-20）。
  - F2：openclaw 搬遷 v2 用整機 vzdump，PM 核准時沒對照到操作員之前說過「打包目錄」，結果 hub 卡死 4 小時（11-20 至 11-21）。
  - F3：fleet 沒有架構文件；開機接回席位的功能只有 hangar 一台有，沒有人知道它缺了什麼，結果多接回一個舊的 hangar--claude-2（11-21）。
  - F4：pane v7.4 交件只看截圖，三輪都不能操作，沒有人知道「互動」根本沒有驗收規格（11-18 至 11-21）。

## 2. 設計

三種紀錄，各有一個擁有者、一個位置：

| 紀錄 | 回答什麼 | 擁有者 | 位置 |
|---|---|---|---|
| 功能地圖 | 這個專案有什麼、在哪、怎麼驗收 | 該 repo 的 lane lead | 各 repo 的 `ARCHITECTURE.md` |
| 操作員約束 | 操作員講過的做法限制 | PM（操作員只對 PM 講話） | pm repo 的 `knowledge/constraints.md` |
| 工作狀態 | 現在誰在做、做到哪 | fleet tasks（唯一正本） | fleet |

地圖不記工作進度；約束不放在各 repo；hippo records 是歷史紀錄，intake 會搜尋，但不當成現況的依據。

### 2.1 功能地圖（ARCHITECTURE.md）

- 每個功能一列。所有 live、building、planned 列從第一天起都要填齊六個欄位，沒有「先填三欄」的過渡期：
  1. 名稱和別名（F1）。
  2. 狀態：live、building、planned、requested。
  3. 在哪裡：crate、目錄，或主機角色（不寫主機名稱）。
  4. 依據：plan path@sha，或 task id。building 列只寫 task id，進度由總覽從 fleet tasks 讀。
  5. 互動介面：無、CLI、TUI、web、語音、裝置 UI（F4）。
  6. 驗收方式：一條可以重跑的指令或腳本路徑。互動介面不是「無」的列，這裡必須是互動驗收腳本，例如按鍵腳本或點擊腳本，不能是截圖。
- requested 列只填三欄：名稱、intake 收據 id、操作員約束或原話的 ledger sha。
- 既有功能的回填：P4 期間，lane 標 `backfill` 的列有 7 天寬限；7 天後 lint 照一般規則擋。
- 地圖另外有三節：總架構圖、缺口清單、重構候選。

### 2.2 維持新鮮（機械檢查）

- **合併 gate**（autopilot 實作，裝在 pre-merge 和 finish-flow）。它檢查的是這次的 diff：
  - diff 改到的路徑，對照地圖每列的「在哪裡」，找出相關的列。找到相關的列，同一個 diff 就必須改到那一列；找不到任何相關的列，又新增了對外介面（新 CLI 子命令、MCP 工具、API 路由、systemd 單元），就必須新增一列。兩種情況沒做到就擋。
  - 改到的列六欄齊全；驗收方式指到的腳本或指令真的存在；互動介面不是「無」的列，驗收方式要是互動腳本。
  - 主機名稱 lint：用 /etc/lab/deny.txt 和 host-names.txt 掃地圖的 diff，有命中就擋。
- **每日漂移檢查**（autopilot 的 timer）：
  - fleet tasks 裡已完成的工作，地圖上找不到對應的列。
  - live 列的依據或驗收腳本不存在了。
  - requested 列連到的 task 已經完成，但這一列還沒改成 live。
  - intake 判定為「沒有」或「部分」、超過 24 小時，可是地圖上還沒有引用這張收據的 requested 列。

  去重規則：每個 repo 最多一張未結的漂移單，用「repo 加列名或 task id」當 key，新問題追加到同一張；只改文件的合併不算。

### 2.3 操作員約束（constraints）

- 寫入路徑：PM 記操作員原話一律用 `scripts/ledger.sh`。腳本加一個必填旗標：`--constraint "<適用範圍>::<禁止模式>"` 或 `--no-constraint`，兩個都沒給就拒寫。有 `--constraint` 的那一行，會同時追加到 `knowledge/constraints.md`，內容有：
  - ledger sha
  - 原話（主機名稱改寫成角色，沿用 ledger.sh 原本的掃描）
  - 適用範圍標籤，例如 migration、ui、gpu-slot
  - 一到多個禁止模式（regex），例如 `vzdump|整機備份|whole-VM`
  - 一句正向要求，例如「搬遷用目錄打包」
- F2 回填：「搬遷用目錄打包，不整機複製」這條，在 P1 一併寫進 constraints.md。

### 2.4 Intake（不靠記憶的三個掛點）

- **A：操作員訊息進 PM 席**。UserPromptSubmit hook 跑 `pm-intake`，搜尋地圖、約束、plans、ledger、fleet tasks。約束全部列出；其他命中只取前 10。命中結果塞進 context。
- **B：PM 回覆前**。Stop hook 檢查：回覆裡有建議或派工時，必須有一行判定（已經有／部分有／沒有／衝突），而且每個判定附一個證據（path@sha 或 task id）。判定是「已經有」或「部分有」時，還要附擁有 lane 的確認 task id；確認還沒回來，就寫「待確認 <task id>」。
  - 確認是機械化的：pm-intake 依命中的地圖列，自動派一張 XS 確認單給擁有的 lane，lane 回一行。
  - 每次判定記到 `log/intake.jsonl`，寫入前同樣過主機名稱掃描。
- **C：PM 下 go 前**（dispatch 帶 ruling、核准 lane 計畫、plan loop 結束）。PreToolUse hook 對計畫全文，加上 go 的內文，跑 `pm-intake --constraints`：
  - 適用範圍相符的約束，只要有一條的禁止模式命中計畫文字，就直接擋。要放行，只能在 go 裡寫 `override:<約束 sha>:<操作員原話或卡號>`。
  - 適用範圍相符、但禁止模式沒有命中的約束，go 裡要逐條寫「符合」或「不適用：<理由>」。少一條就擋。
  - 光貼收據 id 不能通過，hook 檢查的是內容。

### 2.5 全機隊總覽頁

- 由一支腳本讀所有地圖，加上 fleet tasks 的即時狀態，產生一頁 Artifact。timer 自動重建，網址固定。
- 輸出前過主機名稱掃描；地圖裡的主機角色照原樣顯示。

### 2.6 定期架構檢查

- autopilot 的 timer，每兩週對每個 repo 跑一次。由一個異質引擎讀地圖和程式碼，最多產出 5 條重構候選，成本上限照 capacity 的價目，超過就截斷並標「未完整」。
- 候選寫進地圖的「重構候選」節。PM 整理成建議給操作員，每條附推薦。

### 2.7 範本

`knowledge/templates/ARCHITECTURE.template.md`：六欄表頭、requested 列格式、三節、更新說明，附一份填好的範例。

## 3. 推動順序

| 步 | 內容 | 擁有者 | 依賴 |
|---|---|---|---|
| P1 | 範本、`pm-intake`（含自動確認單）、ledger.sh 的約束旗標、constraints.md 加 F2 回填、hook A/B/C、intake 回歸腳本、hook C 反向探針 | PM 派 sonnet 實作，PM 審 | 無 |
| P2 | fleet 第一份地圖（task 01M7XBN6） | fleet | 先寫，P1 完成後對齊格式 |
| P3 | 合併 gate、每日漂移 timer、兩週架構檢查 timer | autopilot | P1 範本 |
| P4 | hangar、autopilot、codeforge、alfred、hippo、capacity、gpu-line 各自出地圖 | 各 lane，全部平行 | P1 範本 |
| P5 | 總覽頁 | PM 派 sonnet | P2，加上 P4 至少三份 |

P1 和 P2 現在開；P3 和 P4 在範本出來後平行開。上線日：11-24。

## 4. 驗收（完成條件，全部達到才算完成）

1. **上線**：P1 到 P5 裝在正式環境：hook A、B、C 在 PM 席上，gate 和 timer 在 autopilot，總覽頁有固定網址。
2. **回歸**：`tests/intake-regression` 4 題全過，每題 1 分鐘內：
   - F1：命中 Flash-Next 模型和 flashnext-sm120 kernel 兩個不同的列。
   - F2：hook C 拿 v2 搬遷計畫（整機 vzdump）當輸入，因為約束的禁止模式命中而擋下。拿 v3（目錄打包）當輸入則放行。
   - F3：命中「開機接回註冊席位」，狀態是部分（building 或 planned），附 task id。
   - F4：pane 那一列的驗收方式是互動腳本；拿一個只附截圖的假 diff 跑 gate，會被擋。
3. **真實使用，可以複查**：操作員接下來 3 次提想法，每一次都要有：
   - intake 收據
   - 判定和證據
   - 擁有 lane 的確認單，已回覆
   
   之後由一個獨立的 haiku 複查員，在 24 小時後拿同一句原話重跑 intake，逐條核對證據是否存在、判定是否一致。3 次都一致才算通過；不一致的就當作缺陷修掉，再計一次。不用「操作員沒抱怨」當作證據。
4. **雜訊上限**：上線第一週，每個 repo 的漂移單每天追加不超過 3 次。
5. **量測（不擋上線）**：每週數一次操作員要重問或指出錯誤的次數，跟導入前一週比較。

## 5. 不做的事

- 不另外建中央資料庫；地圖和約束都是 markdown，跟著 repo 一起版本控制。
- PM 不寫各 repo 的地圖；PM 只負責範本、約束、intake 和總覽。
- pm repo 不寫主機事實；約束裡的原話照 ledger.sh 的規則，主機改寫成角色。

## 6. 風險

- 合併 gate 的「相關列」判斷太鬆或太嚴：先用路徑對照，加上對外介面的偵測；第一週只記錄，觀察誤擋率，再切成擋。誤擋率門檻是 5%。
- 禁止模式寫得太寬，誤擋正常計畫：可以 override，但要附操作員原話；每次 override 記一筆，每週檢視。
- 確認單太多，吵到 lane：同一個 lane、同一小時內的確認合併成一張。

## 7. r4 PM 裁定修正（gen 2 已達上限，PM 依規則裁定；本節優先於前面各節）

r3 gen 2 審查（run-r3.out）三家共同的阻擋意見，逐條處理如下。這一節和前面各節有衝突時，以這一節為準。

1. **F4 不設觀察期**：互動驗收規則從第一天起就擋，「第一週只記錄」只適用於 §2.2 的「相關列」路徑對照。互動驗收要能用機械判斷：
   - 驗收欄必須指到 `tests/interaction/` 底下的腳本。
   - finish-flow 交件時，會拿實際建出來的成品真的跑一次這支腳本，rc 不是 0 就擋。只檢查腳本存不存在不算通過。
2. **「在哪裡」一定要有 repo 路徑**：每一列至少要有一個 repo 內的路徑 glob，gate 靠它把 diff 對到對應的列。主機只寫角色 id，這個 id 對應 hangar inventory 的鍵。pm-intake 會唯讀讀取 hangar inventory 的索引，用來回答「在哪台主機」（F1）。主機名稱清單由 hangar 維護（/etc/lab/deny.txt），pm 的 host-names.txt 由 PM 維護。
3. **hook C 的範圍判斷改成機械式**：
   - constraints.md 開頭有一份固定的範圍字彙表，每個範圍標籤附一組關鍵字。計畫的範圍，就是它內文命中的標籤。
   - 觸發時機：PM 送出 dispatch、reply、task_comment，而且內容帶 ruling，或含「go、凍結、核准」；以及 open-decision close。
   - 計畫全文的來源：訊息裡引用的 path@sha 用 git show 讀出，再加上訊息本身。引用了卻讀不到，就擋。
4. **解除約束要有操作員本人的答覆**：override 必須附操作員的答覆 id，也就是卡片答覆，或 [待決回覆] 的訊息 id。hook 會檢查兩件事：這個 id 真的存在、來源是操作員；而且那張卡的問題裡，有寫到這條約束的 sha。PM 自己的話不算數。
5. **驗收改成量正確性**：
   - 「提想法」的定義：觸發 hook A，而且產生了判定的操作員訊息。
   - 上線後 7 天內的前 10 次 intake，全部由獨立的 haiku 複查員核對。判定是「沒有」的，複查員要用擴充關鍵字重搜一次，並另外問擁有的 lane「這有沒有」，三方要一致。10 次裡要有 9 次以上一致；不一致的每一次都當缺陷修掉。
   - §4.1 加一條：每份地圖對整個 repo 跑一次介面偵測，沒有對應到地圖的對外介面必須是 0 個。
6. **新想法一律有擁有者**：判定是「沒有」時，intake 的判定裡一定要寫擁有的 lane。如果沒有任何 lane 適合，requested 列先放在 pm repo 的 `knowledge/requested.md`，由 PM 擁有，指派出去之後再搬到對應的 repo。
7. **漂移檢查等地圖就緒才開**：某個 repo 的地圖第一次通過 lint、標記 map_ready 之後，那個 repo 的漂移 timer 才開始開單。在那之前不開單。
8. **跟其他文件的關係**：
   - 「有什麼」只以 ARCHITECTURE.md 為準。
   - README 只寫使用方式，並連到 ARCHITECTURE.md。
   - CLAUDE.md 的 Goal 區塊連到 ARCHITECTURE.md，不重複列功能狀態。
   - doc-sync 的決定性 gate 加一項檢查：README 和 CLAUDE.md 裡不可以有功能狀態表。
9. **日期拆成兩段，KR 不擋上線**：
   - 11-24 上線 P1、P3，以及 fleet 的地圖。
   - 11-28 其他 repo 的地圖全部就緒（P4），總覽頁上線（P5）。
   - §4 的驗收在上線後量測，量測結果不擋上線。
10. **P1 的分工**：
    - hook A、B、C 屬於 PM 席的 hook，由 autopilot 實作，跟 P3 同一張單。
    - pm repo 只做 pm-intake、ledger.sh 的約束旗標、constraints.md、requested.md、範本和回歸腳本，由 PM 派 sonnet 實作。

凍結：本計畫以加入本節後的 commit 為凍結版本。
