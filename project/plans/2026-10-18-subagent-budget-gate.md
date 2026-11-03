# Plan — subagent budget gate: per-lane relay and turn ceilings on Agent dispatch

> Status: active · Owner: cookys · Branch: lane/budget · Frame: L, one deliverable
> Decisions: panel cards d-5b4415c1 (build the hook) and d-bdd886cb (lane key, escalation, thresholds), 2026-10-18.
> Proposal page: https://claude.ai/artifact/B3YBhb2FqpEVJ8Jd6mLN7g

## 0. Context / thesis

<host> `revival.3d` (2026-10-16 → 10-17) ran 104 sonnet subagents in a session with no session-mode level:
8758 API turns, about $715 at API prices for sonnet against $56 for the opus depth-0. Lanes were re-dispatched
again and again (bootux about 11 times, loaderef about 10). Nothing in autopilot counted that:

- foreman-guard on the no-marker path only counts Bash calls and emits an advisory every 40; it never denies
  (`hooks/foreman-guard.js:15-22`, `:553-574`). The 09-25 operator ruling kept it that way
  (`docs/backlog/foreman-guard-cost-shaped-gate.md:27-28`).
- The Agent/Task PreToolUse matchers (`hooks/hooks.json:128-147`) hold dispatch-model-guard,
  run-approval-gate and depth0-delegate-gate; none counts dispatches.
- cost-fuse and `scripts/lib/brain-spend.js:92-95` exclude subagent rows by the 10-12 owner ruling.
- The parallel-units recipe (`skills/l5/references/hetero-impl-loop.md:282-316`) is the documented shape for
  many lanes, and it has no relay, repair or turn ceiling. The only budget that survives a relay is the managed
  campaign's usage (`src/engine/implementation-campaign.js:918`, BUDGET_RESET), which that recipe bypasses.

The amplifier was "a relay is a fresh life with a fresh budget". This plan makes the relay chain of one lane share
one account, read from the transcripts themselves at dispatch time.

## 1. Problem

A depth-0 session can keep re-dispatching the same lane, and keep many lanes busy at once, with no ceiling and no
signal. The owner wants: per-root and per-lane counts of subagent turns and relays; at a ceiling, the hook stops the
dispatch once and escalates to the owner; every Agent dispatch shows the last hour's subagent spend and the
heaviest lane.

## 2. OKR / KRs

Objective: no lane can silently exceed its relay or turn ceiling, in any session mode.

- KR1: a 5th dispatch of the same lane (reviewers excluded) is denied, with or without a session-mode marker.
  Proof: hook test with fixture transcripts, marker absent and present.
- KR2: a dispatch for a lane whose transcripts already hold ≥300 turns is denied; a dispatch while the root's
  subagent turns in the last 60 minutes are ≥400 is denied. Proof: hook tests at 299/300 and 399/400.
- KR3: a dispatch whose brief carries `Budget-Ack: <reason>` passes and appends one decision-ledger row; one
  without it is denied. Proof: hook test reads the ledger file.
- KR4: on the first deny for a (session, lane) the hook opens exactly one owner panel card; a second deny for the
  same pair opens none. Proof: hook test counts cards in a temp panel store.
- KR5: every allowed Agent dispatch gets one `additionalContext` line naming last-hour turns, estimated USD and the
  heaviest lane. Proof: hook test matches the line.
- KR6: the hook fails open (allow, no output) on unreadable or missing transcripts and on any internal error.
  Proof: hook tests with no `transcript_path`, a corrupt jsonl, and an unreadable directory.
- KR7: p95 hook latency ≤300 ms over 200 fixture agent transcripts of 300 turns each, second call warm.
  Proof: timing test in the suite.
- KR8: cost-fuse and brain-spend behaviour unchanged. Proof: `scripts/p7-watcher-data.test.js` and
  `hooks/tests/cost-fuse.test.sh` stay green with no edits.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only. One new hook file `hooks/subagent-budget.js`; no new npm dependency.
- The hook never writes into a transcript or into `~/.claude/metrics/costs.jsonl`; it only reads them.
- Counts are re-derived from `<dirname(transcript_path)>/<session_id>/subagents/agent-*.jsonl` on every call;
  the only persisted state is a parse cache keyed by (path, size, mtimeMs) and the card pointer, both under the
  live-state dir (`scripts/lib/live-state-dir.js`), never under `/tmp`.
- Lane totals (dispatches, turns) use every transcript of the session whatever its age; only the root-hour total
  filters, by turn timestamp, and may skip files whose mtime is older than 60 minutes.
- Clock: one `now` sampled at hook entry (tests inject `AUTOPILOT_SUBAGENT_BUDGET_NOW_MS`). A turn counts toward
  the root hour when `now - 3600000 < ts <= now`; a `ts` later than `now` counts (skew errs toward the ceiling);
  a missing or unparseable `ts` counts toward lane totals but not toward the hour.
- Lane key: the first line among the brief's first 5 that matches `^Lane:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{0,63})[ \t]*$`;
  no match (absent, empty or malformed `Lane:` line) ⇒ the Agent tool's `description`, first line only, trimmed
  and lower-cased; empty description ⇒ no lane (the dispatch counts only toward the root total). A subagent
  transcript's lane is read by the same rule from its first user message, falling back to `description` in
  `agent-<id>.meta.json`. Only the first 5 lines are read, so a `Lane:` quoted later in a brief never matches.
- A brief whose first 5 lines hold `Role: reviewer` is excluded from the lane relay count; its turns still count
  toward the lane and root turn totals.
- Defaults: `lane_dispatch_max: 4` (the 5th is denied), `lane_turns_max: 300`, `root_turns_per_hour_max: 400`,
  `mode: remind` (also `warn`, `off`). Config `~/.autopilot/config.json` → `subagent_budget`; env
  `AUTOPILOT_SUBAGENT_BUDGET_{MODE,LANE_DISPATCH_MAX,LANE_TURNS_MAX,ROOT_TURNS_PER_HOUR_MAX}` override.
- Ack: a line `Budget-Ack: <reason>` (reason ≥ 8 characters) within the first 10 lines lets the dispatch through
  and appends a decision-ledger row (`kind decision`, `class tactical`, `decision_id budget-ack-<lane>-<n>`).
- Escalation: the hook itself calls `openDecision` from `scripts/open-decision.js`, deduplicated by a pointer file
  per (session, lane-or-root), exactly as `hooks/ask-decision.js:77-90` does.
- Estimated USD is display-only and never a threshold.
- Version stays 3.0.0; CHANGELOG `## Unreleased` gets one line.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. A new default-on hook that can deny a dispatch. Consumers
  (<host>) learn the `Lane:` and `Budget-Ack:` lines from the l5 reference and the CHANGELOG; `mode: warn|off` is
  the opt-out. No existing interface changes.
- **Dependency decision**: `existing`. Reuses `parseAssistantTurns`/`costOf` (`hooks/cost-tracker-lib.js`),
  `openDecision`, `decision-ledger.js`, `live-state-dir.js`, `config-path.js`. `parseAssistantTurns` gains an
  additive `ts` field (the record's `timestamp`) for the 60-minute window; cost-tracker ignores it.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `hooks/subagent-budget.js` | New PreToolUse hook (matcher `Task\|Agent`): derive counts, decide allow / deny / ack, open card, emit context line |
| `hooks/cost-tracker-lib.js` | `parseAssistantTurns` adds `ts` (additive) |
| `hooks/tests/subagent-budget.test.sh` (+ fixture builder) | KR1–KR7 cases and negative controls |
| `hooks/hooks.json` | Register the hook under `Task\|Agent` |
| `profiles/hook-classes.json`, `platforms/codex/plugin/profiles/hook-classes.json`, `baselines/claude-hooks.json` | Hook class registration and mirrors |
| `scripts/lib/config-keys.json`, `docs/settings-reference.md`, `settings.example.json` | `subagent_budget` keys and opt-out |
| `hooks/README.md`, `docs/hook-harness-matrix.md`, hook counts in `CLAUDE.md` / `README.md` / `README.zh-TW.md` | Inventory (`scripts/check-hook-inventory.js --check`) |
| `skills/l5/references/hetero-impl-loop.md` | `Lane:` / `Budget-Ack:` brief lines in the parallel-units recipe; new "Measurement and deploy-acceptance units" recipe |
| `docs/backlog/foreman-guard-cost-shaped-gate.md`, `docs/BACKLOG.md` (BL-0011) | Close BL-0011 (its trigger, a cheap per-agent feed, is met by reading the transcripts); record that the 09-25 no-marker ruling is superseded by this hook |
| `CHANGELOG.md` | One Unreleased line |

## 4. Phases

One deliverable; the phases build on each other inside it.

- **P1 (M) — hook core.** Counting from transcripts with the parse cache; lane key extraction; reviewer
  exclusion; the three ceilings; deny reason that names the ceiling, the counts, the `Budget-Ack:` line and the
  card; ack path with ledger row; card dedup; context line; fail-open. Done when KR1–KR7 pass and each negative
  control below is shown red then green.
- **P2 (S) — wiring and docs.** hooks.json, hook classes and mirrors, config keys and settings docs, inventory
  counts, l5 reference (brief lines and the measurement recipe), BL-0011 closure and supersession note,
  CHANGELOG. Done when `bash scripts/sync-all.sh --check`, `node scripts/check-hook-inventory.js --check`,
  `node scripts/doc-drift-gate.js` and `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` are green.

Measurement recipe content (P2): a fixed script (systemd unit or one shell entry point) runs the whole
measurement and writes a result table; a `test-runner`-role dispatch (`scripts/resolve-dispatch.sh --role
test-runner`, haiku) reads only the table and reports rc; depth-0 judges. Judgement steps (screenshots, A/B)
use sonnet with the turn ceiling stated in the brief.

## 5. Test / validation

Script-gated: the hook suite (KR1–KR7), KR8 suites unchanged, `node --test` for `cost-tracker-lib` if it has a
suite, affected suites from `node scripts/affected-suites.js --base develop`.

Negative controls (each shown red before green):
1. Make the lane count ignore `Lane:` (description only) — the `Lane:`-keyed relay case goes green-when-it-should-deny ⇒ red.
2. Drop the reviewer exclusion — the reviewer case is denied ⇒ red.
3. Make the ack match any line — a brief with `Budget-Ack:` and an empty reason passes ⇒ red.
4. Remove the pointer dedup — a second deny opens a second card ⇒ red.
5. Gate counting on the marker being present — the no-marker KR1 case passes ⇒ red.
6. Count turns from `costs.jsonl` instead of transcripts — the in-flight background agent case is not counted ⇒ red.
7. Age-filter lane totals (skip files older than 24 h) — the fixture with four old dispatches and 300 old turns
   is allowed ⇒ red.
8. Remove the lane-turn ceiling, then separately the root-hour ceiling — the 300-turn and 400-turn cases each pass ⇒ red.
9. Make the hour window inclusive at `now - 3600000` — the boundary case (a turn exactly 60 minutes old) counts ⇒ red.
10. Lower the reason minimum to 7 — a 7-character `Budget-Ack:` passes ⇒ red.
11. Drop the context line — the allowed-dispatch case finds no `additionalContext` ⇒ red.
12. Deny (or print to stdout) on a corrupt transcript — the fail-open cases see a deny or output ⇒ red.
13. Inject a 400 ms sleep per call — the latency test exceeds 300 ms p95 ⇒ red.

Human-gated: one live dispatch in this repo after merge (hook prints the context line on a real Agent call).
Replay of <host>'s real transcripts is offered to <host> (they hold them); not a merge gate.

## 6. Risks + inversion

What guarantees failure:
- The hook blocks legitimate work with no way through ⇒ `Budget-Ack:` always passes and is logged; `mode: warn`.
- Lane keys drift (description wording) ⇒ `Lane:` line documented in the brief recipe; fallback is best effort.
- Latency grows with long sessions ⇒ parse cache by (path, size, mtimeMs): an unchanged file is never re-parsed,
  and only the root-hour total may skip files by mtime; KR7.
- The hook crashes and takes dispatch with it ⇒ fail-open on every error path; it is its own process, separate
  from dispatch-model-guard.
- Counting ignores in-flight background agents ⇒ transcripts are read directly, not `costs.jsonl` (negative
  control 6).
- `transcript_path` absent on the Agent PreToolUse payload ⇒ fail-open with a stderr note. Local evidence that it
  is present: foreman-guard, a PreToolUse hook, reads it (`hooks/foreman-guard.js:272-282`) and fired live on <host>.

## 7. Out of scope

- External engines a foreman starts through Bash (`dispatch-hetero.sh` → grok, codex): no Claude turns, not seen.
- cost-fuse and brain-spend stay brain-tier only (10-12 ruling stands).
- A concurrency ceiling (simultaneous live subagents): the root-hour turn ceiling covers the burn; liveness is
  not reliably observable from transcripts.
- Distinguishing repair from relay: one counter per lane.
- Cross-host aggregation.

## 8. Open questions

None; the owner settled lane key, escalation and thresholds on d-bdd886cb.

## Review log

- R0: authored 2026-10-18 by depth-0 from the research of the two read-only reports and the <host> incident data.
  Manifest `docs/plans/2026-10-18-subagent-budget-gate.plan-review-manifest.json`, rubric `.rubric.md` beside it.
- G1 (sol_chair STOP, minimax_deep CONDITIONAL; verdict CONDITIONAL): four findings, all accepted and folded —
  dadf2c6d (R1, lane totals no longer age-filtered), 271d9846 (R2, clock and window defined), b057b148 (R11,
  controls 7–13), ad1bb97b (R4, slug grammar and lane-key failure modes).
