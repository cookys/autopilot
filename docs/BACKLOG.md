# autopilot — BACKLOG

Trigger-conditioned future work. Each entry must have:
- **Trigger**：what must be true / observed before this fires
- **Context**：one-line problem statement
- **Effort**：S / Fix / L estimate
- **Source**：commit / review-round / retro that surfaced it

Entries without a trigger are rejected (per `skills/quality-pipeline/references/code-review.md` backlog spec).

**Discovery**: when starting any work, `grep <topic>` here. Plan-doc-as-roadmap (`docs/plans/2026-05-14-retro-roundup.md`) post-archive 後遷移 entries 也都歸這裡。

---

## Format example

```markdown
### <Topic title>
- **Trigger**: <observable condition; e.g. "next time touching X" / "after sample N of behavior Y" / "performance degrades below threshold Z">
- **Context**: <one-line problem>
- **Effort**: S | Fix | L (estimate)
- **Source**: <commit SHA / review-round / retro / plan ref>
```

---

## Active entries

### Context-handoff state-checkpoint symlink reject — diag detail
- **Trigger**: 下次 user 回報 「`transcript_path resolves outside HOME`」失敗訊息看不懂時
- **Context**: v2.7.2 `state-checkpoint.js` 拒絕 symlink-out-of-HOME 為安全考量，但 visible diag 不顯示 `$HOME` 值。CLAUDE_CONFIG_DIR override / 跨 volume symlink 的 user 看不懂為什麼被拒
- **Effort**: S（state-checkpoint.js diag 多 echo `os.homedir()` 一行）
- **Source**: 2026-05-14 v2.7.2 L-5.2 reviewer Suggestion #1 (`abb4a4d`)

### Failure counter cleanup（housekeeping）
- **Trigger**: `~/.autopilot/.failure_count_*` 累積 > 50 個檔案、或 state-checkpoint 啟動延遲 > 100ms
- **Context**: `state-checkpoint.js` readFailureCounter 掃描 `~/.autopilot/.failure_count_*`、若有大量舊 counter file 會逐個 statSync。failure-escalation 應在 Stop hook 自清自己的 counter
- **Effort**: S（failure-escalation.js Stop-hook cleanup OR state-checkpoint 加 mtime > 7d filter）
- **Source**: 2026-05-14 v2.7.2 L-5.2 reviewer Suggestion #2 (`abb4a4d`)

### intent-capture disable flag — malformed → STALE handling
- **Trigger**: 觀察到 `~/.autopilot/intent-capture.disabled` 出現後 user 無法 self-recover
- **Context**: 目前若 disable flag JSON parse 失敗（partial write during ENOSPC etc.），auto-clear 邏輯 leave-active；無 user recovery path 除了 manual `rm`
- **Effort**: S（intent-capture.js JSON parse fail branch → 視為 STALE 自動清）
- **Source**: 2026-05-14 v2.7.2 L-5.2 reviewer Suggestion #3 (`abb4a4d`)

### `/compact` slash-command silent miss documentation
- **Trigger**: 任何 user 想用 `/compact` 測 state-checkpoint hook 時 — 必須先讀本條
- **Context**: 2026-05-14 method-B testing 發現：Claude Code 的 `/compact` slash command 觸發 PreCompact hook 時**不 pipe JSON payload**，而是讓 hook 撞 ENXIO on `/dev/stdin`。Auto-compact (~150K-token threshold) DOES pipe payload — 兩條路徑不對稱。
- v2.7.2 fix: state-checkpoint.js ENXIO 改 graceful skip (log `no_payload_skip` 而非 `catastrophic`)，所以未來不會 misleading log。但**根本性質仍在**：`/compact` 無法測 state-checkpoint 抽取邏輯，只能驗 hook reachable
- **Future action options**:
  - (a) 在 `hooks/README.md` 加 note「`/compact` ≠ real PreCompact for testing」
  - (b) 跟 Claude Code 反饋此 slash-command 應該 pipe consistent payload
  - (c) state-checkpoint 用 fallback（無 stdin 時自行 spawn `claude --transcript-path-query` 或讀 `~/.claude/projects/$CWD_HASH/*.jsonl` 最新檔）
- **Effort**: (a) S; (b) external — out of scope; (c) M, 但複雜度未必值得
- **Source**: 2026-05-14 v2.7.2 method-B verification — user diagnostic report

### PostToolUse dispatch dies after `/clear` — process restart required（verified）
- **Trigger**: 下次有 user 回報 intent-capture / audit-log / reload-watch 在 long-running session 沒更新；或 Claude Code 升級 release notes 提到 hook dispatch 變更
- **Context**: 2026-05-14 三階段觀察，verified via fresh-process test：
  - **Phase 1**: post-`/reload-plugins` intent-capture 跑 ~20 次 burst 後 stagnate 9+ 分鐘
  - **Phase 2 (post-`/clear` 同 session)**: 全部 PostToolUse hooks 不 fire（intent count, reload-watch mtime, audit-log 全凍）。`/reload-plugins` reload 11 hooks 但 **不 re-init dispatch**
  - **Phase 3 (fresh `claude` process 驗證)**: PostToolUse `.*` matcher **復活** — intent count 10→11、mtime 變新。**確認**：`/clear` + `/reload-plugins` 不 re-init PostToolUse dispatch、fresh process boot 才會
- **Verified hypothesis**: Claude Code PostToolUse dispatch table 跟 process boot 綁定一次性 init
- **Workaround**: 完整 exit + relaunch `claude`（不是 `/clear`、不是 `/reload-plugins`）
- **Impact**: v2.7.2 cross-session intent recovery 在 long-running session post-/clear 失效；user 不會察覺到 hooks 已 dead
- **Next step options**:
  - (a) **detect** — 在 SessionStart 階段檢查上 N 個 Bash tool 後 audit-log/intent mtime 是否有 advance、無 → 提示 user restart
  - (b) upstream report 給 Claude Code（PostToolUse re-init on `/clear` matcher dispatch）
  - (c) docs in hooks/README.md warn long-session users
- **Effort**: (a) M（需 SessionStart 邏輯 + timer），(b) external，(c) S
- **Source**: 2026-05-14 v2.7.2 post-`/clear` continue-session diagnostic + fresh-process verification

### PostToolUse payload missing `tool_name` + `tool_input` from Claude Code（CRITICAL — silent regression）
- **Trigger**: 立即（影響 audit-log 從 v2.7.2 ship 以來一直 broken）
- **Context**: 2026-05-14 fresh-process diagnostic 揭露：
  - Fresh `claude` session 中 PostToolUse hooks DO fire（intent count 10→11）
  - **但 stdin JSON payload 缺欄位**：`tool_name` 跟 `tool_input.command` 都不存在
  - 證據：intent-capture 寫 `last_tool: <unknown>` + `last_tool_input_summary: <unknown>`（intent-capture.js:198-199 fallback 路徑）
  - audit-log.js:20 `if (!command) process.exit(0)` → **silent skip 從未寫過 `~/.claude/bash-commands.log`**
  - failure-escalation.js 同樣 schema-dependent，artifact 也不存在
- **Impact (silent)**:
  - **Bash audit trail 整個失效**（v2.7.2 ship 那天起到現在 `~/.claude/bash-commands.log` 不存在過）
  - v2.7.2 cross-session resume hint 永遠 `last_tool: <unknown>` — degrades intent recovery 設計目標
  - `Write|Edit` matcher (suggest-compact) 同樣 schema-dependent、未驗證但同 pattern
- **Hypothesis**: Claude Code Opus 4.7 PostToolUse schema 改了（可能用 `tool_response` 取代 `tool_input`、或 envelope rename）。或 Anthropic dropped field for some reason
- **Next step**:
  1. 寫一個 capture-stdin debug hook (`tee /tmp/pt-payload.json`) 暫 add 進 hooks.json、fresh Claude 跑 1 Bash、dump 實際 payload → 確認 schema
  2. 修 audit-log + failure-escalation + intent-capture 支援新 schema
  3. 補 hook test：mock realistic payload format
- **Effort**: Fix（debug hook + schema migration + 3 scripts patch ~2hr）
- **Source**: 2026-05-14 fresh-process verification（autopilot intent file 史上每筆 auto-fire 都 `last_tool: <unknown>`、`bash-commands.log` 從未存在）

### Investigate `/reload-plugins` hook count discrepancy
- **Trigger**: 下次有人寫 reload-watch 邏輯時，或 Claude Code update 改 hook reload semantics
- **Context**: 2026-05-14 v2.7.2 post-reload 觀察 `/reload-plugins` 回報「11 hooks」但 hooks.json 實際 13 entries (1 PreCompact + 1 SessionStart + 3 PreToolUse + 6 PostToolUse + 2 Stop)。差 2 — 可能忽略 SessionStart 或 PreCompact runtime hook count。Live functionality OK（intent-capture 確認 firing post-reload）
- **Effort**: S（看 Claude Code source / docs 確認 count semantics）
- **Source**: 2026-05-14 v2.7.2 post-ship reload verification

### Test suite for autopilot — automated coverage for hooks / scripts
- **Trigger**: 下次出現 v2.7.3 sync-version.js-class 「reviewer-跑了-才抓到」class of bug，OR v2.7.4/2.8.0 release 前
- **Context**: autopilot 至今無 automated test infrastructure (`quality-gate-config.md` 寫「Test Command: N/A」)。每次 ship 靠 manual reviewer dispatch + synthetic stdin。今天就有 2 起 review-loop catch (v2.7.2 newest-turn-cap + v2.7.3 sync-version.js Critical x2)。Long-term review-fatigue + catch-rate-decay 風險
- **Effort**: L (~12hr full, or 3 fix-cycles split)
- **Source**: 2026-05-14 v2.7.3 post-ship session — plan filed at `docs/plans/2026-05-14-test-suite.md`
