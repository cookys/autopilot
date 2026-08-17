# Verification-author qualification suite (2026-08-18)

> 狀態: DRAFT — pending hetero plan review
> BACKLOG "Roster qualification — remaining legs" L-effort item. The
> verification_author role is the LAST canonical role with no qualification
> suite (engine-onboarding: "auto-qualification requires role-specific eval
> suites before autonomous routing") — the /l6 VA seat currently runs on
> calibration notes alone.

## 1. Goal

`engine-qualify.sh verification_author` administers a deterministic standing
exam for the role that AUTHORS verification harnesses on the /l6 rail: given a
requirements spec (never the implementation), the candidate writes an
executable harness; the host runs that harness against hidden clean and
planted-defect implementations and grades red-green behavior offline.

**Success criteria** (chassis parity with the reviewer/owner/brain suites):
1. Seed-derived corpus: same seed ⇒ byte-identical administration; pinned
   generator/corpus hashes with precondition checks.
2. Host-executable oracle: the candidate's harness runs in the same fail-closed
   networkless bwrap sandbox family as reviewer witnesses; crash/timeout/empty
   = the case fails closed, never passes.
3. AND bar across subjects (below); 2 trials; `--emit-row` + evidence-store
   append on the canonical `verification_author` role.
4. Remote administration works over BOTH transports (HTTP + CLI) through the
   existing broker + provider adapter with a new authoring prompt mode.
5. All existing suites stay green; new suite `hooks/tests/engine-qualify-va.test.sh`
   proves every red line can actually fire (deviant mock candidates).

## 2. Construct (what the exam measures)

Per engine-onboarding's five VA bars, mapped to mechanical checks:

| Bar | Mechanical form |
|---|---|
| Catches planted defects ordinary tests miss | **Sensitivity**: harness RED on the defect twin. Defect families are chosen to be happy-path-blind (see §3). |
| Authored from requirements, not implementation internals | **Construct-guaranteed**: the authoring payload contains ONLY the spec + public interface; implementations exist solely host-side. Generator leak-scan pins that no implementation-only token appears in the visible spec (brain-suite pattern). |
| Harness runs under depth-0 authority | **Execution split**: candidate authors text; the HOST executes it and owns grading. The harness is untrusted code — sandboxed, time-boxed, output-bounded. |
| False confidence from weak tests blocks qualification | **Specificity + vacuity red line**: harness must be GREEN on the clean twin (over-strict/fail-everything dies here) AND red on the defect twin (vacuous/happy-path-only dies here). A harness that exits 0 without executing any assertion against the module under test is caught by the defect twin staying green. |
| Family diversity is preferred | Not examinable per-candidate — stays a roster-routing rule, out of exam scope. |

Anti-gaming notes:
- A harness reading the implementation source AT RUN TIME self-defeats: both
  twins execute symmetrically, so source-matching assertions can at best pass
  one twin and fail the other — exactly the red-green bar it must meet anyway.
- One canonical module path + exported surface per case; the harness receives
  the module path via env (`VA_MODULE_PATH`), so the same harness text runs
  against both twins unmodified.
- Spec values are seed-derived (thresholds, key names, enum members) so no
  public template can satisfy sensitivity across renderers; specs are rendered
  through rotated renderers (brain-suite precedent) to break grammar matching.

## 3. Corpus shape

One case = seed-derived triple (spec, clean impl, defect impl) over a small
CommonJS module (reviewer-corpus scale). Defect families (each with a clean
twin; ≥6 families, ≥2 cases each per trial, families interleaved):

1. **boundary-off-by-one** — spec pins an inclusive/exclusive bound; defect
   flips it. Happy-path tests using mid-range values stay green.
2. **error-path-swallow** — spec requires a throw/error report on invalid
   input; defect returns a fallback silently.
3. **default-fallback-widening** — spec enumerates accepted values with
   rejection otherwise; defect accepts unknowns via a permissive default.
4. **state-residue** — spec requires reset/idempotence across calls; defect
   leaks state so only REPEATED calls misbehave (single-shot tests blind).
5. **ordering-contract** — spec pins stable ordering/tie-breaks; defect breaks
   ties differently (single-element tests blind).
6. **precision-contract** — spec pins rounding/truncation semantics; defect
   uses the other one (integer-only tests blind).

Grading per case (host, offline):
- `clean_green`: harness exit 0 on the clean twin.
- `defect_red`: harness nonzero on the defect twin, via an ASSERTION failure
  (the runner distinguishes assertion exits from crash/timeout/infra errors —
  dev-flow red-qualification semantics; infra failure = case fails closed).
- Case passes iff both. Trial subjects: `sensitivity` (all defect_red),
  `specificity` (all clean_green), `robustness` (no infra-fail/timeout/oversize
  across the administration). Qualification = AND of three, both trials.

## 4. Phases

- **P1 — generator + corpus** (`evals/va-eval-generator.js`,
  `evals/va-capability-evidence-corpus.json`): seed-derived triples, renderer
  rotation, leak-scan (implementation-only tokens + per-case canary), validate/
  self-test export. Acceptance: `hooks/tests/va-eval-generator.test.sh`
  (determinism, leak-scan red case, twin behavioral divergence proven by
  actually executing both twins against a probe call).
- **P2 — host runner + grader** (`evals/va-eval-grader.js` + engine-qualify
  wiring): sandboxed harness execution (reuse the witness-runner bwrap family:
  networkless, module+harness mounted RO, wall/output caps), red-green
  classification with assertion-vs-infra distinction, subject fold. Acceptance:
  `hooks/tests/va-eval-grader.test.sh` (mock harnesses: perfect / vacuous /
  over-strict / crashing / sleeping / oversized — every red line fires).
- **P3 — `engine-qualify.js verification_author` subcommand**: administration
  loop over the broker (role `verification_author`, payload = spec bundle),
  pinned-hash preconditions, evidence append on the canonical role +
  `--emit-row`, `--version-source` honored. Acceptance:
  `hooks/tests/engine-qualify-va.test.sh` end-to-end with a scripted mock
  candidate through the REAL sandbox transport (brain-suite pattern).
- **P4 — provider authoring prompt** (`QRP_PROMPT_MODE=va` in
  `qualification-review-provider.js`): teaches the OUTPUT CONTRACT (a single
  self-contained CommonJS test file reading `VA_MODULE_PATH`, assertion style,
  exit semantics) and the honesty boundary (no defect-family enumeration beyond
  what the spec itself states; scanned against the generator's oracle-token
  projection; prompt hash recorded). Role gate: requires
  role=verification_author payloads. Acceptance: provider suite extension
  (authoring argv/stdin shape, role gates, honesty scan, hash recording).
- **P5 — dogfood + docs + release**: one real administration of the incumbent
  VA seat (GLM-5.2 @ cc-shim per roster — HTTP transport; sol/codex as backup
  if z.ai 529s), recorded honestly whatever the outcome (advisory — the VA
  seat keeps operating per current roster rules; a FAIL annotates). CHANGELOG
  v2.34.17 (PATCH — scripts/evals, no new skill/agent), scripts-inventory,
  engine-onboarding SKILL + governance reference, BACKLOG row retirement.

Dependency: P1 → P2 → P3 → P4 → P5; no parallel writes to shared files.

## 5. Verification contract (dev-flow mandatory answer)

`for t in va-eval-generator va-eval-grader engine-qualify-va
qualification-review-provider; do bash hooks/tests/$t.test.sh; done` all green
(new suites authored red-first against the not-yet-written modules) +
`bash scripts/preflight-release.sh` 8/8 + existing engine-qualify/brain/owner
suites unchanged-green. The P5 administration itself is a recorded outcome, not
a gate.

## 6. Out of scope

- Auto-routing changes: qualification evidence feeds the existing scorecard /
  readiness surfaces; /l6 roster selection rules do not change in this ship.
- Cross-family authoring-diversity enforcement (roster policy, not exam).
- Implementer/explorer suites (separate BACKLOG items).
- Multi-file / integration-scale harness authoring — v1 examines single-module
  harness discipline (same scale decision the reviewer corpus made).

## Review Loop History

- (pending) hetero plan review generation 1.
