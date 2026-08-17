# Verification-author qualification suite (2026-08-18)

> 狀態: ⛔ STOPPED at G2 terminal (generation cap with accepted blockers) — NOT approved for implementation; Board decision required for any v3 redesign
> BACKLOG L item: the last canonical role with no qualification suite — the
> /l6 VA seat runs on calibration notes alone.

## 1. Goal

`engine-qualify.sh verification_author`: given a requirements contract (never
an implementation), the candidate authors an executable harness; the host
executes it against hidden implementations and grades **host-verified
behavioral evidence** offline.

**Success criteria**:
1. Seed-derived corpus: same ADMINISTRATION seed ⇒ byte-identical
   administration; per-TRIAL seeds derive distinct corpus instances (G1-F8);
   pinned generator/corpus hashes with precondition checks.
2. Red verdicts are host-re-derived, never candidate-asserted: a case's
   sensitivity credit requires a violation TRACE the host independently
   validates against the formal contract (§2).
3. Untrusted harness execution reuses the exact existing witness-runner
   sandbox contract (§5) — no new containment surface.
4. Remote administration over BOTH transports through the existing broker +
   provider adapter; one canonical harness-output contract shared by provider
   prompt and grader (single module export, G1-F4).
5. Every red line proven fireable by a deviant mock (full enumeration §7);
   existing suites unchanged-green.

## 2. Construct — host-verified behavioral evidence (G1-F0/F1/F5/F7 unified fix)

Each case is generated from a **formal contract** (canonical JSON: exported
function surface, typed parameter domains, expected behavior as an executable
oracle function `expected(args) → {kind: returns|throws, value?}`). Everything
else derives from it:

- **Rendered spec** (candidate-visible): prose rendered from the formal
  contract through rotated templates. P1 acceptance mechanically checks every
  formal field's literal value appears in every rendering (no ambiguity by
  omission); the contract itself, not prose, is the grading oracle, so
  renderer ambiguity can never certify an invalid case (F0).
- **Twin validation** (F0): the generator EXECUTES both twins against a
  probe-call sweep derived from the contract: the clean twin must conform on
  every probe; the defect twin must violate on ≥1 probe AND conform on all
  probes outside its defect surface. A case failing twin validation aborts
  generation (precondition, not a graded outcome).
- **Instrumented execution** (F1/F7): the host runner — not the candidate —
  loads the module inside the sandbox wrapped in a host-owned recording proxy.
  Every invocation's `(args, observed)` is appended to a trace on a host-side
  channel the harness cannot write (fd 3, host-parsed). The candidate harness
  is a plain CommonJS file that requires `process.env.VA_MODULE_PATH` and
  exercises it; its own assertion style is IRRELEVANT to grading.
- **Grading is trace re-derivation** (F1/F5/F7): per twin the host replays the
  trace against the contract oracle:
  - `defect_red` = trace contains ≥1 invocation where `observed` violates
    `expected(args)` (host-verified violation — a forged AssertionError or a
    static-analysis guess produces NO violating trace and earns nothing).
  - `clean_green` = harness process reports success AND the trace contains
    zero violations AND ≥1 invocation (a harness that never executes the
    module fails closed: no-execution).
  - Case passes iff both. Harness exit codes are never trusted; load errors,
    timeout, oversize, empty trace are infra-fail (fail-closed, robustness).
- **Why source-reading no longer pays** (F5): source reading yields only a
  static opinion; credit requires a host-verified violating invocation.
  Residual (named): statically locating the defect then crafting the violating
  call — but deriving that input from requirements IS the examined skill; what
  cannot happen is a fake red or a pass without executing the module.
  Execution-salt (semantics-preserving identifier/layout re-render per
  execution) makes byte-pattern shortcuts brittle besides.

## 3. Corpus shape

One case = formal contract + rendered spec + validated twins over a small
CommonJS module. Defect families (≥6, clean twin each, ≥2 cases per family per
trial, interleaved, all happy-path-blind):

1. boundary-off-by-one (inclusive/exclusive bound flipped)
2. error-path-swallow (required throw replaced by silent fallback)
3. default-fallback-widening (enum rejection replaced by permissive default)
4. state-residue (reset/idempotence broken — only repeated calls misbehave;
   also the family where static pattern-matching is weakest)
5. ordering-contract (stable-sort/tie-break broken — single-element blind)
6. precision-contract (rounding semantics flipped — integer-only blind)

Trial subjects: `sensitivity` (all defect cases red), `specificity` (all clean
cases green, zero violating traces), `robustness` (zero infra-fails).
Qualification = AND of three, both trials. Per-trial seeds derive from the
administration seed (brain precedent) — trial 2 is a different corpus instance
(F8). Named residual: cross-ADMINISTRATION structure memorization (countered
by seed-derived values + salt, not eliminated).

## 4. Candidate-visible envelope + leak scan (G1-F2/F9)

The candidate-visible envelope is EXACTLY the broker payload `content` bytes:
`canonicalJson({case_id, rendered_spec, module_surface, output_contract_ref})`.
The leak scan runs over those exact bytes per case and rejects:
- any token in `union(identifiers ∪ literals of both twins) −
  (formal-contract public surface tokens)` — this includes defect-only
  sentinels by construction (F9);
- defect family names, the generator's oracle vocabulary, per-case canary;
- case ids are seed-derived opaque tokens (no family/kind encoding); filenames
  and paths inside the sandbox are fixed constants shared by every case.
Renderer count is pinned (3) with seed-derived assignment; serialization is
canonicalJson everywhere (byte-stable).

## 5. Sandbox posture (G1-F3)

Reuses the existing per-case bwrap contract of `engine-qualify.js`
(`sandboxArguments` family, policy-hashed): `--unshare-net/pid/ipc/uts`,
`--die-with-parent`, `--clearenv` + allowlist (`VA_MODULE_PATH`, the trace fd
number), RO binds for `/usr` + node + the case module + the harness file,
tmpfs `/tmp`, private empty HOME, no repo/corpus/host-home/broker mounts.
Fresh sandbox per (case × twin) — zero cross-run persistence (also the
mechanical kill for cross-case runtime memorization and shared-state ordering
attacks). Wall clock 60 s per execution (spawnSync timeout kills the tree),
stdout/trace caps 1 MB, `--max-old-space-size=256`. Named residual: CPU/fd
limits are enforced only indirectly via wall/output caps (same residual the
witness runner already carries — no new surface).

## 6. Chassis contracts frozen (G1-F4)

- Evidence kind `role_eval`, role `verification_author` (already in the
  canonical enum), methodology name `va-behavioral-trace-v1`; row schema is
  the EXISTING emit-row schema unchanged; store append + `--emit-row` +
  `--version-source` identical to the reviewer path.
- Broker request: `{role: 'verification_author', payload: {format:
  'unified_diff', content: <envelope §4>}}` (format field stays the opaque
  constant — brain-suite precedent).
- ONE canonical harness-output contract: exported as `HARNESS_CONTRACT` from
  `evals/va-eval-generator.js`; the provider prompt (P4) and the grader (P2)
  both import it — no second statement anywhere (CLAUDE.md rule).
- Transport parity acceptance: the SAME mock case administered through a local
  panel-cmd AND through the broker with a stub provider must produce
  byte-equal evidence rows modulo the transport/policy-hash fields (explicit
  field diff list in the test).

## 7. Deviant-mock acceptance matrix (G1-F6)

Every row is a distinct mock candidate or corrupted precondition in
`hooks/tests/engine-qualify-va.test.sh` / grader suite, each asserted to fire
its exact red line:

| Deviant | Expected outcome |
|---|---|
| perfect harness | qualified (both trials) |
| vacuous (asserts nothing, exits 0, never calls module) | no-execution → specificity/robustness fail |
| happy-path-only (calls module on mid-range values) | defect twins stay green → sensitivity fail |
| over-strict (fails everything) | clean twins red without violating trace → specificity fail |
| forged red (throws AssertionError, no module call) | no violating trace → sensitivity fail |
| static fingerprint (reads source, conditional fake red) | no violating trace → sensitivity fail |
| crash / syntax error | infra-fail → robustness fail |
| sleeper (exceeds wall) | timeout infra-fail |
| flooder (exceeds output cap) | oversize infra-fail |
| empty / malformed provider output | case fails closed (transport) |
| generator/corpus hash mismatch | precondition abort, no administration |
| partial subjects (one trial passes, one fails) | not qualified |
| store append failure | fail-closed, nonzero exit, no partial row |

## 8. Phases

- **P1 — generator + corpus** (`evals/va-eval-generator.js` + corpus JSON):
  formal contracts, twin emit with execution-salt, probe-sweep twin
  validation, renderers + field-literal coverage check, envelope builder +
  leak scan, `HARNESS_CONTRACT` export. Acceptance:
  `hooks/tests/va-eval-generator.test.sh` — determinism, per-trial seed
  divergence, twin-validation red case (a twin pair that fails probes aborts),
  leak-scan red case, renderer field-coverage red case.
- **P2 — instrumented runner + grader** (`evals/va-eval-grader.js` +
  host-runner source in `engine-qualify.js`): proxy-wrapped module loading,
  fd-3 trace channel, sandbox invocation, trace re-derivation grading, subject
  fold. Acceptance: `hooks/tests/va-eval-grader.test.sh` — the deviant rows of
  §7 that are grader-local (vacuous/over-strict/forged/crash/sleeper/flooder/
  no-execution), trace-tamper red case (harness writing to the trace channel
  is detected/ignored).
- **P3 — `engine-qualify.js verification_author` subcommand**: administration
  loop over local panel + broker transports, pinned hashes, evidence append +
  `--emit-row` + `--version-source`. Acceptance:
  `hooks/tests/engine-qualify-va.test.sh` — perfect + deviant mocks through
  the REAL sandbox, transport parity row-diff, precondition aborts, partial
  subjects, store-failure fail-closed.
- **P4 — provider authoring mode** (`QRP_PROMPT_MODE=va`): prompt teaches the
  imported `HARNESS_CONTRACT` + honesty boundary (no defect-family
  enumeration; scanned against the generator's oracle projection; prompt hash
  recorded in the identity convention). Role gate `verification_author`.
  Acceptance: provider suite extension (argv/stdin shape, role-gate matrix,
  honesty scan, hash recording).
- **P5 — dogfood + docs + release**: one real administration of the incumbent
  VA seat (GLM-5.2 @ HTTP; sol/codex backup if z.ai 529s), recorded honestly
  (advisory). CHANGELOG v2.34.17, scripts-inventory, engine-onboarding SKILL +
  governance reference, BACKLOG retirement. Acceptance: preflight 8/8 +
  administration record + honesty clause naming §2/§3/§5 residuals.

Dependency: P1 → P2 → P3 → P4 → P5; no parallel writes to shared files.

## 9. Verification contract (dev-flow mandatory answer)

`for t in va-eval-generator va-eval-grader engine-qualify-va
qualification-review-provider; do bash hooks/tests/$t.test.sh; done` all green
(suites authored red-first) + `bash scripts/preflight-release.sh` 8/8 +
existing engine-qualify/brain/owner suites unchanged-green. The P5
administration is a recorded outcome, not a gate.

## 10. Out of scope

- /l6 roster-routing changes; cross-family diversity enforcement (roster
  policy); implementer/explorer suites; multi-file integration-scale harness
  authoring (v1 = single-module, reviewer-corpus scale).

## Review Loop History

- G1 (2026-08-18, sol codex/max = STOP + glm-5.3 http/high = CONDITIONAL; 9
  blocking + 1 future): all 9 accepted; this revision's §2 (trace
  re-derivation), §4 (envelope scan), §5 (sandbox), §6 (frozen contracts),
  §7 (deviant matrix), and the per-trial seeds ARE the repairs. G1's
  refutation of the old source-reading argument was right — it is withdrawn.
  Full envelope + per-finding disposition:
  `docs/plans/evidence/2026-08-18-verification-author-suite/g1-{envelope,disposition}.json`.
