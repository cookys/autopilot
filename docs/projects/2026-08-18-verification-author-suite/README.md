# Verification-author qualification suite

## Project Goal

> **Final goal**: `engine-qualify.sh verification_author` administers a
> deterministic standing exam for the /l6 verification-author role — the last
> canonical role without a qualification suite — and one real administration of
> the incumbent VA seat is recorded.
> **Success criteria**: (1) new suites `va-eval-generator` / `va-eval-grader` /
> `engine-qualify-va` green with every red line proven fireable by deviant
> mocks; (2) provider authoring mode (`QRP_PROMPT_MODE=va`) suite-covered with
> honesty scan + recorded prompt hash; (3) `bash scripts/preflight-release.sh`
> 8/8 at v2.34.17; (4) existing engine-qualify/brain/owner/provider suites
> unchanged-green; (5) one real administration recorded honestly (any outcome
> valid — advisory semantics).
> **Scope boundary**: IN — generator+corpus, sandboxed host runner + grader,
> engine-qualify subcommand + evidence wiring, provider authoring prompt,
> dogfood administration, docs/CHANGELOG/version. OUT — /l6 roster-routing
> changes, cross-family diversity enforcement (roster policy), implementer/
> explorer suites, multi-file integration-scale harness authoring (v1 is
> single-module, reviewer-corpus scale).

Plan: [`docs/plans/2026-08-18-verification-author-suite.md`](../../plans/2026-08-18-verification-author-suite.md)
Mission admission: READY (enforce), deliverable_count 1.

## Scope completeness audit (L-1.5)

| Dimension | Covered by |
|---|---|
| Source code + tests | P1–P4 (each phase carries its own suite, red-first) |
| User-facing docs | P5 (engine-onboarding SKILL + governance reference) |
| API / interface reference | P5 scripts-inventory rows |
| Config templates | N/A — no new config fields (roster selection unchanged) |
| CHANGELOG | P5 (v2.34.17, PATCH per policy — scripts/evals, no new skill/agent) |
| Version bump + sync grep | P5 |
| Migration notes | N/A — additive subcommand + prompt mode |
| Dependent consumers | evidence store/scorecard consume the canonical role that already exists in the enum |
| Credit / attribution | N/A |
| Dogfood target | P5 administration IS the dogfood |

User-stated requirements ledger: BACKLOG L item "verification-author suite 設計"
(user approval: "go" 2026-08-18) → whole plan. No other stated requirements.

Skill routing (L-1.6): `autopilot:dev-flow` invoked (sizing + gates). No
per-module skill rows configured for `scripts/`/`evals/` — N/A recorded.

## Progress

| Phase | Status | Notes |
|---|---|---|
| Plan + hetero review | G2 in review | G1 CONDITIONAL (sol STOP + glm CONDITIONAL, 9 blockers) → all accepted, plan revised (host trace re-derivation design), disposition filed, G2 dispatched |
| P1 generator + corpus | pending | |
| P2 host runner + grader | pending | |
| P3 engine-qualify subcommand | pending | |
| P4 provider authoring prompt | pending | |
| P5 dogfood + docs + release | pending | |

## Decision log

- 2026-08-18: PATCH version (v2.34.17) per the brain-suite precedent (a new
  exam is scripts/evals, not a new user-invocable skill/agent).
- 2026-08-18: plan review runs on the non-Anthropic rails (sol codex + glm
  http) — the Anthropic API had a 529 window yesterday and the decorrelated
  panel is the designed degradation path.
