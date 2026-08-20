# v3 design requirements — distilled from G1 (9 blockers) + G2 (9 blockers + 1)

Two-generation hetero review (sol codex/max chair + glm-5.3 http/high deep)
STOPPED the v2 plan at the terminal cap. Envelopes: `g1-envelope.json`,
`g2-envelope.json`; G1 disposition: `g1-disposition.json`. Any v3 redesign is a
NEW plan (fresh logical_plan_id, fresh G1) and needs Board authorization —
bounded review is spent for this design lineage.

## The three fatal mechanics G2 proved (must-solve, known directions)

1. **Same-process trace forgery (G2-F3)**: the recording proxy and candidate
   code share one V8 process; fd numbers exposed via env are writable by
   `fs.writeSync`. → Direction: the trace is only a PROPOSAL of inputs; the
   host RE-EXECUTES the recorded call sequence against each twin in a separate
   host-owned process and derives observations itself (replay-as-evidence).
   Forged frames become inert; state-residue families replay full sequences.
2. **Spec-blind exhaustive caller (G2-F0, VA7 rejoined)**: with the host as
   oracle, a generic fuzzing harness earns sensitivity credit without reading
   the spec. → Direction: an invocation BUDGET (small multiple of the minimal
   revealing sequence length) + grading that requires the violating call to
   fall inside budget; optionally candidate-declared expected outcomes per
   call (re-introduces a candidate verdict surface the host can score against
   the contract — catches "right call, no understanding").
3. **Contract serialization (G2-F5)**: `expected(args)` as a function cannot
   live in canonical JSON. → Direction: a data-only contract DSL (typed
   domains, behavior table / expression tree) interpreted by one pinned
   evaluator in the generator; corpus hash covers evaluator + DSL docs; the
   per-execution salt gets a seed-derived deterministic definition (G2-F5's
   second half).

## Construct decision the Board must rule on (blocks any v3)

**Black-box vs white-box authoring** (G1-F5 → G2-F7): the module file must be
readable for `require`; a source-guided harness can find the defect and craft
a genuine violating call. v2 called this an in-scope residual; the G2 chair
ruled it defeats the "authored from requirements" construct. Options:
(a) accept white-box as valid VA skill and rename the construct accordingly
    (production /l6 authors DO see the repo);
(b) enforce black-box by moving the module behind an IPC service the harness
    calls without filesystem access to its source (bigger build);
(c) hybrid — score requirements-grounding via candidate-declared expected
    outcomes (direction 2 above) so source-reading without spec-reading still
    fails the declared-expectation check.
Recommendation to the Board: (c) — it solves 2 and 3's skill-attribution
problem with one mechanism and keeps the sandbox simple.

## Remaining G2 items for v3 (real, with directions)

- VA1b prose↔oracle consistency: literal-presence is not semantics; add
  spec-rendering property tests (negation/inequality direction preserved) or
  render prose from the same expression tree the evaluator interprets.
- VA2a/F9 deterministic outcome taxonomy: define the full classification
  (assertion-fail / crash / timeout / oversize / no-execution / success) from
  host-observable signals only, and remove the "reports success" ambiguity
  (G2-F9 caught §2 contradicting itself).
- VA3a local-panel isolation: the local panel-cmd authoring path needs the
  same no-corpus/no-generator mount guarantee the broker path has — specify
  the authoring sandbox, not just the execution sandbox.
- VA4 host exhaustion: PID/cgroup limits or a no-subprocess seccomp posture
  for the harness sandbox; Buffer/native memory outside the V8 heap flag.
- VA8: the deviant matrix must include the NEW attack rows G2 enumerated
  (spec-blind exhaustive caller, source-guided real invocation, semantic
  renderer corruption preserving literals, off-sweep twin defects,
  local-panel leakage, valid-frame forgery, proxy bypass, child-process
  exhaustion).
