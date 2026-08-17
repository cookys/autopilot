# brain-seat-exam-suite — execution ledger

> Plan (FROZEN): [`docs/plans/2026-08-17-brain-seat-exam-suite.md`](../../plans/2026-08-17-brain-seat-exam-suite.md)
> · Rubric + 2-generation hetero review log therein (G1 13+2, G2 11+3 adjudicated)
> · Evidence: [`2026-08-17-brain-seat-exam-suite/`](../../plans/evidence/2026-08-17-brain-seat-exam-suite/)
> (survey + fable/sol perspectives + synthesis)
> · Frame: research-to-ship Phase 5 (execute per dev-flow) · Mode: l3 inline (Board
> 2026-08-17) · Branch: `feat/brain-seat-exam-suite`
> · Target version: v2.34.14 (PATCH — scripts/schema/evals, no new skill/agent)

## OKR

An engine can earn (and lose) standing brain-seat qualification through a
deterministic, budget-bounded exam whose evidence the P7 rail consumes.
KR1–KR5 (+KR3b strikes) with red cases: see plan §2 (frozen; not restated here).

## L-1.5 Scope Completeness Audit (2026-08-17)

| Dimension | Coverage |
|---|---|
| Source | 2 new eval modules + corpus JSON; extend engine-qualify.js / capability-evidence.js (SSOT) / engine-capability-state.js / 2 audit instruments / resolve-review-loop.sh / next-pick.js / readiness CLI (plan §3) |
| Tests | 3 new test files + 2 extended, red case per hard-fail rule (plan §5) |
| Docs | scripts-inventory row updates; engine-onboarding SKILL + role-and-harness-governance reference; level-front-door round-protocol § (strike wiring) |
| Schema | additive `brain_trial` variant + `owner-brain-seat-v1` kind + strike event kind; old rows revalidate byte-for-byte |
| CHANGELOG | at close (PATCH); version 2.34.13 → 2.34.14 via sync-version.js |
| Migration | none — additive kinds; absent evidence → `no_record` (advisory for incumbent) |
| Consumers | P7 rail (resolve-review-loop.sh, next-pick.js), readiness CLI, l4+ round protocol |
| Dogfood | P5 administration against the incumbent default seat (Board: FAIL annotates only) |
| Out of scope | plan §7 (blinded sub-seat, live audit sampling, corpus v2 rotation, 4th-subject promotion) |
| Backlog candidates from review | G2 non-accepted ×5 (grader-determinism test, no-row-on-insufficient_budget clarification, generator-version cross-check, L/S marker definitions, R1 trace completeness) — consult during implementing phases |

## Phase ledger

| Phase | Status | Commit | Acceptance |
|---|---|---|---|
| P1 generator + corpus (L) | done | (this branch) | brain-eval-generator.test.sh — 42 node assertions incl. 13 validator/corpus red cases; 50-seed determinism sweep |
| P2 grader (L) | done | (this branch) | brain-eval-grader.test.sh — 40 node assertions: golden pass + 16 red fixtures + 3 distinct early-end outcomes + forged-telemetry immunity |
| P3 administration mode + strikes (L) | done | (this branch) | engine-qualify-brain.test.sh — 34 assertions through real bwrap transport; kernel kind-scoped standing semantics; strike ledger + brain-status; instrument strike flags; all pre-existing suites re-green |
| P4 P7 rail + emission wiring (S) | done | (this branch) | resolve-review-loop 305 / next-pick 28 / stall-fuse 22 / conformance 29 assertions; grep-gate on round protocol; readiness brain-seat line |
| P5 dogfood + wiring + release (S) | pending | — | preflight-release.sh 8/8; dogfood record with AND-of-four verdict |

## Decision log

- D0 (2026-08-17, Board via Phase-2/3 gates): three-subject taxonomy with containment
  as named case family; standing pass + 3-strike revocation (no expiry); incumbent
  first, FAIL annotates only; zero-ask floor on legal-workaround controls; plan FROZEN
  after G2 terminal adjudication — scope changes now require stop-and-re-freeze.
