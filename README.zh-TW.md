<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Standalone-capable 的 Claude Code 生命週期編排，與 Superpowers 並存。</strong><br>
  23 個 skill，涵蓋生命週期管理、策略決策、方法論和品質閘門。<br>
  獨立運作；若已安裝 Superpowers 則優雅委派戰術執行給它。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-2.26.0-E8A838?style=flat-square" alt="v2.26.0">
  <img src="https://img.shields.io/badge/skills-23-4A90D9?style=flat-square" alt="23 Skills">
  <img src="https://img.shields.io/badge/agents-3-7C9E8C?style=flat-square" alt="3 Methodology Agents">
  <img src="https://img.shields.io/badge/hooks-20-6B8E6B?style=flat-square" alt="20 Hooks">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp; <b>正體中文</b>
</p>

---

## 問題

Claude Code 本身 —— 即使你裝了內建的 `superpowers` plugin —— 仍有幾個層次未被覆蓋：

- **生命週期管理** — 沒有任務規模評估、沒有專案追蹤、沒有 session 開工/收工紀律
- **策略決策** — 沒有多角色辯論、沒有雙 agent 調研
- **品質閘門** — 沒有統一的 test → scan → completeness → review pipeline
- **方法論紀律** — evidence-first 除錯、測試金字塔 baseline、team allocation、效能 profiling 都需要明確框架
- **自我提升** — 沒有知識擷取、沒有回顧、沒有「下一步做什麼」推薦
- **專案特定上下文** — 沒有機制注入你專案的工具、慣例和已知地雷

## 解決方案

Autopilot 提供 **23 個 skill**，涵蓋生命週期編排、策略智慧、方法論和品質閘門。獨立運作；與選用的 `superpowers` plugin 並存（見下方 [Superpowers Coexistence](#superpowers-coexistence)）。

| Skill | 做什麼 | 並存對象 |
|-------|--------|---------|
| **dev-flow** | 評估任務規模（S/L/H），設定 session rules 注入設定和品質閘門，管理專案追蹤 | `superpowers:writing-plans`（規劃） |
| **survey** | 雙 agent 調研（researcher + skeptic） | — （無對應） |
| **think-tank** | 6 角色辯論做策略決策 | `superpowers:brainstorming`（不同層級 — 需求探索） |
| **think-tank-dialectic** | Hegelian 辯證，用於不可逆/高風險、LOW consensus 的決策。4 職能 + 2 對抗性角色（Popper falsifier + Munger inverter）。**不是** think-tank 的升級版——是不同工具 | — （無對應） |
| **ceo-agent** | 自主執行，CEO 級判斷力 | — （無對應） |
| **l3 / l4 / l5** | 精簡的 CEO 前門，預填四個啟動問題並設定執行姿態：`/l3` 在主執行緒就地執行、`/l4` 派發一個背景 worktree 隔離的 `sub-orchestrator` foreman，搭配 depth-0 控制迴圈 + 權威 qc，`/l5` 再把實作交給異質引擎（agy/Gemini） | — （無對應） |
| **quality-pipeline** | 統一品質閘門：test → scan → completeness → review | `superpowers:verification-before-completion`（部分） |
| **finish-flow** | Size-aware 收尾 forcing function — TaskCreate 展開 L-5 / H-9 / Fix / S-Lite discrete sub-tasks，防止收尾被靜默壓縮 | — （無對應） |
| **project-lifecycle** | Plan → bootstrap → 結構 → 歸檔 | `superpowers:finishing-a-development-branch`（部分） |
| **learn** | 失敗後自動記錄知識；知識健康審計 | — （無對應） |
| **retro** | 從 git history 做工程回顧 | — （無對應） |
| **next** | 掃描所有工作來源，推薦最高優先任務 | — （無對應） |
| **audit** | 實作間的系統性比對 | — （無對應） |
| **debug** | Evidence-first 除錯方法論（tool → log → code）+ Three Red Lines 紀律 | `superpowers:systematic-debugging`（廣義 hypothesis-driven framing） |
| **test-strategy** | 測試金字塔、baseline 守則、failure investigation funnel — **不是** TDD（正交主題） | `superpowers:test-driven-development`（coding loop，互補不等價） |
| **team** | Team allocation 決策：何時組隊、role 選擇、依賴分析 | `superpowers:dispatching-parallel-agents`（dispatch 機制 — 動詞，而 autopilot:team 是名詞） |
| **profiling** | Evidence-first 效能 profiling（生態內唯一 methodology entry point） | — （無 superpowers 對應） |

### 並存模型 — autopilot 獨立可用，Superpowers 可選

Autopilot 完全不需要 `superpowers` 就能跑。若你也裝了 `superpowers`，autopilot 的 orchestrator skill（`ceo-agent`、`finish-flow`、`quality-pipeline`、`think-tank{,-dialectic}`、`dev-flow`）會讀 `.claude/dispatch-config.md` 決定要委派哪個方法論 / reviewer / 並行派發器。

```
autopilot:dev-flow 設定 session rules：
  → "除錯時，讀 .claude/debug-config.md 取得專案上下文"
  → "commit 前，跑 autopilot:quality-pipeline"
  → "session 結束時，更新專案追蹤"

方法論派發（per .claude/dispatch-config.md）：
  → 除錯：     superpowers:systematic-debugging（若安裝）→ autopilot:debug
  → 測試：     superpowers:test-driven-development + autopilot:test-strategy（互補）
  → Profiling: autopilot:profiling（無 superpowers 對應）
  → Team：     autopilot:team（allocation）+ superpowers:dispatching-parallel-agents（dispatch）
  → Review：   autopilot:reviewer → superpowers:requesting-code-review（fallback）
```

歷史上這曾被定位為「定規則，Superpowers 執行」（v2.0-v2.6）；v2.7.0 在保留該模型（當 superpowers 已安裝時）的同時，讓 autopilot 也能作為 standalone plugin 運作。各情境 UX 見下方 [Superpowers Coexistence](#superpowers-coexistence)。

---

## Superpowers Coexistence

Autopilot 支援三種部署情境：

### A. 你裝了 `superpowers`（user-level 或 marketplace）

推薦預設。autopilot orchestrator 透過 `.claude/dispatch-config.md` chain 委派戰術執行給 superpowers。

`.claude/dispatch-config.md` 範例（貼進你的專案）：

```markdown
## Code Review
- autopilot:reviewer
- superpowers:requesting-code-review

## Parallel Dispatch
- superpowers:dispatching-parallel-agents
- native

## Methodology Preferences

### Debugging
- superpowers:systematic-debugging
- autopilot:debug

### Testing methodology
- autopilot:test-strategy
- superpowers:test-driven-development
```

> **superpowers ≥ v5.1.0 注意**：獨立的 `superpowers:code-reviewer` agent 已移除，併入 **`requesting-code-review`** / **`receiving-code-review`** skills（對照 `obra/superpowers` v6.0.3,2026-06 確認）。上面 chain 用現行名稱;`autopilot:reviewer` 仍是方法論紀律的主要 reviewer,此 fallback 為選用。

### B. 你**沒裝** `superpowers`

Autopilot 完全 standalone 運作。Orchestrator fall through 到 autopilot 自家 fallback skill（`autopilot:debug`、`autopilot:test-strategy`、`autopilot:team`、`autopilot:profiling`）+ `native` 並行派發（在一個 response 內發出多個 `Task` tool call）。

> **一個 standalone 缺口要知道**：red-green-refactor 的 **TDD coding loop** 沒有原生 autopilot skill —— `autopilot:test-strategy` 是*正交*的（test pyramid / baseline / failure funnel),不是 TDD 替代品。要 TDD 請裝 `superpowers`（`test-driven-development`),或手動跑 red-green 循環。

不需要建立 `.claude/dispatch-config.md` — [`project-config-template/dispatch-config.md`](project-config-template/dispatch-config.md) 頂部記載的預設行為就符合此情境。

### C. 你 user-level 有 `superpowers`，但某專案想 pure-autopilot

在 `.claude/settings.json` 用 `disabledSkills` 做 per-project 硬切：

```jsonc
{
  "disabledSkills": [
    "superpowers:systematic-debugging",
    "superpowers:test-driven-development",
    "superpowers:dispatching-parallel-agents",
    "superpowers:requesting-code-review"
  ]
}
```

這是 Claude Code 原生機制；autopilot 不需要另設 config flag。

### Migration 注意（v2.6.0 → v2.7.0）

若你從 v2.6.0 升級且先前在 `CLAUDE.md` 路由表**移除過** `debug`、`test-strategy`、`team`、`profiling` 等 entry（預期這些 skill 不存在），請注意：v2.7.0 它們以 fallback 形式回歸，可能會在對應 keyword 上觸發。要壓掉：加進 `.claude/settings.json` 的 `disabledSkills`。

---

## 核心特色

### 三種操作模式

**`dev-flow` — 引導式開發（預設）**

所有開發任務的入口。評估任務規模後自動引導：

```
你: "加 WebSocket 壓縮"

Claude (有 dev-flow):
  1. 規模評估: L（跨網路 + 協議 + 客戶端模組）
  2. → 建立計畫、專案目錄、feature branch
  3. → 逐 phase 實作，每 phase 品質閘門
  4. → 完成後歸檔專案

Claude (沒有 dev-flow):
  → 立刻開始 grep codebase
  → 沒計畫、沒分 phase、沒品質閘門
```

dev-flow 也負責 session 生命週期 — 開工時健康檢查、知識回顧、context continuation 時目標對齊。不用另外呼叫，dev-flow 全部吸收。

**`ceo-agent` — 自主執行模式**

你要的是結果，不是參與過程。Agent 變成 CEO；你變成董事會。

```
你: "CEO mode. 搞定 reconnect。Level 3，你全權處理。"

CEO 啟動確認：
  1. OKR — 具體成功標準（不是模糊的「做好」）
  2. 參與程度 — 多久報告一次（每步 / 每 phase / 做完才說）
  3. 範圍模式 — Expand / Selective / Hold / Reduce
  4. 禁區 — 絕對不能碰的東西

然後：在 DOA（授權委託）範圍內自主執行
```

CEO agent 運用 10 個來自頂尖 CEO 的認知模式（Bezos 的 two-way door、Munger 的反向思維、Jobs 的減法聚焦），並遵循 Boil the Lake 原則 — AI 讓完整性的邊際成本趨近於零，所以永遠選擇完整的實作而非捷徑。

CEO 不能自我審計。如同公司治理，quality-pipeline 和 code-review 獨立運行。

**`think-tank` — 多角色辯論**

當單一視角不夠的策略決策。6 個角色平行辯論：

```
你: "Auth 系統要重寫還是修補？"

Think Tank 組成：
  - CTO（技術可行性）
  - 產品總監（使用者影響）
  - QA Lead（風險評估）
  - 安全架構師（威脅模型）
  - 客戶代言人（使用體驗）
  - 維運（部署/維護）

輸出：Decision Brief — 共識、異議、建議
```

### 三者如何協作

```
 使用者任務
    │
    ▼
 dev-flow ──────────────────────────────────────────────┐
    │                                                    │
    ├─ S (小): 實作 → quality-pipeline → commit           │
    │                                                    │
    └─ L (大): project-lifecycle（建專案）                │
         │     → 逐 phase 實作                          │
         │     → quality-pipeline 每 phase              │
         │     → project-lifecycle（歸檔）               │
         │                                               │
         ├─ 需要調研？ ──→ survey                        │
         ├─ 策略決策？ ──→ think-tank                    │
         ├─ 使用者說「搞定它」？ ──→ ceo-agent           │
         │                                               │
         └─ session 結束 ──→ learn（擷取知識）           │
                              retro（定期回顧）           │
                                                         │
 下一步做什麼？ ──→ next（掃描 → 排序 → 推薦）          │
                                                         │
 ◄───────────────────────────────────────────────────────┘
```

### Skill 邊界

| 決策類型 | 用這個 |
|---------|--------|
| 技術選擇（X library vs Y） | `survey` — 雙視角外部調研 |
| 策略選擇（要不要做？做多大？先做哪個？） | `think-tank` — 多角色內部辯論 |
| 使用者要結果，不要參與過程 | `ceo-agent` — 自主執行 |
| 使用者想參與 | `dev-flow` — 有 checkpoint 的引導流程 |

---

## 安裝

### Claude Code（主要）

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

完成。23 個 skill 立即可用：`autopilot:dev-flow`、`autopilot:survey` 等。

### OpenCode（`.agents/skills/` 自動掃描）

把 repo clone 到任何地方；OpenCode 原生 skill scanner 會從 cwd 抓取 `.agents/skills/`。

```bash
git clone https://github.com/cookys/autopilot.git
cd autopilot
./scripts/setup-symlinks.sh                          # 確保 .agents/skills/ symlink 可解析（Linux/macOS/WSL 上為 no-op）
cd .opencode && npm install                          # @opencode-ai/plugin 型別（除非要編輯 TS plugin 否則可選）
cd ..
opencode debug skill | grep autopilot                # 驗證 autopilot skills 被發現
```

Agents（`autopilot-reviewer`、`autopilot-debugger`、`autopilot-planner`）透過 `.opencode/opencode.json` 自動載入。

### Codex（OpenAI）

與 OpenCode 用同一個 `.agents/skills/` symlink — Codex 的 skill scanner 會從 cwd 往上找 `<repo>/.agents/skills/`。per-repo 使用無需額外設定。

跨 repo 全域可用，見 `platforms/codex/config.toml.example`。

### Antigravity（`agy`）

`agy` 把 autopilot 當作 Claude Code 來源的 plugin 匯入（對 agy 1.0.1 驗證過 — 沒有鬆散的 skills-dir 掃描；舊的 `~/.gemini/antigravity/skills/` 方式已被取代）。

```bash
./scripts/install-antigravity.sh                     # agy plugin validate → install → list
agy plugin list | grep autopilot                     # 驗證已註冊
# 移除：agy plugin uninstall autopilot
```

### Windows

Repo 追蹤的 symlink（`.agents/skills/`）需要在 clone **之前**啟用 Developer Mode + `core.symlinks=true`：

```powershell
git config --global core.symlinks true               # 一次性、系統層級
# 啟用 Developer Mode：Settings -> Privacy & security -> For developers
git clone https://github.com/cookys/autopilot.git
cd autopilot
.\scripts\setup-symlinks.ps1
```

沒有這些設定，symlink 會變成內含目標路徑的純文字檔 — `setup-symlinks.ps1` 會偵測並嘗試修復，但修復仍需 Developer Mode。

### 跨平台 pre-commit gate

```bash
./scripts/install-hooks.sh                           # 每個 clone 一次性
```

啟用 `.githooks/pre-commit`，它會跑 `sync-version.js --check` 和 `sync-agent-bodies.sh --check`，在 version-manifest 漂移與 agent-body 漂移到達 remote 前抓出來。

---

## 跨 Repo 設定注入

Skill 預設就能用。如果需要專案特化行為，把 markdown 檔放進你專案的 `.claude/` 目錄 — skill 在呼叫時透過 Claude Code 的 `!`command`` 預處理器讀取。

### 注入機制

```
┌─────────────────────────────────┐
│  Plugin（共用，唯讀）            │   Autopilot skill 在這裡。
│  ~/.claude/plugins/cache/       │   所有專案共用。
│  autopilot/skills/dev-flow/     │
│           └── SKILL.md ─────────┼──┐
└─────────────────────────────────┘  │
                                     │  呼叫時，SKILL.md 執行：
                                     │  !`cat .claude/dev-flow-config.md`
                                     │
┌─────────────────────────────────┐  │
│  你的專案（per-repo）            │  │
│  my-project/.claude/            │◄─┘  從你的專案的
│    ├── dev-flow-config.md       │     .claude/ 目錄讀取
│    ├── quality-gate-config.md   │
│    ├── skill-routing.md         │     這些檔案是純 markdown。
│    └── team-config.md           │     不需要 schema。不需要 YAML。自然語言。
└─────────────────────────────────┘
```

`!`command`` 語法是 Claude Code 的預處理器 — 執行 shell 指令，把輸出 inline 到 skill body 中，*在 LLM 看到之前*完成。這代表：

- **沒有設定檔？** 靜默通過 — skill 正常運作，不會多餘噪音。零摩擦。
- **設定是自然語言。** Markdown 比 YAML 更有表達力 — 你可以用散文寫規則、例外和理由。
- **設定是專案級的。** 每個 repo 有自己的 `.claude/` 目錄。同一個 autopilot plugin 適配 C++ 遊戲伺服器、React app、或 Rust CLI — 全靠不同的設定檔。
- **Session rules 為所有活動注入設定。** dev-flow 設定規則如「除錯時，讀 `.claude/debug-config.md`」— 這樣連 Superpowers 的 debugging skill 都能拿到你的專案上下文。

### 可用設定檔

| 設定檔 | 自訂什麼 | 範本 |
|--------|---------|------|
| `.claude/dev-flow-config.md` | 規模規則、品質閘門、build 指令、特殊規則 | [範本](project-config-template/dev-flow-config.md) |
| `.claude/finish-flow-config.md` | L-5 / H-9 收尾流程 override（merge 目標、archive 程序、size-specific quality gate） | [範本](project-config-template/finish-flow-config.md) |
| `.claude/quality-gate-config.md` | 測試、掃描、review 指令 | [範本](project-config-template/quality-gate-config.md) |
| `.claude/project-lifecycle-config.md` | 專案路徑、bootstrap/archive 腳本 | [範本](project-config-template/project-lifecycle-config.md) |
| `.claude/next-config.md` | next skill 的工作來源路徑 | [範本](project-config-template/next-config.md) |
| `.claude/skill-routing.md` | 關鍵字對應到專案的 domain skill | [範本](project-config-template/skill-routing.md) |

### 範例：C++ 遊戲伺服器設定

```markdown
# Dev Flow — TWGameServer Config

## 規模規則
- **S**: 單模組、不改介面 → 直接 commit
- **L**: 跨 3+ 模組、公開介面、Feature Flag → plan + project + PR

## 品質閘門
- S: `node .claude/scripts/quality-pipeline.js --size S`
- L: `node .claude/scripts/quality-pipeline.js --size L` per phase

## Build & Deploy
- Build: `../deploy/scripts/dev.sh build`
- Build+Restart: `../deploy/scripts/dev.sh br`

## 特殊規則
- Commit 前必須跑 E2E if 改了遊戲邏輯
- Proto 改動要重編譯 SDK
```

### 範例：Skill Routing

```markdown
# Skill Routing

| 關鍵字 | Invoke |
|--------|--------|
| MJ / 麻將 | `twgs-game-dev` → references/mj.md |
| crash / core dump | `twgs-debug` |
| proto / protobuf | `twgs-protobuf` |
| stress / 10K | `twgs-stress-test` |
```

這讓 autopilot 的 `dev-flow` 在遇到相關關鍵字時自動呼叫你專案的 domain skill — 把通用工作流層和專案特定知識橋接起來。

---

## 團隊設定

加到你專案的 `.claude/settings.json`，團隊成員會自動收到安裝提示：

```jsonc
{
  "extraKnownMarketplaces": {
    "autopilot": {
      "source": { "source": "github", "repo": "cookys/autopilot" }
    }
  }
}
```

---

## 已知限制

Claude Code plugin 安裝時會 **pin 到特定 commit**。`/plugin update` 不一定偵測到新版。取得最新版：

```bash
/plugin uninstall autopilot@autopilot
/plugin marketplace remove autopilot
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

詳見 [anthropics/claude-code#31462](https://github.com/anthropics/claude-code/issues/31462)。

---

## 設計哲學

**為什麼是 plugin，不是複製 skill？**
複製的 skill 幾週內就會 drift。Plugin 是 single source of truth — 更新一次，所有人透過 `/plugin update` 取得。

**為什麼 23 個 skill + 20 個 hook？**
v2.0 移除了 4 個跟 `superpowers` 重疊的 skill（debug、test-strategy、team、profiling），預設 `superpowers` 永遠存在。v2.7.0 把它們以 standalone fallback 形式補回（每支 body 內加 `## Coexistence with Superpowers` 段說明關係），讓 autopilot 在沒 `superpowers` 的情況下也能跑。當 `superpowers` 已安裝時，`.claude/dispatch-config.md` chain 讓 orchestrator runtime 偏好 superpowers 對應 skill；autopilot 的 skill 留在 catalog 作為 standalone fallback。v2.2 新增 `think-tank-dialectic` 作為**不同工具**（不是升級版）用於不可逆決策。v2.5 新增 14 個 hook 用於 runtime 強制執行 — 以前只寫在 markdown 規則裡的紀律。Hook 和 skill 服務不同層次：skill 在對話時定規則；hook 在 tool-call 時強制執行。

**為什麼用 `!`command`` 注入，不用設定檔？**
在 Claude Code 的世界，「設定」就是自然語言。呼叫時讀取的 markdown 比 YAML 更有表達力，不需要 schema，檔案不存在時自動 graceful degradation。

**跟 Superpowers 怎麼共存？**

Autopilot 本身可獨立運作,並在 Superpowers 安裝時與之共存:autopilot 的 orchestrator 透過 `.claude/dispatch-config.md` chain 把戰術執行委派給 Superpowers,未安裝時則 fall through 到 autopilot 自家 fallback skill。(歷史上 v2.0–v2.6 是「定規則 / 執行者」之分;自 v2.7.0 起 autopilot 也能完全 standalone。)兩者透過三層觸發設計共存:

```
Layer 1 — CLAUDE.md 路由表（專案層級）
  "新功能規劃 → autopilot:dev-flow"
  "技術調研 → autopilot:survey"
  使用者寫的 keyword → skill 對照表。

Layer 2 — using-superpowers skill（session 層級）
  "收到訊息先檢查 skill，哪怕只有 1% 可能也要查。"
  這是讓 skill 觸發能運作的關鍵。沒有它，
  model 會直接回答問題，永遠不會檢查 skill。

Layer 3 — Skill description（skill 層級）
  "Use when: 'compare X with Y', 'check X against Y'..."
  使用者意圖觸發詞，幫助 model 把使用者的話
  配對到正確的 skill。
```

三層缺一不可。Layer 2（Superpowers 的 `using-superpowers`）建立「先查 skill」的**習慣**；Layer 1（CLAUDE.md）提供專案特定的**路由**；Layer 3（description）提供語意**配對**。Autopilot 不會呼叫或包裝 Superpowers skill — 它們共享 session，不是 call chain。

**為什麼 description 要用引號包觸發詞？**

Description 服務的是 Layer 3 — 使用者意圖和 skill 之間的最後一哩配對。我們用使用者語言寫（`"what should I work on"`、`"搞定它"`、`"讓我們辯論一下"`），而不是內部術語（`"global work recommender"`、`"autonomous execution mode"`），因為 model 拿使用者訊息去 match description。Description 越接近使用者實際說的話，觸發越可靠。

---

## 方法論 Agents

Autopilot v2.4.0 內建 **3 個 read-only 方法論 agent**，把三條紅線紀律帶到 agent 執行層。Autopilot skill 會自動 dispatch 它們，你很少需要直接呼叫。

| Agent | 用途 | Model | 被誰 dispatch |
|-------|------|-------|---------------|
| **`autopilot:reviewer`** | Pre-commit / pre-merge 審查、安全審核、計畫審查。嚴重度分級 + `file:line` 引用 + `✅ Verified Clean` section | opus | `quality-pipeline`、`ceo-agent`、`finish-flow` |
| **`autopilot:debugger`** | Evidence-first 根因分析。5-phase 方法論 + 失敗 2 次以上觸發 PUA 模式。產出 `Proposed Fix` diff，不直接 patch | opus | `quality-pipeline`（round-trip）、`ceo-agent`、`dev-flow` |
| **`autopilot:planner`** | L-size 任務的六要素 Task Prompt 拆解（goal / scope / input / output / acceptance / boundaries）。不能寫 code | sonnet | `dev-flow`、`think-tank` |

三個 agent 都是**物理上 read-only** — `tools` frontmatter 不包含 `Edit` 和 `Write`，Claude Code 機制上就防止它們 patch 檔案。它們產生 findings、proposals、或 plans，透過統一的 `### Handoff` section（enum 格式的 `Next consumer` 欄位）交棒給呼叫 skill。

三個 agent 把 autopilot 的**三條紅線**帶進 agent 層：

1. **Closure** — 每個 finding 都附 impact + fix direction，沒有 open-ended 結尾
2. **Fact-driven** — 每個結論都引用 `file_path:line_number`；「probably」/「likely」是違規
3. **Exhaustiveness** — 完整 checklist；乾淨項目明確列出；靜默跳過 = 違規

詳見 [`agents/README.md`](agents/README.md) — dispatch 邊界、統一 Output Contract、enum 文法、以及「autopilot 方法論層 / voltagent 角色層 / 專案層」的三層架構。

---

## 推薦搭配

Autopilot **方法論和生命週期層面自給自足** — 單獨安裝 autopilot 就能拿到所有 23 skills + 3 methodology agents。如果需要**角色特化**（語言專家、DB 管理員、Kubernetes 專家、前端設計師等），我們推薦搭配 voltagent 使用：

```
/plugin install voltagent@...
```

Autopilot 和 voltagent **正交設計**：

| 層 | 做什麼 | 去哪找 |
|----|--------|--------|
| **方法論 (Methodology)** | 三條紅線紀律、evidence-first 除錯、六要素 Task Prompt、生命週期編排 | autopilot（這個 plugin） |
| **角色 (Role)** | 語言專家、基礎設施專家、領域專家（80+ 個 agent） | voltagent |
| **專案 (Project)** | 你的技術棧陷阱、團隊慣例、領域特化 agent | `<project>/.claude/agents/` |

**Dispatch 邊界**：

- 走 **autopilot skill**（`quality-pipeline`、`dev-flow`、`ceo-agent`）會自動 dispatch autopilot 方法論 agent — `:debugger` 和 `:planner` 由 consumer skill 直接指定，reviewer 由 `.claude/dispatch-config.md` `## Code Review` chain 選擇（chain 未設或 entry 不可 dispatch 時預設 fallback 為 `autopilot:reviewer`）— 把方法論紀律帶進每次 invocation
- **直接呼叫 agent**（透過 `Agent` tool）時，voltagent 的角色 agent（`voltagent-qa-sec:code-reviewer`、`voltagent-lang:rust-engineer`、`voltagent-data-ai:postgres-pro` 等）通常是更好的首選，因為它們的 domain 覆蓋更廣

兩個 workflow、兩個 dispatch 路徑、實際上不重疊。

Autopilot **不會** runtime 偵測 voltagent。`:debugger` 和 `:planner` 由 consumer skill 直接指定；reviewer 由 `.claude/dispatch-config.md` `## Code Review` chain 選擇，chain 未設或 entry 不可 dispatch 時預設 fallback 為 `autopilot:reviewer`。如果某個任務你想要不在 chain 的 reviewer，直接透過 `Agent` tool 顯式呼叫 — 這是 user 層的選擇，疊加在 chain 機制之上。

---

## Hooks

Autopilot 自帶 **20 個 hook**（最初 14 個於 v2.5.0 引入，之後成長），在 Claude Code runtime 層強制開發紀律 — 不需要靠自律。分為 **8 個 default-on** + **12 個 opt-in**（零個已停用——`cost-tracker` 已於 v2.25.2 以 opt-in 重新啟用）。權威數字由 [`scripts/check-hook-inventory.js`](scripts/check-hook-inventory.js) 從 `hooks.json` + `settings.example.json` 推導（執行它即可重建這些清單，`--check` 擋漂移）。

### Tier A — 預設啟用（8 個 hook）

安裝 plugin 後自動啟用（wired 在 `hooks.json`）。所有都是非破壞性且對任何專案安全。tool-event hook 改讀 session transcript 而非 stdin（upstream stdin pipe 壞掉，#6305）。

| Hook | 事件 | 功能 |
|------|------|------|
| **state-checkpoint** | PreCompact | compaction 前把 transcript 最後 20 輪寫到 `~/.autopilot/compaction-state.md` |
| **session-start** | SessionStart | session priming：印出跨 session resume hint + intent-capture 健康狀態 |
| **intent-capture** | PostToolUse/* | 記錄 per-cwd intent 檔供跨 session resume hint |
| **reload-watch** | PostToolUse/* | 偵測磁碟上 catalog 漂移，注入 `/reload-plugins` 提醒 |
| **audit-log** | PostToolUse/Bash | 記錄 bash 命令並自動 redact secret |
| **log-error** | PostToolUse/* | 偵測 tool output 中的錯誤關鍵字，寫入 `~/.claude/error-log.md` |
| **failure-escalation** | PostToolUse/Bash | 追蹤 session 內連續 Bash 失敗，升級給 user |
| **suggest-compact** | PostToolUse/Write\|Edit | 計算 session tool call 次數，50 次提醒 `/compact`，之後每 25 次 |

### Tier B — 可選啟用（12 個 hook）

從 [`settings.example.json`](settings.example.json) 複製到你的 `settings.json` 即可個別啟用。

| Hook | 事件 | 功能 |
|------|------|------|
| **cost-tracker** | Stop | 從 transcript 加總每輪 token usage → `~/.claude/metrics/costs.jsonl`（cache-aware 成本；opt-out `AUTOPILOT_COST_TRACKER=false`） |
| **branch-protection** | PreToolUse/Bash | 硬擋保護分支（預設 `main\|master`）上的直接 commit / force-push |
| **commit-secret-scan** | PreToolUse/Bash | staged 變更含 secret 時硬擋 `git commit` |
| **large-file-warner** | PreToolUse/Read | 500KB 警告、2MB 硬擋 Read（用 offset/limit 繞過） |
| **config-protection** | PreToolUse/Write\|Edit | 擋對 linter/formatter config 的修改 |
| **session-summary** | Stop | session 結束時把 cwd / git status / 近期 commit 追加到 `~/.claude/sessions/{date}-{sid}.md` |
| **check-console** | Stop | 警告修改過的 JS/TS 檔案中的 `console.log` |
| **accumulator** + **batch-format** | PostToolUse + Stop | session 結束時批量 Prettier + tsc |
| **test-runner** | PostToolUse/Write\|Edit | 編輯後自動跑 sibling test（vitest/jest） |
| **design-quality** | PostToolUse/Write\|Edit | 警告 generic template UI 模式 |
| **mcp-health** | PreToolUse + PostToolUseFailure | 不健康 MCP server 的指數退避 |

> 上面三個 **PreToolUse** blocker 加上 **session-summary** 原本被 v2.7.4 停用，因為在 Bun-spawn 的 hook 環境裡開啟 `/dev/stdin` **路徑**會 ENXIO（[#6305](https://github.com/anthropics/claude-code/issues/6305)）。改成**直接讀 fd 0**（`fs.readFileSync(0)`）就拿得到 payload——已在 Claude Code 2.1.186 端到端驗證。PreToolUse blocker 以 opt-in 出貨而非 default-on，是因為硬擋 commit/read 是 per-project 的政策決定。

### Secret 偵測

啟用時，`commit-secret-scan`（opt-in，見上）與運作中的 `audit-log` 共用統一的 secret pattern module（`hooks/_shared/secret-patterns.js`），涵蓋：OpenAI、Anthropic、GitHub（PAT/OAuth/App）、AWS、Google API、Slack、Stripe token + inline `--token`/`password`/`Authorization` 樣式。

### 覆寫

- **停用某個 Tier A hook**：在 `settings.json` 設 `autopilot.<hookName> = false`
- **自訂保護分支**（當 `branch-protection` 啟用時）：設 `AUTOPILOT_PROTECTED_BRANCHES` env var 或 settings 的 `autopilot.protectedBranches`
- **停用成本追蹤**（當 `cost-tracker` 重新啟用時）：設 `autopilot.costTracker = false`

---

## 靈感來源

- **Task-tree engine 既有技術（v2.16.0）** — externalized-state 基底及其護欄吸收已發表的教訓而非重蹈覆轍：append-only event log + 在 read-modify-write node 檔案上的 derived index（Steve Yegge 的 [Beads](https://github.com/steveyegge/beads) postmortem；TaskMaster schema/concurrency 事故報告 — 2026-06-12 調研的社群 issue-tracker 報告，調研時無單一 canonical URL）、每事件 `schema_version` 搭配 lazy migration（[LangGraph](https://github.com/langchain-ai/langgraph) 的 versioned-state 教訓；[Temporal](https://temporal.io) 的 history-evolvability 模型）、以及便宜的跨家族 judge panel 勝過單一大 judge（PoLL 結果 — [Verga et al. 2024, "Replacing Judges with Juries"](https://arxiv.org/abs/2404.18796)）。這些來源的所有量化門檻都當作待本地校準的 factory default，絕不作為理據。
- **[gstack](https://github.com/garrytan/gstack)** — Garry Tan 為 Claude Code 打造的 skill 套件。CEO agent 的認知模式（Bezos 的 two-way door、Munger 的反向思維、Jobs 的減法聚焦）、Boil the Lake 完整性原則、以及範圍模式系統，都改編自 gstack 的 `plan-ceo-review` skill。
- **[Council of High Intelligence](https://github.com/0xNyk/council-of-high-intelligence)** — 0xNyk 的 18 位思想家多人格審議 skill。`think-tank-dialectic` 的強制機制（Dissent Quota、>70% 同意時的 Counterfactual Trigger、Problem Restate Gate、作為一級 verdict section 的 Minority Report、Epistemic Diversity Scorecard）改編自 Council 的 7 步協議和 agent frontmatter 慣例。最關鍵的 meta 洞察——*每個思考風格都必須攜帶自己的熔斷機制*——來自觀察到 Council 的 18 個 agent 100% 都有 `Grounding Protocol` section 帶自我限制的 hard rules。
- **[Agora](https://github.com/geekjourneyx/agora)** — Professor Li 在 Council 基礎上擴展的 6 審議室、31 位思想家版本。`think-tank-dialectic` 的 Hegelian Arc 結構（Thesis → Antithesis → Synthesis，強制提出非折中的 synthesis proposal）、Adaptive Depth Gate、Tacit Knowledge Extraction 協議（Polanyi 隱性知識）、以及「不同工具，不是更好的工具」這個關鍵定位框架，都改編自 Agora 的 8 步審議協議和 `/forge` 工程審議室的 verdict template。
- **[my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)** — NYCU-Chung 為 Claude Code 打造的 12-agent + 15-hook 工程團隊 plugin。`v2.4.0` methodology agents（`reviewer` / `debugger` / `planner`）吸收了 devteam P7/P9/P10 框架的三條紅線紀律（closure / fact-driven / exhaustiveness）、六要素 Task Prompt 契約、evidence-first debug 方法論、PUA 壓力模式觸發、以及 read-only 方法論 agent 的物理工具限制模式。`v2.5.0` hooks 層吸收了 devteam 15 個 hook 中的 14 個（8 個 default-on Tier A + 6 個 opt-in Tier B），並根據 Ship A review 調整：anchored branch-protection regex（C1 修正）、統一 secret-patterns module（mi1 修正）、cost-tracker opt-out、8/8 Tier A 測試覆蓋。autopilot 負責方法論層、voltagent 負責角色特化層的分工，是對 devteam 一體化設計的刻意發散——保持和 voltagent 角色 agent 生態系的正交。
- **[claude-powerloop-plugin](https://github.com/elct9620/claude-powerloop-plugin)** — Aotokitsuruya 的 cron-loop Plan/Execute/Review/Sample plugin（Apache-2.0）。`references/blind-dispatch.md` 的 outcome-blinding 原則（round-2+ reviewer re-dispatch 必須剝離先前判決以防 quality-gate 自我繞過）與 leaky-vs-blind prompt 範例組來自 powerloop `skills/powerloop/examples/blind-dispatch.md`。powerloop 用在多 session cron loop，autopilot 限定在 `quality-pipeline` Re-review Loop 與 `audit` Phase 4 verification 的 session-driven re-dispatch。
- **[superpowers](https://github.com/obra/superpowers)** — obra（Jesse Vincent）的 agentic-skills 框架,autopilot 與之共存。`scripts/check-dispatch-suppression.sh`(反作弊 dispatch-prompt linter —— dispatcher 不得誘導 reviewer 壓制或預先定 finding 的 severity)與 `references/plan-template.md` 的逐字 **Global Constraints** 傳遞,改編自 superpowers v6 的 `subagent-driven-development` 反作弊 reviewer 契約與 `writing-plans` global-constraint block(2026-06-24 對照 v6.0.3 調研)。

---

## 開發

本地開發或自訂 skill：

```bash
# 1. 先用正規流程安裝一次（必要）
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot

# 2. Clone 並切換到 dev 模式
git clone git@github.com:cookys/autopilot.git ~/projects/autopilot
cd ~/projects/autopilot
./scripts/dev-setup.sh
```

Dev 模式會把 plugin cache 目錄 symlink 到你的本地 clone。修改 `skills/` 後 `/reload-plugins` 立即生效，不用重裝。

跨機器用 git push/pull 同步。每台機器跑一次步驟 1，再跑一次 `dev-setup.sh` 即可。

> **注意：** Dev 模式會把版本設為 `dev`。要回到正式版，執行 `/plugin update autopilot@autopilot`。

### Cache 目錄結構

Plugin cache 在 `~/.claude/plugins/cache/autopilot/autopilot/`。每個 entry 是版本快照（安裝/更新時建立）或 symlink（指向本地 clone）：

```
~/.claude/plugins/cache/autopilot/autopilot/
├── develop -> ~/projects/autopilot   # symlink — 即時編輯，/reload-plugins 同步
└── 2.0.0                             # 快照 — 安裝或 reload 時建立
```

**Symlink 命名**：目錄名不需要是 semver。可以用語意名如 `develop`、`nightly`、`local` 區分開發 symlink 和正式快照。Claude Code 會讀 symlink 指向的 `plugin.json` 取得實際版本號。

**清理舊 cache**：升版後舊目錄不會自動刪除，手動清理：

```bash
rm -rf ~/.claude/plugins/cache/autopilot/autopilot/<舊版本>
```

### Branch 工作流

| Branch | 用途 | `plugin.json` version |
|--------|------|----------------------|
| `main` | 穩定發佈，打 tag（如 `v1.4.5`） | 對應最新 tag |
| `develop` | 下一版開發中 | 下一個主/次版號（如 `2.0.0`） |

開發時：checkout `develop`，symlink 指向它，`/reload-plugins` 即時生效。發佈前記得 bump `plugin.json` version 再打 tag。

## 更新（marketplace 使用者）

```bash
/plugin update autopilot@autopilot
```

## [更新日誌](CHANGELOG.md)

## 起源

從 100+ 個 AI 驅動開發專案實戰提煉。

## License

MIT — 見 [LICENSE](LICENSE)。
