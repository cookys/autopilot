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

### Claude Code 2.1.141 fails to pipe stdin for tool-event hooks（ROOT CAUSE — upstream regression）
- **Trigger**: 立即（影響所有 PreToolUse / PostToolUse hooks 從 2.1.141 升級時起）
- **Context**: 2026-05-14 fresh-claude transcript 直接揭示 root cause（先前 hypothesis 全推翻）：
  - **Schema 正確**：binary 內 Zod schema `{hook_event_name, tool_name, tool_input, tool_response, tool_use_id, duration_ms?}` 跟我們 hooks 讀的一致
  - **問題不在 schema，在 dispatch**：fresh claude 2.1.141 session 中 11 個 tool-event hook fires **全部 ENXIO**：
    - PostToolUse:Bash × 4 (audit-log, capture-payload, log-error, intent-capture 都吐 `ENXIO: no such device or address, open '/dev/stdin'`)
    - PreToolUse:Bash × 3、PreToolUse:Read × 2 同樣 ENXIO
  - SessionStart × 1 + Stop × 2 **正常**（不同 stdin 處理路徑）
- **Smoking gun**: 2.1.141 binary 含 string `EPIPE error while writing to hook stdin (hook command likely closed early)` + `Hook command closed stdin before hook input was fully written (EPIPE)`。2.1.129 binary 無此 strings → 2.1.141 改了 hook stdin write path、新 code 有 bug
- **Impact** (all silent due to fail-open hook convention):
  - 所有依賴 `tool_input` / `tool_response` 的 hook 都 broken（audit-log, failure-escalation, large-file-warner, suggest-compact, design-quality, ...）
  - intent-capture 仍 write file 但 `last_tool: <unknown>` — v2.7.2 cross-session resume degraded
  - `~/.claude/bash-commands.log` 從未存在（audit-log silent-skip）
  - 影響時點：user 升級到 2.1.141 之後（installedAt 顯示 2026-05-14T04:35:54Z）
- **Workaround paths** (next-step decision):
  1. **Downgrade**：`ln -sfn /home/cookys/.local/share/claude/versions/2.1.129 ~/.local/bin/claude` 後 fresh terminal 試。若 2.1.129 hook stdin 正常 → 確認 regression、pin 直到 upstream fix
  2. **Upstream report**：bug report 給 Anthropic Claude Code，附 ENXIO transcript 段
  3. **Hook design pivot**：tool-event hooks 不再依賴 stdin、改 read transcript file（CLAUDE_PROJECT_DIR/projects/*/latest.jsonl）— 大改、only if upstream 不修
- **Effort**: Downgrade test ~10min；upstream report ~30min；hook design pivot L-size
- **Source**: 2026-05-14 fresh-claude transcript `76a7e1b6-d73d-4164-9639-56d32347f95d.jsonl` + binary strings diff 2.1.141 vs 2.1.129

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
