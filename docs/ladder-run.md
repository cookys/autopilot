# ladder-run — acceptance-delegation ladder harness (ROADMAP P2.2)

`scripts/ladder-run.sh` runs **one cycle** of the acceptance-delegation ladder (ROADMAP §0):
the mechanism by which cookys is progressively removed from the acceptance loop. It is the
first real, *measured* T0→T1 instrument on top of the P2.1 escape-rate store.

## The ladder (recap)

A task **class** climbs tiers as its measured QC escape rate stays low:

```
T0  cookys verifies every item            (a new class starts here)
T1  agent verifies, cookys SAMPLES X%     (X = t1_sample_rate, default 30%)
T2  agent verifies, cookys audits log only (the "偕同參與" steady state)
promote: measured escape_rate < escape_rate_max over ≥ min_samples cycles
         (T1→T2 additionally needs endorsement_rate > endorsement_rate_min)
demote:  any real escape → class drops a tier
```

The class tiers + thresholds are **state**, owned by the consuming program repo
(fuchikoma: `docs/ladder/state.json`). This harness reads/writes that state file; it does
not hold policy itself.

## What one cycle does

| Step | Action | Tool |
|------|--------|------|
| 1. IMPL | obtain the change artifact — either already produced (`--diff-file`) or dispatch a worktree-isolated implementer (`--impl-prompt-file` → `dispatch-hetero.sh`, l5-style) | `dispatch-hetero.sh` |
| 2. VERIFY | a **decorrelated, isolated** agent renders the acceptance verdict from the **diff text only** | `dispatch-review.sh` |
| 3. EMIT | append a QC-metric event (verdict + findings + caught-stage) to the P2.1 store | `qc-metric-emit.js` |
| 4. SAMPLE | deterministically flag whether cookys should sample-review this item (30%) | (built-in) |
| 5. REPORT | recompute the **class's** running escape/endorsement rate and report the promotion recommendation | `qc_metric.py` (unmodified) |

### Verifier isolation is structural (not optional)

Step 2 calls `dispatch-review.sh`, which assembles the reviewer prompt from the **diff text
only** — it has no parameter through which the implementer's self-report could reach the
verifier. A verifier fed the worker's own account of the work anchors to it and converges to
confidently-wrong (the hallucination cascade). This harness NEVER passes a self-report,
summary, or the implementer's own verdict into the verify step. Canonical rule:
`references/blind-dispatch.md` § "Verifier isolation".

### Acceptance is agent-held; cookys is a sampled co-participant

The change ships on the **agent's** verdict — cookys is a sampled co-participant, **not a
per-item gate** (cookys's explicit direction). So emitted events carry `autonomous=true`
with `endorsed=null` (pending). The sampling flag picks which fraction cookys eyeballs; when
cookys later endorses a sampled/audited item, a follow-up event sets `endorsed=true|false`
(feeding the T1→T2 endorsement rate).

### On-gate catch vs escape — and the `audit` subcommand (the escape path)

A finding the verifier raises at step 2 is caught at `caught_at_stage=depth0_panel` (the
agent-held verdict *is* the delegated gate) — a **catch, not an escape**. A clean in-cycle
pass therefore emits **no** findings and, by construction, is **never** an escape.

**Escapes are recorded later, via `ladder-run.sh audit`.** When a defect that the in-cycle
verdict *passed* is caught by a stronger/later review (depth-0 panel, publish hetero-review,
or cookys audit), record it against the same `change_id` with a **later** `caught_at_stage`:

```sh
scripts/ladder-run.sh audit \
  --task-class doc-sync --change-id <same-id> --repo <r> --base-sha B --head-sha H \
  --state-file .../state.json \
  --finding-id incomplete-fix --severity medium --lens version-sync \
  --caught-at-stage cookys_audit --endorsed false
```

`qc_metric.py`'s union-merge collapses the two records for the `change_id` (verdict from the
earliest depth0 pass; findings unioned), so the later-caught real defect is counted as a
**class escape** — which is how a class is honestly kept off T1 until its escape rate is
genuinely low. Without this path the in-cycle verifier is blind to its own escapes and the
promotion gate is vacuous.

### The in-cycle verifier is a WEAK oracle (esp. diff-only for doc-sync)

The in-cycle verify is **discovery, not the stopping condition**. It reads the **diff only**
(verifier isolation), so it cannot fact-check the new value against the repo nor catch a
sibling stale claim outside the hunk. Escape rate only becomes meaningful once later/stronger
review records its finds via `audit`. **For doc-sync specifically, pair each cycle with the
deterministic version-sync / whole-file `doc-drift` Layer-1 gate** as the real oracle. (The
P2.2 first cycle demonstrated this the hard way: a diff-only pass let an incomplete PORTFOLIO
fix escape to cookys audit — recorded, class held at T0.)

### Sampling is not evadable (H1)

The 30% cookys-sample flag is keyed on the **`head_sha`** (the artifact) plus an optional
secret salt `$LADDER_SAMPLE_SALT` — **not** on `change_id`. So an implementer cannot rename
the `change_id` to dodge a sample, identical diffs sample identically, and with a salt set the
outcome is unpredictable to the implementer.

### Fail-closed (H2)

- **Verifier no-verdict** (empty/unparseable capture, precondition failure) → the cycle is
  recorded `needs_human=true`, `panel_verdict=fail`, exit `3`. An empty verifier reply is
  **never** read as a pass.
- **Calculator failure** — if `qc_metric.py` cannot compute the class metrics, the run does
  **not** fall through to a clean `PROMOTE`: it records `promotion=HOLD-ERROR`,
  `needs_human=true`, and exits `3`. A promotion is never granted on an uncomputable escape
  rate.
- **No store/state divergence** — the QC event is emitted first, then every step after emit is
  non-fatal so the state file is **always** written to reflect the emitted cycle. The store and
  the ladder state never disagree about whether a cycle happened.
- A `fail`/`needs_human` verdict ships nothing, so it is recorded **not** autonomous — a
  rejected change never dilutes the endorsement denominator.

## Usage

```sh
export QC_METRIC_STORE="$HOME/projects/llm-playground/qc-metrics/events.jsonl"

# artifact already produced by the work unit (e.g. a committed doc-sync fix):
scripts/ladder-run.sh \
  --task-class doc-sync \
  --change-id fuchikoma-portfolio-autopilot-version-2026-07-02 \
  --repo fuchikoma \
  --base-sha "$BASE" --head-sha "$HEAD" \
  --diff-file /tmp/change.diff \
  --state-file "$HOME/projects/fuchikoma/docs/ladder/state.json" \
  --reviewer-runner codex --reviewer-model gpt-5.5 \
  --lenses "doc-accuracy,version-sync"

# or dispatch the implementer first (l5-style leaf dispatch):
scripts/ladder-run.sh --task-class doc-sync --change-id ... --repo ... \
  --base-sha "$BASE" --head-sha "$BASE" \
  --impl-prompt-file task.md --branch feat/x --impl-runner codex \
  --state-file .../state.json
```

`--mock-verdict SHIP-AS-IS|FIX-THEN-SHIP` is a **test/replay seam only** — it bypasses the
live verifier and MUST NOT be used to produce a real datapoint. `--dry-run` runs steps 1–2
and prints what would be emitted without writing the store or state.

## Posture

- **Additive.** Drives `dispatch-hetero.sh`, `dispatch-review.sh`, `qc-metric-emit.js`, and
  `qc_metric.py` unchanged; alters no existing skill's behavior.
- **Does not auto-promote.** It records a promotion *recommendation* in the state file;
  flipping a class's tier stays a cookys/audit decision.
- **Not a scheduler.** One cycle per invocation. Unattended/nightly runs are a later phase.

## Tests

```sh
bash scripts/ladder-run.test.sh    # sampling determinism + emit/report wiring + state persist (mock verifier)
```
