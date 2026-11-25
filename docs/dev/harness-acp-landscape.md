# Harness ACP（Agent Client Protocol）現況調研與評估

資料蒐集日：2026-11-23。本文件只記錄來源文件中已查證之事實；查無官方依據者一律標示「未證實」，不推測、不補齊。

---

## 1. 規格現況

- **官方網站**：https://agentclientprotocol.com/ （頁面未具名維護者，未證實；第三方摘要稱 Zed 推動並與 Google 合作，未證實）。
- **官方 repo**：https://github.com/agentclientprotocol/agent-client-protocol 。
- **穩定版**：協定版本 `1`。GitHub release 最新 stable 為 Schema v1.35.0（2026-11-25 astra 複核；原記 v1.34.1 已過時，標示 Latest；來源：https://github.com/agentclientprotocol/agent-client-protocol/releases ）。v1 wire schema 未變（來源：https://docs.rs/crate/agent-client-protocol/2.0.0/source/CHANGELOG.md ）。
- **v2**：GitHub 上 v2.0.0-beta.1／beta.2／beta.3 標示 Pre-release（2026-11-20 至 11-21），changelog 條目為「move ACP v2 to Preview」。網站上的 v2 draft schema：https://agentclientprotocol.com/protocol/v2/draft/schema 。第三方摘要稱 v2 draft 於 2026-07-20 公告，原公告未開啟核對，未證實。

---

## 2. ACP 能力表

| Harness | ACP 角色與穩定度 | headless | 串流與權限回呼 | session resume | 認證 | 出處與日期 |
|---|---|---|---|---|---|---|
| Claude Code | 無原生 ACP server／client（feature request #6686 於 2026-02-09 被 bot 以 not planned 關閉，無維護者回應）。社群 adapter `@agentclientprotocol/claude-agent-acp`（preview 通道，v1 穩定度未證實；v2 標示 Preview）。adapter 是否 Anthropic 官方：未證實 | CLI 層 `claude -p` 支援非互動；adapter 啟動指令：未證實 | CLI：`--output-format stream-json`；權限：`--permission-prompt-tool`、PermissionRequest hook。adapter README 列有 permission request 支援 | CLI：`--resume <id>`、`--continue`；adapter v1 resume：未證實；v2 有 `session/resume`（Preview） | 官方 CLI：`ANTHROPIC_API_KEY` 或互動登入（bare 模式不讀 OAuth／keychain）；adapter 認證方式：未證實 | https://github.com/anthropics/claude-code/issues/6686 （2026-02-09 關閉）；https://github.com/agentclientprotocol/claude-agent-acp ；https://code.claude.com/docs/en/headless （頁面未標日期，未證實；擷取日 2026-11-23） |
| Codex（OpenAI Codex CLI） | 原生 ACP：未證實（官方 app-server 文件未提及 ACP，只比較 MCP）。社群／Zed adapter `codex-acp`（Zed 頁標示 Community adapter；最新套件名 `@agentclientprotocol/codex-acp` 僅見搜尋摘要，未證實）。穩定度：未證實 | `codex app-server`，預設 stdio（newline-delimited JSON-RPC 2.0），另有 websocket（標示 experimental） | 串流：app-server 事件串流。權限：server 送 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`，client 回 accept／decline 等。ACP 路徑上的權限對映：未證實 | `thread/resume`、`thread/fork`、`thread/read`；ACP load 對映：未證實 | API key、ChatGPT OAuth（browser 或 device code）、external tokens（experimental）、Amazon Bedrock | https://developers.openai.com/codex/app-server.md 轉址至 https://learn.chatgpt.com/docs/app-server.md （頁面未標版本或日期，未證實）；https://zed.dev/acp/agent/codex-cli （頁面無日期，僅 footer 2026；擷取日 2026-11-23） |
| Gemini CLI / agy（Antigravity CLI） | **Gemini CLI**：有 ACP server `gemini --acp`；整體穩定度標示：未證實（僅 `unstable_setSessionModel` 有 `unstable_` 前綴）；頁面稱 Gemini CLI 已於 2026-06-18 對免費層與 Google One 使用者改由 Antigravity CLI 取代。<br>**agy**：有 ACP server `agy acp`（官方文件，內建，不需第三方 adapter）；協定版本：頁面未標，未證實（一則搜尋摘要稱 v1，未在原頁核對）；穩定度：未證實；第三方彙整稱 v1.5.0 於 2026-11-04 加入 ACP，屬二手來源 | **Gemini CLI**：stdio 傳輸；JSON-RPC 2.0；headless 專門說明：未證實。<br>**agy**：stdio JSON-RPC；ACP 的 no-TTY 行為：未證實（頁面只說 headless 另見他處） | **Gemini CLI**：串流（`session/update` 類）：未證實；權限：頁面只說 `setSessionMode` 控制 tool 核准層級，未描述權限請求回呼：未證實。<br>**agy**：串流：未證實；權限：頁面僅連到一般 Permissions 文件，ACP 權限回呼：未證實 | **Gemini CLI**：方法 `loadSession` 存在；行為細節：未證實。<br>**agy**：未證實 | **Gemini CLI**：方法 `authenticate` 存在；機制：未證實。<br>**agy**：`agy acp --login` 或互動登入一次後重用 cached credentials；儲存機制：未證實 | https://geminicli.com/docs/cli/acp-mode/ （Last updated: Apr 10, 2026；無版本號）；https://antigravity.google/docs/cli/acp.md （頁面未標日期，未證實）；https://antigravity.google/docs/cli/acp/ （擷取日 2026-11-23） |
| Grok（xAI Grok Build） | 有 ACP server：`grok agent stdio`（xAI 官方文件）；Zed registry 以 `npx @xai-official/grok@1.0.89 agent stdio` 列出。穩定度：頁面未標示，未證實 | `grok -p "<prompt>"` 為 headless；`--no-alt-screen`、`--no-auto-update`（官方建議 ACP 用於 script／CI 時加此旗標）；`--output-format` 支援 plain／json／streaming-json | 串流：ACP 中 assistant 文字以 `session/update` chunks 送出（官方）。權限回呼：未證實（第三方文章稱不跳過核准，非官方來源）；headless 下用 `--always-approve` | 官方 headless 旗標：`-s`／`-r`（指定或恢復 session）、`-c`（最近 session）；ACP 的 `session/load`：未證實 | `XAI_API_KEY` 環境變數，或 `grok login` 後的快取 token；登入協定名稱：未證實 | https://docs.x.ai/build/cli/headless-scripting ；https://zed.dev/acp/agent/grok-build （版本 1.0.89 見 npx 指令；發布日期：未證實；擷取日 2026-11-23） |
| Kimi（Kimi Code CLI） | 有 ACP server：`kimi acp`（官方；IDE 子行程入口）。穩定度：頁面未標示 experimental／beta／preview，未證實。`session/set_model` 沿用 "ACP 0.23 unstable surface"。ACP 版本以外的發布日期：未證實 | stdin／stdout JSON-RPC；啟動後等待 `initialize`，無 banner，log 寫 stderr 與 `~/.kimi-code/logs/`（路徑取自官方頁） | 串流：`session/update`。權限：`session/request_permission`；ask-user 用 `elicitation/create` | `session/load`（回放歷史）、`session/resume`（不回放）皆實作 | `authenticate` 的 `login` method（`authMethods` 含 terminal 型）；`logout` 清除 managed provider token；token 儲存機制：未證實 | https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html ；https://github.com/MoonshotAI/kimi-cli （頁面無發布日期，未證實；擷取日 2026-11-23） |
| Cursor（cursor-agent CLI） | server：有，`agent acp`（官方標為 advanced、hidden 指令）。client：未證實。穩定度：未證實 | ACP 為 stdio 子程序模式，官方稱「intended for building custom clients」；非 ACP 的 print 模式：未證實 | `session/update`（如 `agent_message_chunk`）串流；`session/request_permission`，回傳 `allow-once`、`allow-always`、`reject-once`；頁面警告不回應會阻塞。另有 `cursor/ask_question` 等擴充 | `session/load` 有；`session/resume`：未證實（頁面未提及） | `cursor_login`（methodId）；預先登入用 `agent login`，或環境變數 `CURSOR_API_KEY`、`CURSOR_AUTH_TOKEN`，或旗標 `--api-key`、`--auth-token` | https://cursor.com/docs/cli/acp （2026-11-23；`.md` 版本 404） |
| opencode | server：有，`opencode acp`（JSON-RPC over stdio，ACP protocol version 1）。client：未證實。穩定度：未標示（未證實） | ACP 模式由 client 以子程序啟動，程序在 client 關閉 stdin 後退出；非 ACP 的無頭模式：未證實 | `session/update` 回報進度、工具呼叫、用量；權限選項 `allow_once`、`allow_always`、`reject_once`，可附 diff 預覽；`session/cancel` 回 `stopReason: "cancelled"`；問題以 `elicitation/create` 表單送出 | `session/load` 有（回放訊息）；`session/resume` 與 `session/fork` 已支援（astra 2026-11-25 複核官方文件，原記「不支援」已過時）；用量不含子 session，記帳要另算；另有 list、close、delete | `opencode auth login` 事先登入；預設 agent 方法 `opencode-login`；client 支援 terminal 時可執行 `opencode acp --login` | https://opencode.ai/docs/cli/acp/ （2026-11-23） |
| Qoder（qodercli／qoder） | server：有，但指令名稱文件不一致：CLI reference 寫 `qodercli`／`--acp`，ACP 頁寫 `qoder --acp`（哪個為現行：未證實）。client：未證實。穩定度：未證實 | `-p`／`--print`：單次回應後退出，適合 CI；`-o` 支援 `text`、`json`、`stream-json`。headless 下權限行為：未證實（官方 headless 頁 404） | ACP 頁：權限設定「與 CLI 相同」，Bypass 等同 `--yolo`；串流與 `session/update`：未證實（ACP 頁未提及） | CLI 有 `--continue`（`-c`）、`--resume`（`-r [id]`）、`--session-id`、`--fork-session`；ACP 的 load／resume：未證實 | `qoder login`；環境變數 `QODER_PERSONAL_ACCESS_TOKEN` 於啟動時登入 | https://docs.qoder.com/cli/acp （2026-11-23；`/en/` 版 404）；https://docs.qoder.com/cli/cli-reference （2026-11-23）。headless 頁 https://docs.qoder.com/cli/headless 404，未直接驗證 |
| MiniMax（MiniMax Code，指令 `mcode`） | server：有，`mcode acp`（stdin／stdout；log 走 stderr）。client：未證實。穩定度：未證實 | `mcode exec [prompt]`，輸出 `text`、`json`、`stream-json`；`--permission off` 關閉權限模式。官方明言：headless 不支援 `ask`，需人工核准時改用 TUI 或 ACP | 頁面說 ACP host 可處理權限提示、問題、取消、模型控制、Plan；串流格式與事件名：未證實 | ACP 是否支援 load／resume：未證實；TUI 有 `/sessions`（別名 `/resume`） | MiniMax Token Plan（`mcode provider use token-plan`）；API Key（`mcode provider use api-key`，預設讀 `MCODE_PROVIDER_API_KEY`）；OAuth（`mcode login` 或 `/login`） | https://code.minimax.io/docs/cli/features.md （由 agent.minimax.io 301 轉址，2026-11-23）。Zed 清單 https://zed.dev/acp/agent/minimax-code 僅見於搜尋摘要 |
| T3 Code | ACP client（host UI）：可從 ACP Registry 加入，或在 Settings → Providers 用 Local ACP command 指定本機執行檔；直接啟動執行檔，不展開 shell。優先使用 ACP v2（官方文件稱「preview」），Registry 尚未遷移的 agent 協商 ACP v1。穩定度：官方頁與 README 未標示版號與 stable／beta 狀態（二手部落格稱 Beta，未證實） | 桌面 App（macOS、Windows、Linux）、CLI（`t3` 啟動 server 並開啟 web app）、web app（app.t3.codes）、iOS 與 Android App | 未證實（來源未描述 T3 Code 自身的串流／權限回呼細節） | 每個 thread 可用獨立 git worktree；同一 server 供各端共用 thread | 前置條件：至少一個已安裝並登入的 agent（例如 Claude Code 或 Codex CLI）；自稱「不是模型供應商」、「does not resell tokens」 | t3.codes 首頁與 GitHub README `pingdotgg/t3code`、`docs/user/providers-acp.md`（擷取日 2026-11-23） |

---

## 3. T3 Code 是什麼

- T3 Code 是一個 **啟動並控制本機 coding agents 的 client UI**（官方頁自稱「The open-source control plane for coding agents」，在使用者自己的機器上執行 agent 並提供單一介面；自稱「不是模型供應商」、「does not resell tokens」）。
- **形態**：桌面 App（macOS、Windows、Linux）、CLI（指令 `t3` 啟動 server 並開啟 web app）、web app（app.t3.codes）、iOS 與 Android App。同一 server 供各端共用 thread，每個 thread 可用獨立 git worktree。
- **支援的 harness**：GitHub README 列 Claude Code、Codex、Cursor、OpenCode、Grok Build、Antigravity、Kiro、Pi、Muse Code、fx，以及「any ACP agent」；t3.codes 首頁列的清單較短（Claude Code、Codex CLI、Antigravity、OpenCode、Cursor、Grok CLI），兩者不一致，以 README 為較新，但未證實。
- **ACP 關係**：`docs/user/providers-acp.md` 記載可從 ACP Registry 加入，或在 Settings → Providers 用 Local ACP command 指定本機執行檔，T3 Code 直接啟動執行檔（不展開 shell）。優先使用 ACP v2（官方文件稱「preview」），Registry 中尚未遷移的 agent 協商 ACP v1；Claude Agent 預設 v2，可用 `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` 退回 v1。
- **授權與安裝**：MIT 授權；需至少一個已安裝並登入的 agent（例如 Claude Code 或 Codex CLI）。
- **未證實項目**：官方頁只見版權字樣「© 2026 T3 Tools Inc」，「Theo」與「T3 team」為二手來源所述，未由官方頁證實；版號與 stable／beta 狀態官方未標示（二手部落格稱 Beta、0.0.34 版與 114 位貢獻者，未證實）；x.com 討論未證實。

---

## 4. 評估：改接各家 ACP vs 現行 hetero engine（`dispatch-author`、`dispatch-panel` 的 CLI 包裝）

1. **可靠度**
   - 事實（ACP 調研）：多數 harness 的 ACP 角色為社群 adapter（Claude Code 的 `@agentclientprotocol/claude-agent-acp`、Codex 的 `codex-acp`）或穩定度未證實／preview（Gemini CLI 僅 `unstable_setSessionModel` 標示 unstable、agy／Grok／Kimi／Cursor／opencode／Qoder／MiniMax 均未標示 stable）。
   - 事實（repo 實作）：現行 `scripts/dispatch-author.sh` 與 `scripts/dispatch-panel.js` 直接以 CLI headless 子程序呼叫各家 runner，並透過 `references/hetero-dispatch.md` 定義的 dispatch rails 運作。
   - 判斷：全面改接 ACP 的可靠度證據不足，不應替換已跑通的現行 CLI 包裝路徑。

2. **錯誤可見性**
   - 事實（repo 實作）：`scripts/dispatch-panel.js` 在 seat 非零退出時，原本只記錄 `rc`（或擷取首行）；本次改動已將 `dispatch-panel.js` 補齊為擷取 stderr 最後一個錯誤標記行（或最後一個非空行），經 `redactSeatError` 去識別化後寫入 `panel.json` 的 `error` 欄位。
   - 事實（ACP 調研）：各家 ACP server 透過 JSON-RPC stdio 回報錯誤與事件，但部分家別（如 agy、Qoder、MiniMax）的串流與錯誤事件細節仍未證實。
   - 判斷：面板 `rc=2` 錯誤被吃掉屬於錯誤可見性問題，透過 `dispatch-panel.js` 小修即可直接解決，不需要靠更換底層協定。

3. **成本**
   - 事實（ACP 調研）：ACP client 需實作 JSON-RPC 2.0 初始化、事件迴圈與阻塞型權限回呼（如 Cursor 警告不回應 `session/request_permission` 會阻塞）。
   - 判斷：改接 ACP 會增加控制端（client）的開發與維運成本，且在無統一穩定度保證前性價比低。

4. **維護量**
   - 事實（ACP 調研）：各家 ACP 實作與旗標差異大（例如 Qoder 指令名稱在文件間為 `qoder` 與 `qodercli` 不一致、Claude Code 需依賴第三方 adapter、ACP v1 與 v2 preview 並存）。
   - 判斷：全面改接會把維護重心從單純的 CLI 參數包裝轉移到處理各家 JSON-RPC 方言與 adapter 相容性，維護量顯著上升。

5. **能不能接 fleet task 與 receipt**
   - 事實（repo 實作）：現行 `scripts/dispatch-author.sh` 與 `scripts/dispatch-panel.js` 已整合 `Fleet-Task` 前置檢查與結果／receipt 寫入（`wait-dispatch-results.js`、`panel.json`）。
   - 事實（ACP 調研）：ACP 規格與各家文件未提及 fleet task 或外部 receipt 機制。
   - 判斷：無論走 CLI 或 ACP，fleet task 與 receipt 都由外層 orchestrator／dispatcher 管理；現行 CLI 包裝已直接支援，無需透過 ACP 重建。

6. **Chinese-model gate 怎麼套**
   - 事實（repo 實作）：`scripts/dispatch-panel.js` 在 spawn 前透過 `cn-model-dispatch-gate.js` 與 `resolveSeat` 檢查每個 seat 的 runner／model／family，被阻擋的 seat 標記為 `barred` 且永不 spawn。
   - 判斷：gate 位於 dispatch 入口層（spawn 前），與底層走 CLI 或 ACP 無關，現行機制可直接沿用。

7. **對小模型友善度**
   - 事實（ACP 調研）：ACP 要求啟動後進行 `initialize` 交握、處理 `session/update` 與阻塞型 `session/request_permission` 回呼；部分 runner（如 Codex `app-server`）提供結構化事件與明確的 `requestApproval` 介面。
   - 判斷：對小模型或非互動任務而言，單純的 CLI `-p`／headless 呼叫心智負擔最低；僅針對需要結構化事件與權限回呼的特定場景（如 Codex `app-server`），才值得做 opt-in 試驗觀察。

---

## 5. 建議

不全面改接。現行 CLI 包裝繼續當預設。理由：多數家的 ACP 角色是社群 adapter 或 preview／未證實（見能力表），可靠度證據不足以換掉已跑通的路徑；今晚 panel 回 rc=2 錯誤被吃掉的問題，是錯誤可見性問題，由本次 dispatch-panel.js 的小修直接解決，不必靠換協定。部分改接只做一個 opt-in 試驗（spike）：Codex 的 app-server（結構化事件與權限回呼），預設關，不碰現行 runner；是否開工，等 astra 與 carbon 各自獨立評估回來，再由 PM 裁。日期（PM 11-23 裁示）：astra 與 carbon 兩章最晚 2026-11-24T12:00Z 交（額度重置後第一個窗口）；PM 收到兩章當天裁試驗開不開工；若開工，試驗上線日在裁示當天寫進本頁。回滾：試驗是 opt-in 旗標，關掉旗標即回到現行路徑，不需要還原程式。

---

## 6. 未證實清單

以下彙整兩份調研來源中所有標示為「未證實」之項目（已去重）：

1. ACP 官方網站維護者身分，以及「Zed 推動並與 Google 合作」之說法。
2. ACP v2 draft 於 2026-07-20 公告之原公告內容。
3. ACP 協定本身：官方概覽頁未標示 v1 與 v2 的 stable、draft、preview 狀態。
4. ACP 官方 SDK 版本與清單（僅見搜尋摘要，未直接驗證）。
5. Claude Code：`@agentclientprotocol/claude-agent-acp` 是否為 Anthropic 官方維護、v1 穩定度、adapter 啟動指令、adapter v1 resume、adapter 認證方式，以及 `code.claude.com/docs/en/headless` 頁面日期。
6. Codex：原生 ACP 支援、`codex-acp` 穩定度、`@agentclientprotocol/codex-acp` 套件名（僅見搜尋摘要）、ACP 路徑上的權限與 load 對映，以及 `app-server.md` 頁面版本／日期。
7. Gemini CLI：ACP 整體穩定度標示、headless 專門說明、`session/update` 串流、權限請求回呼、`loadSession` 行為細節、`authenticate` 機制。
8. agy：ACP 協定版本、穩定度、no-TTY 行為、串流、ACP 權限回呼、session resume、憑證儲存機制，以及 `acp.md` 頁面日期。
9. Grok：ACP 穩定度、ACP 權限回呼、ACP `session/load`、登入協定名稱，以及 Zed registry 頁面發布日期。
10. Kimi：ACP 穩定度標示、ACP 版本以外的發布日期、token 儲存機制。
11. Cursor：ACP client 角色、ACP 穩定度、非 ACP 的 print 模式與 headless 旗標（`using.md` 404）、`session/resume`。
12. opencode：ACP client 角色、ACP 穩定度（頁面未標示）、非 ACP 的無頭模式。
13. Qoder：ACP client 角色、ACP 穩定度、現行指令名稱（`qoder` 或 `qodercli`）、headless 權限在無確認時的預設行為（`headless` 頁 404）、ACP 的 session load／resume 與串流細節。
14. MiniMax：ACP client 角色、ACP 穩定度、ACP 的串流事件格式與 load／resume 支援、Mini-Agent 的 `mini-agent-acp`（僅見搜尋摘要）。
15. T3 Code：「Theo」為開發者（僅二手來源）、x.com 上的討論內容（僅二手來源）、版號與 stable／beta 狀態（官方未標示）、支援清單的哪一版為現行（官方首頁與 README 不一致）。

---

## 7. 待 astra、carbon 獨立評估

### astra（2026-11-25，部分同意）

版本資料過時（schema v1.35.0、v2 為 beta.4，不可混同 schema 與協定版本）；opencode 已支援 resume／fork；app-server 是 codex-acp 包裝的另一套協定，單測它不算測 ACP；官方對自動派工／CI 優先建議 Codex SDK。最小試驗改為 opencode ACP 對照 CLI 100 件（取消、斷線、權限拒絕）。

### carbon（2026-11-25，部分同意）

app-server 是私有協定非 ACP，試驗標的須改選原生 ACP（opencode acp）；漏驗 ACP 是否回傳精確 token／cache 用量，缺此即不改接的硬理由；連跑 100 次無頭派工零死鎖零殘留為成功判準。

### PM 裁定（2026-11-25）

opencode ACP 試驗開：單一非關鍵席位、旗標預設關；先驗 token／cache 用量精確性，拿不到就停；對照 CLI 同 100 件；中國模型只跑公開來源；一天、不超過該席 7 天額度 10%；失敗率高 CLI 10 個百分點或越界一次即停。

---

## 8. lead／PM 席改跑非 Claude Code harness（pi、dsh）

> 「不然我都在想要用 pi/dsh 開發 lead / pm 了，一直被 claude code 安全機制卡脖子有點沒意思」

### 8.1 pi 與 dsh 是什麼

**pi**
- **事實（`pi-dsh-research.md`，資料日期 2026-11-23）**：
  - 身分與授權：自稱「minimal, extensible agent harness that you can make your own」，為 coding agent CLI（`pi`）。GitHub 與 npm 指向 `earendil-works` 組織（`github.com/earendil-works/pi`、npm `@earendil-works/pi-coding-agent`；舊版套件名 `@mariozechner/pi-coding-agent`，來源 `badlogic/pi-mono`），文件僅在 sessions 段落提到 "badlogic"，個人或公司歸屬：未證實。授權 MIT（https://unpkg.com/@earendil-works/pi-coding-agent@1.5.2/README.md ）。最新版本與日期：未證實（npm 頁面回 HTTP 403，README 只有版本徽章、文字無版號；本機 repo 記的版本為 v0.80.6）。
  - 安裝：`curl -fsSL https://pi.dev/install.sh | sh`；`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`；需 Node.js 22.19 以上。
  - headless 模式：`pi --print "..."` 只輸出最終文字後退出；`pi --mode json "..."` 串流 JSONL；`pi --mode rpc --no-session` 常駐、stdin 收 JSONL 指令（https://docs.pi.dev/latest/cli-integration ；https://unpkg.com/@earendil-works/pi-coding-agent@1.5.2/docs/cli.md ；https://unpkg.com/@earendil-works/pi-coding-agent@1.5.2/docs/rpc.md ）。
  - 擴充與 MCP 機制：有 extensions、skills、prompt templates、themes，可用 npm 或 git 打包成 Pi package。MCP 有內建 `builtin:mcp` 擴充與 `pi mcp add/remove/list/login/logout` 子命令，`--no-mcp` 可關。hook：未證實；能否接收 fleet MCP channel 的 `notifications/claude/channel` 通知：未證實；prompt cache：未證實；ACP 支援：未證實（`docs/dev/harness-acp-landscape.md:37` 提及 Pi，本次未能從官方來源驗證）。
  - session resume：有。`-c, --continue` 續接本目錄最近 session；`-r, --resume` 開選單；`--session-dir <dir>`；`--no-session` 不持久化。
  - 安全備註：預設權限行為（是否逐項確認、是否全自動）未證實；已知工具控制旗標為 `--no-tools`、`--no-builtin-tools`、`--tools`、`--exclude-tools`，沒有 `--allow` 或確認類旗標，`--approve` 是信任專案本地設定而非工具權限。
- **判斷（能不能當 lead／PM 長駐席）**：pi 有 RPC 常駐模式與 MCP 擴充，但 hook、prompt cache、channel 通知接收皆未證實。

**dsh**
- **事實（`pi-dsh-research.md`，資料日期 2026-11-23）**：
  - 身分與狀態：與 coding agent harness 有關的 `dsh` 本次證實只有 `https://github.com/deepseek-ai/deepseek-harness`（CLI `dsh`，npm `@deepseek-ai/dsh`，MIT 授權），狀態為 developer preview，README 寫「THERE WILL BE COMPATIBILITY-BREAKING CHANGES」（https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/HEAD/README.md ）。DeepSeek 目前不接受外部 PR。最新版本與日期：未證實（GitHub Releases 空白，搜尋結果有 `0.1.1-rc.2` 與 `0.1.5-rc.2` 兩種說法，皆不可確認）。
  - 入口與 headless：可確認的入口是 Web UI（`npx @deepseek-ai/dsh web`，起於 `127.0.0.1:3080`）與 build/dev 指令；headless：未證實。
  - 擴充／session／安全：架構為 "everything-is-a-plugin"（Cordis 外掛系統），skill／MCP／hook 具體支援：未證實；session resume：未證實；prompt cache：未證實；SAFETY.md（https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/HEAD/SAFETY.md ）寫「approval prompts, and permission controls can reduce risk」，但預設是否逐項確認未證實，官方警語為實驗性、未經安全稽核，建議用一次性 VM 或容器且不要當唯一安全控制。
- **判斷（能不能當 lead／PM 長駐席）**：dsh 是 developer preview 且 headless 未證實，現在不能當長駐席。

### 8.2 卡脖子清單（今晚實際卡過的事，逐項判斷來源）

| 卡點 | 來源判斷（Claude Code 本身 / 自家 hook / 自家設定） | 依據 | 可不可以拿掉 |
|---|---|---|---|
| dev-channels 確認框（重開席位時 `--dangerously-load-development-channels` 的確認） | Claude Code 本身（判斷） | 重開席位時由 Claude Code CLI 跳出確認 | 是否有正式旗標可略過：未證實，需另查官方文件 |
| 讀真的 `~/.claude` 的守門（`claude-home-read-guard`） | 自家 hook（判斷） | 規則來自全域 `CLAUDE.md` 的紅線，不是 Claude Code 的限制 | 可以（自家 hook） |
| `bash-footgun-guard`（zsh 未加引號的 glob）、`bash-launch-guard`（bare `ls`、`pkill` 自我比對、`rm` 共用目錄） | 自家 hook（判斷） | repo 自家 PreToolUse hook（`hooks/README.md`） | 可以（改 `warn` 或 `off`） |
| `depth0-delegate-gate`、`foreman-guard`、`secret-print`、`context-budget` T2 交接擋 | 自家 hook（判斷） | repo 自家 hook（`hooks/README.md`） | 可以（依旋鈕改 `warn` 或 `off`） |
| 權限確認框 | Claude Code 本身（判斷） | 可由 settings 的 `permissions` 規則調整（具體鍵名未查證） | 可透過 settings 規則調整 |
| autocompact | Claude Code 的機制，但觸發點是我們自己設的 | `autoCompactWindow` 233000／333000，交接 t2 150K／250K，見 `docs/guide/settings-reference.md` 與 `docs/plans/2026-11-21-wasted-turns.md` §2.1；頻繁壓縮與我們自設的低門檻有關（假設，待量測驗證） | 可調整門檻 |
| fleet MCP channel 只在以 channels 旗標啟動的 Claude Code session 收得到通知 | Claude Code 的機制（出處：fleet MCP server 說明） | fleet MCP server 說明 | 屬 Claude Code channels 機制限制 |

- **事實（fleet lane transcript 抽樣，2026-11-23，content-free 類別計數，單一 836 MB session 檔）**：`bash-footgun-guard` rule 3 約 1839 次、`context-budget` T2 約 2005 次、`bash-launch-guard`（bare-ls）約 345 次、（rm-shared-dir）約 146 次、（pkill-self-match）約 140 次、`depth0-delegate-gate` 約 290 次、`foreman-guard` sleep-rule 警告約 227 次、`secret-print` 約 174 次；hangar 席 7 天窗 18432 回合中 `hook_block` 779 回合，名稱以 `bash-launch-guard`、`bash-footgun-guard` 與 `dispatch-model-guard` 為主。
- **判斷**：窗口內被擋的訊息絕大多數來自自家 hook，不是 Claude Code 本身的安全機制。

### 8.3 換 harness 會失去什麼

- **事實（repo 實作）**：autopilot plugin（`hooks/hooks.json`、`skills/`、`agents`）是 Claude Code plugin 形態。
- **事實（repo 實作）**：pane mod（`mods/live`）是 Claude Code 專屬。
- **事實（`pi-dsh-research.md`）**：fleet MCP channel 通知（`notifications/claude/channel`）在 pi 未證實（dsh 亦未證實）。
- **事實（`pi-dsh-research.md`）**：prompt cache 在 pi、dsh 皆未證實。
- **判斷**：本 repo 的量測與守門（`wasted-turns-report`、`cost-tracker`、`context-budget`、transcript 讀取）都吃 Claude Code transcript 格式，換了要重寫。

### 8.4 不換的話，怎麼把卡點拿掉

- **判斷**：先瘦自家 hook：依 8.2 次數排名，對「擋下次數多、真正攔住過錯誤少」的 hook 先改 `warn` 模式；已於 `docs/guide/settings-reference.md` 查證之實際環境變數旋鈕包括 `AUTOPILOT_BASH_GUARD_ZSH_MODE`、`AUTOPILOT_BASH_GUARD_LS_MODE`、`AUTOPILOT_BASH_GUARD_PKILL_MODE`、`AUTOPILOT_BASH_GUARD_SHARED_RM_MODE`、`AUTOPILOT_BASH_GUARD_SECRET_MODE`（`block|warn|off`）、`AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE`（`off|warn|block`）、`AUTOPILOT_FOREMAN_GUARD_MODE`（`block|warn|off`）、`AUTOPILOT_CONTEXT_BUDGET_MODE`（`off|warn|once`）。
- **判斷**：用 `wasted-turns-report` 的 `by_hook` 計數當證據，遵守全域規則「每個檢查要說明它防的具體失敗，否則刪」。
- **判斷**：settings 調整與 autocompact 門檻調整走既有計畫 `docs/plans/2026-11-21-wasted-turns.md` 的 P2 到 P5，不新增 phase。

### 8.5 建議與代價

不把 lead 和 PM 席換到 pi 或 dsh。理由：多數卡點來自自家 hook，換 harness 不會讓它們消失，只會讓守門機制整套失效或重寫；pi 的 hook、prompt cache、channel 通知接收皆未證實，dsh 是 developer preview 且 headless 未證實。pi 維持現況：它是 dispatch-hetero 已有的 runner 候選，只當 implementer，不當長駐席。先做 hook 瘦身（8.4），代價是少掉部分護欄，要靠 by_hook 證據決定哪些降級。若瘦身後卡點仍是主要成本，再用小範圍試驗評估 pi 當 lead 席，條件是 hook、channel 通知與 prompt cache 先實測。日期：本章與 astra、carbon 兩章同批，最晚 2026-11-24T12:00Z 由 PM 裁；若 PM 同意瘦身，上線日在裁示當天寫進本頁。回滾：hook 降級是旋鈕，改回即可。

### 8.6 未證實

以下彙整 `pi-dsh-research.md`（2026-11-23）中所有標示為「未證實」之項目（已去重）：

1. **pi**：個人或公司歸屬（文件僅提 `earendil-works` 與 "badlogic"）、最新版本與日期（npm 403，README 無版號文字）、完整支援模型／供應商清單、hook 機制、prompt cache 支援、預設權限行為（是否逐項確認或全自動）、ACP 支援（官方 docs 未提，`harness-acp-landscape.md:37` 提及但本次未從官方來源驗證）、能否接收 fleet MCP channel 的 `notifications/claude/channel` 通知。
2. **dsh（`deepseek-ai/deepseek-harness`）**：非 agent 同名工具（搜尋未出現）、headless 指令、支援模型／供應商、skill／MCP／hook 具體支援、session resume、prompt cache 支援、預設是否逐項確認權限、ACP 支援、能否載入 MCP 伺服器與接收 channel 通知、最新版本與日期（GitHub Releases 空白，搜尋結果版本說法不一）。
3. **Claude Code**：重開席位時 `--dangerously-load-development-channels` 確認框是否有正式旗標可略過。

本章待 astra、carbon 一併獨立評估。
