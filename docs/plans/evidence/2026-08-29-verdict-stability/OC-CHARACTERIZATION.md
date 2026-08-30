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
