# think-tank-dialectic Skill 設計計畫

**日期：** 2026-04-11
**狀態：** ✅ Phase 1 完成 — v2.2.0 已 merge 到 develop 並 push
**來源：** 完整研究 `~/projects/agora/` 和 `~/projects/council-of-high-intelligence/` 後的機制吸收
**Size：** L
**Dogfood：** 這個計畫本身的決策（think-tank 是否分成兩個 skill）即是 think-tank-dialectic 的典型使用場景

---

## 1. 背景與動機

### 1.1 問題

目前 `autopilot:think-tank` 採用單輪平行分析模式：6 個 voltagent 職能 role（architect / product / ops / qa / ux / customer）同時分析同一議題，輸出 Decision Brief。這個設計對「誰會受影響 / 有哪些視角」類問題很有效，但有兩個結構性弱點：

1. **集體點頭偏誤**：6 個 voltagent agent 本質上都是同一個 Claude 演不同角色。在缺乏強制對立結構時，容易趨同輸出「看起來沒問題」的共識，而真實張力被稀釋
2. **沒有辯證升級路徑**：遇到真正低共識、高不可逆性的決策時，現有 think-tank 只能給一份多視角地圖，無法結構化地處理「兩個立場都有道理，怎麼辦」的問題

### 1.2 來源研究

完整掃描 Agora + Council of High Intelligence 兩個專案（~75 個實質檔案，驗證方式 `find <repo> -type f -not -path '*/.git/*' | wc -l`）後，識別出三個關鍵設計洞察：

1. **每個思考風格都必須攜帶自己的熔斷機制**（fail-safe）
   - 31 個 agent 的 Grounding Protocol 無一例外都包含「限制自己的 hard rule」
   - 例：Feynman max 2 analogies、Socrates 3-level depth limit、Popper max 1 analogy、Lao-Tzu 過 R2 必須提 concrete action

2. **辯證的核心是 Hegelian 結構**
   - Agora 的 8 步協議在 R2 強制每個 agent 提出 Synthesis Proposal，禁止選邊
   - Council 的 >70% 同意自動觸發 counterfactual，逼 2 個成員 steelman 對立面

3. **think-tank 類工具分兩種**：
   - 「多視角地圖」型（現有 think-tank）——低成本、頻繁使用
   - 「結構化辯證」型（新 think-tank-dialectic）——高成本、稀少使用、用於不可逆或高張力決策

### 1.3 本計畫的決策

建立一個**並列**於 think-tank 的新 skill `think-tank-dialectic`，而非升級現有 think-tank。理由：

- **失效模式相反**：think-tank 的失效是「集體點頭」，dialectic 的失效是「辯證為辯證」。無法用同一個 Grounding Protocol 覆蓋
- **成本不同**：dialectic 2-3 倍 token 消耗，合併會讓用戶反射性使用 `--depth full` 導致 over-spending
- **觸發條件不同**：think-tank 看「有哪些視角」，dialectic 看「哪個立場更對」
- **保留節制 friction**：分開的 skill 本身是摩擦，防反射性使用

---

## 2. OKR

### 2.1 成功條件

1. **結構性保證 dissent**：dialectic 輸出的 brief 必須包含 ≥ 2 個非重疊反對意見。若達不到，Grounding Protocol 自動觸發 counterfactual steelman
2. **明確辨識升級路徑**：現有 think-tank 在 LOW consensus 時建議 escalate，用戶有清楚指引
3. **熔斷機制完整**：dialectic 的 Grounding Protocol 必須涵蓋至少 4 條 hard rule 防過度使用
4. **最小化用戶認知負擔**：新 skill 的 description 明確講「不是 think-tank 的升級版」
5. **完整 dogfood**：這個計畫本身的決策（該不該建 dialectic）能作為 dialectic 的第一個使用案例記錄

### 2.2 非目標（Out of Scope）

**Phase 1 只加 4 個「新穎」機制**，其他 4 個留 Phase 2：
- ✅ **Phase 1 新穎機制**：Problem Restate Gate / Named Thesis-Antithesis / Dissent Quota / Hegelian Arc Section
- 🔶 **Phase 2 延後**：Forced Synthesis（R2 禁選邊）/ Novelty Gate（R2 必須有新論點）/ Counterfactual Trigger（>70% 自動 steelman）/ Anti-Recursion rules

**注意**：Phase 1 仍然包含完整的 8 步協議執行流程（Silent Pre-Check、Round 1/2、Adaptive Depth Gate、Coordinator Synthesis 等），和現有 think-tank 共通的標準 deliberation 骨架。「4 個機制」指的是**區別於現有 think-tank 的新穎機制**，不是「總共只做 4 件事」。

**其他非目標**：
- **不** fork Agora/Council 的 31 個 agent 檔案：只自建 2 個 adversarial agent prompt（inline 在 references/ 不獨立成 agent 檔案）
- **不**做多 provider routing：Claude-only 環境
- **不**做 `--duo` mode：留到未來觀察需求
- **不**建立 `skills/_shared/` 抽象：Phase 1 只有 dialectic 一個 consumer，放在 `skills/think-tank-dialectic/references/` 即可（per review S1：避免 N=1 過度抽象）

---

## 3. L-1.5 Scope Completeness Audit（per v2.1.1 mandate）

走 10 個 dimensions 確認 scope 涵蓋完整：

| Dimension | 狀態 | 產出位置 |
|---|---|---|
| **source** | ✅ 在 scope | `skills/think-tank-dialectic/SKILL.md` + `references/*.md` |
| **tests** | ❌ 不在 scope | autopilot skills 是 prose，無 unit test 慣例。依照現有 survey/think-tank 前例 |
| **docs** | ✅ 在 scope | SKILL.md 本身是文檔 + 本 plan doc |
| **API** | ❌ 不在 scope | n/a，skills 不公開 API |
| **templates** | ❌ 不在 scope | `project-config-template/` 只有 dev-flow 用，dialectic 不需要 per-project override |
| **CHANGELOG** | ✅ 在 scope | `CHANGELOG.md` v2.2.0 entry |
| **version** | ✅ 在 scope | `.claude-plugin/plugin.json` 2.1.1 → 2.2.0（新 skill = minor bump），兩份 README 的 version badge URL 也要同步 |
| **migration** | ❌ 不在 scope | 無 breaking change，現有 think-tank 不變 |
| **consumers** | ✅ 在 scope | 透過 `grep -rn "think-tank" skills/ hooks/` 實際掃描後的完整清單（見下方）而非憑記憶列舉 |
| **dogfood** | ⚠️ 部分 | 本 plan doc 記錄 dialectic 自身的設計決策為 retrospective 素材。**未**實際跑 dialectic 協議在「該不該建 dialectic」議題上——那是 rhetorical inflation。真正 dogfood 發生在 Phase 1 完成後第一次跑真實議題 |

**Consumer 完整掃描結果**（`grep -rn "think-tank" skills/ hooks/`）：

| 檔案 | 為什麼要改 |
|---|---|
| `skills/think-tank/SKILL.md` | 加 escalation section（R1 LOW consensus → 建議升級） |
| `skills/think-tank/references/brief-template.md` | Decision Brief footer 加 escalation recommendation |
| `skills/ceo-agent/SKILL.md` | Think Tank trigger rules 表加 dialectic boundary（行 62, 74, 83, 227 的 think-tank 引用需要更新 routing） |
| `skills/survey/SKILL.md` | 行 7「Not for: strategic priority decisions (→ think-tank)」需要決定是維持指向 think-tank（think-tank 再自己 escalate）還是同時指向 dialectic。**決策**：維持指向 think-tank 作為單一入口，think-tank 內部處理 escalation，降低用戶認知負擔 |
| `hooks/session-start.sh` | 行 22 routing table 加一行 dialectic：`"Irreversible decision, genuine stalemate, 不可逆決策, 兩邊都有道理, 辯證 \| autopilot:think-tank-dialectic"` |

**總共 17 個檔案**（8 新增 + 9 修改）：

**新增 (8)**：
1. `docs/plans/2026-04-11-think-tank-dialectic.md`（本文件）
2. `skills/think-tank-dialectic/SKILL.md`
3. `skills/think-tank-dialectic/references/role-prompts.md`
4. `skills/think-tank-dialectic/references/brief-template.md`
5. `skills/think-tank-dialectic/references/problem-restate-gate.md`
6. `skills/think-tank-dialectic/references/silent-pre-check.md`
7. `skills/think-tank-dialectic/references/minority-report.md`
8. `skills/think-tank-dialectic/references/epistemic-diversity-scorecard.md`

**修改 (9)**：
9. `skills/think-tank/SKILL.md`（add escalation section）
10. `skills/think-tank/references/brief-template.md`（LOW consensus footer）
11. `skills/ceo-agent/SKILL.md`（think-tank trigger rules: dialectic boundary）
12. `skills/survey/SKILL.md`（Not for boundary — 保持單一入口）
13. `hooks/session-start.sh`（routing table add dialectic row）
14. `CHANGELOG.md`（v2.2.0 entry）
15. `.claude-plugin/plugin.json`（version bump 2.1.1 → 2.2.0）
16. `README.md`（skill count 11 → 12, skill table add dialectic, version badge URL update）
17. `README.zh-TW.md`（same）

---

## 4. 核心設計

### 4.1 Role Composition（4 職能 + 2 對抗性）

```
┌─────────────────────────────────────────────┐
│           think-tank-dialectic Panel        │
├─────────────────────────────────────────────┤
│                                             │
│  職能 (Voltagent subtypes — domain context) │
│  ─────────────────────────────────────      │
│  1. Architect      (architect-reviewer)     │
│  2. Product        (product-manager)        │
│  3. Ops/SRE        (sre-engineer)           │
│  4. QA Devil       (qa-expert)              │
│                                             │
│  對抗性 (general-purpose + inline prompt)   │
│  ─────────────────────────────────────      │
│  5. Falsifier (Popper-style red team)       │
│  6. Inverter  (Munger-style inversion)      │
│                                             │
└─────────────────────────────────────────────┘
```

**設計理由**：
- 4 職能提供 domain awareness（理解 TWGameServer 現實）
- 2 對抗性 **在 prompt 層級就要求提出反對**，不依賴「剛好想出反對意見」的運氣
- 6 人總數不變，維持和 think-tank 同等 token 成本（除 R2 觸發時增加）

**對抗性 agents 不獨立成檔**：
- 兩個 prompt 放在 `skills/think-tank-dialectic/references/role-prompts.md`
- Dispatch 時用 `subagent_type: "general-purpose"` + inline prompt 從 references 讀取
- 理由：autopilot 是 plugin，不負責 ship 全域 agents 檔案；保持 skill self-contained

**對抗性 agent 的結構弱點 + 緩解措施**（per review I2）：

4 職能 agent 透過 voltagent subagent_type 得到 **system-prompt 層級**的角色錨定；2 對抗性 agent 只透過 general-purpose + inline prompt，**結構上比 voltagent 弱一個層級**的 character persistence。在 2 輪辯證中，這會導致對抗性 role 在 R2 向中性立場漂移。**必須在 prompt 層級補強**：

1. **R2 重新注入完整 role prompt**：不是只發「基於上述 R1 outputs 分析」，而是 **重新完整貼一次** Popper/Munger 的 identity + method + anti-drift anchor
2. **具體 example moves**：prompt 中包含 2-3 個具體動作範例
   - Falsifier：例「'我們需要微服務擴展性' → 問：What evidence would prove this wrong? 提出反證實驗」
   - Inverter：例「'用 X 架構會成功' → 問：What would guarantee this fails? 列出 3 條失敗路徑」
3. **Anti-drift anchor sentence**（每次 dispatch 都要帶）：
   > 「Your job is NOT to find middle ground. If you arrive at 'both have merit', you have failed your role. Your value comes from maintaining the adversarial lens — the panel has other voices for synthesis, you are here to challenge.」
4. **R2 Grounding Protocol hemlock rule 主要作用對象就是這 2 個 agent**（見 4.2 rule 5）

### 4.2 Grounding Protocol — ANTI-DIALECTIC-OVERUSE

核心熔斷機制（**Phase 1 必做**）。**全部必須可執行**——沒有牆上時鐘、沒有跨 session 狀態（除非明確指定檔案存取），所以每條 rule 都必須指明如何偵測、如何執行：

1. **Max 2 rounds of deliberation**（R1 + optional R2，沒有 R3）
   - **偵測**：Coordinator 在 R2 完成後直接 fall-through 到 Synthesis，不進 R3 分支
   - **執行**：SKILL.md 的 execution sequence 只寫 R1 + R2，物理上沒有 R3 的 phase

2. **Session-scoped re-entry guard**（不依賴跨 session 記憶）
   - **偵測**：用戶在同一 conversation 內，對 **實質相同的 confirmed problem statement**（Step 2 輸出）第 2 次 invoke dialectic
   - **執行**：Coordinator 在 Step 0 先檢查 conversation history 中是否已有 `## Advance Decision Brief:` 標題且 confirmed problem statement 語意相近（由 Coordinator 判斷相似度），若是則第 2 次降級為 Quick Synthesis（只回顧上次 brief，不重跑），第 3 次直接拒絕並指向「記錄 non-reversible commitment」的 escape hatch
   - **注意**：跨 session 追蹤留 Phase 2（可選用 `.claude/knowledge/dialectic-history.md`），Phase 1 只管當前 session

3. **HIGH consensus 自動降級**
   - **偵測**：R1 完成後 Coordinator 評估 consensus 等級。若 ≥5/6 role 推薦同一方向 → HIGH
   - **執行**：HIGH consensus 時直接跳過 R2、跳過 Hegelian Arc section，輸出簡化版 brief 並在頂部加警告：「此議題共識度高，dialectic 的結構性辯證對你沒有額外價值，下次類似議題請直接用 `autopilot:think-tank`」

4. **Turn-count budget for interim brief**（無時鐘但有 turn 計數）
   - **偵測**：從 Step 0 開始計算 `dispatched_count`（已 spawn 幾次 Agent tool）。預算 = 8（6 role R1 + 1-2 AskUser）
   - **執行**：若 `dispatched_count > 12` 仍未產出 brief → Coordinator 強制停下所有 in-flight dispatch，產出 200 字 interim brief（現有 R1 內容的壓縮版 + 「deliberation 已超預算，建議停止或 offline 思考」結論）
   - **Rationale**：取代「30 分鐘」這個 skill 無法感知的時間概念，改用 deterministic turn 計數

5. **R2 hemlock rule — 針對 agent 而非用戶**
   - **偵測**：R2 enforcement scan 階段，若有 ≥1 agent 的 Round 2 response 出現以下任一：(a) 明顯重複 R1 的論述沒有新論點、(b) 轉為中立立場「both have merit」沒有提出具體 synthesis、(c) 迴避對 thesis/antithesis 的直接回應
   - **執行**：對該 agent 發 50 字 hemlock prompt：「你的 R2 response 退化為中性立場。用 50 字內 state your strongest position on this specific thesis/antithesis — no hedging, no 'both sides'. Just your committed claim.」
   - **和用戶無關**：原本設計是偵測「用戶反覆鬆動立場」但 skill 沒機制觀察用戶中間訊息。改為對 agent 執行，因為 agent 的 response 是 skill 能直接讀取的

### 4.3 八步執行序列（先做 4 個核心機制）

| # | Phase | 機制 | Phase 1 做？ |
|---|---|---|---|
| 0 | Parse Mode + Select Panel | - | ✅ |
| 1 | **Problem Restate Gate** | 6 role 各 50 字重述 + alternative framing | ✅ (核心 1) |
| 2 | Silent Pre-Check + AskUser #1 | Coordinator 沉默 4 題 checklist | ✅ |
| 3 | Round 1 — Independent Analysis（blind-first, parallel） | - | ✅ |
| 4 | Adaptive Depth Gate + Active Probe | Consensus assessment + 「哪個讓你最有反應」 | ✅ |
| 5 | Round 2 — Hegelian Cross-Examination | **Named Thesis/Antithesis** | ✅ (核心 2) |
|  |  | Forced Synthesis Proposal | 🔶 留 Phase 2 |
|  |  | Novelty Gate | 🔶 留 Phase 2 |
|  |  | Counterfactual Trigger @ >70% | 🔶 留 Phase 2 |
|  |  | **Dissent Quota ≥ 2 non-overlapping** | ✅ (核心 3) |
|  |  | Anti-Recursion rules | 🔶 留 Phase 2 |
| 6 | Coordinator Synthesis | Hegelian Arc identification | ✅ |
| 7 | Verdict 產出 | **Hegelian Arc Section** (T → A → S) | ✅ (核心 4) |
|  |  | Minority Report first-class | ✅ |
|  |  | Epistemic Diversity Scorecard | ✅ |
|  |  | Unresolved Questions | ✅ |

### 4.4 Advance Decision Brief 結構

```markdown
## Advance Decision Brief: {Title}

### The Question
{Confirmed problem statement after Restate Gate}

### Panel
{6 members: 4 職能 + 2 adversarial}

### Evidence Summary
{3-5 bullet points 從 Step 1 gathering}

### Hegelian Arc
**Thesis** (majority, R1): {2-3 sentences}
**Antithesis** (strongest dissent, R1): {2-3 sentences}
**Synthesis** (R2 coordinator-identified): {2-3 sentences — must transcend, not compromise}

### Convergence Points
{where all/most agree}

### Irreconcilable Tensions
{where disagreement cannot be resolved — be honest}

### Role Positions Table
| Role | R1 Position | R2 Shift | Final |
|------|-------------|----------|-------|

### Minority Report
{strongest reject voice preserved in full — not summarized}

### Unresolved Questions (Factual Gaps)
**定義**：panel 無法回答，因為需要 external evidence、數據、測試、或時間才能確認的問題
{e.g., "實際流量下這個 N+1 query 會慢多少？需要跑 benchmark 才知道"}

### Questions Only You Can Answer (Value/Preference/Context)
**定義**：panel **結構性不可能**回答的問題，因為答案取決於用戶自己的價值觀、偏好、或只有用戶有的 context
{e.g., "你願意為降低 30ms latency 接受多少技術債？這是你的 trade-off 偏好，不是分析問題"}

**兩者的差別**：Unresolved Questions 可以靠「再做點功課」解答；Questions Only You Can Answer 就算做一百次功課也不會有答案，必須由用戶定奪

### Recommended Next Steps
**（always present — 不論 CEO 或非 CEO 模式）**
{2-4 個具體可執行的下一步動作，ordered by priority}
{例：1. 決定 Path A 或 B 前，先花 30 分鐘回答「Questions Only You Can Answer」/ 2. 對 Unresolved Questions 跑 X benchmark / 3. 如果選 Path A，第一個 concrete action 是 Y}

### Epistemic Diversity Scorecard
- Perspective spread (1-5): {how orthogonal}
- Evidence mix: {% empirical / mechanistic / strategic / ethical / heuristic}
- Convergence risk: {Low/Medium/High with reason}
- **Trust ceiling**: {HIGH if all ≥3; MEDIUM otherwise; LOW if any ≤2}

### Confidence
{High / Medium / Low with reasoning + specific uncertainties}

### CEO Recommendation (ONLY when in CEO mode)
{Integrated action + preconditions + rollback triggers}
{This is a SUPER-SET of Recommended Next Steps, not a replacement}

### Related Skills
{e.g., "If this reveals a research gap → autopilot:survey"}

### Follow-Up
{Retrospective prompt: 實際決策後回來記錄效果}
```

---

## 5. 支援檔案 `skills/think-tank-dialectic/references/`

4 個 reference fragment，**Phase 1 只服務 dialectic 一個 consumer**，放在 skill 自己的 references 目錄下：

1. **problem-restate-gate.md** — 50 字重述 + alternative framing 的 prompt 模板 + divergence 偵測規則
2. **silent-pre-check.md** — Coordinator 沉默自檢的 4 題模板
3. **minority-report.md** — 強制保留反對論述的 section 模板
4. **epistemic-diversity-scorecard.md** — 自評 scorecard 的計算方式和 trust ceiling 規則

**promotion 規則**：當 **第二個** autopilot skill 明確需要相同 fragment 時，再 promote 到 `skills/_shared/`。在那之前屬於 YAGNI（見 review S1）。

（原本計畫放 `skills/_shared/` 的設計已撤回——單一 consumer 不值得抽象層）

---

## 6. Consumer Updates

### 6.1 skills/think-tank/SKILL.md

新增 `## Escalation to think-tank-dialectic` section：
- 觸發條件：R1 後 consensus = LOW，或不可逆決策 + 高張力
- 用戶看到 Decision Brief 結尾的提示可手動 escalate
- 現有 think-tank workflow **不變**（無 breaking change）

### 6.2 skills/think-tank/references/brief-template.md

Decision Brief footer 加：
```
### Escalation Recommendation
{若 consensus = LOW：建議 escalate to autopilot:think-tank-dialectic}
{若 consensus = HIGH/MEDIUM：維持現有決策，無需升級}
```

### 6.3 skills/ceo-agent/SKILL.md

Think Tank trigger rules section 加 dialectic boundary：
- `think-tank`: 中等決策、查看視角、有 tradeoff 但不複雜
- `think-tank-dialectic`: 不可逆決策、LOW consensus、兩邊都有道理的真實張力

具體編輯點：
- 行 62 的「CEO can autonomously invoke any skill」清單加 `autopilot:think-tank-dialectic`
- 行 64 的「Boundary with survey and think-tank」section 改名為「Boundary with survey, think-tank, and think-tank-dialectic」並加 dialectic row
- 行 74 的「CEO must invoke autopilot:think-tank when encountering any of these」表格下方加新表「CEO must escalate to autopilot:think-tank-dialectic when」

### 6.4 skills/survey/SKILL.md

**決策：不改實質 routing，只改註解釐清**。

行 7 現有文字：`"別人怎麼處理的". Not for: strategic priority decisions (→ think-tank)`

維持指向 `think-tank` 作為**單一入口**。理由：
1. 降低用戶認知負擔（dialectic 是 think-tank 內部的 escalation target，不是平行入口）
2. think-tank 的 brief 結尾有 LOW consensus → dialectic 的自動建議，用戶從 survey 走到 think-tank 後自然會看到升級路徑
3. 如果直接讓 survey 指向 dialectic，會繞過 consensus 評估這一關（dialectic 成本高，跳過評估是浪費）

**如果** survey 需要任何改動，只在 description 補一行註解：`(think-tank may escalate to think-tank-dialectic for LOW-consensus irreversible decisions)`。但這是選擇性的，不是必要修改。

### 6.5 hooks/session-start.sh

行 22 routing table 加一行：

```bash
| Irreversible decision, genuine stalemate, 不可逆決策, 兩邊都有道理, 辯證一下 | `autopilot:think-tank-dialectic` |
```

放在現有 `autopilot:think-tank` 行之後。這是 session start 時注入的 routing table，確保新 session 的 Claude 知道 dialectic 存在。

### 6.6 README.md + README.zh-TW.md

兩份 README 都要：
1. **Version badge URL**：hardcoded `version-2.1.1-` 改為 `version-2.2.0-`
2. **Skill count badge URL**：若有 `skills-11-` 之類的 URL 改為 `skills-12-`
3. **Skill count 在說明文字中**：搜尋「11 個 skill」或「11 skills」改為「12」
4. **Skill table**：在 think-tank 列之後加 think-tank-dialectic 列，保持字母排序或 group 邏輯

---

## 7. 實作 Phases

**Phase 1 實作**（本 session，總共 17 檔）：
- P1: 寫 spec doc（本文件，1 檔）
- P2: Self-review loop（code-reviewer agent 審查 + fix 本 spec doc）
- P3: 寫 7 個新檔（SKILL.md + references/role-prompts + references/brief-template + references/{problem-restate-gate, silent-pre-check, minority-report, epistemic-diversity-scorecard} = 7 檔）
- P4: 改 5 個 consumer（think-tank SKILL.md, think-tank brief-template, ceo-agent SKILL.md, survey SKILL.md, hooks/session-start.sh = 5 檔）
- P5: Version + CHANGELOG + README × 2 + plugin.json（4 檔）
- P6: 獨立 code-reviewer agent 審查整個 changeset + fix critical findings
- L-5: finish-flow（merge to develop、push、archive、learn、session end）

**總計：1 + 7 + 5 + 4 = 17 個檔案**（1 plan doc 已完成 Phase 1 P1）

**Phase 2 觸發條件**（非時間條件，以實戰數據決定）：

當以下**全部**為 true 時，trigger Phase 2 開發：
1. Phase 1 已在 **≥ 3 個真實高張力議題**上跑過（不含 smoke test）
2. 出現以下任一失效訊號：
   - (a) Dissent quota（≥2 非重疊反對）在 ≥ 1/3 的 session 無法達成，需人工催促
   - (b) R2 的 Synthesis 在 ≥ 1/2 的 session 淪為中性折中（「both have merit」），沒有真正 transcend
   - (c) 用戶 feedback 明確表示 brief 沒有改變他的決策（「跟我自己想的一樣」）
3. 且用戶仍有意願繼續投入 dialectic 這條路線（若放棄整個方向就歸零）

若訊號出現 → Phase 2 加入：
- Forced Synthesis（R2 禁止選邊）
- Novelty Gate（R2 必須有新論點）
- Counterfactual Trigger（>70% 自動 steelman）
- Anti-Recursion rules

若訊號**未**出現（4 個核心機制就夠用）→ 維持 Phase 1 狀態，不膨脹。

**Phase 3 未來擴展**（不承諾）：
- `think-tank-dialectic --duo` mode（2 人對打 3 輪）
- Tacit Knowledge Extraction 整合
- 跨 session 的 `dialectic-history.md` 追蹤（目前 re-entry guard 只管當前 session）

---

## 8. 風險與緩解

### 風險 1：用戶不知道何時該用哪個
**緩解**：
- 現有 think-tank brief 結尾永遠檢查 consensus level，LOW 時自動建議 escalate
- ceo-agent trigger rules 表格明確區分
- dialectic 的 description 明確講「不是 think-tank 升級版」

### 風險 2：dialectic 變成「大決策才用」但大決策很少，skill 長期沒被觸發
**評估**：這是 feature 不是 bug。Skill 存在成本極低（只是 md 檔案），不存在成本是「需要時沒有」。若 3 個月後發現真的沒用到，刪掉即可。

### 風險 3：Claude-only 環境中 polarity 弱化 + 對抗性 role character drift
**問題細分**：
- (a) Claude-only 無 model-level 差異，polarity 從「模型差異」退化為「prompt 差異」
- (b) 2 個對抗性 role 用 `general-purpose` subagent_type，比 voltagent 職能 role **少一層 system-prompt 錨定**，R2 容易漂移到中性

**緩解措施**（見 4.1 role composition 末尾）：
1. R2 重新注入完整 role prompt（不是只發 R1 outputs）
2. 每個對抗性 prompt 含 2-3 個具體 example moves
3. Anti-drift anchor sentence 每次 dispatch 都帶
4. Grounding Protocol rule 5（hemlock rule for agents）針對此問題設計

**殘留風險**：即使有以上緩解，對抗性 role 的效力仍可能在 R2 弱化。這是 Phase 2 Forced Synthesis 機制要解決的主要問題——若 Phase 1 發現 dissent quota 常達不到（見 section 7 Phase 2 觸發條件），就觸發 Phase 2 開發。

### 風險 4：Phase 1 只做 4 個機制可能不夠強，辯證仍然軟
**評估風險**：中等。4 個核心是最小可驗證集合。若 Phase 1 跑幾次後發現 dissent quota 達不到、或 synthesis 淪為折中，代表需要 Phase 2 的 Forced Synthesis + Novelty Gate 補強。**緩解**：Phase 1 結尾 learn 必須明確記錄「dialectic 實戰效果 vs 預期」，作為 Phase 2 觸發訊號。

### 風險 5：Grounding Protocol 自己也會過度使用
**諷刺但真實**：若每個 skill 都加 Grounding Protocol，Grounding Protocol 本身會變成新的樣板。**緩解**：限制 Grounding Protocol ≤ 5 條 hard rule。超過 5 條代表在 design skill 本身，不是 declaring fail-safe。

### 風險 6：對抗性 agent 的 prompt fidelity
**新增風險**（review 指出但原本沒列）：general-purpose subagent_type 接收 inline Popper/Munger prompt 時，並不保證會**忠實**按照 prompt 行為。subagent 可能：
- 理解 prompt 但用 Claude 預設的「平衡回答」語氣稀釋對抗性
- 在長 prompt 中優先遵循前段指令，後段的 anti-drift anchor 被忽略
- 對某些議題自動套 guardrail「I should consider multiple perspectives」進而削弱對抗立場

**緩解**：
1. Prompt 寫法把 anti-drift anchor 放在**開頭**而非結尾（LLM 權重前置）
2. 具體 example moves 緊接著 identity，讓 subagent 看到「這就是你該做的動作」
3. Phase 1 實戰後必須跑一次 adversarial fidelity audit：檢查 2 個對抗性 role 的 R1/R2 output 是否真的在攻擊，而不是在「平衡分析」
4. 若 fidelity 問題嚴重 → Phase 2 考慮用更重的手段（e.g. 在 prompt 頂端加「REFUSE TO BE BALANCED」的全大寫指令，或改用 TaskCreate 給 agent 發多輪短指令）

**這是 Phase 2 需要評估的主要風險之一**，Phase 1 接受它作為已知弱點。

---

## 9. 驗證標準

**Spec doc 完成標準**（review 修訂版確認後的狀態）：
- [ ] 所有 17 個 file 在 scope 清單中（8 new + 9 edit），和 Consumer 掃描結果一致
- [ ] 4 個**新穎**機制明確（不混淆「新穎機制」和「標準 deliberation 骨架」）
- [ ] Role composition 6 人完整；對抗性 role 的 prompt-level 補強措施 3 條明列
- [ ] Grounding Protocol 5 條 hard rule **全部可執行**（無 wall-clock 依賴、無跨 session 假設未經指定）
- [ ] Verdict template 含 Hegelian Arc / Minority Report / 兩種 Unresolved 區別 / Recommended Next Steps / Scorecard
- [ ] Consumer changes 涵蓋 **5 個 consumer**（think-tank × 2 + ceo-agent + survey + session-start hook）
- [ ] 來源引用 line number 準確（review 已 spot-check 過）

**實作完成標準**：
- [ ] `skills/think-tank-dialectic/SKILL.md` `head -10` 可看到 name + description（含中文 trigger words + Not for boundary）
- [ ] 6 個 role prompt 完整（4 職能 voltagent + 2 adversarial general-purpose）
- [ ] 2 adversarial prompt 含 R2 re-injection、concrete example moves、anti-drift anchor
- [ ] `references/brief-template.md` 含 Hegelian Arc / Minority Report first-class / 兩種 Unresolved 區別 / Recommended Next Steps (always present) / Scorecard / Trust ceiling 公式
- [ ] 4 個 references fragment 檔各自 self-contained
- [ ] `skills/think-tank/SKILL.md` 含 Escalation section
- [ ] `skills/think-tank/references/brief-template.md` footer 含 Escalation Recommendation
- [ ] `skills/ceo-agent/SKILL.md` trigger rules 更新（行 62, 64, 74, 83, 227 的 think-tank 引用都已處理）
- [ ] `skills/survey/SKILL.md` 維持指向 think-tank（單一入口）
- [ ] `hooks/session-start.sh` routing table 加一行 dialectic
- [ ] `.claude-plugin/plugin.json` version bumped 2.1.1 → 2.2.0
- [ ] `CHANGELOG.md` v2.2.0 entry 完整
- [ ] `README.md` + `README.zh-TW.md` skill count、skill table、version badge URL、skill count badge URL 全部更新
- [ ] 獨立 code-reviewer agent 審查 pass（Critical + Important 都 fixed 或明確降級到 follow-up）

**Dogfood 聲明**（修訂為誠實版本）：
- 本 plan doc **沒有**在自己身上跑 dialectic 協議（那會是 bootstrap 矛盾——protocol 還沒實作怎麼用？）
- Phase 1 實作完成後，第一個 real dialectic run 的議題應該是 retrospective 性質：**「think-tank-dialectic 的 4 個 Phase 1 核心機制夠用嗎？」**
- 那一次的 brief 才是真正 dogfood 素材，不是本 plan doc

---

## 10. 來源引用

所有機制都有明確出處：

| 機制 | 出處檔案 | 行號 |
|---|---|---|
| Problem Restate Gate | `agora/protocol/deliberation.md` | Step 2a 行 57-79 |
| Named Thesis/Antithesis | `agora/protocol/deliberation.md` | Step 5 行 233-240 |
| Dissent Quota | `council/SKILL.md` | Step 4 行 320-326 |
| Hegelian Arc | `agora/protocol/deliberation.md` | Step 6 行 289-299 |
| Minority Report | `council/SKILL.md` | Output Template 行 518-519 |
| Epistemic Diversity Scorecard | `council/SKILL.md` | 行 521-525 |
| Evidence Tiers | `agora/protocol/evidence-first.md` | 行 11-34 |
| Grounding Protocol pattern | all 31 agents | 每個 agent 的 Grounding Protocol section |
| Room-specific verdict structures | `agora/rooms/*/SKILL.md` | 各 room 的 Output Templates |
| Silent Pre-Check pattern | `agora/rooms/*/SKILL.md` | 各 room 的 "Before the AskUser, the Coordinator runs a silent X check" |
| Polarity pairs 設計 | all 31 agents | frontmatter `polarity_pairs` field |

---

**本 plan doc 版本**：1.0
**下一步**：Phase 2 self-review loop → Phase 3 實作
