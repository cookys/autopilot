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
