# Autopilot v2 Skill 設計改善計畫

**日期：** 2026-03-26
**狀態：** develop 驗證中
**來源：** Think Tank 6 角色分析 + eval 數據

---

## 背景

skill-creator eval 顯示 10 個 skill 的 standalone trigger 只有 6%（50/50 negative 正確，3/50 positive 觸發）。
Think Tank 分析揭露更深層的架構問題：三層觸發的 bootstrap 悖論、路由表維護負債、語意碰撞。

## 已完成

- [x] **Description 改寫**：10 個 skill 全部用使用者意圖語言重寫（eval 3 個提升到 60%）
- [x] **Eval artifact 清除**：68 個 `~/.claude/commands/*-skill-*.md` 殘留檔案已刪除
- [x] **README v2 同步**：EN + zh-TW 都更新到 v2，含三層觸發設計說明

---

## Think Tank 發現摘要

### 共識（6 角色一致）

1. **using-superpowers 是未宣告的硬依賴** — 沒有它，trigger 只有 6%
2. **CLAUDE.md 34 行路由表不可擴展** — 手動維護 + token 佔用 + drift
3. **沒有整合測試** — eval 只測 Layer 3，真實路由靠 Layer 1
4. **語意碰撞** — quality-pipeline vs verification-before-completion 最危險

### 關鍵分歧

| 議題 | 正方 | 反方 |
|------|------|------|
| next/learn/retro 併入 dev-flow？ | Product: 太薄，減少 skill 數 | UX: 獨立有明確入口，併入反而埋掉 |
| quality-pipeline 該自己跑 scan？ | Product: 確定性 > 原則 | Architect: 違反 rule-setter 邊界 |

### Collision Insight

**Bootstrap 悖論已有解**：Autopilot 支援 `SessionStart` plugin hook（`hooks/hooks.json`），可在 session 啟動時自動注入 priming 指令，不再依賴 Superpowers 的 using-superpowers 先觸發。

---

## 行動項目

### P0 — 立即可做

| # | 項目 | 說明 | 工作量 |
|---|------|------|--------|
| 1 | **SessionStart hook** | 加 `hooks/hooks.json`，session 啟動自動注入 "先查 skill" 的 priming 指令。解決 bootstrap 悖論，不再硬依賴 Superpowers | S |
| 2 | **Eval artifact 清理腳本** | `scripts/run-eval-batch.sh` 結束後自動清 `~/.claude/commands/*-skill-*`，防止再次汙染 | S |

### P1 — 短期改善

| # | 項目 | 說明 | 工作量 |
|---|------|------|--------|
| 3 | **整合 eval** | 建帶 CLAUDE.md context 的 eval harness，測三層合力的真實 trigger rate | M |
| 4 | **PEACE skill 加 "Not for"** | 27 個 `peace-*` skill 的 description 補 "Not for" 邊界，防止搶 Autopilot 的 query | M |
| 5 | **中文觸發詞補齊** | 研究顯示跨語言 match ~90%，加中文提升到 ~97%。成本低，有邊際效益 | S |
| 6 | **Session rules 分階段注入** | dev-flow 目前一次注入所有 config（累積 ~6K tokens 永不卸載）。改為只注入當前階段的 config | M |

### P2 — 需要更多討論

| # | 項目 | 說明 | 待釐清 |
|---|------|------|--------|
| 7 | **Dispatcher skill 取代路由表** | 一個 skill 負責讀 routing config + 分發，從 CLAUDE.md 搬到 lazy-load | 是否比 CLAUDE.md 靜態表更可靠？token 成本如何？ |
| 8 | **next/learn/retro 併入 dev-flow** | Product 建議砍到 7 skill | UX 的 `/command` 入口問題要先解決 |
| 9 | **Config 優先順序鏈** | 當 dev-flow config、test-strategy config、Superpowers TDD 互相衝突時的明確優先序 | 需定義 project config > session rule > Superpowers default |
| 10 | **Superpowers 版本 contract** | config 裡硬編碼 `superpowers:requesting-code-review`，Superpowers 改名就壞 | 加 drift check？或用 pattern match？ |

---

## 設計原則（Think Tank 確認）

1. **Autopilot = Rule-setter, Superpowers = Executor** — quality-pipeline 是唯一例外（自己跑 scan），需要決定是否正式豁免
2. **三層觸發：CLAUDE.md 路由 → Plugin hook priming → Description 語意配對** — SessionStart hook 取代對 using-superpowers 的依賴
3. **Description 是 UI，不是文檔** — 用使用者意圖語言，不用內部術語
4. **"Not for" 是雙向護城河** — Autopilot 和 PEACE skill 都要有邊界聲明

## 相關檔案

- Think Tank Brief: 本 session 對話記錄
- Eval sets: `skill-creator-workspace/evals/<skill>-evals.json`
- Eval results: `skill-creator-workspace/results/`
- Batch runner: `scripts/run-eval-batch.sh`
- Description 改寫 commit: develop branch
