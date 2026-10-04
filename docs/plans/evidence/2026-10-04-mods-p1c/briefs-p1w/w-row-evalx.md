Engine: sonnet

# Row EVALX — eval harness extensions E1–E5 for the P1W guidance rows (spend-free: NO live eval cells). Worktree wt-evalx, base develop 4641b5d7. Read w-common.md first.

Design (binding, read fully): /home/cookys/projects/autopilot/docs/plans/evidence/2026-10-04-mods-p1c/eval-design-guidance-rows.md §1 E1–E5 and §2 (pre-registration). Owner ruling 2026-10-04: eval only W2a-g (decision file at the DOA boundary, ceo-agent), W2b-g (dev-flow `session-mode.js set --phase`), W1b trigger 2 (finish-flow post-merge `write-task-status-input.js`). W2g / W2c / W2e-g are reclassified as mechanism and are OUT of scope here; E6/E7 are out of scope.

Build in `evals/skill-onoff/` (and its runner/scorer scripts):
- E1 generic arms `--arm base|change`, `--skill <name>`, `--pack-base/--pack-change` dirs, digest-verified manifest keys; keep the existing dev-flow `full|card|off` arms working byte-identically (regression test).
- E2 packs: live freezes for `ceo-agent` (SKILL.md + references) and `finish-flow`; refresh dev-flow live freeze as a NEW pack id (do not mutate the historical one).
- E3 fixture scripts: copy a frozen subset of `scripts/` (+ their lib deps) into the fixture repo for both arms; list it in the manifest with digests. The helpers under test that do not exist yet on develop (decision/1 helper, `session-mode.js --phase`, `write-task-status-input.js`) must be pluggable: the fixture takes them from a pack-provided dir so the eval can run once the rows land; until then a stub is used only by the spend-free tests.
- E4 isolation: per-cell `AUTOPILOT_LIVE_DIR`, `AUTOPILOT_TASK_STATUS_DIR`, ledger location under the cell temp; a test proves the real `/run/user/1000/autopilot` and `~/.autopilot` are untouched (inode/mtime diff).
- E5 manipulation check: `skill_invoked` for the target skill (transcript-query.js), replacing the dev-flow-only check behind a flag.
- Markers for the three rows (mechanical, no LLM judging): decision/1 file present+schema-valid when the fixture task hits the DOA boundary; `--phase` calls at each L step in order; task-status input written after merge. Each marker gets a three-way probe test (true / false / planted-red) modelled on `hooks/tests/skill-onoff-markers.test.sh`.
- Pre-registration file per row (thresholds ON ≥ 8/10, OFF ≤ 2/10, survivor STOP, V1/V2) written and frozen (digest recorded) — do not change thresholds.
Tests: spend-free stub tests for every extension (`hooks/tests/skill-onoff-*.test.sh` style), plus the existing skill-onoff and orchestration-eval suites green. Never invoke a live model.
ONE commit: `feat(evals): skill-onoff harness takes any skill, live packs, fixture scripts and per-cell isolation (mods P1W EVALX)`. Report at $P/run-w/evalx/REPORT.md including the exact command line to run each row's batch once its helper lands, and the measured spend-free test runtime.
