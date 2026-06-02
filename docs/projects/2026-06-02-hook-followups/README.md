# Hook Follow-ups Batch (post-v2.8.0)

> **Status**: 🚧 In progress · **Size**: L · **Branch**: `feat/hook-followups`
> **Started**: 2026-06-02 · **Plan**: this README (self-contained) · **Target version**: v2.8.1 (confirm at finish-flow)

## OKR

**Objective**: Close the actionable hook follow-ups left open after the v2.8.0 transcript pivot — re-enable `suggest-compact` *correctly* (with a regression test), give users a **deterministic** way to tell their PostToolUse dispatch died and recover, and bring the two stale hook docs in line with v2.8.0 reality.

**Key Results**:
- KR1 — `suggest-compact` fires again on `Write|Edit` and its counter actually increments (today it dies on the ENXIO `/dev/stdin` read before counting), **guarded by a unit test** proving increment-survives-ENXIO and threshold boundaries; opt-out env flag; reconciled README rows.
- KR2 — `hooks/README.md` gains a **docs-only** "Is my dispatch dead?" section: a deterministic check procedure + recovery (full restart). The auto-detector heuristic is **deferred to a BACKLOG spike** (R1 dialectic: non-functional as designed — see Decision below).
- KR3 — BACKLOG "Re-enable v2.7.4 disabled hooks" entry narrowly updated: only the 3 log-only lines (audit-log/log-error/failure-escalation, re-enabled via v2.8.0 transcript pivot) change; the PreToolUse "permanently unrecoverable" note is preserved.
- KR4 — `hooks/README.md` documents `/compact` (slash command) ≠ real PreCompact for testing, citing the BACKLOG empirical source for the auto-compact-pipes claim (no fresh unverified assertion).

## Scope
In: the 4 actionable BACKLOG items. Out: blocked items (3 PreToolUse blockers — permanently unrecoverable; upstream #6305 comment — external), per CEO focus-as-subtraction.

## P0 loop review — RESOLVED (think-tank-dialectic, 2026-06-02)
**KR2 vote: 0/5 for "ship heuristic (a)"; 3× docs-only (b), 2× defer (c).** HIGH consensus that option (a) is **non-functional**, not merely risky, on three independent grounds:
1. **Wrong key**: the intent file is keyed by `sha1(realpath(cwd))`, *not* session_id (verified in `intent-capture.js`). The session_id-mismatch discriminator reads a cwd-keyed file.
2. **Write-ordering**: SessionStart runs at process boot, *before* the new session's first PostToolUse writes the new session_id — so the file still shows the prior session_id, indistinguishable from a dead-dispatch `/clear`.
3. **Timing misalignment**: dispatch dies mid-session after `/clear`; SessionStart only fires at the *next* entry (already a fresh, live process). A warning there is after the failure window.
4. **Bad oracle**: `intent.tool_count` is written by the very PostToolUse hook that is dead — it cannot be the liveness signal. The transcript is the only core-written oracle, but it is often unflushed/absent at SessionStart.

**CEO decision (DOA-internal, recorded)**: synthesize (b)+(c) — ship docs-only now (KR2 above), defer the heuristic to a spike-gated BACKLOG entry (verify `CLAUDE_CODE_SESSION_ID` behavior across `startup`/`clear`/`compact` empirically before any detector code). Rule 3 auto-downgrade applied; R2 is a **re-check of these fixes**, not a fresh deliberation.

## P0 R2 re-check — 5/5 RESOLVED (2026-06-02)
No blocked, no major residual. Documentation-precision asks folded into implementation:
- **KR1 stdin guard**: restructure so `/dev/stdin` read is in an **inner** try and the counter increments *after* it — not a top-level wrap (the test pins increment-survives-ENXIO).
- **KR1 hook tally**: reconcile ALL tally sites, not just CLAUDE.md L9 — hooks/README.md L3 mirror + L138 "Tier B (6 hooks)" (pre-existing 7-vs-6 drift) + README.md L565 "8+6" (different basis). Verify counts against reality; introduce no new contradiction.
- **KR2 docs**: specify run a **Bash** tool (bash-commands.log only fires on Bash matcher); bash-commands.log is the **primary** oracle (intent-capture can self-disable via circuit breaker → false dead); note the check is valid only on **v2.8.0+**; phrase the probe as run-from-the-current-session (not self-referential); one line that it proves the hook *subsystem* is live.
- **KR1 /tmp note**: state explicitly that on session-id collision an inherited count can cross a threshold on the first tool call.

## R1 findings folded into scope (all addressed)
- **KR1 is bigger than "guard stdin"** (all 5 roles): (i) add `suggest-compact.test.js` — counter increments when `/dev/stdin` throws ENXIO + threshold boundaries (49 silent / 50 warn / 51-74 silent / 75 warn); (ii) reconcile the two contradictory `hooks/README.md` rows (one says "deferred", one says active "50/75/100") **and** the threshold drift (code is unbounded `50 then every 25`, doc implies a 100 cap); (iii) add `AUTOPILOT_SUGGEST_COMPACT=false` opt-out + document hooks.json removal as rollback; (iv) **document** (do not unify — that is its own refactor) that suggest-compact's `/tmp/claude-tool-count-{sid}` counter is intentionally separate from intent-capture's (different matcher, different purpose), and note the fallback-key divergence + no-GC `/tmp` litter as known/accepted; (v) update the CLAUDE.md "19 hooks (12 default-on, 7 opt-in)" tally when suggest-compact flips opt-in→default-on.
- **KR2 docs**: the "how to tell" procedure must be **deterministic** (e.g. "run any Bash tool, then check whether `~/.claude/bash-commands.log` gained a line or `~/.autopilot/intent/<cwd-sha1>.json` `last_updated` advanced; if not after a tool call, dispatch is dead → fully restart"). No heuristic prose that just relocates the false-signal problem.
- **KR3**: scope narrowly — preserve the PreToolUse note; do not over-delete.
- **KR4**: cite the BACKLOG 2026-05-14 method-B observation for "auto-compact pipes payload" rather than asserting it fresh (spike-before-assert).
- **P5**: explicitly run `scripts/preflight-release.sh` (CLAUDE.md L-5.5 mandate for version-bumping ships) in addition to validate/hook-tests/preflight-portability.

## L-1.5 Scope completeness audit
| Dimension | In/out |
|-----------|--------|
| Source | ✅ suggest-compact.js stdin guard + opt-out (P1); hooks.json Write\|Edit matcher (P1) |
| Tests | ✅ `suggest-compact.test.js` (P1) — ENXIO-increment + threshold boundaries |
| Docs | ✅ hooks/README.md row reconcile + "Is my dispatch dead?" + /compact caveat (P1/P2/P4); BACKLOG rewrite (P3); CLAUDE.md hook tally (P1) |
| CHANGELOG / version | ✅ P5 — sync-version.js mirrors + preflight-release.sh |
| Cross-platform | ✅ no new bash (KR2 is docs-only); preflight-portability at P5 |
| Migration / consumers | ❌ none — additive, fail-open |
| Rollback | ✅ AUTOPILOT_SUGGEST_COMPACT opt-out + hooks.json removal documented |
| Dogfood | ✅ P1 run the test; P2 the deterministic check exercised against this repo |

## Phases
| Phase | Status | What |
|-------|--------|------|
| P0 — loop review (dialectic) | ✅ R1 + R2 done (5/5 resolved) | Resolved KR2 → docs-only + spike-defer; folded R1+R2 findings |
| P1 — suggest-compact re-enable (full scope) | ⬜ | stdin guard + opt-out + Write\|Edit matcher + test + README row reconcile + hook tally |
| P2 — "Is my dispatch dead?" docs + spike BACKLOG entry | ⬜ | Deterministic check + recovery in hooks/README.md; BACKLOG spike entry for the deferred heuristic |
| P3 — BACKLOG re-enable entry rewrite (narrow) | ⬜ | Only the 3 stale log-only lines; preserve PreToolUse note |
| P4 — /compact testing caveat doc | ⬜ | hooks/README.md, citing BACKLOG method-B source |
| P5 — quality gate + finish-flow | ⬜ | validate, hook tests, preflight-portability, **preflight-release**, CHANGELOG/version, merge to develop |

## DOA notes
- Merge to `develop --no-ff` is within CEO DOA once P5 gates pass.
- KR2 a/b/c was tactical-within-goal → CEO decided post-dialectic (b+defer-a), recorded above.
