# Baseline test failures on develop (pre-existing, NOT caused by this plan)

Verified 2026-08-16 by running each file on stashed baseline (develop 3fd980b6,
which sits on upstream 54825fb8 pulled this morning). KR1's "suite green on
every phase commit" is therefore interpreted as: **each phase's failure set
must be a subset of this baseline set** — this plan must introduce no NEW
failure and may incidentally fix baseline ones.

| Test file | Baseline result | Note |
|---|---|---|
| hooks/tests/autopilot-engine.test.sh | 429 passed, 40 failed | validateReviewLoopConfig new-field assertions; upstream readiness work in flight |
| hooks/tests/review-loop-runner.test.sh | 25 passed, 10 failed | parser schema assertions reference gpt-5.5 (pre-resign roster) |
| hooks/tests/context-window.test.sh | 51 passed, 1 failed | resolver contract field count 62 vs 63 (provider-readiness fields added upstream) |
| hooks/tests/check-claude-md-inventory.test.sh | 23 passed, 1 failed | real-repo CLAUDE.md default caps |
| hooks/tests/dev-setup.test.sh | 30 passed, 2 failed | harness/environment-dependent checks on this machine |

Already fixed in this plan's P4 (baseline red, now green):
- hooks/tests/autopilot-cli.test.sh — 2 stale constants (policy digest + claim id
  not updated by the 2026-08-14 re-signing e01992b5); updated to the live values.

P2-run note (2026-08-16): `external-lifecycle-witness.test.sh` failed once under
`run.sh --parallel` and passes standalone (53/53) — a socket-daemon timing flake
surfaced by the post-deletion parallel schedule, not a retirement regression
(the module and its keeper dependency are untouched). Watch in CI.
P2 parallel-suite fail set: {autopilot-engine, review-loop-runner, context-window}
⊆ baseline set; dev-setup and both inventory/mirror gates went green.

P3 KR2 classification note: `docs/mission-platform-capability-trigger-activation-execution-graph.json`
and `docs/mission-backlog-convergence-execution-graph.json` retain frozen references to deleted
supervised test files. They are completed-mission execution graphs — immutable records of what a
past mission ran (zero runtime readers, verified) — not current-tense claims; treated as a KR2
exclusion category alongside CHANGELOG/plans/_archive. `mission-owner-kernel-installed-sources.json`
moved into the archived project dir.
