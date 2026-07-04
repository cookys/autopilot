# Quality-Floor Engine — the judgment-demotion ladder

**狀態**: ✅ COMPLETE — P1 v2.31.11 (165e1b7); P2-P4 + prereqs v2.31.12 (ab8f619, Board-directed one-run completion). Remaining: the P3 statistical campaign (operator cost gate, see pilot report).
**Goal**: evolve autopilot from "clone cookys, remove cookys from the loop" to the next stage:
**make a weak orchestrating model sustain frontier-model output quality over long-running
tasks** — plan / implement / debug / review / re-think — by design, not by hoping the model
is smart.

## 1. The thesis

Autopilot v2.31 already removes the *human* from the loop. The residual dependency is on a
*frontier-class orchestrator* at depth-0: the sessions that ship clean releases still lean on
the strong model's judgment at specific moments. The next evolution is to make those moments
**enumerable, rare, and individually mechanizable** — so the same pipeline driven by a
mid-tier model produces output whose *floor* matches the strong model's *typical* output.

The core design move is the **judgment-demotion ladder**:

| Level | Mechanism | Weak-model demand | Exists today? |
|-------|-----------|-------------------|---------------|
| **L0 — Script** | deterministic tool; no model in the loop | none | autopilot's DNA (69 scripts) |
| **L1 — Playbook match** | model SELECTS from a curated catalog; each entry carries a **discriminating check** that confirms the match; **no match ⇒ mandatory L4** (never invent silently) | pattern matching + running the check | **NEW** — probe playbook, acceptance-pattern menu |
| **L2 — Fan-out + mechanical aggregation** | N independent perspectives across **disjoint families**; aggregation is a RULE, not a synthesis | prompt-following | partial (qc panel `union-on-verified-critical`); **EXTEND** to design + debug |
| **L3 — Probe-then-branch** | before any judgment call, run a cheap empirical discriminator; probes emit **strictly parseable output** and branch rules parse exact fields ("command ran" is never evidence) | running commands + reading structured output | partial (Spike-before-assert as prose); **MECHANIZE** as artifact contracts |
| **L4 — Escalate + ledger** | residual judgment goes to the strongest available engine (or the human); emission is **structural** (named protocol points MUST emit), and every entry is a demotion candidate | knowing when to stop — enforced by the no-match/no-probe rules, not by self-assessment | **NEW** — ledger convention on tree.js events |

**The meta-judgment answer** (the deepest critique of R0, raised by MiniMax): "classifying a
moment into a ladder level is itself judgment a weak model can't do." Correct — so the ladder
is **applied at design time, not at runtime**. The lifecycle stage contracts (§3) hard-code
which mechanism governs each boundary; the weak model never chooses a level. The residual
within-stage choices (which playbook entry, which pattern) are themselves guarded by
discriminating checks (L1) and the no-match⇒escalate rule. Runtime level-selection by the
model is a design smell anywhere it appears.

**Convergence, honestly stated**: the L4 ledger feeds `distill`/`learn` → new L0-L3 assets →
future runs escalate less **on recurring, stationary, observable decision classes** (codex's
scoping — adopted verbatim). Novel architecture, product taste, and moving external reality
do not converge and are not claimed to (§6). The KPI is **NOT** "ledger entries trend down"
(all three critique families independently called that a Goodhart trap — dropped): the KPI is
**demotions shipped per period** (ledger entries converted into catalog entries/scripts)
**while the escape-rate on a fixed, blind, strong-model-audited sample is non-increasing**
(§5). Escalation is free; *suppressed* escalation is the failure mode, and the named
structural emission points (§4.5) make silent suppression detectable at review time.

## 2. Evidence base — where the strong model was actually load-bearing

Ground truth from the v2.31.10 run (and repo history), classified by what the weak model
would have done wrong and which ladder level absorbs it:

| Moment (real, this repo) | Weak-model failure mode | Demotion |
|---|---|---|
| MiniMax panel returned 4 plausible findings; ALL disproven by reading code | acts on false findings → "fixes" non-bugs (cf. the recorded `codex unreachable-after-return misread` churn) | **L3**: adjudication protocol — REFUTED requires a mutation-validated probe (§4.3) |
| codex review rail broken only with the REAL engine (stubs green): stdout/stderr channel split | ships on green stubs; or flails editing the parser | **L1**: playbook entry "works-with-stub-fails-live" (§4.1) + **L0**: live-e2e required for rail changes (acceptance pattern) |
| Heredoc extraction needed byte-identical fidelity; tail-window needed a perturbation probe | invents weak acceptance criteria ("tests pass") | **L1**: acceptance-pattern menu with built-in negative controls (§4.2) |
| 3-family design panel: synthesis was NOT majority vote | majority-votes or defers to the most verbose panelist | **L2**: decision matrix + mechanical aggregation rules (§4.4) |
| codex-spark quota died mid-run; grok went silent; cc-shim flushed late | run dies or silently degrades | **L0**: capability-state + failover (exists); settle-wait (v2.31.10) — keep |
| "Pre-existing or introduced?" (4 suite failures) | wrong either way | **L0**: `verify-preexisting.sh` / base-worktree run — make REQUIRED in the release protocol |
| Plan-wrong-vs-push-through (REVERT call, v2.31.3) | sunk-cost pushes through | **L3**: re-think checkpoint on `risk-counter.js` thresholds + **L4** |
| l3-l6 product shape | bikesheds or breaks routing | **L4** — not demotable (§6) |
| This plan's own critique round: 3 families produced overlapping real flaws + several wrong claims (§9) | rubber-stamps critiques, "fixes" refuted ones | **L2+L3**: the adjudication table applied to critique claims — dogfooded in §9 |

## 3. The five stage contracts (typed artifacts, fail-closed validators)

Weak models freestyle badly but **fill forms well**, and scripts can reject malformed forms.
Every lifecycle stage emits a typed artifact; a validator gates progression. The ladder level
for each boundary is fixed HERE, at design time:

| Stage | Artifact (typed) | Validator | Governing levels |
|-------|------------------|-----------|------------------|
| Plan | six-element unit prompts + acceptance patterns from the menu (with negative controls) + disjoint scopes | `check-dispatch-suppression.sh`, `check-disjointness.sh propose` | L1 (menu) |
| Implement | commit on branch + integrity gates | git artifacts, `check-test-integrity.sh`, `check-disjointness.sh validate` | L0 |
| Review | nonce-wrapped verdict + findings → **adjudication table** | `dispatch-review.sh` parser + **NEW `adjudicate-findings.js`** (§4.3) | L2 (panel) + L3 (adjudication) |
| Debug | repro artifact + probe log + root-cause with discriminating evidence | **repro-before-fix rule**: fix dispatch requires a REPRODUCED entry | L1 (playbook) + L3 |
| Verify | independent harness/plan + executed-check evidence pointers | `check-node-report.js` (exists — reuse) | L2 (different-family authoring) + L0 |

Existing prose rules being FORMALIZED (not invented) by this plan — the repo already says
"findings are suggestions to evaluate, not orders" (`code-review.md` § Consuming a finding)
and already forbids majority vote (`union-on-verified-critical`); the change is turning those
sentences into typed artifacts a script can reject.

## 4. New assets

### 4.1 `references/probe-playbook.md` — diagnostic probe catalog (L1)
Cheap discriminating probes indexed by symptom, seeded from real incidents (each entry cites
its incident). Entry schema — four fields, all mandatory:
**symptom → probe (exact commands, strictly parseable output) → expected-if-match →
expected-if-NOT-match**. The last two fields are the discriminating check that kills the
"wrong playbook match" failure mode (raised independently by all three critique families):
an entry whose probe output matches *expected-if-NOT-match* is a NON-match and the model must
try another entry or escalate. **No matching entry ⇒ mandatory L4 escalation with a ledger
event** — inventing a novel probe silently is forbidden (the cold-start answer: novel classes
saturate toward the strong model by design until the growth rule catalogs them).
Seed entries (all from real history): works-with-stub-fails-live → split stdout/stderr,
diff channels; engine-vs-shell divergence → log `command -v` + `--version` INSIDE the spawned
context; intermittent-empty output → re-read artifact after delay + distinguish truly-empty;
parser-rejects-valid-looking output → dump the exact parse INPUT; config-not-applying →
print resolved config + source layer; test-passes-for-wrong-reason → perturbation probe;
env-var-not-reaching-child → env-dump inside the child.
Wired into: `skills/debug`, `agents/debugger.md`, re-dispatch prompt guidance.
**Growth rule**: every L4 escalation resolved by a novel probe MUST add an entry, validated
against at least one counterexample (the codex "stale catalog overfit" guard).

### 4.2 `references/acceptance-patterns.md` — mechanical acceptance menu (L1)
The planner ATTACHES acceptance criteria from a menu instead of inventing. Patterns:
**round-trip parity** · **perturbation** · **fidelity** (byte-identical move/extract) ·
**idempotency** · **negative self-check** · **live-e2e** (mandatory for dispatch-rail /
protocol changes — stubs never sufficient) · **baseline classification** (pre-existing vs
introduced). Every pattern TEMPLATE embeds its own negative control — an instance must
demonstrate it can fail (e.g. a perturbation instance includes the break-then-observe-red
step, not just green-path assertions). **No presence-linter ships**: codex's critique stands
— a string-label lint is toothless and invites cargo-culting; adequacy lives in the embedded
negative control + the reviewer contract ("acceptance without a demonstrated failure mode is
itself a Major finding" — one sentence added to reviewer.md).
Wired into: `skills/dev-flow` L-1 planning, `agents/planner.md`, six-element prompt template.

### 4.3 Finding-adjudication protocol + `adjudicate-findings.js` (L3) — promoted to Phase 1
Reviewer findings enter a typed table; **the table is a validated JSON artifact, not prose**
(both codex and MiniMax independently demanded executable enforcement in Phase 1 — adopted).
Statuses: `REPRODUCED | REFUTED | UNPROBED | PROOF_BY_TRACE`.
- **REPRODUCED**: the probe ran AND its parsed output asserts the claimed failure observably
  (execution status alone is never reproduction — exit-0 ≠ bug-absent, exit-1 ≠ bug-present;
  the entry records the expected failure signature and the observed output).
- **REFUTED** (the dangerous direction — weak models refute real bugs with vacuous probes):
  requires a **mutation-validated probe** — inject the claimed defect (or its minimal
  synthetic form) and the same probe MUST fire; a probe that stays green under the injected
  defect is vacuous and the finding reverts to UNPROBED. Unvalidatable ⇒ escalate, never
  silently refute.
- **PROOF_BY_TRACE** (codex): findings whose evidence is a spec/code contradiction with no
  runnable crash — evidence is a file:line trace chain; requires confirmation by a SECOND
  disjoint family before acting (it is the judgment-heaviest class).
- **UNPROBED**: may not be fixed; must be probed (playbook match, or a "write a runnable
  probe for this claim" unit dispatched to a different family than the finder) or escalated.
Only REPRODUCED / confirmed-PROOF_BY_TRACE findings may be dispatched for fixing. Probes are
EXECUTED by depth-0 (artifact-not-self-report applies to probes). Aggregation stays
`union-on-verified-critical` — "verified" now has a mechanical definition.
`adjudicate-findings.js`: append-only JSONL per review round (schema like review-result:
finding id, claim, probe cmd, expected signature, observed output digest, status, mutation
evidence for REFUTED); validates transitions; exit 1 on any fix-dispatch reference to a
non-actionable finding. Reuses the qc-panel refutation shape (`qc-panel.js` Q4) rather than
inventing a new interrogation format.

### 4.4 Design-panel decision matrix (L2)
Each panelist answers the SAME options × criteria matrix. Depth-0 aggregation is mechanical,
IN ORDER: (1) **unanimous AND panel spans ≥2 disjoint families AND decision reversible** →
adopt (mid-tier unanimity within one family is correlated bias, not signal — agy; family
disjointness is a precondition, not a nicety); (2) split on reversible → adopt the cheapest,
record a revisit trigger; (3) irreversible → REGARDLESS of unanimity, require a probe/spike
if the disagreement (or the unanimous premise) is probeable, else **L4 escalate**; (4) any
factual claim by any panelist → adjudication table (§4.3), never trusted on citation alone
(this round: 3-for-3 families included confidently-cited claims that were wrong — §9).
Wired into: `skills/ceo-agent/references/` + think-tank cross-link.

### 4.5 Escalation ledger (L4) — convention with structural emission, no vanity KPI
One `tree.js emit` event per residual judgment call (schema fields per tree-contracts; type
`escalation_opened`/`escalation_resolved` — the event types already exist; this plan adds the
CONVENTION of what must emit, not new machinery). **Structural emission points** (each is a
named protocol step whose output includes the event id, so omission is visible at the release
checklist, not dependent on model honesty): (a) playbook no-match (§4.1); (b) adjudication
unvalidatable-REFUTED / unconfirmed-PROOF_BY_TRACE (§4.3); (c) panel rule-3 irreversible
disagreement (§4.4); (d) plan-revision checkpoint trips (risk-counter thresholds); (e) any
depth-0 override of a dispatched artifact. finish-flow L-5.6 gains one checklist line:
"escalation events exist for every triggered emission point, or the trigger log shows none
fired". Under-reporting remains possible in principle (MiniMax's critique is recorded, not
dismissed) — the mitigation is that emission points are tied to OBSERVABLE protocol steps
rather than self-classification, plus the blind audit sample in §5. A marker-scanning
`check-escalation-coverage.js` is a P2 candidate, deliberately not P1 (weak lint, high
false-positive surface).
`retro`/`distill` gain a ledger-scan step; each recurring entry is a demotion candidate.

## 5. Calibration — how we know it works (not vibes)

- **Orchestration eval** (P3): a fixed task DISTRIBUTION (≥5 tasks, mixed sizes — one task
  measures that task, not orchestration), frozen bases, mid-tier orchestrator, assets ON vs
  OFF. Invalidators designed out per the critique round: arm isolation (the eval plugin-arm
  BACKLOG entry is a prerequisite); same final oracle for both arms, independent of the new
  assets; ON/OFF context-length confound controlled (OFF arm gets equal-length neutral
  padding); task set post-training-cutoff or synthetic (contamination); gates executed
  deterministically, never judged by the mid-tier model itself (verifier bias).
- **Blind strong-model audit sample**: N% of shipped units re-audited by the strongest
  available engine without seeing the weak orchestrator's verdicts (decorrelated); feeds the
  escape-rate store (`qc-metric-emit.js` — exists).
- **Docs-only confound** (codex): P1 ships prose + ONE enforcing script
  (`adjudicate-findings.js`); the eval must therefore report per-mechanism adherence (did the
  run actually produce adjudication tables / pattern negative-controls / ledger events), not
  just outcomes — "ON" must mean enforced, not mentioned.
- Arena/preference scores are NOT evidence (standing routing-axis bar).

## 6. Honest limits — what does NOT demote

- **Intent alignment** (MiniMax): every gate measures internal consistency; a pipeline
  consistently asked the wrong question passes all of it. The OKR/goal-review gate (L-5.1)
  and the Board are the only intent checks; this plan does not claim otherwise.
- **Taste / product shape / novel architecture**: L4 forever; the ladder makes them RARE and
  EXPLICIT, not absent.
- **Merge-time semantic coupling** across disjoint units: `check-disjointness.sh` +
  `dispatch-batch.sh serial_collapse` already own the file-level half; the semantic half
  remains the depth-0 reviewer's carve-out (documented, unchanged).
- **Same-trust adversary**: local tampering outside artifact gates (gitignored paths, caches,
  env) is out of scope — consistent with the recorded containment stance (teardown hygiene,
  not a security attestation).
- **Goodhart on any single gate**: every new gate names its gaming surface (the adjudication
  table's is fake-repro → countered by depth-0 execution + mutation validation; the ledger's
  is under-reporting → countered by structural emission + blind audit; the menu's is
  cargo-cult labels → countered by embedded negative controls, and adequacy is explicitly
  NOT machine-checkable).
- **Catalog staleness/overfit**: growth rule requires counterexample validation;
  `harness-maintenance` owns platform-fact refresh.

## 7. Phases

> **Board directive 2026-07-04**: all remaining-phase triggers WAIVED; P2-P4 plus their
> prerequisites (previously in BACKLOG) execute in one `/l6` run to shippable state
> (v2.31.12). Former BACKLOG entries folded in below are annotated in `docs/BACKLOG.md`.

| Phase | Content | Size | Ship vehicle |
|-------|---------|------|--------------|
| **P1 ✅ (v2.31.11)** | probe-playbook.md + acceptance-patterns.md + adjudication protocol wiring + `adjudicate-findings.js` + tests + ledger convention + this plan | L | shipped `165e1b7` |
| **P2a** | `check-escalation-coverage.js` — release-gate scan: every triggered structural emission point has a ledger event (or an explicit none-fired attestation); calibrate-before-gate posture (warn first) | Fix | v2.31.12 |
| **P2b** | probe-mutation runner — mechanize the manual REFUTED rule: given a probe cmd + a mutation recipe, run probe→inject→probe→restore in an ISOLATED worktree and emit the `refute` evidence JSON for `adjudicate-findings.js`; a probe green-under-mutation is reported vacuous | Fix | v2.31.12 |
| **P2c** | retro ledger-scan step — aggregate `tree.js escalations` across projects into demotion candidates (feeds P4) | S | v2.31.12 |
| **P3-pre (ex-BACKLOG: eval plugin-arm isolation)** | per-arm isolated process + explicit plugin scoping in the eval harness + a `--selftest` that FAILS if the baseline arm loaded any plugin (ponytail contamination lesson) | S–M | v2.31.12 |
| **P3-pre2 (ex-BACKLOG: pre-existing suite failures)** | fix `autopilot-cli.test.sh` (4) / `review-runner.test.sh` (4) / `intent-capture-basic-write.test.sh` (2) so the suite is 93/93 — a noisy suite invalidates the eval's gate signals | Fix | v2.31.12 |
| **P3** | orchestration eval per §5: `evals/orchestration/` task set (fixed distribution, frozen bases) + runner (mid-tier orchestrator, assets ON vs OFF with context-length control) + gate-based scoring + per-mechanism adherence report; SHIPPABLE = harness + a PILOT run (≥2 tasks, cheap engines) proving the measurement pipeline; the full statistical campaign is an operator decision (cost) | L | v2.31.12 |
| **P4** | demotion-loop drafting: `distill` gains a ledger-scan step that drafts playbook/pattern CANDIDATE stubs from recurring escalations (human-gated merge, per distill's own Step 5 convention) | Fix | v2.31.12 |
| (related, ex-BACKLOG, absorbed into P3 design) | deliberately-minimal baseline arm — the eval's OFF arm doubles as it (neutral-padding control) | — | folded into P3 |

## 8. Non-goals

- Not a new orchestration runtime — everything rides existing rails.
- Not model-name routing (routing-axis evidence bar stands).
- Not a promise that a 7B model ships releases — target is mid-tier (sonnet/flash-class)
  orchestrators reaching frontier-floor quality on THIS repo's lifecycle.

## 9. Critique adjudication record (R0 → R1) — dogfooding §4.3 on the critiques themselves

Panel: codex gpt-5.5 (explore; read-probe FAILED so file citations were spot-checked before
trust — 2/2 checked citations real), agy/Gemini (explore, probe ok), MiniMax-M3 (author;
harvested from a late-flush raw_log — the settle-wait bound is insufficient for cc-shim,
BACKLOG'd).

| Claim | Status | Disposition |
|---|---|---|
| Ledger trend-down KPI is a Goodhart trap (3/3 families) | REPRODUCED (by argument + this repo's own test-integrity history) | KPI dropped; replaced (§1, §4.5) |
| Weak models refute real findings with vacuous probes (agy A, codex, M3 e) | REPRODUCED (this repo: M3's own 4 misread findings would have been "fixes") | mutation-validated REFUTED bar (§4.3) |
| Mid-tier unanimity = correlated bias (agy B, codex, M3) | REPRODUCED (by design argument) | family-disjointness precondition on rule 1 (§4.4) |
| Playbook wrong-match (agy C, codex, M3 e/g) | REPRODUCED | discriminating-check entry schema + no-match⇒escalate (§4.1) |
| Non-runnable evidence class exists (codex) | REPRODUCED | PROOF_BY_TRACE status (§4.3) |
| Presence-lint for patterns is toothless (codex, M3) | REPRODUCED | linter dropped; embedded negative controls (§4.2) |
| Meta-judgment paradox (M3 h) | REPRODUCED | design-time level assignment made explicit (§1, §3) |
| Catalog cold-start (M3 d) | REPRODUCED | no-match⇒mandatory-escalation; free-escalation framing (§4.1) |
| "Escalation ledger duplicates tree.js events" (agy, codex) | REFUTED-as-objection (plan already reuses tree events; it's a convention, not new machinery) — but the KPI half of the objection was REPRODUCED | §4.5 reworded to make reuse explicit |
| "Adjudication duplicates qc-panel.js Q4" (agy) | PARTIALLY REPRODUCED | §4.3 reuses the Q4 refutation shape |
| "Merge-time coordination uncovered" (M3 f) | REFUTED (check-disjointness + serial_collapse exist; M3 could not read the repo) | noted in §6 as covered-at-file-level |
| "acceptance/probe catalogs absent from checkout" (codex) | REPRODUCED (they are Phase-1 deliverables, not yet written) | correct observation, no change |
| Calibration invalidators (codex ×8, agy ×3, M3) | REPRODUCED | §5 rewritten |
