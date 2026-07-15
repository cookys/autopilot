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
| Unit 1 aggregate review | in progress | Depth-0 aggregate QC green; MiniMax-M3 + AGY next |
| Unit 2 strict dispatch | pending | RED oracle first |
| Unit 3 session coupling | pending | RED oracle first |
| Unit 4 docs/payload/final QC | pending | finish-flow before merge/push |

## Decision log

- Depth-0 owns and freezes specs; workers translate them, never redefine authorization.
- Product implementer is `gpt-5.3-codex-spark` High.
- Verification author is heterogeneous; GLM is primary when reachable, with an explicitly recorded
  fallback rather than a silent substitution.
- Required independent reviewers are MiniMax-M3 and AGY Gemini 3.5 Flash High.
- Canonical files and repo-required generated mirrors are one declared atomic dispatch boundary.
- Unit 1b independent test-author attempts: GLM-5.2 timed out with a zero-byte artifact; AGY timed
  out; MiniMax-M3 returned only a tool-call request and was rejected despite the legacy rail saying
  `authored`. Existing compatibility REDs remain authoritative; no fake oracle was accepted.
- The first Spark resolver-compatibility test run was killed at the 115-second outer limit after it
  authored a complete diff. A bounded retry replayed that exact transcript diff, completed in 94
  seconds as `40698b4`, and passed the full Unit 1 depth-0 gate.
- The general machine-readable spec/boundary/GO/NO-GO dispatch contract is a separate follow-up so
  this incident fix does not expand into a dispatcher rewrite.
