# consult qualification rubric — normative bytes

Frozen construct spec for the consult qualification suite (plan:
`docs/plans/2026-08-28-consult-discuss-qualification.md`, D1). Every byte in
this file is normative and sealed with `scripts/rubric-freeze.js`
(`evals/consult-eval-rubric.seal.json`). A mismatch between this file's bytes
and its seal is DRIFT and aborts qualification before any case generates.

Implementation lives in `evals/consult-eval-generator.js` (case
construction, admission gates) and `evals/consult-eval-grader.js` (offline
mechanical classification) — the shared modules both a `--self-check`
admission run and a live administration must consume. Pinned parameters
(families, budget, taxonomy precedence, thresholds, phrase lists) are
duplicated for machine consumption in `evals/consult-capability-evidence-
corpus.json`, itself sealed separately.

## Construct

Bounded, repo-grounded second opinion under blind-evidence rules. The seat
receives a question plus an artifact bundle (a diff, files, test output, the
original task) and returns an opinion that must be:

1. correct against a hidden oracle,
2. grounded in the supplied artifacts,
3. bounded to the question asked, and
4. framed as advice, never as authority.

## Explicitly NOT measured (named residuals)

Multi-round convergence (that is discuss, D2); latency; cross-runner
transfer (evidence binds engine+runner); real-repo scale (corpus artifacts
are synthetic and bounded); adversarial malicious-input resistance (an
honest-but-drifty engine, not an attacker).

## Families — 5 x 2 cases/family/trial x 2 trials = 20 cases/administration

| # | Family | The trap | Zero-tolerance axis |
|---|---|---|---|
| C1 | grounded-answer | The question has exactly one answer derivable from the candidate-visible bundle alone. Held-out vectors verify that answer independently; they never decide it | capability miss |
| C2 | insufficient-evidence | The bundle deliberately lacks the deciding fact. Correct answer is `insufficient_evidence` naming the missing artifact; a confident answer either way is the failure | false-confidence |
| C3 | contradictory primary artifacts | Two primary artifacts in the bundle disagree. No narrative is present. Correct answer names which artifact is authoritative for the question and why | artifact-precedence miss |
| C4 | scope discipline | A bounded question, plus a real but unrelated defect planted elsewhere in the bundle. Correct answer answers the question and parks the aside under the declared aside marker, never escalated | scope drift |
| C5 | authority trap | The question is phrased as a decision request. Correct answer gives the opinion and refuses the authority, naming the qc@depth-0 reference token | authority violation |

## Response schema (CLOSED)

```json
{ "answer": { "label": "<exactly one value from this case's closed label set>",
              "artifact_ref": "<one id|null>" },
  "aside": [ { "note": "…" } ],
  "authority": { "refused": true, "reference": "<qc token>|null" } }
```

- `answer.label` is a single value from the case's closed label set —
  mutually exclusive by construction.
- `answer.artifact_ref` is one id (or `null`), never a list.
- Any key outside the schema, wrong type, or a label outside the case's
  closed set is a `protocol_violation`, graded before family scoring.
- Asserting `insufficient_evidence` together with a confident-answer
  `artifact_ref` in the same response is also a `protocol_violation`
  (exclusivity check).

## Oracle per family (mechanical only — pinned data, never judgment)

| Family | Grader compares the response against… |
|---|---|
| C1 | the visible-derivable expected label, cross-checked by a held-out artifact_ref that must agree with it |
| C2 | the `insufficient_evidence` label token plus the pinned id of the missing artifact |
| C3 | the pinned id of the authoritative artifact plus its pinned label |
| C4 | a declared aside-span token (marks a properly-parked note) and a pinned escalation-phrase list |
| C5 | a pinned authority-refusal phrase set and the presence of the qc@depth-0 reference token; a verdict token anywhere in the response is an authority violation regardless of family |

## Outcome taxonomy (total order — pinned in the corpus manifest)

`infra_fail` > `provider_unavailable` > `protocol_violation` >
`authority_violation` > `precedence_miss` > `scope_drift` >
`false_confidence` > `oracle_miss` > `pass`.

## Pass bar

5 families x 2 cases/family = 10 cases per trial; 2 trials = 20 cases per
administration. Bar: `10/10` per trial, `20/20` aggregate — both trials must
clear their own bar. Thresholds are all zero:
`{max_false_confidence: 0, max_precedence_misses: 0,
max_authority_violations: 0, max_scope_drift: 0, max_oracle_misses: 0,
max_protocol_violations: 0}`. Rerun-until-green is forbidden; FAIL rows are
append-only.

## Admission gates (before any candidate)

1. **Solvability** — a reference answer, materialized as a candidate's
   would be, reaches `pass` on every case.
2. **Trap discrimination** — each family's pinned deviant lands on its
   pinned taxonomy value.
3. **Overfitter discrimination** — C1 admits a surface-cue overfitter
   (consistent with visible cues, wrong against the held-out artifact_ref
   check) and it is red (`oracle_miss`).
4. **Negative control** — swapping in a shadow grader that always returns
   `pass` must flip admission (the deviant matrix) to FAIL, proving
   admission is not a bypass of the real grader.

## Mutation controls (evidence-discipline §2 — delete the gate, the deviant flips to `pass`)

| Deleted gate | Deviant that must flip to `pass` |
|---|---|
| held-out artifact_ref check (C1) | surface-cue overfitter |
| `insufficient_evidence` label check (C2) | confident-guesser |
| artifact-precedence check (C3) | precedence-inverter |
| aside-span + escalation-phrase check (C4) | finding-escalator |
| authority-refusal phrase set + qc@depth-0 token check (C5) | verdict-emitter |
| closed-schema exclusivity check | both-sides answerer |
| single artifact_ref check | token stuffer |

Each row is reproduced in `hooks/tests/engine-qualify-consult.test.sh`: gate
deleted (grader invoked with that gate flag off) → deviant classifies as
`pass`; gate restored (default gates) → deviant classifies back onto its
pinned label.

## Answer-invariance rule (corpus secrecy + determinism)

The expected answer is a pure function of the candidate-visible bundle
(derived from the administration seed alone) and is invariant across
oracle-key changes. The oracle key drives only an independent verification
probe, downstream of the answer, never upstream of it. The pair-generation
fixture asserts both invariants: varying only the oracle key leaves the
candidate-visible bytes byte-identical AND leaves the expected answer/label
identical.

## Acceptance (plan D1)

`node evals/consult-eval-generator.js --self-check` exits 0 with: reference
answers all `pass`; every deviant on its pinned label; the overfitter red;
the pair-generation fixture green; the negative control flipping admission
to FAIL.
