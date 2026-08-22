# Official qualification defaults — adopt someone else's administration, or run your own

> Companion to [`strike-decay.md`](strike-decay.md) and [`model-routing.md`](model-routing.md).
> Those say what may grant authority and what may take it away. This one says what happens when
> the evidence was produced **somewhere else**.

**The rule, in one line: an official administration is evidence a consumer MAY adopt; it is never
evidence a consumer MUST trust — and the only verification path is re-derivation, which means
self-qualifying.**

## The situation

Autopilot administers qualification exams against a roster of engines. Those administrations are
real: real dispatches, real money, real graded artifacts, honest FAILED rows included. But they
land in the maintainer's user-local store (`~/.autopilot/engine-scorecard/scorecard.jsonl`), which
never ships.

So a consuming repo enabling a heterogeneous role had two options, and both were bad: re-run the
whole roster (hours, money) or route unqualified. This artifact adds a third — **adopt** — and
makes the tradeoff visible instead of implicit.

## What ships

| File | What it is |
|------|-----------|
| [`official-qualification-defaults.json`](official-qualification-defaults.json) | The artifact. Versioned, schema-validated, **derived — never hand-edit it.** |
| [`official-qualification-defaults.recipe.json`](official-qualification-defaults.recipe.json) | The *selection*: which official event ids are in scope per role, each one's evidence-bundle path, and the recorded rationale for every exclusion. |
| [`../schemas/official-qualification-defaults.schema.json`](../schemas/official-qualification-defaults.schema.json) | The mechanical shape gate — in particular it makes the disclosure block non-droppable. |
| [`../scripts/build-qualification-defaults.js`](../scripts/build-qualification-defaults.js) | Derives the artifact from a scorecard store + capability store + recipe. `--check` re-derives and byte-compares. |
| [`../scripts/adopt-qualification-defaults.js`](../scripts/adopt-qualification-defaults.js) | The consumer side: `list` (with disclosure) and `adopt` (copy into the local stores). |

## ADR-0001: this is DISCLOSURE, not attestation

The originating BACKLOG row said the scorecards would ship「簽署」— signed. They are not, and they
must not be. [ADR-0001](../docs/adr/0001-verification-over-attestation.md) and CLAUDE.md's Don't
list forbid trust machinery outright: no hash chains, no signatures-as-attestation, no witness
receipts, no trust roots.

So「簽署」is implemented as **disclosure**:

- every default carries its full administration environment (engine, model, model_version,
  version_source, runner, runner_version, family, harness_version, corpus_version,
  prompt_config_hash, effort, date, qualified_at, expires),
- every default carries **evidence pointers** — the official event id, the capability-evidence
  anchor, and the on-disk evidence bundle path under `docs/plans/evidence/`,
- `list` prints the disclosure block *with* the verdict, always. There is deliberately no view that
  shows you `QUALIFIED` without showing you the environment it was measured in.

Two `sha256` values appear in this system (`store_projection_sha256` on the artifact,
`defaults_artifact_sha256` in an adopted row's provenance). Neither is tamper-evidence and neither
gates anything. They exist so an adoption can be **replayed** — re-run the generator over the same
store and the digest comes back — which is the identical justification `strike-decay.md` gives a
strike's `artifact_sha256`. If you ever find yourself checking one of them to decide whether to
*trust* a row, you have re-invented the thing ADR-0001 forbids.

**The consumer's real verification path is re-derivation: run the administration yourself.**

## Official environment ≠ your environment

This is the whole reason the disclosure block is mandatory rather than nice-to-have. A default's
verdict was measured against:

- a specific runner CLI build (`runner_version` — e.g. `2.1.239-Claude-Code`, `grok-1.0.5-…`),
- a specific dispatch harness commit (`harness_version` — e.g. `dispatch-hetero:003d7975`),
- a specific exam corpus (`corpus_version`) and prompt configuration (`prompt_config_hash`),
- a specific reasoning effort (`effort`),
- on a specific date.

Any one of those differing in your environment can invalidate the transfer, and none of them is
something the artifact can check for you. Read them. If your runner is three minor versions ahead,
that is a reason to self-qualify, not a reason to shrug.

## FAILED rows ship too

The artifact packages what the store holds for the in-scope administrations — QUALIFIED and FAILED
alike. A FAILED administration is **routing information**: it is the difference between "we have
not tried this seat" and "we tried this seat and it disclosed a security canary". Filtering the
failures out would turn an honest record into a marketing page, and would let a known-bad seat be
retried by accident.

The recipe's `excluded[]` array records, with a reason, every store row deliberately left out
(legacy pre-schema rows, superseded corpora, and the brain-seat sittings, which are not scorecard
rows at all). Exclusions are a documented editorial decision, not a silent one.

## Adoption is a copy, not an import of authority

`adopt` writes the row into the consuming repo's stores **through `engine-scorecard.js record`** —
never by appending to the JSONL directly. That matters: `record` owns the write lock, the event_id
assignment, and the full row validation including the capability-evidence identity binding. A raw
append could put a row into the store that `record` would have refused.

Two things are renumbered on arrival, and only two:

1. the scorecard row's `event_id` (assigned by the destination store, as for any recorded row), and
2. the **qualifier-store anchor**. An `internal_eval` row's `evidence_store` triple must resolve to
   a matching wrapper in the destination *capability* store (`verifyEvidenceStoreAnchor`), so the
   wrapper travels with the row and gets a free local `event_id`; the scorecard row's
   `evidence_store.event_id` is renumbered to match in the same step. Everything else — including
   `producer` and `transcript_hash` — rides verbatim.

The adopted row then gains one extra object, `provenance`:

```json
"provenance": {
  "kind": "official-default",
  "official_event_id": 143,
  "default_id": "official:implementer:grok-4.5:grok:143",
  "defaults_artifact_sha256": "…",
  "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/grok-qualify",
  "adopted_at": "…",
  "self_qualify_command": "…"
}
```

`provenance` is **disclosure only**. No admission path reads it. `dispatch-contract.js` still gates
on `admission_status`, exactly as before, and an adopted row is admissible or not for exactly the
same reasons a self-qualified one would be.

> The marker deliberately does **not** live in `version_source`. That is a closed enum
> (`runtime | manual | operator-asserted`) and `record` rejects anything else — writing
> `official-default` into it would have made every adopted row unrecordable.

## Self-qualification always overrides

Adoption **refuses** a seat when the destination store already holds a row for the same
`{engine, runner, role}` whose `qualified_at` is equal to or newer than the default's. A local
administration beats an imported one on the same seat identity; silently shadowing local evidence
with someone else's would invert the entire evidence hierarchy (`engine-onboarding` Stage 3: a
live, locally-observed run is the strongest tier, a stored row the weakest).

`--force` exists for the case where you know the local row is stale, and it prints exactly what it
overrode.

## Strike interplay — an adopted default is not privileged

An adopted row is an **ordinary seat-scoped strike target**. Nothing about it is protected:

- Its seat identity is `seat_hash = sha256(canonicalJson({engine, runner, role}))` — the same
  derivation as any self-qualified row, from fields copied verbatim. Strikes written by
  `dispatch_hetero_failclosed` and the other allowlisted writers accrue against it unchanged.
- The fold is unchanged: N=3 ordinary strikes since the last passing administration ⇒
  `requalify_required` (under `AUTOPILOT_STRIKE_ENFORCEMENT=enforce`; shadow by default).
  `critical_reexam_trigger` still fires immediately.
- `expires` is advisory here too. No admission path compares `now` against it
  ([`strike-decay.md`](strike-decay.md) § "The calendar is advisory, everywhere").

The one addition is advisory, and it exists because the remedy for an adopted seat differs from the
remedy for a self-qualified one: when a `requalify_required` seat's baseline row carries
`provenance.kind === "official-default"`, the `seat-status` and `current` projections add a
`remedy` string. It says, in substance: *re-adopting the same default cannot clear this — it is the
same administration. Re-baseline with a fresh LOCAL administration.* That is not a new rule, it is
strike-decay's own epoch semantics spelled out for the case where the baseline was imported: only a
**passing fresh administration** re-baselines, and re-copying a row that already exists in your
store is not an administration at all.

`remedy` gates nothing and no consumer branches on it.

## Regeneration

The roster gets re-administered. When it does:

```bash
node scripts/build-qualification-defaults.js build          # re-derive from the real stores
node scripts/build-qualification-defaults.js --check        # must exit 0 on the committed file
node scripts/validate-json-schema.js \
  --schema schemas/official-qualification-defaults.schema.json \
  --document references/official-qualification-defaults.json
```

> **Known limitation, stated rather than papered over.** `validate-json-schema.js` preflights its
> *document* and rejects every non-integer numeric literal (`UNSUPPORTED_JSON_NUMBER`) before any
> schema keyword is evaluated. This artifact carries verbatim `capability_score` fractions (e.g.
> `0.9166666666666666` = 11/12), which are the **only** non-integer numbers anywhere in it —
> asserted mechanically in `hooks/tests/qualification-defaults.test.sh`. So `build` validates a copy
> with those normalized to `0`. The schema places **no constraint at all** on `capability_score`
> (`schemas/official-qualification-defaults.schema.json` gives it an empty subschema, because it is
> verbatim scorecard data), so there is no verdict the schema could reach on that field either way,
> and nothing in the disclosure block — the contract the schema exists to enforce — is touched. The validator's integer-only restriction is filed as a BACKLOG row.
> Running the validator directly against the committed artifact exits 2, and that is expected.

`--check` is the anti-rot gate, and it is the reason the artifact carries no timestamp: a wall-clock
field would make byte-identical regeneration impossible and would be a claim about the generator
run rather than about the administration. Administration dates live per-entry, where they belong.

Administering a *new* sweep is a separate tool: [`../scripts/qualification-sweep.sh`](../scripts/qualification-sweep.sh)
(`--plan` is deterministic and free; `--execute` spends real dispatches).

## What this does NOT do

- It does not make a default trustworthy. It makes it **legible**.
- It does not create routing authority that survives your own evidence. Local wins.
- It does not protect a seat from downgrade. Strikes apply identically.
- It does not ship brain-seat sittings — those are `owner-brain-seat-v1` records in the capability
  store with their own semantics (forced brain-seat scope, no expiry, 3-strike revocation), not
  scorecard rows. Deferred to a BACKLOG row rather than forced into this shape.
