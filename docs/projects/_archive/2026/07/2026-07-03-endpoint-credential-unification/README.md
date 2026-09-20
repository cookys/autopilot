# Endpoint Credential Unification + Declarative Invoke Infra

- **Plan**: [`docs/plans/2026-07-03-endpoint-credential-unification.md`](../../../plans/2026-07-03-endpoint-credential-unification.md)
- **Branch**: `feat/v2.31.6-endpoint-credential-unification`
- **Target version**: v2.31.6

## Project Goal

> **Final goal**: Give Anthropic-compatible env-token engines (GLM / MiniMax / any compatible
> endpoint) a single canonical credential home (`~/.autopilot/endpoints.env`) with a safe
> loader, make endpoint selection declarative in `/l5` `/l6` (no hand-typed `--endpoint`), and
> tell users what filling it in buys them — defaulting the recommendation to subscription plans
> over metered API keys.
>
> **Success criteria**:
> 1. `scripts/load-endpoints-env.sh` + `.js` twin exist and pass a test suite covering:
>    symlink-reject, non-owner-reject, group/other-writable-reject, group/other-readable-warn,
>    line-parse allowlist (non-allowlisted vars ignored, no code execution), existing-env
>    precedence, quote-strip, missing-file no-op. Verified by `bash hooks/tests/run.sh` green.
> 2. `dispatch-hetero.sh` / `dispatch-review.sh` / `dispatch-anthropic-review.js` load the file
>    at startup; a token placed only in `endpoints.env` (unset in shell) reaches the dispatcher.
>    Verified by an integration assertion.
> 3. `resolve-review-loop.sh` emits `implementer_endpoint` + `reviewer_endpoint` from
>    `review-loop-config.md`; absent → `""`; a set value flows to `--endpoint` in `/l5`/`/l6`
>    prose. Verified by resolver test + prose reference.
> 4. `docs/installation.md` + `README.md` + `README.zh-TW.md` document the canonical placement
>    and the subscription-≻-API-key ladder; `check-readme-parity.js` green.
> 5. `bin/autopilot.js`-free: no new runtime dependency; Node built-ins only for the `.js` twin.
>
> **Scope boundary**: IN — placement unification, safe loader, declarative endpoint config,
> docs/value-prop, scaffold stub, tests. OUT — new provider onboarding, resolve-endpoint
> precedence changes, secret encryption/keychain, OAuth-login runner auth.

## Phases

| Phase | Deliverable | Status |
|-------|-------------|--------|
| P0 | `load-endpoints-env` bash + js twin + wire 3 dispatchers + tests | ⬜ |
| P1 | Declarative invoke infra (config keys + resolver JSON + /l5//l6 prose + tests) | ⬜ |
| P2 | Docs: installation.md + README EN/zh + value-prop ladder | ⬜ |
| P3 | Scaffold `endpoints.env` stub (`--init`) + onboard mention | ⬜ |
| P4 | CLAUDE.md inventory + close BACKLOG + v2.31.6 bump + CHANGELOG + INDEX + preflight | ⬜ |

## Scope Completeness Audit (L-1.5)

| Dimension | In scope? | Coverage |
|-----------|-----------|----------|
| Source code + tests | Yes | P0 (loader + wiring + tests), P1 (resolver + tests) |
| User-facing docs | Yes | P2 (installation.md, README EN/zh) |
| Config file templates | Yes | P1 (review-loop-config.md keys), P3 (endpoints.env stub) |
| CHANGELOG entry | Yes | P4 |
| Version bump (semver) | Yes | P4 (v2.31.6 PATCH) |
| Version sync grep | Yes | P4 (`sync-version.js` + grep old version across tracked files) |
| Credit / attribution | No | No external OSS absorbed; builds on own prior plan |
| Dogfood target | Yes | The `/l5`/`/l6` path this change wires IS autopilot's own dispatch infra |
| CLAUDE.md scripts inventory | Yes | P4 (new `load-endpoints-env.sh` row) |
| Dependent repos / consumers | Partial | Additive config keys — existing `.claude/review-loop-config.md` consumers unaffected (absent key → `""`) |

## Progress

| Date | Phase | Commit | Note |
|------|-------|--------|------|
| 2026-07-03 | Setup | — | Branch + plan + project created |
