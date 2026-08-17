# Verification-author qualification suite v3 (2026-08-18)

> 狀態: ✅ FROZEN — v3-G2 terminal reached; the 8 residual blockers (all specification-precision class, zero construct/mechanism defects) were depth-0-adjudicated ACCEPTED and folded below (brain-suite freeze precedent).
> Lineage: v2 STOPPED at its terminal; Board ruled construct (c). Prior
> findings: `evidence/2026-08-18-verification-author-suite/`.

## 1. Goal

`engine-qualify.sh verification_author`: the candidate reads a requirements
spec and authors a **declared test plan** — ordered calls, each with a
pre-declared expected outcome. The HOST executes the plan against hidden
clean/defect twins in its own isolated runner and grades offline. No
candidate code ever executes.

## 2. Construct — declared expectations (Board option (c))

Submission = the candidate's TEXT output, extracted to one JSON object by the
same static `extractJsonObject` rule the reviewer transport uses, then
validated against `PLAN_CONTRACT` (one named schema constant exported by the
generator; provider prompt and grader both import it — G1-F7):

```
{"case_id", "steps": [ {"call": {"export_path", "args"},
                        "expected": {"kind": "returns"|"throws", "value"?}} ]}
```

- **Budget is a CORPUS CONSTANT** (same for every case, pinned in the corpus
  JSON) — it cannot encode the hidden mutation (G1-F5) and bounds spec-blind
  enumeration.
- **Solvability admission** (G1-F0): the generator runs a reference SOLVER
  that sees ONLY the formal contract (never the twins) and derives test
  vectors systematically (domain boundary values, enum sweeps, state
  sequences). A case is admitted only if the solver's vector set reveals the
  defect within the constant budget — a constructive proof that a spec-only
  author can pass.
- **Subjects (three — G1-F3 accepted: specificity is implied by declared
  accuracy and is removed as a subject)**:
  - `declared_accuracy`: three-way agreement per step — the declared `expected`
    equals the contract oracle's `expected(call)` AND the candidate's FULL
    sequence is also executed against the clean twin with every observation
    matching the declaration (G2-F0: calls outside the solver vectors get real
    clean-side verification, not just an oracle table lookup).
  - `sensitivity`: executing the sequence in order against the defect twin
    yields ≥1 host-observed deviation from the declared expectation.
  - `robustness`: zero malformed/oversize/budget/protocol violations.
  Qualification = AND, 2 trials, per-trial seeds (distinct corpus instances).
  (Admission additionally cross-checks clean-vs-oracle on the solver vectors
  before any candidate is involved.)
- **Per-case isolation** (G1-F8): each case is one fresh stateless provider
  invocation (existing broker semantics, now normative); no cross-case
  context, no feedback — all grading is offline after the full
  administration, so nothing about earlier cases' correctness can steer later
  submissions.

## 3. Contract, value algebra, corpus

- **Formal contract** = data-only DSL in canonical JSON: exported surface,
  typed FINITE parameter domains, behavior as an expression tree
  (comparisons, integer arithmetic, conditionals, throw nodes, explicit
  state slots with per-step transitions for the state family). ONE pinned
  evaluator in the generator interprets it; corpus hash covers both.
- **Observable value algebra** (G1-F2): values are JSON primitives, arrays,
  and plain objects only; all numeric domains are integers (the precision
  family rounds TO integers, so outputs stay in-algebra); equality =
  canonicalJson byte equality; `throws` matches `error.name` plus a
  seed-derived message token, exactly; `undefined`/`NaN`/`-0`/functions/
  cycles normalize to `unsupported` and never satisfy any expectation
  (fail-closed). Stateful oracles advance their state slot per step in
  declaration order — the oracle is a fold, not a pure map.
- **Spec rendering** (G1-F1/F10): the tree renders to a STRUCTURED CLAUSE
  LIST — one clause per tree node, bijective — and prose is the natural-
  language surface of those clauses. P1 property test inverts each rendering
  clause-by-clause back to its node (direction, negation, values, state
  transitions), proving the visible spec is complete and unambiguous, not
  merely literal-covered.
- **Derivation independence** (G1-F5): renderer assignment, mutation
  selection, and value derivation use DOMAIN-SEPARATED seed labels
  (`renderer:*`, `mutation:*`, `values:*`); P1 pins an independence
  invariant at the PAYLOAD level (G2-F3): changing only the mutation label
  chain leaves the entire candidate-visible envelope bytes identical — not
  merely the renderer assignment.
- Defect families (6): boundary-off-by-one, error-path-swallow,
  default-fallback-widening, state-residue, ordering-contract,
  precision-contract. ≥2 cases/family/trial, interleaved.
- **Envelope + leak scan**: candidate-visible envelope = exact broker payload
  `content` bytes `canonicalJson({case_id, rendered_spec, module_surface,
  budget, plan_contract_ref})` (budget is the same constant everywhere);
  scan rejects twin identifier/literal tokens minus public surface, family
  names, oracle vocabulary, canary; opaque seed-derived case ids.
- **Hash boundary** (G1-F6 spike, resolved here): the administration is a
  pure function of (admin seed, generator file, corpus JSON); pinned hashes
  cover exactly those two files — the same transitive boundary every
  existing suite uses.

## 4. Host runner isolation

Only host-authored runner code executes candidate-declared calls against
generated twins, inside the existing policy-hashed bwrap family
(networkless, RO binds, tmpfs, fresh sandbox per case×twin, 60 s wall, 1 MB
output). Threat model is "generator bug", not adversarial candidate code.
Plan parsing caps: ≤256 KB, JSON depth ≤16, steps ≤ budget, args
domain-typed. The local panel authoring path binds EXACTLY { node runtime, panel script,
spec-envelope file } read-only — no corpus, generator, twins, repo, or host
home on ANY host-local provider path (G2-F4); P3 acceptance asserts the
literal bwrap argument list against that allowlist.

## 5. Outcome taxonomy (G1-F4 — complete and host-observable)

Per case: `pass | declared_mismatch | missed_defect | malformed_plan |
budget_exceeded | infra_fail`. Mapping is exhaustive: runner crash, signal,
timeout, output overflow, empty/malformed runner protocol, sandbox-launch
failure → `infra_fail`; since twins passed admission, any `infra_fail` is a
generator/runner defect ⇒ the ADMINISTRATION aborts with no verdict (never
graded against the candidate). Authoring-transport failures split by origin (G2-F1): a delivered provider
response that is empty/unextractable/schema-invalid → `malformed_plan`
(candidate-attributed); broker/launcher/request-delivery/host-side failures →
`transport_fail`, which ABORTS the administration with no verdict (never
graded against the candidate; re-sit is a fresh administration).
Anything unclassified ⇒ `infra_fail` abort (catch-all). Total classification
precedence when signals overlap (G2-F2): abort classes (`infra_fail`,
`transport_fail`) > `malformed_plan` > `budget_exceeded` >
`declared_mismatch` > `missed_defect` > `pass` — one deterministic outcome
per case. Candidate exit codes do not exist in this design.

## 6. Chassis

Evidence kind `role_eval`, role `verification_author`, methodology
`va-declared-plan-v1`; existing emit-row schema; broker request
`{role: 'verification_author', payload: {format: 'unified_diff', content:
<envelope>}}` — the format token stays the opaque chassis constant (brain
precedent); renaming it repo-wide is BACKLOG (G1-F11). `--version-source`
honored; transport-parity acceptance diffs evidence rows local-panel vs
broker+stub with an explicit allowed-field list.

## 7. Deviant + acceptance matrix (G1-F9 — exact mapping)

The suite implements the matrix TABLE-DRIVEN: one fixture per row, each row
pinning ONE deterministic taxonomy value (no either/or rows — G2-F5), the
subject fold, the process exit status, and the evidence/store effect;
timeout, sandbox-launch failure, host-vs-provider transport faults, vacuous
plans, and unsupported-value expectations each get an explicit fixture. Two
negative controls: (a) runner invocation counters prove both twins actually
executed per case; (b) the mutation control deletes the sensitivity gate in
a sandbox copy and asserts the HAPPY-PATH-ONLY deviant (missed_defect under
the real gate) then reports qualified — a discriminating flip, unlike the
perfect mock which qualifies either way (G2-F6).

perfect ⇒ qualified · spec-blind enumerator ⇒ budget_exceeded /
declared_mismatch · defect-imitating declarations ⇒ declared_mismatch ·
happy-path-only ⇒ missed_defect · over-strict ⇒ declared_mismatch ·
malformed/oversize/deep JSON, surface-outside call, out-of-domain args ⇒
malformed_plan · semantic renderer corruption ⇒ P1 property red · off-sweep
or unsolvable-in-budget case ⇒ admission abort · hash mismatch ⇒
precondition abort · runner protocol/overflow/signal ⇒ infra_fail abort ·
partial subjects / one-trial ⇒ not qualified · store append failure ⇒
fail-closed nonzero · transport empty/unextractable ⇒ malformed_plan.

## 8. Phases

- **P1 generator + corpus**: DSL + evaluator, clause-bijective renderers +
  inversion property test, twins + admission (domain sweep, solver,
  clean cross-check), derivation-independence invariant, envelope + leak
  scan, `PLAN_CONTRACT`. Suite: determinism, per-trial divergence, every
  admission red case.
- **P2 runner + grader**: plan parsing under caps, sandboxed ordered
  execution, value algebra, taxonomy fold. Suite: grader-local deviant rows
  + both negative controls.
- **P3 `engine-qualify.js verification_author`**: administration loop, both
  transports + local panel, pinned hashes, evidence + `--emit-row` +
  `--version-source`. Suite: end-to-end mocks through the real sandbox,
  transport parity, precondition/infra aborts, store fail-closed.
- **P4 provider mode** (`QRP_PROMPT_MODE=va`): teaches imported
  `PLAN_CONTRACT` + honesty boundary (no defect-family enumeration;
  oracle-token scan; prompt hash recorded). Suite extension.
- **P5 dogfood + release**: one real administration of the incumbent VA seat
  (GLM @ HTTP, sol backup), recorded honestly; CHANGELOG v2.34.17,
  scripts-inventory, engine-onboarding docs, BACKLOG retirement (incl. the
  G1-F11 format-token rename entry); honesty clause names construct scope
  (declared test design, not test-code authoring) and residuals
  (renderer-template familiarity, cross-administration memorization).

P1 → P2 → P3 → P4 → P5.

## 9. Verification contract

`for t in va-eval-generator va-eval-grader engine-qualify-va qualification-review-provider; do bash hooks/tests/$t.test.sh || exit 1; done` — the `|| exit 1` is normative so an early failure can never be masked by a later green (G2-F7) — plus preflight 8/8 and existing suites unchanged-green. Suites authored red-first.

## 10. Out of scope

/l6 routing changes; diversity enforcement; implementer/explorer suites;
executable-test-code authoring; multi-file scale; the broker format-token
rename (BACKLOG).

## Review Loop History

- v3-G2 terminal (2026-08-18, sol chair STOP + glm deep CONDITIONAL; 8
  blocking + 2 non-blocking): generation cap reached. Depth-0 adjudication
  (brain-suite freeze precedent — semantic authority returns to depth-0 at
  the terminal): ALL 8 accepted as specification-precision repairs and
  folded into §2 (clean-twin execution of the candidate sequence), §3
  (payload-level independence invariant), §4 (literal mount allowlist), §5
  (transport_fail abort class + total precedence), §7 (one-deterministic-
  outcome rows + discriminating mutation control), §9 (exit-surviving loop).
  Zero construct/mechanism findings remained — the freeze basis. Envelope:
  `evidence/2026-08-18-verification-author-suite/v3-g2-envelope.json`.
- v3-G1 (2026-08-18, sol chair STOP + glm deep CONDITIONAL; 9 blocking, 3
  non-blocking): all accepted; repairs are §2 (constant budget, solver
  admission, three subjects, per-case isolation), §3 (value algebra,
  clause-bijective rendering, domain-separated derivation, hash boundary),
  §5 (complete taxonomy), §6 (transport statement unified), §7 (exact
  acceptance mapping + negative controls). Envelope:
  `evidence/2026-08-18-verification-author-suite/v3-g1-envelope.json`.
