<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Claude Code 的開發工作流 skill — 你的 agent 作業系統。</strong><br>
  14 個 skill 讓 Claude 從通用 agent 變成有紀律的開發者。<br>
  安裝一次，所有專案通用。零設定即可使用。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-1.4.0-E8A838?style=flat-square" alt="v1.4.0">
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
| **dev-flow** | 評估任務規模，引導 commit 或 plan+project 流程；含 session 生命週期（開工/收工）與目標對齊 | Agent 不做計畫直接衝 |
| **survey** | 雙 agent 研究（researcher + skeptic 平行） | Agent 挑第一個找到的選項 |
| **think-tank** | 6 個角色辯論做策略決策 | 單一視角分析 |
| **ceo-agent** | 自主執行模式 | Agent 事事都問你 |
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

## 安裝

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

完成。14 個 skill 立即可用：`autopilot:dev-flow`、`autopilot:survey` 等。

---

## Skill 如何協作

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

## 專案設定（可選）

Skill 預設就能用。如果需要專案特化行為，加設定檔：

### `.claude/dev-flow-config.md`

自訂 dev-flow 的規模判斷、品質閘門、build 指令和特殊規則。

```markdown
# Dev Flow — 專案設定

## 規模規則
- **S**: 單模組、不改介面 → 直接 commit
- **L**: 跨 3+ 模組、公開介面 → plan + project + PR

## 品質閘門
- S: `npm test && npm run lint`
- L: 完整測試 + 每 phase code review

## Build & Deploy
- Build: `docker compose build`
- Staging: `docker compose up -d`
```

### `.claude/quality-gate-config.md`

自訂 quality-pipeline 的測試、掃描、review 指令。

### `.claude/project-lifecycle-config.md`

自訂專案路徑、bootstrap/archive 腳本。

### `.claude/next-config.md`

自訂 next skill 的工作來源路徑。

### `.claude/team-config.md`

自訂 team 的角色範本，配合你專案的技術棧。

### `.claude/test-strategy-config.md`

自訂 test-strategy 的測試指令、金字塔比例和覆蓋率門檻。

### `.claude/skill-routing.md`

把關鍵字對應到你專案的 domain skill。

```markdown
# Skill Routing

| 關鍵字 | Invoke |
|--------|--------|
| 資料庫 | `your-db-skill` |
| 部署   | `your-deploy-skill` |
| crash  | `your-debug-skill` |
```

### 注入機制

`dev-flow` 用 Claude Code 的 `!`command`` 預處理器在 invocation 時讀取設定：

```markdown
## 專案設定（自動注入）
!`cat .claude/dev-flow-config.md 2>/dev/null || echo "沒有設定檔 — 使用預設值。"`
```

沒有設定檔？預設值自動生效。新專案零摩擦。

> 範本在 [`project-config-template/`](project-config-template/)。

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

## 更新

```bash
/plugin update autopilot@autopilot
```

## [更新日誌](CHANGELOG.md)

## 起源

從 100+ 個 AI 驅動開發專案實戰提煉。

## License

MIT — 見 [LICENSE](LICENSE)。
