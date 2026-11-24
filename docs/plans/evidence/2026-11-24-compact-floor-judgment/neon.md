建議門檻值：建議採做法二，於 **220k** 觸發主動交接與 `/clear`（完成設定瘦身後可維持 **200k–220k**），並同步把自動 compact 保底門檻調高至 **280k–300k**（瘦身後 **260k–280k**）承接夜間無人值守時段；若只採做法一（照舊 compact），門檻須設在 **300k**（瘦身後 **260k–280k**），不可設 200k。
能砍多少預載：在 compact 路線下**不可能砍掉 100k**，可控設定與 hook 瘦身實際約省 **21k–28.5k**（若禁止 PM 席自行載入 `Artifact` 工具，上限約 **33k–41k**）；唯有改走「`/clear` + `fleet pm resume` + 設定瘦身」才能把起手底線從 136.7k 壓至約 **45k–65k**（總降幅約 **70k–90k**，須一次 `/clear` 實測驗證）。
建議做法與最佳替代做法：**建議做法二（到門檻時寫 handoff、`/clear`、用 `fleet pm resume` 拉回狀態）為主，搭配調高自動 compact 門檻作為無人值守安全網**；並輔以「PM 席不直接載入 `Artifact` 等重 schema 工具（改派子代理或他席發佈）」與精簡 `SessionStart` hook／`fleet` MCP 工具描述，以同時避開 compact 震盪與每輪週額度暴燒。

---

# PM 席壓縮門檻與預載減量獨立評審（neon）

- 評審席位：`neon`
- 任務編號：`Fleet-Task: 01M85PYJ3SEDZNT1DDWDGJCMEC`
- 唯一輸入依據：`preload-inventory.md`（PM 對話 `40c62ccf`，`compact_boundary` 位於 `rec 14120`、`isCompactSummary` 位於 `rec 14125`、壓縮後首則 assistant 位於 `rec 14291`，實測總計 **136,747 token**：`input_tokens` 2 + `cache_read` 18,628 + `cache_creation` 118,117）與任務補充之 PM 實測分類。

---

## 一、能不能砍掉約 100k 預載？逐塊對帳與可控性盤點

### 1.1 總結論：compact 路線不可能砍掉 100k，且須先釐清 50k 缺口的重複計算問題

在開始逐塊估省幅前，必須先指出一個關鍵帳面問題：**補件 (B) 從 compact 邊界後抽出的 7 類項目（合計 56.9k token，以字元除以 3 估）與 `preload-inventory.md` §1 原本量到的 48.3k 表格高度重疊**，並非「原本 48k 以外多出來的另一塊獨立 50k」。

將兩份數據去重後與實測 **136,747 token** 對帳如下：

| 歸類區塊 | `preload-inventory.md` 量測 | PM 補件 (B) 量測（字元/3） | 去重後合理估計 | 說明 |
|---|---:|---:|---:|---|
| 系統提示詞（`prompt_snapshot`） | 9,238 字元（2.3k，`/4`） | 9.6k 字元（3.2k） | **~3.2k** | 與 `api-request-shape` 的 `system`（9,473 字元）為同一塊 |
| 內建工具定義（`api-request-shape` 的 `tools`） | `tools` 全體 111,568 字元 JSON（約 28k，`/4`） | 未單獨列出 | **~15k–35k** | 是否已包含下方 `deferred_tools_record` 10 個工具：**未查到** |
| 全域／專案 `CLAUDE.md` + `MEMORY.md` 索引 | 45,235 字元（11.3k，`/4`） | 未重複列入 | **~13k–15k** | 含大量正體中文與符號，實際 token 高於 `/4` |
| 小型 harness 系統紀錄（9 項） | 2,334 字元（0.65k） | 未重複列入 | **~0.7k** | 日期、環境、模型、語言、排程續帶等 |
| `deferred_tools_record`（10 個完整工具 schema） | 61,712 字元（15.4k，`/4`） | 57.9k 字元（19k） | **~19k** | **`Artifact` 單一工具佔約 38k–40k 字元（約六成）**，其餘 9 個為 `mcp__fleet__*` |
| `skill_listing`（70 個 skills） | 29,286 字元（7.3k，`/4`） | 33.1k 字元（11k） | **~11k** | 含 34 個 autopilot、6 個 distill、13 個 `anthropic-skills` 等 |
| `hook_success` + `hook_additional_context` | `session-start.js` 截斷在 9,999 字元（2.5k） | 22.5k 字元（7.5k） | **~7.5k** | 內含技能介紹表、48 則未回訊息、45 次巡查喚醒、67 行 RED 項目 |
| `compact 摘要`（`isCompactSummary`） | 14,616 字元（3.7k，`/4`） | 14.8k 字元（5k） | **~5k** | 壓縮時由模型產生 |
| 還原檔案 4 個（`design/index.html`、2 份記憶檔、handoff） | 8,738 字元（2.6k） | 10.7k 字元（3.6k） | **~3.6k** | 含 1 筆僅路徑參照之 `design-d-neon.html` |
| `deferred_tools_delta` + `agent_listing` + `mcp_instructions` | 19,201 字元（4.8k，`/4`） | 合計約 7.6k | **~7.6k** | 延遲工具目錄、11 個代理類型、5 組 MCP 伺服器說明 |
| `api-request-blob`（116 筆 284k 字元） | 列為排除的記帳紀錄 | 確認為請求本體落地紀錄 | **0（排除）** | 不計入額外注入之 context |
| **已歸類去重合計** | — | — | **~85.6k–102.4k** | 視 `deferred_tools_record` 與 `tools` 是否重疊而定 |
| **尚未對上之殘差缺口** | — | — | **~34k–51k** | 實測 136,747 扣除已歸類合計 |

**關於剩餘 34k–51k 缺口，目前「未查到」確切構成，不作猜測；已知線索與缺失證據如下：**
1. **compact 保留的原文對話尾段大小：未查到。** `rec 14125` 結尾明確說明摘要之後保留壓縮前最後幾則原文訊息，但量測檔與補件皆未列出實際保留則數與字元／token 數。
2. **`rec 14121`（`data-flow-records`，130k 字元）是否真的送進 API 請求：未查到。** `preload-inventory.md` §2 一處將其列為排除的記帳紀錄，另一處又備註其可能計入首輪 `usage`；若送入 API，單項即達 ~32k–43k token，幾乎正好對應缺口。
3. **`deferred_tools_record` 與 `api-request-shape` 的 `tools`（111.6k JSON）是否重疊：未查到。**
4. **實際分詞器與粗估係數偏差：未查到精確值。** 內容含大量正體中文（常為 1–1.5 字元/token，低於 `/3`）、26 碼任務編號與密集 JSON 結構，可能造成 10k–20k 估算落差。
- **補齊缺口所需證據**：從 `rec 14291` 對應的那筆實際送出 API 請求的 `api-request-blob`，分別擷取 `system`、`tools`（逐工具名對帳）與 `messages`（逐則標出 `isCompactSummary`、hook 附件與摘要後原文尾段），再以官方 `count_tokens` 介面逐塊計算。

**結論**：即便不算那 34k–51k 殘差，光是不可移除的系統提示詞、內建工具定義、基礎指令檔與內建技能／代理清單就超過 35k–45k。因此在 compact 路線下**不可能砍掉 100k**；可控設定瘦身實際只能砍 **21k–28.5k**（若再配合紀律禁止 PM 席自行載入 `Artifact` 工具，最多砍 **33k–41k**）。

---

### 1.2 補件 (B)(C) 逐項判斷表與其他基礎預載減量

下表先針對補件 (B) 列出的每一項逐一回答「是否必要、`/clear` + `resume` 能否直接省掉、有無設定可關、能省多少」，再補列量測檔內的基礎指令與記憶檔。

| 項目（實測估量） | 是否必要 | `/clear` + `resume` 能否直接省掉 | 有沒有設定可以關掉 | 做法一（compact）可砍多少 |
|---|---|---|---|---|
| **1. `deferred_tools_record`**（57.9k 字元，約 **19k**） | **部分必要**。10 個工具裡，9 個 `mcp__fleet__*`（約 20k 字元）是 PM 派單與回覆的核心；但 **`Artifact` 單一工具佔約 38k–40k 字元（約 12k–13k token）**，對 PM 並非每輪必要，僅因本對話曾用過一次發佈設計稿就被永久鎖進壓縮後 context。 | **大部可省（預期淨省 ~15k–16k）**。`/clear` 會清空已展開工具清單，新對話不必背著 `Artifact` 的 12k–13k 大 schema；僅在實際需要時透過 `ToolSearch` 按需載入 4–6 個核心 `mcp__fleet__*` 工具（瘦身後僅約 3k–4k）。*註：輸入檔無 `/clear` 後實測，須一次實測確認清空行為。* | **`ENABLE_TOOL_SEARCH` 不可關閉！** 量測檔 `MEMORY.md` 第 554 行明確記載 `ENABLE_TOOL_SEARCH=false` 會關閉延遲載入（僅為避開 vLLM 500 錯誤），關掉反而會把全部延遲工具一次全塞進 context，讓底線暴增。至於「壓縮時重置已展開延遲工具」或「手動卸載單一工具」的設定：**未查到**。 | **3k–4k**（瘦身自維護 `fleet` 專案 `plugins/lib/tools/tools.ts` 中重複貼上的 `fyi`、`attachments` 長篇描述）。若改由工作紀律禁止 PM 席呼叫 `Artifact`（改派子代理或他席發佈），可再避開 **12k–13k**。 |
| **2. `skill_listing`**（33.1k 字元，約 **11k**，70 個 skills） | **多數對 PM 席不必要**。內含大量寫碼工作線專用技能（如 `debug`、`profiling`、`dev-flow`、`finish-flow`、`test-strategy`、`onboard`、`engine-onboarding`、`img2threejs`、`site-narrative-audit`、13 個 `anthropic-skills` 等），PM 席只常用少數治理與交接類技能。 | **不能直接省掉**。`skill_listing` 每次對話必載，`/clear` 後仍會重新載入全部已安裝技能的名稱與描述。 | 「將 `skill_listing` 改為連名稱描述都不預載的按需載入」設定：**未查到**（`SKILL.md` 本體已是按需載入，但清單本身由 harness 掃描已啟用外掛注入）。可控手段是為 PM 席建立精簡外掛與技能設定，停用不用的外掛與個人技能（例如 `img2threejs`、`autopilot-distill-skills`、`anthropic-skills` 與非 PM 用的 autopilot 技能），並縮短自維護技能的 `description`。 | **5k–7k**（移除 PM 席非必要外掛／技能並縮短自維護描述；harness 內建技能如 `artifact-*`、`code-review`、`claude-api`、`update-config` 動不了，估留 ~3k–4k）。 |
| **3. `hook_success` + `hook_additional_context`**（22.5k 字元，約 **7.5k**） | **僅極小部分必要，現況嚴重膨脹**。實測內含：(a) 與 `skill_listing` 重複的 autopilot 技能對照表；(b) 45 次巡查喚醒與 48 則未回訊息摘要（仍截斷省略 181 則）；(c) **約 67 行 RED `Operator initiatives`**，塞滿陳年 `no_task` 與 20 餘筆 `stale_24h` 孤兒任務，撞到 9,999 字元硬截斷！ | **可省去大部分（約省 ~6k–7k）**。`/clear` 不會觸發 `SessionStart:compact` 專屬的冗餘恢復塊（但 `SessionStart` 本身仍會跑，須同步修改自維護 `session-start.js`，避免在 `clear` 時注入技能表與 RED 全表）。 | **完全由我們自己的 hook 程式碼控制**（`autopilot` 的 `src/hooks/handlers/session-start.js` 與 `~/.claude` hooks 設定；註：修改 `~/.claude` 須依紅線走操作員卡片）。直接刪掉重複的技能介紹表，並把 RED 清單與未讀訊息改為只輸出 3 行計數提醒「請跑 `fleet pm resume`」。 | **6.5k–7k**（壓到 0.5k–1k 以內，是最立竿見影、零副作用的減量項）。 |
| **4. `compact 摘要`**（14.8k 字元，約 **5k**） | **在做法一下必要，在做法二下不必要**。它是壓縮後唯一保留早期對話脈絡的摘要。 | **可以直接省掉（全省 ~5k）**。改以精簡 handoff（~1k–2k）搭配外部單一真相來源的 `fleet pm resume` 取代。 | 壓縮摘要字數上限或關閉摘要的設定：**未查到**（屬 harness compact 內建流程）。 | **0k**（做法一下動不了，硬縮會損及工作記憶）。 |
| **5. 還原檔案 4 個**（10.7k 字元，約 **3.6k**） | **多數不必要**。本次塞回了與後續無關的 `design/index.html`（2.5k 字元）及 2 份單次讀過的記憶檔（3.4k 字元）；僅 handoff 檔（2.7k 字元）在交接時有用。 | **可以直接省掉（全省 ~3.6k）**。`/clear` 不會自動把舊對話讀過的檔案塞回 context（handoff 改由 resume 流程主動精簡讀取）。 | 關閉 harness 自動還原 compact 前讀過檔案的設定：**未查到**。僅 autopilot 自己產出的 handoff 檔可由我們精簡（原本僅 ~0.9k token，空間有限）。 | **~0.3k–0.5k**（幾乎動不了，除 handoff 略為精簡外其餘屬 harness 行為）。 |
| **6. `prompt_snapshot`**（9.6k 字元，約 **3.2k**） | **必要**（harness 系統提示詞）。 | **不能省掉**（每次對話必載）。 | 無使用者設定可關（屬 harness 核心）。 | **0k**。 |
| **7a. `deferred_tools_delta`**（延遲工具目錄，8.1k 字元，約 **2.0k–2.7k**） | **部分必要**。28 個內建延遲工具屬 harness；但另掛了 14 個 `claude.ai` 連接器（`Claude_Docs`、`Gmail`、`Google_Calendar`、`Google_Drive`）、`easel`、`plugin-authoring` 與 23 個 `fleet` 工具。 | **不能靠 `/clear` 直接省掉**（每次對話必載）。 | 可在 PM 席設定中停用不需要的 MCP 伺服器與雲端連接器（`easel`、`plugin-authoring`、無須直連的雲端連接器）；內建延遲工具目錄不可關。 | **0.8k–1.2k**。 |
| **7b. `agent_listing`**（5.9k 字元，約 **1.5k–2.0k**） | **部分必要**。內建 7 個代理（其中 `web-fetch` 與 `claude-code-guide` 說明極長）屬 harness；我們自帶 4 個 `autopilot:*`（含誤被當成代理載入的 `autopilot:README`）。 | **不能靠 `/clear` 直接省掉**（每次對話必載）。 | 內建代理類型不可關；自維護的 `autopilot/agents/` 可移除誤載的 `README.md` 並精簡 PM 席不需要的代理定義。 | **~0.5k**。 |
| **7c. `mcp_instructions`**（5.2k 字元，約 **1.3k–1.7k**） | **部分必要**。`## fleet` 說明約 3k 字元，與工具描述及 `fleet-usage` 大量重複；`## claude.ai Claude Docs` 單段約 1.6k 字元，若 PM 不用即可移掉。 | **不能靠 `/clear` 直接省掉**（每次對話必載）。 | 我們可改 `fleet` 的 `plugins/lib/tools/tools.ts` 精簡 `## fleet` 指令，並在 PM 席停用不需要的 MCP 伺服器／連接器。 | **1.2k–1.8k**。 |
| **（排除項）`api-request-blob`**（116 筆 284k 字元） | 非額外注入之 context，僅為紀錄檔內的請求本體落地紀錄。 | 不適用（不計入 context）。 | 不適用。 | **0k（不計）**。 |
| **（補列基礎預載）全域／專案 `CLAUDE.md` + `MEMORY.md` 索引**（45.2k 字元，約 **11.3k–15k**） | **核心規則必要，但嚴重超載**。全域 `CLAUDE.md`（21.2k 字元）含整份長授權表；`MEMORY.md`（17.5k 字元）掛了約 100 條記憶索引，不少已是過期指標或應由腳本／作業程序承接的規則。 | **不能靠 `/clear` 直接省掉**（每次對話必載）。 | 完全由我們自己維護。依全域規則「14 天沒抓到真問題或已機械化者刪除／外移至按需參考檔」，可把 `MEMORY.md` 壓半、把全域授權表細則外移並保留索引。 | **4k–7k**。 |
| **（補列殘差）compact 原文尾段／`data-flow-records` 等未歸類缺口**（**~34k–51k**） | 在做法一下為 harness 保留行為；在做法二下由 handoff + 外部任務系統取代。 | **預期可省去大部分（約 ~30k–50k，視實測而定）**。`/clear` 清空對話歷史，不再攜帶原文尾段。*註：因缺口構成「未查到」，實際省幅須一次 `/clear` 實測確認。* | 調整 compact 保留尾段長度的設定：**未查到**。 | **0k**（做法一下動不了）。 |

**加總小結**：
- **做法一（照舊 compact）可控總減量**：`3k–4k`（fleet 工具 schema）+ `5k–7k`（技能清單）+ `6.5k–7k`（hooks）+ `2.5k–3.5k`（目錄／代理／MCP 說明）+ `4k–7k`（`CLAUDE.md`／`MEMORY.md`）= **21k–28.5k token**（若嚴格禁止 PM 席呼叫 `Artifact`，再多避開 12k–13k，上限 **33k–41k**）。
- **做法二（`/clear` + `fleet pm resume` + 設定瘦身）總減量**：上述可控瘦身（排除重疊之 compact hook）＋甩掉 `Artifact` 等已展開大工具（淨省 ~15k–16k）＋甩掉 `compact 摘要`（~5k）＋甩掉 4 個還原檔案（~3.6k）＋甩掉 compact 尾段／累積紀錄（推估 ~30k–50k）＝ 相較 136.7k 實測底線**總計可壓低約 70k–90k**（起手底線降至 **~45k–65k**）。

---

### 1.3 權責切分：哪些是 harness 決定（動不了）vs 哪些是我們可控制的

**一、harness 決定、我們動不了的部分**
1. **系統提示詞（`prompt_snapshot`，~3.2k）與內建非延遲工具定義（約 ~15k–28k）**：由 Claude Code 本體與介面層固定注入。
2. **內建延遲工具目錄與內建技能／代理類型**：28 個內建延遲工具、`artifact-*`／`code-review`／`simplify`／`claude-api`／`update-config` 等內建技能，以及 `web-fetch`／`claude-code-guide`／`Explore`／`Plan` 等內建代理說明。
3. **內建延遲工具的完整 schema 大小與 compact 後重注入行為**：例如 `Artifact` 工具單一 schema 高達 ~38k–40k 字元，且 compact 後會自動把先前用 `ToolSearch` 載入過的全部工具重新注入；目前**未查到**卸載單一工具或 compact 時自動重置工具清單的設定。
4. **compact 流程本身產生的狀態**：`isCompactSummary`（~5k）、compact 保留的原文對話尾段長度、compact 後自動還原先前讀過的 4 個檔案（不含自寫 handoff），以及 `data-flow-records`（130k 字元，若確有計入 API 請求）的保留策略，目前均**未查到**可調設定。
5. **小型 harness 系統紀錄（~0.7k）**：`session_context`、日期、環境快照、模型身分、語言、顧問工具狀態、憑證組織紀錄、遠端對話紀錄。
6. **`skill_listing` 的注入機制**：harness 啟動時必定列出所有已啟用技能的名稱與描述，目前**未查到**「僅按需查詢、不預先列出清單」的開關。

**二、我們可以控制的部分**
1. **自維護 hooks（最肥、最好砍）**：`autopilot` 的 `src/hooks/handlers/session-start.js` 與 fleet 狀態注入邏輯（砍掉重複技能表、45 次巡查喚醒、67 行陳年 RED 項目，立省 ~6.5k–7k）。
2. **全域／專案 `CLAUDE.md` 與 `MEMORY.md` 索引**：刪除已機械化／過期記憶、把長授權表細則外移（省 ~4k–7k）。
3. **PM 席啟用的外掛、技能與 MCP 連接器清單**：卸載／停用 PM 席不用的寫碼技能、個人技能（如 `img2threejs`、`autopilot-distill-skills`）與非必要 MCP／雲端連接器（`easel`、`plugin-authoring`、`Claude Docs`、`Gmail` 等），並修掉誤載的 `autopilot:README`（省 ~7k–10k）。
4. **自維護 `fleet` MCP 工具定義與伺服器說明**：精簡 `fleet` 的 `plugins/lib/tools/tools.ts` 中重複的 `fyi`／`attachments` 說明與過長 `## fleet` 指令（省 ~4k–5.5k）。
5. **PM 席工具使用紀律**：不在 PM 主席直接載入 `Artifact` 等超大型單次工具（改派子代理或他席發佈），避免污染長壽對話。
6. **對話生命週期策略**：選擇在門檻時做 `/clear` + `fleet pm resume`（甩掉 compact 累積膨脹）而非硬撐同一長壽對話。

---

## 二、現實底線下，門檻該設多少？（底線＋工作空間公式）

### 2.1 公式與工作空間依據

$$\text{觸發門檻 } T = X_{\text{floor}} + W_{\text{work}}$$

- **$X_{\text{floor}}$（重置後底線）**：compact 或 `/clear` + `resume` 後，PM 席進入可工作狀態的首輪 context 實測值（單位：k token）。
- **$W_{\text{work}}$（淨工作空間）**：兩次重置之間，讓 PM 席完成一個有意義工作週期而不陷入「頻繁重置震盪」的空間（單位：k token）。
  - 依 `preload-inventory.md` 中 PM 的工作型態：每小時 1 次固定巡查（`cron: 7 * * * *`，查收件匣、跑 `patrol-classify.py`、驗收、彙整留言、回報操作員，單次估耗 **15k–30k**）加上即時 fleet 訊息與操作員互動（每則互動含查單與回覆估耗 **2k–5k**）。
  - **最低可用工作空間 $W_{\min} = 120\text{k}$**（約撐 3–4 小時常規巡查＋互動；低於 100k 時，一場密集排錯或兩次巡查就撞線）。
  - **合理目標工作空間 $W_{\text{target}} = 150\text{k}$**（約撐 4–6 小時，兼顧不震盪與控制 Opus 5.5 每輪 `cache_read` 成本）。

> **重要邊界聲明（席位視窗上限未查到）**：`preload-inventory.md` 僅記載模型為 `claude-opus-5-5`，**未查到**該席位實際啟用的 context 視窗上限（200k 或 1M）。題目討論門檻是否應高於 200k，隱含席位上限大於 200k（多半為 1M 視窗）；以下主表以大視窗（遠高於 300k + 安全緩衝 50k）代入，文末另附「若實際上限僅 200k」的退路。

### 2.2 代入數字比較表

| 方案與情境 | 重置後底線 $X_{\text{floor}}$ | 目標工作空間 $W_{\text{work}}$ | 公式計算 $T = X_{\text{floor}} + W_{\text{work}}$ | 建議設定門檻 | 區間內平均每輪 context（$\frac{X+T}{2}$） |
|---|---:|---:|---|---:|---:|
| **反例：現行 200k（做法一未瘦身）** | 137k（最壞 150k） | 僅剩 50k–63k（不足） | $137\text{k} + 63\text{k} = 200\text{k}$ | **不可用**（1–2 小時即震盪） | 168.5k（且頻繁付 118k `cache_creation`） |
| **做法一（照舊 compact，未瘦身）** | 137k（最壞 150k） | 150k（最低 120k） | $137\text{k} + 150\text{k} = 287\text{k}$；最壞 $150\text{k} + 150\text{k} = 300\text{k}$（最低 $137\text{k}+120\text{k}=257\text{k}$） | **300k**（保底區間 280k–300k） | **218.5k / 輪** |
| **做法一（照舊 compact，完成可控瘦身）** | ~112k（95k–125k） | 150k | $112\text{k} + 150\text{k} = 262\text{k}$（保守 $125\text{k} + 150\text{k} = 275\text{k}$） | **260k–280k** | **191k / 輪** |
| **做法二（`/clear` + `resume`，未瘦身）** | ~70k（58k–85k） | 150k | $70\text{k} + 150\text{k} = 220\text{k}$（保守 $85\text{k} + 150\text{k} = 235\text{k}$） | **220k–235k** | **145k / 輪** |
| **做法二（`/clear` + `resume`，完成瘦身，推薦）** | ~55k（45k–65k） | 150k–165k | $55\text{k} + 150\text{k} = 205\text{k}$；保守 $65\text{k} + 150\text{k} = 215\text{k}$ | **220k**（瘦身後可穩壓 **200k–220k**） | **137.5k / 輪** |

### 2.3 門檻決策的關鍵額度效應

`preload-inventory.md` 的 handoff 明確記錄：**主帳號池週額度已用 93%，PM 單席就佔全隊燒量的 44%**。
- 若只採做法一並把門檻拉高到 **300k**，雖然解決了「做沒幾步又 compact」，但 PM 席平均每輪背著 **218.5k** 上下文跑 Opus 5.5。
- 若改採做法二（門檻 **220k**、瘦身後底線 ~55k），可用工作空間（**165k**）與 300k compact（**163k**）幾乎一樣大，但每輪平均上下文降至 **137.5k** —— **做法一比做法二每輪多背約 59% 的上下文**，也更容易在 250k–300k 高水位出現長上下文注意力退化（本次壓縮前摘要第 4 節已列出 7 件操作員抓到的重複問卡、未查面板就誤報等失誤）。
- **若該席位實際上限僅為 200k（未查到）**：則 300k 門檻根本無法設定，做法一在數學上無解（$200\text{k} - 137\text{k} - \text{緩衝 } 20\text{k} = 43\text{k}$）；唯有做法二（底線壓至 55k，門檻設 180k，留 125k 工作空間 + 20k 緩衝）可行。

---

## 三、做法一 vs 做法二具體比較（依補件 A）

- **做法一**：照舊 compact（僅調高門檻至 300k／瘦身後 260k–280k）。
- **做法二**：PM 席到門檻（220k）時不做 compact，改「寫 handoff、`/clear`、用 `fleet pm resume` 拉回狀態」，同時把自動 compact 門檻調至 280k–300k 作為無人值守安全網。

### 3.1 五大維度逐項對照

| 比較項目 | 做法一：照舊 compact | 做法二：寫 handoff + `/clear` + `fleet pm resume` |
|---|---|---|
| **1. 重置後底線是多少 k** | 未瘦身實測 **100k–150k**（本次 **136.7k**）；完成可控瘦身後預估 **~95k–125k**（以本次計約 **108k–116k**）。長壽對話一旦多叫幾個工具，底線只升不降。 | `/clear` 裸起手預估未瘦身 **50k–67k**、瘦身後 **35k–50k**；加上 handoff + `fleet pm resume` + 按需載入 4–6 個瘦身後 `mcp__fleet__*` 工具，**可工作底線約 58k–85k（未瘦身）／45k–65k（瘦身後）**。*註：無 `/clear` 實測 `usage`，此為依常駐區塊推算值，須實測確認。* |
| **2. 會遺失哪些資訊** | (1) 早於保留尾段的精確對話細節、完整錯誤訊息與工具輸出（被壓進 ~14.8k 摘要）；(2) compact 邊界前後送達的 fleet 訊息（hook 明確警告可能不在 context，本次有 48 則未回且截斷 181 則）；(3) 摘要看不到尾段，易產生「以為還沒做、其實已做完」的狀態錯覺；(4) 跨多輪 compact 後，未寫進 `MEMORY.md`／帳本的口頭細則會逐次稀釋。<br>*相對保留*：最近數輪原文尾段、剛讀過的 4 個檔案、排程續帶（每小時巡查 `94c6f5db`）。 | (1) **全部原文對話尾段**（含操作員最近幾輪口氣、未即時落盤的口頭指令）；(2) **限本對話的排程任務**（`CronCreate` 建的每小時巡查 `94c6f5db` 在 `/clear` 後是否保留：**未查到**，依其僅存於本對話的定義極可能消失，resume 時須自動檢查並重掛）；(3) 剛讀過但沒寫進 handoff 的暫存檔／草稿；(4) 執行中的同程序 `Agent` 子代理狀態；(5) 先前用 `ToolSearch` 展開的工具 schema（此點反而是省 token 優點）。<br>*不會遺失*：所有已入外部單一真相來源的工作狀態（fleet 任務、`open-decision.js`、帳本、`MEMORY.md`、handoff）。 |
| **3. resume 要多少 token** | 不需手動跑 `fleet pm resume`，但「自動恢復開銷」已焊死在底線內：`compact 摘要`（~5k）+ 壓縮後 hook 恢復塊（~6k–7.5k）+ 4 個還原檔案（~3.6k）+ 保留尾段（未查到，估數萬）+ 依指引補跑 `fleet recent --unseen`／讀 `PM-STATE.md`（~3k–8k）。這筆膨脹之後**每一輪都要重複付 `cache_read` 費**。 | **事前寫 handoff**：約 **2k–4k**（產出一份 ~2.5k–3k 字元 handoff 約 1k 輸出，加 1–2 次狀態確認）。<br>**`/clear` 後拉回**：`fleet pm resume` 實際輸出字數在輸入檔中**未查到**（僅在 `MEMORY.md` 第 604 行提及指令）。合理推估：讀 handoff（~1k–2k）+ `fleet pm resume`（控管後估 **3k–8k**；若未控管而傾倒陳年 RED 則恐逾 10k）+ 按需重新 `ToolSearch` 載入常用 fleet 工具（瘦身後 ~3k–4k，未瘦身 ~6k–7k）＝ **合計約 8k–15k token**。 |
| **4. 多久做一次** | *（輸入檔未查到每小時精確 token 增量，以下依巡查與互動估日常平均 25k–45k/時、高峰 40k–70k/時推算）*：<br>• 若設 200k（剩 50k–63k）：高峰 **0.8–1.5 小時**一次（嚴重震盪）。<br>• 若設 300k（剩 ~150k–163k）：高峰 **2.5–4 小時**一次，日常 **3.5–6 小時**一次（每日約 4–6 次）。 | 若門檻設 **220k**（瘦身後底線 ~55k，淨工作空間 **~165k**；未瘦身底線 ~70k，淨空間 **~150k**）：<br>• 高峰 **2.5–4 小時**一次，日常 **4–6.5 小時**一次（每日約 3–5 次）。<br>• **頻率與 300k compact 相當甚至略低，但全程每輪少背 ~75k–80k 上下文！** |
| **5. 整體成本與風險特性** | **運作最省心**（全自動、無人值守可跑）；但**額度成本最高**（每輪平均 218.5k + 每次 compact 重建 ~118k `cache_creation`）、底線隨工具載入單調膨脹、長上下文失誤率高。 | **額度成本最低、上下文最乾淨**（每輪平均 ~137.5k，徹底清除 `Artifact` 等沉積垃圾）；主要成本在於**須建立嚴格的交接安全點紀律與觸發機制**，否則有漏訊／斷子代理／漏操作員口頭指示風險。 |

### 3.2 失敗模式細項檢核（未讀訊息、進行中子代理、操作員剛說的話）

1. **未讀訊息（收到的 fleet 訊息）會不會漏掉？**
   - **做法一**：**會漏進 context，須靠補讀補救**。`preload-inventory.md` 多處（第 796、805、886、1589 行）明確指出 compact 前後到達的通道訊息可能不在摘要與尾段中；目前 hook 塞入的未回清單還會因 9,999 字元截斷而省略 181 則，加上 `mcp__fleet__recent` 上限僅 50 則，高流量時有漏看風險。
   - **做法二**：**在「寫完 handoff → `/clear` → `fleet pm resume`」的數十秒空窗內，存在競態風險**。特別是一個容易被忽略的死角：若某則訊息剛在 `/clear` 前一刻進入舊對話紀錄，投遞端可能已將其 `receipt` 標為 `in_context`，但 PM 還沒回覆（`answered=false`）就 `/clear` 了——若 resume 只查 `recent(unseen_only=true)` **就會漏掉這一則**！
   - **做法二緩解規則**：`fleet pm resume`（或恢復第一步）必須**同時查** `inbox-cli list --member pm--claude --disposition unread` 與 `mcp__fleet__recent` 裡 `answered=false` 的項目，而不只依賴 `unseen_only=true`。

2. **進行中的子代理（`Agent` 工具背景子代理）會不會漏掉？**
   - **做法一**：輸入檔中記錄 `subagents: 7 recorded, 0 running`，因此**未查到** compact 對正在執行中的背景子代理之實測行為；一般同一對話仍會接收完成通知，但壓縮後對原派工脈絡的記憶已縮水。
   - **做法二**：**高風險——極可能會遺失或孤立進行中的同程序子代理！** `preload-inventory.md` 第 1952 行明載，透過 `Agent` 工具派出的同程序子代理共用主連線且不在 fleet 系統內。`/clear` 清空對話後，新對話無法乾淨承接舊對話派出的背景 `Agent` 結果（確切是立刻終止還是變成孤兒程序，輸入檔中**未查到**實測）。
   - **做法二緩解規則**：強制設立**排空閘門**——PM 席嚴格禁止在有執行中背景 `Agent` 子代理時執行 `/clear`；長時任務一律透過 `fleet dispatch` 派給獨立工作線／席位（其生命週期獨立於 PM 席），PM 席內的輕量短工子代理僅做短時前景查詢，做完立刻收成。

3. **操作員剛說的話會不會漏掉？**
   - **做法一**：**較不易漏**，因為 compact 保留最近幾則原文尾段，且摘要第 6 節會列出近期所有使用者訊息。僅在連續多次 compact 後或壓縮當下輸入時有稀釋風險。
   - **做法二**：**若沒有「先落盤再 `/clear`」與「安全點閘門」，會直接漏掉！** 只要操作員剛口頭給的修正或決定沒先寫進帳本／`MEMORY.md`／handoff，`/clear` 就會直接洗白；若系統在操作員打字或剛送出訊息時搶先自動 `/clear`，更會直接吃掉操作員當句輸入。
   - **做法二緩解規則**：(1) 嚴格執行現有規則 `record-discussions-same-turn`（操作員想法與決定當輪先寫帳本與記憶再回覆）；(2) 只有在「已回覆操作員最新訊息＋未落盤事項皆已寫入 handoff／帳本＋操作員目前未輸入」的安全點，才觸發 `/clear`。

4. **額外邊界失敗模式（實測驗證清單）**：
   - **每小時巡查排程（`94c6f5db`）在 `/clear` 後是否消失**：**未查到**；若消失而未於 resume 自動重掛，將導致靜默停巡。
   - **`/clear` 後對 fleet MCP 通道綁定與 `recent` 歷史的影響**：**未查到**（須實測 `/clear` 是否更換對話識別碼、投遞端是否仍無縫投遞至同一 PM 席）。
   - **`fleet pm resume` 本身肥大化**：若 `fleet pm resume` 未設篇幅上限（重蹈 `SessionStart` hook 傾倒 67 行 RED 的覆轍），會把做法二的底線優勢吃掉。

---

### 3.3 觸發 `/clear` 需要什麼機制？Harness 能不能自動做，還是要操作員按？

1. **Harness 能不能自動做 `/clear`？**
   - **未查到。** 本次輸入檔中沒有任何證據顯示 Claude Code 內建「達 token 門檻自動執行 `/clear` 並自動執行 resume」的功能，也**未查到** `PostToolUse`／`Stop` hook 可主動命令 harness 執行 `/clear`（輸入檔第 1876 行僅記載 `session-handoff` hook 可在 `/clear` **發生後**注入快照，屬於被動回應而非主動觸發）。
   - **確認所需證據**：檢查目前版本 Claude Code 官方文件或命令列 hook 規格，確認是否存在 `auto_clear` 設定或 hook 回傳執行斜線指令的欄位。

2. **三種觸發機制比較**
   - **機制 A：半自動「Hook 預警 ＋ PM 安全點寫 handoff ＋ 操作員按 `/clear` ＋ `SessionStart:clear` 自動接力」（推薦）**
     - 流程：在 `PostToolUse`／`Stop` hook 監測 context 達 **220k** 時提示 PM → PM 在當輪安全點排空子代理、把操作員最新指示落盤、更新精簡 handoff（~1k–2k）、回覆操作員並附上一行「上下文已達 220k，交接已備妥，請按 `/clear`」→ 操作員按一次 `/clear` → `SessionStart` hook 偵測到 `clear` 事件，自動注入該份精簡 handoff 並提示第一步跑 `fleet pm resume`、查 `unread`／`answered=false`、確認每小時巡查排程已掛上。
     - 優點：完全遵守「絕不對操作員窗格送出按鍵（`send-keys`）」紅線（第 201 行）、零競態吃掉操作員輸入風險、立即可行不需等 harness 新功能。
     - 缺點：需操作員手動按一次 `/clear`（約每日 2–4 次，只在操作員在線時）；夜間無人值守時不會觸發。
   - **機制 B：外部代理程式透過 `tmux send-keys` 自動送 `/clear`**
     - 雖然 hangar 具備輸入代理程式（第 345 行），但 PM 席是操作員直接互動的窗格，自動對其 `send-keys` **直接牴觸紅線（絕不對操作員窗格送出按鍵）**，且難以完全避免在操作員正打字時撞車。除非操作員另開卡片明示授權並具備可靠的「鍵盤閒置＋無輸入草稿＋PM 閒置」偵測，否則**不建議**。
   - **機制 C：雙層防線（機制 A 為主 ＋ 調高自動 compact 門檻至 280k–300k 為夜間保底）**
     - 白天操作員在線時走**機制 A**（220k 提醒 → 操作員按 `/clear` → 底線回落至 ~55k，省下每輪 34%–37% 上下文費用）；
     - 夜間或操作員離席數小時無人按 `/clear` 時，不卡死、不中斷巡查，自然退回 **280k–300k 自動 compact 保底安全網**（壓縮後仍有 ~150k 工作空間，絕不重演 200k 連續震盪），等操作員隔天回來再按一次 `/clear` 洗回 55k 底線。

### 3.4 與其他輔助做法的搭配比較

- **PM 席工具隔離（高性價比、低風險，建議立即與做法二並行）**：嚴格規定 PM 主席不自行呼叫 `Artifact` 等超大型單次工具（單獨佔 12k–13k token），需要產出或發佈網頁時一律交給短工子代理或 `codeforge` 等工作線處理。成本近乎零，且同時嘉惠做法一與做法二。
- **PM 席拆分（例如拆成「巡查席」＋「操作員對話席」）**：雖然能把巡查雜訊隔離出對話席，但會製造雙席狀態同步、操作員溝通窗口分裂（違背專案 `CLAUDE.md`「操作員只對你對話」原則）與雙倍常駐預載底線（兩席各付一份 ~55k–70k 底線，未必省額度）。除非單席在做法二＋瘦身後仍無法負荷，否則**不建議現在拆分**。

---

## 四、落地前必補的 4 項低成本驗證（填補「未查到」缺口）

1. **拆解一次 `rec 14291` 對應的 `api-request-blob`**：確認剩餘 34k–51k 缺口究竟有多少來自 compact 保留原文尾段、多少來自 `data-flow-records`，以及 `deferred_tools_record` 是否與 `tools`（111.6k）重疊。
2. **在測試席實測一次 `/clear` + `fleet pm resume`**：記錄首輪 API `usage` 驗證真實起手底線（檢驗是否落在推估的 58k–85k／瘦身後 45k–65k）、確認 `deferred_tools_record` 是否歸零、確認 `fleet pm resume` 實際輸出大小。
3. **實測 `/clear` 對 `CronCreate`（每小時巡查 `94c6f5db`）與 fleet 通道綁定的影響**：確認是否需要於 `SessionStart:clear` 自動重掛巡查，以及投遞端是否無縫延續。
4. **確認 PM 席 `claude-opus-5-5` 的實際視窗上限與自動 compact 門檻設定桿**：確認視窗確為大於 200k（如 1M），使 280k–300k 保底安全網可合法套用。
