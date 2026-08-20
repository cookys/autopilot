# Survey: standing qualification exams for LLM orchestrator agents (brain seat 三科)

> Date: 2026-08-17
> Method: dual-agent (researcher + skeptic), independent parallel WebSearch; merged + cross-validated here.
> Consumer: brain-seat exam suite (勤勞×公平×收斂), extending the shipped engine-qualify
> framework (reviewer known-bad/clean-v2, owner intent-control-metamorphic-v1) for the
> canonical `owner` role; evidence consumed by the P7/KR6 first-use qualification rail.

## Background

v2.34.13 shipped the brain's architectural gates (freeze/rehydrate/ledger/fuse); the standing
exam for the seat itself is the committed follow-up. Board ruling (binding): the seat is
qualified on diligence/fairness/stamina — stamina architecturally, so the examable subjects
are 勤勞 (long-sequence regression vigilance), 公平 (cross-family same-ruler judging),
收斂 (product increment per verification spend).

**Adoption-gap headline**: strong industry precedent exists for model-level safety
qualification gates (METR / UK AISI Inspect / Apollo) and for coding-agent benchmarks, but
**no documented case of a standing qualification exam for the orchestrator/brain role in a
dev-lifecycle loop was found**. This suite is ahead of documented practice; validity claims
must stay modest and the design leans on transferable instruments, not a copyable precedent.

## Options Comparison

| # | Option | Pros | Risks (skeptic-verified) | Subjects | Fit |
|---|--------|------|--------------------------|----------|-----|
| 1 | **Injected-regression trajectory replay** — seed a long simulated dispatch→adjudicate sequence with defects at known rounds; script-check whether the orchestrator's verdicts flag them; record round-of-first-miss | Deterministic grading; extends the shipped spiked-diff pattern in time; task is non-saturated (best failure-attribution method: 53.5% agent / 14.2% step accuracy) | "Round of miss" ill-defined under trajectory non-determinism (single trial confounded); round-position effects — injection schedule shapes the result (EvoCode-Bench: round-2 regression peak, solvability 15%→80% by round 12); environment leakage lets agents *discover* the fix instead of detecting the bug (SWE-bench-Pro git-history leak: −6.87pp once pruned); shallow "detected" criteria overcount (STING: −4.2~9.0pp under mutation audit) | 勤勞 (primary), 收斂 (spend at miss round) | 3/3 with mitigations: pinned-but-varied injection schedules per trial, scrubbed env (no fix traces reachable), stable finding-ID exact-match grading |
| 2 | **Blinded / counterbalanced adjudication trials** — same work product judged under family-label attached / stripped / swapped; script-diff the verdict deltas | Label-induced bias is the dominant effect (labels alone shift scores up to 50pp and reverse rankings); delta grading is deterministic; no second LLM judge needed | Swap-averaging removes only 60–80% of position bias (20–40% residual); 22–30% verdict flips on order reversal; day-to-day judge drift exists with zero manipulation; consistency-bias paradox — tuning for rerun-stability selects for consistently-wrong | 公平 (primary) | 3/3 — as *measurement* of the seat's bias (not as correction), blinding/counterbalancing is the instrument itself; residuals argue for label-stripped operation as the qualified mode |
| 3 | **Cross-family grading matrix** — every implementer-family × judge-family pairing incl. self-review, identical task set, compare pass-rate deltas | Directional asymmetry is real and large in agentic coding (Claude→Codex +18.1pp vs Codex→Claude −8.6pp; self-review +12.9pp for one family, flat for another); grading via hidden tests | Full matrix cost scales quadratically; G-theory: agent main effect <3% of variance vs agent×task interaction 7–23% — a small fixed task pool ranks task-sampling luck, not the agent | 公平 (secondary), 收斂 (cost per path) | 2/3 — mine asymmetric *pairs* selectively inside Option 2's trials; full matrix not budget-viable |
| 4 | **Mutation-score + SPRT sequential stopping** — three-valued (pass/fail/inconclusive) statistical test, stop early once evidence accumulates; headline = fraction of injected faults caught | 78% trial/cost reduction vs fixed-N; behavioral-fingerprint scoring caught 86% of injected regressions vs 0% for naive binary at same budget; demonstrably affordable ($227 / 7,605 trials) | Sequential designs still can't resolve fine-grained decay curves at exam budgets; fingerprint-style stall/loop detectors defeated by trivial argument perturbation (design risk, not documented incident) | 收斂 (budget instrument), 勤勞 (support) | 3/3 as the *budget governor* for subjects 1 and 3 |
| 5 | **Budget-normalized progress (expenditure-horizon style)** — continuous progress-per-dollar against a baseline curve | Directly exposes the named failure (agents spent 70–90% of budget on validation, not the objective); continuous score = more power per trial | Needs a human/incumbent baseline (nontrivial); ratio gameable in the denominator — verify-less looks efficient; real ranking inversions documented (5× retry multiplier $5.73→$28.65; lower-pass-rate model "won" cost-efficiency 7/12 families by failing fast) | 收斂 (primary) | 2/3 — adopt the *shape* (trend/derivative over rounds) without the human-baseline requirement |
| 6 | **pass^k repeated-trial consistency** | Cheap, purely mechanical; exposes average-vs-reliable gap (90% pass@1 → ~57% pass^8) | Trials on the same task are correlated, not independent draws — reliability falls below naive p^k; distinguishing 1% vs 3% miss rates needs hundreds of trials | support only | 1/3 — use as a coarse repeat-trial rule (≥2 fresh trials, as the shipped exams already do), not a subject |
| 7 | **Per-turn mechanical gate + bounded retry** *(prior bias — demoted)* | Fully deterministic; precedented (silent-policy-violation recovery; runaway-loop halts); cheap | Measures *harness* compliance, not the seat's judgment vigilance — near-orthogonal to 勤勞; schema-only by its own paper's admission; gameable under optimization pressure (every frontier model attempted eval-cheating, 7.8–14.1% rates); "deterministic gates may degrade over longer action sequences" — verbatim from the supporting paper | harness stop-condition only | 1/3 as a 勤勞 instrument; already shipped in its correct role as `check-stall-fuse.js` |

## Cross-cutting findings (bind the whole suite)

1. **Contamination/decay is a lifecycle property**: frozen public task pools retire (MMLU/HumanEval class); none of 20 tested mitigation strategies both resisted contamination and preserved the construct. The shipped seed-derived metamorphic generation (owner-eval pattern, nonce-derived corpora) is the correct countermeasure — fresh scenarios per administration, generator pinned by hash. The suite must plan corpus rotation from day one.
2. **Don't tune the exam for its own rerun-stability**: G-theory audit found training-cell reliability *negatively* correlated with held-out reliability (r = −0.90). Size trial counts from a pilot variance decomposition (D-study) if contested; otherwise accept the shipped pattern's gross pass/fail resolution and never claim fine ranking.
3. **Ratio metrics need a paired integrity check**: a convergence score is only trustworthy alongside a diligence/mutation-score cross-check — otherwise "efficient" and "negligent" are indistinguishable (reward-hacking exploit rates hit 13.9%; RL post-training raises them 0.6%→13.9%). Convergence and 勤勞 must be co-gated: passing one while failing the other is a fail.
4. **Grading channel is an attack surface**: judges hold steady under neutral rerun but flip under motivated post-decision challenge. The exam must have **no post-verdict interaction** — deterministic script grades, no appeal round for the seat under test.
5. **Outcome-only grading hides process violations** (35% procedural compliance behind 98% task success): grade the *trajectory* (ledger entries, burst declarations, verdict rows) not just the end state — the v2.34.13 decision-ledger/burst schemas are exactly the trace surface to grade.
6. **"A gate existing is not evidence it fires"** independently re-confirmed in the wild (mandatory approval gate silently bypassed via an orthogonal permission path) — the exam suite itself needs a red case proving the P7 rail refuses an unexamined seat (already the KR6 red-case pattern).

## Alternatives noted (not selected, backlog-grade)

- **Shadow/production qualification**: run the candidate seat in parallel on live campaigns, compare against incumbent offline. Sidesteps contamination entirely; loses the bounded-budget property; per Board ruling 3, onboarding exams are the only sanctioned verifier-checking — a live-shadow extension is a separate governance question. Graduation-gate complement, not a replacement.
- **Statistical audit sampling of live transcripts** (Cochran-sized, risk-weighted): converts standing exams into continuous audits; same governance question; the decision-ledger already produces the auditable trace. Candidate future BACKLOG entry once ledger volume exists.
- **G-theory D-study trial sizing**: adopt only if trial counts are contested; pilot-variance decomposition answers "is N enough" with a number.

## Recommendation (suggestion — decision is the user's)

Build the suite as **three co-gated subjects on the shipped engine-qualify chassis**
(seed-derived metamorphic corpora, pinned generator hashes, case broker, ≥2 fresh trials,
evidence rows into engine-capability-state for the `owner` role; consumed by the P7 rail):

- **勤勞** = Option 1 (injected-regression trajectory replay) + Option 4's mutation-score
  support. Mitigations are mandatory scope: schedule variation across trials, scrubbed
  environment, stable finding-ID exact-match grading. NOT per-turn mechanical gates.
- **公平** = Option 2 (blinded/counterbalanced adjudication deltas), mining Option 3's
  directional pairs where the roster makes them cheap. Acceptance = max verdict delta under
  label manipulation within threshold; label-stripped operation is the qualified mode.
- **收斂** = simulated bounded campaign graded on the *trend* of verification-spend vs
  product-increment (burst accounting via the shipped `check-stall-fuse.js` classifier),
  with hidden acceptance tests defining "product increment" (never LOC/commits), SPRT-style
  early stop as budget governor, and a scope-diff check separating re-architecture from
  thrash. Co-gated with 勤勞 (integrity pairing, finding 3).

Preconditions: exam runs against real endpoints via the existing qualification-review-provider
rails; budget bounded per subject; no post-verdict appeal channel; corpus rotation policy
written into the generator from v1.

## Sources

**Theory/Standards**
- [METR — Measuring AI Ability to Complete Long Software Tasks](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/) — time-horizon methodology for long tasks.
- [METR — Expenditure Horizon](https://metr.substack.com/p/2026-07-21-expenditure-horizon) — agents spent 70–90% of budget on validation, not the objective.
- [τ-bench (arXiv 2406.12045)](https://arxiv.org/pdf/2406.12045) — pass^k decay; 90% pass@1 → ~57% pass^8.
- [Self-Preference Bias in LLM-as-a-Judge (arXiv 2410.21819)](https://arxiv.org/abs/2410.21819) — self-preference measurement.
- [Quantifying Label-Induced Bias (arXiv 2508.21164)](https://arxiv.org/pdf/2508.21164) — labels alone shift scores up to 50pp and reverse rankings.
- [Goodhart's Law in RL (arXiv 2310.09144)](https://arxiv.org/pdf/2310.09144) — no fixed proxy checker is unhackable.
- [Deployment Decision Reliability — G-theory framework (arXiv 2608.11323)](https://arxiv.org/html/2608.11323) — agent effect <3% variance; r=−0.90 train/held-out inversion.
- [Stability vs. Manipulability (arXiv 2606.05384)](https://arxiv.org/abs/2606.05384) — judges reverse under motivated post-decision challenge.
- [Reliability without Validity (arXiv 2606.19544)](https://arxiv.org/html/2606.19544v1) — consistency-bias paradox.
- [Reason Less, Verify More (arXiv 2607.07405)](https://arxiv.org/pdf/2607.07405) — per-turn gate precedent AND its self-admitted schema-only/long-sequence limits.
- [Endsley — Out-of-the-Loop Performance Problem](https://www.researchgate.net/profile/Mica-Endsley/publication/238726310_The_Out-of-the-Loop_Performance_Problem_and_Level_of_Control_in_Automation/links/56426ab008aebaaea1f8e7a9/The-Out-of-the-Loop-Performance-Problem-and-Level-of-Control-in-Automation.pdf) — vigilance-decrement human-factors anchor.

**Production Practice**
- [UK AISI — Early lessons from evaluating frontier AI systems](https://www.aisi.gov.uk/blog/early-lessons-from-evaluating-frontier-ai-systems) — standing safety-qualification practice.
- [Every frontier model tried to cheat on evals (decoder / UK AISI)](https://the-decoder.com/every-frontier-ai-model-tested-by-britains-safety-institute-tried-to-cheat-on-cybersecurity-evaluations/) — 7.8–14.1% eval-cheating attempt rates.
- [Arize — LLM-as-a-Judge evaluators that hold up in production](https://arize.com/blog/how-to-build-llm-as-a-judge-evaluators-that-hold-up-in-production/) — judge calibration playbook.
- [Engineering Reliable Coding Agent Loops (SPOQ)](https://levelup.gitconnected.com/engineering-reliable-coding-agent-loops-control-flow-verification-retries-and-stop-conditions-f002d2dc168c) — runaway-loop halt precedent (100+ identical `npm install`).
- [Adaline — judge rerun instability](https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias) — 77%→63% day-to-day drift, no manipulation.
- [AI coding agent incidents (adversa.ai / VentureBeat)](https://adversa.ai/blog/ai-coding-agent-incidents/) — mandatory gate silently bypassed via inherited permissions.

**Benchmark / Demo**
- [AgentAssay (arXiv 2603.02601)](https://arxiv.org/html/2603.02601v1) — SPRT early stop: −78% trials; 86% injected-regression catch vs 0% naive; $227 / 7,605 trials.
- [Cross-Model LLM Code Review (arXiv 2607.21656)](https://arxiv.org/html/2607.21656v1) — Claude→Codex +18.1pp vs Codex→Claude −8.6pp asymmetry.
- [Who&When failure attribution](https://ag2ai.github.io/Agents_Failure_Attribution/) — 53.5% agent / 14.2% step accuracy ceiling.
- [EvoCode-Bench (arXiv 2605.24110)](https://arxiv.org/pdf/2605.24110) — round-2 regression peak; round-depth solvability curve.
- [SlopCodeBench (arXiv 2603.24755)](https://arxiv.org/html/2603.24755v1) — structural decay invisible to pass-rate metrics.
- [SpecBench (arXiv 2605.21384)](https://arxiv.org/html/2605.21384v1) — 2,900-line lookup-table exploit: 97% validation / 0% held-out.
- [Reward Hacking Benchmark (arXiv 2605.02964)](https://arxiv.org/abs/2605.02964) — exploit rates 0→13.9%, RL post-training correlated.
- [STING mutation audit of SWE-bench Verified (arXiv 2604.01518)](https://arxiv.org/html/2604.01518) — accepted-but-wrong patches; −4.2~9.0pp under mutation checks.
- [SWE-bench_Pro-os #93](https://github.com/scaleapi/SWE-bench_Pro-os/issues/93) — git-history leak; −6.87pp once pruned.
- [position_bias benchmark](https://github.com/lechmazur/position_bias) — 22–30% verdict flips on order reversal.
- [Holistic Agent Leaderboard (arXiv 2510.11977)](https://arxiv.org/abs/2510.11977) — $40K k=1 vs ~$320K credible k=8: budget-power tradeoff is structural.
- [MAC-Bench (arXiv 2606.07805)](https://arxiv.org/html/2606.07805v1) — 35% procedural compliance behind 98% success; SERV fresh-scenario generation.

**Adoption Cases**
- [Inspect AI framework (UK AISI)](https://github.com/UKGovernmentBEIS/inspect_ai) — cross-lab standing eval infrastructure (Anthropic, DeepMind, xAI, US AISI).
- [Anthropic RSP v3.0](https://www.anthropic.com/responsible-scaling-policy/rsp-v3-0) — model-level standing qualification gates.
- [Vending-Bench / Project Vend](https://maxpool.dev/research-papers/vending_bench_report.html) — long-run behavioral testing of autonomous agents (closest orchestrator-adjacent case).
- **No adoption case found for orchestrator-role standing qualification gates** — the gap itself is a finding.

**Risk/Failure Cases**
- [Cost per successful task (Arize)](https://arize.com/blog/cost-per-successful-task-ai-model-benchmark) — ratio ranking inversions; failing fast looks efficient.
- [Rubric Dropout (arXiv 2608.11669)](https://arxiv.org/abs/2608.11669) — gold-judge score −22 while training judge climbs (rubric hacking).
- [What Is a Contaminated LLM (llm-stats)](https://llm-stats.com/blog/research/what-is-a-contaminated-llm) — benchmark retirement; 20 mitigations, none sufficient.
- [Choosing k for pass^k](https://www.agentreliability.dev/k/choosing-k-for-pass-hat-k) — correlated trials; hundreds needed for fine distinctions.
- [Toloka — LLM QA audit sampling](https://toloka.ai/blog/llm-qa-scaling-data-quality-assurance-technologically/) — Cochran-sized risk-weighted audit alternative.
- [Shadow deployment pattern](https://aidolsgroup.com/en/glossary/shadow-deployment/) — production-shadow qualification alternative.
