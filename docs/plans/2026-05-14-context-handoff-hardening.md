# Context-Handoff Hardening — autopilot v2.7.2

**日期：** 2026-05-14
**狀態：** ✅ Shipped in v2.7.2 — merged to develop as `670cc23` on 2026-05-14 (implementation: `6780a2b`)
**Size：** L
**Branch：** `feat/v2.7.2-context-handoff-hardening`
**Project doc：** [`docs/projects/2026-05-14-context-handoff-hardening/README.md`](../projects/2026-05-14-context-handoff-hardening/README.md)

---

## 1. 背景與動機

### 1.1 痛點

使用者描述：「compact, 常常丟掉重要東西」。Claude Code auto-compact 觸發時，會把 transcript summarize 成壓縮版本，過程中關鍵 state 經常被吃掉。

autopilot 既有對策（`hooks/state-checkpoint.sh` PreCompact hook，inspired by tanweai/pua）：
1. Hook 寫 machine state（timestamp + failure counter）到 `~/.autopilot/compaction-state.md`
2. Hook stdout 注入 instruction，叫 Claude 用 Edit tool append 當下 working context
3. `exit 0` 讓 compact 照常跑

**失效模式**：第 2 步「Claude 自願 Edit-append」是 best-effort，load 高時被跳過。失敗時 compact 仍跑、`compaction-state.md` 只剩 machine state（無 context），於是「重要東西丟掉」。

### 1.2 想要解什麼

不是「沒 handoff doc」（檔已存在、SessionStart hook 已會讀），而是「**handoff doc 的 LLM-written 段 best-effort 失敗**」。修這個 reliability 問題。

### 1.3 為何現在處理

`/loop` / `/powerloop` survey 出 powerloop 的「fresh conversation 靠 .note.md 接力」設計後，user 問能否 backport 解 compact-drop-state 痛點。研究後發現 Claude Code **無** 80% threshold hook、`count_tokens` API 是 read-only on messages、settings.json **無** compact 開關。

初版設計（3-layer：UserPromptSubmit + count_tokens + PreCompact exit 2 + SessionStart auto-rehydrate TaskList）被 3-reviewer think-tank **REJECT**（詳見 [project README §Review Background](../projects/2026-05-14-context-handoff-hardening/README.md#review-background)）。

Architect 替代設計：**hook 自己撈 transcript，不靠 LLM 合規**。本 plan 採納。

### 1.4 既有 21 hooks 概覽（scope context）

| Lifecycle | 已有 hooks |
|---|---|
| SessionStart | `session-start.sh`（已含 compaction-state.md recovery + 4hr TTL）|
| PreCompact | `state-checkpoint.sh`（**P1 改寫目標**）|
| PreToolUse | `large-file-warner.js`、`branch-protection.js`、`commit-secret-scan.js`、`config-protection.js`、`check-console.js`、`design-quality.js`、`mcp-health.js`、`test-runner.js` |
| PostToolUse | `failure-escalation.js`、`audit-log.js`、`suggest-compact.js`（tool-count threshold 已實作）、`accumulator.js`、`log-error.js`、`reload-watch.js` |
| Stop | `cost-tracker.js`、`session-summary.js`、`batch-format.js` |

→ 大部分 scaffold 已備，本 plan 屬「強化 + 補洞」、非「重寫」。

---

## 2. 設計 — Architect Move 1+2+3 收斂版

### 2.1 Move 1：PreCompact hook 自抽 transcript（P1）

**r1 review 收斂後決定：bash + jq → 改 Node.js 重寫**。三方共識理由：
- Architect: 「jq 不存在的環境 fail-skip 即 silent degrade 回原痛點，且 transcript JSONL schema 複雜（thinking blocks 含 binary signatures、user content 可為 string 或 array of tool_result blocks、interleaved record types：permission-mode、file-history-snapshot、attachment、system、ai-title）」
- Ops: 「macOS 預設無 jq、無其他 hook 用 jq；Node 重寫消 dep 且和現有 14 hooks 一致」
- QA: 「filter-first then tail；thinking blocks 必須 skip；byte cap 8KB；錯誤要 visible 不要 silent」

**r2 review 進一步精修（critical）**：
- **Byte cap direction must be newest-first** — 先排最新 turn、然後從尾端 truncate。否則 turn 1-14 的大 tool_result 撐爆 8KB、turn 15-20（最重要、最新）被切掉
- **Thinking-block truncate-per-block，不 binary-drop** — chain-of-thought 常常就是「important context」本身。每個 thinking block 截到 500 bytes + `[...thinking truncated]` marker，保留 reasoning shape
- **`.state-checkpoint.log` 升為 IO-fault 主 sink** — checkpoint file 自身寫不出時（disk full / perm flip），in-file diag 也消失。獨立 log path 為一級 diagnostic
- **PreCompact 失敗 emit 到 stderr** — Claude Code surfaces hook stderr 進當下 session、user 立即看到（不必等下次 SessionStart）
- **UTF-8 safe truncation** — byte cap 必須在 codepoint 邊界、不可切多 byte 中間
- **CRLF tolerance** — Windows-origin transcript 可能有 CRLF
- **nested content tolerance** — content array 可能含 `image` 或巢狀 `tool_result`

**新檔**：`hooks/state-checkpoint.js`（替代 `hooks/state-checkpoint.sh`，舊版改名 `.sh.bak` 保留 rollback path）

**Behaviour（r2 精修後）**:
```javascript
// 1. Parse stdin JSON, read transcript_path. Stamp hostname into output (multi-machine ghost-state mitigation per Ops r2#5)
// 2. ALWAYS write a primary diagnostic line to ~/.autopilot/.state-checkpoint.log first
//    (JSONL: {ts, hostname, session_id, status: "start", ...})
//    This log is the PRIMARY IO-fault sink — if subsequent checkpoint-file write fails,
//    the user still has a record (per Architect r2#2)
// 3. Read transcript JSONL line-by-line; tolerate CRLF
// 4. FILTER FIRST: record.type === "user" || "assistant"
//    (skips permission-mode, file-history-snapshot, attachment, system, ai-title)
// 5. TAIL AFTER filter: take last N turns (default 20, env TRANSCRIPT_TAIL_N override)
// 6. Extract content per turn — NEWEST FIRST iteration (per QA r2#2 — cap from oldest end, not newest):
//    - if message.content is string: use as-is
//    - if message.content is array: iterate blocks:
//      - type === "text": include `.text`
//      - type === "thinking": include `.thinking` BUT truncate at 500 bytes + `[...thinking truncated]`
//        (per QA r2#3 — don't binary-drop reasoning)
//      - type === "tool_use": render as `[tool_use: <name>(...)]` stub
//      - type === "tool_result": render as `[tool_result: <length>B]` stub
//      - type === "image" / nested arrays: render as `[image]` / depth-recursive flatten
//    - r3 fix (Architect#1 + QA#2): **newest turn NEVER per-turn-capped**.
//      Per-turn 1.5KB budget applies ONLY to older turns (turn 2..N).
//      Newest turn (turn 1 in newest-first iter) renders verbatim
//      (subject only to global 8KB cap which may truncate FROM old turns first)
// 6a. Oversized single line guard (r3 Architect#4): if a single JSONL line > 5MB,
//     skip it + log warn (defends against tool_result with embedded base64 image)
// 7. Global byte cap 8KB (env TRANSCRIPT_BYTE_CAP):
//    - Build output reverse-order (newest first), stop when cap hit
//    - REVERSE output to chronological for human reading
//    - UTF-8 safe truncation: if truncating, slice on codepoint boundary (Buffer.from + slice + toString fallback handling)
//    - Append marker: `[...older N turns truncated to fit 8KB cap]`
// 8. Write to ~/.autopilot/compaction-state.md with diagnostic header:
//    ## Transcript Tail (hook-extracted)
//    - Method: Node JSONL parser (v2.7.2)
//    - Hostname: <hostname>
//    - Turns captured: N / X total filtered turns / Y total records
//    - Bytes: 7842 (cap: 8192)
//    - Order: newest-first selection, output chronological
// 9. On ANY error: write VISIBLE diagnostic INTO checkpoint file:
//    ## Transcript Tail: FAILED
//    - Reason: <specific cause classification: missing transcript_path / file not readable
//              / JSONL parse error / IO write error / unknown>
//    - Last successful step: <step>
//    - This means compact will only have machine state + Claude-append (the original failure mode)
//    AND emit ALSO to stderr (per QA r2#6 — surfaces in current session, not stale)
// 10. Always exit 0 (fail-open)
// 11. Append final diagnostic line to .state-checkpoint.log
//     (JSONL: {ts, hostname, session_id, status, turns_captured, bytes, reason?})
//     Rotate at 1MB
```

**LLM-append 段保留**為 bonus（不再 load-bearing）。Stdout instruction 措辭調整為「optional supplement，hook 已抓主體」。

**Acceptance**:
- Node 重寫消 jq dep
- 真實 transcript（從 `~/.claude/projects/*/conversations/*.jsonl` 取樣）測試 schema handling
- 失敗時寫 visible diagnostic 進 file（非 silent）
- 失敗時不破 machine state 段
- `echo '{}' | node hooks/state-checkpoint.js` 應 exit 0 + 寫 fallback marker
- 舊 `.sh.bak` 保留供 1-line rollback

### 2.2 Move 2：PostToolUse intent capture（P2）

新檔 `hooks/intent-capture.js`，PostToolUse `.*` matcher。**Tier A default-on**（每 tool-use 都跑）。

**r1+r2 review 收斂後修正**：
- **cwd 必須記錄** 且 SessionStart 使用前要 filter（QA r1#1 critical）
- **r2 critical fix — multi-cwd race**：原 plan v2 用單檔 `last_intent.json` last-writer-wins，多 cwd 並行 session 會互相 clobber 直到 cwd filter 在 read 端把 hint 全部隱藏 → 比 no-hint 更糟。**改成 per-cwd 檔**：`~/.autopilot/intent/<sha1(cwd)>.json`（QA r2#1 critical）
- **r2 fix — Tier-A circuit breaker**：N 次連續 fail → 寫 `~/.autopilot/intent-capture.disabled` flag，下次起 silent skip。Architect r2#3。Mirror `accumulator.js` precedent
- **r2 fix — env opt-out**：`AUTOPILOT_INTENT_CAPTURE=false` env 讓使用者一鍵停（match `AUTOPILOT_COST_TRACKER=false` precedent，Ops r2#5）
- **延遲 budget**: Ops 實測 Node cold-start ~35-42ms + intent-capture ~10-12ms = **~46-54ms warm**，**Aggregate PostToolUse `.*` budget ≤250ms p99**（含 log-error + reload-watch + intent-capture + suggest-compact），Ops r2#1
- **chmod 600** on intent files
- atomic write 配合 hook 順序在 `hooks.json` 顯式宣告：`suggest-compact` → `intent-capture` → `log-error` → `reload-watch`
- 寫多 cwd 檔時 stamp `hostname`（Ops r2#5 multi-machine ghost-state 防呆）

**Behaviour**：
- 每次 tool-use 結束，更新 `~/.autopilot/intent/<sha1($PWD)>.json`：
  ```json
  {
    "session_id": "abc123",
    "hostname": "linux-box",
    "last_updated": "2026-05-14T16:00:00Z",
    "last_tool": "Edit",
    "last_tool_input_summary": "edit hooks/state-checkpoint.js",
    "tool_count_session": 42,
    "cwd": "/home/cookys/projects/autopilot",
    "git_branch": "feat/v2.7.2-context-handoff-hardening"
  }
  ```
  Architect r2 last-mile: 加 `git_branch`（同 cwd 不同 worktree 區分）
- Atomic write（write tmp → rename）；`chmod 600`；目錄不存在則 mkdir 0700
- Circuit breaker check at entry — exists `intent-capture.disabled`？skip
  - **r3 fix — auto-clear rules**: (a) flag 內含 plugin version stamp，下次 hook 跑時若版本不同 → 自動清除；(b) flag mtime > 24h → 自動清除；(c) 使用者可手動 `rm ~/.autopilot/intent-capture.disabled`（會 documented 在 SessionStart warning 與 `hooks/README.md`）
- Env opt-out check at entry — `AUTOPILOT_INTENT_CAPTURE=false`？skip
- **Path canonicalization (r3 critical)**：sha1 key 用 `fs.realpathSync($PWD)` 後的 absolute path，不是 raw `$PWD`。Mac/Linux symlink farm 不會 fragment、case-sensitivity / trailing slash 統一處理。Fallback: `realpathSync` 失敗（檔不存在等）→ fall back to raw `$PWD`、記 warn 到 log
- Sibling file → 不在 transcript 內 → compact 不會碰
- Fail-open（exit 0、silent — 此 hook 失敗對 user 無 immediate impact；觀察 via aggregate log）
- 連續 N=10 失敗 → 寫 `intent-capture.disabled`（內含 ts + last error）；下次 SessionStart 提示「intent-capture disabled due to repeated failures — see ...」

**Acceptance**：
- 新檔 < 120 lines
- 實測 < 60ms warm / < 100ms p99 cold
- PostToolUse `.*` aggregate measured ≤250ms p99
- hooks.json PostToolUse `.*` matcher 加 entry，順序：suggest-compact → intent-capture → log-error → reload-watch
- `chmod 600` on intent files
- `hooks/README.md` Tier A 計數 +1（從 9 → 10），同時更新 `hooks.json` 第 2 行 description「9 default-on」→「10 default-on」（Ops r2 confirmation）
- per-cwd 檔結構：`~/.autopilot/intent/<sha1(cwd-absolute)>.json`

### 2.3 Move 3：SessionStart 顯示 intent.json hint（P3）

`hooks/session-start.sh` 已含 `~/.autopilot/compaction-state.md` recovery 段。增補：

**r1 + r2 review 收斂後修正**：
- 原 plan v2 用單檔 + cwd-filter 模式。r2 QA 指出此設計在 multi-cwd 並行下會「stale 變 no-hint」— 改為 P2 端的 **per-cwd 檔**結構後，SessionStart 邏輯也簡化：直接讀 `~/.autopilot/intent/<sha1($PWD)>.json`，自然就只看當前 cwd 的 intent
- 加 `hostname` filter — 跨機 sync 場景避免顯示來自其他機器的 ghost intent
- 加 stale-disable hint surface — 若 `intent-capture.disabled` 存在，輸出一行讓使用者知道並指路 `~/.autopilot/.state-checkpoint.log` 自診

**Additions**：
- 讀 `~/.autopilot/intent/<sha1($PWD)>.json`（同 TTL 邏輯，4hr 預設）
- `hostname filter`：`intent.hostname === $(hostname)` 才顯示，跨機殘留 → silent skip
- 如果 fresh + 同 host，輸出 1-2 行 resume hint：
  ```
  [Autopilot Resume Hint]
  上 session 最後動作（2026-05-14T15:55Z）：Edit hooks/state-checkpoint.js
  Branch: feat/v2.7.2-context-handoff-hardening
  ```
- 若 `~/.autopilot/intent-capture.disabled` 存在 → 一行警告：
  ```
  ⚠ intent-capture hook disabled due to repeated failures.
    See ~/.autopilot/.state-checkpoint.log for diagnostics.
  ```
- **不自動 rehydrate TaskList**（per Architect r1 警告）
- 既有 compaction-state.md recovery 邏輯不動

**Acceptance**：
- session-start.sh 改動 < 40 lines
- TTL stale / hostname mismatch / file missing → silent skip
- 兼容沒 intent 檔的情境（first run）
- 真實多專案切換情境驗證（dogfood：cd 至 ~/projects/nikki 開新 session，hint 不應顯示 autopilot 內容）

### 2.4 三個改動關係（r2 v3 更新）

```
PostToolUse ─► intent-capture.js ─► ~/.autopilot/intent/<sha1(cwd)>.json
                                    + (循環失敗 N 次) intent-capture.disabled
                                          │
PreCompact ─► state-checkpoint.js ─► ~/.autopilot/compaction-state.md
              │  (Node JSONL parser)     +
              │   filter-first/tail-after│
              │   newest-first ordering   │
              │   per-block thinking trunc│
              │   8KB cap + UTF-8 safe    │
              │                           │
              └─► transcript_tail         │
              └─► ~/.autopilot/.state-checkpoint.log (PRIMARY IO-fault sink, JSONL)
              └─► stderr (visible in current session on failure)
                                          ▼
SessionStart ─► reads per-cwd intent ─► resume hint (cwd-scoped, host-filtered)
              ─► reads compaction-state.md ─► recovery context
              ─► detects intent-capture.disabled ─► warning + log pointer
```

兩個 sibling 結構：
- `~/.autopilot/intent/<sha1(cwd)>.json` — 高頻寫（每 tool-use），per-cwd 隔離、解 multi-session race
- `~/.autopilot/compaction-state.md` — 低頻寫（每 PreCompact），machine state + hook-extracted transcript tail + LLM bonus append
- `~/.autopilot/.state-checkpoint.log` — JSONL rotate at 1MB；**r3 honesty fix (Architect#3 + Ops#3)**：此 log 與 `compaction-state.md` 同 parent dir、**NOT FS-independent**；ENOSPC 場景兩者皆失敗。第一級 IO-fault sink 實際是 **stderr emit**（Claude Code surfaces in current session），log 是次級紀錄、in-file diag 是第三級
- 加 `chmod 600` on all sibling files (.log + .disabled flag)，match `state-checkpoint.sh:39` 600 convention（Ops r3 minor）
- `~/.autopilot/intent-capture.disabled` — circuit breaker flag

---

## 3. Phases

| Phase | Scope | Files | Estimate |
|---|---|---|---|
| P1 | `state-checkpoint.sh` → `state-checkpoint.js` 重寫；舊檔 `.sh.bak`；含 stderr emit + log JSONL | `hooks/state-checkpoint.js`（new）、`hooks/state-checkpoint.sh.bak` | ~220 lines |
| P2 | New `intent-capture.js` + per-cwd directory + circuit breaker + env opt-out | `hooks/intent-capture.js`（new） | ~120 lines |
| P3 | `session-start.sh` 加 per-cwd intent hint + hostname filter + disable warning | `hooks/session-start.sh` | ~40 lines |
| Consolidation | hooks.json path swap + new entry + Tier A 計數 + description 「9→10」 | `hooks/hooks.json`、`hooks/README.md` | ~20 lines |

**執行順序與 commit 策略（r2 Ops#4 + Architect#1 收斂）**：
- **P1 ‖ P2 並行 work**（不同檔、無 import 依賴）
- **P3 序列**（讀 P2 寫的 per-cwd intent 檔）
- **Consolidation 序列**（合併 hooks.json + README 變更）
- **單一 atomic commit**：P1+P2+P3+Consolidation 一起進一個 commit
- **Rollback 分兩條路**（r3 Ops#4 critical）：
  - **Maintainer rollback** (this repo)：`git revert <sha>` 在 develop branch 加新 commit reversing change
  - **User-side rollback** (post-marketplace-update)：使用者需 `/plugin update autopilot` 到先前 tag (v2.7.1) **AND** 手動清理新增 sibling files：
    ```bash
    rm -rf ~/.autopilot/intent/
    rm -f ~/.autopilot/intent-capture.disabled
    rm -f ~/.autopilot/.state-checkpoint.log
    ```
    這段會寫進 CHANGELOG v2.7.2 entry + `hooks/README.md` 的 Rollback subsection

Plan v2 寫的「parallel commits」是錯的（會 hooks.json merge conflict）。修正：parallel WORK、single COMMIT。

---

## 4. Out-of-scope（明示**不**做）

| 項 | 不做理由 |
|---|---|
| UserPromptSubmit + `count_tokens()` API | Ops/Architect 雙重 REJECT — network on hot path + structurally wrong-by-construction |
| PreCompact `exit 2` block | Architect REJECT — block without exit-path = livelock，hook 無法強制 session exit |
| Auto-rehydrate TaskList | Architect REJECT — 耦合 undocumented Claude Code internals，版本 drift 高風險 |
| 改 `settings.json` schema | 沒這個機制，Claude Code 不提供 compact threshold knob |
| 改 16 skills body | 純 hook layer 工作 |
| Tool-count threshold（autopilot 已有 `suggest-compact.js`）| 已存在、用 tool count 不是 token — heuristic 補位，不衝突，不動 |

---

## 5. Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | PreCompact stdin JSON schema 變動 | Low | Medium | hook fail-open；plan 註明測試版本（Claude Code 2.1.x）；改動限 stable field (`transcript_path`)；Acceptance §6 加 `echo '{}' \| node hooks/state-checkpoint.js` 必須 exit 0 |
| R2 | Transcript JSONL 太大導致 Node 慢 | Low | Low | filter-first/tail-after（先 filter 再取最後 N=20）；JSONL 是 newline-delimited，stream parse 不 load 全檔；byte cap 8KB |
| R3 | PostToolUse intent capture 寫太頻繁、disk wear | Low | Low | atomic rename + 同檔覆寫（不 append history）、單一 inode 重用 |
| R4 | `last_intent.json` 多 session 並發 race | Medium | Low | atomic write (tmp + rename)；最後寫的贏，acceptable for resume hint；cwd filter 在 SessionStart 端做 |
| R5 | SessionStart 顯示太多文字噪音 | Medium | Low | 限制 hint 行數（≤2 lines）、TTL + cwd filter 雙重把關 |
| R6 | ~~jq 不存在的環境~~ → **resolved by Node 重寫** | — | — | r1 Architect+Ops+QA 共識，state-checkpoint 改 Node 後無此 dep |
| **R7** | 舊 v2.7.1 user 的既有 `compaction-state.md` 與新 hook 格式不相容 | Low | Low | `session-start.sh` 既有 recovery block 是 inline-as-DATA 邏輯，會 tolerate 新欄；無需 migration |
| **R8** | 共用機器多 user 環境，`last_intent.json` 權限洩漏 | Low | Medium | `chmod 600` on `last_intent.json`（match `state-checkpoint.sh:39` 既有 600 convention）|
| **R9** | 磁碟滿 → mkdir / atomic rename 失敗 | Very Low | Low | hook fail-open；無 partial state，next attempt 自然恢復 |
| **R10** | Silent failure mode（hook 跑完 exit 0 但實際沒抽出 transcript） | Medium | High | **核心 r1 共識 mitigation**：state-checkpoint.js 必須寫 visible diagnostic 進 checkpoint file 自身（`## Transcript Tail: FAILED — Reason: ...`），且 append 一行 `~/.autopilot/.state-checkpoint.log`（rotate 1MB）|

---

## 6. Acceptance Criteria（finish-flow L-5.1 Final Goal Review 用）

### Functional
1. ✅ `hooks/state-checkpoint.js`（Node 重寫）存在，舊 `state-checkpoint.sh` 改名 `.sh.bak` 留 rollback
2. ✅ PreCompact 觸發時 `~/.autopilot/compaction-state.md` 包含 `## Transcript Tail (hook-extracted)` 段、含至少 10 個 user/assistant turn 的 verbatim 內容（dogfood 驗證、實際 trigger compact）
3. ✅ 新檔 `hooks/intent-capture.js` 存在、register 在 `hooks.json` PostToolUse `.*` matcher（順序 `suggest-compact.js` 之後）
4. ✅ 跑任意 tool 後，`~/.autopilot/intent/<sha1(realpath($PWD))>.json` 存在、`chmod 600`、含 `last_tool / last_updated / cwd / session_id / tool_count_session / hostname / git_branch`（**r3 fix — stale `last_intent.json` reference 修正**）
5. ✅ `hooks/session-start.sh` 啟動時，`last_intent.json` 存在 + TTL fresh + **cwd 與 $PWD match**，輸出 1-2 行 resume hint；cwd mismatch → silent skip（dogfood：autopilot 切到 nikki repo 不應顯示 autopilot intent）

### Fail-injection acceptance（per QA r1#6 + Ops r2#3）— **每條都要實測**
6. ✅ **R10-A**: `echo '{}' | node hooks/state-checkpoint.js` → exit 0、in-file visible diag + stderr emit
7. ✅ **R10-B**: 給不存在的 `transcript_path` → exit 0、visible failure diag
8. ✅ **R10-C**: 給 malformed JSONL（truncated mid-line）→ exit 0、partial-parse diag
9. ✅ **R10-D**: 給 transcript 全是 thinking blocks → exit 0、`Turns captured: 0 of N (all filtered, thinking truncated per-block)`
10. ✅ **R10-E**: byte cap 觸發 → 寫 `[...older N turns truncated to fit 8KB cap]` marker（**newest-first 順序保留**、verify 最新 turn 完整）
11. ✅ **R10-F**: UTF-8 truncation：給 transcript 含 multi-byte char 跨 cap 邊界 → 不切 mid-codepoint
12. ✅ **R10-G**: nested arrays / image / tool_result blocks → rendered as stubs，不 crash
13. ✅ **R10-H**: CRLF line endings → parse 成功
14. ✅ **R10-I**: ENOSPC on `~/.autopilot/` → exit 0、`.state-checkpoint.log` 記錄（這個 log path 必須 independent 於 STATE_DIR，per Architect r2#2）
15. ✅ **R10-J**: 兩 Claude session 並發 PreCompact → log 顯示兩條獨立 entry、無 corrupted partial write
16. ✅ **R10-K**: `transcript_path` 是 symlink 出 `$HOME` → reject + log warn
17. ✅ **R10-L**: atomic rename across filesystems (EXDEV) → log + fallback to non-atomic write

### Usefulness check（QA r2#5 — distinct from presence check）
18. ✅ 故意製造 R10-D（transcript 全是 thinking blocks）情境後，**人讀** diag 應能在 30 秒內辨識「失敗類型 + 缺什麼」（subjective but anchored）

### Regression
19. ✅ 既有 9 default-on hooks 行為不變（regression spot check）
20. ✅ `hooks/README.md` Tier A 計數 9→10、`hooks/hooks.json:2` description「9 default-on」→「10 default-on」（同 commit）
21. ✅ Plan 通過 3-reviewer think-tank r3 loop，HIGH consensus（無 Major / Critical；僅 Suggestion 留存且 closed via Decision Tree）

### Release
22. ✅ `CHANGELOG.md` v2.7.2 entry、`plugin.json` + `marketplace.json` 版本 sync（grep 確認）
23. ✅ Latency budget — **r3 honesty fix (Ops#1)**：原 plan v3 claim「≤250ms p99」實測未驗、cold-start 主導下可能 400ms+。Acceptance 改成：dogfood spot-check 不出現 user-perceivable 延遲；不寫 hard SLO；若 dogfood 中發現 noticable delay → 加 throttle 機制（intent-capture skip 每 5th tool-use 等）
26. ✅ R10-M oversized line guard：給 transcript 含 5MB+ 單行 → 跳過 + log warn、不 OOM（r3 Architect#4）
27. ✅ Circuit breaker recovery path 在 `hooks/README.md` 新增 "Self-Disable Recovery" subsection 文件化（r3 Architect#2 + QA#1 + Ops#2）
24. ✅ 單一 atomic commit、CHANGELOG 註明 `git revert <sha>` 為 rollback 指令
25. ✅ Env opt-out `AUTOPILOT_INTENT_CAPTURE=false` works（READMEd in `hooks/README.md`）

---

## 7. Inspired By / Credit

- **tanweai/pua session-restore.sh** — 既有 `state-checkpoint.sh` header 已 credit。本改動延伸同精神（PreCompact 寫 sibling-file handoff）但加 hook-self-extract（pua 原版仍靠 LLM）。
- **claude-powerloop-plugin v0.4.0+** — 「state 在 file、conversation 是 fresh」設計啟發；本 plan 不直接搬 architecture（autopilot 是 session-driven 非 cron），但「handoff doc 必須不靠 LLM 合規」是同精神。已在 v2.7.1 README Inspired By 段 credit。
- **3-reviewer think-tank（Architect/QA/Ops）** — 否決原 3-layer 提案、推導本 plan 採納的 Architect 替代設計。Review log 在 [project README §Review Background](../projects/2026-05-14-context-handoff-hardening/README.md#review-background)。

---

## 8. 變更歷史

| 日期 | 事件 |
|---|---|
| 2026-05-14 | Plan v1 written after CEO Startup confirmed OKR / Level 3 / Selective scope / No-go zones |
