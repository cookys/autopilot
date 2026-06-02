# Skill Leverage Extraction

> **Status**: ✅ Completed (merged to develop) · **Size**: L · **Branch**: `feat/skill-leverage-extraction`
> **Started**: 2026-06-02 · **Mode**: CEO-agent (autonomous, results-only)
> **Plan**: [`docs/plans/2026-06-02-skill-leverage-extraction.md`](../../plans/2026-06-02-skill-leverage-extraction.md)

## OKR

**Objective**: Trim the always-loaded tail of over-200-line skills by relocating *genuinely passive* leaf content to flat `references/*.md`, with **zero behavior change**.

**Key Results**:
- KR1 — Passive leaf blocks extracted to flat `skills/<skill>/references/<topic>.md` + inline pointer.
- KR2 — Behavior preserved: no forcing function / gate / MANDATORY / cross-skill-named section moved.
- KR3 — Deterministic verbatim-no-loss (multiplicity-preserving) diff passes per phase.
- KR4 — `validate.sh` + `preflight-portability.sh` pass.
- KR5 — Line count drops as a side effect (no `<200` target).

## Scope decisions (Board)

- **OKR framing**: 槓桿驅動抽離 (leverage, not line-chasing).
- **Scope**: Option A — P1-conservative (dev-flow) + P2 (retro). **P3/P4 (think-tank-dialectic, ceo-agent) evaluated and CUT** as negative-ROI churn (review R1 unanimous; Board confirmed).
- **Involvement**: results-only.
- **Version**: no bump (internal refactor); CHANGELOG Maintenance entry.

## Review loop (converged)

| Round | Lenses | Outcome |
|-------|--------|---------|
| R1 | Architect / Ops / Skeptic | Dismantled v1 — 4 verified 🔴 (cross-skill name coupling, forcing-function extraction, nested-path validator break, ROI). Scope narrowed. |
| R2 | Convergence reviewer | v2 closed 3/4; found 1 new 🔴 (anti-patterns + checklist contain forcing-function content). |
| v3 | — | Dropped those 2 blocks; 🟡 multiplicity-diff fix. **Converged.** |

## L-1.5 Scope Completeness Audit

| Dimension | In scope? | Notes |
|-----------|-----------|-------|
| Source | ✅ | dev-flow: 2 blocks (Post-Feature Doc Sync, Context Continuation) → refs + pointers. retro: 2 blocks (data-collection bash, report templates) → new `references/`. |
| Tests | ❌ out | No test loads SKILL.md (verified). quality-pipeline test stage is a no-op here; verbatim-no-loss diff is the real gate. |
| Docs | ✅ | Plan doc, this README, CHANGELOG Maintenance entry. |
| API / contracts | ❌ n/a | No interface change. |
| Templates | ✅ (moved, not changed) | retro report templates relocated verbatim. |
| CHANGELOG | ✅ | Maintenance/Internal entry at P-final. |
| Version | ❌ no bump | Decided; internal refactor. |
| Migration | ❌ n/a | — |
| Consumers (cross-skill) | ✅ verified | finish-flow:64 + ceo-agent:224 reference *inline-retained* sections only; no extracted block has an external referrer. |
| Dogfood | ✅ | This refactors autopilot's own skills; skills must still load/route — verified via validate.sh + preflight-portability.sh + verbatim-no-loss. |

## Phases

| Phase | Status |
|-------|--------|
| P0 — plan + review loop | ✅ converged |
| L-1.5 — scope audit | ✅ (this table) |
| P1 — dev-flow extraction (2 blocks) | ✅ 645→618, verbatim-no-loss 0 missing |
| P2 — retro extraction (2 blocks) | ✅ 225→130, verbatim-no-loss clean |
| P-final — quality-pipeline → preflight-portability → finish-flow | ✅ completeness clean, validate 16/16, portability 12/12 |

## Success criteria
- Both skills' SKILL.md trimmed; all moved content reachable via inline pointer.
- `validate.sh` + `preflight-portability.sh` green.
- Verbatim-no-loss diff empty per phase.
- No behavior change (no forcing function / gate / routing rule relocated).
