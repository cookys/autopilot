# Plan — workflow snapshot at compaction and /clear (replace the transcript tail)

> Status: **active, size L (P1-P2 and P4 landed on branch `feat/workflow-snapshot-at-compaction`; P3 deferred)** · Owner: depth-0 · Source: BACKLOG row "Workflow snapshot at compaction and /clear (replace the transcript tail)"; evidence `docs/plans/evidence/2026-10-12-context-reset-cost/README.md`.

## 0. Context / thesis

On 2026-10-13 a real auto-compaction restored a 2.5 KB `<autopilot-restored-state>` block that was mostly `[tool_use: Bash(...)]` placeholders. The owner relies on autocompact (window 400k) instead of stopping for `/clear`, so what survives a compaction has to be the workflow state, not a transcript tail. That state is already on disk in six places; nothing reads them together.

## 1. Problem

At `PreCompact`, `hooks/state-checkpoint.js` saves the last 20 transcript turns (8 KB cap) plus host, time and session id. After compaction `session-start.js` (source `compact`) injects the file. It names no dev-flow stage, size, level, task list, dispatch, review state or branch. The `/clear` path (`hooks/session-handoff.js`, enabled by `handoff_inject`) writes its own handoff from git and the transcript tail, with the same gap.

## 2. Design

### 2.1 Finding: where PreCompact stdout goes (verified, not assumed)

- Docs (`code.claude.com/docs/en/hooks`, 2026-10-13): PreCompact is not in the list of events whose plain-text stdout becomes model context (that list is `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`). `systemMessage` and `continue` are discarded for PreCompact. The page does not state where PreCompact stdout goes.
- Binary (Claude Code 2.1.296, read-only string search): the PreCompact runner builds `H = results.filter(succeeded && !blocked && output.trim()).map(output.trim())` and returns `newCustomInstructions`; every compaction call site passes `customInstructions: merge(<user /compact text>, result.newCustomInstructions)` into the summary request. So exit-0 stdout is merged into the **summarizer's custom instructions**. It never reaches the model directly.
- Consequence: stdout must be addressed to the summarizer ("preserve the following verbatim"), kept small, and diagnostics stay on stderr. The model sees the state a second time through the file that `session-start.js` injects after compaction. Not yet observed live: the next real auto-compaction must show the snapshot text surviving in the summary (see §5).

### 2.2 The collector (P1)

`scripts/lib/workflow-snapshot.js` (Node, built-ins only) exports `collect(opts)` returning `{ lines, sources }` and `render(snapshot, {maxBytes})`. Input is explicit: session id from the hook payload (never the cwd fallback of `session-mode.js getSessionId`), payload `cwd`, and injectable directories for tests. Every source is optional and fail-open: a missing, unreadable, malformed or stale source yields one named line `<source>: absent (<reason>)`, never an invented value.

| Source | Read from | Shown |
|--------|-----------|-------|
| session mode | `readSessionRecord(sid)` (`~/.autopilot/session-mode/<sid>.json`) | level, size, urgent/bug/high-risk, stage, unit, root run id |
| next legal node | `<live>/stage/<sid>.json` if present, else `stage-graph.js nextNodes` from marker size+stage | legal next nodes |
| git | `git -C cwd` (branch, short HEAD, dirty count, upstream ahead/behind not needed) | branch, HEAD, dirty |
| task card (P2) | `~/.autopilot/task-card/<sid>.json` | goal, success criteria, plan path, review ledger path, requirements |
| session tasks | `<live>/tasks/<sid>.json` | counts, the in-progress task, up to 6 open subjects |
| code review | `<live>/review-rounds/<project_key>.json` | phase, generation, head, seat verdicts, converged |
| plan review | not collected in P1 (the state key is derived from a session key the collector cannot reproduce; scanning ~30 dirs is not done) | one `absent` line naming the reason |
| decision ledger | task card `ledger` path, else newest `docs/projects/*/ledger/decisions.jsonl` under 24 h old (labelled as such) | last 3 decisions |
| in-flight dispatches | `${TMPDIR}/autopilot-dispatch-runs/*.manifest.json` where `root_run_id` is the marker root or one of its `campaign_roots` and `ended_at` is null | up to 5 rows |
| subagent roster | `<live>/agents/<sid>/*.json` (already written by SubagentStart/Stop, `autopilot.agent-activity/1`) | total, un-ended, up to 5 live rows |

Bounds: the stdout form is at most 3000 bytes, the file form at most 6000 bytes; both are cut on a line boundary with a final `... N lines omitted` line. The roster directory is never read whole (readdir, stat, newest 40 only).

### 2.3 Hook wiring

- `state-checkpoint.js`: the saved file now starts with `## Workflow Snapshot`. The transcript tail is **kept but shrunk**: the last 6 turns that have text after stripping `[tool_use...]` / `[tool_result...]` placeholder lines, at most 3 KB (the newest turn stays verbatim), under the existing `## Transcript Tail` heading. Rationale: the snapshot answers "where am I"; the last words answer "what was I about to say", which no disk source holds. The old 20-turn / 8 KB defaults are retired (env knobs `TRANSCRIPT_TAIL_N`, `TRANSCRIPT_BYTE_CAP` remain).
- PreCompact stdout: `Preserve the following workflow state verbatim in the compaction summary:` plus the 3000-byte snapshot. Knob `AUTOPILOT_PRECOMPACT_STDOUT=0` turns it off (default on; reversible with no code change).
- `session-handoff.js` (SessionEnd, `/clear`): the same collector output replaces its "Repo state / Last action" git+transcript guesses; its own git sections stay as the fallback when the collector throws.

### 2.4 P2: the two gaps, only as far as P1 needs

- **Task card**: `scripts/task-card.js set|show|clear` writes `~/.autopilot/task-card/<sid>.json` (goal, success[], plan, review_ledger, ledger, requirements[]; size-capped fields; atomic write). Size S. The collector only reads it. Teaching dev-flow to call it is a change to what a skill asks for: **guidance, needs ON/OFF eval, out of this run** (listed with P3).
- **Subagent roster**: already exists as `<live>/agents/<sid>/<agent_id>.json` (id, type, last tool, ended_at). The collector reads it. The one missing field is a human-readable description of what the agent was asked, which lives in the `Agent` tool_input on PostToolUse (host `audit-log.js`), not on SubagentStart. Adding it touches the hot PostToolUse host: **larger than S, stopped here**; the roster ships with id/type/last-tool only.

### 2.5 P3 (not in this run)

`/handoff` skill reads the snapshot instead of rebuilding it by hand. That edits skill guidance: needs eval ON/OFF evidence (CLAUDE.md scorecard-first). Same bar for dev-flow calling `task-card.js`, and for moving the "six categories" LLM-context instructions into the summarizer-side stdout.

### 2.6 P4: PostCompact check

Landed in `hooks/state-checkpoint.js` (a `PostCompact` entry in `hooks.json` reuses the same stem, so the hook count stays 37; no separate file). Payload `compact_summary`: when the marker or git gives a branch/stage and the summary lacks either (branch substring, stage whole word), append one `compact-summary-lost-state` advisory through `hooks/_shared/advisory-sink.js` and log `postcompact_*` to `.state-checkpoint.log`. Advisory only, never blocks (PostCompact has no decision control). The stage test is weak for common-word stage names.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node >= 20.10, built-ins only, for every new script and hook.
- Hooks stay fail-open (exit 0 on any error) and fast; the collector runs at most 4 git or fs-heavy steps and must finish in under 1 s on a 250-file roster directory.
- No trust machinery (ADR-0001): the snapshot is a read of state, never a signed claim.
- A missing source is a named "absent" line, never an invented value.
- No version bump (held at 3.0.0); CHANGELOG Unreleased entry in zh-TW.
- Do not touch `mods/live/` or `docs/plans/2026-10-13-live-pane-design-system.md`.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`. The compaction file's layout changes; its only reader is `session-start.js`, which injects it as opaque text. The L2 tests that assert on the old layout are updated.
- **Dependency decision**: `none`.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/lib/workflow-snapshot.js` | collector + renderer (P1) |
| `scripts/task-card.js` | task card CLI (P2) |
| `scripts/stage-graph.js` | export `nextNodes` (one-line mechanism change) |
| `hooks/state-checkpoint.js`, `hooks/state-checkpoint-lib.js` | snapshot first, short last words, stdout |
| `hooks/session-handoff.js` | use the collector at `/clear` |
| `hooks/state-checkpoint.js` (PostCompact branch), `hooks/hooks.json` | P4 |
| `scripts/lib/workflow-snapshot.test.js`, `scripts/task-card.test.js`, `hooks/state-checkpoint-snapshot.test.js` | tests |
| `CLAUDE.md`, `docs/scripts-inventory.md`, `references/`, `hooks/README.md`, `CHANGELOG.md` | wiring and docs |

## 4. Phases

| Phase | Size | Acceptance |
|-------|------|------------|
| P1 collector + hook wiring + `/clear` | M | each source present / absent / malformed is tested; size bound holds; hook stdout equals the snapshot and the file leads with it; one mutation per behaviour reds a test |
| P2 task card CLI (roster: stop, see §2.4) | S | `set/show/clear` round trip; collector shows the card; malformed card reads as absent |
| P3 `/handoff` uses the snapshot, dev-flow calls `task-card.js` | S | **deferred: guidance, needs eval ON/OFF evidence** |
| P4 PostCompact check | S | advisory written when the summary lacks branch and stage; silent when it has them; never exits non-zero |

Order: P1 -> P2 -> P4; P3 independent and later.

## 5. Test / validation

- Script-gated: `node --test scripts/lib/workflow-snapshot.test.js`, the affected `hooks/tests/state-checkpoint-*.test.sh`, `session-handoff.test.sh`, `session-start.test.sh`, `check-claude-md-inventory.js`, `check-hook-inventory.js`; run one at a time.
- Human-gated, not done: the next real auto-compaction must show (a) `.state-checkpoint.log` `success`, (b) the snapshot lines in the restored block, (c) the snapshot text (branch, stage) in Claude Code's own summary. A manual `/compact` pipes `trigger: manual` and `custom_instructions` per the docs and may be used for a first look; the auto path remains the authority.

## 6. Risks + inversion

- Stdout steers the summarizer: a long or imperative block could crowd the summary. Mitigation: 3000-byte cap, one fixed sentence of framing, knob to turn off.
- A stale marker or task file shows an old stage as current. Mitigation: marker expiry is honoured, files older than 24 h are labelled `stale`, every line carries its source.
- A guessed ledger path shows another project's decisions. Mitigation: the newest-by-mtime fallback is labelled as such and bounded to 24 h.
- What guarantees failure: the collector throws inside the hook and the file is not written. Mitigation: each source is wrapped; the hook writes the old-style file when the whole collector fails.

## 7. Out of scope

P3; the `Agent` description capture; plan-review state lookup; any edit to `mods/live/`; a version bump.

## 8. Open questions

1. Should the summarizer-side stdout also carry the "six categories" instructions now in the LLM Context section of the checkpoint file? (guidance, eval bar)
2. Is a 3000-byte stdout the right ceiling, or should it be smaller until one live compaction shows how the summarizer treats it?

## Review log

No plan review yet (author draft R0, 2026-10-13).
