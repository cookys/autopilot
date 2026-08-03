# distill episodic mode + periodic-call integration

> Plan: [`docs/plans/2026-07-04-distill-episodic-mode.md`](../../../plans/2026-07-04-distill-episodic-mode.md) (R0, converged)
> Branch: `feat/v2.31.18-distill-episodic` · Target: v2.31.18 (PATCH) · Process: /l6

## Project Goal

> **Final goal**: distill gains a second signal source — episodic distillation (fresh-memory project retrospection) — sharing the existing Step 3–5 pipeline, plus two one-line periodic anchors (finish-flow L-5.6, /next B-level).
> **Success criteria** (plan §4, verbatim): (1) distill SKILL.md has Episodic-mode section (1E/2E/2E-quality) + description trigger phrases, validate.sh green; (2) finish-flow L-5.6 gains one evaluation question; (3) next SKILL.md gains scan-state age check line; (4) PATCH + CHANGELOG; (5) Step 3–5 pipeline behavior untouched (zero regression).
> **Scope boundary**: OUT — scanner recall fixes (separate BACKLOG), moving skill-red-testing into autopilot (user-pack product), any new skill. Description edits are ADD-ONLY (existing routing text byte-preserved).

## L-1.5 Scope audit

| Dimension | Verdict |
|---|---|
| Source (3 SKILL.md prose) | YES — P1 |
| Description = routing surface | YES — L-treatment, ADD-only verified in P2 |
| Tests | Prose-only; deterministic acceptance checker (P2) + validate.sh; no test suite for prose per repo config |
| CHANGELOG + version | YES — v2.31.18 PATCH |
| Codex payload | YES — sync after edits |
| README badges | N/A (no count change) |
| Migration/credit | N/A |

## Phases

| Phase | Content | Status |
|---|---|---|
| P1 | Impl (agy/Gemini): episodic section + 2 integration lines | ✅ done (f95837f + r2 f24f549) |
| P2 | Verification + review: gpt-5.5 xhigh r1 (1 Minor fixed) + MiniMax plan-fidelity (3 divergences REFUTED as excerpt artifacts) + autopilot:reviewer L-5.2 (zero blocking) + validate/suite green | ✅ done |
