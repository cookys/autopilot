# PM 席開機預載 context 逐塊處置建議（席位：neon）

> Fleet-Task: `01M85GR9EGYY5N3YKK4HF87Z1H` ｜ 評估對象：PM 席壓縮後預載盤點（`preload-inventory.md`，壓縮後首回合合計 `136,747` tokens）
> 評審原則：依「Checks earn their place」，每塊必須能說出刪掉後會回來的真實失敗（具體輸入／狀態 → 錯誤結果），說不出來就歸「刪」；查不到實證的明確寫「未查到」與還缺的證據，不猜測。

## 總表

> **計數口徑說明**：下表分為「每次啟動固定預載」、「壓縮／長對話帶回（非冷開機）」、「未歸類差額 88k」與「每 prompt／工具呼叫重複注入（不計入首輪 136.7k）」四組，避免重複計算省量。表中 `est. tokens` 全數取自 `preload-inventory.md`。

| 區塊 | 現在 token | 處置 | 預估省多少 | 刪掉後回來的失敗 | 負責的檔案 |
|---|---:|---|---:|---|---|
| **一、每次啟動固定預載** | | | | | |
| 全域 `CLAUDE.md` | 5,306 | 改寫壓短 | ~3,000–3,500 | 若全刪：面對 Tier-2 破壞操作、憑證／`~/.claude` 越權請求或 peer 訊息假傳指令時喪失紅線與授權邊界；退回「測綠即 done」、手跑重複流程與簡體漂移 | `/home/cookys/.claude/CLAUDE.md`（授權全表另拆 `~/.claude/authority-table.md`） |
| host 檔（`CLAUDE.host.md`） | 未查到 | 維持（未查到，待補量測） | 未查到 | 未查到實體內容；若存在且承載本機專屬硬體／路徑禁區，全刪可能誤觸本機限制，但重複全域規則者應刪 | `~/.claude/CLAUDE.host.md`（由 `hangar` 維護） |
| repo `CLAUDE.md`（PM） | 1,623 | 改寫壓短 | ~900–1,050 | 若全刪：壓縮後遺失 Goal 區塊與「PM 不代 lane 動手」定位；在 `pm` repo commit／ledger 洩漏主機名、內網 IP 或帳號名（lab pre-commit hook 僅為 `warn` 模式） | `/home/cookys/projects/pm/CLAUDE.md` |
| `MEMORY.md` 索引（108 行） | 4,379 | 改成按需載入 | ~3,200–3,500 | 若全刪：私有資料誤派中國雲端、額度未滿 100% 提前重置、誤用 `fleet reject` 終結待補證據工單、未查證轉述 lane 錯訊、誤刪／遮罩 transcript；但僅約 20 條需常駐，其餘 ~85 條重複或長尾可刪／按需查 | `/home/cookys/.claude/projects/-home-cookys-projects-pm/memory/MEMORY.md` |
| Skill 清單（70 個）— 重複 `fleet-usage` | ~170 | 刪 | ~170 | 無（與 `autopilot:fleet-usage` 逐字重複） | `~/.claude/skills/` 或重複掛載設定 |
| Skill 清單（70 個）— 其餘 69 個 | ~7,152 | 改成按需載入 | ~5,300–6,000 | 若全刪：收到觸發語時不載入 `lead-watch`／`hetero-review`／`handoff`／`fleet-usage`，退回自創流程或 shell `sleep` 輪詢；但 PM 不寫碼，停用無關外掛並壓短 `SKILL.md` 描述不會讓失敗回來 | `/home/cookys/projects/autopilot/skills/*/SKILL.md`、`~/.claude/settings.json` |
| MCP instructions — `autopilot`／`easel`／`plugin-authoring` | ~51 | 刪 | ~51 | 無（純樣板佔位句「Tools registered by ...」，零行為約束；後兩外掛在 PM 席本身也不需要） | `autopilot`／`cc-plugin-easel`／`cc-plugin-plugin-authoring` 外掛註冊處、`~/.claude/settings.json` |
| MCP instructions — `claude.ai Claude Docs` | ~490 | 刪 | ~490 | 無（PM 席不走 Claude Docs 協作，改以面板與 HTML Artifact 回報；真需使用時再按需載入） | `~/.claude/settings.json`（或 claude.ai connector 啟用設定） |
| MCP instructions — `fleet` | ~751 | 改寫壓短 | ~500–550 | 若全刪：在未載入 `fleet` 工具前誤用 shell `fleet send`（回覆掉進無席位讀的 inbox）或直接貼 >50 行大檔進訊息；但重複列舉 22 工具與 `fyi` 說明可刪 | `/home/cookys/projects/fleet/plugins/lib/tools/tools.ts` |
| `SessionStart` hook — 固定前導（skill 簡介表等） | ~625 | 改寫壓短 | ~450–520 | 若連動態待派卡片行也刪：重開／壓縮後漏派已答覆的 `pending_dispatch` 卡；但 12 列 skill 表與 `Skill listing` 完全重複、brief 格式已有 hook 機械擋，皆無真實失敗回來 | `src/hooks/handlers/session-start.js`、`hooks/session-start.js` |
| `SessionStart:compact hook 3`（空輸出） | 0 | 刪（需先核對設定） | 0 | 未查到對應腳本；若確認為空殼殘留，刪掉無失敗回來且省開機行程開銷 | `~/.claude/settings.json` |
| Deferred tool 清單（67 工具） | 2,022 | 改寫壓短 | ~250–350 | 若全刪：不知道可 `ToolSearch` 載入 `fleet` MCP 工具而改跑 shell CLI；但停用未認證 Gmail／Calendar／Drive、Claude Docs、easel、plugin-authoring 共 16 個工具無失敗回來（內建 28 工具屬 harness 不可改） | `~/.claude/settings.json`、`/home/cookys/projects/fleet/plugins/lib/tools/tools.ts` |
| Agent types 清單 — `autopilot:README` | ~14 | 刪 | ~14 | 無（將說明文件誤掃為 `All tools` agent 屬 bug，刪掉反而消除誤派風險） | `agents/README.md`（移出 `agents/` 目錄） |
| Agent types 清單 — 其餘 10 個 | ~1,473 | 改寫壓短 | ~170–190 | 若全刪 autopilot 3 代理：lane 無法派發 `reviewer`／`debugger`／`planner`；僅壓短 3 檔 frontmatter 描述無失敗回來（內建 7 代理屬 harness 不可改） | `agents/debugger.md`、`agents/planner.md`、`agents/reviewer.md` |
| Harness 固定小欄位（`session_context`、`date`、`env`、`model`、`language`、`advisor`、`org`、`remote`） | 461 | 維持 | 0 | harness 內建基礎狀態；缺少日期／cwd／模型／語言會導致時間判斷、路徑與語系錯亂 | Claude Code harness（不可控） |
| `Session cron carry`（每小時巡查排程） | 190 | 改寫壓短 | ~130 | 若全刪：每小時巡查排程失效；將 260 字規則外移至檔案、cron prompt 縮成 1 行指令不會讓巡查失效 | `/home/cookys/projects/pm/scripts/patrol-classify.py`（新增巡查規則檔與精簡 cron） |
| **二、壓縮／長對話帶回（非每次冷開機）** | | | | | |
| `restored-state`（`SessionStart` 內嵌 `<autopilot-restored-state>`） | ~1,875 | 改成按需載入 | ~1,300–1,500 | 若全刪：壓縮前後到達的 fleet 訊息會被漏讀；但目前 68 筆 `Operator initiatives`（含 39 筆 `no_task` 與 25 筆 `stale_24h`）把 9,999 字元上限撐爆，反把真正的工作狀態截斷 | `scripts/lib/compaction-handoff.js`、`hooks/state-checkpoint.js`、`~/projects/pm/scripts/initiatives.sh` |
| `restored-state`（獨立 handoff 檔 `rec 14126`） | 911 | 改寫壓短 | ~450–550 | 若全刪：harness 摘要易漏精準單號、卡號、換池門檻（如 96%）與最新 P0 約束；精簡掉「今晚完成」歷史回顧並只留未結動作不會漏狀態 | `skills/handoff/SKILL.md`、`scripts/lib/compaction-handoff.js` |
| `Compaction summary`（`rec 14125`） | 3,654 | 改寫壓短 | ~1,000–1,500 | 若全刪：壓縮後完全失去前段脈絡與待回覆診斷；移除摘要中重抄的安全規則清單與逐字巡查文案不影響續做 | `hooks/state-checkpoint.js`（`PreCompact` 摘要指示） |
| `Restored files / memory files`（4 個檔案） | 1,711 | 改成按需載入 | ~800–1,500 | `scratchpad/design/index.html`（836 tok）已選完定案，刪掉無任何失敗回來；其餘記憶檔需時再讀即可（屬 harness 恢復近期 `Read` 機制，主席避免直接讀大檔即可迴避） | `/home/cookys/projects/pm/CLAUDE.md`（規範主席委派子代理讀大檔）＋ Claude Code harness |
| Deferred tool schema — `Artifact`（1 工具） | ~9,000 | 改成按需載入 | ~9,000 | 若 PM 完全不發 Artifact：操作員看不到視覺頁面（違反 `images-via-artifact`）；但改由一次性子代理發布，操作員照拿連結且 PM 主席永不載入這 9k schema | `/home/cookys/projects/pm/CLAUDE.md`（發布 Artifact 改派輕量 subagent） |
| Deferred tool schema — `fleet` 9 工具 | ~6,428 | 改寫壓短 | ~3,800–4,300 | 若全刪：無法透過 MCP 派單與回覆；但拔除跨工具重複 3–5 次的 `fyi`／`attachments` 長文、`DEPRECATED` 參數與過期日期文案無任何失敗回來 | `/home/cookys/projects/fleet/plugins/lib/tools/tools.ts` |
| **三、未歸類的 88k（`Remainder: 88,461`）** | | | | | |
| 其中已知：`system` + 核心 `tools`（`api-request-shape` 交叉量測） | ~30,260（可能與上列 15.4k 重疊） | 維持 | 0 | harness 系統提示詞與核心內建工具定義，不可由專案刪除；僅能靠關閉非必要 MCP 減少工具數量 | Claude Code harness（不可控） |
| 其中未知：剩餘未歸類區塊（詳見正文對帳） | ~58,201（若與 15.4k 重疊則達 ~73,629） | 維持（未查到，待補證據） | 未查到 | **未查到**實際內容、確切大小與是否每次冷開機載入；禁止猜測，須先補抓 `rec 14121`、`rec 14154`、`rec 14155..14290` 與冷開機樣本 | 待驗證：Claude Code harness 壓縮尾段／`data-flow-records`／PM transcript |
| **四、每 prompt／工具呼叫重複注入（不計入首輪 136.7k）** | | | | | |
| `UserPromptSubmit` hooks（5 支條件觸發） | 首輪 0（觸發時 ~30–500／次） | 改寫壓短 | 每次誤觸省 ~300–500（累計未查到） | 刪 `advisory-relay` 會漏驗簽關卡與送達；刪 `scheduled-wakeup-guard` 會把自喚醒當授權；刪 `past-reference-recall` 會在被追問時漏查紀錄。收緊 `past-reference-recall` 單字「又」觸發不會讓失敗回來 | `hooks/past-reference-recall.js`、`hooks/advisory-relay.js`、`hooks/scheduled-wakeup-guard.js`、`hooks/bg-quiet-sweep.js` |
| `task_reminder`（每 prompt，出現 164 次） | ~9／次（累計 ~1,476） | 維持 | 0 | 內容為空陣列，理論上可刪且無失敗回來，但屬 harness 內建不可控 | Claude Code harness（不可控） |
| `silent_turn_reminder`（出現 56 次） | ~28／次（累計 ~1,568） | 維持 | 0 | 屬 harness 內建；長串工具呼叫時提醒告知操作員進度，防誤判卡死 | Claude Code harness（不可控） |
| `auto_mode`（出現 5 次） | ~37／次（累計 ~185） | 維持 | 0 | 屬 harness 內建狀態旗標，總量極小 | Claude Code harness（不可控） |
| `queued_command`（fleet 進站訊息） | ~185–310／則 | 改寫壓短 | 長對話估省進站雜訊 30%–50% | 若全刪：收不到 lane 回報；精簡外殼欄位並過濾 FYI／patrol 噪音不影響有效訊息送達，反防重要回報被洗掉 | `/home/cookys/projects/fleet/plugins/`、`/home/cookys/projects/pm/scripts/patrol-classify.py` |
| `PreToolUse:Agent hook_additional_context` | ~125–150／次 | 改寫壓短 | 安全派工 100%（~125–150／次） | 若刪整支 `subagent-budget.js`：會重演單一 lane 失控連派百個子代理燒預算的事故；但低於 80% 安全區改為靜默、僅 ≥80% 或違規才注入，不會讓失控回來 | `hooks/subagent-budget.js`、`hooks/dispatch-model-guard.js` |

---

## 一、總量對帳與 `preload-inventory.md` 算術勘誤

在進入逐塊理由前，先釐清 `136,747` tokens 的帳目結構，以免後續優化瞄錯目標：

1. **表 1 加總核對**：將 `preload-inventory.md` 第 1 節 25 列逐項相加，合計確為 **`48,286` tokens**；但其中**已包含**第 22 列 `Deferred tool schema record (10 tools, full input_schema)` 的 **`15,428` tokens**（`rec 14282`），扣除該列後其餘 24 列僅為 `32,858` tokens。
2. **拆解每次冷開機 vs 壓縮後殘留**：
   - 表 1 中「每次開機必載」（`loaded every session? = y`）的區塊，再加上排程 `cron`：合計約 **`24,246` tokens**（其中約 `21.6k` 為專案與設定可控，約 `2.6k` 為內建 deferred／agent 清單）。
   - 表 1 中「僅壓縮後或已展開工具才帶回」（`loaded every session? = n`）的區塊：合計 **`23,579` tokens**（`Compaction summary` `3,654`＋`Handoff` `911`＋4 個 `Restored files` `1,711`＋`Deferred tool schema 10 工具` `15,428`＋`SessionStart` 內嵌 `restored-state` 約 `1,875`）。
3. **指出 `preload-inventory.md` 第 2 節關於重疊（overlap）的算術反號錯誤**：
   - 盤點檔原註：「若 `Deferred tool schema record`（`15,428` tokens）已含在 `tools` 裡，則真實 remainder 會更小」。**這在代數上方向相反**：
     - 總實測為 `136,747`，`api-request-shape`（`rec 14154`）測得 `system`（`9,473` chars ≈ `2,368` tok）＋ `tools`（`111,568` chars ≈ `27,892` tok）≈ **`30,260` tokens**。
     - **情況 A（無重疊：`rec 14282` 不在 `rec 14154` 的 `tools` 裡）**：已解釋量 ＝ `48,286 + 30,260 = 78,546` → 真正未歸類缺口為 **`58,201` tokens**。
     - **情況 B（有重疊：`rec 14282` 已含在 `rec 14154` 的 `tools` 裡）**：代表 `48,286` 與 `30,260` 重複算了 `15,428`，去重後已解釋量降為 `48,286 - 15,428 + 30,260 = 63,118` → 真正未歸類缺口反而**擴大為 `73,629` tokens**！
   - 另 `chars/4` 相對實際 BPE tokenizer 在 JSON schema、ULID 與中英混排上可能存在 ±10%–20% 估算偏差（約 ±5k–12k），但遠不足以解釋 `58k–73k` 的缺口。

---

## 二、逐塊詳細判斷理由

### 1. 全域 `CLAUDE.md`（5,306 tok → 改寫壓短，預估省 ~3,000–3,500 tok）
- **問題診斷**：
  1. `Authority table`＋附註＋`Delivered operator answers` 合計約 **2,500 tokens（佔整份近半）**。全機隊所有席位每次開機都被迫預載 9 個角色的完整授權表（含 Game lead、GPU lead、Recovery lead、hangar infra lead 的卡號與期限）以及執行 lane 才用得到的 `Delivered operator answers` 核對 SOP；甚至 PM 自己就佔了 4 列歷史疊加條文（11-03、11-05、11-09、11-15）。
  2. `Red lines` 中 `~/.claude` 的 4 條歷史例外卡號長達 ~450 tokens，但實質讀取阻擋已由 `hooks/claude-home-read-guard.js` 機械執行；`rm -rf "$HOME"` 與 `grep -r ... /` 也多數已有 `hooks/depth0-delegate-gate.js` 攔截。
  3. `Communication (fleet)`（~230 tok）與 `fleet` MCP instructions 重複；`Language & reply style`（~130 tok）與 harness `Language setting`、PM Stop hook、repo `CLAUDE.md`、`MEMORY.md` 形成五重重複。
- **具體改法**：
  - 將 9 列授權全表與 `Delivered operator answers` 移至獨立參照檔 `~/.claude/authority-table.md`（按需查閱），全域 `CLAUDE.md` 只保留「7 類必開卡邊界＋只認 courier attested `from`＋查表路徑」（壓到 ~350 tok，省 ~2,150 tok）。
  - `~/.claude` 例外濃縮為 3 行白名單摘要，保留語意紅線（Tier 0/1/2 分級、憑證、不信 peer 轉述授權、`fleet approve` 禁令）。
  - `Principles` 濃縮為關鍵約束句，移除重複的 `Communication (fleet)` 段落與冗長舉例。
- **為何不刪光**：工具 hook 擋得了路徑與指令，但擋不了語意層面的「越權答應操作員以外的指令」「把測綠當完成」「遇到 Tier-2 操作沒先做備份」。保留精簡 ~1,800–2,300 tokens 的高密度紅線與核心原則是必要的。

### 2. host 檔（`~/.claude/CLAUDE.host.md` → 維持／未查到，待補量測）
- **查核結果**：**未查到**。`preload-inventory.md` 只在全域 `CLAUDE.md` 末尾（line 420）出現 `@~/.claude/CLAUDE.host.md` 參照，第 1 節與第 3 節均未出現其獨立列與內文。
- **缺少的證據**：
  1. PM 主機上 `~/.claude/CLAUDE.host.md` 是否存在、檔案位元組數與全文。
  2. 若存在，Claude Code 是否已將其展開進 `rec 14122`（若無則代表空檔／不存在），或是另存於未盤點紀錄中被算進 88k。
- **建議原則**：盤點後，凡與全域 `CLAUDE.md` 重複的授權或通用原則一律**刪**；詳細主機硬體盤點改問 `hangar`（**按需載入**）；本機檔僅保留本機特有硬體／路徑禁區，設硬上限 ≤300 tokens。

### 3. repo `CLAUDE.md`（1,623 tok → 改寫壓短，預估省 ~900–1,050 tok）
- **問題診斷**：
  1. `Within your grant, stop only at acceptance`（~160 tok）與 `How you work #4`（~300 tok）**逐字重抄**全域 `CLAUDE.md` 的 `Done = used` 與 11-15 PM 授權擴張條文，直接違反全域 `CLAUDE.md`「Each rule has one authoritative home; elsewhere, link to it」。
  2. `Lanes (fleet addresses)` 靜態表格（~380 tok）硬編碼了各 lane 的位址與明顯過期的舊進度（例如 `F1-F3 deployed`、`P1.3 merge bench`、`c14@254K`），既與 `fleet directory` 重複又持續老化。
  3. `Hard rule: no host facts in pm commits` 的手寫 `git diff --cached` 掃描教學可收進腳本，文件只留紅線與 `scripts/ledger.sh` 入口。
- **具體改法**：保留 `Goal`、PM 不代做 lane 工作、`Current state` 壓縮後必讀指標、精簡版 `no host facts` 紅線（3 行），其餘刪除或改連結至 `fleet directory`／`knowledge/pm-sop.md`。目標壓至 ~550–700 tokens。

### 4. `MEMORY.md` 索引（4,379 tok，108 行 → 改成按需載入，預估省 ~3,200–3,500 tok）
- **問題診斷**：
  1. **嚴重違反 14 天落日條款**：全域 `CLAUDE.md` 明定「教訓 14 天內未變成腳本／hook／lint 即刪除」。這 108 行持續只增不減，導致每次開機背負 4.4k tokens。
  2. **約 25–30 條與 `CLAUDE.md` 或既有 hooks 完全重複**：例如 `pm-is-po`、`pipeline-all-resources`、`claude-dir-any-touch-needs-card`、`go-direct-to-executor`、`agents-dont-sleep`、`decide-dont-card`、`reply-traditional-chinese-always`、`pm-commit-scrub-accounts`、`codeforge-main-delegated`、`lane-permission-prompts-pm`、`operator-automate-not-assign`、`fleet-tasks-ssot`、`no-paths-in-pane`，以及已標記「上線即刪」的 `p0-means-spawn-now`、`check-records-before-reasking`、`dispatch-nack-fallback-comment`。
  3. **約 50 條屬於單一專案／硬體／偶發除錯知識**：例如機房位置與進風溫度（`host-room-mapping`、`room-heat-use-inlet`、`operator-home-pcs`、`room-facts-in-hangar`）、ThinkSmart 專屬規則（`thinksmart-emmc-pm-approves`、`thinksmart-desk-not-room`、`ui-ux-director-gate`）、語音專屬（`voice-channel-to-pm`、`voice-gate-auth-not-comms`）、GLM／z.ai／vLLM 除錯細節（`local-model-session-channels`、`zai-coding-plan-endpoints`、`glm-seat-launch-pitfalls`）、DHCP／CJK 寬度渲染等。這些知識只在碰到對應專案時才用得到，完全不該每回合預載！
- **具體改法**：
  - 立即刪除 ~30 條與 `CLAUDE.md`／hooks 重複及過期的項目。
  - 將 ~55 條單一專案／硬體／除錯記憶移出常駐索引，歸入對應 repo 的 SOP／`hangar` 盤點或分類記憶目錄，於處理該專案時按需檢索。
  - `MEMORY.md` 常駐索引設立硬上限 **≤25 行（≤1,000 tokens）**，只留高頻跨專案且尚未機械化的操作員決策偏好與紅線（如 `chinese-model-send-gate`、`transcripts-are-training-data`、`reset-only-when-exhausted`、`rescuer-seats-separate-pools`、`pool-membership-from-real-login`、`filter-operator-asks`、`review-asks-are-cards`、`repeat-cards-numbered`、`no-card-when-already-discussed`、`check-lane-claims-before-relay`、`fleet-reject-is-terminal`、`waiting-on-pm-first`、`correlated-silence-incident`、`batch-lane-messages`、`ship-verified-part-now`、`images-via-artifact`、`check-clock-before-overdue`、`name-the-machine`）。

### 5. Skill 清單（7,322 tok，70 個 skill → 刪重複＋改成按需載入＋壓短，預估省 ~5,500–6,200 tok）
- **問題診斷**：這是每次冷開機可控預載的**第一大宗**。
  1. **明確重複**：`fleet-usage`（line 1863）與 `autopilot:fleet-usage`（line 1875）一字不差出現兩次，純屬多餘。
  2. **描述過度膨脹**：34 個 `autopilot:*` skill 的 frontmatter `description` 平均長達 400–650 字元，塞滿中英雙語舉例與大段 `Not for:` 排除句，合計吃掉 ~4,300 tokens。精簡為「一句定位＋關鍵觸發詞（≤130 字元）」即可，對**所有 lane 席**都能省下 ~2,800 tokens。
  3. **未依角色分流**：PM 席明確規定不寫碼、不除錯、不建 3D 模型、不寫 mod，卻預載了 `img2threejs`、6 個 `autopilot-distill-skills:*`、13 個 `anthropic-skills:*`（`docx`/`pptx`/`xlsx`/`pdf`/`morning` 等）、`plugin-authoring`、`run`、`dataviz`（單條 1,400 chars）、`code-review`（1,100 chars）、`claude-api`（1,000 chars）以及約 22 個 lane 寫碼專用 `autopilot:*` 技能。
- **具體改法**：
  - 立刻刪除重複的 `fleet-usage`。
  - 在 `autopilot` repo 全面精簡 34 個 `SKILL.md` 的 `description` 長度（≤130 字元）。
  - PM 席停用非 PM 角色的 plugin／user skills（`autopilot-distill-skills`、`anthropic-skills`、`img2threejs` 等），PM 僅預載約 8–10 個指揮／協調用 skill（`autopilot:fleet-usage`、`lead-watch`、`agent-call`、`hetero-review`、`handoff`、`learn`、`next`、`think-tank`、`survey`）。
  - **邊界說明**：Claude Code 內建 skill（如 `claude-api`、`code-review`、`dataviz`、`artifact-*`）是否可由設定逐一隱藏，在本輸入中**未查到**實證，保守估計保留 ~1,000–1,500 tokens 內建開銷。

### 6. 各 plugin 的 MCP instructions（1,292 tok → 刪無關外掛＋改寫壓短 `fleet`，預估省 ~1,000–1,100 tok）
- **逐一診斷**：
  - `autopilot`、`easel`、`plugin-authoring`（合計 ~51 tok）：全為無意義佔位句 `"Tools registered by the ... plugin through $.tool.register."`，應直接**刪**；且 `easel` 與 `plugin-authoring` 在 PM 席應整個停用。
  - `claude.ai Claude Docs`（~490 tok）：長篇教模型如何用 `batch`/`guide`/`replace` 寫 Claude Docs，PM 席改用面板與 HTML Artifact，幾乎不碰 Claude Docs，應**刪**（停用該 connector）。
  - `fleet`（~751 tok）：與 `Deferred tool list` 重複列舉 22 個工具名、與 `fleet-usage` 重複 `watch`/`upload`/`fetch` 規格、與 `send`/`reply` 工具 schema 重複 `fyi=true` 定義、與全域 `CLAUDE.md` 重複「dispatch accepted ≠ execution right」。**改寫壓短**成 4–5 行核心路由不變量（約 200 tok），其餘回歸各工具 schema 與 `fleet-usage`。

### 7. `SessionStart` 與 `UserPromptSubmit` hook 注入內容
- **`SessionStart` 固定前導（~625 tok → 改寫壓短，預估省 ~450–520 tok）**：
  - 查核 `src/hooks/handlers/session-start.js`：`BASE_AUTOPILOT_CONTEXT` 注入了一張 12 列 skill 觸發對照表（~320 tok），與 `Skill listing` **100% 重複**，刪掉不會讓任何失敗回來。
  - `Agent brief first lines` 格式樣板已有 `hooks/dispatch-model-guard.js` 在違規時直接拒絕並給範本，無須每次開機預載；`token-discipline.md` 指標與 `show` 工具提示亦屬低效提醒，可刪。
  - **保留**動態待處理卡片行（`Open decision cards`、`Answered, waiting...`、`Answered, not dispatched yet`）與 1 行精簡 `open-decision.js` 入口，防壓縮／重開後漏派已回覆卡片。
- **`SessionStart:compact hook 3`（0 tok）**：inventory 註明未讀取 `~/.claude` 設定，無法確認其腳本用途；若查證為無用空殼則**刪**。
- **`UserPromptSubmit` hooks（首輪 0 tok → 改寫壓短／收緊觸發）**：
  - 查核 `hooks/hooks.json`，autopilot 掛載 5 支 `UserPromptSubmit` hook：`advisory-relay.js`、`past-reference-recall.js`、`scheduled-wakeup-guard.js`、`bg-quiet-sweep.js`、`session-mode-refresh.js`（靜默）。這 5 支皆為條件觸發，首輪未注入。
  - **關鍵發現**：`hooks/past-reference-recall.js`（line 32、77）將單字 **`「又」`** 列為觸發詞（只要後字非「名」即觸發），中文對話極易誤觸（如「又卡住」「又要重開」），每次誤觸最高注入 5 筆 × 240 字元（~300–500 tok）並永久累積在對話紀錄中！建議將單字「又」改為精準詞組（如「又問」「又跳出來」「不是又」），並將 `MAX_HITS` 降為 3、`MAX_HIT_CHARS` 降為 160。因盤點未記錄本 session 觸發次數，累計節省量標記為**未查到**。

### 8. `restored-state` 與壓縮附帶恢復區塊
- **`SessionStart` 內嵌 `<autopilot-restored-state>`（~1,875 tok → 改成按需載入，預估省 ~1,300–1,500 tok）**：
  - **抓出嚴重現有故障**：對照 `preload-inventory.md` lines 808–877 與 `scripts/lib/compaction-handoff.js` lines 556–595、707–728，`Operator initiatives (red never cut)` 被標記為永不截斷，而 `~/projects/pm/scripts/initiatives.sh` 一次吐出 **68 筆 RED**（其中 39 筆是 11-15 以來的歷史對話 `no_task`、25 筆是 `(task not in fleet list) stale_24h` 幽靈舊單！）。這 68 筆吃乾了 `SessionStart` 的 9,999 字元硬上限，觸發 `[...cut to fit the injection limit]`，**直接把原本該恢復的 `Project and Git State`、`Dispatches`、`Session Marker`、`Model Handoff Note`、`Transcript Tail` 全部擠出截斷！**
  - **處置**：(1) 清理 `initiatives.sh` 中已結案或過期的 `no_task`／`stale_24h` 條目；(2) `compaction-handoff.js` 改為將完整 `Operator initiatives` 寫入暫存檔，`<autopilot-restored-state>` 只注入 **1 行計數摘要＋前 5 筆活躍逾期單＋全表路徑**（按需讀取）；(3) `Unanswered Fleet Messages` 過濾掉 patrol wakes，只列最近 ≤5 則真正未回覆的實質訊息。
- **獨立 handoff 檔（`rec 14126`，911 tok → 改寫壓短，預估省 ~450–550 tok）**：
  - 內文與 `Compaction summary` 重複度約 70%–80%（特別是「今晚完成」段落）。保留 handoff 機制，但規定交接檔只寫「未完成單號、卡號、數字門檻與下一步」，不寫已完成回顧，壓在 ≤400 tokens。
- **`Compaction summary`（`rec 14125`，3,654 tok → 改寫壓短，預估省 ~1,000–1,500 tok）**：
  - 內含重複重抄的 11 條安全規則（已在 `CLAUDE.md`）、完整巡查原文（已在 cron）與 24 句已處理完的歷史使用者訊息。可在 `PreCompact` 摘要指示明確要求「不重抄 `CLAUDE.md` 常駐規則、只保留未結案與最後 3 輪互動」。
- **`Restored files / memory files`（4 個檔，1,711 tok → 改成按需載入，預估省 ~800–1,500 tok）**：
  - 其中 `scratchpad/design/index.html`（836 tok）是早已定案的暫存網頁 HTML/CSS，壓縮後被 harness 自動帶回純屬浪費。因該機制在 harness 內部，PM 席實務作法是**主席不直接 `Read` 大型 HTML／暫存檔或長記憶檔**，改派子代理讀取摘要，即可避免壓縮後被自動恢復。

### 9. `Deferred tool list`（2,022 tok）與 `Deferred tool schema record`（15,428 tok）
- **`Deferred tool list`（2,022 tok → 改寫壓短，預估省 ~250–350 tok）**：
  - 67 個工具中，28 個內建工具（~1,500 tok）屬 harness 固定注入；39 個 MCP 工具（~500 tok）裡有 16 個屬於 PM 席根本不用的服務（`Claude Docs` 8 個、未認證的 `Gmail`/`Google Calendar`/`Google Drive` 6 個、`easel` 1 個、`plugin-authoring` 1 個），停用這些 plugin／connector 即可直接消除。
- **`Deferred tool schema record`（15,428 tok，10 個已展開工具 → 拆解處置，預估省 ~12,800–13,300 tok）**：
  - **巨型黑洞 1：`Artifact` 單一工具佔 ~9,000 tokens（36,000+ chars）！** 只要 PM 席在長駐生命週期內呼叫過一次 `Artifact`，這個比整份 70 個 skill 清單還大的完整 schema 就會黏在 context 裡，連壓縮後都隨 `rec 14282` 重載回來。**解法（改成按需載入／隔離）**：PM 主席永不直接呼叫 `Artifact`，凡需發布 HTML 頁面一律派一次性輕量 subagent 發布並回傳 URL，立即省掉 **~9,000 tokens**！
  - **巨型黑洞 2：`fleet` 9 個工具佔 ~6,428 tokens（~25,000 chars）**：
    - `attachments`（~550 chars）在 `dispatch`、`reply`、`send` 重複 3 次；
    - `fyi`（~500 chars）在 `reply`、`send` 的描述與參數裡重複 4 次（加上 MCP instructions 共 5 次）；
    - `next_step` 重複 2 次；`task_result` 保留了 2 個 `DEPRECATED` 參數（`status`、`text`）與長達 1,900 字元的 `waiting_on` 格式手冊；`dispatch.size` 仍留著已過期的「11-19 起會拒絕」歷史告示。
    - **解法（改寫壓短）**：去除重複長文與廢棄別名，詳細語法錯誤改由呼叫失敗時回傳精準錯誤訊息或查 `fleet-usage`，可將 9 個 `fleet` 工具壓至 ~2,000–2,500 tokens（**省 ~3,800–4,300 tokens**，全機隊所有席位同步受惠！）。

### 10. `Agent types list`（1,487 tok → 刪 bug 檔＋改寫壓短，預估省 ~180–200 tok）
- **抓出明確 bug**：`agents/README.md` 放在 `agents/` 目錄下，被 Claude Code 誤掃為可派發的代理型別 `autopilot:README` 且賦予 `Tools: All tools`！應立即將 `agents/README.md` 移出 `agents/`（例如改放 `docs/guide/agents.md` 或 `references/`）。
- 其餘 3 個 autopilot 代理（`debugger`、`planner`、`reviewer`）將 frontmatter 描述各壓短一半（約省 170 tok）；內建 7 個代理（含超長的 `web-fetch` ~550 tok）屬 harness 固定開銷，維持現狀。

### 11. 未歸類的 88k（`Remainder: 88,461 tokens`）—— 重點取證與未查明清單
- **已確認部分**：依 `api-request-shape`（`rec 14154`），`system`（`9,473` chars ≈ `2,368` tok）＋ `tools`（`111,568` chars ≈ `27,892` tok）合計約 **`30,260` tokens**（屬 harness 系統提示詞與工具 JSON schema，維持）。
- **剩餘約 `58,201` tokens（若 `rec 14282` 與 `rec 14154` 重疊則達 `~73,629` tokens）**：**結論為「未查到」**，不得猜測其確切組成與是否每次開機都載入。
- **目前從輸入檔案可證實的 4 項線索**：
  1. **紀錄編號斷層**：`rec 14154`（`api-request-shape`）至 `rec 14291`（壓縮後首個 assistant）之間有 **135 筆未盤點紀錄**（`rec 14155..14281` 共 127 筆、`rec 14283..14290` 共 8 筆），表 1 完全未列出其型別與長度。
  2. **壓縮保留尾段之直接佐證**：`Compaction summary`（`rec 14125`，line 240）明載 `"The messages after this summary are the most recent messages from before compaction, kept verbatim."`，證實壓縮後確實附帶了一段逐字保留的近期對話與工具結果，極可能落在上述 135 筆斷層中。
  3. **`data-flow-records`（`rec 14121`，130k chars）未定性**：盤點檔一方面稱其為 `transcript bookkeeping`（不進 prompt），另一方面又猜測首輪 usage 可能算進了它，尚無 API payload 實證。
  4. **`cache_read` vs `cache_creation` 比例**：`rec 14291` 的 `cache_read` 僅 **`18,628` tokens**，而 `cache_creation` 高達 **`118,117` tokens**。這顯示跨壓縮保持不變的靜態前綴僅約 18.6k（高度吻合靜態 `system`＋核心常駐工具），其餘 118k 全是壓縮後新建快取（高度指向壓縮保留尾段、重載工具與壓縮注入塊，而非每次冷開機必載）。
- **結案還缺的 5 項證據**（需由有權讀取該 session transcript 的腳本補量）：
  1. 列出 `rec 14120..14291` 每一筆紀錄的 `index`、`type`、`subtype`、`chars`、`est_tokens`，把那 135 筆黑箱打開。
  2. 讀取 `rec 14154`（以及 `rec 14282` 之後、若有的最新一筆）`api-request-shape` 完整欄位：`messages` 則數與各則字元數、`tools` 陣列工具名清單（驗證是否已包含 `rec 14282` 的 10 工具，決定缺口是 58k 還是 73k）。
  3. 比對 API 請求實際送出的 `messages`／`system` 總字元數與 `rec 14121`（`data-flow-records`），確認 `130k` chars 到底有沒有送給模型。
  4. 量測一次**全新冷開機 PM 席**（尚未呼叫 `ToolSearch`、未歷經 compaction）的第一個 assistant `usage`（`input + cache_read + cache_creation`），與本次 `136,747` 相減，立即區分「冷開機真底座」與「壓縮殘留尾段」。
  5. 確認 PM 主機 `~/.claude/CLAUDE.host.md` 是否存在與其大小。

### 12. 每 prompt／工具呼叫重複注入區塊
- **`task_reminder`（35 chars，164 次）、`silent_turn_reminder`（111 chars，56 次）、`auto_mode`（149 chars，5 次）**：皆為 Claude Code harness 內建 attachment，專案側無法直接刪除，判**維持**（其中 `task_reminder` 內容為空陣列，若未來 harness 修正空提醒注入可省 ~1.5k／長對話）。
- **`queued_command`（740–1,240 chars／則）**：每則進站 fleet 訊息一筆，是長駐 PM 席 context 膨脹的主力來源之一（本次壓縮前累積 45 則 patrol wakes＋181 則舊訊）。判**改寫壓短**：精簡通道外殼中繼欄位，並加速落實 `fleet` 自動 `no_action`／FYI 合併與 patrol 去噪，避免非決策雜訊逐則進主對話。
- **`PreToolUse:Agent hook_additional_context`（497–503 chars／次）**：由 `hooks/subagent-budget.js` 每次放行 `Agent` 都強行注入一行預算摘要（line 39、727），外加可能的 `dispatch-model-guard.js` 預設 worker 提示。在未接近門檻（<80% 預算、未觸及併發警告、無違規）時，這 125–150 tokens 每次都不改變模型行為，違反「Checks earn their place」。判**改寫壓短**：**安全區改為靜默輸出 0 字元**（照常寫本機統計 log），僅在 ≥80% 預算、併發 ≥3 或觸頂 warn/deny 時才注入 `additionalContext`，不影響任何防失控閘門。

---

## 三、預載量與壓縮門檻建議值及說理

### 1. 先算清楚「預載量」與「壓縮門檻」的約束公式
Claude Code 在設定 `autoCompactWindow`（$W$）時，會固定保留 `33k` autocompact buffer（見 `scripts/lib/compaction-handoff.js` `AUTOCOMPACT_BUFFER = 33,000`），因此實際壓縮觸發點為：
$$C_{\text{trigger}} = W - 33\text{k}$$
若開機／壓縮後的初始預載底座為 $B$，則每一輪壓縮週期的**淨工作空間**為 $H = C_{\text{trigger}} - B$，而每次工具呼叫的平均 context 讀取成本近似為：
$$\bar{C} \approx \frac{B + C_{\text{trigger}}}{2}$$

要同時避免**壓縮抖動（thrashing）**與**高底座二次燒費**，工程上應滿足兩條約束：
1. **底座佔比紅線**：$B \le 0.25 \sim 0.30 \times C_{\text{trigger}}$（淨工作空間佔比 ≥ 70%–75%）。
2. **最小淨工作空間紅線**：$H \ge 110\text{k} \sim 120\text{k}$（足夠撐完數次巡查、跨 lane 彙整與驗收，不會每 10 次工具呼叫就觸發一次壓縮與高額 `cache_creation`）。

### 2. 套回本案：我們能降到多少？
執行本報告全部「刪／按需載入／改寫壓短」建議後：
- **每次冷開機可控預載**：由約 `21.6k` 降到 **約 `6k`**（省 **`~15.5k`**）。
- **加上 harness 固定底座（`~20k–30k`）**：
  - **冷開機總預載可壓至 `≤ 35k–40k` tokens**。
  - **展開精簡 `fleet` 工具後（`~2.5k`）且不載入 `Artifact`（省 `~9k`）**：常態運作底座 **`≤ 40k–45k` tokens**。
- **壓縮後附帶區塊**（摘要＋精簡 handoff＋精簡 `restored-state`＋避免重載大暫存檔）：由約 `8.2k` 壓至 **`~3.5k–4.5k`**。
- **最大變數**：尚未查清的 **`58k–73k`**。只要這塊沒有查清並處理掉，壓縮後首回合即便砍光上述可控 32k，仍會高達 `~104k`。

### 3. 對兩種候選壓縮門檻的定量裁決

| 壓縮門檻方案 | 實際觸發點 $C_{\text{trigger}}$ | 合理預載上限 $B$（壓縮後首回合） | 合理性評估 |
|---|---:|---:|---|
| **門檻 A：`200k`（推薦）**<br>對應 `autoCompactWindow = 233k`（`T2 150k + gap 50k + buffer 33k`） | `200k`<br>（若 `W=200k` 則觸發點 `167k`） | **冷開機 `≤ 40k`**<br>**壓縮後 `≤ 50k–55k`**<br>（若觸發點 `167k` 則壓縮後需 `≤ 45k`） | **性價比最佳**。底座佔比 25%–27.5%，淨工作空間 `~145k–150k`，每輪平均 context 僅 `~125k`（比 350k 門檻少燒 ~40%–45% 快取費），且與 autopilot 既有 `T2=150k / gap=50k / buffer=33k` 設計完全對齊。**但現況 `136.7k` 絕不可直接切 200k**（淨空間剩 `30k–63k` 會立刻陷入壓縮抖動）。 |
| **門檻 B：`35%`（1M 視窗即 `350k`）** | `~317k–350k` | **壓縮後 `≤ 80k–90k`** | **僅作過渡，不宜作為長期目標**。即使把預載降到 80k，平均每輪 context 仍高達 `~215k`，長駐 PM 席一天數百次工具呼叫仍會把週額度燒光；在 58k–73k 尚未解決前，35% 只是避免壓縮抖動的臨時防線。 |

### 4. 建議落地順序（兩階段）
1. **階段一（立即執行，先砍確定浪費＋補齊 58k–73k 證據）**：
   - 先落實本表可控項瘦身（全域／repo `CLAUDE.md`、`MEMORY.md` 限 25 行、`Skill listing` 去重與按角色過濾、`fleet` 工具 schema 與 instructions 去重複、`SessionStart` 刪重複表與修復 68 筆 `Operator initiatives` 爆表、`Artifact` 改派子代理、`subagent-budget` 安全區靜默、移出 `agents/README.md`）。預計冷開機省 `~15.5k`，壓縮後再省 `~17k`（合計 `~32.5k`）。
   - 同步完成「未歸類 58k–73k」的 5 項取證（特別是冷開機實測 vs 壓縮後實測）。
   - 此階段完成前，壓縮門檻維持在現有寬鬆水位（如 `35%`），避免在底座未明時提前壓縮抖動。
2. **階段二（依 58k–73k 取證結果定案）**：
   - **若壓縮後首回合實測降到 `≤ 55k`**：立即將 PM 席與各 lane 席的壓縮觸發點鎖定在 **`200k`**（`autoCompactWindow = 233k`，配 `context_budget` `T1=100k / T2=150k / gap=50k`）。
   - **若 58k–73k 證實為 Claude Code harness 不可關閉的壓縮保留尾段**（導致「每次 auto-compact 後必然背著 >90k」）：**不要依賴 auto-compact**，改在 `context_budget` 到 `180k–200k` 時自動觸發「寫入精簡 handoff（≤400 tok）→ `/clear` 重起並讀 handoff」，直接把工作底座拉回 **`≤ 40k` 的冷開機水位**，徹底甩掉壓縮尾段與已展開工具殘留。
