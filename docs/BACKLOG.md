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

### Claude Code tool-event hooks get NO stdin pipe — event-type-specific, not version regression
- **Trigger**: 立即（影響所有 PreToolUse / PostToolUse hooks since hooks were authored）
- **Context**: 2026-05-14 兩輪 fresh-claude transcript 驗證收斂：
  - **Round 1 (2.1.141)**: 11 tool-event hook fires 全 ENXIO opening `/dev/stdin`
    - transcript `76a7e1b6-...jsonl`
    - PostToolUse:Bash × 4 + PreToolUse:Bash × 3 + PreToolUse:Read × 2 全部 ENXIO
    - SessionStart + Stop 正常
  - **Round 2 (2.1.129 downgrade test)**: 同 transcript 結構 `7bd61ac4-...jsonl`，**同 ENXIO**，`~/.claude/bash-commands.log` mtime 沒動
  - **2.1.128 binary strings**: 無 `EPIPE.*hook` markers（同 2.1.129），同類 issue 推斷一致
- **Final root cause**: 不是版本 regression — 是 **Claude Code 的 hook stdin pipe 對 PreToolUse / PostToolUse event 從來沒運作**（at least on Linux + this Bun-spawned Node 環境）。SessionStart 跟 PreCompact 用不同 spawn path 所以 work
- **Critical implication**: Anthropic docs 內附 example `jq -r '.tool_input.command' >> ~/.claude/bash-log.txt`（給 PreToolUse Bash logging）**也是 broken** — 不只我們 hooks 受影響、官方 docs example 也跑不動
- **Impact** (all silent due to fail-open hook convention):
  - 所有依賴 `tool_input` / `tool_response` 的 hook 都 broken（audit-log, failure-escalation, large-file-warner, suggest-compact, design-quality, ...）
  - intent-capture 仍 write file 但 `last_tool: <unknown>` — v2.7.2 cross-session resume degraded
  - `~/.claude/bash-commands.log` 從未存在（audit-log silent-skip）
  - autopilot tool-event hooks 從未 e2e tested via real Claude Code dispatch（過去只 heredoc synthetic 測 script 本身）
- **Workaround paths** (next-step decision):
  1. ~~Downgrade~~ **RULED OUT** by Round 2 test
  2. **Upstream report**：bug report Anthropic — 含官方 PreToolUse Bash example broken + ENXIO transcripts；reproducible
  3. **Hook design pivot**：tool-event hooks 改 read transcript JSONL（path = `~/.claude/projects/-<cwd-encoded>/<CLAUDE_CODE_SESSION_ID>.jsonl`）；PreToolUse 救不了（tool 還沒 run、transcript 還沒寫 entry）；PostToolUse 可救
  4. **Disable broken hooks**：承認 audit-log + failure-escalation 等在這環境跑不動、從 hooks.json 拔掉、改文件警告 user
- **Effort**: (2) ~30min；(3) L-size ~6-10hr；(4) S ~30min
- **Recommendation**: (2) + (4) 同時做。(2) push 上游修；(4) 立即 reduce 假象 hook 跑、清理 hooks.json。等 1-2 週 upstream 無回應再考慮 (3)
- **Source**: 2026-05-14 fresh-claude transcripts `76a7e1b6-...` (2.1.141) + `7bd61ac4-...` (2.1.129)；binary strings 2.1.128/129/141 對比

### Re-enable v2.7.4 disabled hooks once upstream stdin-pipe lands
- **Trigger** (任一觸發即跑驗證、全綠才 re-enable):
  1. Claude Code release notes 提到 hook stdin / PreToolUse / PostToolUse fix
  2. autopilot user 在 issue / discussion 報「audit-log 突然有 entries」「branch-protection 真的 block 了」
  3. 距 v2.7.4 ship 過 30 天且想主動 re-test（避免無限拖延）
  4. 跑 path (3) transcript-file pivot 前先做這個 verification — 確認還是 broken 才值得寫 L-size code
- **Verification recipe**:
  1. `cd ~/projects/autopilot && scripts/toggle-payload-capture.sh enable`
  2. 新 terminal 跑：`AUTOPILOT_CAPTURE_PAYLOAD=1 claude`（用 current version OR 指定 binary path）
  3. 在 fresh claude 跑 `echo TEST_$(date +%s)` + read a small file + exit
  4. `ls ~/.autopilot/payloads/` — **要看到 4 個檔（pre-bash + post-bash + pre-read + post-star）**且 stdin_parsed 不是 null
  5. 同 transcript（最新 jsonl in `~/.claude/projects/-home-cookys-projects-*/`）grep `"stderr":"[^"]*ENXIO"` 必須 **0 hits**
  6. `scripts/toggle-payload-capture.sh disable`
- **Re-enable order** (低風險 → 高風險，每加一個跑 1 fresh claude 驗 artifact 寫):
  1. **Log-only / no block**: `log-error` → `cost-tracker` → `session-summary` → `audit-log` → `failure-escalation` → `suggest-compact`
     - 每個 re-enable 後 fresh claude 1 Bash、確認對應 artifact 寫了東西（`~/.claude/bash-commands.log` 增 row、`~/.claude/metrics/costs.jsonl` 增 row 等）
  2. **Blockers**（最後，因為錯誤行為會 break workflow）: `large-file-warner` → `branch-protection` → `commit-secret-scan`
     - 每個都試一個 **正常操作不被誤 block**（read small file、commit secret-clean code、push to feature branch）
     - 再試一個 **應該 block 的操作** 驗真的 block（read 5MB 檔、push to main、commit with 假 API key）
- **Effort**: Verification ~15min；6 log-only hooks 重 wire + smoke ~30min；3 blockers 重 wire + 雙向 smoke ~45min。Total Fix-cycle ~1.5hr
- **Rollback**: 任何 re-enable 後出現問題 → `git revert <re-enable-commit>` + `/reload-plugins` OR 直接 edit hooks.json 拔回 v2.7.4 狀態
- **Don't forget**: re-enable 完同步 CHANGELOG（v2.7.5 entry）+ `hooks/README.md` 拔掉 v2.7.4 disable batch section
- **Source**: 2026-05-14 v2.7.4 disable batch ship（`c5e5a4c`）

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
