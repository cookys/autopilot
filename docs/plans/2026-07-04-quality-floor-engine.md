# Quality-Floor Engine — the judgment-demotion ladder

**狀態**: Draft R0 (pre-panel)
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

The core design move is the **judgment-demotion ladder**. Every point in the lifecycle where
the orchestrator currently exercises judgment gets classified and pushed DOWN the ladder:

| Level | Mechanism | Weak-model demand | Exists today? |
|-------|-----------|-------------------|---------------|
| **L0 — Script** | deterministic tool; no model in the loop | none | autopilot's DNA (69 scripts) |
| **L1 — Playbook match** | model SELECTS from a curated catalog instead of inventing | pattern matching (weak models are good at this) | **NEW** — probe playbook, acceptance-pattern menu |
| **L2 — Fan-out + mechanical aggregation** | N independent perspectives; aggregation is a RULE, not a synthesis | prompt-following | partial (qc panel `union-on-verified-critical`); **EXTEND** to design + debug |
| **L3 — Probe-then-branch** | before any judgment call, run a cheap empirical discriminator; branch on its OBSERVED result | running commands + reading output | partial (Spike-before-assert as prose); **MECHANIZE** as artifact contracts |
| **L4 — Escalate + ledger** | residual judgment goes to the strongest available engine (or the human); every escalation is LOGGED and becomes a demotion candidate | knowing when to stop (enforced by gates, not judgment) | **NEW** — escalation ledger + demotion loop |

The system **converges**: the L4 ledger is the measurement of "how much strong-model do we
still need", and every ledger entry feeds `distill`/`learn` → a new L0-L3 asset → the next
run needs the strong model less. This is "clone cookys" applied recursively to the thing
that replaced cookys.

## 2. Evidence base — where the strong model was actually load-bearing

Ground truth from the v2.31.10 run (and repo history), classified by what the weak model
would have done wrong and which ladder level absorbs it:

| Moment (real, this repo) | Weak-model failure mode | Demotion |
|---|---|---|
| MiniMax panel returned 4 plausible findings; ALL disproven by reading code (subshell-export, HOOKS_DIR, agy-gating, settle-latency) | acts on false findings → "fixes" non-bugs, churns correct code (cf. the recorded `codex unreachable-after-return misread` incident) | **L3**: finding-adjudication protocol — no fix dispatch without a REPRODUCED finding (§4.3) |
| codex review rail broken only with the REAL engine (stubs green): stdout/stderr channel split | ships on green stubs; or flails editing the parser | **L1**: probe playbook entry "works-with-stub-fails-live → split-capture channels and diff them" (§4.1) + **L0**: live-e2e gate requirement in release protocol |
| Heredoc extraction needed a byte-identical fidelity check; tail-window needed a perturbation probe | invents weak acceptance criteria ("tests pass") | **L1**: acceptance-pattern menu — planner ATTACHES patterns (parity / perturbation / idempotency / fidelity / negative-self-check) instead of inventing (§4.2) |
| 3-family design panel: synthesis was NOT majority vote (opt-in overlay decision) | majority-votes or defers to the most verbose panelist | **L2**: structured decision matrix + mechanical tie-break rules; disagreement → spike, not judgment (§4.4) |
| codex-spark quota died mid-run; grok went silent on large prompts | run dies, or model silently degrades to a broken engine | **L0**: already solved — capability-state + failover; keep | 
| "Is this pre-existing or introduced?" (4 suite failures) | assumes introduced → burns effort; or assumes pre-existing → ships regressions | **L0**: already solved — `verify-preexisting.sh` / develop-worktree baseline; make it a REQUIRED step in the release protocol |
| Knowing the plan is wrong vs pushing through (REVERT scope call, v2.31.3) | sunk-cost pushes through | **L3**: re-think triggers on mechanical counters (`risk-counter.js` exists; wire thresholds to a mandatory plan-revision checkpoint) + **L4** escalation |
| Deciding l3-l6 form (product-shape taste) | bikesheds or breaks routing | **L4**: escalate — this is genuinely not demotable (§6) |

## 3. The five stage contracts (typed artifacts, fail-closed validators)

Weak models freestyle badly but **fill forms well**, and scripts can reject malformed forms.
Every lifecycle stage emits a typed artifact; a validator gates progression. Most validators
already exist — the change is making the CONTRACT the interface between stages, so a weak
orchestrator's job at each boundary is "produce/validate an artifact", never "assess quality".

| Stage | Artifact (typed) | Validator | Status |
|-------|------------------|-----------|--------|
| Plan | six-element unit prompts + **acceptance patterns from the menu** + disjoint scopes | `check-dispatch-suppression.sh`, `check-disjointness.sh propose`, **NEW: acceptance-pattern presence lint** | mostly exists |
| Implement | commit on branch + integrity gates | git artifacts, `check-test-integrity.sh`, `check-disjointness.sh validate` | exists |
| Review | nonce-wrapped verdict + findings | `dispatch-review.sh` parser + **NEW: adjudication table (per-finding repro status)** | parser exists; adjudication NEW |
| Debug | **repro artifact + probe log + root-cause with discriminating evidence** | **NEW: repro-before-fix gate** — fix dispatch refuses without a repro pointer | NEW (debugger.md prose → contract) |
| Verify | independent harness/plan + executed-check evidence pointers | `check-node-report.js` (pointer validation) — reuse as-is | exists |

## 4. New assets (Phase 1 — what ships first)

### 4.1 `references/probe-playbook.md` — diagnostic probe catalog (L1)
A catalog of **cheap discriminating probes indexed by symptom**, seeded from real incidents
(each entry cites its incident). Weak models match symptoms to entries reliably; they cannot
invent the codex-channel-split probe, but they CAN run it when the playbook names it.
Seed entries (all from real history): works-with-stub-fails-live → split stdout/stderr and
diff channels; behaves-differently-under-engine-vs-shell → log `command -v` + `--version`
from INSIDE the spawned context; intermittent-empty-output → re-read the artifact after a
delay (late-flush) + distinguish from truly-empty; parser-rejects-valid-looking-output →
dump the exact parse INPUT (not the source stream); config-not-applying → print the resolved
config + its source layer; test-passes-for-wrong-reason → perturbation probe (break the
thing, the test must fail); env-var-not-reaching-child → `env`-dump inside the child.
Wired into: `skills/debug`, `agents/debugger.md`, dispatch re-work prompt templates.
**Growth rule**: every L4 escalation that was resolved by a novel probe MUST add an entry
(learn/distill hook).

### 4.2 `references/acceptance-patterns.md` — mechanical acceptance menu (L1)
The planner stops inventing acceptance criteria; it ATTACHES patterns from a menu, each with
a runnable template: **round-trip parity** (producer→consumer, both drift directions, named
keys); **perturbation** (mutate one seeded invariant → gate MUST fail → restore); **fidelity**
(byte-identical extraction/move, reconstruct-and-diff); **idempotency** (run twice, tree
byte-stable); **negative self-check** (the test proves it can fail: inject the defect class it
guards); **live-e2e** (one real-engine call on the changed rail — stubs never sufficient for
rail changes); **baseline classification** (pre-existing vs introduced via base worktree).
Wired into: `skills/dev-flow` L-1 planning, `agents/planner.md`, six-element prompt template
(acceptance section instructs "pick from the menu; justify any custom criterion").
**Lint**: unit prompts whose acceptance section names no menu pattern and no justification
get flagged (extend `check-dispatch-suppression.sh`'s sibling as a new small linter — or a
new `check-acceptance-patterns.sh`; decision at implementation).

### 4.3 Finding-adjudication protocol (L3) — "no fix without a repro"
Extends the review loop: reviewer findings land in an **adjudication table**
(`finding / claim / repro command / status: REPRODUCED | REFUTED | UNPROBED`). Rules:
- Only REPRODUCED findings may be dispatched for fixing.
- UNPROBED findings must first get a probe (playbook match, or a dispatched "write a runnable
  probe for this claim" unit to a DIFFERENT family than the finder).
- REFUTED findings are recorded with their disproof (this is what killed the M3 misreads and
  the historical `unreachable-after-return` churn).
- Aggregation stays `union-on-verified-critical` — "verified" now has a mechanical meaning.
Wired into: `agents/reviewer.md` (verifier isolation section), `skills/quality-pipeline`
references, `/l5`/`/l6` loop docs. Optional Phase-2 script: `adjudicate-findings.js` tracking
the table as JSON (schema like review-result).

### 4.4 Design-panel decision matrix (L2)
For design questions (the v2.31.8/2.31.10 panel pattern), replace free-form synthesis with:
each panelist answers the SAME options × criteria matrix (recommendation + rationale + size +
release-or-defer per question — already the de-facto format); depth-0 aggregation follows
mechanical rules IN ORDER: (1) unanimous → adopt; (2) split on reversible → adopt the
cheapest, record trigger to revisit; (3) split on irreversible → spike/probe the disagreement
if probeable, else **L4 escalate**; (4) any panelist claim of fact → adjudication table
(§4.3), never trusted on citation alone. Wired into: a reference under
`skills/ceo-agent/references/` + think-tank cross-link.

### 4.5 Escalation ledger (L4) — the convergence measurement
Every depth-0 decision that was NOT covered by L0-L3 gets one JSONL line:
`{ts, run, stage, decision, why_not_mechanical, resolution}`. Implementation: reuse the
task-tree event log (`tree.js emit` — it exists, is append-only, and archives with the
project) rather than a new store; a tiny query (`escalations` subcommand exists) reports the
ledger per run. `retro`/`distill` gain a step: scan escalation ledgers → each recurring entry
is a demotion candidate (new playbook entry / pattern / script). **This is the KPI**: ledger
entries per release should trend down; a release with zero ledger entries is fully
weak-model-drivable in principle.

## 5. Calibration — how we know it works (not vibes)

- **Orchestration eval** (Phase 2): a scripted task with a known-good outcome (e.g. re-run a
  historical Fix-size ship against a frozen base) driven by a mid-tier orchestrator
  (claude-sonnet-class / gemini-flash-class) with the Phase-1 assets ON vs OFF. Measured by
  gates: convergence reached, escapes caught by which layer, escalation-ledger count,
  false-fix count (fixes applied to REFUTED findings). Prereq: the eval plugin-arm isolation
  BACKLOG entry (baseline contamination) fires here — implement it first.
- **Escape-rate store** (`qc-metric-emit.js` + llm-playground calculator) already measures
  reviewer classes; extend the same discipline to orchestrator classes.
- **Honesty bar**: arena-style preference scores are explicitly NOT evidence (recorded
  routing-axis lesson); only oracle-graded gate outcomes count.

## 6. Honest limits — what does NOT demote

- **Taste / product shape** (l3-l6 form, naming, what to build): L4 forever. The system's job
  is making these RARE and EXPLICIT, not pretending they're gone.
- **Novel architecture under ambiguity**: panels help, but a genuinely new design still
  benefits from the strongest available model; the ladder REDUCES the frequency it's needed
  (most units become playbook-shaped), it does not eliminate it.
- **Goodhart risk**: mechanical gates get gamed (the whole `check-test-integrity` program
  exists because of this). Every new gate here must state its gaming surface; the adjudication
  table itself is gameable by fake repro commands → repro commands are EXECUTED by depth-0
  (artifact-not-self-report applies to probes too).
- **Playbook staleness**: entries cite incidents + platform versions; `harness-maintenance`
  owns refresh triggers.

## 7. Phases

| Phase | Content | Size | Ship vehicle |
|-------|---------|------|--------------|
| **P1 (this ship)** | probe-playbook.md + acceptance-patterns.md + adjudication protocol (prose wiring into reviewer/planner/debugger/quality-pipeline/l5/l6) + escalation-ledger convention on tree.js + this plan | L (docs+wiring, no new runtime code) | v2.31.11 PATCH |
| P2 | `adjudicate-findings.js` (table as validated JSON) + acceptance-pattern linter + ledger query in retro | Fix–L | next |
| P3 | orchestration eval (needs eval-arm isolation first) + weak-orchestrator dogfood run measured by the ledger | L | trigger: P1 assets stable across 2 releases |
| P4 | demotion loop automation: distill scans escalation ledgers → drafts playbook/pattern candidates | Fix | trigger: ≥10 ledger entries accumulated |

## 8. Non-goals

- Not a new orchestration runtime — everything rides existing rails (skills/references/
  scripts/tree.js).
- Not model-name routing (routing-axis evidence bar stands; the ladder is capability-tier +
  decorrelation + cost, unchanged).
- Not a promise that a 7B model ships releases — target is mid-tier (sonnet/flash-class)
  orchestrators reaching frontier-floor quality on THIS repo's lifecycle.
