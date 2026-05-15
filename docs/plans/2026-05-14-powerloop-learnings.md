# Powerloop Learnings → Autopilot Tightenings

**日期：** 2026-05-14
**狀態：** ✅ Shipped — B (`99ab8a6` SubAgent skill invocation rule) + A (`ec9027f` blind re-dispatch); C 緩議, D 跳過
**Size：** S（拆兩個獨立 Fix-cycle）
**Source survey：** `~/projects/claude-powerloop-plugin` v0.4.1（Aotokitsuruya，Apache-2.0）

---

## 1. 背景

讀完 [claude-powerloop-plugin](https://github.com/elct9620/claude-powerloop-plugin) 全部檔案後，盤點出 4 個 powerloop 用到、autopilot 沒明文化的設計。本計畫對 4 項各自做**證據驅動評估**（grep 現有 autopilot skills / agents / references），給出採用 / 修改採用 / 緩議 / 跳過的判斷與 size 估算。

powerloop 是 cron-scheduled 多 session 接力的 quality-loop framework，autopilot 是 session-shaped dev-flow + methodology library — **兩者互補不衝突**，所以借鑑只看「概念是否補 autopilot 的洞」，不看「架構是否合拍」。

### 1.1 4 個候選設計

| ID | 概念 | powerloop 來源 |
|---|---|---|
| **A** | Blind dispatch — Review/Sample SubAgent prompt 必須剝離先前判決 | SKILL.md `## Blind Review Principle` + `examples/blind-dispatch.md` |
| **B** | SubAgent prompt 必須**明確指示**該 SubAgent 用 Skill tool invoke 該 skill，不准 paraphrase | SKILL.md constraint（v0.4.1 commit `8f6af68`）|
| **C** | Cross-cycle Handoff schema（5 欄 Log Table：Cycle / Phase / Summary / Decision / Handoff）| SKILL.md `### Log Table` + examples |
| **D** | Two-stage Haiku→Sonnet review，Stage 1 回 aspect labels（不傳 findings 防 anchoring）| SKILL.md `### review` Stage 1/2 + blind-dispatch.md |

---

## 2. 評估與證據

### 2.1 A — Blind Dispatch（採用，**re-review 路徑限定**）

**現況 grep**：
- `grep -rln "blind\|strip\|history-free\|context-strip" skills/ agents/ references/` → 0 hit（兩個結果是 dialectic 的「blind spot」與 synthesis「strip hypothesis」，**概念無關**）
- autopilot **沒有** blind-dispatch 觀念明文化

**Agent() 預設行為**：每次 `Agent()` 呼叫產生 fresh conversation，SubAgent 預設就是 blind（看不到主 session 的對話歷史）。所以 **first-pass review/audit 不需要 blind-dispatch 規範** — autopilot 已預設 blind。

**真實缺口在 RE-DISPATCH**：
- `skills/quality-pipeline/SKILL.md:59-61` Code Review step：「`→ Critical/Important? → fix → re-review (repeat until clean)`」— 第二輪 reviewer 是否會在 prompt 收到「item X was fixed」「previous round flagged auth.ts:67」？autopilot 沒寫**禁止**這麼做。如果 dispatcher 把上輪 finding 帶進 second-round prompt，reviewer 走最便宜路徑去 confirm 修好 → quality gate 被自己 dispatcher 繞過（powerloop blind-dispatch.md 的核心反例）
- `skills/audit/SKILL.md` Phase 4 fix 後「re-run tests」沒明說 re-audit 怎麼分發；若有 re-audit 同樣風險
- `skills/ceo-agent/SKILL.md` 沒提

**autopilot 已有的部分**：
- `agents/reviewer.md` 預設「Read every file affected by the change」是 **first-pass 全 context** model，**這對的，不要改**
- 缺的是 **re-dispatch（second pass / 修完 re-review）**的 prompt 紀律

**採用範圍（限定）**：
- 新增 `references/blind-dispatch.md`（autopilot-core 級，所有 skill 都能引用）
- 內容：**only when re-dispatching after a fix** — dispatcher 必須剝離 prior finding 字串（line numbers、quoted code、what fixer did）
- 引用點：
  - `skills/quality-pipeline/references/code-review.md` re-review 章節（目前沒有 → 補一節）
  - `skills/audit/SKILL.md` Phase 4 re-audit
- Stage-2 aspect-label-only protocol 暫不採用（autopilot 沒 staged review，沒必要）

**Size**：S Fix（1 新檔 + 2 ref 加引用 + 文案校稿）

---

### 2.2 B — SubAgent Skill Invocation Rule（採用，最高 ROI）

**現況 grep**：
- `grep -rn "Skill tool" skills/ agents/` → 3 hit，**全部** 在 `skills/dev-flow/SKILL.md`（L-1.6 主 session 自我 invoke 紀律）
- `grep -n "Skill tool" skills/ceo-agent/SKILL.md` → **0 hit**
- `references/task-prompt-templates.md`（CEO L-size SubAgent dispatch 範本）→ Six-Element 範本 **無** Skill invocation 指示
- `skills/team/SKILL.md` Spawn Teammates 段 → 只給 role + prompt 文字，**沒**告 SubAgent 要 invoke 哪個 skill
- `skills/think-tank/SKILL.md` Step 3 Parallel Dispatch → 只給 `role-prompt + domain-context + topic`，**沒** Skill invocation

**對比 dev-flow L-1.6 原文** (`skills/dev-flow/SKILL.md:259-263`)：
> "Invoke each required skill via the Skill tool (reading the file is NOT invoking). Mark this task completed ONLY after (a) every required skill has been invoked via Skill tool, AND ..."

→ autopilot **已有此紀律**（主 session 對自己），但 **未推廣到 SubAgent dispatch**。powerloop 0.4.1 的 fix（`8f6af68`）正是把同樣紀律延伸進 SubAgent prompt。

**真實場景**：CEO 派 L-size SubAgent「Implement WebSocket Compression」。Six-Element 範本只給：WHY、WHAT、WHERE、HOW MUCH、DONE、DON'T。SubAgent 不會自動知道要 invoke `twgs-network`（project skill）或 `autopilot:debug`（方法論）。**Project 投資在 skill body 的方法論在 dispatch 時悄悄漏掉**。

**採用範圍**：
- `references/task-prompt-templates.md` → Six-Element 範本加**第七個 element**：

  ```markdown
  ### SKILLS — Required skill invocations
  [Skills the SubAgent MUST invoke via the Skill tool BEFORE starting work.
  Naming a skill in WHY/WHAT/HOW MUCH is NOT enough — paraphrasing loses fidelity.]
  - Invoke `/<plugin>:<skill>` via the Skill tool (e.g. `/autopilot:debug`)
  - Invoke project skill `/<project>:<skill>` if applicable
  ```

- 範例段同步加 SKILLS 範例
- 4 個下游 skill 加引用：
  - `skills/ceo-agent/SKILL.md` Execution step 9 註記
  - `skills/team/SKILL.md` Spawn Teammates 段
  - `skills/think-tank/SKILL.md` Step 3 Parallel Dispatch 段
  - `skills/think-tank-dialectic/SKILL.md`（檢一下）
- **不**動 `agents/reviewer.md / debugger.md / planner.md` — agent 是被叫的對象，本身不 dispatch SubAgent

**Scope reduction in implementation (2026-05-14)**：think-tank 與
think-tank-dialectic 兩個檔案 review 後**排除**，原因：兩者的 SubAgent 是 voltagent
分析師（architect-reviewer / product-manager / ux-researcher 等），輸出
Decision Brief 與 perspectives，**不執行 project code 工作**。SKILLS rule 是
「touching code 前載入 methodology」紀律，對 read-only 角色分析不咬合。最終實際
動 3 個檔案：`task-prompt-templates.md` + `ceo-agent/SKILL.md` + `team/SKILL.md`，
外加 README disambiguation 註記。

**Size**：S Fix（1 主檔 + 4 引用點）

---

### 2.3 C — Cross-cycle Handoff Schema（緩議）

**現況 inventory**：
- `agents/README.md` 已有 **enum'd terminal handoff**：`Next consumer / Routing rationale / Remaining risks`，calling skill pattern-match 用 — 機械化、deterministic
- `skills/finish-flow/SKILL.md` L-5/H-9 sub-tasks 每個都有 `Output:` clause（具體驗證輸出）— 等同 powerloop log table 的 Summary 欄
- `skills/dev-flow/SKILL.md` L-1.6 / L-5 forcing function 透過 TaskCreate description 傳上下文
- 對外（人類讀的）handoff doc：本月剛寫的 `docs/projects/_archive/2026-05-14-superpowers-coexistence/handoff-d1-d2-dogfood.md` 是**freeform** — 沒 schema

**對比 powerloop**：5 欄 Log Table（Cycle | Phase | Summary | Decision | Handoff）是 **cron 多 session 接力**用的 — 每次 cron fire 是 fresh conversation，這張表是它**唯一**上下文。autopilot 是 session-driven，不存在 cron 多 cycle 場景。

**Match**：
- autopilot 的 **terminal handoff（agent → calling skill）已比 powerloop 強**（enum'd machine-parseable vs freeform）
- 缺的是 **cross-session 人類 handoff doc 範本** — 上個 session 寫給下個 session 的 me

**真實痛點 vs cost**：
- 痛點：本月 1 次 freeform handoff 寫得堪用但無 schema。樣本太小
- cost：定 schema + 推 dev-flow 用 + 改 doc 範本，雜訊比訊號多
- 風險：太早 schema → 限制 freeform 的彈性

**結論**：**緩議**。等出現第 3 次「freeform handoff 不夠用」的場景再採用。屆時範本 source 可從 powerloop log table 借（cycle 改 session number、phase 改 dev-flow 階段）。

**Size if pursued**：optional S（單檔範本 + dev-flow 一處引用）

---

### 2.4 D — Haiku Triage + Sonnet Verify（跳過，**證據不足**）

**現況**：
- `references/model-routing.md` 已 benchmark：reviewer/debugger/planner 全用 sonnet，**100% 準確率**，比 opus 省 36% cost
- quality-pipeline 對單 diff 跑 1 次 reviewer dispatch — **不是** N items batch review

**powerloop 為什麼成立**：
- powerloop review/sample phase 每 cycle 處理 **2–3 items 並行**，N 大時 Haiku 廣掃 PASS / Sonnet 只驗 SUSPECT 才有 cost amortization
- 80%+ PASS 直接過 Stage 1 → 不打 Sonnet → cost 顯著省

**autopilot 為什麼不成立**：
- autopilot reviewer dispatch 是 **single diff per call**，不是 batch
- 引入 Haiku 廣掃會多 1 次 round-trip，且只有 50% PASS 才能省 1 次 Sonnet。對單一 diff，新增 step 的固定成本 > 變動成本省的部分
- 風險：Haiku triage false-PASS 漏 bug → 比現況差

**結論**：**跳過**。除非未來 autopilot 加 batch-review mode（同時 review N PR / N module），否則加 Haiku triage 是負 ROI。

**Size if pursued**：L（新增 model 路由、aspect-label 協定、新失敗模式 — 不值得）

---

## 3. 採用順序

| 優先 | Item | Size | Rationale |
|---|---|---|---|
| **1** | B — SubAgent skill invocation rule | S Fix | 最高 ROI：autopilot skill 投資不漏出去；改動小，影響面廣（CEO/team/think-tank 全沾） |
| **2** | A — Blind re-dispatch（限 re-review）| S Fix | 防 quality-pipeline re-review 自我繞過。範圍刻意收斂在 re-dispatch 路徑，避免污染 first-pass full-context model |
| — | C — Cross-session handoff schema | (optional S) | 緩議：等出現第 3 次痛點 |
| — | D — Haiku triage | (would be L) | 跳過：證據不足，與 autopilot 單-diff 模式不合 |

**建議分兩個 Fix-cycle 跑**，**B 先 A 後**：
- B 影響 CEO L-size dispatch 主路徑，先 ship 立即受益
- A 影響 re-review，較邊緣但對 quality-pipeline 完整性重要

---

## 4. B 採用 — 詳細 scope

### 4.1 改動清單

| 檔案 | 改動 |
|---|---|
| `skills/ceo-agent/references/task-prompt-templates.md` | 加第 7 個 element `### SKILLS — Required skill invocations`；範例段補對應行 |
| `skills/ceo-agent/SKILL.md` | Execution step 9 加一行 reminder「SubAgent prompt 必須含 SKILLS 段」 |
| `skills/team/SKILL.md` | `Spawn Teammates` 段加 SKILLS 範本片段 |
| `skills/think-tank/SKILL.md` | Step 3 Parallel Dispatch 加「prompt 必須指示 voltagent role 載入 review_skills」 |
| `skills/think-tank-dialectic/SKILL.md` | （read 後決定是否同步加）|

### 4.2 Acceptance

- `grep -rn "Skill tool" skills/` 命中數從 3 → ≥ 7（dev-flow 3 + ceo-agent 1 + team 1 + think-tank 1 + 範本 1+）
- Six-Element 範本變 Seven-Element，SKILLS 段有具體範例
- CHANGELOG entry：`feat(dispatch): require SubAgent prompts to invoke skills via Skill tool`

### 4.3 Dogfood

下次 CEO 模式跑 L-size 任務時，看 SubAgent prompt 是否真的有 SKILLS 段。若無 → 範本未被內化 → 需要強化 forcing function（例如 dev-flow L-1.6 加「dispatch SubAgent 前的 prompt audit」）。

---

## 5. A 採用 — 詳細 scope

### 5.1 改動清單

| 檔案 | 改動 |
|---|---|
| `references/blind-dispatch.md`（新檔）| 核心 principle + leaky-vs-blind 範例 + dispatcher 檢查清單。範圍限 **re-dispatch**，明寫 first-pass 不適用 |
| `skills/quality-pipeline/references/code-review.md` | 加「Re-review after fixes」段：dispatcher 必須剝離哪些字串 |
| `skills/audit/SKILL.md` Phase 4 | 加 re-audit 一句：「re-dispatch 同 segment agent 時，prompt 不得含 prior finding line numbers」|

### 5.2 Acceptance

- `references/blind-dispatch.md` 存在且被 2 處 skill 引用
- 範例 leaky-vs-blind diff 跟 powerloop examples/blind-dispatch.md 同精神但 autopilot-flavored（用 reviewer.md 風格 + Three Red Lines 表述）

### 5.3 Dogfood

下次 quality-pipeline re-review 時，inspect dispatcher 給 reviewer 的 prompt 是否含「previous round flagged」「fixer patched at line X」字串。若有 → 紀律未落地 → 補 ceo-agent / dev-flow 條目。

---

## 6. Out-of-scope（本計畫**不**做）

| 項 | 為何不做 |
|---|---|
| Sample phase / 統計信心閘 | autopilot 沒 cron 多 session 場景，confidence-sampling 沒 natural home。等 batch-review mode 出現再評估 |
| 改 reviewer.md 為 blind | first-pass full-context 是對的，不能改 |
| Six-Element → Seven-Element 自動工具化 | 文檔規範就夠，工具化是 over-engineering |
| 借 `examples/` 目錄結構 | autopilot 已有 `references/` 慣例。同事抄 powerloop examples/ 結構是格式潔癖，沒實際 ROI |

### eval-proxy limitation（B/A 收尾跑 skill-creator 驗證時 surface 的）

跑 `scripts/run-eval-batch.sh` 想用 skill-creator 完整驗證 B/A 沒 regression 時觀察到：**`run_eval.py` 是 description-in-isolation test，不是 routing precision 量尺**。

機制：對每 query 在 test project 寫一個 `.claude/commands/<skill>-skill-<random>.md`（只放 description），spawn `claude -p`，看 stream event 是否觸發那唯一一個 command。整套 measure 的是「單一 description 在零干擾條件下被選中的機率」。

實測 16 skill: 15/16 recall = 0%、1/16 recall = 20%（sonnet 4.6, runs=1）。所謂「2.5% baseline」就是這個 isolation-test floor — **不是 proxy 壞、不是 routing 出問題**，是設計上就只測 description attractiveness。

**S3 high-fidelity baseline 進一步揭露（2026-05-14_155325，runs=5 + opus 4.7，$45）**：

| Metric | sonnet × 1 run | opus × 5 runs |
|---|---|---|
| TP | 1 / 82 (think-tank lucky hit) | **0 / 82** |
| FP | 0 / 81 | 0 / 81 |
| Recall | 1.2% | **0.0%** |
| Precision | 100% | 100% |

更多 runs + 更強 model 把先前的 1 TP 也磨平了 → **proxy 對 autopilot skill 是結構性無法 trigger**，不是 stochasticity 噪音。Sonnet × 1 run 的 ±1 case 波動全部是隨機，本質訊號是 0。

可能原因（未深究，留 T4 Phase 1 處理）：
- 命令檔 `<skill>-skill-<random>` 跟 autopilot 內部 `autopilot:<name>` 引用解耦，Claude 看不出兩者關聯
- 命令檔只放 description、無 body — Claude 可能對 body-less skill 不夠 confident
- autopilot description 引用其他 autopilot skill（"Not for: → debug"），那些 skill 在 isolation test 中不存在 → 不完整 context

判讀更新：原 plan §6 提出「2.5% 是 isolation-test floor」— 修正為「**0% 是 isolation-test floor**，2.5% 是過往單 run 殘餘 noise」。對 B/A 的結論不變：沒動 description → eval 結果跟 baseline 同（0%）。

對 B/A 的判讀：
- 沒動 SKILL.md description → eval 結果 ±1-2 case 是 LLM stochasticity，不是 regression
- 想真正測 routing fidelity，需要 manual scenario walks（D-1/D-2 9-query 已是現有做法）OR 寫獨立 router-judge harness（見 `docs/plans/2026-05-14-eval-router-judge.md`）

文件化動作：
- `scripts/run-eval-batch.sh` 加 header comment 講清楚這個機制 + parametrize `RUNS_PER_QUERY` / `MODEL` 兩個 env var，方便 high-fidelity 跑（5 runs × opus 4.7）vs 日常 quick check
- 這節記錄這次發現，下次 me 不重蹈誤讀 5/10 為「routing regression」的覆轍

---

## 7. Credit

本計畫的 design 借鑑來源：

- [claude-powerloop-plugin](https://github.com/elct9620/claude-powerloop-plugin) by Aotokitsuruya（Apache-2.0）
  - Blind Review Principle — `skills/powerloop/SKILL.md` + `examples/blind-dispatch.md`
  - SubAgent skill-invocation rule — commit `8f6af68`
  - 概念採納時將在採用 commit message 點明來源

採用後 `README.md` 的 `Inspired By` / `Acknowledgements` 段若有應補上 — 若無此段，在 `references/blind-dispatch.md` 頂端註明 source。

---

## 8. 變更歷史

| 日期 | 事件 |
|---|---|
| 2026-05-14 | Plan written based on powerloop v0.4.1 survey |
