# Autopilot v2 Skill 設計改善計畫

**日期：** 2026-03-26 ~ 2026-03-27
**狀態：** ✅ 全部完成，develop 驗證中
**來源：** Think Tank 6 角色分析 + eval 數據 + 手動測試

---

## 背景

skill-creator eval 顯示 10 個 skill 的 standalone trigger 只有 6%（50/50 negative 正確，3/50 positive 觸發）。
Think Tank 分析揭露更深層的架構問題：三層觸發的 bootstrap 悖論、路由表維護負債、語意碰撞。

## 已完成

- [x] **Description 改寫**：10 個 skill 全部用使用者意圖語言重寫（eval 3 個提升到 60%）
- [x] **Eval artifact 清除**：68 個 `~/.claude/commands/*-skill-*.md` 殘留檔案已刪除
- [x] **README v2 同步**：EN + zh-TW 都更新到 v2，含三層觸發設計說明

---

## Phase 1：解除 Bootstrap 悖論（S）

**目標**：Autopilot 自帶 priming，不再硬依賴 Superpowers 的 using-superpowers。

| 步驟 | 檔案 | 說明 |
|------|------|------|
| 1a | `hooks/hooks.json` | 註冊 `SessionStart` hook，plugin 啟用時自動載入 |
| 1b | `hooks/session-start.sh` | stdout 注入 context：精簡版 "先查 skill" 指令（3 句核心） |
| 1c | 更新 `plugin.json` | 確認 hooks 路徑被 plugin 系統認到 |

**驗證**：新 session 不裝 Superpowers，打 "what should I work on next?" → `autopilot:next` 是否觸發。

**附帶**：`run-eval-batch.sh` 結尾加 `rm ~/.claude/commands/*-skill-*.md`，防止 eval artifact 再次汙染。

---

## Phase 2：Description 審計（S，可跟 Phase 1 平行）

**目標**：10 個 Autopilot skill 補中文觸發詞 + 27 個 PEACE skill 補 "Not for" 邊界。

| 步驟 | 範圍 | 說明 |
|------|------|------|
| 2a | 10 個 autopilot skill | 補中文觸發詞（ceo-agent 已有，其餘 9 個審計補齊） |
| 2b | 27 個 peace-* skill | 每個 description 加 "Not for" 邊界，防止搶 Autopilot 的 query |

**優先處理碰撞最嚴重的**：
- `peace-console-port` vs `autopilot:audit`（都做 feature parity）
- `verification-before-completion` vs `autopilot:quality-pipeline`（都做 pre-commit check）

**依據**：研究顯示中文觸發詞有 ~5-10% 邊際提升，成本低。"Not for" 邊界目前只有 Autopilot 單向防守，PEACE skill 沒有 → 護城河缺一半。

---

## Phase 3：整合 Eval（M）

**目標**：建帶 CLAUDE.md context 的 eval，測三層合力的真實 trigger rate。

| 步驟 | 說明 |
|------|------|
| 3a | 寫 `run_eval_integrated.py`（或改 `run_eval.py` 加 `--with-context` flag） |
| 3b | inject 精簡版 CLAUDE.md（routing table + priming 指令）到 `claude -p` 的 system prompt |
| 3c | 跑 10 skill eval，建立三層合力的 baseline |
| 3d | 對比 Phase 1 前後的 trigger rate 差異 |

**待決定**：inject 多少 context？全量 CLAUDE.md（~8K tokens）還是精簡版（routing table only ~2K tokens）？

---

## Phase 4：架構決策 ✅

### 4a. Dispatcher skill 取代路由表 → **不做**

SessionStart hook 已 lazy-load autopilot routing。CLAUDE.md 路由表精簡為只留 `peace-*`（省 ~500 tokens）。加 dispatcher skill 多一層間接，不值得。

### 4b. next/learn/retro 併入 dev-flow → **不做**

三個 skill 各自有獨立執行邏輯（119/185/225 行），有 `/command` 入口。併入會讓 dev-flow 膨脹且失去明確入口。

### 4c. Config 優先順序鏈 → **已寫入 `dev-flow-config.md`**

`project config > session rules > Superpowers default`。衝突時以專案 config 為準。

### 4d. Session Rules 分階段注入 → **已寫入 `dev-flow-config.md`**

按 phase 注入：start→dev-flow-config（永駐），debug→debug-config（解決後卸載），test→test-strategy-config（通過後卸載），quality→quality-gate-config（commit 後卸載）。

---

## 設計原則（Think Tank 確認）

1. **Autopilot = Rule-setter, Superpowers = Executor** — quality-pipeline 是唯一例外（自己跑 scan），正式豁免
2. **三層觸發：SessionStart hook priming → CLAUDE.md 路由 → Description 語意配對** — hook 取代對 using-superpowers 的依賴
3. **Description 是 UI，不是文檔** — 用使用者意圖語言，不用內部術語
4. **"Not for" 是雙向護城河** — Autopilot 和 PEACE skill 都要有邊界聲明

## 相關檔案

- Think Tank Brief: 本 session 對話記錄
- Eval sets: `skill-creator-workspace/evals/<skill>-evals.json`
- Eval results: `skill-creator-workspace/results/`
- Batch runner: `scripts/run-eval-batch.sh`
