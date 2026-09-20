# Execution notes — four-layer redesign

## Resequencing (2026-08-16, D1)
The doc-drift gate (script-refs check) correctly rejects reference docs that name
not-yet-existing scripts — the documented-but-dead guard working as designed. The two
D1 reference docs (`four-layer-design.md`, `scaffold-tiers.md`) therefore land in D6,
AFTER every referenced mechanism exists. D1 commits the baseline artifact only.
This strengthens the plan's own anti-cathedral property: documentation cannot precede
its mechanisms on this repo.

## Live incident (2026-08-16, D5 commit): the gate bit its own builder — twice
The freshly-enabled exec-boundary hook denied this plan's own commit because the COMMIT
MESSAGE contained the prose "rm -rf / E3" (E2 matched inside a quoted argument), and then
denied the fix command because the patch text contained "sudo rm" (E4). Resolution: E2/E4
anchored to command position (start / ; / && / || / | / $( / backtick); both live cases are
now regression tests in exec-boundary.test.sh. The bypass used for the fix was the designed
config toggle (off → patch → test → on), exercising the documented escape path.
Two readings recorded honestly: (1) the gate demonstrably fires in production; (2) the
false-positive risk named in plan §6 was real and is now pinned by tests.

## Phase commits
| Phase | Commit |
|---|---|
| plan R0/R1/R2 + review chain (on develop) | 61ed7909 / 1826a4c9 / f74acb2f |
| D1-D5 mechanisms + wiring registries | ba7b782f |
| D2-D5 rail wiring + reference docs | 6fc814cb |
| exec bits + hermetic test fixes | (two chore commits) |

## Final acceptance (2026-08-17)
Full suite: 3/236 failed — exactly the recorded baseline set (autopilot-engine,
review-loop-runner, context-window); sync-all green; known flake absent. KR1-KR6 all
demonstrated with planted red cases. Additional live catches during execution, all pinned
as regression tests: exec-boundary denied its own builder's commit twice (E2/E4 prose →
command-position anchoring); the structural guard flagged the gate's own override flag;
the disabled-case test asserted machine-local dogfood config (evidence-discipline §5).
