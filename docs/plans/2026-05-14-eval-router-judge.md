# Eval Router-Judge — High-Fidelity Routing Precision Harness

**日期：** 2026-05-14
**狀態：** 📋 Proposal — pending review / sequencing
**Size：** L (proposal)
**Trigger：** B+A Fix-cycle 收尾跑 `scripts/run-eval-batch.sh` 觀察到既有 proxy 是 description-in-isolation test，不是 routing precision 量尺（詳見 `2026-05-14-powerloop-learnings.md` §6 eval-proxy limitation 章節）

---

## 1. 背景與動機

### 1.1 既有 eval proxy 量到什麼

`skill-creator` 的 `run_eval.py`（autopilot 用 `scripts/run-eval-batch.sh` 包起來呼叫）做的事：

1. 對每 query，在 test project 寫一個 `.claude/commands/<skill>-skill-<random>.md`（只放 description，**無 body**）
2. spawn `claude -p <query>` 帶 `--output-format stream-json --include-partial-messages`
3. 監聽 stream event `content_block_start` of `tool_use`，看是否 invoke 那唯一一個 command

實測：16 skill × ~10 case，15/16 skill recall = 0%、1/16 recall = 20%。所謂「2.5% baseline」就是這個 isolation-test floor。

**這 measure 的是**：單一 description 在零干擾條件下被選中的機率（description attractiveness）。
**這 measure 不到的是**：
- Real-world routing precision（16+ skill 競爭）
- Description disambiguation（兩個 skill description 重疊時 routing 對不對）
- Routing chain（dispatch-config.md 路徑是否生效）

### 1.2 現況 workaround

- D-1 / D-2 manual scenario walks（9-query per scenario）— 高保真但純人工，無 CI integration
- `run-eval-batch.sh` parametrize（M2 已 ship）— 可跑 `RUNS_PER_QUERY=5 MODEL=opus` 降 stochasticity，但 measure 的目標不變
- 兩者並用，但都有缺口

### 1.3 為何現在處理

不是急事。但 D-1/D-2 已揭露 v2.7.0 真實 routing ambiguity（test-strategy vs TDD、profiling vs perf-debug）— 證明 description 競爭是真議題、isolation test 抓不到。下次 description tightening fix 需要量化證據時，會反覆撞這道牆。

---

## 2. 提案 — router-judge harness

### 2.1 核心設計

獨立 Python harness（不靠 `claude -p` subprocess），用 Anthropic API 直連：

```python
# Pseudocode
SKILLS = load_all_descriptions("skills/*/SKILL.md")  # 16 skills
TEST_CASES = load_unified_eval_set()  # union of all 16 skill evals, 163 cases

system_prompt = f"""You are a skill router. Given a user query, decide which
of the following autopilot skills (if any) best matches.

Available skills:
{format_skills(SKILLS)}

Output a single line: <skill-name> | none
Do NOT explain. Just the choice."""

for case in TEST_CASES:
    response = anthropic.messages.create(
        model="claude-opus-4-7",
        system=system_prompt,
        messages=[{"role": "user", "content": case.query}],
    )
    predicted = response.content[0].text.strip()
    actual_correct = case.expected_skill  # or "none"
    log(case, predicted, actual_correct)

compute_confusion_matrix()  # precision, recall, F1 per skill
```

### 2.2 跟 proxy 的對照

| 軸 | 既有 proxy | router-judge |
|---|---|---|
| **測什麼** | description in isolation triggers? | 16 skill 競爭下哪個被選中? |
| **catalog 規模** | 1 description | 16 descriptions（real world） |
| **判斷單位** | per-skill | per-query → per-skill aggregated |
| **能抓的 bug** | description 寫得太弱、太廣 | description disambiguation, 邊界錯位, dispatch chain |
| **執行成本** | $6 (sonnet, 1 run) | ~$10-20 (opus, 1 round) |
| **複雜度** | shell + subprocess | 獨立 Python + API client |

### 2.3 metric

per skill：
- **precision**: 預測為 X 的 case 中，實際正確的比例
- **recall**: 應該為 X 的 case 中，被正確預測的比例
- **F1**: 2 × p × r / (p + r)

aggregate：
- **macro-F1**: 16 skill F1 平均（無權重）
- **routing accuracy**: 整體 query 正確命中率
- **confusion matrix**: 哪兩個 skill 最常被混淆 → 直接 actionable for description tightening

---

## 3. Scope（phases）

### Phase 1 — Spec + unified eval set + diagnose why proxy hits 0%
- 統一 eval set 格式：每 case 標 `expected_skill` (或 `none`)
- 從現有 16 個 `<skill>-evals.json` merge + 補對立 case（quality-pipeline vs dev-flow vs ceo-agent 三方混淆題）
- 預期：~200-300 cases unified
- **附帶根因調查**：S3 baseline 顯示既有 proxy 對 autopilot skill recall 0% (runs=5 × opus)。Phase 1 順手診斷為什麼，假設清單：
  - 命令檔重命名（`<skill>-skill-<random>`）阻斷 description 內部對 `autopilot:*` 的引用 resolve
  - Body-less 命令檔讓 Claude 不夠 confident 觸發
  - Description 「Not for: → debug」之類 cross-skill reference 在 isolation 中失效
  - `claude -p` 預設不啟用 plugin commands（需 flag？）
  - 找出來 router-judge 可避開同類陷阱

### Phase 2 — Implementation
- `scripts/run-router-judge.py`（新檔）
- 依賴：`anthropic` Python SDK + Python 3.11+
- CLI：`python3 scripts/run-router-judge.py --eval-set <path> --model claude-opus-4-7`
- Output：JSON with confusion matrix + per-skill p/r/F1 + overall macro-F1 + routing accuracy

### Phase 3 — Baseline + CI integration
- 跑一次設定 reference baseline
- 提供 `--compare-baseline <path>` flag 計算 delta（哪些 case 從 PASS → FAIL）
- 不強制 CI；先當 pre-release-bump 的高保真 check（類似 D-1/D-2 scenario walks 的自動版）

### Phase 4 — Confusion-matrix-driven description tightening
- 用 Phase 2 的 output 找最常 confused 的 skill pair
- 對該 pair 的 description 做 tightening（類似 v2.7.1 `bae3f43` 的 3 條 ambiguity fix）
- Re-run baseline 看 F1 是否升

---

## 4. Acceptance

| 項 | 條件 |
|---|---|
| Unified eval set 存在 | `skill-creator-workspace/router-judge-eval.json`，>= 200 cases，每 case 有 `expected_skill` |
| Harness 可跑 | `python3 scripts/run-router-judge.py --eval-set ... --model claude-opus-4-7` 跑完，輸出含 confusion matrix |
| Baseline 設定 | 跑一次存進 `skill-creator-workspace/router-judge-baseline/<date>.json`，含 per-skill F1 與 overall accuracy |
| 跟 proxy 共存 | 既有 `run-eval-batch.sh` 不動（保留 description-isolation check 作為輕量 regression floor）；router-judge 是高保真補充而非取代 |
| 文件化 | `scripts/run-router-judge.py` head comment 區分兩者目的；README 加一行說明 |

---

## 5. Out-of-scope

| 項 | 為何不做 |
|---|---|
| 取代 `run-eval-batch.sh` | proxy 雖然 limited，是 cheap regression floor，留著無害；router-judge 是補充不是替代 |
| Auto-update SKILL.md description from confusion matrix | LLM-suggested edit 風險高，仍需人工 review；先用 confusion matrix 當 hint 即可 |
| CI 強制 | 一次跑 ~$15+，每 PR 跑成本高；先當 release-bump 前的 manual check |
| Multi-language router-judge | 暫只支援 EN + 中英混 description；future 再評估 |

---

## 6. Sequencing 建議

| 時機 | 行動 |
|---|---|
| **不急** | 先當 proposal 擱著 |
| **下次出現 routing ambiguity 真痛點時** | 啟動 Phase 1 |
| **每次 release-bump 想自動量化 description quality 時** | 啟動 Phase 2-3 |
| **連續觀察 2-3 次 description tightening 都靠 manual 判斷時** | 啟動 Phase 4，把 confusion matrix 作為 tightening driver |

---

## 7. Inspired By / 對照組

| 來源 | 借什麼 |
|---|---|
| **autopilot 既有 `skill-creator-workspace/`** | eval set 格式（query / should_trigger / note）作為 Phase 1 unified set 起點 |
| **autopilot `bae3f43` description tightening** | 證明 ambiguity-driven description fix 是高 ROI；router-judge 把這流程從「人手檢」升到「confusion-matrix-driven」|
| **claude-powerloop-plugin blind dispatch principle** | 不直接借用；但「outcome-blinding 防 anchoring」精神在 Phase 2 設計中應用 — router-judge 不該知道 expected_skill，只看 query → 純黑盒判斷 |

---

## 8. 變更歷史

| 日期 | 事件 |
|---|---|
| 2026-05-14 | Proposal written after B+A Fix-cycle eval-proxy surface |
