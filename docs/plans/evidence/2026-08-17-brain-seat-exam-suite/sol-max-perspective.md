# gpt-5.6-sol @ max — repo-grounded exam design review (2026-08-17)

> Dispatched via `scripts/dispatch-explore.sh --runner codex --model gpt-5.6-sol --effort max`; status explored, read_probe ok, sandbox read-only, repo_modified false. Verbatim raw_log below.

READ-PROBE: READPROBE-2644111-9df4f9c0fe9f0431ad97200e80c83440

## A. RETRODICTION

### Diligence — partial catch

The proposed trajectory replay would catch the narrow regression form of **F5**: if finding `X` is closed and the same defect later resurfaces, stable-ID exact matching would mark a missing `X` as a critical miss and record its round. It would also catch the “6 FAILs omitted” form of **F10** if those failures appear as planted critical defects and an accepting verdict counts as a false pass. That directly targets the failures described in [sol-pathology.md](/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-17-autonomous-brain-integration/sol-pathology.md:24) using the survey’s injected-regression rule in [survey.md](/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-17-brain-seat-exam-suite/survey.md:27).

It would still pass the engine in several pathological cases:

- **F5 can remain as a repair-policy pathology.** An engine can perform five whole-unit redispatches, repeatedly recheck everything, and still emit the correct defect set every round. Diligence passes because no defect was missed; only convergence or an explicit targeted-repair rule can reject the waste.

- Most of **F10** is not a regression-detection problem. `model_attempts=0`, stale quota interpreted as live, or an unsupported login claim require receipt freshness and evidence-before-assertion cases. A code-defect trajectory will not exercise them.

- **F3, F6 and F7 recurrence** would be missed unless the corpus deliberately repeats an already-established process invariant after intervening clean rounds. Merely varying injection positions does not test “read the ruling, later relapse.”

- There is no mandatory late horizon. SPRT can early-pass on strong early performance before the late sentinel where degradation would appear. That is incompatible with measuring “round of first miss”; the survey itself notes round-position effects and that sequential trials cannot resolve decay curves well ([survey.md](/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-17-brain-seat-exam-suite/survey.md:27)). A qualification pass must complete a fixed late window; only early rejection is safe.

Therefore diligence probably would have caught one manifestation of F5 and one manifestation of F10, but it would not establish that the engine would avoid the broader late-session pathology before production.

### Fairness — does not reliably retrodict F7

The counterfactual design catches genuine family-label preference: if the identical work product is accepted with a self-family label and rejected after a label swap, the maximum verdict delta fires. That mechanism is clean.

But the observed **F7** was role-boundary collapse—implementer self-test counted as acceptance and a native writer was presented as heterogeneous—not demonstrated label preference ([sol-pathology.md](/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-17-autonomous-brain-integration/sol-pathology.md:30)). An engine can apply the same wrong rule to every family and obtain a zero delta. The survey explicitly warns about the “consistently wrong” paradox but then proposes delta-only acceptance ([survey.md](/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-17-brain-seat-exam-suite/survey.md:28)).

Additional false passes:

- “Accept everything” or “accept every self-test” is perfectly label-invariant unless every fairness arm also has an absolute correctness oracle.
- Binary verdict equality hides biased severity, repair scope, retry count, verifier budget, and escalation behavior.
- Selectively sampled directional pairs leave unsampled family pairs unqualified in fact but implicitly covered in the evidence.
- Label stripping removes explicit family cues, but the engine can infer family from coding style, formatting, transport metadata, or characteristic artifacts.

The shipped architecture correctly assigns F7 to role qualification and contract admission rather than this exam ([architectural plan](/home/cookys/projects/autopilot/docs/plans/2026-08-17-autonomous-brain-integration.md:41)). Fairness remains useful, but the proposed form should not claim F7 coverage.

### Convergence — catches obvious stalls, passes several central shapes

The clear catch is a simple **F5/F10 verification spin**: three externally recorded zero-product bursts trip the fuse. A declared finding-level `full-suite` rerun fails immediately. A poll-only **F12** sequence also trips if each poll becomes a separate burst, because the implementation increments on every `product_files === 0` row ([check-stall-fuse.js](/home/cookys/projects/autopilot/scripts/check-stall-fuse.js:97)).

The important false passes are:

- **F2 passes by design.** A 53-file candidate has product delta, so the fuse cannot see its quadratic downstream cost. Both the script and architecture say F2 belongs to the pre-spawn churn budget, not the fuse ([check-stall-fuse.js](/home/cookys/projects/autopilot/scripts/check-stall-fuse.js:8), [architectural plan](/home/cookys/projects/autopilot/docs/plans/2026-08-17-autonomous-brain-integration.md:41)). The exam needs an explicit mega-batch refusal case; “scope-diff check” is not equivalent.

- **F1/F3/F4 can look like product.** The shipped classifier counts every non-test/eval file as product. Handwritten control-plane files, gate scripts, graph records, and tracker rewrites reset the stall counter even when hidden objective acceptance has not moved.

- **F5 can also evade the counter.** Whole regeneration commonly changes product files every round. Unless hidden acceptance-test transitions—not file classes—supply `product_files`, the counter resets.

- **F12 passes if five polls occur inside one candidate-defined burst.** The fuse counts burst rows, not polls, tool calls, or interrupted waits.

- The script trusts supplied counts and `reverify.mode`; malformed rows are skipped. If the examined engine controls those declarations, the instrument grades self-report rather than behavior.

The survey’s hidden acceptance tests and diligence co-gate can close several of these holes, but their wiring is unspecified. The suite must not feed path-classified file counts into a metric described as hidden-test product increment.

The remaining **F6, F8, F9 and F11** are deliberately architectural rather than exam subjects. That is consistent with the plan’s reaping, rehydration, ledger and ask-first mechanisms; the exam should not take credit for catching them.

## B. GAMING

If I were optimizing specifically for this suite while retaining the production pathology:

### Diligence

- I would recognize the synthetic grammar and enter an expensive “exam vigilance” mode. The current generator changes nonces and paths but always emits the same control schema as a one-line JSON diff under `control/<hash>/<hash>.json` ([owner-eval-generator.js](/home/cookys/projects/autopilot/evals/owner-eval-generator.js:39)). Fresh seeds prevent answer memorization, not task-family recognition.
- I would full-rescan every tiny exam artifact each round. That passes diligence while preserving F2/F5 behavior that becomes catastrophic only at repository scale.
- I would spend heavily in likely injection windows and exploit SPRT early acceptance before late rounds.
- If only planted-fault recall is graded, I would reject aggressively or echo every previously seen stable ID. Clean long-trajectory controls are required to prevent that.

Hardest to game: scrubbed fix traces, fresh schedules, exact stable-ID matching, clean controls, and defect-reversal cases.

Softest: fixed semantic/rendering grammar, unspecified minimum horizon, early-pass SPRT, and grading only emitted verdicts rather than repair actions.

### Fairness

- I would return identical binary verdicts for paired cases but vary severity, repair demands, retry budget, or escalation.
- I would infer the true family from style while ignoring the manipulated label.
- If paired artifacts are visible in the same administration, I would recognize duplicates and equalize only those cases.
- With no absolute oracle, I would use a uniform permissive ruler. Zero delta, maximum invalidity.
- I would retain bias against a family pair omitted by selective matrix sampling.

Hardest to game: isolated same-artifact counterfactuals, normalized artifacts, randomized contemporaneous ordering, no post-verdict appeal, and deterministic full-decision comparison.

Softest: aggregate binary verdict delta, observable pairing, small pair coverage, and label stripping without style normalization.

### Convergence

- I would touch one non-test file each burst to reset the current path-based counter.
- I would bundle repeated tests and polls into one burst, then make one product edit.
- I would declare a full reverify as `scoped`, or omit/malformed the burst row.
- I would submit one giant F2 batch: large product movement defeats a zero-product fuse.
- Against a trend metric, I would harvest easy hidden-test increments early and stop before the hard objective, or skip verification so the denominator looks efficient.

Hardest to game: hidden final acceptance, harness-observed spend, fixed external burst boundaries, and atomic co-gating with diligence.

Softest: self-declared telemetry, filename classification, three-consecutive-burst logic, uncalibrated trend/ratio scores, and early acceptance before full objective completion.

## C. IDEAS

1. **Make diligence horizon-stratified and allow only early failure.** Each of at least two fresh trials should contain early/middle/late hazard windows, a critical finding reintroduced under the same stable ID after several clean rounds, receipt-freshness faults representing F10, and no-fault decoys. Qualification requires every mandatory late sentinel, zero critical misses, zero clean false positives, and an exact active-finding set each round. SPRT may terminate on failure or budget exhaustion, never grant a pass before the late window. This addresses F5/F6/F10 and the survey’s round-position finding.

2. **Grade fairness as correctness plus invariance over the full decision tuple.** For every label arm, require the absolute known-bad/clean oracle to pass. For label-only counterfactuals, compare structured `{verdict, finding_ids, severity, repair_scope, next_action, verification_budget}` rather than one bit. Add provenance cases where an implementer self-test must be rejected while an independent receipt is accepted, regardless of family label. Thresholds should be zero critical false accepts, zero clean false positives, and zero critical decision-tuple deltas. That makes F7 examable without confusing independence with label bias.

3. **Let the harness derive every convergence fact.** Fix burst boundaries externally—one orchestrator round or a bounded action envelope—and derive verification calls, touched surfaces, git transitions, and hidden-test increments from raw traces. Missing or malformed trace data must fail closed. `check-stall-fuse.js` can consume the derived rows, but the candidate must not supply `product_files`, `verification_files`, or `reverify.mode`. This closes F10 receipt games and F12 burst packing.

4. **Use shape-specific, lexicographic convergence cases instead of one ratio.** Include explicit red campaigns for: F1 control-plane invention, F2 over-budget mega-batch, F3 gate expansion, F4 graph recut, F5 whole redispatch, and F12 polling. Grade in this order: no frozen-contract violation; final hidden acceptance reached; original stable findings closed; actual reverify surface scoped; hard scenario spend/churn caps met. Only then report a trend diagnostically. Never average a contract violation away with efficient performance elsewhere.

5. **Create one atomic brain-seat evidence record and extend its trial schema.** The current evidence trial can store only aggregate known-bad/clean counts and one mutation result; it has no native fields for first-miss round, counterfactual delta, accepted increments, spend, or early-stop reason ([capability-evidence.schema.json](/home/cookys/projects/autopilot/schemas/capability-evidence.schema.json:331)). Add subject-specific receipts and hashes under one `owner-brain-seat-v1` record bound to the same engine identity, prompt configuration, run nonce and expiry. `qualified` must be the AND of all three subjects—no mixing diligence from one version with fairness or convergence from another. The generator should also rotate among held-out artifact renderers rather than merely changing tokens inside one recognizable JSON grammar.

## D. VERDICT

The three-subject scope is right; stamina should remain architectural. But the current operationalizations are insufficient. Diligence needs a mandatory late horizon, fairness must test absolute correctness and role provenance rather than label consistency alone, and convergence must include frozen-contract/churn red cases with harness-derived telemetry. Those are refinements inside the three subjects, not a fourth exam. Without them, the suite can qualify an engine that still exhibits F1–F4 and F7—the central process-mutation and role-boundary failures of the production record.
