# Hook Transcript Pivot

> **Status**: ✅ Completed (v2.8.0) · **Size**: L · **Branch**: `feat/hook-transcript-pivot`
> **Started**: 2026-06-02 · **Plan**: [plan](../../plans/2026-06-02-hook-transcript-pivot.md)

## OKR
**Objective**: Recover tool-event data for PostToolUse hooks without the broken stdin pipe, by reading the session transcript JSONL — re-enabling the v2.7.4-disabled log-only hooks.

**Key Results**:
- KR1 — `transcript-reader-lib.js`: pure, unit-tested, returns the stdin-equivalent `{tool_name, tool_input, tool_response, is_error}` from the transcript.
- KR2 — Timing confirmed GREEN by a live probe-hook run before any blocker re-enable (hard gate).
- KR3 — intent-capture `last_tool` populated (no longer `<unknown>`).
- KR4 — log-only disabled hooks re-enabled + each smoke-verified writing its artifact; fail-open preserved.

## Spike (2026-06-02) — GO
Structure ✅, recoverable ✅, path-discovery ✅ (`CLAUDE_CODE_SESSION_ID` + UUID glob), timing 🟢 strong (gated by P2 probe).

## L-1.5 Scope audit
| Dimension | In/out |
|-----------|--------|
| Source | ✅ reader lib + intent-capture rewire + re-enabled log-only hooks |
| Tests | ✅ node:test for lib; smoke per re-enabled hook |
| Timing (live) | ✅ P2 probe — **human-run gate** (fresh `claude`) |
| PreToolUse hooks | ❌ out — unrecoverable (no transcript entry pre-run) |
| Docs/CHANGELOG/version | ✅ at P5 |
| Cross-platform | ✅ preflight-portability at P5 |

## Phases
| Phase | Status |
|-------|--------|
| P1 — transcript-reader lib + test | ✅ 9 unit tests; validated on real transcript |
| P2 — timing probe hook | ✅ built; timing de-risked (user opted B — proceed, probe = opt-in confirm) |
| P3 — rewire intent-capture | ✅ last_tool recovered; live + L2 test |
| P4 — re-enable audit-log/log-error/failure-escalation | ✅ smoke-verified artifacts; +L2 tests |
| P5 — quality gate + finish | ✅ 29 tests, validate, preflight, v2.8.0 |

**Scope note**: user chose to proceed without the live fresh-`claude` timing gate (option B) — timing was strongly de-risked (transcript flushes incrementally; lib recovers prior tool within seconds, 3× confirmed) and all in-scope hooks are low-harm PostToolUse log-only where an off-by-one is non-breaking + fail-open. The probe (`_transcript-timing-probe.js`) ships as an opt-in diagnostic for definitive confirmation.
