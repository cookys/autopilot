# Cross-Harness Engine Infrastructure

> Plan: [docs/plans/2026-07-01-cross-harness-engine-infrastructure.md](../../plans/2026-07-01-cross-harness-engine-infrastructure.md)
> Branch: `feat/v2.28.1-hook-adapter-framework`
> Process: CEO-inline (`/l3` posture), not `/l5`, because this phase builds hook/probe infrastructure that `/l5` will later depend on.
> Session start SHA: `cd8ee41b46a3b597febcd08e169b87d5e97dfd4c`

## Project Goal

> **Final goal**: Build the cross-harness Autopilot Core infrastructure needed to dispatch, review, verify, score, and refresh platform assumptions without breaking the existing Claude Code plugin.
> **Success criteria**:
> - Existing Claude hook behavior remains unchanged, verified by `bash hooks/tests/run.sh` and focused hook tests.
> - Hook adapter framework exists for Phase 6 with a normalized event schema, Claude payload fixtures, host-neutral handlers for `intent-capture` and `session-start`, and a Codex warning-only probe package.
> - No Codex blocking hooks ship before payload, cwd, env, and failure semantics are probed and documented.
> - Project tracking, CHANGELOG, and relevant references reflect the shipped Phase 6 scope.
> **Scope boundary**: This slice implements Phase 6 only. It may touch hook handler code, hook tests, schemas, Codex platform probe files, project docs, references, and CHANGELOG. It excludes blocking Codex hooks, full `/l5`/`/l6` engine loop wiring, implementer runner APIs, and provider credential changes.

## Phase 6 Scope Completeness Audit

| Dimension | Coverage |
| --- | --- |
| Source code + tests | Covered: `hooks/intent-capture.js`, `hooks/session-start.js`, `src/hooks/normalize/`, `src/hooks/handlers/`, `schemas/hook-event.schema.json`, `platforms/codex/hook-probe/`, and focused hook/package tests. |
| User-facing docs | Covered: `platforms/codex/README.md`, `references/multi-agent-portability.md`, capability state, project README, and CHANGELOG document the warning-only probe posture. |
| API / interface reference | Covered: `schemas/hook-event.schema.json` defines normalized event fields; normalizer fixtures cover Claude and Codex shapes. |
| Config file templates / examples | Covered without template changes: Codex hook probe ships its own local marketplace and README install commands; no user `.codex/config.toml` template is required. |
| CHANGELOG entry | Covered: `v2.28.1` entry added. |
| Version bump | Covered: patch bump to `2.28.1`. |
| Version sync verification | Covered by `node scripts/sync-version.js --version 2.28.1 --hook-count 22 --skill-count 27 --opt-in-count 12 --disabled-count 0`; final `--check` pending quality gate. |
| Migration guide / notes | Out of scope unless Claude hook payload semantics change. |
| Dependent repos / external consumers | Out of scope for this slice; Codex probe is warning-only and local-package scoped. |
| Credit / attribution | No external OSS/prior-art absorption planned. |
| Dogfood target | Yes: Codex warning-only probe package should dogfood the cross-harness hook posture without blocking. |

## Skill Routing

| Surface | Required skill / method | Status |
| --- | --- | --- |
| Code changes | `autopilot:dev-flow` | Done: L-size flow selected. |
| CEO autonomy | `autopilot:ceo-agent` | Done: CEO-inline, Hold scope. |
| Test approach | `autopilot:test-strategy` | Done: baseline-before-change, focused regression suites, package/capability tests, then full suite for quality gate. |
| Quality gate | `autopilot:quality-pipeline` | Done: focused gates pass, independent Codex review = `SHIP-AS-IS`, full suite failures classified pre-existing on `develop`. |
| Hook/harness capability claims | `autopilot:harness-maintenance` + role/harness governance | Done: capability remains H2/warning for Codex hooks; no gate-ready claim. |

## Phases

| Phase | Status | Notes |
| --- | --- | --- |
| L-1.5 Scope completeness audit | Done | Covered source/tests/docs/schema/config/release surfaces. |
| L-1.6 Skill routing | Done | `dev-flow`, `ceo-agent`, `test-strategy`, `harness-maintenance`; `quality-pipeline` pending as closing gate. |
| P6.1 Hook event schema + Claude fixtures | Done | `schemas/hook-event.schema.json`; Claude/Codex fixtures and normalizer test. |
| P6.2 Host-neutral `intent-capture` extraction | Done | `src/hooks/handlers/intent-capture.js` used by existing wrapper. |
| P6.3 Host-neutral `session-start` extraction | Done | `src/hooks/handlers/session-start.js` composes context/output for existing wrapper. |
| P6.4 Codex warning-only probe package | Done | Separate `platforms/codex/hook-probe/` package; main Codex package remains skills-only. |
| P6.5 Docs, CHANGELOG, and quality gate | Done | Docs/release metadata updated; deterministic gates pass; full suite residual failures are pre-existing on `develop`. |
| L-5 Finish-flow | In progress | Finish-flow active for commit, merge, archive, and branch cleanup. |

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-02 | Use CEO-inline instead of `/l5` for Phase 6. | Phase 6 builds hook/probe infrastructure that `/l5` depends on; offloading to `/l5` before smoke would be self-referential risk. |
| 2026-07-02 | Merge `origin/develop` commit `38e56f9` into this feature branch. | User correctly challenged branch currency. The remote-only commit is a cross-harness docs correction near this work's domain, so integrating it before Phase 6 avoids stale-base review noise. |
