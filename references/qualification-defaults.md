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

**There are no digest fields at all.** An earlier cut carried two (`store_projection_sha256` on the
artifact, `defaults_artifact_sha256` in an adopted row's provenance), justified as "re-derivation
aids". A depth-0 panel killed both: nothing ever read them, and `build-qualification-defaults.js
--check` already re-derives the artifact and byte-compares the *whole file*, which is strictly
stronger than any digest they could have carried. A hash that is written and never read is
indistinguishable from trust machinery to the next reader — it invites exactly the "is this row
authentic?" question ADR-0001 exists to refuse. Re-derivation is the check; the digest was theatre.

**The consumer's real verification path is re-derivation: run the administration yourself.**

## Official environment ≠ your environment

This is the whole reason the disclosure block is mandatory rather than nice-to-have. A default's
verdict was measured against:

- a specific runner CLI build (`runner_version` — e.g. `2.1.239-Claude-Code`, `grok-1.0.5-…`),
- a specific dispatch harness commit (`harness_version` — e.g. `dispatch-hetero:003d7975`),
- a specific exam corpus (`corpus_version`) and prompt configuration (`prompt_config_hash`),
- a specific reasoning effort (`effort`),
- on a specific date.

Those divide into two kinds, and the distinction decides what the machinery does with them
(Board 2026-09-02: "the exam tests the model, it should not be pinned to the autopilot version"):

- **Exam identity** — `corpus_version`, `prompt_config_hash`, `effort`, plus engine/runner/role and
  the model's own version and fingerprints. These are what the administration measured. A mismatch
  makes the evidence **inapplicable**; the machinery enforces it.
- **Environment** — `runner_version` and `harness_version`. These describe where the exam happened
  to run. A mismatch is **recorded and warned about (`environment_warning`), never gating.**

That second line changed in v2.35.9, and it was a real defect being fixed rather than a relaxation:
every shipped default carries `harness_version: dispatch-hetero:003d7975`, so under the old rule a
consumer on any later plugin build matched none of them — silently, with no error, because the row
simply never applied.

None of this is something the artifact can check for you, and a warning is not an all-clear. If
your runner is three minor versions ahead, that is still a reason to consider self-qualifying — the
machinery now tells you rather than deciding for you.

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
  "administration_version_source": "runtime",
  "official_event_id": 143,
  "default_id": "official:implementer:grok-4.5:grok:143",
  "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/grok-qualify",
  "adopted_at": "…",
  "self_qualify_command": "…"
}
```

The adopted row's own `version_source` is set to `official-default` — it names **how this row got
into this store**, which was by adoption, not by a local administration. The original
administration's value is preserved as `provenance.administration_version_source`, so nothing is
lost. `engine-scorecard.js` accepts the value; no admission path branches on it.

`provenance` is **disclosure only**. No admission path reads it. `dispatch-contract.js` still gates
on `admission_status`, exactly as before, and an adopted row is admissible or not for exactly the
same reasons a self-qualified one would be.

> `version_source` is a closed enum, so carrying the adoption marker there required **widening the
> enum deliberately** rather than smuggling a value past it: `engine-scorecard.js`
> `VALID_VERSION_SOURCES` now admits `official-default` alongside
> `runtime | manual | operator-asserted`. `hooks/tests/qualify-scorecard-vocabulary.test.sh` still
> holds — it asserts the qualifier's emittable values are a subset of what the scorecard accepts,
> and widening the accepting side keeps that direction satisfied.

## Self-qualification always overrides

Adoption **refuses** a seat whenever the destination store holds **any** local row for the same
`{engine, runner, role}` that is not itself a previously-adopted official default. Not "a newer
row" — *any* row, pass or fail, regardless of dates. A local administration beats an imported one
on the same seat identity; silently shadowing local evidence with someone else's would invert the
entire evidence hierarchy (`engine-onboarding` Stage 3: a live, locally-observed run is the
strongest tier, a stored row the weakest).

**`--force` cannot override this.** Its only job is replacing a *previous official-default
adoption*. There is no situation in which someone else's administration should silently replace
your own, so no flag offers one. To supersede a local row, run a fresh local administration; its
result wins on the same seat.

> The date-based version of this rule shipped in an earlier cut and a depth-0 panel found the hole:
> a local **FAILED** row has no `qualified_at`, so the comparison `'' >= '2026-08-21'` was false, no
> collision was detected at all, and an official QUALIFIED default landed silently on top of a local
> honest failure — the single most damaging direction this rule could fail in. `hooks/tests/
> qualification-defaults-adoption.test.sh` §9b plants exactly that row, plus an older-local-row case
> and a `--force` attempt, and asserts all three are refused with the store left byte-intact.

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
  --document references/official-qualification-defaults.json   # exits 0 on the real bytes
```

> **`capability_score` is a real JSON number.** `validate-json-schema.js` preflights its *document*
> before any schema keyword is evaluated, and it accepts a non-integer numeric literal iff it
> round-trips losslessly — parse to a double, canonically re-serialize (`JSON.stringify`), and
> require an exact byte match against the original literal (a literal that would silently lose
> precision, e.g. an over-long decimal or an overflowing exponent, is still rejected with
> `UNSUPPORTED_JSON_NUMBER`). Scores are `cases_passed / cases_total`, so they are fractional
> (`0.9166666666666666` = 11/12), and every score the store produces is already the JS double's own
> shortest round-trip decimal — exactly the literal form the validator accepts. The committed bytes
> validate as-is — `build` validates exactly what it writes, and `readArtifact` validates again on
> the consumer side before anything is listed or adopted.
>
> Two earlier cuts worked around a stricter validator instead of fixing it: one validated a *copy*
> with those scores replaced by `0` (the gate never saw the shipped artifact), the next shipped
> `capability_score` as a **lossless decimal string** and converted it back with `Number()` on
> adoption. Both are gone now that the validator itself accepts a lossless non-integer literal. The
> test asserts the real bytes validate, that every numeric literal in the artifact's raw source text
> round-trips losslessly, and that every `capability_score` is a finite JSON number mirrored between
> the entry and its `row` — so reintroducing a lossy literal, or reverting to the string workaround,
> goes red instead of quietly re-hollowing the gate.

`--check` is the anti-rot gate, and it is the reason the artifact carries no timestamp: a wall-clock
field would make byte-identical regeneration impossible and would be a claim about the generator
run rather than about the administration. Administration dates live per-entry, where they belong.

Administering a *new* sweep is a separate tool: [`../scripts/qualification-sweep.sh`](../scripts/qualification-sweep.sh)
(`--plan` is deterministic and free; `--execute` spends real dispatches).

## Adopting from a feed (`--from`)

The shipped artifact is baked into a release: static, and unable to carry an administration run
after that release or a strike recorded later. A **feed** is the same disclosure, refreshable:

```bash
node scripts/adopt-qualification-defaults.js list  --from <https-url|path> --role implementer
node scripts/adopt-qualification-defaults.js adopt --from <https-url|path> --seat <engine>:<runner> [--priors]
```

A feed is a remote document written by someone else, and is treated that way end to end:

- **https only**, redirects refused, body and time bounded; the cache may not live inside a git
  work tree.
- **Its `digest` is reported, never trusted.** The cache key is always our own sha256 of the bytes
  we received, and that is what `provenance.adopted_from.digest` records — the only value a later
  reader can hold us to. A feed may declare `digest_basis` to say what its own digest covers; the
  model-dyno feed's, for instance, is a producer-internal change-detection fingerprint over a subset
  of the document, not a hash of the wire bytes. When a basis is declared, a difference is reported
  as expected rather than as a discrepancy — an unexplained difference still gets the louder
  warning. Either way the basis is a REPORTING input only: it can never make us adopt the
  producer's digest.
- **Every `seat_hash` is re-derived locally** from (engine, runner, role, effort). A hash you did
  not compute is a claim. When a feed's value differs, the output says which basis it used: a feed
  built before effort partitioning advertises the three-field hash and is named as such, so the
  producer knows exactly what to regenerate rather than being told "we disagree".
- **The collision rules are the shipped ones.** Local evidence always wins; re-adoption refuses
  without `--force`. A feed entry gets no easier path than a shipped default.
- **`--priors` can never manufacture a qualification.** Priors are appended as provisional
  `external_prior` evidence through the ordinary `record-evidence` path, and a `qualified` state
  there requires `internal_eval` provenance a prior does not have. The ceiling is structural, not
  a rule this tool remembers to apply.
- **No timer, no auto-adopt.** `list --from` fetches and prints; adopting is always a separate,
  explicit command. `~/.autopilot/config.json` `qualification_feed.url` only saves retyping the URL.


## What this does NOT do

- It does not make a default trustworthy. It makes it **legible**.
- It does not create routing authority that survives your own evidence. Local wins.
- It does not protect a seat from downgrade. Strikes apply identically.
- It does not ship brain-seat sittings — those are `owner-brain-seat-v1` records in the capability
  store with their own semantics (forced brain-seat scope, no expiry, 3-strike revocation), not
  scorecard rows. Deferred to a BACKLOG row rather than forced into this shape.
