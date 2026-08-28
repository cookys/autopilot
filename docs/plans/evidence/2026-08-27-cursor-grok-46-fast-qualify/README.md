# cursor-grok-4.6-high-fast — implementer qualification (2026-08-27)

First Stage-1 administration on the `cursor` runner. **Result: qualified, 24/24.**

| | grok-4.6 via `grok` (2026-08-22 official) | cursor-grok-4.6-high-fast via `cursor` (here) |
|---|---|---|
| corpus_pass | 23/24 | **24/24** |
| integrity_violations | **1** | 0 |
| false_pass_critical | **1** | 0 |
| fabricated_changes / contract_violations / oracle_misses | 0 / 0 / 0 | 0 / 0 / 0 |
| capability_score | 0.958 | 1.0 |
| repeated_trials | 2 | 2 |
| status | **failed** | **qualified** |

## What this does and does not show

The grok-rail failure was **not** a capability failure: 23 of 24 cases passed and the
single miss was an integrity violation carrying a `false_pass_critical`. The same model
family at the same effort produced a clean 24/24 through the cursor rail.

**This is one observation, not a controlled experiment.** Three variables differ between
the two rows — runner (`grok` CLI vs `cursor`), harness version (`dispatch-hetero:003d7975`
vs `d052815e`), and the `-fast` lane. So the defensible statement is:

> the same model family at the same effort failed an integrity case on one rail and passed
> all twenty-four on another.

It is **not** evidence that any specific harness property caused it. Attributing the
difference would need the other variables held fixed. What it does support, concretely, is
the `engine-onboarding` premise this repo already asserts on principle: qualification binds
to `engine + runner + role`, not to a model name — and here that premise has an observation
behind it rather than only doctrine.

## Authority

`admission_status: qualified`, `baseline_qualified_at: 2026-08-27`, 90-day expiry,
`strikes_since_pass: 0`. Per `skills/engine-onboarding/SKILL.md` Stage 3, a disk-backed row
is untrusted telemetry: it records the outcome, it does not itself grant routing authority.

## Two probe receipts, deliberately both kept

`probe-receipts.jsonl` is append-only and holds the incident as well as the result:

1. The first attempt recorded `bin: ~/.local/bin/cursor` and
   `bin_version: "Error: No Cursor IDE installation found…"`. `qualification-sweep.sh`
   derived the version binary from the runner token, but cursor's binary is `cursor-agent`;
   plain `cursor` is the IDE launcher. That error sentence was being passed to a paid
   administration as `--runner-version` — a deployment identity nothing could ever match.
   The run was killed after 7 of 24 case dispatches. Fixed in v2.34.44
   (`scripts/lib/runner-binary.js`: one owner for the map, and an unusable version refuses
   the seat uncharged).
2. The second records `bin: ~/.local/bin/cursor-agent`, `bin_version: 2026.08.25-3e8eec8`, `probe_rc: 0`.

This administration is therefore also the first end-to-end exercise of that fix inside a
real paid seat loop.

## Reproduce

    scripts/qualification-sweep.sh --roster <roster.json> --plan     # free
    scripts/qualification-sweep.sh --roster <roster.json> --execute --yes   # 25 paid dispatches

Frozen corpus identity for this administration:
`prompt_config_hash` = sha256(corpus JSON ‖ generator source);
`semantic_fingerprint` = sha256(corpus_version ‖ families ‖ thresholds ‖ canary closure);
`containment_fingerprint` = sha256(dispatch-hetero.sh blob id). Re-derive to verify.
