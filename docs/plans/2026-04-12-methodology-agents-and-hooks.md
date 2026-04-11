# Methodology Agents + README Companionship 擴充計畫 (Ship A / v2.4.0)

**日期：** 2026-04-12
**狀態：** 🟢 Revised — review loop r2 完成
**來源：** 完整研究 `~/projects/my-claude-devteam/`（NYCU-Chung devteam plugin）後的機制吸收
**Size：** L
**Dogfood：** 本計畫使用 `autopilot:ceo-agent` level 3 + review loop + dev-flow L-size + finish-flow 驅動整個流程

---

## ⚠️ Ship Split Decision (Review r1)

**原設計把 3 agents + 14 hooks 塞進一個 L**，三個 reviewer 獨立指出這是兩個 ship。採納：

- **Ship A（本計畫，v2.4.0）**：3 methodology agents + skill integration + README companionship section
- **Ship B（後續計畫，v2.5.0）**：14 universal hooks + hooks README（等 Ship A 完成並 dogfood 後再啟動，另開新 plan doc `docs/plans/YYYY-MM-DD-universal-hooks.md`）

理由：
1. Ship A 可獨立 dogfood — agents 改動不碰 hooks，破壞面小
2. Ship B 的 hook 層 port 有 O(14) 檔案個別手動測試需求，單 L session 做不完
3. Ship A 先完成讓 Ship B 可以**使用** Ship A 的 reviewer agent 跑自己的 quality-pipeline（true dogfood chain）
4. 每 ship 獨立 revert 單純

**本 plan doc 只涵蓋 Ship A**。Ship B 在本計畫 finish-flow L-5.6 learn 後另開 plan，收 Ship A dogfood 中發現的痛點作為 Ship B 的 OKR 輸入。

---

## 1. 背景與動機

### 1.1 問題

目前 `autopilot` 的設計只在**方法論文字層**（12 個 lifecycle skill + 1 個 SessionStart priming hook）。這個組合解決了「Claude 該怎麼想」，但留下結構性破口：

**方法論沒有 executable 載體**：autopilot 的核心賣點（Three Red Lines 紀律：closure / fact-driven / exhaustiveness、evidence-first debug、PUA 壓力模式、六要素 Task Prompt）目前只存在於 skill markdown 裡。當 `quality-pipeline` 或 `ceo-agent` 要派 reviewer / debugger 出去跑時，只能 fallback 到 `superpowers:code-reviewer` 或 `voltagent-*` — 這些第三方 agent **沒有 autopilot 的方法論紀律**。用戶實際拿到的 review 會隨底層 model 和 voltagent 版本飄，賣點傳遞不穩定。

（**Hook 層硬 enforcement 問題確實存在但移到 Ship B**，理由見 Ship Split Decision 段。）

### 1.2 來源研究

完整研究 [`NYCU-Chung/my-claude-devteam`](https://github.com/NYCU-Chung/my-claude-devteam)（12 agents + 15 hooks + P7/P9/P10 + 三條紅線 methodology，v1.1.0，MIT license）。這是業界唯一把「方法論紀律 + 強制 hook enforcement + role agent 分工」三者合一的 Claude Code plugin。完整解析見 session context。

識別出三個關鍵設計洞察：

1. **方法論必須有 executable 載體**：devteam 把三條紅線寫進每個 agent 的 system prompt，用固定 output contract（`[P7-COMPLETION]` / `[REFACTOR-COMPLETE]` 等）讓 handoff 結構化
2. **Hook 層是紀律最便宜的 enforcement**（→ Ship B 處理）
3. **Role agent 層應該外包給 voltagent**，autopilot 只守方法論層。autopilot 有 voltagent（80+ role agents）+ 12 lifecycle skills 作為既有基礎設施，最低成本的擴充是**只自建 methodology-flavored agents**（語言無關、棧無關、承載 autopilot 獨有的紀律軸）

### 1.3 本計畫（Ship A）的決策

建立 **Methodology Agents 層**：自建 3 個 agent，承載 Three Red Lines + evidence-first + 六要素 Task Prompt 的 executable 紀律，並在 README 明確寫 voltagent 為推薦搭配（role-specialized 領域），寫清楚三層分工避免用戶混淆。

### 1.4 為什麼不全吃 voltagent 寫 README 搭配服用

三個死因：

1. **voltagent 沒有方法論 agent 角色**。voltagent 的 `code-reviewer` / `qa-expert` / `architect-reviewer` 是通用職能 role，沒有任何一個強制 Three Red Lines。autopilot 的賣點必須有 agent 層載體，才能在 `quality-pipeline` / `ceo-agent` 派出去時把紀律一起帶出去

2. **autopilot 必須單獨可跑**。若 autopilot skill 硬寫「dispatch to `voltagent-qa-sec:code-reviewer`」，沒裝 voltagent 的用戶整個 skill 壞掉，等於變成 voltagent 的衛星產品

3. **自建 agent 的邊際成本比想像低**。autopilot 已經在維護 12 個 skill markdown + hooks.json 發佈 pipeline，新增 3 個 `agents/*.md` 不是 2 倍成本，是 +20% — 而獲得的是執行力（agent fresh window 零污染）

### 1.5 為什麼不建 role agent

明確留給 voltagent：

- **voltagent 已有對應 role**：frontend-developer / legacy-modernizer / refactoring-specialist / database-administrator / postgres-pro 等
- **role agent 的價值 = 領域知識**：autopilot 作為 plugin 無法維護跨語言/跨棧的領域最佳實務
- **維持 autopilot 聚焦**：autopilot = lifecycle & methodology，越聚焦越難被取代

### 1.6 分工邊界聲明（per review r1 M1）

**autopilot methodology agents 和 voltagent role agents 實際會同名空間存在。**

- `autopilot:reviewer` ↔ `voltagent-qa-sec:code-reviewer`：兩者都能做 code review，invocation surface 相似
- `autopilot:debugger` ↔ `voltagent-qa-sec:debugger`：兩者都能做 debug
- `autopilot:planner` ↔ 無直接對應：voltagent 沒有 general planner

**明確分工原則**（寫進 agents/README.md + 本計畫 §4.4 的 Recommended Companions 段）：

> **autopilot agents are dispatched _by autopilot skills_ to carry the plugin's methodology discipline (Three Red Lines, evidence-first, six-element Task Prompts). When users reach for a reviewer / debugger directly — without going through an autopilot skill — voltagent role agents are the recommended primary choice because they have broader domain coverage.**

用戶操作層的選擇：
- 走 `autopilot:quality-pipeline` / `autopilot:dev-flow` / `autopilot:ceo-agent` → autopilot agents 自動被 dispatch，帶紀律
- 直接呼叫 `Agent(subagent_type="code-reviewer", ...)` → 用戶的選擇，通常 voltagent 版本覆蓋更廣

兩者**不是競爭關係**，是同一個工作的兩個呼叫入口：skill 層（autopilot 管）vs tool 層（user 管）。

---

## 2. OKR

### 2.1 成功條件

1. **方法論 agent executable 載體**：autopilot 新增 3 個 methodology agent（reviewer / debugger / planner），每個 agent 系統提示內嵌 Three Red Lines，有固定 output contract
2. **Skill 層整合**：`autopilot:quality-pipeline` 的 `references/code-review.md:72` 的 `subagent_type` 從 `"superpowers:code-reviewer"` 改為 `"autopilot:reviewer"`。這是**靜態 dispatch target 變更**（skill 的 external contract「跑 quality gate」不變，但內部 dispatch 對象變了）。無 runtime fallback 機制 — 若 autopilot:reviewer 不存在 dispatch 會失敗，但因為它是本 plugin 所 ship，plugin 安裝即存在。未安裝 `superpowers` 的用戶也能跑 quality-pipeline
3. **README 分層清楚**：新增 `Recommended Companions` 章節，明確寫 voltagent 為 role 層搭配、寫明分工邊界（§1.6）、autopilot 單獨可跑
4. **零 breaking change**：現有 12 skill / ceo-agent / dev-flow API 完全不變。用戶升級後所有舊行為正常
5. **版本 bump**：新 feature = minor bump `2.3.0 → 2.4.0`，所有 version 引用點 grep 同步
6. **完整 dogfood**：本計畫使用 ceo-agent level 3 + review loop + dev-flow L-size 驅動整個流程，驗證新 agent 的可用性；Phase 0 review loop 使用現有 agent（superpowers/voltagent），Phase 5 validation 才使用新建的 autopilot:reviewer

### 2.2 非目標（Out of Scope）

**Ship A 聚焦 3 個 methodology agent + skill integration**，其他明確延後：

- 🔶 **Ship B 延後**：14 個 universal hooks（large-file-warner / suggest-compact / cost-tracker / audit-log / session-summary / log-error / commit-secret-scan / branch-protection + 6 opt-in）
- 🔶 **Phase 2 延後觀察**：`autopilot:researcher`（survey 內部 extract，見 §2.3 已知缺口）、`autopilot:onboarder`（next 觸發時用）

**明確排除**：

- **不**自建 role agent（fullstack / frontend / migration / db / refactor）— 留給 voltagent
- **不**改現有 12 skill 的 API — 只做新增 + 文字擴充（`skills/quality-pipeline/**` 為本計畫唯一要改的 skill，且只改 prose 不改 API）
- **不**強制用戶安裝 voltagent — README 寫「推薦搭配」不是「必要依賴」
- **不**把 TWGameProject-specific 內容放進 autopilot — 留在 `server/.claude/`

### 2.3 已知方法論缺口（per review r1 S1）

目前 `skills/survey/SKILL.md` 的 dual-agent 機制（researcher + skeptic）使用 `subagent_type: "general-purpose"`，**沒有繼承 Three Red Lines 紀律**。嚴格講這和本計畫 §1.1 的主張（「方法論必須有 executable 載體」）衝突。

**決策**：本缺口在 Ship A 期間**明確接受**不修。理由：
- Ship A 聚焦 quality-pipeline 這個最大 consumer 的紀律化
- survey 使用頻率遠低於 quality-pipeline
- Phase 2（Ship B 之後）建立 `autopilot:researcher` 時一併處理

**處理方式**：在 §4.1.4 加註為 known gap，finish-flow L-5.6 learn 時記錄為 follow-up 輸入。

---

## 3. L-1.5 Scope Completeness Audit（per v2.1.1 mandate）

走 10 dimensions 確認 scope 涵蓋完整：

| Dimension | 狀態 | 產出位置 |
|---|---|---|
| **source** | ✅ 在 scope | `agents/*.md` ×3 + `skills/quality-pipeline/**` prose 更新 |
| **tests** | ❌ 不在 scope | agents 是 prose，autopilot 無 unit test 慣例；本計畫靠 dogfood 驗證 |
| **docs** | ✅ 在 scope | `docs/plans/2026-04-12-methodology-agents-and-hooks.md`（本文件）+ `agents/README.md` 說明分工 |
| **API** | ❌ 不在 scope | skills 不公開 API；agent 契約透過 output format 隱含保證 |
| **templates** | ❌ 不在 scope | `project-config-template/` 無須新增（agents 不需 per-project override） |
| **CHANGELOG** | ✅ 在 scope | `CHANGELOG.md` v2.4.0 entry |
| **version** | ✅ 在 scope | `.claude-plugin/plugin.json` 2.3.0 → 2.4.0（新 feature = minor bump），marketplace.json 同步，兩份 README version badge 同步。**MANDATORY**：`grep -rn "2.3.0" . \| grep -v CHANGELOG` 回空（per review r1 mi5）|
| **migration** | ❌ 不在 scope | 零 breaking change，現有用戶升級無須任何動作 |
| **consumers** | ✅ 在 scope | 透過 `grep -rn "code-reviewer\|superpowers:code-reviewer" skills/` 掃描 autopilot 內部對 reviewer agent 的引用點（見下方） |
| **credit / attribution** | ✅ 在 scope | README `Inspired By` 新增 devteam entry（按 v2.2.1 mandate） |
| **dogfood** | ✅ 在 scope | 本計畫自己走 ceo-agent level 3 + review loop + dev-flow L-size + quality-pipeline + finish-flow 全套流程。**Phase 0 review loop 使用 existing agents**（superpowers/voltagent）— autopilot:reviewer 不存在；Phase 5 才 dogfood 新建的 reviewer |

### Consumer 完整掃描結果

執行 `grep -rn "code-reviewer\|superpowers:code-reviewer" skills/` 後，Ship A 要改的整合點：

| 檔案 | 改什麼 |
|---|---|
| `skills/quality-pipeline/SKILL.md` | L55 的 `via superpowers:code-reviewer subagent` 註解改為「via autopilot:reviewer — see references/code-review.md for full dispatch logic」|
| `skills/quality-pipeline/references/code-review.md` | 當前指向 `superpowers:code-reviewer`，改為 prose 指示 Claude：「優先 `autopilot:reviewer`（本 plugin 方法論 agent）；若用戶明確要求用 `superpowers:code-reviewer`（例：比對不同紀律），才 dispatch superpowers 版本」 |
| `README.md` + `README.zh-TW.md` | 新增 `Methodology Agents` 段 + `Recommended Companions` 段（voltagent 分工）+ `Inspired By` 加 devteam entry |
| `.claude-plugin/plugin.json` | version + description + agent count |
| `.claude-plugin/marketplace.json` | version + description 同步 |
| `CHANGELOG.md` | 新增 v2.4.0 entry |

**不改的地方（明確決策）**：
- `hooks/session-start.sh` — agent 不走 trigger 表（trigger 是給 skill 用的）
- `skills/dev-flow/**` — dev-flow 目前不直接 dispatch reviewer，透過 quality-pipeline 間接使用
- `skills/ceo-agent/SKILL.md` — 同上，透過 quality-pipeline 間接使用
- `skills/survey/**` — 已知缺口，延到 Phase 2（§2.3）

### 檔案總清單

**新增 (6)**：
1. `docs/plans/2026-04-12-methodology-agents-and-hooks.md`（本文件，已存在）
2. `agents/README.md`（3 agent 分工說明 + 和 voltagent 邊界）
3. `agents/reviewer.md`
4. `agents/debugger.md`
5. `agents/planner.md`
6. （Phase 2 延後：`agents/researcher.md`、`agents/onboarder.md`）

**修改 (7)**：
7. `skills/quality-pipeline/SKILL.md`
8. `skills/quality-pipeline/references/code-review.md`
9. `README.md`
10. `README.zh-TW.md`
11. `.claude-plugin/plugin.json`
12. `.claude-plugin/marketplace.json`
13. `CHANGELOG.md`

**總計：6 新增 + 7 修改 = 13 檔案**（per review r1 mi4 修正 — 比原 30 檔明顯減半，符合單 L）

---

## 4. 核心設計

### 4.1 Methodology Agents（3 個 Phase 1，1 個已知缺口）

全部**語言/棧無關**、承載 autopilot 方法論紀律、有統一 output contract（per review r1 mi9）。

#### 4.1.1 統一 Output Contract 骨架（per review r1 mi9 + r2 A4/O1/O3/O4）

所有 3 個 agent 的 output 必須符合：

```
## <Agent> Report
<body 段落按該 agent 特定格式>
...
### Handoff
Next consumer: <ENUM>
Routing rationale: <一句話說明為何選這個 enum；trivial 時可省略>
Remaining risks: <list 或 "none">
```

**Next consumer 允許的 enum 值**（固定集合，不接受 free-text）：

| Enum | 意義 |
|------|------|
| `MAIN_CLAUDE` | 主 Claude 執行（S-size fix、簡單 patch、trivial change） |
| `AUTOPILOT_DEBUGGER` | 需派 autopilot:debugger 做 root cause 分析 |
| `AUTOPILOT_PLANNER` | 需派 autopilot:planner 做結構化拆解 |
| `NEEDS_DOMAIN_EXPERT` | 需要語言/棧 domain 知識 — 由呼叫 skill 決定對應 voltagent role（agent 不自己猜 voltagent 名字） |
| `PARALLEL_DISPATCH` | 多個獨立子任務可並行 — 由呼叫 skill 決定用 superpowers:dispatching-parallel-agents 或其他 dispatcher |
| `SEQUENTIAL_DISPATCH` | 多個子任務有 blockedBy 相依 — 同上，dispatcher 由 skill 決定 |
| `DOCUMENT_ONLY` | 只作為紀錄/警示，無需後續動作（適用 🟡 Minor / 🔵 Suggestion） |

**為什麼用 enum 而非 free-text**：
- 呼叫 skill 的 prose 能 pattern-match 單一 enum string，不需解讀自由文字
- Agent 不需知道 voltagent catalog — 只說「需要 domain expert」，由 skill 層映射
- Agent 不依賴 superpowers plugin 存在 — `PARALLEL_DISPATCH` 不硬 code `superpowers:dispatching-parallel-agents`，符合 §1.4 autopilot 必須單獨可跑

**Degenerate form**（trivial 情境允許精簡）：

```
### Handoff
Next consumer: MAIN_CLAUDE
Remaining risks: none
```

（省略 `Routing rationale:` 當沒有歧義時）

**Agent-to-agent dispatching is still forbidden**（見 §4.2）：Handoff 的 enum 只是**告訴呼叫 skill** 下一步該派誰，不是 agent 自己去派。`AUTOPILOT_DEBUGGER` 代表「請 quality-pipeline / dev-flow / ceo-agent 讀到這個 Handoff 後決定是否 re-dispatch debugger」，不是 reviewer 自己 dispatch debugger。

`### Handoff` 段是**所有 autopilot methodology agents 共同的最後一段**，統一 handoff 協議解決 review r1 M2（reviewer→fixer handoff gap）和 M3（orchestration protocol）。

#### 4.1.2 `autopilot:reviewer`（Phase 1）

**檔案**：`agents/reviewer.md`

```yaml
---
name: reviewer
description: "Methodology-disciplined code reviewer applying autopilot's Three Red Lines (closure / fact-driven / exhaustiveness). Every finding cites file:line. Default-assumes everything is broken until verified. Used primarily via autopilot:quality-pipeline."
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch
model: opus
---
```

**注意**（per r2 A8）：`description` 欄位**不自我貶抑**地講「voltagent 更好」— 那會讓 Claude 自動選擇時繞過 autopilot:reviewer 即使從 autopilot skill 進來。關於「用戶直接呼叫時推薦 voltagent」的 guidance 寫在 `agents/README.md`（對人讀者），不寫進 agent 自己的 description（避免 Claude 在 dispatch 選擇時受干擾）。

**核心紀律**（寫進 system prompt）：

- **Three Red Lines**：
  1. Closure — 每個 finding 必須附 impact + fix direction
  2. Fact-driven — 每個 finding 必須 `path:line` cite；禁「probably」/「likely」/「I think」
  3. Exhaustiveness — 固定 review checklist 不能跳；乾淨項目明確標 `✅ Verified Clean`
- **Severity tiering**：🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
- **Output contract**（使用 §4.1.1 統一骨架）：

  ```
  ## Reviewer Report
  ### 🔴 Critical
  - `path/to/file.ts:42` — 描述 → 後果 → 修正方向
  ### 🟠 Major / 🟡 Minor / 🔵 Suggestion
  ### ✅ Verified Clean
  - Reviewed <area> — <observation>
  ### Summary
  Overall risk: Low/Med/High
  Top 3 priorities: 1. ... 2. ... 3. ...
  ### Handoff
  Next consumer: <MAIN_CLAUDE | AUTOPILOT_DEBUGGER | NEEDS_DOMAIN_EXPERT | DOCUMENT_ONLY>
  Routing rationale: <一句話；例「🔴 auth bypass，需 domain expert 檢視 JWT 實作」>
  Remaining risks: <list or none>
  ```

  **Severity → Enum 建議映射**（agent 自己判斷，rationale 欄位說明）：
  - 🔴 Critical root cause 不明 → `AUTOPILOT_DEBUGGER`
  - 🔴 Critical 語言/棧特化問題 → `NEEDS_DOMAIN_EXPERT`
  - 🔴/🟠 明確 fix → `MAIN_CLAUDE`
  - 🟡/🔵 → `DOCUMENT_ONLY`

- **Red Lines**（禁令）：
  - 不准 clear 沒實際讀過的 code
  - 不准用「大家都這樣寫」豁免漏洞
  - 不准因為「大概不會觸發」降級嚴重度
  - Hardcoded credentials 永遠 🔴 Critical 無例外
  - 如果一個問題都沒找到也要明確寫「reviewed X files, Y lines, no issues found in [categories]」而不是「looks good」
  - **WebSearch 結果不可作為 finding 的 `path:line` 來源**（per review r1 S2）— 只有 codebase 是 fact-driven 的 source of truth；WebSearch 只用於確認 library API 行為，發現不可直接 cite 為 finding
  - **不修 code**（tools 無 Edit/Write，物理禁止）— 發現交 `### Handoff` 指派 next consumer

**和 `superpowers:code-reviewer` / `voltagent-qa-sec:code-reviewer` 的差異**：
- autopilot:reviewer 強制 Three Red Lines + fixed output contract + ✅ Verified Clean 段 + Handoff 段
- superpowers:code-reviewer：彈性更大但紀律較弱，autopilot skill 明確不走 runtime fallback 而是 prose instruction（per review r1 C2）
- voltagent-qa-sec:code-reviewer：domain 覆蓋廣（語言特化），用戶直接呼叫場景推薦

**誰什麼時候用哪個**（寫進 `agents/README.md`）：
- 走 autopilot skill（quality-pipeline / ceo-agent）→ 自動 autopilot:reviewer
- 用戶直接呼叫 reviewer → 推薦 voltagent-qa-sec:code-reviewer
- 想對比兩種紀律體系 → 用戶可明確指定

#### 4.1.3 `autopilot:debugger`（Phase 1）

**檔案**：`agents/debugger.md`

```yaml
---
name: debugger
description: "Evidence-first root-cause analyst. Reads logs / stack traces / actual code before forming hypotheses. 5-phase methodology: gather → narrow → hypothesize → verify → propose-fix. Triggers PUA mode on 2+ failures. Read-only diagnostic — does not patch code, hands off fix to main Claude / voltagent role agent. Language-agnostic."
tools: Read, Glob, Grep, Bash, WebSearch, WebFetch
model: opus
---
```

**重要變更（per review r1 C3）**：**移除 Edit/Write**。debugger 是純 diagnostic agent — 輸出 fix 提案（diff 形式），實際 patch 由 main Claude 或 voltagent role agent 執行。這讓 3 個 methodology agents 全部 read-only，方法論 vs role 分離完整。

**核心紀律**：

- **Evidence-first hard rule**：沒 log / stack trace / 實際 code 內容禁止提 hypothesis
- **5-phase methodology**：
  1. **Gather** — 完整 error message + trigger conditions + frequency + recent changes
  2. **Narrow** — bisect to module/function/line
  3. **Hypothesize** — 至少 2-3 個 plausible root cause（只想出 1 個就還沒思考夠）
  4. **Verify** — 最小可能改動測試 hypothesis，不要 fix + test 同時
  5. **Propose-fix** — 產出 minimal diff 提案，handoff 給 next consumer（不自己 patch）
- **PUA trigger**：同一任務失敗 2+ 次 → 強制寫 3 個全新 hypothesis 逐一驗證
- **Output contract**（使用 §4.1.1 統一骨架）：

  ```
  ## Debugger Report
  ### Problem
  <one-paragraph 描述 + 重現方式>
  ### Investigation
  1. Checked <src/log/test> — 發現 <observation>
  2. Hypothesis A: ... → Verified: ruled out / confirmed, 證據: ...
  3. Hypothesis B: ... → Verified: confirmed, 證據: ...
  ### Root Cause
  <path:line + 技術解釋>
  ### Proposed Fix
  <minimal diff or patch description — NOT applied>
  ### Verification Plan
  - Reproduced original bug via: <how>
  - Expected behavior after fix: <what>
  - Regression check targets: <what consumer should re-run after patching>
  ### Handoff
  Next consumer: <MAIN_CLAUDE | NEEDS_DOMAIN_EXPERT>
  Routing rationale: <一句話；例「修正需跨 N 個檔案的 rename，建議派 refactor 專家」>
  Remaining risks: <list or none>
  ```

  **Debugger 不列舉 voltagent role 名字**（per r2 O3）— debugger 沒有 voltagent catalog awareness，只說「需要 domain expert」，由呼叫 skill（quality-pipeline / ceo-agent / dev-flow）依 rationale 決定派哪個 voltagent role（cpp-pro / postgres-pro / refactoring-specialist 等）。

- **Red Lines**：
  - 不准「試試重啟看看」當 transient issue 處理
  - 不准修 symptom（例：看到 connection refused 加 retry loop 而不查為什麼被拒）
  - 不准沒重現 bug 就 close
  - 不准「憑記憶」知道錯誤訊息意思 — WebSearch 先
  - **不直接 patch code**（tools 無 Edit/Write，物理禁止）— 只產 Proposed Fix + Handoff

#### 4.1.4 `autopilot:planner`（Phase 1）

**檔案**：`agents/planner.md`

```yaml
---
name: planner
description: "Six-element Task Prompt planner. Breaks fuzzy requirements into parallelizable subtasks. Each subtask has goal/scope/input/output/acceptance/boundaries contract. Cannot directly edit files (Read-only tools). Used by autopilot:dev-flow on L-size work."
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch
model: sonnet
---
```

**變更（per review r1 mi10）**：model 從 opus 改為 **sonnet**。理由：planner 是 schema-driven 的結構性分解，不是深度推理，sonnet 足夠；cost 降 5x。若 dogfood 發現 plan 品質不夠再改回 opus。

**核心紀律**：

- **物理限制不能寫檔**：tools 只給 Read 類 — 違反 = Claude Code 攔下（per review r1 mi3 — 改為「cannot directly edit files」而非「cannot write code」因為 agent 技術上仍可 emit code-in-markdown；實際邊界是 filesystem write，不是概念上的「不准想程式」）
- **六要素強制 contract**：每個 Task Prompt 必須包含：
  1. **Goal** — 一句話
  2. **Scope** — 精確檔案路徑
  3. **Input** — 上游依賴（schema / API spec / prior task 產物）
  4. **Output** — 交付物（檔案清單、新 API、測試）
  5. **Acceptance** — 完成條件（測試通過、行為觀察）
  6. **Boundaries** — 明確不能碰什麼
- **必先讀實際 code**：Task Prompt 產出前強制用 Glob+Read 看現有架構，禁「憑記憶」
- **Parallel/Sequential 標記**：每組 task 必須標 parallel 可並行 vs sequential blockedBy
- **Output contract**（使用 §4.1.1 統一骨架）：

  ```
  ## Planner Report
  ### Definition of Done
  <one-sentence>
  ### Current State Analysis
  - Relevant files: <list with path:line>
  - Existing implementation: <summary>
  - Blast radius: <modules affected>
  ### Risks
  | Risk | Likelihood | Impact | Mitigation |
  |------|-----------|--------|-----------|
  | ... | H/M/L | H/M/L | ... |
  ### Task Breakdown
  #### Task 1: <title> — dispatch to <agent>
  - Goal / Scope / Input / Output / Acceptance / Boundaries
  #### Task 2: ...
  ### Execution Order
  - Parallel: Tasks 1, 2, 3
  - Sequential: Task 4 blockedBy [1, 2]
  - Critical path: 1 → 4 → 5
  ### Rollback Plan
  <concrete rollback for each phase>
  ### Handoff
  Next consumer: <PARALLEL_DISPATCH | SEQUENTIAL_DISPATCH | MAIN_CLAUDE>
  Routing rationale: <一句話；例「4 個子任務獨立無依賴，適合並行」>
  Remaining risks: <list or none>
  ```

  **Planner 不硬 code `superpowers:dispatching-parallel-agents`**（per r2 O4）— 呼叫 skill（通常是 dev-flow）依 enum 決定實際 dispatcher，避免和 superpowers plugin 形成硬相依，符合 §1.4 autopilot 單獨可跑原則。

- **Red Lines**：
  - 不准把「六要素」縮水（每個 element 必填）
  - 不准 plan 沒讀過的 code
  - 不准忽略 risk 因為「可能不會發生」— 必須 mitigate 或顯式標「accept」
  - 不准 dispatch 不完整的 Task Prompt（六要素漏任一 = 違規）

#### 4.1.5 Phase 2 延後項（明確記錄為 follow-up）

- **`autopilot:researcher`**：目前 `survey` skill 用 general-purpose，無 Three Red Lines — 已知缺口（§2.3）。等 Ship A dogfood 後觀察痛點強度再決定是否建
- **`autopilot:onboarder`**：`next` 遇陌生專案時用，痛點不明顯，延後觀察

### 4.2 Orchestration Protocol（per review r1 M3 + r2 O2）

**Methodology agents do not call each other.** Orchestration stays at the skill layer (dev-flow / ceo-agent / quality-pipeline / finish-flow)。

| Consumer skill | 何時派遣哪些 agent | Handoff 讀取機制 |
|---|---|---|
| `quality-pipeline` | 每次 L-size 收尾派 `autopilot:reviewer` | 讀 reviewer 的 `### Handoff` → 依 enum 分派：`MAIN_CLAUDE` → 交 main Claude; `AUTOPILOT_DEBUGGER` → re-dispatch debugger (round-trip); `NEEDS_DOMAIN_EXPERT` → quality-pipeline 依 rationale 選 voltagent role; `DOCUMENT_ONLY` → 記錄不動作 |
| `dev-flow` L-1 | 偵測 L-size 時可選派 `autopilot:planner` 產 Task Breakdown | 讀 planner 的 `### Handoff` → `PARALLEL_DISPATCH` 用 dispatching-parallel-agents; `SEQUENTIAL_DISPATCH` 用 TaskCreate 鏈式 blockedBy |
| `ceo-agent` | 遇 bug 時可派 `autopilot:debugger` | 讀 debugger 的 `### Handoff` + Proposed Fix → 依 enum 派 main Claude 或 voltagent role |

**Round-trip re-dispatch**（per r2 O2）：當 reviewer Handoff 指派 `AUTOPILOT_DEBUGGER`（例：🔴 finding root cause 不明），呼叫 skill（quality-pipeline）有責任 re-dispatch debugger 作為獨立 agent session — 不是 reviewer 自己呼叫。這個 round-trip 必須記錄在 skill 的 log / output 中。

**禁止**：任何 methodology agent 在自己的 session 內 dispatch 另一個 agent。所有 chaining 回到 skill 層。

### 4.3 README `Recommended Companions` 章節

新增章節說明 autopilot 的**分層哲學**和 voltagent 的定位：

```markdown
## Recommended Companions

Autopilot is **self-sufficient for methodology and lifecycle** — install autopilot
alone and you get all 12 skills + 3 methodology agents. For **role-specialized
work** (language experts, DB admins, Kubernetes specialists, frontend designers),
we recommend installing voltagent alongside:

    /plugin install voltagent@...

Autopilot and voltagent are **orthogonal by design, with clean dispatch boundaries**:

| Layer | What it does | Where to look |
|-------|-------------|---------------|
| **Methodology** | Three Red Lines discipline, evidence-first debugging, six-element Task Prompts, lifecycle orchestration | autopilot (this plugin) |
| **Role** | Language experts, infra specialists, domain experts (80+ agents) | voltagent |
| **Project** | Your tech stack's pitfalls, team conventions, domain-specific agents | `<project>/.claude/agents/` |

**Dispatch boundary**:

- When you go through an **autopilot skill** (`quality-pipeline`, `dev-flow`,
  `ceo-agent`), it auto-dispatches `autopilot:reviewer` / `:debugger` / `:planner`
  to carry methodology discipline.
- When you **directly invoke an agent** via the Agent tool, `voltagent:*` role
  agents are recommended because they have broader domain coverage.

Autopilot's 3 methodology agents (`reviewer`, `debugger`, `planner`) are
**language/stack agnostic** and focus on *how* to think. For *domain expertise*
(e.g., PostgreSQL query optimization, Rust memory safety, Kubernetes manifest
review), dispatch to voltagent's role agents directly.

**autopilot does not runtime-detect voltagent**: skill prose names autopilot
agents as primary. If you want a different reviewer for a specific task, invoke
it explicitly via the Agent tool — that's a user-layer choice, not a graceful
degradation mechanism.
```

### 4.4 架構圖

```
┌──────────────────────────────────────────────────────────────┐
│                    autopilot v2.4.0 (Ship A)                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  12 Lifecycle Skills (existing, unchanged API)               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ dev-flow / survey / think-tank / think-tank-dialectic │  │
│  │ ceo-agent / quality-pipeline / finish-flow /          │  │
│  │ project-lifecycle / learn / retro / next / audit      │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                 │
│                  dispatches via skill layer                   │
│                            ▼                                  │
│  3 Methodology Agents (NEW — Ship A)                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  autopilot:reviewer   (Three Red Lines, read-only)    │  │
│  │  autopilot:debugger   (Evidence-first, read-only)     │  │
│  │  autopilot:planner    (Six-element, read-only)        │  │
│  │                                                        │  │
│  │  All emit ### Handoff naming next consumer.           │  │
│  │  Do NOT call each other — skills orchestrate.         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  [Ship B — deferred: 14 universal hooks]                     │
└──────────────────────────────────────────────────────────────┘
           ▲                                   ▲
           │ orthogonal                        │ project-specific
           │                                   │
┌──────────┴──────────┐            ┌───────────┴───────────┐
│     voltagent        │            │ <project>/.claude/    │
│  80+ role agents     │            │  agents/ + hooks/     │
│  (domain expertise)  │            │                       │
└──────────────────────┘            └───────────────────────┘
```

---

## 5. Phase Plan

### Phase 0 — 計畫審查（本階段，由 ceo-agent 主導）

1. 寫完本 plan doc（✅ r0 → 🟢 r1 with review fixes）
2. 派 ≥2 個 **existing** reviewer agent（superpowers / voltagent）並行 review — **autopilot:reviewer 不存在**（per review r1 mi7，Phase 0 不可自舉）
3. 迭代 review feedback 至 clean
4. 轉交 dev-flow L-size 執行

### Phase 1 — Methodology Agents 建立（parallel）

**Subtasks**（3 個 agent 可用 `superpowers:dispatching-parallel-agents` 同時寫）：

- **P1.1**: 寫 `agents/reviewer.md`（完整 frontmatter + Three Red Lines + Output contract with Handoff section + Red Lines）
- **P1.2**: 寫 `agents/debugger.md`（5-phase + PUA trigger + Propose-fix-not-patch + Handoff）
- **P1.3**: 寫 `agents/planner.md`（六要素 + read-only + Handoff + sonnet model）
- **P1.4**: 寫 `agents/README.md`（3 個 agent 的用途說明 + 和 skill 層的關係 + 和 voltagent 的分工邊界 per §1.6）

**驗收**：
- 每個 agent markdown 有完整 frontmatter、system prompt、統一 output contract（§4.1.1 骨架 + `### Handoff`）、red lines、bad/good examples 各一
- 3 個 agent 都是 read-only（tools 不含 Edit/Write）
- agents/README.md 明確寫「methodology agents dispatched by autopilot skills; direct user invocation prefers voltagent」

### Phase 2 — Skill 層整合

**Subtasks**（sequential，依賴 Phase 1）：

- **P2.1**: 修改 `skills/quality-pipeline/references/code-review.md` — 當前指向 `superpowers:code-reviewer`，改為 prose instruction：「優先 `autopilot:reviewer`（本 plugin 方法論 agent）；若用戶明確要求 `superpowers:code-reviewer`，才 dispatch superpowers 版本」— **prose 層指示，非 runtime fallback**（per review r1 C2）
- **P2.2**: 修改 `skills/quality-pipeline/SKILL.md` 的 reviewer 註解同步更新
- **P2.3**: Grep `skills/` 其他引用 `superpowers:code-reviewer` 的地方（`grep -rn "superpowers:code-reviewer" skills/`），視情況更新（預期只有 quality-pipeline；掃描是確認不是假設）

**驗收**：
- `grep -rn "superpowers:code-reviewer" skills/` 結果只剩明確「作為替代選項」的引用點，預設路徑指向 `autopilot:reviewer`
- quality-pipeline 的 prose 清楚說明 user 可以明確覆寫 reviewer 選擇

### Phase 3 — Namespace & API Verification（per review r1 S3 + r2 A5 time-box）

**Time-box: 30 分鐘**（per r2 A5，避免成為 rabbit hole）

**Subtasks**（按順序執行，逐 step 判斷是否 early exit）：

- **P3.1**: Plugin install 後執行 `Agent(subagent_type="reviewer", prompt="test")` — 觀察是否成功、agent 如何被 addressed
- **P3.2**: 若 P3.1 成功 → 記錄實際 subagent_type 格式為 canonical；若失敗 / collision（例：和 voltagent 的 code-reviewer 衝突）→ 執行 fallback：agent frontmatter `name:` 改為 `autopilot_reviewer` / `autopilot_debugger` / `autopilot_planner`（底線而非冒號，避免任何 namespace collision）
- **P3.3**: 把 canonical 格式同步到所有 reference：本 plan doc / quality-pipeline 的 `subagent_type` 字串 / README / CHANGELOG / agents/README.md
- **P3.4**: 若 30 分鐘內無法釐清 → 強制 fallback 到 `autopilot_<name>` underscore 格式，不繼續深究 plugin 內部機制

**驗收**：3 個 agent 在 plugin install 後可被正確 dispatch；所有 reference 使用同一個 canonical 格式；無 dangling `autopilot:reviewer` vs `autopilot_reviewer` 混用

### Phase 4 — README + Metadata 更新（split per r2 A3/A6）

**Split into 2 groups per r2 A3 (Phase 4 自相矛盾) and r2 A6 (README prose 依賴 Phase 2 landed)**：

#### Phase 4a — 可和 Phase 1/2/3 並行（無 agent-specific content）

- **P4.1a**: `README.md` + `README.zh-TW.md` 的 `Inspired By` 加 devteam entry（credit source per v2.2.1 mandate）
- **P4.2a**: `.claude-plugin/plugin.json` version `2.3.0 → 2.4.0`
- **P4.3a**: `.claude-plugin/marketplace.json` version 同步
- **P4.4a**: `CHANGELOG.md` 開 `v2.4.0 — methodology agents` entry skeleton（具體內容 Phase 4b 填）

#### Phase 4b — 必須在 Phase 1 + Phase 2 + Phase 3 完成後（依賴 agent canonical name 和 quality-pipeline 改完）

- **P4.1b**: `README.md` 加 `Methodology Agents` 章節 + `Recommended Companions` 章節（§4.3 全文，agent name 使用 Phase 3 確定的 canonical 格式）
- **P4.2b**: `README.zh-TW.md` 同步（中英對等）
- **P4.3b**: 兩份 README 新增 agents count badge（3 agents）
- **P4.4b**: `plugin.json` + `marketplace.json` 的 `description` 欄位更新加「3 methodology agents」
- **P4.5b**: **執行 `grep -rn "2.3.0" . | grep -v CHANGELOG`**（per review r1 mi5 — 過濾 CHANGELOG 歷史 entry）確認回空；若有殘留檔案逐一更新
- **P4.6b**: `CHANGELOG.md` v2.4.0 entry 填完整內容

**驗收**：
- `grep -rn "2.3.0" . | grep -v CHANGELOG` 結果為空
- `grep -rn "2.4.0" .` 出現在 plugin.json + marketplace.json + 兩份 README badges + CHANGELOG
- README 中英同步（手動 diff 核對）
- CHANGELOG entry 列所有 Phase 1-4 改動

### Phase 5 — Integration Verification

**Subtasks**：

- **P5.1**: 在本 session reload plugin 後，`Agent(subagent_type="reviewer", prompt="...")` 試跑在本計畫 commits 上 — 驗證 autopilot:reviewer 實際可用並產出符合 §4.1.2 output contract 的 report
- **P5.2**: `autopilot:quality-pipeline` 實跑（本計畫的 commits）確認 reviewer 改動生效 — quality-pipeline 應自動呼叫 autopilot:reviewer 而非 superpowers:code-reviewer
- **P5.3**: 檢查 3 個 agent 的 Handoff section 實際被產出（格式正確、next consumer 指派明確）
- **P5.4**: （optional）試跑 `Agent(subagent_type="debugger", ...)` 和 `planner` 各一次驗證基本可用

**驗收**：
- P5.1 和 P5.2 都產出符合 §4.1.1 統一 output contract 的 Report，含 `### Handoff` 段
- 如任一驗證失敗：回到 Phase 1-4 對應位置修正後重跑

### Phase 6 — Finish-flow（L-5 強制閉環）

由 `autopilot:finish-flow` 展開的 sub-tasks：
- L-5.1 verify
- L-5.2 quality-pipeline（dogfood 新 reviewer）
- L-5.3 merge to develop (`--no-ff`)
- L-5.4 post-merge review
- L-5.5 archive（移本 plan 到 `docs/plans/archive/` 或依 autopilot 慣例）
- L-5.6 `autopilot:learn`（評估 5 個 learn-trigger 問題）— **同時作為 Ship B plan 的 OKR 輸入記錄**
- L-5.7 session end

---

## 6. Risks（擴充後，per review r1 mi1）

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **autopilot:reviewer 和 voltagent:code-reviewer 用戶混淆** | M | L | README + agents/README.md + §1.6 明確寫分工：autopilot 經 skill 自動 dispatch（帶紀律），voltagent 手動呼叫（domain 覆蓋廣）。兩者並存不互斥 |
| **agent namespace 和 plugin API 假設不符**（plan 假設 `autopilot:reviewer`，實際可能是 `reviewer` 或其他格式） | M | M | Phase 3 P3.1 明確驗證 namespace 規則並同步更新所有 reference |
| **Version bump 漏同步**（plugin.json vs marketplace.json vs README badges） | M | L | §3 mandate `grep -rn "2.3.0" . \| grep -v CHANGELOG` 回空；Phase 4 P4.7 明確執行 |
| **README 中英不同步** | L | L | 兩份一起寫、diff 檢查對等；Phase 4 acceptance 明確驗證 |
| **quality-pipeline skill 改動破壞現有用戶**（改 code-review.md 的 prose 讓某些現有行為變） | L | H | Phase 2 只改 reviewer 引用名，保留 superpowers:code-reviewer 作為顯式替代；Phase 5 regression 跑 quality-pipeline 在本計畫 commits 上 |
| **agent 被 Claude 意外用於非 methodology 場景**（例：用戶直接 `Agent(subagent_type="reviewer", ...)` 期待 voltagent 等級的 domain 覆蓋） | M | L | agents/README.md + description 欄位明確寫「primary use is via autopilot skills; for direct invocation prefer voltagent」|
| **Phase 1 agent markdown 品質不一致**（3 個 agent 並行寫、風格飄） | M | M | §4.1.1 明確 Output Contract 統一骨架，包含 `### Handoff` 段 — 3 個 agent 用同一模板 |
| **Planner model=sonnet 產出品質不夠**（per r1 mi10 建議的降級） | L | M | Phase 5 dogfood 時觀察；若發現 plan 深度不夠 → follow-up 改回 opus。風險可逆 |
| **autopilot:debugger 移除 Edit/Write 後 ceo-agent 派 debugger 修 bug 流程斷裂**（per r1 C3 改動） | M | M | ceo-agent 現有流程本來就是 debugger 產 root cause → main Claude / voltagent 修 — Edit/Write 移除後流程更明確。明確更新 ceo-agent 的文字（Phase 2 掃描時覆蓋） |
| **survey skill 繼續使用 general-purpose 不帶 Three Red Lines**（§2.3 已知缺口） | H | L | 本計畫明確接受延後；finish-flow L-5.6 learn 時記錄為 Phase 2 輸入 |
| **Dogfood 循環**（Phase 0 review 嘗試 dispatch 不存在的 autopilot:reviewer） | L | L | §2.1 OKR 6 + §5 Phase 0 明確寫 Phase 0 使用 existing agents（superpowers/voltagent）；Phase 5 才 dogfood 新建 reviewer（per r1 mi7） |
| **Voltagent version drift**（per r2 A2）— README 中引用的 voltagent agent 名字（例 `voltagent-qa-sec:code-reviewer`）若 voltagent 升級後更名，autopilot README 會靜默過時 | M | L | §4.3 README 勿 hardcode 完整 voltagent agent path，改為 generic description；若必須提具體名字在 markdown 加 HTML 註解記錄「verified against voltagent vX.Y.Z」以利日後 bulk 更新 |
| **Handoff pipeline integrity**（per r2 A2）— methodology agent 產出 Handoff 段格式錯誤（漏 Next consumer、enum 拼錯）會讓呼叫 skill 無法正確 pattern-match | M | M | §4.1.1 骨架用固定 enum 集合降低出錯；Phase 5 P5.3 明確驗證 3 個 agent 的 Handoff 實際產出格式；若發現 agent 常出錯 → follow-up 在 system prompt 加更多範例 |

---

## 7. Rollback Plan

本計畫是**純新增 + 非破壞修改**，rollback 簡單：

- **整個 PR revert**：`git revert <merge commit>` — 所有新 agents 消失、quality-pipeline 回到原 `superpowers:code-reviewer` 路徑
- **單 phase revert**：每個 phase 獨立 commit，可單獨 revert
- **Agent 個別 disable**：agent markdown 刪除即可，不影響其他 skill
- **Version 回退**：`.claude-plugin/plugin.json` 和 `marketplace.json` version 改回 2.3.0；README badges 改回

**無 schema migration / DB migration，零數據遺失風險。**

---

## 8. Definition of Done

- [ ] Phase 0 review loop 通過（≥2 個 reviewer 都 LGTM 或所有 Critical/Major 已 addressed）
- [ ] Phase 1：3 個 agent markdown + agents/README.md 完成、格式一致、有 bad/good examples、統一 Output Contract（§4.1.1 + Handoff）
- [ ] Phase 1：3 個 agent 都是 read-only（tools 無 Edit/Write）
- [ ] Phase 2：quality-pipeline SKILL.md + references/code-review.md 改動完成；`grep -rn "superpowers:code-reviewer" skills/` 只剩明確替代選項
- [ ] Phase 3：Claude Code plugin agent namespace 驗證完成，所有 reference 和 plan 的假設一致
- [ ] Phase 4：README 兩份同步 + plugin.json + marketplace.json + CHANGELOG + version grep clean（`grep -rn "2.3.0" . \| grep -v CHANGELOG` 回空）
- [ ] Phase 5：autopilot:reviewer 在本計畫 commits 上 dogfood 跑通，產出符合統一 Output Contract 的 Report
- [ ] Phase 6：finish-flow 全 sub-tasks green
- [ ] Quality-pipeline 整體通過（tests N/A + scan clean + completeness clean + review clean）
- [ ] Merge to develop 成功
- [ ] CHANGELOG v2.4.0 entry 完整

---

## 9. Execution Order（Parallel vs Sequential — revised per r2 A3/A6）

```
Phase 0 (review loop, using existing agents)
    │
    ▼
Phase 1 (3 agents, parallel via dispatching-parallel-agents)   ─┐
Phase 4a (Inspired By, version bump skeleton, CHANGELOG stub)  ─┤── parallel
                                                                │
    │  (Phase 1 完成)                                           │
    ▼                                                            │
Phase 2 (quality-pipeline integration)                           │
    │                                                            │
    ▼                                                            │
Phase 3 (namespace verification — time-boxed 30min)              │
    │                                                            │
    ▼                                                            │
Phase 4b (README prose, agents count, description, version grep, CHANGELOG body) ◄┘
    │  (必須在 Phase 1+2+3 都完成後才動，因為引用 canonical name)
    ▼
Phase 5 (integration verification — dogfood reviewer)
    │
    ▼
Phase 6 (finish-flow)
```

**Critical path**：Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4b → Phase 5 → Phase 6

**Parallelization opportunities**：
- Phase 1 的 3 個 agent 用 `superpowers:dispatching-parallel-agents` 同時寫
- Phase 4a 可從 Phase 0 結束就開始，和 Phase 1 並行（Inspired By entry、version bump 這些不依賴 agent canonical name）
- Phase 4b 必須在 Phase 1 + Phase 2 + Phase 3 全部完成後才動，因為 README 的 agent name、quality-pipeline 引用都要等 canonical format 確認

---

## 10. Credits & Source

**Design source**: [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 — 12 subagents + 15 hooks + P7/P9/P10 methodology + Three Red Lines + PUA mode. Full design absorbed in session context before plan drafting.

**Ship A absorbed mechanisms**:
- **Three Red Lines**（closure / fact-driven / exhaustiveness）→ 寫進 autopilot:reviewer + autopilot:debugger + autopilot:planner 的 system prompt
- **P7 `[P7-COMPLETION]` output contract** → 啟發 autopilot 方法論 agent 的統一 Output Contract（§4.1.1）+ `### Handoff` section
- **P9 六要素 Task Prompt**（goal/scope/input/output/acceptance/boundaries）→ 直接 port 到 autopilot:planner
- **PUA stress trigger**（2+ 次失敗強制寫 3 個新 hypothesis）→ 寫進 autopilot:debugger
- **Physical tool restriction**（`tools:` 不給 Edit/Write）→ port 到 3 個 methodology agent；per r1 C3 / mi3，所有 3 個都 read-only
- **Severity tiering**（🔴🟠🟡🔵）→ autopilot:reviewer 的 output contract
- **Evidence-first debug methodology** → autopilot:debugger 5-phase 流程

**Ship B（deferred）absorbed mechanisms**：
- 8 個 Tier A hook + 6 個 Tier B hook + settings.example.json → 另開 plan

**Attribution destination**：autopilot README `Inspired By` section 新增 devteam entry（Phase 4.3）

**Not absorbed**（明確選擇不吸收的）：
- devteam 的 12 個 role agent（fullstack / frontend / migration / db / refactor 等）— 留給 voltagent
- devteam 的 Loop 模式 `<loop-pause>` / `<loop-abort>` tag 協議 — autopilot 用 ceo-agent + finish-flow 已涵蓋
- P7/P9/P10 三層文化詞彙 — 和 autopilot 既有 S/L/H sizing 重疊，保留 autopilot 詞彙降低用戶認知負擔

---

## 11. Review Loop History

### r0 → r1（2026-04-12）

派三個 reviewer 並行：`voltagent-qa-sec:architect-reviewer` / `feature-dev:code-reviewer` / `voltagent-meta:agent-organizer`。

**Critical 接受（3/3）**：
- C1 branch-protection regex → **移到 Ship B**（本計畫不處理 hook）
- C2 graceful degradation 不是 runtime 可實作 → 改用「prose instruction」措辭（§1.6, §2.1 OKR 2, §4.3, §5 Phase 2）
- C3 debugger 有 Edit/Write 和 methodology 角色衝突 → **改為 read-only**（§4.1.3）

**Major 接受（5/5）**：
- M1 orthogonality 需要明確 disclaimer → §1.6 新增 Dispatch boundary 段
- M2 reviewer→fixer handoff gap → §4.1.1 統一 `### Handoff` section
- M3 bug-hunt orchestration → §4.2 Orchestration Protocol 聲明 agents 不互相呼叫
- M4 Phase 1 是兩個 L-ships → **Ship Split 採納**：Ship A 僅 agents，Ship B 後續另計畫
- M5 Phase 4 可並行前移 → §9 Execution Order 明確 Phase 2/3/4 可重疊

**Minor 接受（10/10）**：
- mi1 missing risks → §6 risks 表擴充 8 rows
- mi2 Phase 5 testing 3/4 太軟 → Ship A 沒有 hook 層不適用；§5 Phase 5 改為 `autopilot:reviewer` dogfood + Handoff 驗證
- mi3 planner physical restriction 措辭 → 改為「cannot directly edit files」
- mi4 file count ~20 vs 22 → Ship A 後總數 6 新增 + 7 修改 = 13 檔，明確列
- mi5 version grep 模糊 → `grep -rn "2.3.0" . \| grep -v CHANGELOG` 回空
- mi6 Phase 2a/2b 拆分 → Ship Split 已解決
- mi7 Dogfood 循環 → §2.1 OKR 6 + §5 Phase 0 明確 Phase 0 用 existing
- mi8 hook 測試覆蓋 → Ship A 不適用
- mi9 output contracts 不一致 → §4.1.1 統一骨架 + `### Handoff`
- mi10 planner model opus → 改 sonnet

**Suggestion 接受（3/3）**：
- S1 survey methodology gap → §2.3 明確記錄為 known gap，延到 Phase 2
- S2 reviewer WebSearch hallucination → §4.1.2 Red Lines 新增「WebSearch 結果不可直接 cite」
- S3 namespace verification → §5 Phase 3 新增獨立 phase

**未變的決策**：
- 3 個 methodology agent 的選擇（reviewer / debugger / planner）— reviewer 們都同意這個小集合是 Phase 1 合理範圍
- 方法論 vs role 分工的基本架構 — reviewers 一致認為方向對的，修正的是邊界和措辭
- Dogfood 機制（ceo-agent level 3 → review loop → dev-flow L → finish-flow）— reviewers 沒人反對，只修循環時序

### r1 → r2（2026-04-12，後續）

派兩個 reviewer 二輪：`voltagent-qa-sec:architect-reviewer` + `voltagent-meta:agent-organizer`（第三位 code-reviewer 在 r1 已覆蓋語義層，r2 省略）。

**Critical 接受（1/1）**：
- **A1** Phase 2 integration 自相矛盾：「prose instruction 非 runtime fallback」措辭誤導 — 實際是 skill 內部 static dispatch target 從 superpowers:code-reviewer 改為 autopilot:reviewer，是**內部行為變更但非 API 變更** → §2.1 OKR 2 + Phase 2 P2.1 明確說清楚

**Major 接受（4/4）**：
- **A2** Missing voltagent version drift + Handoff pipeline integrity → §6 Risks 新增 2 rows
- **A3 + A6** Phase 4 parallelization 自相矛盾 / README 依賴 Phase 2 landed → §5 Phase 4 拆 4a（可早期並行）+ 4b（必須在 Phase 1/2/3 完成後），§9 流程圖更新
- **A4 + O1** Handoff contract drift（三 agent 用不同 schema）→ §4.1.1 統一骨架，用**固定 enum** 集合（MAIN_CLAUDE / AUTOPILOT_DEBUGGER / AUTOPILOT_PLANNER / NEEDS_DOMAIN_EXPERT / PARALLEL_DISPATCH / SEQUENTIAL_DISPATCH / DOCUMENT_ONLY）+ degenerate form 支援 + Routing rationale 欄位
- **A5** Namespace rabbit hole → §5 Phase 3 time-box 30min，fallback 是 `autopilot_<name>` underscore

**Minor 接受（3/3）**：
- **A7** typo "primary primary" → §2.1 OKR 2 修正
- **A8** reviewer description 自我貶抑 voltagent 會干擾 Claude 的 dispatch 選擇 → §4.1.2 description 移除 voltagent 推薦語，改寫在 agents/README.md
- **O2** round-trip re-dispatch 未記錄 → §4.2 明確寫 quality-pipeline 讀 Handoff 後 re-dispatch debugger 的流程

**Suggestion 接受（3/3）**：
- **O3** debugger 不自己列舉 voltagent role 名字 → 改用 `NEEDS_DOMAIN_EXPERT` enum + rationale 欄位，由呼叫 skill 映射實際 voltagent role
- **O4** planner 不硬 code superpowers:dispatching-parallel-agents（違反 §1.4 單獨可跑）→ 改用 `PARALLEL_DISPATCH` / `SEQUENTIAL_DISPATCH` enum
- **O5** degenerate Handoff form 支援 → §4.1.1 明確允許 trivial 時省略 Routing rationale
