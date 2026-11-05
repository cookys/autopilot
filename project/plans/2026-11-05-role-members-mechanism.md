# Plan — 角色成員的機制側：role kit 版本、帶入、升版

> Status: draft for plan review（凍結 rubric，最多兩代）。Owner: autopilot depth-0，回覆 PM。Branch: 無（只有計畫，不含程式、不改測試）。Size: M（設計＋一個小的實作 phase，P2 之前不出貨）。Frame: autopilot develop `8c0d36273`。Related: `project/plans/2026-11-05-rolekit-direction.md`（決定 d-c76529c3）、`evals/rolekit/README.md`、PM 草稿 role-members.md v0.1 的 §3、§4、§5，章程 v1 §8。

> 附錄 A 是組織側（PM 草稿 v0.1 原文），正文是機制側；兩份合併，一起走同一次 plan review。

日期 2026-11-05（台北）。本文是 PM 草稿 v0.1 §3 的回覆，也填 §4 介面表。一句話：**角色成員 = autopilot role kit（機制，本文）＋ 組織側的長期身分（登記、權限、預算、TTL、成員目錄，PM 草稿）**。

## 0. Context / thesis

- rolekit 方向（d-c76529c3）讓弱模型靠角色專屬的 kit 做出好結果；kit 的 A/B 還沒跑（pilot 材料已備好但未蓋章，`evals/rolekit/README.md`）。章程 v1 §8 要在 P2 才開放捏麵人。
- 機制側現況一句話：**kit 已能經 `--role-kit <dir>` 帶進 claude-native 的三條 rail，並把 role.md 與 tools 的 sha 記進結果 JSON；其他 harness 一律被拒；「成員目錄」「kit 版本識別」「經驗升版」三件事都還不存在。**
- 本文的立場：成員 = 「一份不可變的 kit 版本」＋「一份只讀快照的成員目錄」＋「每次派工的任務」三者在派工當下組合；成員自己沒有常駐狀態，狀態全部在檔案裡。

## 1. Problem

組長要能從 kit 樣板開出一個有長期身分的成員、讓它在多次派工之間累積經驗，而且：(a) 每次跑用的是哪一版 kit 查得到；(b) 經驗不會偷偷改掉 kit 而毀掉 A/B 證據；(c) 經驗要進 kit 必須有證據；(d) 能退回舊版。

## 2. OKR / KRs

- KR1: PM 草稿 §3 的五題各有「現況 file:line / 要蓋什麼」的具體回答（§4）。
- KR2: §4 介面表的「待 autopilot 回覆」欄全填，並明講不同意之處（§5、§6）。
- KR3: 排出與 rolekit A/B 的先後次序（§8），P2 開放前不需要動 A/B 凍結的任何檔案。
- KR4: 未驗證的 CLI 事實一律標 Spike，不當事實寫（root `CLAUDE.md` Don't 規則）。

## 2.5 Global Constraints

- kit 版本一旦被登記表引用就不可變：不原地改檔，只能產生新版本（§4.1）。
- A/B 蓋章期間，`evals/rolekit/` 的 kits、placebo、tasks、checks、prereg 不動（`evals/rolekit/README.md` stamp 段）；成員經驗不得寫進任何已蓋章的 kit。
- 帳號規則 d-2ab1e732（PM 轉述）：每台主機固定帳號，任務中途不切換。
- 子行程只用一次性 config dir（只放憑證），不給真的 `~/.claude`（`scripts/lib/seed-claude-config.js:1-12`）。
- 成員目錄與 kit 內不得出現憑證、真實主機名、個人資料；進 repo 前過 leak-guard。
- 不新增信任機制（ADR-0001）：驗證靠獨立重算，不靠自述；不做相容墊片。

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`。現有 `role_kit` 結果欄位只做**加欄位**，不改既有欄位（`references/hetero-dispatch.md:775` 目前是 `{path, role_md_sha256, tools_sha256, tools, plugin}`）；沒有外部使用者。
- **Dependency decision**: `none`（Node 內建；沿用 `scripts/lib/role-kit.js` 風格）。

## 3. 現況總覽（這就是「今天有的」）

| 項目 | 今天 | 出處 |
|---|---|---|
| kit 目錄 | `role.md`（≤ 8 KiB 硬上限，設計值約 2 KiB）、`tools`（單行、逗號分隔，`none` = 空）、選用 `plugin/`；symlink 不能指到 kit 外 | `scripts/lib/role-kit.js:5-21,27-29,66-120` |
| 帶進子行程 | `--system-prompt <role.md 原位元組>`、`--plugin-dir <kit>/plugin`、`--tools <list>`；claude 無 `--system-prompt-file` | `scripts/lib/role-kit.sh:23-49`；`references/hetero-dispatch.md:773` |
| 哪些 rail | 只有 claude-native 的 `dispatch-hetero.sh`、`dispatch-review.sh`、`dispatch-author.sh`；其他 runner 一律拒（`role-kit unsupported for runner <r>`） | `references/hetero-dispatch.md:768,774`；`scripts/dispatch-hetero.sh:2134-2137` |
| 記錄 | 結果 JSON 與 hetero manifest 多一個 `role_kit` 物件 | `scripts/dispatch-hetero.sh:962-963,1821-1822`；`references/hetero-dispatch.md:775` |
| kimi | 只有 `evals/rolekit/compile-kit.js --runner kimi` 的**編譯預覽**（`-p --agent-file`、frontmatter `tools: [...]`，kit 不得有 plugin/，卡片上限 4096 B）；rail 不接受 | `evals/rolekit/README.md` 「Second seat: kimi」「compile-kit」；`scripts/lib/kimi-containment.js:9` |
| 成員目錄、kit 版本號、經驗升版 | 都沒有 | （全 repo 無 `member`／`kit_version` 概念） |

兩個要害事實：

1. **`role_kit` 記錄不涵蓋 `plugin/` 的內容**：meta 只有 role.md 與 tools 的 sha，plugin 只是布林（`scripts/lib/role-kit.js:113-119`）。兩個只在 skill 不同的 kit，記錄會長得一樣。登記表要「記 kit sha」，這個 sha 現在**不存在**。
2. **kit 的 plugin 會執行程式**（hooks、`.mcp.json`），所以 kit 是呼叫者信任的程式碼（`references/hetero-dispatch.md:777`）。成員只能指向登記過的 kit，不得指向成員自己寫出來的目錄。

## 4. 回答 PM 草稿 §3 的五個問題

### 4.1 kit 的格式和版本怎麼定

**現有**：見 §3 第一列。形式已夠用；欠缺的是「身分」。

**要蓋**：
- **kit 內容摘要 `kit_sha256`**：對 kit 做 canonical 摘要。輸入為 `role.md`、`tools`、`plugin/**` 的（相對路徑、檔案 sha256）清單，排序後再雜湊；`sources.json`（只是出處，runner 不讀，`evals/rolekit/README.md`）排除；symlink 規則沿用現有檢查。人類看的簡寫是 `kit:<名稱>@<前 12 碼>`，與 PM 草稿 §2.2 的 `kit:art@<sha>` 同形。
- **不另立手寫版本欄位**：手寫 version 會與內容漂移（改檔忘了升號）。身分 = 內容摘要。要人類好讀的標籤（如 `art-v2`）放在登記表的欄位，標籤指向摘要，不反過來。
- **不可變**：被登記表引用的 kit 版本放在 `roles/kits/<名稱>/<前 12 碼>/`（自動 relayout 預留的 `roles/`，見 rolekit 方向 §3.4）或呼叫者指定的路徑；升版 = 新目錄，舊目錄保留到沒有成員 pin 它為止。
- **成員如何 pin**：登記表一列記 `kit_sha256`（完整 64 碼）。派工時呼叫者傳 `--role-kit <path> --expect-kit-sha <sha>`，rail 算出來不等就在任何 spawn 之前拒絕（比照現有「refused before any spawn」，`references/hetero-dispatch.md:774`）。這是**驗證**（重算比對），不是自述。
- **一次跑用哪版**：`role_kit` 記錄加欄位 `kit_sha256`（加欄位，不動既有欄位）；結果 JSON 與 manifest 都帶。事後稽核就是拿登記表那一列去比結果 JSON 的欄位。
- 實作量：`role-kit.js` 加一個摘要函式與一個輸出行（現在輸出固定 6 行，`role-kit.sh:38` 檢查 `${#_f[@]}` = 6，兩處要一起改）；`--expect-kit-sha` 在三條 rail 各加一個旗標。需負控制：改一個 plugin 檔案摘要必須改變；`--expect-kit-sha` 錯誤必須在 spawn 之前被拒。

### 4.2 headless 還是常駐

**現有**：只有 per-task headless。每次派工起一個子行程，一次性 config dir，結束就沒了（`references/hetero-dispatch.md:259-262`、`scripts/lib/seed-claude-config.js:1-12`）。常駐 session 是 fleet 座位（人工開的 claude session），不走 rail，沒有 kit 的概念。

**建議 P2 用 per-task headless**，理由：
1. **成本**：休眠的成員要零成本；常駐 session 即使閒置也佔 context 與額度，而且 context 越久越貴、要壓縮。
2. **隔離**：每次乾淨 context，kit 與成員目錄是唯一輸入；A/B 量到的就是「kit＋目錄」的效果，不混入對話殘留。這也是 PM 草稿 §2.3「休眠時沒有 session」的天然實作。
3. **帳號規則 d-2ab1e732**：headless 在派工當下固定帳號（`claude-account.js run`，`references/hetero-dispatch.md:740-763` account layer），一件工單一個帳號，不會中途換。常駐 session 會黏在開啟時的帳號，額度用盡時沒有「不換帳號」又不卡死的出路。
4. 現有監看：rail 結果 JSON 與 manifest 就是可稽核的紀錄，不需新機制。

**代價（誠實列）**：每次叫醒要重新讀目錄（有字數上限，§4.3）；成員無法被中途插話（要插話就等這張工單結束再派新單）；成員不能長時間互動討論。這些在「一次一張主工單」（PM 草稿 §2.3、章程 §9）下可接受。

**不同意點之一**：常駐不是 P2 的選項，除非有證據顯示「每次重讀目錄」的成本大於常駐成本；那個證據現在不存在，列為未決（§9 Q3）。

### 4.3 成員目錄怎麼帶進 session

**現有**：沒有。rail 只有 `--role-kit`（system prompt、plugin、tools）和任務 prompt；子行程 cwd 是 worktree。

**建議做法：目錄快照放進「任務 prompt 的開頭」，不放進 role.md，也不放進 plugin/。**
- 為什麼不進 role.md／plugin：role.md 與 plugin 是 kit 的身分（§4.1 的摘要涵蓋它們）；放經驗進去，每次經驗更新 kit 摘要就變，A/B 的 pin 與「經驗經過審查才升格」兩件事都會失效。經驗屬於「輸入」，kit 屬於「程式」。
- 做法：派工的呼叫者（組長的 session 或腳本）在派工前產生 `member_brief`：`職責.md` 全文（有上限）＋ `經驗.md` 的條目（依確定性規則選：情境標籤吻合優先、再依新近度，**不用 LLM 選**）＋ `未決問題.md`；總長有位元組上限（建議起點 4 KiB，與 kimi 卡片上限同量級，**這個數字待 pilot 後定**，列為未決 §9 Q4）。接在任務 prompt 前面，用固定分隔標題。三個 harness 都能收（任務 prompt 是共同通道）。
- **防洩漏**：快照由呼叫者從成員目錄的**指定 commit** 讀出（記下 `member_dir_sha`），子行程拿到的是文字，不是目錄路徑，也沒有該目錄的寫入權。其他成員、其他 run 看不到。結果 JSON 加 `member_brief_sha256` 與 `member_dir_commit`（加欄位）。
- **寫回**：成員不直接改 `經驗.md`。它在輸出 JSON 的固定欄位 `experience_proposals`（每條：情境、做法、證據、適用範圍，與 PM 草稿 §2.4 同格式）交回；由呼叫者的腳本驗格式與條目上限後 commit 進成員目錄。理由：避免子行程拿到目錄寫入權、避免並行派工互相覆蓋、讓每條經驗都有對應的結果 JSON 當證據來源。
- 替代方案 `--add-dir` 讓子行程自己讀目錄：repo 內沒有使用紀錄，旗標行為**未驗證**，列為 Spike（§9）；而且會失去上面的「快照＋指定 commit」好處，所以不是預設。
- **目錄裡絕對不能有**：憑證、token、真實的 `~/.claude` 內容、真實主機名／使用者名／信箱、完整 transcript。進 repo 前過 `leak-guard`；`經驗.md` 的「證據」欄只放結果 JSON／commit 的指標，不貼原文。

### 4.4 經驗升格成 kit 新版的流程

**現有**：沒有。相關規則：改 skill 或 guidance 內容要有 ON/OFF 證據（scorecard-first，`skills/CLAUDE.md`）；機制修改與要求修改要分兩個 commit（root `CLAUDE.md`）。role.md 是 guidance，所以**改 role.md 或 plugin 的任何字，都算改 guidance，需要證據**。

**流程（每一步都有產物，不靠口頭）**：
1. **蒐集**：成員目錄的 `經驗.md` 累積條目（成員提案，§4.3 寫回）。
2. **提案**：組長（不是成員）挑出一批條目，寫成 kit diff 提案：`proposal.md`（要改什麼、依據哪幾條經驗、各條的證據指標）＋新 kit 目錄（新摘要）。成員不能提案改自己的 kit，避免它為了自己方便修改限制。
3. **異家審查席**審證據是否撐得住、適用範圍是否寫對（PM 草稿 §2.5、章程 §8；走 `dispatch-review`／hetero-review 的既有 rail，ADR-0001：審查結果是 claim，由 depth-0 重算）。
4. **評測（ON/OFF）**：用 `evals/rolekit/` 同型的 harness 做小型 A/B：舊 kit（A）對新 kit（B），同模型、同凍結任務、同一個機器驗收腳本；要有安慰劑對照（等長無關內容）以排除「只是字數變多」（7/15 skill-transport 的教訓，`rolekit-direction.md` §0）。**prereg 先蓋章再跑**（`stamp-rolekit.js` 同型），判定由腳本機械得出。任務集是這個角色專屬的凍結任務；新增經驗對應的情境若不在任務集內，要先補任務再蓋章（否則量不到）。
5. **核准**：評測 PASS ＋ 審查席無 blocker ＋ PM 的 go（章程的 PM go 規則；不涉及預算超標就不需要操作員）。
6. **發版**：新 kit 放進不可變目錄，產生新摘要；登記表**不自動升**——組長把成員的 pin 改成新摘要（§4.1），下次叫醒生效（與 PM 草稿的想法一致，見 §5.2 的補充）。
7. **回滾**：把 pin 改回舊摘要即可（舊目錄保留）；不需改歷史。回滾指令寫在提案的「回滾」欄，與章程 §12 一致。

**必要的 gate（寫成腳本，不靠自覺）**：已蓋章的 kit 路徑（`evals/rolekit/kits`、`placebo`）不得被「升格」寫入；升格只能寫到登記用的新目錄。要有負控制：嘗試把經驗寫進被 FROZEN 涵蓋的 kit，必須被拒。

**成本提醒**：每次升版都跑 A/B 很貴。建議升版**批次化**（累積到一定條數，或每週一次），小改動（只有文字澄清）仍算改 guidance，不豁免；真要豁免需 PM 明確規則（未決 §9 Q5）。

### 4.5 各 harness 支援到哪

只列**已有證據**的；沒證據的標 Spike，不當事實。

| harness | system prompt | 工具白名單 | plugin／skill | agent file | rail 今天接受 `--role-kit` | 出處與狀態 |
|---|---|---|---|---|---|---|
| claude-native | `--system-prompt`（verified） | `--tools`（verified；`--allowedTools` 是權限規則不是縮面） | `--plugin-dir`（verified） | n/a | 是（三條 rail） | `rolekit-direction.md` §3.2 S5；`references/hetero-dispatch.md:773` |
| kimi | agent file 的內容即 system prompt（spike：card 注入、hash 吻合） | agent file frontmatter `tools: [...]`；`tools: []` 清空在 2.1.1 驗過 | **不讀** skill、AGENTS.md（custom agent）；方法論要寫進卡片，卡片 ≤ 4096 B | `--agent-file`（frontmatter 需 `description`，缺則 rc 1） | **否**（rail 拒；只有 `compile-kit.js --runner kimi` 預覽） | `references/multi-agent-portability.md:176-182`；`evals/rolekit/README.md`「Second seat: kimi」。**模型是否照卡片做 UNVERIFIED** |
| codex | `CODEX_HOME/AGENTS.md`、專案 AGENTS.md 進 prompt-input（只驗 `codex debug prompt-input`） | **無等價旗標**（只有 `-s` 沙箱與 `-c`，key 未驗） | `.agents/skills`、`CODEX_HOME/skills` 進 prompt-input | n/a | 否 | `rolekit-direction.md` §3.2、附錄；`codex exec` 實跑 **Spike**（排在 G37 之後）；換 `CODEX_HOME` 會連 auth 一起換 |
| agy | HOME 下 GEMINI.md（舊版 1.4.4 實測；1.5.0 **未驗證**） | **無**，靠 worktree 隔離 | `agy -p` 不讀 skill（verified negative） | n/a | 否 | `rolekit-direction.md` 附錄；`evals/rolekit/README.md` 稱 flash「unproven」 |
| grok | **Spike**：本 repo 找不到 system prompt／allowlist 旗標的實測紀錄 | **Spike** | **Spike** | **Spike** | 否 | `scripts/lib/grok-effort.sh` 只管 effort；不當事實寫 |
| opencode | `--agent` 加 `{file:}`（`multi-agent-portability.md:141-145`）；`OPENCODE_DISABLE_PROJECT_CONFIG=1` 實測有效 | **Spike**（本文沒查到 allowlist 實測） | 讀 `.agents/skills`、`.opencode/skills`（文件） | agent body 檔 | 否 | `references/multi-agent-portability.md:13-16,101-125` |
| cc-shim | 走 claude CLI 外殼對接別家端點；**Spike**：是否通過 `--system-prompt`/`--tools` 未驗 | **Spike** | **Spike** | n/a | 否（rail 對 non-claude-native 全拒） | `references/hetero-dispatch.md:239,774` |

**結論**：P2 要用的成員 harness 只能是 **claude-native**（唯一 verified 且 rail 已接）。kimi 是第二順位（有 A/B 的 weak2 席，但需要先為 rail 補 `--role-kit` 的 kimi 分支，現在沒有）。其餘 harness 的成員支援先不承諾。

## 5. PM 草稿 §4 介面表（填好）

### 5.1 已填的表

| 題目 | PM 的初步想法 | autopilot 回覆 |
|---|---|---|
| 角色名稱 | 兩邊用同一份角色清單 | **部分不同意**。兩邊是兩個命名空間：autopilot 的是派工角色（`src/engine/roles.js` 的 owner／implementer／reviewer／verification_author／explorer，加 pilot 的 planner、debugger 六個 kit，`evals/rolekit/README.md`）；PM 的是組織角色（art、consultant…）。建議：**組織角色是登記表的鍵，每一列指向一個 kit 名稱**（art → 某個 kit）；kit 名稱由 autopilot 管，不要求與組織角色一對一。現在**沒有 art 或 consultant 的 kit**，開美術成員前要先做 kit（§7 phase C） |
| kit 版本 | 登記表記 kit sha；kit 升版時，成員下次叫醒才換 | **同意，加兩點**。(1) 這個 sha 現在不存在，要蓋 `kit_sha256`（§4.1，涵蓋 role.md＋tools＋plugin 樹）；現有記錄只有 role.md 與 tools 的 sha，plugin 內容沒涵蓋（`role-kit.js:113-119`）。(2) 成員**預設 pin 住**，不自動跟升；升版是組長改 pin 的明確動作（§4.4 第 6 步），不是「下次叫醒自動換」，否則經驗是在 A 版寫的、卻在未評測的 B 版上用 |
| 經驗放哪 | 成員目錄放在團隊 repo；kit 本身放在 autopilot | **同意，加規則**。經驗**不得**放進 kit 目錄、role.md、plugin/（會改動 kit 摘要並讓 A/B 的 pin 失效，§4.3）。另有**名稱碰撞**：autopilot 3.0.0 預留的頂層 `roles/`（`rolekit-direction.md` §3.4、E1）是放 kit 的；PM 草稿的團隊 repo `roles/<角色>/` 是放成員目錄。兩個 repo 各自的 `roles/` 不衝突，但文件要寫清楚，建議成員目錄改名 `members/<成員 id>/` 以免混用（未決 §9 Q6）。成員只在輸出 JSON 提經驗，由呼叫者寫入（§4.3） |
| 休眠／叫醒 | 休眠時沒有 session；叫醒就是「派工時帶 kit 加目錄」 | **同意，就是 per-task headless**（§4.2）。叫醒的具體動作 = 呼叫者組 `member_brief`（§4.3）＋ `--role-kit <登記的 kit 路徑> --expect-kit-sha <登記表的摘要>` 派工；休眠不需任何 autopilot 動作 |
| 權限怎麼落實 | 登記表定權限；派工時由 kit 的設定和 hook 強制執行 | **不同意「由 kit 強制」**。kit 的 `tools` 只是工具面縮減（最小權限的一層），不是安全邊界：只要白名單含 `Bash`，成員就能 `git` 任何東西；kit 的 plugin hook 也是 kit 作者寫的，成員無法靠它防自己。「能提交素材到分支、不能合 main、不能下 go」要靠**派工參數與外部閘門**：worktree 隔離＋rail 的 protected path／main 檢查（`scripts/lib/main-checkout-boundary.sh`）、合併 gate（root `CLAUDE.md` Process rules）、fleet 的 go 規則（成員不是 attested PM，所以它的訊息不構成 go）。登記表的權限欄 → 翻成派工旗標的對照表要另寫（§7 phase B）。kit 的 `tools` 取登記表權限的子集，兩者不一致時取較嚴 |
| fleet 身分 | 每個成員一個地址，或共用組長的地址並帶上角色標籤？ | **建議共用組長地址＋標籤**。headless 成員沒有常駐 session，沒有可收訊息的 fleet 座位；給它一個地址就得有人常駐，違反 §4.2。成員 id 與 kit 摘要放在**任務 payload 與結果 JSON**（`member_id`、`kit_sha256`），監看看的是 lease 與任務事件，不看成員地址。若 P2 之後改常駐，再加地址 |

### 5.2 開放問題（PM 草稿 §5）的機制側回答

- 成員要不要有自己的 fleet 地址：見上，**P2 不要**。
- 競賽 session 的「觀察成員」：機制側無意見；它們不經 rail，不吃 kit。標記為「不可派工」屬登記表欄位。
- kit 的 A/B 證據要不要當開放前提：**部分是**。建議區分：(a) 開放「用 standard／strong 模型、只借 kit 的工具縮減與 skill 組合」的成員，**不需要**等正式 A/B（pilot 通過儀器檢查即可，因為不主張「弱模型也做得好」）；(b) 開放「cheap 等級成員、期待靠 kit 補足」，**需要**正式 A/B 成立（rolekit 方向 KR2：≥ 3 個角色 B 對 A 縮小差距 ≥ 50% 且勝過安慰劑），否則等於把未證實的主張變成登記表上的設定。

## 6. 與 PM 草稿不同意之處（彙整）

1. **角色清單不是同一份**（§5.1 第一列）：兩個命名空間，用登記表對應；現在沒有 art／consultant kit。
2. **權限不由 kit 強制**（§5.1）：kit 只縮工具面；真正的權限靠派工參數與外部閘門。
3. **升版不自動跟**（§5.1）：預設 pin，升版是組長的明確動作，因為經驗是在舊版下累積的、新版必須先評測。
4. **登記表要記的「kit sha」目前不存在**（§4.1）：現有記錄漏了 plugin 內容。
5. **經驗不得進 kit 目錄**，且成員不直接寫目錄（§4.3）；`roles/` 名稱兩邊會撞，建議成員目錄改名。
6. **P2 不給成員獨立 fleet 地址**（§4.2、§5.1）。
7. **A/B 證據只是「cheap 成員」的前提，不是整個捏麵人的前提**（§5.2）。

## 7. File-structure map 與 Phases

僅列**本計畫之後才做**的實作；本次只提交本文件與 INDEX 一列。

| 檔案 | 責任 |
|---|---|
| `scripts/lib/role-kit.js`、`scripts/lib/role-kit.sh` | 加 `kit_sha256` 摘要；輸出行數同步（現為 6）；`--expect-kit-sha` 比對 |
| `scripts/dispatch-hetero.sh`、`dispatch-review.sh`、`dispatch-author.sh` | 加 `--expect-kit-sha`；結果 JSON／manifest 加 `kit_sha256`、`member_id`、`member_brief_sha256`、`member_dir_commit` |
| 新：成員快照腳本（Node 內建） | 從成員目錄的指定 commit 組 `member_brief`；確定性選條目；位元組上限 |
| 新：經驗寫回腳本 | 驗 `experience_proposals` 格式與條目上限後 commit |
| `references/hetero-dispatch.md`、`docs/scripts-inventory.md`、`scripts/CLAUDE.md` | 新旗標與新腳本接線（否則是 dead code，`scripts/CLAUDE.md` 規則） |

| Phase | 內容 | Size | 驗收（done when） |
|---|---|---|---|
| A | `kit_sha256` 與 `--expect-kit-sha`（機制，不改要求文字） | S | 改 plugin 內一個檔案，摘要必變；`--expect-kit-sha` 錯誤在 spawn 前被拒（負控制先紅後綠）；既有 `hooks/tests/role-kit-rails.test.sh` 的「無旗標時 argv 與 env 位元組相同」仍綠 |
| B | 登記表權限欄 → 派工旗標的對照表（文件）＋ kit `tools` 取較嚴的檢查 | S | 每個權限值對應到一個旗標或外部閘門；對照表缺值時登記被拒 |
| C | 成員快照與經驗寫回腳本；至少一個角色（建議遊戲線美術，章程 §14 P2 的試點）的 kit 草稿 | M | 同一個 `member_brief` 位元組可重現（同 commit 同輸出）；超過上限被截斷並記錄；寫回格式錯誤被拒；子行程無成員目錄寫入權（用測試證明） |
| D | 升格流程（§4.4）的小型 A/B 範本，沿用 `evals/rolekit/` 的 stamp／score | M | 一次完整演練：舊 kit 對新 kit＋安慰劑、prereg 先蓋章、機械判定；回滾演練（pin 改回舊摘要）成功 |
| E（等 §8 的條件） | kimi 的 `--role-kit` 分支（agent file） | M | 先有 Spike：kimi 空 `tools: []` 與模型是否照卡做；rail 以負控制拒絕帶 plugin 的 kit |

## 8. 與 rolekit A/B 的先後次序

**誰擋誰**：
- **role-members 不擋 A/B，A/B 也不擋 phase A、B 的設計與實作**，但有三條不可違反的凍結規則：
  1. **pilot 蓋章期間（`prereg/FROZEN.json` 與 receipt 已寫入）不得改 `role-kit.js` 的輸出契約**。phase A 新增一行輸出會改變 `compile-kit.js` 與 rail 之間對 kit 驗證的假設；`evals/rolekit/compile-kit.js` 自己有一套 validator，兩套必須維持行為一致。做法：phase A 先**加欄位不改既有欄位**，且不動 `evals/rolekit/` 內任何被蓋章的檔案（rail 側的改動只在 `scripts/`）；`kit_sha256` 對 A/B 的 kit 是新增資訊，不影響其判定。
  2. **成員經驗不得寫進任何已蓋章的 kit**（§4.4 gate）。
  3. **pilot 要用的儀器（`stamp-rolekit.js`、`score-rolekit.js`、`lib-identity.js`）是信任根**（`evals/rolekit/README.md`），phase D 重用而不修改它們；需要改就另立副本。
- **被 A/B 擋的**：只有「cheap 成員」的開放（§5.2）。standard／strong 成員不需等。
- **pilot 結果會影響本計畫**：若 pilot 顯示 B 不優於 A 或 C，kit 的價值主張要退回「工具縮減＋隔離」，成員機制仍成立但 phase D 的升格 A/B 價值下降，需回頭問 PM 是否還要做。

**建議順序**（pipeline：每格在上一格進行時先備好下一格）：
1. 現在：本文 plan review（凍結 rubric、最多兩代）。不碰 `evals/rolekit/`。
2. pilot 蓋章與 pilot 執行（PM 與 railkit lane 的路徑，既有計畫）。同時期可做 phase B（純文件）與 phase C 的**設計**（不改 role-kit 契約）。
3. pilot 結果出來後：phase A（機制）→ phase C 的腳本。若 pilot 為 PILOT_FIX，則 A 先暫停，先修儀器。
4. 正式 A/B 蓋章前不動 `evals/rolekit/`；正式跑期間只做 phase C、D 的 CPU 準備（不花 GPU／額度）。
5. P2 開放：先 standard 等級的遊戲線美術一位；cheap 等級等正式 A/B。
6. phase D 的演練在第一次真實升版需要之前做完；phase E 在 kimi 作為正式 weak2 席被證實之後。

## 9. 非目標

- 不寫程式、不改測試、不改任何 dispatch 預設（本次只交計畫）。
- 不做常駐 member session、不做成員自己的 fleet 地址（P2）。
- 不重寫 skill 內容、不做 skill 的版本管理（scorecard-first 另案）。
- 不做 codex、agy、grok、opencode、cc-shim 的 kit 支援（先 Spike，不承諾）。
- 不做成員之間的通訊、成員開成員（章程 §8 已禁）。
- 不做權限的安全邊界（靠派工旗標與外部閘門，不靠 kit）。
- 不新增信任機制（雜湊鏈、attestation；ADR-0001）。`kit_sha256` 是重算比對，不是簽章。
- 不處理登記表本身的格式與生命週期（PM 側）。

## 10. 未決問題（給 PM）

1. **角色對照**：同意用「登記表鍵 = 組織角色，指向 kit 名稱」嗎？美術的 kit 由誰、何時做（phase C）？
2. **權限**：登記表權限欄到派工旗標的對照表（phase B），要不要先由 PM 列出 P2 會用到的權限種類（提交分支、讀 repo、跑測試…）？
3. **常駐 vs headless**：同意 P2 只做 headless 嗎？若有人想要可插話的成員，是否接受「那是組長的 session，不是成員」？
4. **`member_brief` 上限**：起點 4 KiB 夠嗎？超過時優先保留哪類條目？（待 pilot 之後用實測定）
5. **升版頻率與豁免**：每次升版都要小型 A/B 嗎，還是設批次門檻？純文字澄清是否可免評測（現行規則下不可免）？
6. **成員目錄命名**：`roles/<角色>/`（PM 草稿）還是 `members/<成員 id>/`，以免與 autopilot 預留的頂層 `roles/` 混淆？
7. **cheap 成員的開放門檻**：同意以正式 A/B 的 rolekit KR2 為準嗎？
8. **Spike 排程**：`--add-dir`（讀成員目錄的替代方式）、grok、cc-shim、opencode 工具白名單、kimi 空 `tools: []`——哪些值得花 haiku 額度？機制側建議只做 kimi 那一項（它是唯一排得進 phase E 的）。
9. **A/B 是 pilot 還是正式才算前提**：同意 §5.2 的分法嗎？
10. **`roles/` 預留**：頂層 `roles/` 目前只在計畫層級預留（relayout E1），layout-lint 是否已實際強制（頂層白名單與匯出白名單）未驗證；PM 要不要先確認，再決定 kit 放 `roles/kits/` 還是別處？

## 11. Test / validation（本計畫）

- 本次提交的檢查：`node scripts/check-plan-graduation.js`（註冊）、`node scripts/doc-drift-gate.js`、pre-commit 的 leak-guard。
- 各 phase 的驗收見 §7；每個新檢查附負控制（root `CLAUDE.md`、evidence-discipline §58）。

## 12. Risks + inversion

- 摘要不涵蓋某類檔案（如 plugin 的隱藏檔），兩個不同 kit 同摘要。對策：phase A 的負控制涵蓋 plugin 內新增、改名、改模式、隱藏檔。
- 經驗悄悄變成 guidance：成員提案被組長原封不動貼進 kit。對策：升格走 §4.4 全流程，不豁免。
- brief 太大壓過任務本體，弱模型表現下降。對策：上限＋ pilot 後再定；先量後訂。
- 把「kit tools」當權限邊界。對策：§5.1 明文，phase B 對照表。
- 反向：若什麼都不做，登記表上的「kit sha」是個填不出來的欄位，稽核形同虛設。

## 13. Out of scope

見上方「非目標」（§9）。

## 14. Open questions

見上方「未決問題」（§10）。

## Review log

- R0 2026-11-05：作者 hands（plan author, lane rolemem）；plan review manifest 與 frozen rubric 尚未建立；Generation 0。

## 附錄 A：PM 組織側草稿 role-members.md v0.1（原文，2026-11-05）

替換清單：無。原文檢查過，沒有絕對路徑、主機名、使用者名、信箱或憑證（「token」只出現在預算字樣）。
排版調整（不改字句）：原文的標題層級下調兩級以收進本附錄；§4 表格「待 autopilot 回覆」欄改為指向本文對應章節。

### 角色成員（捏麵人）設計草稿 v0.1（2026-11-05）

狀態：草稿，PM 與 autopilot 共同設計中。章程 v1 §8 的細節版。依操作員 11-05 的決定，遊戲組長先上，但捏麵人要到 P2 才開放；草稿現在就先寫，好讓雙方一起設計。
操作員原話：「捏麵人那裏可以先起 draft，那個框架會跟 autopilot 依 role 派遣不同 skill 有一些相關？也許先有 draft 比較容易協同設計？」

#### 1. 一句話

**角色成員 = 一套 role kit（autopilot 的機制側）＋ 一個長期身分（組織側）。**
role kit 定的是「這個角色怎麼做事」：CLAUDE.md、skill set、模型等級。長期身分定的是「這個成員是誰、能做什麼、記得什麼」：登記、權限、預算、期限、專屬目錄、監看。
autopilot 的 rolekit 方向（d-c76529c3：讓弱模型靠角色專屬的 kit 做出好結果）負責前者；章程負責後者。兩邊共用同一個角色名稱和同一個 kit 版本號。

#### 2. 組織側（PM 負責，本草稿先寫）

##### 2.1 誰可以開、能開多少
- 只有組長可以開，而且只能在自己團隊的配額內開：人數上限、token 預算、同時在跑的數量都有上限。
- 成員不能再開成員，不能遞迴。新增角色也不會讓團隊的總配額變多。
- 開完要向 PM 登記，不需要操作員的卡。超出配額要開卡。

##### 2.2 登記表的欄位（角色登記表的一列）
| 欄位 | 例 |
|---|---|
| 團隊 / 角色 | game / art |
| 成員 id | game-art-1 |
| role kit 與版本 | kit:art@<sha>（由 autopilot 定格式） |
| 模型等級 | cheap / standard / strong |
| fleet 地址與標籤 | 標籤顯示「game·art」 |
| 權限 | 例：可以提交素材到分支；不能合 main、不能下 go |
| 預算 | 每天 token 上限；GPU slot（多半是 0） |
| 期限（TTL） | 預設 7 天，到期由組長續約或退役 |
| 收哪些訊息、多久要回 | 只收組長派的工單；回應 30 分鐘 |
| 替補 | 組長 |

##### 2.3 生命週期
開出 → 做事（一次一張主工單）→ 閒置超過時限就休眠 → 有工作再叫醒 → 到期或不需要了就退役（退役前先交接）。
休眠時不佔 session，只留目錄。叫醒的方式是帶著 kit 和目錄重新派工（細節見 §3 的介面）。

##### 2.4 專屬目錄
放在團隊 repo 的 `roles/<角色>/`（或成員 id），固定三個檔：
- `職責.md`：這個角色做什麼、不做什麼、驗收標準。由組長寫。
- `經驗.md`：每條的格式是「情境、做法、證據、適用範圍」。篇幅有上限（例如 100 條），超過就必須合併。由成員自己寫。
- `未決問題.md`：還沒解決的問題，交接時要清空或轉交出去。

##### 2.5 經驗怎麼升格
成員自己寫的經驗，先只在成員目錄裡用。
要升格成團隊共用的知識，或寫進 role kit 本身，必須先經過另一家模型的審查席審過，看證據是不是撐得住、適用範圍有沒有寫對，免得把巧合當成鐵律傳下去。

##### 2.6 監看與成本
成員的工單一樣受 courier lease 監看（章程 §6），用量每天一行列在團隊的成本裡（章程 §11）。

#### 3. 機制側（autopilot 負責，待填）

請 autopilot 依 rolekit 方向補上：
1. role kit 的格式和版本怎麼定：CLAUDE.md、skill 清單、模型等級、預設權限。
2. 成員要用什麼方式跑：每次派工都重新起一個 headless session，還是常駐 session？兩種的取捨。
3. 成員目錄怎麼跟 kit 一起帶進 session：叫醒時怎麼帶目錄，`經驗.md` 怎麼載入，要不要限制篇幅。
4. 經驗升格成 kit 新版本的流程：誰提、誰審、怎麼做 A/B。
5. 不同 harness 的支援範圍：Claude Code、Codex、其他引擎，各自能帶哪些東西。

#### 4. 介面（雙方要對齊的）

| 題目 | PM 的初步想法 | 待 autopilot 回覆 |
|---|---|---|
| 角色名稱 | 兩邊用同一份角色清單 | 見本文 §5.1 第 1 列、§6 第 1 點 |
| kit 版本 | 登記表記 kit sha；kit 升版時，成員下次叫醒才換 | 見本文 §4.1、§5.1 第 2 列 |
| 經驗放哪 | 成員目錄放在團隊 repo；kit 本身放在 autopilot | 見本文 §4.3、§5.1 第 3 列 |
| 休眠／叫醒 | 休眠時沒有 session；叫醒就是「派工時帶 kit 加目錄」 | 見本文 §4.2、§5.1 第 4 列 |
| 權限怎麼落實 | 登記表定權限；派工時由 kit 的設定和 hook 強制執行 | 見本文 §5.1 第 5 列（不同意由 kit 強制） |
| fleet 身分 | 每個成員一個地址，或共用組長的地址並帶上角色標籤？ | 見本文 §5.1 第 6 列 |

#### 5. 開放問題
- 成員要不要有自己的 fleet 地址？有的話好監看，但地址會變多。
- 遊戲競賽那幾個 session 不能被派工，它們要不要另外列成「觀察成員」？
- kit 的 A/B 證據（autopilot 正在做的弱模型實驗），要不要當作開放捏麵人的前提？

#### 6. 下一步
1. autopilot 在 W 推送後補 §3 和 §4，放進 autopilot repo 的 plan，這份草稿只留連結。
2. 雙方的版本合起來，走一次 hetero plan review。
3. P2 開放前先在遊戲線試一個角色（例如美術）。
