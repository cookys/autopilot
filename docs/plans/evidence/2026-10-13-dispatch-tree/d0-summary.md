# D0 measurement summary (dispatch-tree plan, section 4 and section 7)

Source of truth: `d0-result.json` (written by `d0-probe.sh`, claude 2.1.299). Raw dumps (secret-scanned and redacted): `d0-raw/<row>/`.
Re-run: `bash d0-probe.sh --out d0-result.json`. Negative control: `AUTOPILOT_RUNS_WATCH_AUTOSTART=0 bash d0-probe.sh --omit-sentinel --out <f>` must report row a `bad` (exit 0); it did, and the normal run reports row a `pass`.

| Row | Status | Blocks | Evidence |
|-----|--------|--------|----------|
| a | pass | 3a, 3b | `d0-raw/a/` |
| b | pass | 3a | `d0-raw/b/<shape>/` |
| c | pass | 3a, R | `d0-raw/c/` |
| d1 | pass | R | `d0-raw/d1/` |
| d2 | **bad** | R | `d0-raw/d2/` |
| e | pass | R | `d0-raw/e/` |
| f | pass | 3b, R | `d0-raw/f/` |
| g | pass | 5 | `d0-raw/g/` |
| h | **bad** | 5 | `d0-raw/h0,h1,h2/` |
| i | pass | 5 | `d0-raw/i/` |
| j | not_run | none | no step 3c yet; defined as a one-day-later check |
| k | pass | R | `d0-raw/k/`, `d0-raw/e/calls.json` |

## Conclusions

- **a pass**: `claude -p --session-id u` fires SessionStart with payload `u` (cwd settings sentinel and plugin path both), the plugin writes `u.json`, and Bash sees `CLAUDE_CODE_SESSION_ID == u`. Step 3a and 3b are not blocked by this row.
- **b pass**: in all four shapes (author/review x claude-native/cc-shim) a SessionStart hook fired with payload id == manifest `child_session_id`. `--settings` flag, `<cwd>/.claude/settings.json` and `--plugin-dir` all fired under `--setting-sources project --strict-mcp-config --tools ""`; the user-scope installed plugin did NOT fire (only project-scoped mechanisms do). Hooks also saw `AUTOPILOT_PARENT_SESSION_ID`; see detail per shape.
- **c pass**: a real hetero cc-shim child (minimax endpoint) wrote `<child>.json` with `parent_session_id == P`.
- **d1 pass**: foreman nested rail manifest: `session_id` null, `parent_run_id` = foreman run, depth 1.
- **d2 BAD (codex path)**: the inner Claude's marker exists and names itself, but `parent_session_id` is empty: the codex runner path exports `AUTOPILOT_PARENT_RUN_ID`, depth and root run id, but not `AUTOPILOT_PARENT_SESSION_ID`, and the codex task's `CLAUDE_CODE_SESSION_ID` is the outer session (inherited), so a marker cannot name the outer session as parent. The outer marker stayed unchanged and the nested manifest `parent_run_id` equals the harness run (both OK). kimi, agy, opencode: `not_run` (no provider credentials under an isolated HOME; real `~/.kimi-code` must not be touched) = bad by the plan's rule. **Plan section 7 design change: stop; plan revised and re-reviewed before R.**
- **e pass**: top-level and foreground-subagent Bash both see the session `CLAUDE_CODE_SESSION_ID` (background subagent too).
- **f pass**: nested rail from the claude child writes the child's own id, `parent_run_id` = outer run, depth 1.
- **g pass**: `updatedInput` without `permissionDecision` is applied (`echo A` -> `echo B`, top and subagent); the hook payload carries `agent_id` for subagents, absent for top level.
- **h BAD**: an `export AUTOPILOT_ORIGIN_AGENT_ID=...; ./rail.sh x` rewrite makes the command compound, and the allow rule `Bash(./rail.sh:*)` no longer covers it: headless -p returned is_error "This Bash command contains multiple operations. The following part requires approval: export ...". Control without rewrite: allowed. The inline-assignment form (`VAR=x ./rail.sh`) is also not allowed ("requires approval"). Headless -p auto-denies the would-be prompt immediately as is_error. **Plan section 7 design change: step 5 not shipped.**
- **i pass**: rewrite and stamp survive the plugin's default-on Bash PreToolUse hooks. Moot while h is bad.
- **j not_run**: needs step 3c plus one day; non-blocking.
- **k pass**: foreground and background Agent launches both carry `toolUseResult.agentId` and a `tool_use_id` equal to the subagent `meta.json` `toolUseId`.

## Steps

- 3a, 3b, 3c: not blocked by D0 (a, b, c, f pass).
- 5: blocked (h bad).
- R: blocked (d2 bad, kimi/agy/opencode not_run), plan must be revised and re-reviewed first.

## Re-run 2026-10-15 after 3b (row d2)

`bash d0-probe.sh --rows d2` at `bae71599` (3b merged as `92002f7f`), claude 2.1.300; result and raw dumps in
[`d0-rerun-2026-10-15/`](d0-rerun-2026-10-15/d0-result.json) (secret scan: 0 hits, 0 redactions).

- **d2 codex path: pass.** The codex child now sees `AUTOPILOT_PARENT_SESSION_ID` = the outer session and no
  `AUTOPILOT_SESSION_ID`; the inner Claude's marker names itself with `parent_session_id` = the outer session; the
  outer marker is unchanged; the nested manifest `parent_run_id` = the hetero run, `session_id` = the inner session.
- kimi, agy, opencode remain `not_run` (no provider credentials under an isolated HOME), so by the plan's rule
  R stays blocked until they run in a credentialed environment. Row h (step 5) is unchanged: still bad.

## Re-run 2026-10-15 after 3d (rows d2, l)

`bash d0-probe.sh --rows d2,l` on `30219b0a` (3d merged) plus the probe edit in this commit, claude 2.1.300; result and
raw dumps in [`d0-rerun-2026-10-15b/`](d0-rerun-2026-10-15b/d0-result.json). One real run, no retry. Secret scan:
the probe's redactor masked the endpoint token values in 5 env dumps (names kept, values `REDACTED`); the follow-up
scan found 0 remaining hits.

- **d2 codex path: pass, judged by the post-3d rule** (plan section 7 row d2 note: the rail mints no child id for a
  non-Claude harness, so the inner marker carries no parent). The inner Claude's marker `parent_session_id` is absent,
  the outer marker is unchanged, and the nested manifest `parent_run_id` = the hetero run. This replaces the 3b-era
  codex pass above, which was measured against the old wording (inner marker names the outer session).
- **l pass** (new row, one hetero cc-shim run through the minimax seat). The child's SessionStart hook environment had
  `AUTOPILOT_CHILD_SESSION_ID` = manifest `child_session_id` = its `--session-id`; the child's own marker has
  `parent_session_id` = the launcher P; a second `claude -p` started by a real `tmux new -d` (private socket, killed
  afterwards) inherited the same `AUTOPILOT_CHILD_SESSION_ID` in its hook environment, yet its own session id differs
  and its marker has no `parent_session_id`. The tmux-held variable is therefore harmless, which is what 3d claims.
- **Negative control for row l.** The verdict is a pure function (`judge_l` in `d0-probe.sh`). It was fed fake hook env
  and marker files offline: a tmux marker carrying a parent, a hook env without C, a child marker without parent, a
  missing tmux marker, and a `--session-id` that differs from C each produced the matching failed condition; the good set
  produced none. No second paid run was made.
- kimi, agy, opencode remain `not_run` (no provider credentials under an isolated HOME), so R stays blocked on them.
  Row h (step 5) is unchanged: still bad.

## Re-run 2026-10-18 (row d2, kimi cell)

One real `dispatch-author.sh --runner kimi` run (kimi 2.2.0, credential staged into an isolated HOME; real `~/.kimi-code`
not handed to the child), evidence in [`d0-rerun-2026-10-18/`](d0-rerun-2026-10-18/README.md).

- **d2 kimi path: pass** (post-3d rule). The kimi child printed its own environment: `AUTOPILOT_SESSION_ID`,
  `AUTOPILOT_CHILD_SESSION_ID` and `CLAUDE_CODE_SESSION_ID` unset, `AUTOPILOT_PARENT_SESSION_ID` = the resolved parent,
  parent run id, depth and root run id carried; the rail manifest has `child_session_id` null, `parent_run_id` = the outer run.
  This replaces the "kimi: `not_run`" line above for kimi. agy and opencode remain `not_run` (no credentials on this host's
  run).
