# Superpowers Coexistence — Self-Sufficient autopilot with First-Class Superpowers Coexistence (v2.7.0)

**日期：** 2026-05-14
**狀態：** 🟢 r2 pass — minor revisions inline applied; ready for Phase 1
**Size：** L
**Dogfood：** 本計畫使用 autopilot 自家的 dev-flow L-size + parallel-reviewer review loop（r1 已 3 reviewer 角度收斂）+ finish-flow 驅動，閉環驗證 dispatch-config.md 機制能跑通實際 L-size 工作流。

---

## 1. 背景與動機

### 1.1 問題

v2.0 (commit `f08812c`, 2026-03-26) 以「rule-setter architecture」之名移除 4 個 skill — `debug`、`test-strategy`、`team`、`profiling` — 理由是「重複 Superpowers 能力」。CHANGELOG 寫明：

> Autopilot no longer competes with built-in Superpowers. It sets the rules; Superpowers executes.

這個前提隱含**未經測試的假設**：`superpowers` plugin 永遠存在。實際狀況：superpowers 是獨立 Claude Code plugin，需要使用者主動安裝。autopilot README、`plugin.json` description、`marketplace.json` description 全部都把 superpowers 寫成 hard prerequisite，但實際 plugin 互依未強制宣告，未安裝 superpowers 的使用者落入 4 塊方法論斷層：

- `autopilot:debug` 不存在 → debugging methodology 缺失
- `autopilot:test-strategy` 不存在 → test pyramid / baseline / failure investigation 全失（`superpowers:test-driven-development` ≠ test-strategy）
- `autopilot:team` 不存在 → team allocation methodology 沒了
- `autopilot:profiling` 不存在 → 連等價替代都沒有

外加多處 skill body / config 硬寫 `superpowers:dispatching-parallel-agents` / `superpowers:code-reviewer` 為唯一選項。

### 1.2 受影響的使用情境

| 情境 | superpowers 安裝層 | 目前 UX | 期望 UX |
|---|---|---|---|
| A | 使用者裝在 user-level（or marketplace） | 已能用，但 autopilot 內部 hardcode `superpowers:*` 仍會在 superpowers 未載入時失敗 | autopilot 編排層 + superpowers 戰術層的乾淨分工 |
| B | 完全未安裝 | autopilot 4 塊方法論斷層，使用者卡關 | autopilot self-sufficient — fallback skill 補齊缺口 |
| C | superpowers 在 user-level，但特定專案要 pure autopilot | 無 per-project escape hatch | per-project config 可宣告 chain order，superpowers skill 不被誤觸 |

v2.0 把情境 A 當作唯一情境，B / C 未支援。

### 1.3 為何現在處理

partial 修正已先動手（branch `feat/v2.7.0-superpowers-coexistence` 的 working tree）：
- 新增 `project-config-template/dispatch-config.md`（雙 chain：Parallel Dispatch + Code Review）
- 6 個檔案的 hardcoded `superpowers:*` 改為 config-driven + native fallback

那批改動已經把「Parallel Dispatch 派發機制」+「Code Reviewer 選擇」雙鏈打通，但未處理 4 個被砍 skill 留下的方法論缺口，沒系統化處理 per-project 偏好 UX，也沒修「v2 rule-setter 標語 + plugin.json/marketplace.json description」這層 brand-coherence 問題。本計畫把它做完。

### 1.4 同時要修的既存版本飄移

進入 plan 過程中發現的既存 inconsistency（**獨立於本計畫的主要改動，但同 commit 順手修**）：

| 問題 | 位置 | 應為 |
|---|---|---|
| 版本 drift（v2.6.0 已發佈但 manifest 沒跟） | `.claude-plugin/plugin.json:3` `"2.5.0"` | `2.7.0` |
| 同上 | `.claude-plugin/marketplace.json:10` `"2.5.0"` | `2.7.0` |
| README 雙語版本徽章不同步 | `README.zh-TW.md:11` `version-2.5.0` vs `README.md:11` `version-2.6.0` | 雙語 `version-2.7.0` |
| hooks 描述字串落後 | `hooks/hooks.json:2` `(v2.6.0)` | `(v2.7.0)` |
| methodology-agents 專案 README 殘留 v2.5.0 ref | `docs/projects/2026-04-12-methodology-agents-ship-a/README.md:36`（**未在 _archive 下**） | 該專案實際 ship v2.4.0，可能是當年寫錯，留 historical 不動但 Phase 5 grep 須白名單 |

---

## 2. 決策

採三層架構同時覆蓋 A / B / C 三情境（**精簡 v0 設計：drop `mode` 欄位**，per-chain ordering 已表達一切偏好）：

| 層 | 機制 | 適用範圍 | 角色 |
|---|---|---|---|
| L1 | 補回 4 個 fallback skill | catalog 層 | **保證情境 B 有 routing entry point**；description 保留 f08812c^ 原版 keyword-rich 措辭，body 內加一小段「Coexistence with Superpowers」subsection 而非塞進 description |
| L2 | `.claude/dispatch-config.md` chain ordering | 專案層偏好宣告 | orchestrator skill 在 prompt-time 透過 `!cat` preprocessor 注入 chain；無 chain 則用 plugin 內建預設 |
| L3 | `.claude/settings.json` 的 `disabledSkills` | 專案層 hard cut | 情境 C 的 escape hatch；只在使用者明確不要某 skill 出現時用 |

**v0→v1 的關鍵修正**（來自 r1 review 收斂）：

1. **drop `mode` 欄位** — UX 與 Arch reviewer 共同指出 mode + per-chain ordering 是冗餘設計。chain ordering 已表達所有偏好；scenario C 用 settings.json `disabledSkills` 處理硬隔離
2. **drop「在 description 寫 prefer superpowers」措辭** — UX/Arch/Impl 三 reviewer 共同指出 Claude routing 是 keyword scoring，「prefer X」這種英文 policy 句子不會影響 routing，反而降低 scenario B 用戶的 trigger 機率。改為：**description 保留 f08812c^ 原版**（keyword-rich for intent matching），body 內加一小段「Coexistence with Superpowers」subsection 提供關係說明
3. **Phase 3 從 prose 改為 `!cat` preprocessor** — Arch reviewer 指出在 SKILL.md prose 加一行「請去讀 dispatch-config」在 context 壓力下會被忽略。改用既有 `!cat .claude/quality-gate-config.md 2>/dev/null || true` 的同款 preprocessor 機制（見 `quality-pipeline/SKILL.md:16` 為 working 範例）
4. **Phase 3 同步改寫 `skills/quality-pipeline/references/code-review.md:80-95`** — Impl reviewer 指出該 reference doc 第 88 行明文宣告「quality-pipeline does **not** runtime-detect which reviewers are available」，與 chain-based dispatch 直接矛盾，必須改寫

**Fourth coexistence mechanism (acknowledged not implemented)**：Claude 在 session 內可內省自己 catalog 內有哪些 skill。對於「autopilot:reviewer vs superpowers:code-reviewer」這類選擇，理論上可指示 orchestrator「先檢查 `superpowers:X` 是否在 catalog 內，再決定要 dispatch 哪個」。**本計畫不採用此機制**，因為（a）chain ordering + plugin not-installed 自動 skip 已達等效效果，（b）內省指令需要在每個 dispatch point 重複寫，維護成本高。Arch reviewer 的 C2 已在 §10 Q5 完整討論。

---

## 3. Scope

### In scope

#### 3.1 補回 4 個 fallback skill（**description 保留原版**）

從 `git show f08812c^` 拉回，全文保留 description（已是 keyword-rich for intent matching）：
- `skills/debug/SKILL.md`
- `skills/test-strategy/SKILL.md`
- `skills/team/SKILL.md` + `skills/team/references/team-tactics.md`
- `skills/profiling/SKILL.md`

每支 body 開頭加一個 8-12 行的 `## Coexistence with Superpowers` subsection 說明：
- 如果你有 superpowers，可以 prefer `superpowers:<X>`（連結到 dispatch-config 的偏好機制）
- 如果沒有，這支就是 primary methodology
- 與 superpowers 對應 skill 的本質差異（例：test-strategy ≠ TDD）

#### 3.2 擴充 `dispatch-config.md`

`project-config-template/dispatch-config.md` 新增 **Methodology Preferences** 區段（4 條 chains）：
- Debugging（`superpowers:systematic-debugging` → `autopilot:debug`）
- Testing methodology（`superpowers:test-driven-development` → `autopilot:test-strategy`）
- Performance profiling（`autopilot:profiling`，無 superpowers 等價）
- Team allocation（`autopilot:team`，無 superpowers 等價）

既有 Parallel Dispatch + Code Review chain 保留。**不**加 `mode` 欄位（drop 自 v0 設計）。

#### 3.3 orchestrator skill 接 `!cat` preprocessor

在以下 SKILL.md 頂部加 preprocessor 行（與既有 quality-gate-config 注入同款）：

```markdown
<!-- Project dispatch chains (optional) -->
!`cat .claude/dispatch-config.md 2>/dev/null || true`
```

目標檔（6 個 SKILL.md + 1 個 reference doc）：
- `skills/quality-pipeline/SKILL.md`（preprocessor + reference doc 改寫）
- `skills/quality-pipeline/references/code-review.md:80-95`（**改寫**「does not runtime-detect」段）
- `skills/ceo-agent/SKILL.md`（preprocessor + execute-phase prose）
- `skills/finish-flow/SKILL.md`（preprocessor + L-5.2/H-9.2 dispatch）
- `skills/think-tank/SKILL.md`（preprocessor + Step 3 dispatch）
- `skills/think-tank-dialectic/SKILL.md`（preprocessor + R1/R2 dispatch）
- `skills/dev-flow/SKILL.md`（preprocessor + Session Rules table 加 row；對稱化決定見 §3.3）

#### 3.4 autopilot 自家 `.claude/` 配置同步

partial 已修但未認領；plan 正式納入 scope：
- `.claude/finish-flow-config.md:32`
- `.claude/quality-gate-config.md:18`

兩者已將 `superpowers:code-reviewer` fallback 標為「conditional on superpowers 安裝」。

#### 3.5 README + 雙語同步 + Brand revision

| 檔案/位置 | 修正 |
|---|---|
| `plugin.json:4` description tagline | `"Sets the rules; Superpowers executes."` → `"Standalone-capable orchestration that coexists with Superpowers."` (r2 reviewer 採納調整：less ambiguous about default direction，且與 marketplace.json 措辭收斂) |
| `marketplace.json:11` description | `"Works with built-in Superpowers, not against it."` → `"Standalone-capable; coexists with Superpowers when installed."` |
| `README.md:65-66`（rule-setter example） | 改成中性敘述：「if superpowers installed → delegates tactical execution; if not → autopilot's own fallback skills handle」 |
| `README.md:309`（"v2 removed 4 skills..." 段） | 改寫成：「v2 移除過 4 個 skill，v2.7.0 以 fallback 形式補回；當 superpowers 存在時這些 skill 讓位給 superpowers」 |
| `README.md:393` + `README.zh-TW.md:386` `## Hooks (v2.5.0)` | 改成 `## Hooks` 純標題，版本資訊移到段內第一行（避免每次版本 bump 都要動標題） |
| 新增 `## Superpowers Coexistence` 區段 | 兩語言版本同步；緊跟在 README 開頭的 The Problem / The Solution 之後（UX reviewer S1）；列三情境 + dispatch-config 連結 + settings.json `disabledSkills` 範本 |
| `README.zh-TW.md:11` 版本徽章 | `version-2.5.0` → `version-2.7.0`（補既存 drift） |
| README + zh-TW skill 徽章 | `skills-12` → `skills-16` |
| plugin.json description「12 lifecycle skills」 | → `"16 lifecycle skills"` |
| marketplace.json description「12 skills」 | → `"16 skills"` |

#### 3.6 CHANGELOG v2.7.0 entry

forward-progress framing（**不**寫成「reversal of v2.0」），含：
- Added: 4 fallback skills + dispatch-config Methodology chains
- Changed: orchestrator skills now consult dispatch-config; READMEs reorganized; brand tagline clarified
- Migration: 顯式 callout 給「v2.6.0 + 自己刪過 CLAUDE.md 路由 entry 期待這 4 個 skill 不存在」的使用者 — 看 settings.json `disabledSkills` 範本

#### 3.7 版本 bump 2.5.0 → 2.7.0

跳過 2.6.0 補 manifest drift。**不**回頭補一個 v2.6.0 entry（CHANGELOG 已有 v2.6.0 entry 但 plugin.json 沒跟，現在直接以 2.7.0 涵蓋 catch-up + new ship）。

### Out of scope（明確排除）

- 不動 `agents/planner.md`、`agents/debugger.md`、`agents/reviewer.md` — agent 層 v2.4.0 起已 plugin-agnostic
- 不動 12 hooks 本體（只動 `hooks/hooks.json` 的 description 字串以同步版本）
- 不寫 dispatch-config 解析器程式碼
- 不碰 superpowers plugin 本身
- 不改變 v2.0 的 rule-setter 大方向（autopilot 仍以編排為主）；本計畫是「加上 self-sufficient mode」而非「廢除 rule-setter mode」
- 不做 runtime「偵測 superpowers 是否安裝」程式 — 用 chain + Claude routing 處理
- 不採用 catalog 內省機制（§2 已說明）

---

## 4. Phases

### Phase 1 — 補回 4 個 fallback skill（拆 3 commits）

**輸入：** `f08812c^` 的 5 個檔案（4 SKILL.md + team-tactics.md）

**子任務（per Impl reviewer M5 拆分）：**

- **1.1 純還原檔案**：`git show f08812c^:skills/<X>/SKILL.md > skills/<X>/SKILL.md`（4 支 + team-tactics.md）
  - Commit: `restore(skills): re-add debug, test-strategy, team, profiling from f08812c^`
- **1.2 在 4 支 body 加 Coexistence 段**：每支緊接在 frontmatter 之下加（**模板 + per-skill 必填內容**，避免實作風格漂移）：
  ```markdown
  ## Coexistence with Superpowers

  This skill is autopilot's standalone fallback for <X>. If the `superpowers`
  plugin is installed, you may prefer `superpowers:<Y>` — this skill and the
  superpowers equivalent both work; `.claude/dispatch-config.md`'s
  `## <Chain>` chain controls which one orchestrator skills (ceo-agent /
  finish-flow / quality-pipeline) dispatch.

  Differences worth knowing:
  - <skill-specific note>
  ```

  Per-skill 必填差異說明（避免 4 支實作風格漂移）：

  | Skill | superpowers 對應 | 必填差異說明 |
  |---|---|---|
  | `debug` | `superpowers:systematic-debugging` | autopilot version is evidence-first (tool → log → code) with explicit Three Red Lines integration; superpowers version is more general-purpose with broader hypothesis-driven framing |
  | `test-strategy` | `superpowers:test-driven-development` | **TDD ≠ test-strategy** — superpowers TDD focuses on「先寫測試再寫實作」cycle；autopilot test-strategy 涵蓋 test pyramid / baseline 守則 / failure investigation funnel，與 TDD 是正交主題 |
  | `team` | `superpowers:dispatching-parallel-agents` | superpowers 偏重 dispatch 機制；autopilot team 偏重 allocation decision tree（何時組隊 / role 選擇 / 依賴分析）。並行**派發**請見 dispatch-config `## Parallel Dispatch` chain |
  | `profiling` | （無等價，CHANGELOG 已承認） | superpowers 沒有專屬 profiling skill；本支是 only methodology entry point for performance investigation |
  - Commit: `docs(skills): coexistence subsections for restored skills`
- **1.3 修補 stale ref**：
  - `team-tactics.md:5,39` 的 `plan-bootstrap.js` 段改寫成中性敘述（autopilot 沒這個 script）
  - 4 支 See Also 列表交叉檢查（debug/profiling 互引）
  - Commit: `fix(skills): drop stale plan-bootstrap.js refs in team-tactics`

**檢核：**
- `ls skills/{debug,test-strategy,team,profiling}/SKILL.md skills/team/references/team-tactics.md` 全部存在
- `grep -l "## Coexistence with Superpowers" skills/{debug,test-strategy,team,profiling}/SKILL.md` 應全列出
- `grep -n "plan-bootstrap" skills/team/references/team-tactics.md` 應空

**Quality gate：** parallel-reviewer 對 4 支 Coexistence subsection 措辭 + 內文完整性

---

### Phase 2 — 擴充 dispatch-config.md（**drop mode**）

**動作：**
1. `project-config-template/dispatch-config.md` 加 Methodology Preferences 區段（4 chains，每條附 fallback semantics 註解）
2. **不**加 `mode` 欄位
3. 加 Fallback semantics 段（first-available-wins; plugin not installed 自動 skip; native 永遠保底）

**檢核：** `grep -c "^### " project-config-template/dispatch-config.md` ≥ 6（Parallel Dispatch + Code Review + 4 methodology）

**Quality gate：** parallel-reviewer 對 chain 是否覆蓋所有派發點 + 註解是否清楚

**Commit：** `feat(config): expand dispatch-config with methodology chains`

---

### Phase 3 — orchestrator skill 接 `!cat` preprocessor + 改寫 code-review reference

**子任務：**

- **3.1 加 preprocessor 行** 到 5 個 SKILL.md 頂部：
  ```markdown
  <!-- Project dispatch chains (optional) -->
  !`cat .claude/dispatch-config.md 2>/dev/null || true`
  ```
  目標檔：quality-pipeline / ceo-agent / finish-flow / think-tank / think-tank-dialectic
- **3.2 改寫** `skills/quality-pipeline/references/code-review.md:80-95`：
  - 刪除「quality-pipeline does **not** runtime-detect which reviewers are available」段
  - 改成：「reviewer 依 `.claude/dispatch-config.md` 的 Code Review chain 順序試 — 第一個 available 用」
  - 保留 `autopilot:reviewer` 為 default chain head
- **3.3 dev-flow** 同款 preprocessor + Session Rules table 補 row：
  - 頂部加 `!`cat .claude/dispatch-config.md 2>/dev/null || true`` preprocessor（與 quality-pipeline 等 5 支對稱，避免 r2 reviewer 指出的「prose pointer 在 context 壓力下會被忽略」問題）
  - Session Rules table 加 `| Methodology dispatch | .claude/dispatch-config.md | ... |` row 作為 human-readable index pointer，與 preprocessor 並存（preprocessor 注入內容，table 提示語意角色）
  - 此調整將原本 v0「dev-flow 不接 preprocessor」的設計拉成對稱，response to r2 spot-check
- **3.4 既存 prose 同步**：ceo-agent / think-tank / think-tank-dialectic 內現有 prose 已在 partial 改成 config-driven，r1 確認無更動需求；本 phase 只加 preprocessor

**檢核：**
- 5 個目標 SKILL.md 頂部都含 `!`cat` 行
- `grep -c "runtime-detect" skills/quality-pipeline/references/code-review.md` 應為 0
- `grep -c "dispatch-config" skills/dev-flow/SKILL.md` 應 ≥ 1

**Quality gate：** parallel-reviewer 對 preprocessor 位置（必須在 frontmatter 之後立刻出現）+ code-review.md 改寫的 prose 一致性

**Commit：** `feat(skills): wire orchestrator skills to dispatch-config via !cat preprocessor`

---

### Phase 4 — Docs + Brand + CHANGELOG + 版本

**子任務：**

- **4.1 plugin.json + marketplace.json**：
  - 版本 2.5.0 → 2.7.0（兩檔同步）
  - description 「12 skills」→「16 skills」
  - tagline 從「Sets the rules; Superpowers executes」改為「Self-sufficient orchestration with first-class Superpowers coexistence」
- **4.2 README.md** + **README.zh-TW.md**：
  - 徽章 version-X.X.X → 2.7.0（**zh-TW 補 drift**：當前在 2.5.0）
  - skills-12 → skills-16
  - `README.md:65-66` rule-setter example 中性化
  - `README.md:309` v2 removal 段改寫
  - `README.md:393` + `README.zh-TW.md:386` 拆 `## Hooks (v2.5.0)` → `## Hooks`
  - 新增 `## Superpowers Coexistence` 段（緊接 The Problem / The Solution 後，UX S1）：
    - 三情境列表
    - dispatch-config 連結
    - settings.json `disabledSkills` 範本
    - migration callout（給 v2.6.0 升級者）
- **4.3 hooks/hooks.json**：`(v2.6.0)` → `(v2.7.0)`
- **4.4 CHANGELOG.md** 新增 v2.7.0 entry（newest-first，**置頂於 v2.6.0 之上**）：
  - Added: 4 fallback skills + Methodology chains in dispatch-config
  - Changed: orchestrator preprocessor wiring + READMEs reorganized + brand tagline + manifest drift catch-up
  - Migration: 給 v2.6.0 + CLAUDE.md 路由刪過該 4 keyword 的用戶寫明回退方法

**檢核：**
- `grep -rn "2\.5\.0\|2\.6\.0" --include="*.json" --include="*.md" | grep -v CHANGELOG | grep -v "docs/plans/" | grep -v "_archive" | grep -v "docs/projects/2026-04-12"` 應空
- `grep -c "skills-16\|16.skills" README.md README.zh-TW.md plugin.json marketplace.json` 4 個檔案全有
- README 雙語版本徽章 = `version-2.7.0`
- `grep -c "## Superpowers Coexistence" README.md README.zh-TW.md` 應為 2

**Quality gate：** parallel-reviewer 對 README 雙語一致性 + CHANGELOG migration callout 清晰度 + tagline 與 plan §2 三層架構一致

**Commits：**
- `chore: bump version to 2.7.0, sync manifests`（4.1 + 4.3）
- `docs(readme): superpowers coexistence section + brand revision`（4.2）
- `docs(changelog): v2.7.0 entry`（4.4）

---

### Phase 5 — Smoke test + 整合驗證

**動作：**
1. **No-hardcode grep**：`grep -rn "superpowers:" skills/ .claude/ project-config-template/ | grep -vE "^[^:]*:[0-9]+:[[:space:]]*[#-]|^[^:]*:[0-9]+:.*\\[\\[|^[^:]*:[0-9]+:.*\\bSee Also\\b|^[^:]*:[0-9]+:.*\\bchain\\b"` — 應只剩 chain 範例 / See Also / 註解（**tighter filter** per Arch S1，不用「fallback」當白名單字）
2. **Coexistence presence**：`grep -l "## Coexistence with Superpowers" skills/{debug,test-strategy,team,profiling}/SKILL.md` 4 支全列
3. **Preprocessor presence**：`grep -l '!`cat .claude/dispatch-config.md' skills/{quality-pipeline,ceo-agent,finish-flow,think-tank,think-tank-dialectic,dev-flow}/SKILL.md` 6 支全列
4. **Catalog stability** (defensive)：`grep -rn "superpowers:" agents/ 2>/dev/null` 應只命中 `agents/README.md:70`（既有的「we don't hardcode」聲明）+ `agents/planner.md:121`（同款宣告）；不得新增 hardcoded ref（Arch S2 regression check）
5. **Version sync**：見 §3.5 + Phase 4 grep
6. **Schema parseability**：`!cat project-config-template/dispatch-config.md` 在 Claude 內注入後 heading 階層保持，不需另外 parser

**Phase 5 step 7（明確 defer）：** **Scenario B routing dogfood** — 模擬無 superpowers 環境下使用者打「help me debug a crash」是否 route 到 `autopilot:debug`。**Plugin 重啟需要才能生效**，per `.claude/dev-flow-config.md:121` 「Plan Phase 5 runtime dogfood is always deferred to the next session」。在 §7 success criteria 明確標為 **「deferred — next-session dogfood after user restart」**。

**Quality gate：** 不需 review，此 phase 是驗證之前 phase

**Commit：** （無 — 純驗證 phase；若 grep 發現問題則回 Phase 1-4 patch）

---

## 5. 風險與緩解

| # | 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|---|
| 1 | 4 fallback skill 與 superpowers 對應 skill 同時存在時 Claude routing 命中 autopilot 那支（description keyword 比較多） | 高 | 中 | 接受兩者皆能跑（功能 OK）；**disambiguation surface = dispatch-config Methodology chains**，orchestrator 真正派發時走 chain；情境 C 用戶要硬切去 settings.json `disabledSkills` |
| 2 | 24-skill catalog（autopilot 16 + superpowers 8）造成情境 A 用戶 trigger collision / 心智負擔 | 中 | 中 | README Superpowers Coexistence 段明寫兩者並存的判別準則 + settings.json 範本；dispatch-config chain 是 orchestrator 用，不是 catalog UI 縮減手段（前者不能 hide skill） |
| 3 | `!cat` preprocessor 在 5 SKILL.md 頂部 + 既有 preprocessor 共存時順序錯亂 | 低 | 低 | 與既有 quality-gate-config preprocessor 同款 syntax；放在 frontmatter 之後 / heading 之前 |
| 4 | `code-review.md:80-95` 改寫後與 quality-pipeline 主文 step 流程不一致 | 中 | 中 | Phase 3.2 同 phase 處理；reviewer 跑 Phase 3 quality gate 時須對齊兩檔 |
| 5 | team-tactics.md 從 f08812c^ 拉回後 `plan-bootstrap.js` ref stale | 中 | 低 | Phase 1.3 顯式處理；不上 commit 1.1 commit 1.3 之前不算完成 |
| 6 | 版本 bump 跨太多檔，遺漏處 grep 不乾淨 | 中 | 中 | Phase 4 grep 為 quality gate；明確列出 8 個落點（plugin.json / marketplace.json / 2 README badge / 1 README hooks header / 1 zh-TW hooks header / hooks/hooks.json / CHANGELOG）；非 _archive 的 docs/projects/2026-04-12 在 grep 白名單 |
| 7 | tagline 改寫後 r1 UX 通過但實際使用者覺得「失焦」 | 低 | 低 | 標語是判斷題，無法消除主觀；UX reviewer 已建議方向且通過 r1 |
| 8 | brand 改寫被誤判為「v2.0 rule-setter 失敗」 | 中 | 低 | CHANGELOG migration callout 明寫「rule-setter 仍是預設方向，本版加上 self-sufficient mode」forward-progress framing |
| 9 | 本計畫進行中其他 PR 改了同檔案造成 merge conflict | 低 | 低 | feat branch 從最新 develop 開；merge 前再 rebase |
| 10 | `!cat` preprocessor 在 think-tank/dialectic 注入「整份 dispatch-config」造成 prompt 膨脹 | 低 | 低 | dispatch-config 文件本體 < 4KB；prompt 影響微小 |

---

## 6. Rollback

每個 Phase 內按 §4 拆好的 commit 可單獨 revert。整體 rollback：

```bash
git checkout develop
git branch -D feat/v2.7.0-superpowers-coexistence
```

部分 rollback（保留 Phase 1-2、丟 Phase 3+）：

```bash
git reset --hard <phase-2-last-commit-sha>
```

**Phase 4.1 + 4.3 已在 §4 安排為單一 commit**（`chore: bump version to 2.7.0, sync manifests`），rollback 單位即為該 commit，無需另外 split-rollback 警語。若該單一 commit 被 revert，plugin.json/marketplace.json 會回到 2.5.0 而 README EN 仍在 2.7.0；rollback 操作者須一併處理這個 drift（或同時 revert Phase 4.2 README commit）。

---

## 7. 成功條件

L-5.1 Final Goal Review 階段驗證以下 7 點（每點需具體證據）：

1. **情境 B 可用**：4 個 fallback skill 存在 + body 有 Coexistence subsection
   證據：`ls -la skills/{debug,test-strategy,team,profiling}/SKILL.md` + `grep -l "## Coexistence with Superpowers" skills/{debug,test-strategy,team,profiling}/SKILL.md` 4 支全列
2. **情境 A 不退化 + agents/ 無 regression**：
   - `grep -rn "superpowers:" skills/ .claude/ project-config-template/` 後 step 指示中無殘餘 hardcoded ref（只剩 chain / See Also / 註解）
   - `grep -rn "superpowers:" agents/` 只命中既有「we don't hardcode」聲明
3. **dispatch-config.md schema 完整**：6 條 chains + Fallback semantics 段；無 `mode` 欄位
   證據：`grep -c "^### " project-config-template/dispatch-config.md` ≥ 6；`grep -c "^mode:" project-config-template/dispatch-config.md` = 0
4. **5 個 orchestrator skill 接上 preprocessor**：
   證據：`grep -l '!`cat .claude/dispatch-config.md' skills/{quality-pipeline,ceo-agent,finish-flow,think-tank,think-tank-dialectic}/SKILL.md` 全列
5. **code-review.md 同步改寫**：
   證據：`grep -c "runtime-detect" skills/quality-pipeline/references/code-review.md` = 0
6. **版本 + brand sync 乾淨**：
   - plugin.json / marketplace.json / README EN / README zh-TW 全為 2.7.0
   - skill count badge 16 / 16 / "16 skills" / "16 skills"
   - tagline 兩處改完
   - `grep -rn "2\.5\.0\|2\.6\.0" --include="*.json" --include="*.md" | grep -v CHANGELOG | grep -v "docs/plans/" | grep -v "_archive" | grep -v "docs/projects/2026-04-12"` 應空
7. **CHANGELOG v2.7.0 entry 完整**：Added/Changed/Migration 三段；含 v2.6.0 manifest catch-up 說明 + scenario B 用戶 migration callout
   證據：`sed -n '/^## v2.7.0/,/^## v2.6.0/p' CHANGELOG.md`

**Deferred to next-session dogfood**：scenario B routing 實測（需重啟 Claude Code 載入新 skill）— 在 L-5.6 learn 階段記錄。

---

## 8. Handoff

Next consumer: SEQUENTIAL_DISPATCH
Routing rationale: Phase 1 → 2 → 3 → 4 → 5 線性依賴。Phase 1 拆 3 commits，但仍在同 phase 內。
Remaining risks: 見 §5。

---

## 9. Review Loop History

### r1 (2026-05-14, 3 parallel reviewers — verdict: approve-with-revisions)

**Convergent findings (all 3 reviewers)：**
1. description「prefer superpowers」措辭無效 — description 是 routing trigger, 不是 policy 句 → **改為 body Coexistence subsection**
2. 3 層機制有重疊 → **drop `mode` 欄位**，保留 description / dispatch-config / settings.json 三層
3. plugin.json / marketplace.json / README zh-TW 版本飄移 + tagline 矛盾 → **同 ship 一起修**

**Architecture reviewer 獨有：**
- C1: Phase 3 從「prose」改為「`!cat` preprocessor」 — 與既有 quality-gate-config 注入機制同款
- C2: 承認 catalog 內省為「fourth coexistence mechanism」但不採用，§10 Q5 完整討論
- M3: autopilot 自家 `.claude/finish-flow-config.md` + `.claude/quality-gate-config.md` 須列入 scope（partial 已修但 plan 沒認領）
- M4: Phase 1 ls 檢核補 team-tactics.md

**UX reviewer 獨有：**
- C1: tagline 與計畫衝突 → 改寫
- C2: README onboarding for scenario B 不可見 → Superpowers Coexistence 段提前到 The Problem / The Solution 後
- S3: README:65-66 + README:309 兩處 v2 mantra 文字必須同步修
- S4: 24-skill catalog 風險加入風險表
- M4: v2.6.0 用戶升級的 migration callout

**Implementation feasibility 獨有：**
- C1: `code-review.md:80-95` 與 chain dispatch 直接矛盾 → 同 phase 改寫
- C2: description 改寫是 L-size routing change（per autopilot 自家 dev-flow rule），4 支描述改一個 commit 太粗 → **接受 acknowledged exception**（L-loop 是 project 層級，不在 description 層重複）
- M1: Phase 4 grep 漏 hooks/hooks.json + docs/projects/2026-04-12 非 _archive → §3.5 + §7 grep 補白名單
- M2: skills 徽章 12 → 16 + plugin.json/marketplace.json description「12 skills」→「16 skills」
- M5: Phase 1 拆 3 commits (1.1 restore / 1.2 coexistence subsection / 1.3 stale ref cleanup)
- S1: team-tactics.md `plan-bootstrap.js` ref 是 stale → Phase 1.3 處理
- S4: test-strategy description 從 f08812c^ 來只有單句，加 Coexistence subsection 時順手補強 routing keyword surface

**Revisions applied to plan：** §1.4（既存 drift 列表）、§2（drop mode + 4 修正點）、§3（scope 大幅擴張到 9 大類）、§4（Phase 1 拆 3 commits / Phase 3 改 preprocessor / Phase 4 含 brand revision / Phase 5 step 4 顯式 defer）、§5（風險加 2、5、6、8、10）、§7（成功條件擴 5→7 點 + 明確 deferred 項）、§10（新增 Q5 catalog introspection）。

### r2 (2026-05-14, 1 focused spot-check reviewer — verdict: approve-with-minor-revisions)

15 條 r1 finding 逐條 ✅ 通過。新發現 6 條 tightening items（皆 inline 修完）：

1. Phase 1.2 Coexistence subsection 模板過鬆 → 加 per-skill 必填差異表，避免 4 支實作風格漂移
2. Phase 3.3 dev-flow 不接 preprocessor 的設計與 Arch C1「prose pointer 會被忽略」矛盾 → 拉成對稱，dev-flow 也接 preprocessor，目標檔從 5 個 → 6 個
3. §6 Rollback 措辭與 §4 commit 結構不一致 → 改寫
4. §5 風險 #1 mitigation 空欄 → 補「dispatch-config Methodology chains 為 disambiguation surface」
5. Tagline 採用 r2 reviewer 建議「Standalone-capable orchestration that coexists with Superpowers」（vs 原 self-sufficient 版本），與 marketplace.json 措辭收斂
6. Q6 rationale 補述「L-loop 施加在 plan layer，不在 per-description layer」

revisions 全部 inline 完成，本 plan 進入實作階段。

### r3+ (phase reviews)

每 Phase finish 時觸發。Phase 1/2/3/4 quality gate 各 dispatch 1 個 focused reviewer。

---

## 10. 設計選擇 Q&A

**Q1：為何不直接 hardcode `if superpowers exists` 的偵測？**
A：Claude Code skill 載入是 plugin manifest 層，autopilot 無法在 runtime「探測 superpowers 是否可用」程式碼。dispatch-config chain 機制是同等效果的 declarative 表達 — 列出偏好，未安裝者 Claude routing 自動 skip。實作上等同 catalog 內省（見 Q5），但維護成本低於在每個 dispatch point 重複內省指令。

**Q2：為何 fallback skill 用 body Coexistence subsection 而不是 description？**
A：r1 三 reviewer 共同指出 Claude routing 是 keyword scoring，description 中「prefer superpowers」這種 policy 句子不影響 scoring，反而降低 scenario B 用戶的 trigger 機率。description 留 f08812c^ 原版 keyword-rich 措辭以支持情境 B routing；coexistence 訊息放 body — 使用者讀 skill docs 時看得到，但 routing 不被影響。

**Q3：為何 dispatch-config.md 不做成 JSON / YAML？**
A：autopilot config injection pattern 一向是 markdown（dev-flow Session Rules + quality-pipeline 用 `!cat .claude/X.md`）。換 JSON 要動 dev-flow 注入機制，scope 爆增。Markdown 對 Claude 同樣 parse 可行。

**Q4：為何 4 個被砍 skill 不做成 reference docs（前回討論的 option B）？**
A：reference docs 沒 routing entry point。使用者打「help me debug a crash」時，Claude 從 skill catalog 找，找不到就 fall through 到 general behavior。獨立 skill 才能被 routing 命中。

**Q5（r1 新增）：為何不採用 catalog 內省 (Arch reviewer C2 提出的 fourth mechanism)？**
A：Arch reviewer 指出 Claude 在 session 內可內省自己 catalog 內有哪些 skill — 對於「`autopilot:reviewer` vs `superpowers:code-reviewer`」這類選擇，理論上可指示 orchestrator「先檢查 `superpowers:X` 是否在 catalog 內，再決定 dispatch」。本計畫不採用因為：(a) chain ordering + plugin not-installed 自動 skip 已達等效效果；(b) 內省指令需要在每個 dispatch point 重複寫，維護成本高；(c) 內省結果在不同 session 啟動時點 (warm vs cold) 不穩定，靜態 chain 反而提供 deterministic 行為。**保留為未來 v3 架構選項**，若 chain 機制證明不夠用再升級。

**Q6（r1 新增）：description 改寫是 L-size routing change，為何 plan 用一個 phase commit 涵蓋 4 個 skill？**
A：autopilot `.claude/dev-flow-config.md:118` 規定「Skill description changes are L-size」針對 description **改變**。本計畫 description 是 **restore from f08812c^ verbatim**（不是改），routing 行為與 v1.x 時期完全一致，沒新增 keyword 競爭層；新增的 keyword 競爭層來自「4 skill 從不存在變存在」這個 catalog-level 變化，已是本 L-size 計畫的本質。**L-loop 的施加層次是 plan layer（本計畫），不是 per-description layer** — 4 個 restore 共享同一個 L-loop 的 plan review (r1 + r2) + Phase 1 quality gate + L-5.2 pre-merge review，已涵蓋 routing-risk surface；不需要再為每支 description 開獨立 L-loop。本計畫 acknowledged exception 但不細分。
