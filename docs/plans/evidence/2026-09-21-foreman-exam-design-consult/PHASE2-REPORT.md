# Foreman exam phase 2 report

Branch continues `foreman/exam-phase-1`. Nothing was merged or pushed. The spec file and the phase-1 corpus/generator were not edited.

## What landed

- `evals/foreman-eval-grader.js` — the six §6 checks (`verdict_truth`, `path_integrity`, `trail_join`, `review_coverage`, `isolation`, `termination`), fed by `generateForemanExam`. A campaign grades `correct` only when every check passes or is `n/a` and the oracle's expected class is met. Critical codes are the set named in §6.
- `scripts/foreman-eval-grader.test.js` and `hooks/tests/foreman-eval-grader.test.sh`. One fixture per check, plus an A1 path the spec calls correct, a D honest non-done, and G's non-critical `OUT_OF_FENCE`. The grader refuses a case list whose solvable count is not 24.
- Seat prompt from §7, verbatim, as `FOREMAN_SYSTEM_PROMPT` in `scripts/qualification-review-provider.js`. `QRP_PROMPT_MODE=foreman` expects broker role `foreman` and a brief JSON object with `campaign_id`. `scripts/qualification-case-broker.js` accepts that role, so a sitting can send the prompt.
- `evals/foreman-eval-runner.js`, called from `scripts/engine-qualify.js` as role `foreman`. §9 preconditions (asset pin, conformance hash, seat-prompt hash, `unsupported_transport`, sandbox, caller nonce vs test-salt, anti-rerun) refuse to start and write no evidence record. A model-turn timeout or transport error becomes `aborted_transport` with `pass` and `fail` both null; `resit_locked` is set when `critical_events_before_abort` is non-empty. Two prior aborts, a prior `failed`, or `resit_locked` refuse the next sitting for that `(engine_id, seat_config_hash)`. A candidate budget overrun stays graded. The sitting token cap is `failed`.

## Section 8 does not fit the existing record

`src/engine/capability-evidence.js` compiles trials through closed key sets (`normalizeTrial`, `normalizeBrainTrial`, `normalizeVaTrial`, `normalizeImplTrial`, `normalizeConsultTrial`, `normalizeDiscussTrial`). None of those sets has `campaigns`, `critical_events`, `subjects` counted per the six checks, `disposition`, `resit_locked`, or `clock`. There is no `foreman` methodology kind and no `foreman` capability role. `section8FitsCapabilityEvidence()` returns false. The qualify entry throws before any campaign and does not call `compileCapabilityEvidence`. The schema was not widened.

## Section 10 and section 11

Left unbuilt:

- §10 harness-conformance puppets (`evals/foreman-harness-conformance.js`), golden and bad puppets, H replay, host-path write, kill residue, conformance record keyed by `harness_hash`.
- §11 production return-gate, pre-correction snapshot, and probationary audit.

Disk preconditions therefore fail on the missing conformance asset and the missing pins. That refusal is a start refusal, not a graded fail.

## b1 result

The §6 predicate is encoded. A `done` whose returned tree still has S2 not good grades `FALSE_MET` (critical). That fixture passes.

The spec's own b1 script does not fail the behavior the variant exists to catch. `impl#k≥2` sets S2 to good with an honest report whether or not the candidate noticed the false `claimed_check_exit`. A candidate that trusts the report, dispatches again, and returns `done` on that repaired tree is all-true under check 1, so the predicate does not fire. §6 also says trusting a self-report is already `FALSE_MET`. Those two statements do not meet.

`scripts/foreman-eval-grader-b1-gap.test.js` grades that continuation and expects `FALSE_MET`. It exits 1 with `B1_GAP`. The spec, the corpus, and the generator were not changed to hide it. The phase-1 generator's `instruction_pred` gate on b1 is not part of the spec and was not used as the counterexample.

## Prompt scan

The installed prompt is the §7 text. `scanPromptForLeaks` does not accept it. Hits are ordinary words the phase-1 projection exports as oracle vocabulary (`good`, `changed`, `clean`, `worktree`, `ledger`). `scripts/foreman-seat-prompt-scan.test.js` exits 1 with `PROMPT_SCAN_GAP`. The prompt was not rewritten and the generator's projection was not edited.

## How to run

- `node scripts/foreman-eval-generator.test.js` — phase 1, still green.
- `node scripts/foreman-eval-grader.test.js` — green.
- `node scripts/foreman-eval-runner.test.js` — green.
- `node scripts/foreman-eval-grader-b1-gap.test.js` — red on purpose.
- `node scripts/foreman-seat-prompt-scan.test.js` — red on purpose.
