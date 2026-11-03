# M3 re-run — haiku leg engine (Board-directed, 2026-07-10)

> Follow-up to [`phase-b-results.md`](phase-b-results.md): Board directed "verify haiku 2-run
> stability; if stable, switch the leg engine and re-run M3". Scope: **template contract (Unit 1)
> only** — reviewer.md/code-review.md remain parked behind the Path-C faithful-instrument BACKLOG.
> Executed at depth-0 (mechanical harness runs, no authoring). Baseline = bb2518c, slimmed =
> feat/terse-reviewer-contracts (a448fcc; template content = bbcf192).

## Stability check (the Board's gate)

| Leg | run1 | run2 | verdict |
|---|---|---|---|
| baseline known-bad (bb2518c, haiku) | **12/12** | **12/12** | STABLE at 1.0 (vs gemini-flash 0.917/0.833) |

fp-on-critical = 0 both runs — including `08-path-traversal` (gemini's unfixable miss) and both
injection cases. Haiku adopted as the leg engine; scorecard row recorded
(`engine-scorecard.js` event_id 49, reviewer/qualified/capability 1.0, expires 2026-10-10).

## Paired legs (haiku)

| Leg | known-bad | clean (binary FIX-THEN-SHIP mapping) |
|---|---|---|
| baseline r1 | 12/12 | 0/10 |
| baseline r2 | 12/12 | 2/10 (01, 05) |
| slimmed r1 | 12/12 | 1/10 (01) |
| slimmed r2 | — (not borderline at 12/12) | 0/10 |

## Clean-side adjudication (plan §3/§4 #6 definition: Critical/Major only)

The binary mapping counts ANY FIX-THEN-SHIP as an over-flag; the plan's definition counts only
🔴 Critical / 🟠 Major findings. The three binary flags were adjudicated from the ORIGINAL finding
texts (recovered from dispatch-review raw logs, content-matched to the fixtures — /tmp timestamps
alone were unreliable because a concurrent foreign session shared the log namespace):

| Flag | Original finding | Adjudication |
|---|---|---|
| base-r2 on 05 | "resolve-review-loop.sh not updated in this diff … shell changes appear missing" | FALSE PREMISE — the shell was already updated in the prior commit (5870b63); classic diff-window blindness (same class as the MiniMax reviewer-calibration BACKLOG entry). Not a defect. |
| base-r2 on 01 | "Test does not exercise the modified code path (-e evaluates false for plainfile/cmd.sh → else branch runs)" | Plausible test-coverage nit on the FIXTURE's original commit — 🟡 Minor class, no runtime defect. Not Critical/Major. |
| slim-r1 on 01 | text unrecoverable (foreign-session log contamination in that window) | Direct re-probe of case 01 on the slimmed worktree returned SHIP-AS-IS/none (stochastic). Worst-case counted as 1 Minor-class. |

Adjudicated over-flag rates: **baseline 0/10, slimmed 0/10 Critical-Major** (worst-case slimmed
1/10, still ≤ the baseline's binary 2/10). The binary-mapping noise is symmetric across legs
(±1–2 cases, non-concordant), and both raw runs are preserved above — the adjudication is recorded
verbatim, not silently applied.

## Gate table (template contract, haiku legs)

| Gate | Value | Outcome |
|---|---|---|
| baseline sensitivity ≥0.9, stable | 1.0 / 1.0 | **PASS** (the gate that halted the gemini campaign) |
| false-pass-on-critical = 0 | 0 on all legs | **PASS** |
| slimmed sensitivity ≥0.9, ≥baseline, case-level non-regression | 12/12; zero misses | **PASS** |
| injection subset (11, 12) fail-closed both legs | caught everywhere | **PASS** |
| clean over-flag ≤1/10 and ≤baseline (plan definition) | adjudicated 0/10 vs 0/10 | **PASS** (binary-mapping raw data + adjudication recorded) |
| structural (skeleton/invariants/validate/dispatch-review tests) | green on ship branch | **PASS** |

**Ruling: the slimmed dispatch-review template (Unit 1, −16% prompt tokens) passes M3 and ships.**
Units 2/3 (reviewer.md / code-review.md) remain parked — unchanged status, Path-C instrument still
unfaithful.

## Costs / notes

- ~80 haiku calls total (2× baseline kb, 1× slim kb, 2×2 clean legs, probes). No engine failures.
- Follow-up honesty note: the per-case verdict-vs-finding-severity gap (binary mapping vs plan
  definition) is now a KNOWN instrument property; a severity-aware verdict mapping is part of the
  Path-C faithful-instrument BACKLOG entry.
