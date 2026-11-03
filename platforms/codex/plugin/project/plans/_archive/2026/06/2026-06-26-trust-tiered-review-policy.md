# Trust-tiered review policy: execution-oracle-primary, cross-family review secondary

> **Status**: design draft → gpt-5.5 xhigh adversarial review loop (2026-06-26). Round 1: FIX-THEN-SHIP
> (2🔴+6🟠+3🟡+1🔵 — all addressed: review-risk≠source-trust composite, provenance manifest,
> cross-family-mandatory-whenever-L2, tier collapsed to risk-based, harness split, local future-gated,
> shadow→gate). Round 2: FIX-THEN-SHIP (1🔴+3🟠+1🟡 — all addressed: L1 enforcement-vs-telemetry
> split, cross-family hard at every risk, no-oracle→human-escalation in table, qc_panel promotion
> metrics, family_id canonicalization + fail-closed-on-unknown). **Round 3: SHIP-AS-IS** (0🔴/0🟠;
> 2🟡+1🔵 residuals → §6 pre-build TODOs). Decorrelated reviewer = gpt-5.5 xhigh (≠ Claude author).
> Design APPROVED + **IMPLEMENTED in v2.25.11** (merged 6a51f2e); §6 TODOs folded into the impl. Buildable core shipped; shadow-calibration + local-runner enforcement remain future-gated.
> **Scope**: how `/l4`/`/l5` (and the qc panel) should choose verification effort + reviewer
> family as a function of WHO implemented. Supersedes the implicit "fixed 3-family qc_panel"
> emphasis shipped in v2.25.9.

## 1. Problem

`/l5` can dispatch the implementer to engines of very different trust: a frontier hosted model
(`gpt-5.3-codex-spark`, OpenAI), a cheap/weak hosted model (`Gemini 3.5 Flash`, Google via agy),
or — in future — a local open model (llama/qwen/mistral class). The current design applies the
SAME verification regardless of who implemented: a fixed `qc_panel` (default 3 families) +
`independent_harness:on/off` + a `reviewer_engine`. Two questions were unanswered:

1. **Reviewer family** — given implementer family X, how should the reviewer(s) be chosen? One
   cross-family reviewer? Two? Does it matter?
2. **Verification depth** — should a weak/local implementer get heavier verification than a
   frontier one, or is one policy enough?

## 2. Evidence (industry/research, 2026-06)

Three independent literature sweeps converged. Pre-cutoff anchors are firm; **2026-dated arXiv
preprints are single-source — direction corroborated by the firm anchors, exact figures TO-VERIFY
before any external citation.**

**E1 — The generation–verification gap is real and wider for weaker models.** A model produces a
correct answer far more often than it can select it; the gap is larger for the weaker generator
(Weaver, arXiv 2506.18203 [2025-06 submission; TO-VERIFY]; mechanism corroborated by GenRM scaling
2408.15240, Cobbe et al. GSM8K verifiers 2110.14168). Small models are poor self-verifiers; intrinsic
self-correction without external feedback does not work and can degrade (Huang et al., ICLR 2024,
2310.01798 [firm]).

**E2 — Self-generated tests are a weak, gameable signal — worse for weaker models and under
optimization pressure.** LLM oracles encode "what the code does", not "what it should do"
(2410.21136 [firm]); SWE-bench Verified hides repo tests from the agent and grades by
FAIL_TO_PASS + PASS_TO_PASS (2310.06770 [firm]); ~31% of "resolved" SWE-bench patches pass only
because tests are too weak (SWE-bench+, 2410.06992 [firm]); agents actively game self-tests
(`sys.exit(0)`, monkey-patching scorers; OpenAI CoT-monitoring 2503.11926 [firm]). → Validates
autopilot's `delegate-selftest-false-green` + L0/L1 test-integrity gates.

**E3 — Cross-family decorrelation: the 1→2 jump is the win; more ≈ no more independence.**
Self-preference bias is measured (MT-Bench, GPT-4 +10% / Claude +25% self-favor, 2306.05685
[firm]). Mixture-of-Agents: the n=1→2 diverse-proposer jump dominates, n=2→3 ~flat (2406.04692
[firm]). "Nine Judges, Two Effective Votes": 9 judges across 7 families ≈ 2.18 effective
independent votes, and the best single judge ≈ the full panel (2605.29800 [2026, TO-VERIFY]).
PoLL uses 3 disjoint families but contains NO size ablation (2404.18796 [firm]). → The binding
constraint is error CORRELATION, not judge count. **Caveat (gpt-5.5 review): "Nine Judges" and
Mixture-of-Agents are LLM-as-JUDGE / eval-task results, NOT controlled code-review defect-discovery
studies — they support "avoid large CORRELATED judge panels," they do NOT license a precise
reviewer-count table. The specific 1-vs-2 counts in §3 are therefore a PROVISIONAL heuristic to be
calibrated, not an evidenced constant.**

**E4 — Aggregation can't substitute for an external verifier; majority vote suppresses a correct
minority.** "Consensus is Not Verification": when LLM errors correlate, no aggregation rule
(majority/union/confidence) scales truthfulness without an external verifier — the fix is to
route findings to execution/tests/human (2603.06612 [2026, TO-VERIFY]). "Beyond Majority Voting":
majority vote amplifies errors when correct solutions are a minority (2510.01499 [firm-ish]). →
Validates autopilot's `union-on-VERIFIED-critical` (majority forbidden; the "verified" = external
verifier IS the prescribed primitive).

**E5 — Execution is the floor but only if the oracle is decorrelated.** Self-Debugging fixes from
execution feedback alone (2304.05128 [firm]); but naked green is gamed (E2). Trustworthy execution
needs a DECORRELATED oracle: held-out/independent tests + mutation score (proves tests have
killing power, not just coverage; Google-scale 2102.11378 [firm]) + differential/metamorphic/
property-based oracles (Csmith, Hypothesis [firm]). LLM-written suites have low mutation kill rates
(2501.10200 [firm-ish]).

**E6 — LLM review (L2) is needed but currently weak — and can't be replaced by execution.** Code
review's value is mostly NON-defect: design, spec-fit, knowledge transfer (Bacchelli & Bird ICSE
2013; Sadowski Google ICSE-SEIP 2018 [firm]). But SOTA LLM code review F1 <20%, FP up to 97%
without context; value comes from artifact/context grounding, not model self-report (2509.01494,
2601.18844 [2026, TO-VERIFY]). Specification gaming is a structural fact (DeepMind catalog [firm]).

**E7 — Verification effort scaled to source trust is endorsed by cascade/router research — but NOT
shipped by any mainstream coding agent.** FrugalGPT (2305.05176), RouteLLM (2406.18665), Model
Cascading for Code (2405.15842) escalate low-confidence cheap output; Meta RADAR risk-tiers
(auto-land 60% low-risk by ML risk score, route high-risk to human; 2605.30208 [2026, TO-VERIFY]).
Devin/Cursor/Aider verify UNIFORMLY. **Framing correction (gpt-5.5 review): RADAR + the cascades
tier by MEASURED diff/output risk + deterministic-validation eligibility — NOT by the generator's
provider tier. So E7 licenses "escalate by measured RISK"; it does NOT license a provider/family
lookup table.** → A risk-tiered design is ahead of shipped tools; source-trust is ONE input to
measured risk, not the whole key (see §3.2).

**E8 — Hard limit.** Oversight degrades with the capability gap and fails structurally on
adversarial/backdoor code ("Scaling Laws for Scalable Oversight", 2504.18530 [firm-ish]). None of
this defends against a MALICIOUS same-trust-boundary worker — same lesson as the cgroup-containment
finding (teardown hygiene ≠ security boundary). **This policy hardens HONEST-but-WEAK generators
only.**

## 3. Design

### 3.1 Two layers, correctly ordered

**L1 — decorrelated execution oracle (PRIMARY, always, generator-independent).** Not "run the
implementer's tests" (gameable) — a DECORRELATED oracle: independent/held-out tests, mutation-
adequate where feasible, plus differential/metamorphic/property where an oracle is otherwise
unavailable. This is the real lever (zero lineage with the generator) and scales UP in importance
as the implementer weakens. This is the **upgraded meaning of `independent_harness`** — from a
flag that "runs a harness" to the spine that "builds a decorrelated oracle and never trusts
self-green".

**L2 — cross-family LLM review (SECONDARY).** For what execution can't see: design, spec-fit,
security/authorization logic, maintainability, "tests the wrong thing". **Whenever L2 review runs at
all, ≥1 reviewer from a family DIFFERENT from the implementer is MANDATORY** (a same-family reviewer
is not a second Swiss-cheese slice — it shares the implementer's blind spots). Cross-family is a
hard requirement at every risk level; only the ESCALATION SEVERITY on a finding varies by risk. A
2nd different family is a provisional add for high-risk only. Each reviewer's bug claim is a
HYPOTHESIS routed back to L1/execution (or human) to verify — **`union-on-verified-critical`, never
majority** (E4).

### 3.2 Review depth keyed on MEASURED RISK, not source tier alone

**Correction from review (was a category error):** dispatch authority (`resolve-doa`: "who MAY
implement") and review depth ("how much confidence in THIS patch") are different questions. Source
trust is ONE input, not the key. Define a composite **`implementation_review_risk`** =
f(source-trust from `resolve-doa`, diff risk/size/protected-paths, **oracle availability** for the
changed surface, security/auth domain surface, runner provenance, historical failure rate). Review
depth is derived from this composite — same spirit as Meta RADAR's measured Diff Risk Score (E7),
NOT a provider/family lookup.

**Provenance precondition (operational hole closed):** the policy is inert without authoritative
implementer provenance AT REVIEW TIME. `dispatch-hetero.sh` already emits `runner`/`model`/
`containment` in its outcome JSON; require the depth-0 loop to persist a **dispatch manifest**
{engine id, provider/family, `resolve-doa` tier, runner, worktree/artifact id} alongside the diff.
**Missing/unverifiable manifest ⇒ fail-closed to the strictest tier (or escalate), never silently
default to "trusted".**

**Risk → depth (PROVISIONAL heuristic, calibrate before flipping defaults).** Note the
`oracle_available` axis is SEPARATE from risk: an executable oracle either exists for the changed
surface or it doesn't, and "doesn't" cannot be remediated by "emphasizing the oracle".

| `implementation_review_risk` | L1 (when `oracle_available`) | L1 (when NO oracle: docs/config/design) | L2 review |
|------------------------------|------------------------------|------------------------------------------|-----------|
| **low** (high source-trust, small diff, no security surface) | decorrelated oracle, standard | human-judgment gate (no fake green) | **1** reviewer, family ≠ implementer (cross-family hard-required — see §3.1) |
| **high** (weak/low-trust source OR large/risky diff OR security/auth surface) | decorrelated oracle emphasized + best-of-N / resample-and-reject on fail; **missing L1 ⇒ non-automerge/escalate** | **human escalation, non-automerge** (NEVER a green from "no oracle") | **1** mandatory cross-family + a **provisional 2nd** family; findings escalate harder |

Counts are a heuristic, not an evidenced constant (E3 caveat). "WHICH specific reviewer model" stays
the operator's config choice (`review-loop-config.md`); the machine derives COUNT + the cross-family
REQUIREMENT + L1 strength from the risk — it does not auto-pick models (don't override the operator's
"gpt-5.5 is the most thorough reviewer" judgment).

### 3.3 Concrete changes to autopilot (all behind config + calibration, shadow→gate)

1. **`qc_panel` default**: candidate-trim toward 1 cross-family (+ provisional 2nd at high risk),
   **shipped behind config and run in SHADOW against the current 3-family panel on recent tasks**.
   **Promotion criteria (not just "no regression")**: over a defined sample window (≥N recent
   tasks), the trimmed panel must show (i) **no drop in externally-verified critical/major finding
   retention** vs the 3-family panel, (ii) **no rise in escaped-defect rate**, (iii) **FP rate not
   worse**, at (iv) lower cost/latency. Flip the default only when all hold; else keep 3.
2. **`independent_harness` — split the two things it currently conflates**:
   (a) "**decorrelated verification REQUIRED**" (the diff must be checked by something the
   implementer didn't author/control), and (b) "**oracle-strength levels**" (held-out tests <
   mutation-adequate < differential/metamorphic/property). For changes with **no executable oracle**
   (docs/config/design specs), (b) is N/A and the fallback is a **human-escalation** gate, not a
   fake green. **Enforcement vs telemetry are separate**: `block` (high-risk: missing required L1 ⇒
   non-automerge/escalate) is the enforceable policy; `warn`/`off` are **telemetry-only and may
   NEVER convert a missing-L1 into a green/pass result** — they only suppress the gate's blocking,
   not its honesty.
3. **Family-overlap — cross-family is a HARD requirement at EVERY risk level whenever L2 runs**
   (per §3.1; a same-family reviewer is not a second slice). What varies by risk is only the
   CONSEQUENCE applied to a finding, NOT whether cross-family is required. `resolve-review-loop.sh`
   refuses/escalates a no-cross-family panel at all risk levels; the legacy `warn` is a transitional
   shadow signal only, retired once the rule is enforced. **`family_id` must be canonicalized**:
   normalize by model lineage→provider→(hosted/local)→runner; an API reseller of vendor X counts as
   family X; **unknown/ambiguous family ⇒ fail-closed (treated as NOT cross-family / strictest tier)**,
   never optimistically "different".
4. **Wire it**: `resolve-review-loop.sh` consumes the dispatch manifest + computes
   `implementation_review_risk`, emitting `required_review_families` + `cross_family_required` +
   `l1_required` for the depth-0 loop to enforce. Reuse `resolve-doa` for the source-trust INPUT
   only — not as the sole key.
5. **Keep (validated)**: `union-on-verified-critical`, the family-aware warning, reviewer≠generator.

## 4. Scope boundary (what this is NOT)

- **NOT a defense against a malicious implementer** (E8). Worse: for a **local/same-trust-boundary**
  implementer that can touch the tests/harness/repo state, **L1 is not actually decorrelated without
  an isolation boundary** — a manipulated harness gives a forged green. So a low-trust/local
  implementer is **non-automerge** until either (i) the harness has out-of-band provenance (built by
  depth-0, outside the worker's reach) or (ii) a real isolation boundary exists (BACKLOG). Honest-
  but-weak hardening only.
- **NOT live today**: the repo's implementers are codex/agy; a **local runner does not exist yet**.
  The low-risk/high-risk machinery ships now (codex/agy are both reachable); the **local-specific
  enforcement is future-gated on actual local-runner detection** and is non-normative until then.
- **NOT auto-selecting reviewer MODELS** — only deriving count / cross-family requirement / L1
  strength from measured risk.
- **NOT a bigger panel** — smaller + execution-grounded beats a large correlated judge panel (E3).

## 5. Resolved decisions (were open questions)

- **Q1 (cheap-hosted middle tier)** → **collapsed**. Provider/model labels are false precision and
  age fast; use low/high `implementation_review_risk` with best-of-N as a flag, not a label tier.
- **Q2 (2 families for low-trust)** → **demoted to provisional**. The 1→2 jump is the measured win;
  a 2nd family is marginal (E3), so the default is 1 cross-family + a provisional 2nd only at high
  risk, and the budget bias goes to a STRONGER L1 oracle over a 3rd judge.
- **Q3 (mandatory L1 hard gate vs loud default)** → **enforcement and telemetry are separate axes**
  (per §3.3.2). The `block/warn/off` knob controls only whether a missing required-L1 BLOCKS the
  merge; it **never** lets `warn`/`off` report a missing oracle as a green/pass (that stays an
  honest "unverified"). Default `warn` for low-risk; **high-risk defaults to `block`/non-automerge**.
  Mirrors the qc-gate precedent without letting a softer mode forge a passing result.
- **Q4 (reuse `resolve-doa` tier)** → **it WAS over-coupling**. `resolve-doa` provides the
  source-trust INPUT only; review depth keys on the composite `implementation_review_risk` (§3.2).

## 6. Pre-build implementation notes (gpt-5.5 round-3 residuals — resolve when coding, not blocking)

- **🟡 Spell the terminal states (§3.3.2/Q3).** Define the allowed verdict states explicitly so
  `warn` can never masquerade as a pass: `verified` / `unverified-nonblocking` / `unverified-blocking`.
  Low-risk `warn` ⇒ `unverified-nonblocking` (proceeds but is HONESTLY labelled unverified, not green).
- **🟡 Operationalize `implementation_review_risk` (§3.2/§3.3.4).** The inputs are named but not
  scored — add a deterministic scoring table (diff size buckets, protected-path hit, oracle
  availability boolean, security/auth surface boolean, historical failure rate) → low/high, BEFORE
  any default flips. Without it, implementations drift on thresholds.
- **🔵 `family_id` mapping fixture (§3.3.3).** Add a small canonical mapping fixture (reseller of
  vendor X → X; fine-tune of base B → B's family; proxy/gateway → underlying; local-hosted open model
  → its lineage; unknown → fail-closed) used by `resolve-review-loop.sh` tests, so the cross-family
  rule is enforceable and testable.

## 7. Review loop history

| Round | Reviewer | Verdict | Findings |
|-------|----------|---------|----------|
| 1 | gpt-5.5 xhigh (codex, read-only) | FIX-THEN-SHIP | 2🔴 6🟠 3🟡 1🔵 — provenance hole, resolve-doa category error, E3/E7 overreach, table↔open-Qs incoherence, harness overload, local-isolation gap, false-precision tier, high-trust cross-family contradiction, citation date, unproven trim |
| 2 | gpt-5.5 xhigh | FIX-THEN-SHIP | 1🔴 3🟠 1🟡 — L1 enforce inconsistency, cross-family not-mandatory-low-risk, no-oracle↔table contradiction, no promotion metric, family_id underspecified |
| 3 | gpt-5.5 xhigh | **SHIP-AS-IS** | 2🟡 1🔵 (→ §6) |
