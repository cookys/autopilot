<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Claude Code 的開發工作流 skill — 你的 agent 作業系統。</strong><br>
  14 個 skill 讓 Claude 從通用 agent 變成有紀律的開發者。<br>
  安裝一次，所有專案通用。零設定即可使用。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-1.4.4-E8A838?style=flat-square" alt="v1.4.4">
  <img src="https://img.shields.io/badge/skills-14-4A90D9?style=flat-square" alt="14 Skills">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp; <b>正體中文</b>
</p>

---

## 問題

AI coding agent 每次 session 都從零開始：

- 一個任務要改 5 個模組 — agent 不做計畫直接衝，改到一半忘了另一半
- 你問「該用 X 還是 Y？」— agent 挑第一個找到的，不研究 trade-offs
- Agent 花很久修好一個 tricky bug — 下個 session 碰到**完全一樣的問題**不記得
- Session context 被壓縮 — 辛苦找到的解法和架構決策消失了

## 解決方案

Autopilot 給你的 agent **標準作業流程**，強制紀律：

| Skill | 做什麼 | 沒有它會怎樣 |
|-------|--------|------------|
| **dev-flow** | 評估任務規模，引導 commit 或 plan+project 流程；含 session 生命週期與目標對齊 | Agent 不做計畫直接衝 |
| **survey** | 雙 agent 研究（researcher + skeptic 平行） | Agent 挑第一個找到的選項 |
| **think-tank** | 6 個角色辯論做策略決策 | 單一視角分析 |
| **ceo-agent** | 自主執行模式，具備 CEO 級判斷力 | Agent 事事都問你 |
| **quality-pipeline** | 統一品質閘門：test → scan → review | 品質檢查不一致 |
| **project-lifecycle** | Plan → 建專案 → 結構 → 歸檔 | 專案半途而廢或未歸檔 |
| **learn** | 失敗後自動記錄知識；含知識健康審計 | 跨 session 重複犯同樣的錯 |
| **retro** | 從 git history 做工程回顧 | 看不到工作模式 |
| **next** | 掃描所有工作來源，推薦最高優先任務；含改善項目處理 | 不知道下一步該做什麼 |
| **team** | 多 agent 平行化 + 依賴分析 | 能平行卻只用單線程 |
| **profiling** | Evidence-first 效能分析方法論 | Agent 不量測就從程式碼猜原因 |
| **test-strategy** | 測試金字塔、baseline 管理、feature flag 分級 | 測試覆蓋率不一致、缺乏策略 |
| **audit** | 實作間的系統性比對 | 人工 review 遺漏差異 |
| **debug** | Evidence-first 除錯：log、工具、再看程式碼 | Agent 不調查就猜原因 |

---

## 核心特色

### 三種操作模式

Autopilot 為不同情境提供三種認知模式：

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
    ├─ S (小): 實作 → quality-pipeline → commit             │
    │                                                    │
    └─ L (大): project-lifecycle（建專案）                  │
         │     → 逐 phase 實作                            │
         │     → quality-pipeline 每 phase                │
         │     → project-lifecycle（歸檔）                 │
         │                                               │
         ├─ 需要調研？ ──→ survey                         │
         ├─ 策略決策？ ──→ think-tank                     │
         ├─ 使用者說「搞定它」？ ──→ ceo-agent             │
         ├─ 可平行？ ──→ team                             │
         │                                               │
         └─ session 結束 ──→ learn（擷取知識）             │
                             retro（定期回顧）             │
                                                         │
 下一步做什麼？ ──→ next（掃描 → 排序 → 推薦）            │
                                                         │
 ◄───────────────────────────────────────────────────────┘
```

### Skill 邊界

| 決策類型 | 用這個 |
|---------|--------|
| 技術選擇（X library vs Y） | `survey` — 雙視角外部研究 |
| 策略選擇（要不要做？做多大？先做哪個？） | `think-tank` — 多角色內部辯論 |
| 使用者要結果，不要參與過程 | `ceo-agent` — 自主執行 |
| 使用者想參與 | `dev-flow` — 有 checkpoint 的引導流程 |

---

## 安裝

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

完成。14 個 skill 立即可用：`autopilot:dev-flow`、`autopilot:survey` 等。

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

`!`command`` 語法是 Claude Code 的預處理器 — 它執行 shell 指令，把輸出 inline 到 skill body 中，*在 LLM 看到之前*完成。這代表：

- **沒有設定檔？** `|| echo "defaults"` fallback 自動生效。新專案零摩擦。
- **設定是自然語言。** Markdown 比 YAML 更有表達力 — 你可以用散文寫規則、例外和理由。
- **設定是專案級的。** 每個 repo 有自己的 `.claude/` 目錄。同一個 autopilot plugin 適配 C++ 遊戲伺服器、React app、或 Rust CLI — 全靠不同的設定檔。

### 可用設定檔

| 設定檔 | 自訂什麼 | 範本 |
|--------|---------|------|
| `.claude/dev-flow-config.md` | 規模規則、品質閘門、build 指令、特殊規則 | [範本](project-config-template/dev-flow-config.md) |
| `.claude/quality-gate-config.md` | 測試、掃描、review 指令 | [範本](project-config-template/quality-gate-config.md) |
| `.claude/project-lifecycle-config.md` | 專案路徑、bootstrap/archive 腳本 | [範本](project-config-template/project-lifecycle-config.md) |
| `.claude/next-config.md` | next skill 的工作來源路徑 | [範本](project-config-template/next-config.md) |
| `.claude/team-config.md` | 團隊角色範本，配合技術棧 | [範本](project-config-template/team-config.md) |
| `.claude/test-strategy-config.md` | 測試指令、金字塔比例、覆蓋率門檻 | [範本](project-config-template/test-strategy-config.md) |
| `.claude/debug-config.md` | 專案特定的 debug 工具和 log 路徑 | [範本](project-config-template/debug-config.md) |
| `.claude/profiling-config.md` | 效能分析工具和指標收集 | [範本](project-config-template/profiling-config.md) |
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

**為什麼 14 個 skill，不是更多？**
精簡為本。內部調度邏輯（session 開工/收工、目標對齊、context 縮減、改善佇列、記憶健康）已吸收進使用它們的 skill — 主要是 dev-flow、learn 和 next。14 個公開 skill 涵蓋工作流層：跨專案通用的決策、流程、品質閘門和除錯。Domain skill 屬於各專案的 `.claude/skills/`，不該放在共享 plugin。

**為什麼用 `!`command`` 注入，不用設定檔？**
在 Claude Code 的世界，「設定」就是自然語言。Invocation 時讀取的 markdown 比 YAML 更有表達力，不需要 schema，檔案不存在時自動 graceful degradation。

**跟其他 skill 共存？**
沒問題。Autopilot 是工作流層。你專案的 domain skill、superpowers、其他 plugin 全部共存 — autopilot 調度，它們執行。

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

## 更新（marketplace 使用者）

```bash
/plugin update autopilot@autopilot
```

## [更新日誌](CHANGELOG.md)

## 起源

從 100+ 個 AI 驅動開發專案實戰提煉。

## License

MIT — 見 [LICENSE](LICENSE)。
