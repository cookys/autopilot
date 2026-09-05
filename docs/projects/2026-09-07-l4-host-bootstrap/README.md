# l4 host provider-readiness bootstrap

> Plan: [`docs/plans/2026-09-07-l4-host-provider-readiness-bootstrap.md`](../../plans/2026-09-07-l4-host-provider-readiness-bootstrap.md) (frozen at g2, `ledger/plan-review/`)
> Branch: `feat/v2.36.8-l4-host-bootstrap` · Target: v2.36.8 (PATCH, Board 2026-09-07) · Size: L
> Owner ruling 2026-09-06「先 fix 然後完整修好」: Fix half = v2.36.7; this project is the complete half.

## Project Goal

> **Final goal**: an `AUTOPILOT_LEVEL=l4` managed `engine implement-review` reaches enforce-mode campaign intake with a real, live-probed, host-owned readiness bundle (`strict_level: "l4"`), using the operator's own implementer + reviewer roster, with every uncertified seat recorded under the advisory policy override — nothing waived, nothing fabricated.
> **Success criteria** (plan §2): KR1 l4 executable fixture reaches intake with `status:"ready"` + `strict_level:"l4"`; KR2 advisory path asserted (reason `advisory_default`, uncertified seats listed, stderr `POLICY OVERRIDE`); KR3 l5/l6 byte-identical incl. three isolated negative controls per level; KR4 waiver interplay tested at engine level; KR5 lifecycle observation accepts `l4` and `waived`; KR6 cuda WIZHALL dogfood reaches intake. All script-gated except KR6.
> **Scope boundary**: IN — `src/readiness/provider-bootstrap.js` per-level roster profile, `bin/autopilot.js` l4 compile + threading, `engine-lifecycle-observation.js` sets, intake message text, tests, front-door/portability/installation docs, BACKLOG closure, codex mirror. OUT — the frozen D4 claim set, new exam evidence, the v2 claim ↔ ICC identity binding, consuming-repo enforcement defaults.

## Scope completeness audit (L-1.5)

| Dimension | Covered by |
|---|---|
| Source + tests | P1–P3 |
| User-facing docs | P4 (front-door reference, portability, installation, `bin/autopilot.js` usage) |
| Config templates | none needed (no new knob) — out of scope by design |
| CHANGELOG / version bump / mirror grep | P4 (v2.36.8, `sync-version.js`, codex mirror) |
| Dependent consumers | `engine-lifecycle-observation.js` (`strict_level` enum widens) — P2 |
| Credit | none (no external prior art) |
| Dogfood | P5 (cuda WIZHALL) |

User-stated requirements ledger: (1)「完整修好」the l4 readiness wall → P1–P3; (2) l4 route is supported → §8 Q1 binding; (3) VA/QC optional at l4 → P1 profile; (4) PATCH → P4.

## Mission graph (one deliverable)

| Node | Deliverable | Phases | Status |
|---|---|---|---|
| D1 | l4 bootstrap profile + CLI threading + tests + docs (single branch, one pre-merge review) | P1 P2 P3 P4 | pending |

Historical plan headings P0 (spike, done 2026-09-07) and P5 (dogfood, human-gated after merge) are coverage, not execution nodes.

## Progress

| Phase | Status | Evidence |
|---|---|---|
| P0 spike | done 2026-09-07 | plan §4 P0 table (5 probes) |
| D1 (P1–P4) | pending | — |
| P5 dogfood | pending (after merge) | cuda report |

Last updated: 2026-09-07
