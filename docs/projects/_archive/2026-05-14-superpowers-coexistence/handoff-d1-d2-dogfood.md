# Handoff — D-1 + D-2 Scenario Dogfood（接續 v2.7.0/v2.7.1 ship 後）

**建立**：2026-05-14
**目的**：context clear 後新 session 從這個檔接續執行
**先決 / 環境**：autopilot 已 dev-mode 安裝，superpowers 還沒裝
**現況**：`develop` ahead `origin/develop` 18 commits（未 push）

---

## Status Update 2026-05-14 後續（重要 — 計畫變更）

原本 handoff 假設「同 session install superpowers + 跑 D-1 + D-2」。新 session evaluate 後改採方案：
**dogfood 移到另一台機器（autopilot + superpowers 都已正式 install）跑**，避開 §「已知陷阱 #1」的 session-install 污染。

新 session 在這台 commit 了 2 件事再 push develop：
1. `chore(.claude): add dispatch-config.md for autopilot dogfood`（ef9a7b9）— D-1 Step 4 fixture 改成 committed config，省掉「另一台手建」
2. 此 status update + 修正 §Step 4「.claude 是 gitignored」的錯誤陳述

**對另一台機器 me 的影響**：
- Step 0：依舊跑（確認 dev-mode 鏈）
- Step 1：跳過（superpowers 已裝）
- Step 2：依舊跑（確認 catalog）
- Step 3：依舊跑 9 case
- Step 4：fixture 已存在於 repo，**不要重建**；直接觸發 quality-pipeline 觀察 chain 行為
- Step 5–7：依舊跑

---

---

## TL;DR — 給新 session 的 1 段話

autopilot v2.7.0 (superpowers coexistence) + v2.7.1 (routing tightening Fix) 已在 develop 完成 + merge + archive。Scenario B（無 superpowers）已 dogfood 過 9 個 query 通過。**剩下要做的是 D-1（scenario A）+ D-2（scenario C disabledSkills）兩個 dogfood，必須同 session 連續做，以免 superpowers install state 中斷**。本檔 §「立即執行步驟」是不需要重新理解上下文就能照做的清單。

---

## 上下文摘要（給新 session 快速進入狀況）

### 已完成

| 項目 | Commit | 概述 |
|---|---|---|
| v2.7.0 ship | `eb70999` (merge to develop) | 4 fallback skills 補回 (debug/test-strategy/team/profiling) + dispatch-config.md 6 chains + 6 orchestrator skills 接 `!cat` preprocessor + brand tagline 改寫 + 版本 2.5.0→2.7.0 sync |
| v2.7.0 archive | `42efa16` | docs/projects/INDEX.md 移到已完成；project dir 移進 _archive/ |
| Scenario B dogfood | `773edff` + `bae3f43` | 9 case routing 測試完成，記錄在 `docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md` |
| v2.7.1 description tightening | `bae3f43` | 3 個 SKILL.md description 根據 dogfood evidence 微調，single-reviewer approve-for-commit |
| Eval baseline | `5dd1bac` + `0ce2155` | 16/16 skill 全有 eval；2.5% 觸發率是 proxy 機制的 baseline，非退化 |

### 仍未完成（CEO 報告決議）

| Item | 決議 | 行動 |
|---|---|---|
| **D-1 scenario A dogfood**（有 superpowers）| 🟢 **DO NEXT** | 本次 session 執行 |
| **D-2 scenario C dogfood**（disabledSkills 硬切）| 🟢 同 session 接做 | D-1 完接做，**不可中斷 session** |
| **C-1** ship `autopilot:tdd` | 🔴 **REJECT — 永遠不 ship** | 不執行 |
| **C-2** sub-chain 範例 | 🟡 **改造為 D-1 deliverable** | 等 D-1 surface 真實 ambiguity 後依證據寫 |
| **C-3** vendor skill-creator | 🔴 **REJECT 結案** | 不執行 |

完整 CEO 報告 + 4-role think-tank deliberation 紀錄在本 session 對話歷史。決議邏輯：D-1 是 v2.7.0「coexists with Superpowers」標語的品牌完整性 gate，**必須做**；C-1/C-3 都沒過 user-pull 測試（沒人在問），全票 reject。

---

## 立即執行步驟

### Step 0 — 確認環境

```bash
cd /home/cookys/projects/autopilot
git log --oneline -3       # 應看到 bae3f43 / 773edff / 0ce2155
git status                  # 應 clean
git rev-parse --abbrev-ref HEAD  # 應為 develop
```

確認 plugin install state：

```bash
ls -la ~/.claude/plugins/cache/autopilot/autopilot/dev   # 應 symlink → /home/cookys/projects/autopilot
python3 -c "
import json
d = json.load(open('/home/cookys/.claude/plugins/installed_plugins.json'))
print(json.dumps(d.get('plugins', {}).get('autopilot@autopilot', []), indent=2))
"   # 應顯示 installPath: .../dev, version: dev
```

如果以上 OK → autopilot v2.7.0 已 dev-mode 掛載。**繼續 Step 1**。
如果壞了 → 跑 `bash /home/cookys/projects/autopilot/scripts/dev-setup.sh` 重建 symlink。

### Step 1 — 裝 superpowers（user 必須打 slash command）

```
/plugin marketplace add anthropics/claude-plugins-official
```

（如果已加過 marketplace 可跳過 — 用 `ls ~/.claude/plugins/marketplaces/` 確認）

```
/plugin install superpowers@claude-plugins-official
```

**注意**：marketplace 上的 plugin 名稱可能是 `superpowers` 或 `superpowers-skills` 之類，**新 session 先用 `/plugin marketplace list` 確認實際 plugin name**，再 install。

### Step 2 — 確認 catalog 是否兩個 plugin 都載入

session 重啟（或 `/reload-plugins`）後，看 system reminder 的 skill catalog 應同時有：
- `autopilot:debug`、`autopilot:test-strategy`、`autopilot:team`、`autopilot:profiling`（v2.7.0 新增）
- `superpowers:systematic-debugging`、`superpowers:test-driven-development`、`superpowers:dispatching-parallel-agents`、`superpowers:code-reviewer` 等

如果 superpowers skill 沒出現 → 沒成功 install / load。**先解決這個再進 Step 3**。

### Step 3 — 跑 D-1：scenario A 9-case routing dogfood

讓使用者依序打以下 9 個自然語言 query。**對每個 query**，記錄：
- 預期 routing target（per v2.7.0 dogfood log）
- 實際命中哪個 skill（從你的 routing 直覺報告）
- Confidence (HIGH / MEDIUM / LOW)
- Verdict (✅ / ⚠️ / ❌)
- 是否與 scenario B 一樣？如果不同，原因是什麼？

**9 個 query**（與 v2.7.0 dogfood log 對齊）：

| # | Query | scenario B 結果 | 預期 scenario A 結果 |
|---|---|---|---|
| B-1 | `the webhook handler panics on certain payloads` | `autopilot:debug` | dispatch-config chain 把 `superpowers:systematic-debugging` 列在前 → 預期 superpowers 命中。若 chain 缺失 → 仍 autopilot:debug |
| B-2 | `the dashboard p99 went from 300ms to 2.5s` | `autopilot:profiling` | 沒 superpowers 等價，**仍 autopilot:profiling** |
| B-3 | `set up a testing baseline before I refactor` | `autopilot:test-strategy` | TDD ≠ test-strategy，**仍 autopilot:test-strategy** |
| B-4 | `this L feature has BE+FE+DB — parallel or sequential?` | `autopilot:team` | superpowers 是 dispatch 不是 allocation，**仍 autopilot:team** |
| amb-1 | `the test is flaky — passes locally fails on CI` | `autopilot:debug` | 若 chain 偏好 superpowers → `superpowers:systematic-debugging` |
| amb-2 | `the API got slower after we deployed yesterday` | `autopilot:profiling` | 同上，若 chain 偏好 → superpowers 命中 perf？需驗證 superpowers 有沒有 perf skill |
| amb-3 | `starting work on the cross-tenant feature — needs BE + FE + DB migration` | `autopilot:dev-flow` | **仍 autopilot:dev-flow**（dev-flow 沒 superpowers 等價） |
| neg-1 | `should we switch from REST to gRPC for internal services? want multiple perspectives` | `autopilot:think-tank` | **仍 autopilot:think-tank**（superpowers 無等價） |
| neg-2 | `let's TDD this — write failing test first then implement` | `autopilot:dev-flow` / none | **`superpowers:test-driven-development`** — 這個是 scenario A 修補 scenario B gap 的 case，**最關鍵**驗證 |

### Step 4 — 重要：建 `.claude/dispatch-config.md` 測 chain 行為

D-1 的核心是驗證 `!cat .claude/dispatch-config.md` chain delegation 確實生效。

**注意 — 2026-05-14 更正**：原 handoff 寫「autopilot 自家 .claude 是 gitignored，OK」是錯的；只有 `.claude/session-start-sha` 與 `.claude/knowledge/` 被 ignore，其他 `.claude/*-config.md` 都 tracked。Status Update 後本檔已 commit `dispatch-config.md`（ef9a7b9），所以另一台 me **不用重建**，直接拉 develop 就有。內容如下供參：

```markdown
## Code Review
- superpowers:code-reviewer
- autopilot:reviewer

## Parallel Dispatch
- superpowers:dispatching-parallel-agents
- native

## Methodology Preferences

### Debugging
- superpowers:systematic-debugging
- autopilot:debug

### Testing methodology
- autopilot:test-strategy
- superpowers:test-driven-development
```

然後當 user 打 query「help me debug this crash, run quality-pipeline first」之類觸發 quality-pipeline 的 query 時，觀察 quality-pipeline 是否確實把 dispatch-config 內容 `!cat` 注入到 prompt，並依 chain 順序 dispatch reviewer。

### Step 5 — 跑 D-2：scenario C disabledSkills cutoff

**必須同 session 接著做**（避免 superpowers 重 install）。

在 `/home/cookys/projects/autopilot/.claude/settings.json` 加：

```jsonc
{
  "disabledSkills": [
    "superpowers:systematic-debugging",
    "superpowers:test-driven-development"
  ]
}
```

`/reload-plugins` 後 catalog 應該砍掉那 2 個 superpowers skill。

跑 2-3 個 sentinel query 確認：
- B-1 `the webhook handler panics on certain payloads` → 應回到 `autopilot:debug`（superpowers 被砍）
- neg-2 `let's TDD this` → 應變回 `autopilot:dev-flow / none`（superpowers TDD 被砍）

### Step 6 — Append findings 到 dogfood log

把 D-1 + D-2 結果 append 進 `docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md`，標題 `## D-1 Scenario A Dogfood Results` + `## D-2 Scenario C Dogfood Results`。

**QA 提醒**：log 明文標示「verification log，不是 automated regression test」。

### Step 7 — 後續決定

- 若所有 routing 行為符合預期 → commit findings + 跟使用者 sync「v2.7.x 線穩定，可考慮 release tag」
- 若發現 routing bug → 進 Fix-size cycle（同 v2.7.1 routing-tightening 流程）
- 若發現新 ambiguous case 且可 eval → 進 3-commit Fix（Phase B eval + Phase A description + 新 Phase C 寫 sub-chain example）

---

## 已知陷阱（QA Devil 紅旗，必看）

1. **Session 中 install superpowers 會污染 state**。理想是「全新 session 直接裝兩個 plugin」。如果你進 session 時 autopilot 已掛但 superpowers 沒掛 — 裝完 superpowers 必須 `/reload-plugins`（也可能不夠，需 Claude Code 完整重啟）。`/reload-plugins` 在 v2.7.0 dogfood 時被觀察到報 「0 skills」=不會 refresh skill catalog；**只有 process restart 會**。
2. **Marketplace plugin 名稱可能不對**。打 `/plugin marketplace list` 確認 superpowers 在 `claude-plugins-official` 內的實際 plugin name 後再 install。
3. **dispatch-config chain delegation 是 v2.7.0 headline feature**。如果 D-1 發現 orchestrator 沒真的去讀 `.claude/dispatch-config.md`（chain 形同無效），這是 critical bug。優先修。
4. **disabledSkills 是 Claude Code 原生功能**。如果 D-2 失敗，多半是 Claude Code 本身 bug，autopilot 只能改 README。
5. **dogfood log 是 log 不是 test**。沒有 automated regression。每次重 verify 要重跑。

---

## 給 CEO 的 4 個 Pending Board 決定（接續用）

如使用者在新 session 想直接給 CEO 回答這 4 個問題，可貼這段：

> 1. 批准 C-1、C-3 駁回？
> 2. 批准「C-2 折入 D-1 deliverable」改造？
> 3. 批准 D-1+D-2 為立即下一個工作？
> 4. 時機：本 session 還是下個 session 跑 D-1？

預設答案（如果使用者直接說「照 CEO 報告做」）：
- Q1: 批准（雙駁回）
- Q2: 批准（折入）
- Q3: 批准
- Q4: 視當下 session 環境 — 若已有 plugin install 能力就本 session，否則下個

---

## 新 session 開頭 prompt 建議

複製這段給新 session 開始：

```
我要繼續 autopilot v2.7.x 的 D-1 + D-2 scenario dogfood。
完整 handoff 在 /home/cookys/projects/autopilot/docs/projects/_archive/2026-05-14-superpowers-coexistence/handoff-d1-d2-dogfood.md
請先讀那個檔，照「立即執行步驟」走。
```

---

## 檔案 inventory（context 快速 reload 用）

| 路徑 | 用途 |
|---|---|
| `CHANGELOG.md` (v2.7.0 entry, top) | 已 ship 的範圍 / migration callout |
| `README.md` + `README.zh-TW.md` `## Superpowers Coexistence` 段 | 三情境（A/B/C）的範例 config |
| `docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md` | scenario B 9 case 結果，append D-1/D-2 用 |
| `docs/projects/_archive/2026-05-14-superpowers-coexistence/README.md` | v2.7.0 ship 紀錄 |
| `docs/plans/2026-05-14-superpowers-coexistence.md` | 原 plan + r1/r2 review history |
| `project-config-template/dispatch-config.md` | chain schema 模板，Step 4 用 |
| `skills/{debug,test-strategy,team,profiling}/SKILL.md` | 4 個 v2.7.0 fallback skill 本體 |
| `scripts/run-eval-batch.sh` | 16-skill eval batch runner（用了 `superpowers:skill-creator`）|
| `scripts/dev-setup.sh` | dev-mode symlink 重建（壞掉時用）|
