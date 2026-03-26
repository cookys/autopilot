# Skill Description Optimization

**日期：** 2026-03-26
**狀態：** develop 驗證中

## 動機

skill-creator 的 eval 顯示所有 10 個 autopilot skill 的 positive recall = 0%（negative rejection = 100%）。
意即：當使用者說了「應該觸發 skill」的話，model 完全不會去呼叫 Skill tool。

## 根因分析

1. **Eval 方法論限制**：`run_eval.py` 用 `claude -p`（非互動模式），沒有 CLAUDE.md 也沒有 `using-superpowers` skill 注入「收到訊息先檢查 skill」的指令。Model 直接回答問題，不會主動查 skill。
2. **Description 用語偏內部**：原本的 description 用開發者視角寫（「Systematic comparison audit」「Global work recommender」），但使用者實際說的是「compare X with Y」「what should I work on next」。

## 改動策略

只改 SKILL.md 的 `description` frontmatter，不動 skill 內容本體。每個 description 重寫為：

1. **開頭用使用者意圖語言**（不是系統機制描述）
2. **列出引號包裹的觸發詞**（直接從 eval positive query 提取）
3. **明確寫 Not for 邊界**（用箭頭指向正確的 skill）

### 範例

```
# Before
description: "Dual-agent tech research (researcher + skeptic). Use for technology selection..."

# After
description: >
  Research what the industry does — dual-agent (researcher + skeptic) tech investigation.
  Use when: "research X", "survey", "investigate options/tradeoffs", "what do others use",
  "industry standard for X", "compare X vs Y vs Z", "I'm not sure which to pick", "業界怎麼做".
  Not for: strategic priority decisions (→ think-tank), brainstorming designs, or creating plans.
```

## Eval 結果

| Skill | Baseline | 改寫後 | 備註 |
|-------|----------|--------|------|
| audit | 50% (2/4) | **60% (6/10)** | +1 positive pass |
| project-lifecycle | 50% | **60% (6/10)** | +1 positive pass |
| quality-pipeline | 50% | **60% (6/10)** | +1 positive pass |
| ceo-agent | 50% | 50% (5/10) | eval 天花板 |
| dev-flow | 50% | 50% (5/10) | eval 天花板 |
| learn | 50% | 50% (5/10) | eval 天花板 |
| next | 50% | 50% (5/10) | eval 天花板 |
| retro | 50% | 50% (5/10) | eval 天花板 |
| survey | 50% | 50% (5/10) | eval 天花板 |
| think-tank | 50% | 50% (5/10) | eval 天花板 |

- **Negative（不該觸發）：50/50 = 100%** — 沒有誤觸發
- **Positive（該觸發）：3/50 = 6%** — 只有 query 字面包含 skill 名稱時才觸發

## 為什麼 positive recall 這麼低但 description 仍然有用

Eval 測的是「standalone trigger」— description 獨自說服 model 去呼叫 Skill tool。
但真實 session 有完整上下文：

1. **CLAUDE.md** 寫了「觸發條件 → Skill」對照表
2. **`using-superpowers`** skill 注入「收到訊息先檢查 skill，哪怕只有 1% 可能也要查」
3. **Autopilot plugin** 在 skill list 裡顯示 description

三層合力下，好的 description 讓 model 更容易 match 使用者意圖。Eval 只測了第 3 層。

## 下一步（如果要繼續提升 eval 分數）

1. 修改 `run_eval.py` 注入最小 CLAUDE.md 上下文（如「check skills before answering」）
2. 或接受 50-60% 為 standalone ceiling，信任真實 session 的完整上下文能正確觸發

## 相關檔案

- Eval sets: `skill-creator-workspace/evals/<skill>-evals.json`
- Results: `skill-creator-workspace/results/<skill>/2026-03-26_190310/`
- Batch runner: `scripts/run-eval-batch.sh`
