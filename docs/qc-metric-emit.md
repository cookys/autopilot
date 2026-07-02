# QC-metric emitter (ROADMAP P2.1) — additive review-event write seam

`scripts/qc-metric-emit.js` appends one **QC review event** per reviewed change to the
P2.1 measurement store owned by **llm-playground** (`qc-metrics/events.jsonl`). Those
events feed the escape-rate + endorsement-rate calculator (`qc-metrics/qc_metric.py`) that
GATES promoting a task class up the acceptance-delegation ladder (T0 → T1 → T2).

## Design posture: strictly ADDITIVE

- It **never** gates, blocks, or changes any existing review verdict. `dispatch-review.sh`,
  `qc-panel.js`, and the depth-0 loop are untouched.
- If no store is configured (`$QC_METRIC_STORE` unset and no `--store`), it is a
  **non-breaking no-op**: it exits 0 and writes only a one-line diagnostic notice to
  **stderr** (never stdout), so wiring it into a review flow can never break that flow.
- The authoritative schema + calculator live in llm-playground
  (`qc-metrics/schema.md`, `qc_metric.py`). This emitter carries a thin fail-closed
  mirror of the schema check so a malformed event never lands in the store.

## Store resolution

`--store <path>`  >  `$QC_METRIC_STORE`  >  no-op. Point it at the llm-playground store:

```sh
export QC_METRIC_STORE="$HOME/projects/llm-playground/qc-metrics/events.jsonl"
```

## Call sites (where to emit)

The emitter is a leaf helper; the panel + publish review are orchestrated at **depth 0**,
so the call is made by the orchestrator after a verdict is rendered. Two sites:

### 1. depth-0 QC panel (`scripts/qc-panel.js` orchestration)

After the panel renders its `union-on-verified-critical` verdict for a node, emit one
event with `verdict_stage=depth0_panel`, the panel's lenses, and every finding the panel
raised (with `verified` set once findings are triaged real/false_positive/unverified):

```sh
scripts/qc-metric-emit.js \
  --change-id "$NODE_ID" --repo "$REPO" \
  --base-sha "$BASE" --head-sha "$HEAD" \
  --verdict pass --stage depth0_panel \
  --lenses "rust-correctness,data-integrity,concurrency" \
  --findings '[{"id":"self-reference-feedback-loop","severity":"critical","lens":"rust-correctness","verified":"real","caught_at_stage":"depth0_panel"}]'
```

### 2. publish hetero-review (`scripts/dispatch-review.sh` site)

When the pre-publish heterogeneous loop catches a defect the depth-0 panel PASSED, that is
an **escape** (escape ⇔ the panel verdict was `pass` AND the defect is caught later than
the verdict stage — a `fail` verdict is never an escape). Emit an event for the same
`change_id` with the escaped finding at `caught_at_stage=publish_hetero_review`. The store
is append-only and the calculator collapses it **by union per `change_id`** (union of
findings by id; verdict from the depth-0 record), so a change is counted exactly once, the
escape survives any later clean re-emit in any order, and you MAY emit just the new finding
(partial delta) — re-emitting the full event is also fine. **Keep `--stage depth0_panel`**
(the panel gate) — do NOT set `--stage publish_hetero_review`. `verdict_stage` is the stage
the *delegated verdict* was rendered (a stable change property, default `depth0_panel`), not
the stage you are emitting from; the finding's `caught_at_stage` is what marks it as an
escape. If `--stage` is omitted it defaults to `depth0_panel`, so a lone partial delta still
measures against the right gate:

```sh
scripts/qc-metric-emit.js \
  --change-id "$CHANGE_ID" --repo "$REPO" --base-sha "$BASE" --head-sha "$HEAD" \
  --verdict pass --stage depth0_panel \
  --lenses "data-integrity,concurrency" \
  --findings '[{"id":"mtime-misses-cites","severity":"medium","lens":"data-integrity","verified":"real","caught_at_stage":"publish_hetero_review"}]' \
  --escapes '[{"defect":"mtime-misses-cites","found_at_stage":"publish_hetero_review"}]'
```

> Post-merge finds and cookys's sampled audit use `caught_at_stage` = `post_merge` /
> `cookys_audit` (still with `verdict_stage=depth0_panel`). `autonomous=true` +
> `endorsed=true|false|null` feed the endorsement rate for changes shipped without per-item
> review (T2).

## Full-event form

For programmatic callers, pass a whole object instead of flags:

```sh
scripts/qc-metric-emit.js --store "$QC_METRIC_STORE" --event "$EVENT_JSON"
```

## Reading the numbers

The report lives on the measurement side:

```sh
python ~/projects/llm-playground/qc-metrics/qc_metric.py report
```

## Tests

```sh
node --test scripts/qc-metric-emit.test.js
```
