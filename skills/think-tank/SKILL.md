---
name: think-tank
description: "Multi-role think tank for product/strategy decisions — 6 specialized roles debate in parallel, then collide to produce a Decision Brief with consensus, conflicts, and insights. Use when facing decisions beyond pure technical choice: 要不要做、做多大、先做哪個、怎麼平衡 tradeoffs. Complements survey (external research) with internal multi-perspective analysis."
---

# Think Tank — Multi-Role Decision Brief

6 個專業角色平行分析同一個議題，各自產出觀點，然後交叉碰撞。價值在分歧點，不在共識。

## 何時使用

| 觸發 | 範例 |
|------|------|
| 產品/策略決策 | 「要不要做 X？」「先做 A 還是 B？」 |
| Scope 決策 | 「做到什麼程度？」「Phase 1 包含什麼？」 |
| Tradeoff 分析 | 「效能 vs 功能 vs 維護成本」 |
| 風險評估 | 「這個改動的 blast radius？」 |
| CEO Agent 遇戰略決策 | CEO 可自主 invoke 此 skill |

**不適用**：純技術選型（X library vs Y library）→ 用 `survey`。

## 和其他 skill 的關係

```
survey       → 外部資料蒐集（業界怎麼做）
think-tank   → 內部多視角辯論（我們該怎麼做）  ← 本 skill
ceo-agent    → 決策後自主執行
```

可串接：survey 產出 → 餵給 think-tank 當 input → Decision Brief → CEO 決策。

## 角色配置

### 6 個標準角色

| 角色 | voltagent subagent_type | 關注維度 |
|------|------------------------|---------|
| **架構師** | `voltagent-qa-sec:architect-reviewer` | 技術可行性、系統耦合、效能、技術債 |
| **產品總監** | `voltagent-biz:product-manager` | 功能 ROI、優先級、scope、success metrics |
| **UX 代言人** | `voltagent-biz:ux-researcher` | 玩家體驗、操作流暢度、邊界互動 |
| **QA 惡魔** | `voltagent-qa-sec:qa-expert` | 測試覆蓋、regression risk、failure modes |
| **營運代表** | `voltagent-infra:sre-engineer` | 部署複雜度、監控、rollback、記憶體/CPU |
| **玩家代表** | `voltagent-biz:customer-success-manager` | 玩家需求、痛點、留存影響 |

### 快速模式（3 角色）

小決策不需要 6 角色。依議題選最相關的 3 個：

| 議題類型 | 建議角色 |
|---------|---------|
| 技術方案選擇 | 架構師 + QA + 營運 |
| 功能 scope 決策 | 產品 + UX + 玩家 |
| 效能 vs 功能 | 架構師 + 產品 + 營運 |
| 新遊戲功能 | UX + QA + 玩家 |

## 執行流程

### Step 1: 定義議題

從用戶輸入提取：
- **議題**: 一句話描述要決定什麼
- **背景**: 目前狀態、已知約束
- **Survey 結果**: 如果之前跑過 survey，摘要結論

如果議題太模糊，先問一輪釐清。

### Step 2: 準備 domain context

讀取與議題相關的 codebase context（architecture docs, game skills, 相關 source code），整理為所有角色共用的 context block。每個角色都需要足夠的 domain 知識才能產出有價值的觀點。

### Step 3: 平行 dispatch

同時 spawn 所有角色（6 或 3 個），每個 agent 帶：
- 角色 prompt（見 [references/role-prompts.md](references/role-prompts.md)）
- 共用 domain context
- 議題 + 背景

```
Agent({
  subagent_type: "<voltagent-type>",
  prompt: "<role-prompt> + <domain-context> + <topic>",
  run_in_background: true,
  name: "tt-<role>"
})
```

所有角色 **同時** dispatch — 不要等一個完成再 dispatch 下一個。

### Step 4: 碰撞彙整

所有角色回報後，彙整為 Decision Brief：

1. **找共識** — 所有角色都同意的結論
2. **找分歧** — 角色之間的衝突點（這是最有價值的部分）
3. **找洞見** — 角色碰撞產出的新觀點（A 的觀點 + B 的觀點 → 誰都沒單獨想到的 insight）
4. **彙總推薦** — 每個角色的立場 (✅/⚠️/❌) + 一句話理由

### Step 5: 產出 Decision Brief

使用固定格式（見 [references/brief-template.md](references/brief-template.md)），包含：
- 共識
- 分歧地圖（ASCII diagram 呈現角色之間的張力）
- 關鍵分歧點表（正方 vs 反方 + 張力等級）
- 各角色推薦彙總表
- 最有價值的 2-3 個碰撞洞見
- CEO 建議（如果在 CEO mode 下）

## 產出格式要求

- Decision Brief 必須在一則回覆中呈現完整結果
- 分歧地圖用 ASCII diagram（不用 mermaid）
- 每個角色最多 300 words 的 output
- Brief 本身不超過用戶能在 2 分鐘內讀完的長度

## 錯誤處理

| 狀況 | 處理 |
|------|------|
| Agent timeout | 用已收到的角色結果產出 partial brief，標記缺席角色 |
| 所有角色都同意 | 正常情況 — 標記為「共識強」，但特別檢查是否漏了角度 |
| 所有角色都反對 | 呈報用戶，建議不做或重新定義議題 |
| 議題太大（涉及多個獨立決策） | 拆成多個 sub-topic，每個跑一輪 |

## See Also

| Skill | 關係 |
|-------|------|
| `survey` | survey 找外部資料，think-tank 做內部辯論。可串接 |
| `ceo-agent` | CEO 在戰略決策時可自主 invoke think-tank |
| `team` | team 做平行執行，think-tank 做平行分析 |
