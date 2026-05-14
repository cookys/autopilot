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

### Investigate intent-capture auto-fire stagnation post-reload
- **Trigger**: 下次 reload + 長時間運行同 session 時觀察 intent file mtime 是否持續更新
- **Context**: 2026-05-14 post-`/reload-plugins` 測試：intent-capture 自動觸發了 ~20 次（count 從 ~5 跳到 25），然後 9 分鐘 + ~10 個 Bash tool call 無動靜（mtime 卡 19:08）。手動 fire `node intent-capture.js` 仍 work（count 26）→ script OK、Claude Code 那層 stop dispatching `.*` matcher hook 給 intent-capture。Possibly Claude Code hook re-load 後一段時間就停 dispatch / matcher cache 失效 / 別的內部 throttle。不影響 v2.7.2 整體 design（fresh session 應該還是 fire）但 reliability 待澄清
- **Effort**: S investigation, 解法待診斷後決定
- **Source**: 2026-05-14 v2.7.2 post-reload verification

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
