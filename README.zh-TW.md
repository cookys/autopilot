<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Claude Code 的生命週期編排 — 定規則的人，Superpowers 執行。</strong><br>
  11 個 skill，在內建 Superpowers 之上加入生命週期管理、策略決策和品質閘門。<br>
  放一個設定檔，就有專案感知的工作流。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-2.0.0-E8A838?style=flat-square" alt="v2.0.0">
  <img src="https://img.shields.io/badge/skills-11-4A90D9?style=flat-square" alt="11 Skills">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp; <b>正體中文</b>
</p>

---

## 問題

Claude Code 內建的 Superpowers 處理戰術面很強 — TDD、除錯、規劃、code review。但缺少：

- **生命週期管理** — 沒有任務規模評估、沒有專案追蹤、沒有 session 開工/收工紀律
- **策略決策** — 沒有多角色辯論、沒有雙 agent 調研
- **品質閘門** — 沒有統一的 test → scan → completeness → review pipeline
- **自我提升** — 沒有知識擷取、沒有回顧、沒有「下一步做什麼」推薦
- **專案特定上下文** — 沒有機制注入你專案的工具、慣例和已知地雷

## 解決方案

Autopilot 在 Superpowers 之上加入**生命週期編排和策略智慧**：

| Skill | 做什麼 | Superpowers 負責的 |
|-------|--------|-------------------|
| **dev-flow** | 評估任務規模（S/L/H），設定 session rules 注入設定和品質閘門，管理專案追蹤 | Planning、TDD、除錯、code review（戰術執行） |
| **survey** | 雙 agent 調研（researcher + skeptic） | — （無對應） |
| **think-tank** | 6 角色辯論做策略決策 | brainstorming（不同層級 — 需求探索） |
| **ceo-agent** | 自主執行，CEO 級判斷力 | — （無對應） |
| **quality-pipeline** | 統一品質閘門：test → scan → completeness → review | verification-before-completion（部分） |
| **finish-flow** | Size-aware 收尾 forcing function — TaskCreate 展開 L-5 / H-9 / Fix / S-Lite discrete sub-tasks，防止收尾被靜默壓縮 | — （無對應） |
| **project-lifecycle** | Plan → bootstrap → 結構 → 歸檔 | finishing-a-development-branch（部分） |
| **learn** | 失敗後自動記錄知識；知識健康審計 | — （無對應） |
| **retro** | 從 git history 做工程回顧 | — （無對應） |
| **next** | 掃描所有工作來源，推薦最高優先任務 | — （無對應） |
| **audit** | 實作間的系統性比對 | — （無對應） |

### Rule-Setter 模型

Autopilot 不跟 Superpowers 競爭 — 它定規則，Superpowers 在規則內執行：

```
autopilot:dev-flow 設定 session rules：
  → "除錯時，讀 .claude/debug-config.md 取得專案上下文"
  → "commit 前，跑 autopilot:quality-pipeline"
  → "session 結束時，更新專案追蹤"

superpowers skills 在這些規則內執行：
  → systematic-debugging（帶專案設定上下文）
  → test-driven-development（帶專案測試慣例）
  → writing-plans（在 dev-flow 的 sizing 框架內）
```

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

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

完成。11 個 skill 立即可用：`autopilot:dev-flow`、`autopilot:survey` 等。

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

**為什麼 11 個 skill，不是 14 個？**
v2 移除了 4 個跟內建 Superpowers 重疊的 skill（debug、test-strategy、team、profiling）。它們的方法論現在由 Superpowers 處理；它們的專案設定注入現在由 dev-flow 的 Session Rules 處理。更少 skill = 更少 context window 壓力、更少路由歧義。

**為什麼用 `!`command`` 注入，不用設定檔？**
在 Claude Code 的世界，「設定」就是自然語言。呼叫時讀取的 markdown 比 YAML 更有表達力，不需要 schema，檔案不存在時自動 graceful degradation。

**跟 Superpowers 怎麼共存？**

Autopilot 是 rule-setter（定規則的人），Superpowers 是 executor（執行的人）。兩者透過三層觸發設計共存：

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

## 靈感來源

- **[gstack](https://github.com/garry-t/gstack)** — Garry Tan 為 Claude Code 打造的 skill 套件。CEO agent 的認知模式（Bezos 的 two-way door、Munger 的反向思維、Jobs 的減法聚焦）、Boil the Lake 完整性原則、以及範圍模式系統，都改編自 gstack 的 `plan-ceo-review` skill。

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
