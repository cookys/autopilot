# gstack / superpowers learnings — dispatch-suppression check + plan Global Constraints

**Size**: L · **Branch**: `feat/v2.25.0-dispatch-suppression` · **Plan**: [`docs/plans/2026-06-24-gstack-superpowers-learnings.md`](../../plans/2026-06-24-gstack-superpowers-learnings.md)

## Project Goal

> **Final goal**: ship the 2 dialectic-converged learnable items from the gstack/superpowers v6 survey, plus the standalone-TDD doc-honesty fix.
> **Success criteria**:
> 1. `scripts/check-dispatch-suppression.sh` exists; machine contract is the **exit code** (0 clean / 1 finding / 2 usage) with plaintext `COACHING:`/`CLEAN:` markers on stderr (matching its sibling `check-redispatch-prompt.sh`, not a JSON emitter); **caught** = a coaching prompt ("call it Minor at most"), **passed** = a legit review prompt incl reviewer.md's own "don't over-flag minor nits" calibration language (verified by `hooks/tests/check-dispatch-suppression.test.sh`, wired into `hooks/tests/run.sh`, exit 0).
> 2. `references/blind-dispatch.md` references the suppression check as an every-dispatch pre-flight (additive; pinned anchors intact; canonical-invariants gate green).
> 3. `references/plan-template.md` has a verbatim-propagated **Global Constraints** section (one canonical statement; Interfaces folded into existing input/output).
> 4. `skills/test-strategy/SKILL.md` Coexistence + README scenario B state the standalone-no-native-TDD limitation.
> 5. All gates green (validate / canonical-invariants / agent-body / readme-parity / hook-inventory / the new test); v2.25.0 release hygiene complete.
> **Scope boundary**: INCLUDE E1 (suppression check) + E2 (Global Constraints) + E3 (TDD doc-honesty). EXCLUDE the dialectic-CUT items — L2 runtime/browser QA, L3 UX axis (selection bias), native `skills/tdd/` (option-a, rejected). EXCLUDE generalizing/retrofitting the existing `check-redispatch-prompt.sh` (its missing-test gap is pre-existing → BACKLOG, not this scope).

## L-1.5 Scope Completeness Audit

| Dimension | Affected | Coverage |
|-----------|----------|----------|
| Source code + tests | YES | new `scripts/check-dispatch-suppression.sh` + `hooks/tests/check-dispatch-suppression.test.sh` |
| User-facing docs | YES | `references/blind-dispatch.md`, `references/plan-template.md`, `skills/test-strategy/SKILL.md`, README EN+zh scenario B |
| CLAUDE.md scripts inventory | YES | add the new-script row (CLAUDE.md "wire it in" rule) |
| CHANGELOG entry | YES | v2.25.0 (finish-flow L-5) |
| Version bump + sync (grep) | YES | 2.24.0 → 2.25.0; sync-version all count flags; grep old version |
| Credit / attribution | YES | README `Inspired By` — obra/superpowers SDD anti-gaming reviewer contract |
| Dogfood target | YES | the check applies to autopilot's own dispatch prompts |
| API / migration / dependent repos | NO | additive, no interface/breaking change |
| New skill/agent (count bump) | NO | a new SCRIPT, not a skill — skill/agent/hook counts unchanged |

## Phases

| Phase | What | Status |
|-------|------|--------|
| P0 | Scaffold flow + structure (script/test skeleton + wiring stubs) — 補 flow | pending |
| P1 | Fill actual content (regex classes + test fixtures + template text) — 補實際內容 | pending |
| L-5 | finish-flow (qc → merge --no-ff → v2.25.0 release hygiene → archive) | pending |

## Review Loop History

- Plan converged via 2-round Architect/Ops/Skeptic dialectic (cut L2/L3 as selection bias; corrected E1 landing + test-first). See plan doc.
