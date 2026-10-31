# Top-level leftovers for relayout P phases (BL-0351)

Readers found with `git grep -n` on 2026-10-31.

## skill-creator-workspace/ (89 tracked files)
- Readers: scripts/run-eval-batch.sh (evals/ and results/ paths), scripts/run-skill-opt.sh, scripts/affected-suites.js (treated as pure-doc and non-propagating), scripts/check-stage-vocab.js (excluded prefix), scripts/lib/repo-layout.js (registry entry and exclude), hooks/tests/check-stage-vocab.test.sh, fleet-child-contract.test.sh, paid-batch-auth-stop.test.sh; old plans and a dogfood packet MANIFEST name it.
- Risk: moving breaks the eval batch runner paths and the layout registry; deleting loses the May 2026 baseline skill-eval definitions. .gitignore also names a results subdirectory.

## .qc/ (5 tracked verdict files)
- Readers: .githooks/pre-push (QC evidence), scripts/lib/qc-evidence.sh, scripts/check-test-integrity.sh, scripts/lib/test-integrity-l1.py, and the qc-gate, check-test-integrity and review-packet suites.
- Risk: pre-push accepts `.qc/<sha>.verdict.json` as push evidence; moving or deleting it without changing those readers blocks or silently unblocks pushes.

## .autopilot/evidence/ (grok-implementer-ab.json, hook-multiplexer-benchmark.json)
- Readers: scripts/next-touch-validation.js (D8 and D6 report paths), scripts/run-grok-implementer-ab.sh, docs/mission-next-touch-debt-retirement-execution-graph.json and its fixtures (digest pinned), several plans.
- Risk: the Mission graph is digest-pinned, so moving the files breaks validation and the pin; deleting makes next-touch validation fail.
