# Test Suite for autopilot — From Manual Dogfood to Automated Coverage

**日期：** 2026-05-14
**狀態：** 📋 Proposal — pending sequencing
**Size：** L (multi-phase)
**Trigger context**：v2.7.3 retro-roundup 收尾發現「skill-creator 沒辦法測 hooks / scripts / docs」— 而我們今天 ship 的 18 個 commit 全部都是這三類。`quality-gate-config.md` 寫的「Test Command: N/A」是現況、但每次 ship 都靠 reviewer agent + manual synthetic stdin 來驗，疲勞 risk 與 catch-rate-decay risk 都實際存在。

---

## 1. 背景

### 1.1 autopilot 現況 = 0 automated test infrastructure

| Surface | 數量 | 「驗證」方式 | 自動化？ |
|---|---|---|---|
| Hooks（Node + bash）| 19（16 Node、3 bash）| Manual `echo {} \| node hook.js` synthetic stdin OR `bash hook.sh` | ❌ |
| Skills（SKILL.md）| 16 | `skill-creator-workspace/evals/*.json` LLM trigger eval | ⚠ description-isolation proxy（0% recall floor）|
| Agents | 3（reviewer, debugger, planner）| Manual Agent tool dispatch + output-contract spot-check | ❌ |
| Scripts | 2（dev-setup, sync-version）+ skill-creator script wrappers | Manual CLI run | ❌ |
| Plan→Impl drift | per-ship | `autopilot:reviewer` Agent dispatch（pre-merge review）| ⚠ manual |

### 1.2 痛點 evidence（今天就有 3 起）

| Date | Pain | Detection mechanism |
|---|---|---|
| 2026-05-14 v2.7.2 L-5.2 | `extractTurn` 漏傳 isNewest → newest turn 被 1.5KB 截 | reviewer agent manual dispatch |
| 2026-05-14 v2.7.3 L-5.2 | `sync-version.js` v1 hooks.json verifyFn looked for JSON `"version"` key（檔無此 key）+ cross-file atomicity 是謊 | reviewer agent **跑了 script** 重現 failure |
| 2026-05-13 routing tightening | description ambiguities | manual D-1/D-2 scenario walk |

**每次都靠 manual dispatch / human reviewer 抓到 — 沒有 sustainable detection mechanism**。retro 觀察項 T18「review-catch-rate < 50% 觸發 prompt redesign」其實依賴 catch-rate measurable，但沒系統紀錄。

### 1.3 為何不能等

- v2.7.x 已有 4 個 L-size ship；每次都至少 1 round catch 到 non-trivial bug。**review-as-test 過去 working 但仰賴 reviewer agent quality + dispatcher prompt + 我的 reading attention**
- 累計 hook 已 19 個，每次新 hook 都加 manual smoke test 負擔
- v2.7.3 sync-version.js 的 Critical 是「reviewer 自己跑 script 才抓到」— **若 reviewer 改 prompt 或忘記，這 class of bug 會漏網**

---

## 2. 設計 — Three-Layer Test Pyramid

```
                  ┌─────────────────────────┐
                  │   E2E / Dogfood (L3)    │  ← 低頻、高保真
                  │  manual + real session   │
                  │  e.g. real compact run   │
                  └─────────────────────────┘
              ┌────────────────────────────────┐
              │      Integration Tests (L2)     │ ← Claude Code subprocess
              │  per-hook synthetic invocation  │   或 mock harness
              │  per-script CLI dry-run + run    │
              └────────────────────────────────┘
        ┌──────────────────────────────────────────┐
        │           Unit Tests (L1)                │ ← 純函數，無 IO
        │  per-Node-hook 內部 helper function       │   `_test.js` sibling files
        │  e.g. truncateUtf8Safe / renderBlocks    │   Node built-in test runner
        └──────────────────────────────────────────┘
```

### 2.1 Layer 1 — Unit tests

**Target**：純函數 helpers in Node hooks（state-checkpoint.js 內 `truncateUtf8Safe` / `renderContentBlocks` / `parseTranscript`；intent-capture.js 內 `canonicalCwd` / `summarizeToolInput`）。

**Framework**：Node.js built-in test runner（`node:test`，Node 18+）— 無新 dependency、無 `package.json` npm install 麻煩。

**Pattern**：`hooks/<hook>.test.js` sibling file。

**Example**：
```javascript
// hooks/state-checkpoint.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { truncateUtf8Safe } = require('./state-checkpoint-lib.js'); // refactor to export

test('UTF-8 truncate at codepoint boundary', () => {
  const result = truncateUtf8Safe('你好世界', 5);
  // 5 bytes — '你' = 3 bytes, can't fit '好' (3 more) → cut at codepoint boundary = '你' only
  assert.equal(result.text, '你');
  assert.equal(result.truncated, true);
});

test('legitimate U+FFFD preserved', () => {
  const result = truncateUtf8Safe('valid � text', 20);
  assert.equal(result.text.includes('�'), true);
});
```

**Refactor required**：state-checkpoint.js / intent-capture.js 把內部 helper extract 成 `*-lib.js` module（main script remains thin wrapper）。否則 helper 不 exportable。

### 2.2 Layer 2 — Integration tests

**Target**：完整 hook script 行為 — stdin → stdout/stderr/exit + filesystem side-effects。

**Framework**：bash-based `hooks/tests/run.sh` 或 Node-based test driver。對單 script 跑：
- 構造 input fixture
- spawn hook process with stdin pipe
- assert exit code、stdout content、file system side-effects
- cleanup

**Pattern**：fixture-based：
```
hooks/tests/
├── fixtures/
│   ├── state-checkpoint-empty.json    # {} stdin
│   ├── state-checkpoint-real.jsonl    # real transcript sample
│   ├── state-checkpoint-utf8.jsonl
│   └── ...
├── state-checkpoint.test.sh           # 12 R10 scenarios
├── intent-capture.test.sh
├── sync-version.test.sh
└── run.sh                             # umbrella runner
```

**Example test step**:
```bash
# state-checkpoint.test.sh: R10-A
EXPECTED_DIAG="## Transcript Tail: FAILED"
echo '{}' | node hooks/state-checkpoint.js >/dev/null 2>err.tmp
ACTUAL_EXIT=$?
ACTUAL_DIAG=$(cat ~/.autopilot/compaction-state.md)

[[ "$ACTUAL_EXIT" == "0" ]] || fail "R10-A: exit $ACTUAL_EXIT, expected 0"
[[ "$ACTUAL_DIAG" == *"$EXPECTED_DIAG"* ]] || fail "R10-A: diag missing"
```

**12 R10 scenarios for state-checkpoint** 直接 codify 進 test cases（plan §6 acceptance 已列）。Same for intent-capture (5 scenarios) + sync-version (4 scenarios).

### 2.3 Layer 3 — E2E / Dogfood

**Target**：真實 Claude Code session 行為 — auto-compact 觸發、PostToolUse 連動、SessionStart load 等。

**Limitation**：Claude Code subprocess 行為與 isolation test 之間有 gap（per 2026-05-14 eval-proxy 發現 — `claude -p` proxy 對 autopilot skill 0% recall）。L3 必須 **real session manual dogfood**，不可自動化。

**Replacement strategy**：用 L2 integration test 涵蓋盡可能多的 mechanism；L3 留給 monthly retro 的 spot-check（per retro T16 / T17 watch items）。

---

## 3. Coverage Catalog (P1)

### 3.1 state-checkpoint.js（v2.7.2，highest priority）

| Scenario | Layer | Status |
|---|---|---|
| R10-A empty stdin | L2 | ✅ verified manual; codify |
| R10-B missing transcript | L2 | ✅; codify |
| R10-C malformed JSONL | L2 | ✅; codify |
| R10-D thinking-only newest | L2 | ✅; codify |
| R10-E newest turn ≤ 8KB preserved verbatim | L2 | ⚠ verified earlier，re-run with proper fixture |
| R10-F UTF-8 codepoint boundary | L2 | ✅; codify |
| R10-G nested arrays / image / tool_result blocks | L2 | ⏳ codify |
| R10-H CRLF line endings | L2 | ⏳ codify |
| R10-I ENOSPC 模擬（chmod 000 STATE_DIR）| L2 | ⏳ codify |
| R10-J concurrent PreCompact | L2 | ⏳ shell `&` background |
| R10-K symlink reject | L2 | ⏳ codify |
| R10-L atomic rename across filesystems (EXDEV) | L2 | ⚠ hard to reproduce; consider skip |
| Real compact survives in session | L3 | 觀察 only |

### 3.2 intent-capture.js（v2.7.2）

| Scenario | Layer | Status |
|---|---|---|
| Basic write + chmod 600 | L2 | ✅; codify |
| Env opt-out `AUTOPILOT_INTENT_CAPTURE=false` | L2 | ⏳ codify |
| Disable flag auto-clear (24h stale) | L2 | ⏳ codify with mock mtime |
| Disable flag auto-clear (version mismatch) | L2 | ⏳ codify with mock plugin.json |
| Circuit breaker (10 fails → flag) | L2 | ⏳ codify with mock fs to force fail |
| `realpathSync` symlink canonicalize | L2 | ⏳ codify |

### 3.3 sync-version.js（v2.7.3）

| Scenario | Layer | Status |
|---|---|---|
| `--dry-run` no writes | L2 | ✅; codify |
| Invalid version rejected | L2 | ✅; codify |
| Invalid hook-count rejected | L2 | ✅; codify |
| Pass 1 fail → no writes | L2 | ⏳ codify with mock target file 格式 drift |
| Pass 2 mid-fail → restore all | L2 | ⏳ codify with mock fs write fail |
| Real version bump round-trip（2.7.2→2.9.9→2.7.2）| L2 | ⏳ codify integration |

### 3.4 其他 17 hooks（priority below P1）

每個 hook 都需要至少：
- 1 happy-path test
- 2 fail-injection tests
- 1 fail-open verification（exit 0 regardless of error）

Total ~60 hook test cases。Layer 2 only。

### 3.5 Scripts（sync-version + dev-setup）

`scripts/dev-setup.sh` — symlink builder。1 happy-path + 1 idempotency test.

### 3.6 Skills（16）

**Out-of-scope for this plan**（router-judge plan T11 covers skill description routing）。

### 3.7 Agents（reviewer / debugger / planner）

**Manual L3 only**（structural output contract verification needs LLM dispatch with cost；defer）。

---

## 4. Phases

| Phase | Scope | Effort | Dependencies |
|---|---|---|---|
| **P1: Test harness scaffolding** | `hooks/tests/run.sh` umbrella + fixture dir convention + first test (state-checkpoint R10-A) as proof-of-concept | 90min | None |
| **P2: state-checkpoint.js full coverage** | All 12 R10 + lib-refactor + L1 unit tests for truncateUtf8Safe / renderContentBlocks | 3hr | P1 |
| **P3: intent-capture.js full coverage** | 6 scenarios + lib-refactor + L1 unit tests | 90min | P1 |
| **P4: sync-version.js full coverage** | 6 scenarios | 90min | P1 |
| **P5: other 17 hooks baseline** | ~60 tests, 1 hour batched | 4hr | P1 |
| **P6: CI integration option** | GitHub Action / pre-merge git hook? | 1hr | P1-P5 |
| **L-5** | finish-flow | 15min | All |

Total estimate：**~12hr** for full L-size project。或 split into 3 fix-cycles：P1+P2（state-checkpoint priority），P3+P4（v2.7.2/v2.7.3 deliverables），P5+P6（broad coverage + CI）。

---

## 5. Acceptance

1. ✅ `hooks/tests/run.sh` umbrella exists、能逐個 hook 跑 + 報告 pass/fail
2. ✅ state-checkpoint.js 12 R10 scenarios 全 codified、`run.sh` 跑回 12/12 pass
3. ✅ intent-capture.js 6 scenarios + sync-version.js 6 scenarios codified
4. ✅ Lib-refactor 完成：state-checkpoint-lib.js + intent-capture-lib.js exportable for L1 unit tests
5. ✅ `node --test hooks/state-checkpoint.test.js` 跑 L1 unit tests 全 pass
6. ✅ `hooks/tests/README.md` 文件化 framework + how to add a new test
7. ✅ CI 選項：寫 `.github/workflows/test.yml`（optional Phase 6），於每 PR 自動跑 `run.sh`
8. ✅ `quality-gate-config.md` 從「Test Command: N/A」改成「Test Command: bash hooks/tests/run.sh」
9. ✅ Plan→Impl drift 偵測：reviewer agent prompt template 加「跑 hooks/tests/run.sh 是 pre-merge gate」步驟（部分自動化 today 的 manual review）
10. ✅ 通過 3-reviewer plan loop r1 / r2

---

## 6. Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Lib-refactor 破現有 hook 行為 | Medium | High | 每個 hook lib-extract 後立即跑 5 個 manual smoke test confirmed；P2 phase 第一個 commit 必須是 refactor + green tests |
| R2 | Test fixtures 過 brittle、Claude Code transcript schema drift 後壞 | Medium | Medium | fixture 以 minimal valid JSONL 為主；CRLF / nested arrays 等 edge case 各自 single small fixture file |
| R3 | bash test harness 不可移植（macOS vs Linux）| Medium | Low | 用 portable `stat` + `date` 寫法 OR rewrite as Node-based runner |
| R4 | CI 自動化導入後 false-positive 干擾 PR flow | Low | Medium | Phase 6 optional；先讓 manual `bash run.sh` 跑半年確認穩定再 CI |
| R5 | 60+ test cases 維護負擔 | Medium | Medium | 每 hook ≥1 fail-open 測試是必填；其他 fail-injection 視 hook 重要性、Tier B hook 可只測 happy path |
| R6 | Test suite 跟現有 review-as-test 重複 | Low | Low | Test suite catch syntactic/local bugs（cheaper），reviewer catch architectural drift（complementary）。L-5.2 reviewer 不被 test suite 取代 |

---

## 7. Out-of-scope

| 項 | 不做理由 |
|---|---|
| Skill description routing tests | router-judge plan (T11) 涵蓋 |
| Agent (reviewer/debugger/planner) output-contract tests | LLM dispatch cost；defer to manual |
| voltagent role agent tests | 不在 autopilot scope |
| Production load testing | autopilot 是 dev tool，無 production load 概念 |
| Performance benchmarking | hooks aggregate latency budget 由 retro T26 monitor |

---

## 8. Inspired By / Credit

- **Today's L-5.2 reviewer dispatch** — 連 sync-version.js v1 都跑出來重現 failure，是這 plan 的 conceptual seed。靠手 manual dispatch 不可持續
- **node:test built-in** — Node 18+ ships native test runner，不引入 jest/vitest dep；matches autopilot's「no npm install」discipline
- **autopilot:reviewer 自家 hook-test discipline** — 既有 hook 們（large-file-warner / log-error / reload-watch）都 ad-hoc 寫過 manual smoke test；本 plan 把它系統化

---

## 9. Sequencing 建議

| 時機 | 啟動 |
|---|---|
| **Immediate** | 不啟動 — v2.7.3 才 ship 完，session 已長 |
| **下次 v2.7.4 / 2.8.0 ship 前** | P1 + P2 (state-checkpoint full coverage) — 因為這是 v2.7.2 headline deliverable，最該有 regression net |
| **半年後** | P5 全 hook baseline，若到時 review-catch-rate 仍未 measure |
| **Trigger: 又抓到一個 v2.7.3-style「review reproduced runtime fail」**| 立即啟動 P1 — 證明 review-as-test 有 catch latency / variance 風險 |

---

## 10. 變更歷史

| 日期 | 事件 |
|---|---|
| 2026-05-14 | Proposal written after v2.7.3 retro-roundup + L-5.2 sync-version.js Critical catch |
