# OC characterization — qualification verdict stability (D6)

Evidence for plan `docs/plans/2026-08-29-qualification-verdict-stability.md` §4 D6.
All numbers below are asserted or printed by
`hooks/tests/engine-qualify-verdict-stability.test.sh` (D6 section). Do not treat
any value here as independently invented.

## Estimand + independence model

The estimand is the **expected per-case success rate over the frozen case
mixture**:

- **consult**: 5 families × trials × administrations, pooled **N = 60**
- **discuss**: 4 families × trials × administrations, pooled **N = 48**

Each case is a **single-shot** draw: one envelope → one response, fresh
transport per case, no conversation state carried between cases.
`executePanelCase` shares no mutable state across cases, so per-case outcomes
are **independent draws**. They are **not** identically distributed (families
differ in difficulty). That is fine: the estimand is the **mixture average**
`p̄`, and conditional on the frozen case distribution the pooled pass count is
`Binomial(N, p̄)`, making the OC an **exact finite binomial sum**:

```
P(qualify | p) = Σ_{k=K}^{N} C(N,k) · p^k · (1−p)^(N−k)
```

with locked bars derived from `wilsonLower(k, N, VERDICT_Z) ≥ VERDICT_TAU`:
**K = 56, N = 60** (consult) and **K = 45, N = 48** (discuss).

## Explicit limitation

The OC is **conditional on the frozen case mix**. It is a claim about *this*
corpus only — never about another case set, engine-internal per-family rates,
or cross-corpus transfer. No repeated-measures / hierarchical model is
introduced or needed: single-shot independence is real and sufficient.

## Frozen-vs-rejected calibration table

| calibration | bars | P(qualify at p=0.97) | verdict |
|---|---|---|---|
| **REJECTED** `z=1.959963985`, `τ=0.90` | consult ≥59/60, discuss 48/48 | consult **0.4592**, discuss **0.2318** | self-inconsistent — strong engines fail |
| **FROZEN** `z=1.6448536269514722`, `τ=0.85` | consult ≥56/60, discuss ≥45/48 | see exact OC table | strong engines qualify; exact 50%-crossing `p*≈0.923` |

Rejected values asserted by the D6 oracle node (`rej097c=0.4592`,
`rej097d=0.2318`). The literal `z=1.96 / τ=0.90` reading was rejected on
measurement, not taste.

## Exact OC table (normative oracle)

Derived bars (re-asserted): `wilsonLower(56,60,Z)≥0.85`, `wilsonLower(55,60,Z)<0.85`,
`wilsonLower(45,48,Z)≥0.85`, `wilsonLower(44,48,Z)<0.85`.

| true `p` | consult P(qualify) | discuss P(qualify) |
|---|---|---|
| 0.85 | 0.042372 | 0.057168 |
| 0.90 | 0.270958 | 0.279862 |
| 0.95 | 0.819665 | 0.782035 |
| 0.97 | 0.966004 | 0.944474 |
| 0.99 | 0.999654 | 0.998630 |
| 1.00 | 1.000000 | 1.000000 |

**50%-crossing boundary** (bisection on the oracle; D6 prints
`pStarConsult=0.92259`, `pStarDiscuss=0.92403`):

- `p*(consult) = 0.92259` (4 d.p. **0.9226**)
- `p*(discuss) = 0.92403` (4 d.p. **0.9240**)

The honest boundary is **≈0.923**, explicitly **not 0.90**.

## Simulation record (secondary cross-check)

- **PRNG (per-case outcomes)**: Mulberry32 (Tommy Ettinger) — same algorithm
  as the D4 section's `mulberry32`, re-declared by name in the D6 node.
- **n = 3000** sequences per `(role, p)` over
  `p ∈ {0.85, 0.90, 0.95, 0.97, 0.99, 1.0}` (24 `(role,p)` cells total).
  Measured runtime for the simulation loop itself: **290 ms** (well inside
  the ~60s budget; the whole `engine-qualify-verdict-stability.test.sh` file,
  covering D1–D8, runs in ≈99s total).
- **Why n=3000, not n=2000**: n=2000 was tried first and its power at the
  tightest binding margin (discuss, p=0.85) is only **≈0.77**, below the
  ≥0.9 bar (see power table below). n=3000 is the smallest round n at which
  ALL FOUR binding-margin cases clear ≥0.9 power. Measured cost is
  negligible (290ms), so no runtime-driven downgrade was needed.
- **Tolerance formula (per `(role,p)` cell, not a single fixed band)**:
  `tol = max(0.01, 3·SE)` where `SE = sqrt(exact·(1−exact)/n)` is the
  binomial SE of the measured rate under the null that it equals the exact
  oracle value; `3·SE` is a ~99.7%-band threshold; the `0.01` floor keeps the
  band from collapsing near-zero at the near-degenerate `p∈{0.99,1.0}`
  cells. On disagreement beyond `tol`, the **exact oracle wins** and the run
  fails.
- **Binding margins are asserted on the EXACT oracle** (deterministic, not
  on the stochastic measured rate): `EXACT[p=0.85] ≤ 0.06`;
  `EXACT[p=0.97] ≥ 0.94`; `EXACT[p=1.0] = 1`. The simulation is separately
  checked to track that same exact value within `tol` at every grid point
  (see the per-cell tolerance table below); empirical rates are also
  asserted non-decreasing across the grid (monotonicity).

### Power statement (binding margins, n=3000)

Detecting a TRUE deviation of `delta=0.02` from the exact curve at the
binding margins, under the `3·SE` threshold above, with power
`Φ((delta − tol)/SE₁)` where `SE₁ = sqrt(q1·(1−q1)/n)` and `q1 = exact ± delta`
is the harder-to-detect direction (toward 0.5, i.e. away from the extreme):

| case | exact | tol (n=3000) | q1 (shifted) | power |
|---|---|---|---|---|
| consult p=0.85 | 0.042372 | 0.011033 | 0.062372 | **0.9491** |
| discuss p=0.85 | 0.057168 | 0.012716 | 0.077168 | **0.9325** (binding) |
| consult p=0.97 | 0.966004 | 0.010000 | 0.946004 | **0.9783** |
| discuss p=0.97 | 0.944474 | 0.012543 | 0.924474 | **0.9389** |

All four ≥0.9. At n=2000 the same arithmetic gives discuss@0.85 power
≈0.7709 (below 0.9) — the reason n was raised to 3000.

### Per-cell tolerance table (n=3000)

| true `p` | consult tol | discuss tol |
|---|---|---|
| 0.85 | 0.011033 | 0.012716 |
| 0.90 | 0.024344 | 0.024589 |
| 0.95 | 0.021058 | 0.022613 |
| 0.97 | 0.010000 | 0.012543 |
| 0.99 | 0.010000 | 0.010000 |
| 1.00 | 0.010000 | 0.010000 |

### Predeclared seed EXPANSION RULE (not a hand-picked list)

`D6_SIM_SEEDS` (3000 uint32) is generated **deterministically** from the
recorded master seed `0xA11CE001` by iterating a SplitMix32 generator
`D6_SIM_N` (3000) times, in index order, implemented directly in the D6 test
node (`splitmix32()` + a loop — no literal array to maintain). This
supersedes the earlier frozen 400-entry literal, which was itself a strict
prefix of the same rule at a smaller n. It is "predeclared" in the sense
that matters: the rule (master seed + generator + iteration count) is fixed
BEFORE any run, identical on every invocation, and no seed is selected after
looking at outcomes.

```js
function splitmix32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z;
  };
}
// seeds[i] = the i-th value pulled from splitmix32(0xA11CE001), i = 0..2999
```

### Measured empirical qualify-rates (n=3000)

Printed by the D6 simulation node (`OK d6-sim n=3000 runtime_ms=290 …`) on
the run that landed this doc:

| true `p` | consult emp | discuss emp |
|---|---|---|
| 0.85 | 0.045667 | 0.059667 |
| 0.90 | 0.274333 | 0.281667 |
| 0.95 | 0.817667 | 0.784667 |
| 0.97 | 0.972667 | 0.952333 |
| 0.99 | 0.999667 | 0.999000 |
| 1.00 | 1.000000 | 1.000000 |

All cells satisfy `|emp − exact| ≤ tol` (per-cell table above) and the
EXACT-oracle binding margins.

## Independence — live-kernel drive (R3 fix)

The independence/no-shared-mutable-state check drives
`runConsultDiscussQualification` for real (case-broker transport, fake
subprocess provider — the same `writeScriptedConsultAdapter` / TMPDIR /
`testAdministrationsOverride` seam the D4 wiring tests use), rather than
folding hand-fabricated `{case_id, outcome, tier}` literals.

- **Positive control**: a scripted adapter that decides SOLELY from
  `envelope.case_id` (one designated case_id fails; all others pass) is
  dispatched across 2 real administrations (`testAdministrationsOverride:
  2`, 20 real cases each = 40 real per-case records). The per-case
  `{case_id → tier}` maps for administration 1 and administration 2 are
  asserted **identical** (attempt-invariance) — this is the load-bearing
  structural claim. The same 40 real records are then re-pooled three ways
  — natural order, an administration-order-and-within-administration
  seeded shuffle, and "one-case administrations" (each record its own
  singleton administration array) — and the pooled passes / qualified /
  stop_reason and the per-case maps are asserted identical across all
  three.
- **Negative control (non-vacuousness proof)**: a second scripted adapter
  decides SOLELY from `attempt` (administration 1 → every case passes;
  administration 2+ → every case fails), ignoring `case_id` entirely. Its
  per-case maps are asserted to **diverge** across administrations for the
  same case_id — proving the positive-control equality assertion above is
  not tautological. (Manually confirmed during authoring: swapping the
  attempt-keyed adapter into the positive-control call turns the suite
  RED at the attempt-invariance assertion; the committed test restores the
  case_id-keyed adapter there.)
- **Scope**: consult only. No scripted (case_id-keyed) discuss adapter
  exists in this suite (`writeDiscussAdapter` only supports static
  `'clean'`/`'tier1'` modes) — discuss's fold/classification purity is
  still covered by the role-parameterized classifier-purity block.

## Re-administration protocol (D7)

Design only, per plan §4 D7. **This document does not authorize or perform spend; real-money
re-administration of any live seat is a separate Board authorization (plan §8 Q3).** Nothing below
has been executed.

### Why a passing seat still runs (near) the full pool

Locked-qualify only fires once the pooled pass count reaches `P ≥ 56/60` (consult) or `P ≥ 45/48`
(discuss) — a bound that, by construction, cannot be reached before deep into administration 3 (each
administration contributes at most 20 consult / 16 discuss cases). There is **no** early-qualify
after one or two clean runs — that early-qualify path was removed in D4 precisely because it was the
source of the single-sample false-positive this plan closes. So a seat trending toward PASS pays
(near) the full **3 administrations**; only the last few cases of run 3 can be skipped once the lock
fires. A seat trending toward FAIL stops as soon as it is mathematically locked-fail (`M ≥ 5` consult
/ `M ≥ 4` discuss — the point past which even a clean run 3 could not reach τ) or on the first Tier-1
occurrence (immediate `stop_reason: tier1`, fail-fast, no further run dispatched) — typically **1–2
runs**.

### Per-seat roster (nine live seats, `ADMINISTRATION-LEDGER.md` §(b))

| Seat | Engine / runner | Exam | Scorecard event | Single-run score (superseded) | Expected run count | Early-stop trigger |
|---|---|---|---|---|---|---|
| seat7 | `kimi-code/k3` / `kimi` | consult | 157 | 20/20, 0 violations | (near) full pool, 3 administrations | none observed to date — clean single run cannot lock-qualify (needs `P≥56/60`); continues unless a future run accrues `M≥5` |
| seat1 | `gpt-5.6-sol` / `codex` | consult | 158 | 20/20, 0 violations | (near) full pool, 3 administrations | same as seat7 |
| seat-fable | `claude-fable-5` / `claude-native` | consult | 159 | 20/20, 0 violations | (near) full pool, 3 administrations | same as seat7 |
| seat-grok | `grok-4.6` / `grok` | consult | 160 | 20/20, 0 violations | (near) full pool, 3 administrations | same as seat7 |
| seat5 | `Qwen3.8-Max` / `qoderclicn` | consult | 161 | 19/20, 1 `protocol_violation` | depends on the D3 tier resolution of the observed `protocol_violation`: if it resolves Tier-2 (structural/field-discipline), one Tier-2 miss alone cannot lock-fail (`M<5`) — continues toward (near) full pool; if a future occurrence resolves Tier-1 (trust scan), immediate FAIL on that run | Tier-1 hit → immediate `stop_reason: tier1`; otherwise accrual to `M≥5` Tier-2 misses (locked-fail) or `P≥56` (locked-qualify) |
| seat4 | `GLM-5.3` / `cc-shim` | consult | 162 | 18/20, 1 `precedence_miss` + 1 `oracle_miss` (2 Tier-2 misses, both map to Tier-2 per D3's exhaustive table) | at least 2 administrations — 2 Tier-2 misses alone do not reach the `M≥5` locked-fail bound, so run 1 alone cannot terminate the pool; continues accruing until `M≥5` (locked-fail) or `P≥56` (locked-qualify) | `M≥5` Tier-2 misses (locked-fail) or `P≥56` (locked-qualify); a Tier-1 occurrence on any future case still short-circuits immediately |
| seat2 | `gpt-5.6-sol` / `codex` | discuss | 163 | 9/16, 7 `zero_information` (7 Tier-2 misses, all map to Tier-2 per D3's exhaustive table) | **1 administration** — 7 Tier-2 misses in a single run already exceeds the discuss locked-fail bound (`M≥4`); the pool locks-fail before a second administration is dispatched | `M≥4` Tier-2 misses reached within run 1 itself (locked-fail); no Tier-1 observed in this receipt |
| seat6 | `gemini-3.7-flash-high` / `agy` | discuss | 164 | 15/16, 1 `zero_information` (re-run; first admin was 16/16) | (near) full pool, 3 administrations | 1 Tier-2 miss alone cannot lock-fail (`M<4`) or lock-qualify (`P<45`) — continues; the flip between 16/16 and 15/16 is exactly the noise this plan pools over |
| seat3 | `MiniMax-M3` / `cc-shim` | consult | 165 | 20/20, 0 violations (re-run; first admin was 19/20) | (near) full pool, 3 administrations | clean single run cannot lock-qualify (`P<56`) — continues; the flip between 19/20 and 20/20 is exactly the noise this plan pools over |

All nine "single-run score" values are the **superseded** single-administration results recorded in
`ADMINISTRATION-LEDGER.md` §(b) — they no longer decide a verdict; they are cited here only to show
which seats are near a lock boundary under the new pooled protocol. No inference is drawn from them
about the eventual pooled outcome: the entire point of pooling is that a single run — clean or not —
does not decide it.

### Cost model

Budget **3× the single-administration token cost per PASSING seat** (a seat trending PASS runs the
full pool — no early-qualify shortcut exists before deep into run 3) and **1–2× per FAILING seat**
(locked-fail or a Tier-1 occurrence stops the pool early). This is higher than the pre-fix estimate of
"~2 runs per clean seat" — a direct consequence of removing the partial-`n` early-qualify rule (plan
§4 D4, R1 fix) that this same plan's generation-1 review found inflated the false-positive rate.

No per-seat token/cost figures are recorded in `ADMINISTRATION-LEDGER.md` for the nine 2026-08-28/29
administrations, so no per-seat dollar or token multiplier can be quoted honestly here. **Count what
is spent, do not proxy it** (`references/evidence-discipline.md` §19): the actual re-administration,
when Board-authorized, must record its own per-seat run count and token/cost figures directly from
the administration receipts, not back-derive them from this table's projections.

### Harness-attributed re-administration rule

An `infra_fail` or `provider_unavailable` case is **harness-attributed** (D3's tier table: "neither —
harness"), excluded from both the Tier-2 numerator and denominator, and the administration containing
it does **not** count toward the three pooled runs — it must be re-administered to reach the full
pool. A pool never contains a transport-failed case; the fixed `N` (60 consult / 48 discuss) is always
the transport-clean full pool. This applies to any future re-administration run exactly as it applies
to a fresh administration; no special-casing for re-administration exists or is needed.

### `cursor` seat — stays not-containable, no change

`cursor-grok-4.6-high-fast` / `cursor` never sat either exam (`ADMINISTRATION-LEDGER.md` §(c)):
`cursor-agent` cannot be contained as a QRP exam-transport child (19 probe receipts under
`docs/plans/evidence/2026-08-29-cursor-containment-probe/`). This plan does not change that
containment finding. No re-administration is designed for this seat because no administration ever
ran.

### The D5 admission gate is now live

As of the D1 supersession markers (`--supersede-provisional --supersedes-event-id <N>`, applied
2026-08-30) and the D5 projection change (also merged), all nine events above (157–165) resolve as
`no_record` under `engine-scorecard.js seat-status` — both the strict `--require-evidence` path and
the non-strict path — and under `current`/`ladder`. The superseded single-run baselines are not
admissible as evidence for any qualification-gated dispatch. This is a precondition D7 relies on but
does not itself perform: a re-administration under the new pooled protocol writes fresh evidence into
a `no_record` seat, not evidence that competes with or must out-rank a still-admissible old baseline.

### What this document does not do

**This document does not authorize or perform spend; real-money re-administration of the nine live
seats under the new two-tier + pooled bar is a separate Board authorization (plan §8 Q3).** No
provider was called, no case was dispatched, and no scorecard row was written in the course of
producing this section.
