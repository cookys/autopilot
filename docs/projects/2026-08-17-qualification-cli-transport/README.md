# Qualification CLI transport + brain round-mode provider

## Project Goal

> **Final goal**: `engine-qualify.sh` can administer exams over CLI harness
> transports (codex / claude), the provider adapter speaks the brain round mode,
> and two real administrations are recorded (GLM-5.2 reviewer re-attempt; brain
> incumbent first sitting).
> **Success criteria**: (1) `hooks/tests/qualification-review-provider.test.sh`
> exists and passes (red→green authored); (2) `engine-qualify-brain`,
> `qualification-case-broker`, `resolve-review-loop` suites stay silent;
> (3) `node bin/autopilot.js status readiness` brain-seat line is three-state
> (identity file pinned); (4) two administration verdict JSONs + evidence rows
> recorded honestly (any outcome valid); (5) `bash scripts/preflight-release.sh`
> 8/8 at v2.34.15.
> **Scope boundary**: IN — provider adapter CLI mode + brain prompt, identity/config
> wiring, the two administrations, docs/CHANGELOG/version sync. OUT —
> verification_author suite (BACKLOG L), MiniMax full run (bar unmet), suspended
> Codex/Gemini seat restoration (trigger unmet), governance CLI UX polish (S
> ride-along only if a governance script is touched anyway).

Plan: [`docs/plans/2026-08-17-qualification-cli-transport.md`](../../plans/2026-08-17-qualification-cli-transport.md)
Mission admission: READY (enforce), deliverable_count 1, admission_digest `0465c944…`.

## Scope completeness audit (L-1.5)

| Dimension | Covered by |
|---|---|
| Source code + tests | P1 (adapter + new test suite) |
| User-facing docs | P4 (engine-onboarding reference CLI transport §) |
| API / interface reference | P4 scripts-inventory rows (provider + engine-qualify) |
| Config templates | P2 (`brain_seat_identity_file` in review-loop-config; identity JSON) |
| CHANGELOG | P4 |
| Version bump | PATCH → 2.34.15 (scripts/prompt/config work; no new skill/agent) |
| Version sync grep | P4 (`sync-version.js` + grep old version across tracked files) |
| Migration notes | N/A — additive env switches, defaults preserve shipped behavior |
| Dependent consumers | broker contract unchanged (stdin/stdout schema untouched) |
| Credit / attribution | N/A — no external absorption |
| Dogfood target | P3 administrations ARE the dogfood |

User-stated requirements ledger (from HANDOFF continuation): adapter
CLI-transport 件 → P1; brain 輪次 provider prompt → P1; GLM 重考(全新施測)→ P3;
brain 首場真考(現任席)→ P3. All mapped.

Skill routing (L-1.6): `autopilot:dev-flow` invoked (this session, sizing + gates);
no per-module skill rows configured for `scripts/` in this repo — N/A recorded.

## Progress

| Phase | Status | Notes |
|---|---|---|
| P1 adapter CLI transport + brain prompt + tests | pending | |
| P2 identity + config wiring | pending | |
| P3 administrations (GLM re-attempt; brain incumbent) | pending | |
| P4 docs + release (v2.34.15) | pending | |

## Decision log

- 2026-08-17: live probe showed `CLAUDE_CONFIG_DIR`→real `~/.claude` RESETS
  `.claude.json` (restored from CLI backup). Exam config dir = dedicated dir seeded
  with `.credentials.json` only. Recorded in plan §2 and adapter header.
- 2026-08-17: transport/prompt switches are env-based (`QRP_TRANSPORT`,
  `QRP_CLI_KIND`, `QRP_PROMPT_MODE`) with defaults = shipped behavior; one
  qualification run is homogeneous, so per-run env is the correct granularity
  (no request sniffing).
