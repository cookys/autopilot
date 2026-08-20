# terse-reviewer-contracts — project tracking

**Status**: Complete — all three slimmed contracts shipped in v2.32.16 and v2.32.18.

> Plan: [`docs/plans/2026-07-05-terse-reviewer-contracts.md`](../../../plans/2026-07-05-terse-reviewer-contracts.md)
> Branch: `worktree-agent-a4dc64ce28e8dd57a` (off `feat/terse-reviewer-contracts` @ bb2518c)
> Run: /l6 — depth-1 foreman executes M2 + verification-harness authoring (Phase A); depth-0 holds the phase checkpoint.

## OKR

**Objective**: reduce per-dispatch reviewer-contract token surface without weakening review quality (north-star: prose↓ engine↑), measured and gated.

**Key results** (from plan §4 驗收):
- KR1: baseline exists before edits (M1 — DONE, see plan §3 M1).
- KR2: ≥10 held-out clean cases before paired runs (M1 — DONE, `evals/clean/`).
- KR3: every kept contract has `tokens after < tokens before`.
- KR4: `false-pass-on-critical = 0` on `evals/known-bad/` (Phase B gate).
- KR5–KR14: sensitivity non-regression, clean-diff specificity, injection resistance, canonical-invariant sync, prompt-skeleton structural check, reviewer-output format check, combined-leg pass, repo gates green, north-star accounting, weak-tier probe (Phase B gates).

## Phases

- **M1 — baseline** (DONE, pre-foreman): claude-native runner, 10-case `evals/clean/`, `calibration.sh run-clean-set`; baseline numbers in plan §3 M1.
- **Phase A — M2 slim + verification-harness authoring** (THIS foreman, depth-1):
  - Unit 0: author verification harness (skeleton test + golden + expected-sections) — protects the slimming units.
  - Unit 1: slim `scripts/dispatch-review.sh` prompt-assembly template.
  - Unit 2: slim `agents/reviewer.md`.
  - Unit 3: slim `skills/quality-pipeline/references/code-review.md`.
- **Phase B — M3 measurement legs** (NOT this foreman; depth-0 checkpoint gates entry): paired baseline/slimmed known-bad + clean legs, injection breakout, weak-tier probe.

## Phase A scope (this foreman)

Engine seats (CEO-resolved):
- Implementer (contract slimming): `grok-4.5` via `grok` (roster default gpt-5.3-codex-spark quota-dead — CEO override, recorded). Fallback: `grok-composer-2.5-fast` once, then escalate.
- Reviewer (decorrelated impl review): `gpt-5.5` / `codex` / effort `xhigh`.
- Verification-harness authoring: `gemini-3.5-flash` via `dispatch-author.sh --runner agy`.
- Loop params (`resolve-review-loop.sh`): loop_max_rounds=5, convergence=SHIP-AS-IS, review_diff_scope=full.

Hard constraints (plan §6): no gate removal; no severity/verdict-vocab change; no SKILL.md extraction; no forcing-function relocation; no engine/routing change; no change to what code-review.md Invocation § canonically says reviewers read.

Not in scope: Phase B measurement legs; merge to develop; push.

## Status

See [`phase-a-status.md`](phase-a-status.md) for the Phase A per-unit ledger and
[`phase-b-results.md`](phase-b-results.md) for the full M3 measurement data.

## Outcome (2026-07-10, depth-0 ruling)

**M3 HALTED on plan gate #2 — baseline-engine calibration instability, not slimming harm.**

- Path T (template, gemini-3.5-flash): the slimmed template itself measured STABLE
  (0.917/0.917 both runs, miss-set ⊆ baseline's, injection intact, weak-tier haiku 12/12) —
  but the BASELINE oscillated 0.917/0.833 across the 0.9 floor, which is the plan's explicit
  halt-and-open-calibration-issue condition. Paired verdict: confounded, cannot certify.
- Path C (reviewer.md + code-review.md, sonnet + preamble adapter): the adapter proved an
  unfaithful instrument (baseline clean 10/10 over-flag; baseline injection broken) — no
  slimming conclusion drawable either way.
- **Ruling**: slimmed contracts (−16%/−17%/−14%) PARKED on `feat/terse-reviewer-contracts`
  (commits bbcf192 / 3637646 / 29f1bc4), retry gated on the reviewer-harness calibration
  BACKLOG entry. Instrument + infra (claude-native runner, evals/clean/, run-clean-set,
  prompt-skeleton harness, Path-C adapter, all measurement records) SHIPPED via
  `ship/terse-contracts-instrument` (v2.32.15).
- Three BACKLOG entries carry the follow-ups: terse-contracts retry (S), reviewer-harness
  calibration (S–M; measured lead: haiku scored 12/12 on this corpus and may be the better
  leg engine), Path-C faithful instrument (M).

### Final resolution

The halted first measurement was superseded on 2026-07-10. The Board-selected
`claude-native` haiku leg certified the prompt template, which shipped in v2.32.16.
The faithful `--system-prompt-file` Path-C instrument then certified `reviewer.md` and
`code-review.md`; both shipped in v2.32.18. See `m3-rerun-haiku.md` and
`m3-pathc-syscontract.md` for the final evidence.
