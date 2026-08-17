# Verification-author qualification suite v3 (2026-08-18)

> 狀態: DRAFT — fresh review lineage (Board ruled construct option (c),
> 2026-08-18). Predecessor v2 STOPPED at its G2 terminal; all 19 findings are
> design inputs here (`evidence/2026-08-18-verification-author-suite/
> v3-design-requirements.md`).

## 1. Goal

`engine-qualify.sh verification_author`: the candidate reads a requirements
spec and authors a **declared test plan** — an ordered list of calls, each
with a pre-declared expected outcome. The HOST executes the plan against
hidden clean/defect twins in its own isolated runner and grades offline.
No candidate code ever executes.

**Success criteria**: seed-derived deterministic corpus with pinned hashes;
grading purely host-derived; both broker transports + local panel; every red
line deviant-proven; existing suites unchanged-green.

## 2. Construct — declared expectations (Board option (c))

The candidate submission per case is DATA, not code (`HARNESS_CONTRACT`
export, single canonical statement):

```
{"case_id", "steps": [ {"call": {"export_path", "args"},
                        "expected": {"kind": "returns"|"throws", "value"?}} ]}
```

- **Bounded**: `steps.length ≤ budget` (corpus-pinned, a small multiple of the
  minimal revealing sequence; G2's spec-blind exhaustive caller dies here).
- **Declared accuracy**: for EVERY step, `expected` must equal the contract
  oracle's `expected(call)` — the direct measurement of having read and
  understood the spec. A source-reading shortcut is impossible by
  construction: the candidate never sees any implementation (its only input
  is the spec envelope), and a fuzzing shortcut fails because wrong
  declarations fail this line even when a call happens to hit the defect.
- **Sensitivity**: host executes the step sequence IN ORDER against the
  defect twin in a fresh isolated runner; ≥1 step's observed behavior must
  deviate from the declared (= contract) expectation. Ordered execution makes
  state-residue defects reachable.
- **Specificity**: same sequence against the clean twin must show ZERO
  deviations (an over-strict or defect-imitating declaration dies here or on
  declared accuracy).
- Case passes iff all three. Subjects per trial: `declared_accuracy`,
  `sensitivity`, `specificity`, `robustness` (no malformed/oversize/budget
  violations). Qualification = AND, 2 trials, per-trial seeds
  (admin-seed-derived; trial 2 is a different corpus instance).

**What v3 removes relative to v2** (why G2's fatal findings do not recur):
no candidate process ⇒ no trace channel to forge (G2-F3), no harness sandbox
exhaustion surface (G2-F6), no readable implementation ⇒ black-box is
construct-guaranteed, mooting the white-box dispute (G2-F7). Scope note: the
exam measures test DESIGN (revealing inputs + correct expectations), which
matches the /l6 authoring rail's actual product (dispatch-author emits
test-plan/verification text, executed by depth-0); authoring executable test
CODE is explicitly out of scope for v1 and named in the honesty clause.

## 3. Contract + corpus (data-only, G2-F5 repaired)

- **Formal contract** = data-only DSL in canonical JSON: exported surface,
  typed finite parameter domains, behavior as an expression tree (comparisons,
  arithmetic, conditionals, throw nodes, bounded state slots for the
  state-residue family). ONE pinned evaluator inside the generator interprets
  it; `expected(call)` = evaluator(behavior, state, args). Corpus hash covers
  generator + evaluator; no functions in serialized artifacts.
- **Rendered spec**: prose rendered from the SAME expression tree (not
  hand-written per renderer), 3 renderers, seed-assigned. P1 property test:
  re-parsing each rendering's comparison directions/negations/values against
  the tree (G2-F1 semantic corruption check), plus field-literal coverage.
- **Twins**: generator emits clean + defect implementations FROM the tree
  (defect = a single mutated tree node per family); twin validation executes
  both against an exhaustive-or-sampled domain sweep — clean conforms
  everywhere, defect deviates exactly on its family's surface; violating
  inputs must exist within the step budget (admission precondition).
- Defect families (6, unchanged from v2 §3): boundary-off-by-one,
  error-path-swallow, default-fallback-widening, state-residue,
  ordering-contract, precision-contract. ≥2 cases/family/trial, interleaved.
- **Envelope + leak scan**: candidate-visible envelope = exact broker payload
  bytes `canonicalJson({case_id, rendered_spec, module_surface, budget,
  output_contract_ref})`; scan rejects any token from the twins' identifier/
  literal sets minus the public surface, family names, oracle vocabulary,
  canary; opaque seed-derived case ids. (Implementations never leave the
  host, so the scan now guards renderer bugs only — defense in depth.)

## 4. Host runner isolation (G2-F4/F6 repaired by shrinkage)

Only HOST-AUTHORED code runs: the runner loads a twin and applies the
declared calls. Still executed inside the existing policy-hashed bwrap family
(networkless, RO binds, tmpfs, fresh sandbox per case×twin, 60 s wall, 1 MB
output) because twins are generated code — but the threat model is now
"generator bug", not "adversarial candidate code". Candidate-plan handling is
pure parsing under caps: bytes ≤ 256 KB, JSON depth ≤ 16, steps ≤ budget,
args must type-check against the declared domains (malformed ⇒ fail-closed
robustness, never a crash). Local panel-cmd authoring runs in the SAME
no-corpus/no-generator sandbox posture the reviewer local panel already has
(explicit mount list in P3 acceptance; G2-F4).

## 5. Outcome taxonomy (G2-F2/F9 repaired)

Host-observable, complete, deterministic — per case:
`pass | declared_mismatch | missed_defect | false_alarm | malformed_plan |
budget_exceeded | infra_fail` (infra_fail = twin runner crash/timeout, which
twin-validation preconditions make a generator defect ⇒ administration aborts
rather than grading). No candidate exit codes exist anywhere in grading.

## 6. Chassis (unchanged from v2 §6, all G1-F4 freezes kept)

Evidence kind `role_eval`, role `verification_author`, methodology
`va-declared-plan-v1`; existing emit-row schema; broker request
`{role: 'verification_author', payload: {format: 'unified_diff', content:
<envelope>}}`; `HARNESS_CONTRACT` single export consumed by provider prompt
and grader; transport-parity row-diff acceptance (local panel vs broker+stub,
explicit field diff list); `--version-source` honored.

## 7. Deviant matrix (v2 §7 + G2-F8 rows, adapted to declared plans)

perfect ⇒ qualified; spec-blind exhaustive caller (budget-exceeding or
wrong-declaration) ⇒ declared/budget fail; defect-imitating declarations ⇒
specificity fail; happy-path-only plan ⇒ missed_defect; over-strict
declarations ⇒ declared_mismatch; malformed/oversize/deep JSON ⇒ fail-closed;
surface-outside call ⇒ malformed; args outside domain ⇒ malformed; semantic
renderer corruption (literals preserved, direction flipped) ⇒ P1 property
test red; off-sweep twin defect ⇒ admission abort; hash mismatch ⇒
precondition abort; partial subjects / one-trial-only ⇒ not qualified; store
append failure ⇒ fail-closed nonzero.

## 8. Phases

- **P1 generator + corpus** (`evals/va-eval-generator.js` + corpus JSON):
  DSL + evaluator, tree-derived renderers + property test, twin emit +
  domain-sweep validation + budget-existence check, envelope + leak scan,
  `HARNESS_CONTRACT`. Suite: determinism, per-trial divergence, each
  admission red case.
- **P2 runner + grader** (`evals/va-eval-grader.js`): plan parsing under
  caps, sandboxed twin execution, taxonomy fold. Suite: full deviant rows
  that are grader-local.
- **P3 `engine-qualify.js verification_author`**: administration loop, both
  transports, pinned hashes, evidence + `--emit-row` + `--version-source`.
  Suite: end-to-end mock candidates through the real sandbox, transport
  parity, precondition aborts, store fail-closed.
- **P4 provider mode** (`QRP_PROMPT_MODE=va`): teaches imported
  `HARNESS_CONTRACT` + honesty boundary (no defect-family enumeration;
  oracle-token scan; prompt hash recorded). Suite extension.
- **P5 dogfood + release**: one real administration of the incumbent VA seat
  (GLM @ HTTP, sol backup), recorded honestly; CHANGELOG v2.34.17,
  scripts-inventory, engine-onboarding docs, BACKLOG retirement; honesty
  clause names the construct scope (test design, not test-code authoring)
  and residuals (cross-administration structure memorization).

P1 → P2 → P3 → P4 → P5.

## 9. Verification contract

`for t in va-eval-generator va-eval-grader engine-qualify-va
qualification-review-provider; do bash hooks/tests/$t.test.sh; done` green
(authored red-first) + preflight 8/8 + existing suites unchanged-green.

## 10. Out of scope

/l6 routing changes; diversity enforcement; implementer/explorer suites;
executable-test-code authoring (measured construct is declared test design);
multi-file scale.

## Review Loop History

- Lineage: v2 plan STOPPED at G2 terminal (2026-08-18) — this file is a fresh
  design under Board construct ruling (c); prior findings and dispositions:
  `docs/plans/evidence/2026-08-18-verification-author-suite/`.
