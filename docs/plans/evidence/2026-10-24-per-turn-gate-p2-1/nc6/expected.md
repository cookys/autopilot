# NC6 live, third rerun against the final hook: expected readings (written and committed before any real call)

Hook under test: `hooks/per-turn-gate.js` of commit ae1cd09c7, git blob f4fdf20152efcb7ecb15108fefc24bf10b8dfefc (checked equal to the blob in the worktree HEAD). Same `run.sh` and `stub-verifier.js` as the earlier runs (unchanged), CLI 2.1.309, alias claude-haiku-4-5, credentials-only config dir, mktemp root outside the repo, `max_blocks` 1 in both runs. Cost cap 0.2 USD.

- Knob OFF: no block, no retry text; hook log exactly one record `{turn: null, decision: allow, reason: off, counter: 0}`; the model answers `done`.
- Knob ON: exactly two records, `turn 1, block, block, counter 1` then `turn 1, allow, cap, counter 1`; the transcript carries the retry text (STUB-RULE ... PINEAPPLE) and the model replies PINEAPPLE; the session ends; no stray lock file is left in the live directory.
- Expected equal to the earlier runs; any difference is reported as found.
