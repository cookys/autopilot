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
| P1 generator + corpus (L) | done | (this branch) | brain-eval-generator.test.sh — 46 node assertions incl. 15 validator/corpus/leak red cases + in-suite 50-seed determinism sweep |
| P2 grader (L) | done | (this branch) | brain-eval-grader.test.sh — 40 node assertions: golden pass + 16 red fixtures + 3 distinct early-end outcomes + forged-telemetry immunity |
| P3 administration mode + strikes (L) | done | (this branch) | engine-qualify-brain.test.sh — 43 assertions through real bwrap transport; kernel kind-scoped standing + scope pin; strike ledger + brain-status incl. non-join and pass-instant tiebreak; dual-direction CLI schema fixtures |
| P4 P7 rail + emission wiring (S) | done | (this branch) | resolve-review-loop 307 (incl. --enforce exit-3 refusal) / next-pick 30 (incl. override engine binding) / stall-fuse 22 / conformance 29; grep-gate on round protocol; readiness brain-seat line |
| P5 wiring + release (S; real dogfood deferred per D1) | done | (this branch) | preflight-release.sh 8/8; CHANGELOG v2.34.14 + version mirrors + inventory/SKILL rows + contract schema; mock-candidate administration fully verified in engine-qualify-brain.test.sh |

## Pre-merge QC (2026-08-17, depth-0 adjudicated)

Panel per resolver roster: gpt-5.6-sol@max **FIX-THEN-SHIP** (1🔴+6🟠), GLM-5.2
**FIX-THEN-SHIP** (5🟠+3🟡; cc-shim chrome broke framing, nonce-complete verdict
rescued from raw log), MiniMax-M3 **SHIP-AS-IS** (1🟡; same rescue). Adjudication —
ACCEPTED & fixed: grader NUL bytes made the file git-binary/unreviewable (both
families; `NUL` join separators → `|`); kernel scope pin + status-fold scope
filter; generator self-enforcing leak scan + forbidden-projection hint scan;
declare_done = candidate terminal (early_end reachable end-to-end); identity
non-join + pass-instant strike red cases; next-pick override engine binding
(--seat-engine); resolver --enforce exit-3 refusal; role-and-harness-governance
brain rows; ledger numbers corrected + 50-seed sweep moved in-suite; dual-direction
CLI schema fixtures. REFUTED with rationale: separate strikes.jsonl (G2 disposition
f2fc181527 explicitly sanctioned the separately named ledger under the same lock);
pre-spend budget gate semantics (a completed stream grades; the cap protects spend,
not verdicts); default world transition (zero-effect no-op IS the defined
harness-owned transition, now documented); KR5 dogfood deferral (Board D1 authority;
sol lacked standing to overrule it).

## Decision log

- D0 (2026-08-17, Board via Phase-2/3 gates): three-subject taxonomy with containment
  as named case family; standing pass + 3-strike revocation (no expiry); incumbent
  first, FAIL annotates only; zero-ask floor on legal-workaround controls; plan FROZEN
  after G2 terminal adjudication — scope changes now require stop-and-re-freeze.
- D1 (2026-08-17, Board at P5): the incumbent Claude seat has NO exam transport on
  this host (OAuth only — no raw Anthropic token; the broker's CLI-harness transport
  is the deferred reviewer-seat BACKLOG work). Ruling: ship v2.34.14 with the
  mock-verified suite; the FIRST REAL administration rides the adapter CLI-transport
  BACKLOG row (its Context now names this); the incumbent stays loudly advisory on
  the governed paths until then. Not a plan mutation — an execution disposition
  recorded here; plan P5's dogfood clause is satisfied-by-deferral per this ruling.
