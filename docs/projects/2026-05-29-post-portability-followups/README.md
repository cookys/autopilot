# Post-Portability Follow-ups

**Status**: ✅ Shipped 2026-05-29 (v2.7.4)
**Branch**: `feat/post-v2.7.3-followups`
**Size**: M (3 executable items; project-tracked per dev-flow L-1 since multi-file + multi-concern)
**Predecessor**: [multi-agent-portability-correction (v2.7.3)](../2026-05-22-multi-agent-portability-correction/README.md) — this project consumes its out-of-scope list + RETRO backlog

---

## CEO triage (2026-05-29)

The v2.7.3 ship left a documented out-of-scope list. CEO applied focus-as-subtraction to separate the coherent executable batch from oceans and blocked items.

| # | Item | Disposition | Reason |
|---|------|-------------|--------|
| 1 | OpenCode plugin circuit-breaker parity | ✅ **In scope** | `.opencode/plugins/autopilot.ts` does intent-capture in `tool.execute.after` but lacks the disable-flag / failure-counter / stale-clear that `hooks/intent-capture.js` has. S/M — pattern exists to port. |
| 2 | Release-hygiene checklist | ✅ **In scope** | v2.7.3 had a version-label collision that surfaced only when the user asked. A `scripts/preflight-release.sh` prevents recurrence. S. |
| 5a | Antigravity empirical verify | ✅ **In scope** | `agy` 1.0.1 IS installed. `install-antigravity.sh` was written against a codelabs walkthrough and never run against real `agy` — exactly the "Spike before assert" gap. S. |
| 3 | Manual SessionStart verify | 🚫 Human-only | Requires Claude Code restart; agents cannot. Low value — hooks reverted to b1ee7a6 known-good and preflight already verified both envelopes. Documented as a checkbox below. |
| 5b | Codex empirical verify | 🚫 Blocked | `codex` not installed on this machine. |
| 4 | Automated test infrastructure | ⏸ Separate L-track | L (~12hr); existing plan at [`docs/plans/2026-05-14-test-suite.md`](../../plans/2026-05-14-test-suite.md). An ocean, not a lake — bundling would blow scope. Stays independent. |

**Scope decision**: this project = items **1 + 2 + 5a**. Confirmed by user as a Board Decision before execution.

---

## Phases

| Phase | Item | Status |
|-------|------|--------|
| P1 | Item 5a — Antigravity empirical verify (Spike-first, may surface script fixes) | ✅ `3ee13ec` — overturned PM + v2.7.3 claims; rewrote install script |
| P2 | Item 1 — OpenCode plugin circuit-breaker parity | ✅ `30869d1` |
| P3 | Item 2 — `scripts/preflight-release.sh` | ✅ `3f1c77a` |
| P4 | Quality review (dispatched reviewer) + finish (CHANGELOG / INDEX / preflight / merge) | ✅ reviewer Medium→fixed `159feb6`; v2.7.4 bump + finish |

Item 5a runs first deliberately: it's empirical and may overturn assumptions in the `install-antigravity.sh` written during v2.7.3, consistent with the "Spike before assert" discipline.

---

## Human / blocked checklist (not executed by this project)

- [ ] **Manual**: restart Claude Code → confirm SessionStart context injection visible, no stderr warnings (item 3)
- [ ] **Blocked**: Codex empirical skill-discovery verify — pending `codex` install (item 5b)

---

## Acceptance

- [ ] OpenCode plugin self-disables after N consecutive intent-write failures; auto-clears on stale / version-bump (parity with `hooks/intent-capture.js`)
- [ ] `scripts/preflight-release.sh` exits non-zero when CHANGELOG / INDEX / project-README / version-mirror are out of sync for the current canonical version
- [ ] `agy skills list` (or equivalent) confirms autopilot skills discoverable after `install-antigravity.sh`; script matches real `agy` behavior
- [ ] `scripts/preflight-portability.sh` still 12/12 green
- [ ] CHANGELOG + INDEX updated; pre-commit gates pass

---

## Out of scope (carried forward)

- Item 4 (test infra) — separate L-track
- Item 5b (Codex) — blocked on tooling
- OpenCode plugin feature-parity beyond the circuit breaker (e.g. session.compacted state handling) — only the circuit breaker is in scope here
