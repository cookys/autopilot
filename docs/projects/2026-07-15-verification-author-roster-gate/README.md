# Verification-author roster gate

> Status: IN PROGRESS
> Branch: `fix/verification-author-roster-gate`
> Plan: [`../../plans/2026-07-15-verification-author-roster-gate.md`](../../plans/2026-07-15-verification-author-roster-gate.md)

## Goal

Make `/l6` verification authoring fail closed: the author tuple must come from the consuming
project roster, differ from the implementer family, pass endpoint readiness separately, and leave
non-secret selection provenance in the result. Manual model/runner substitution must not start a
runner during active l6.

## Success criteria

- Resolver has one schema-backed verification-author tuple with exact presence/validation rules.
- Strict author dispatch rejects manual, absent, malformed, same-family, and unknown-family tuples
  before endpoint lookup, temp logs, or runner start.
- Active l6 requires strict roster mode; inactive legacy dispatch remains compatible.
- Result provenance contains no URL, token value, token environment value, or raw credential.
- Focused RED/GREEN proof, existing compatibility suite, dual-family review, depth-0 QC, payload
  sync, merge, and push are all complete.

## Scope boundary

In scope: resolver/schema/config, JS validation, strict `dispatch-author.sh`, session-mode coupling,
result provenance, l6/front-door docs, focused tests, and deterministic Codex mirrors. Out of scope:
the general dispatch-unit-contract gate, automatic fallback, native Agent interception, or changing
model qualification policy. Those remain in the separate follow-up plan.

## Progress

| Phase | State | Evidence / blocker |
|---|---|---|
| Contract + incident root cause | complete | `4b7ed12`, `97dd900` |
| Unit 1a resolver oracle | complete | AGY `a827ffe` |
| Unit 1a shell/schema | complete on feature branch | Spark `e61d75d`; focused QC green |
| Unit 1b.i JS/schema compatibility | complete on feature branch | Spark `9ddc9b3`, `7471cb3`; runner 35 + engine 365 assertions green |
| Unit 1b.ii configs/resolver compatibility | complete on feature branch | Spark `3b773a0`, `40698b4`; resolver 227 + parity 30 assertions green |
| Unit 1 aggregate review | complete | Final MiniMax-M3 + AGY `SHIP-AS-IS`; depth-0 full gate green at `05d0aad` |
| Unit 2a strict CLI/authorization | complete | RED `c8ad68e` + amendments `6ae59b3`, `ed7871c`; Spark `4290bb0`, `ae22b67`; strict 45 + legacy 65 + resolver 31/227 green; final MiniMax-M3 + AGY `SHIP-AS-IS` |
| Unit 2b endpoint/valid dispatch | complete (test-only) | AGY oracle `15642bb` + executable mode `54cd881`; endpoint 17 + strict 45 + legacy 65 green; final MiniMax-M3 + AGY `SHIP-AS-IS` |
| Unit 2c result provenance | in progress | Next: independent RED for strict vs legacy payload, selection path, and secret hygiene |
| Unit 3 session coupling | pending | RED oracle first |
| Unit 4 docs/payload/final QC | pending | finish-flow before merge/push |

## Decision log

- Depth-0 owns and freezes specs; workers translate them, never redefine authorization.
- Product implementer is `gpt-5.3-codex-spark` High.
- Verification author is heterogeneous; GLM is primary when reachable, with an explicitly recorded
  fallback rather than a silent substitution.
- Required independent reviewers are MiniMax-M3 and AGY Gemini 3.5 Flash High.
- Canonical files and repo-required generated mirrors are one declared atomic dispatch boundary.
- Unit 2 is mechanically split into 2a CLI/authorization, 2b endpoint/runner ordering, and 2c
  provenance/legacy compatibility. Session-marker coupling is Unit 3 and cannot enter these diffs.
- Unit 1b independent test-author attempts: GLM-5.2 timed out with a zero-byte artifact; AGY timed
  out; MiniMax-M3 returned only a tool-call request and was rejected despite the legacy rail saying
  `authored`. Existing compatibility REDs remain authoritative; no fake oracle was accepted.
- Unit 1 aggregate review found a real JS endpoint-name validation gap. GLM-5.2 again timed out with
  a zero-byte artifact, so the recorded AGY fallback authored RED `55a1e55` (365 pass, 2 expected
  assertion failures before product repair). MiniMax-M3 emitted a wrapped finding after a prose
  preamble, so the legacy parser correctly returned `no_verdict`; it does not count as a panel pass.
- The first AGY fallback author call also mutated the consuming feature worktree despite
  `dispatch-author.sh` documenting a read-only posture. Only its declared three-line test diff was
  present and it was isolated/verified before commit, but the rail behavior is a containment breach
  to mechanize in the separate dispatch-unit contract project.
- Unit 1 review converged after endpoint parity repairs `f2c5518`, `50c1c23`, and guard-order repair
  `05d0aad`. Final artifacts: MiniMax-M3 `dispatch-review-log-wP7sJm` and AGY
  `dispatch-review-log-Iw7OxK`, both `SHIP-AS-IS`. Depth-0 reran resolver 227, independent oracle 31,
  runner 35, engine 367, parity 30, schema, mirror-sync, skill validation, and diff checks green.
- The first Spark resolver-compatibility test run was killed at the 115-second outer limit after it
  authored a complete diff. A bounded retry replayed that exact transcript diff, completed in 94
  seconds as `40698b4`, and passed the full Unit 1 depth-0 gate.
- Unit 2a was split again at the implementation boundary: `4290bb0` owns strict CLI/exact-config
  preflight, while `ae22b67` owns the one-shot resolver JSON snapshot and tuple/family gates. Two
  115-second Spark attempts left no commit and were rejected; bounded replay run
  `hetero-1784090815-1847883-ec59` produced the accepted two-file commit.
- Unit 2a depth-0 QC passed strict oracle 45, legacy author 65, verification-author resolver 31,
  full resolver 227, schema parity, mirror sync, diff, and clean-tree checks. Initial reviewer
  claims about Node `-e` argv, the `incomplete` diagnostic, and inherited override precedence were
  disproved with executable reproductions. Final artifacts: MiniMax-M3
  `dispatch-review-log-tkf1k8` and AGY `dispatch-review-log-yJ00fB`, both `SHIP-AS-IS`.
- Unit 2b's independent AGY oracle was characterization-green against the existing endpoint/cc-shim
  path, so no product patch was invented. Commits `15642bb` and mode-only `54cd881` prove exact
  GLM tuple/endpoint delivery and unready-endpoint no-fallback. Depth-0 passed endpoint 17, strict
  45, and legacy 65 assertions. Final artifacts: MiniMax-M3 `dispatch-review-log-kmFUsj` and AGY
  `dispatch-review-log-OKnOdF`, both `SHIP-AS-IS`.
- The general machine-readable spec/boundary/GO/NO-GO dispatch contract is a separate follow-up so
  this incident fix does not expand into a dispatcher rewrite.
