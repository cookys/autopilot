# NC6 live, rerun against the final hook: expected readings (written and committed before any real call)

Hook under test: `hooks/per-turn-gate.js` of commit 8c725cde4, git blob c0d9380efb3d0fcfdddf09d5bfc5aa849d5be9ac (checked equal to the blob in the worktree HEAD). Same `run.sh` and `stub-verifier.js` as the superseded run (unchanged), CLI 2.1.309, alias claude-haiku-4-5, credentials-only config dir, mktemp root outside the repo, `max_blocks` 1 in both runs. Cost cap 0.2 USD.

- Knob OFF: no block, no retry text; hook log exactly one record `{turn: null, decision: allow, reason: off, counter: 0}`; the model answers `done`.
- Knob ON: exactly two records, `turn 1, block, block, counter 1` then `turn 1, allow, cap, counter 1`; the transcript carries the retry text (STUB-RULE ... PINEAPPLE) and the model replies PINEAPPLE; the session ends. Zero blocks for OFF and one for ON is the red-then-green contrast.
- Expected unchanged from the superseded run; any difference (extra record, lock file side effect visible in the log, a second block) is reported as found.
