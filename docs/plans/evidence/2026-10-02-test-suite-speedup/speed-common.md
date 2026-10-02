Engine: sonnet

# Test-suite speedup — hand brief (common part; your unit is given in your prompt)

Authorized by depth-0. You are a hand: make ONE commit on your own branch. Speed only — never weaken, drop, or merge away an assertion.

## Where
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc/clone`. Never touch `/home/cookys/projects/autopilot`; never fetch/pull/push in the clone.
- Create your own worktree: `git -C $C worktree add -q $C/../st-<unit> -b speed/<unit> 1aea60d3` and work only there (1aea60d3 = current release content; it sits on a clone-local shadow commit — never touch `.claude/owner-kernel-governance.json`). Other hands work in sibling worktrees at the same time: touch ONLY your unit's files.
- Git identity in the clone is real (cookys). Never set a test identity; never `--no-verify`.

## Rules
- Every test command: `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID … < /dev/null`, foreground. Run only YOUR unit's files, one at a time. Never run the full `hooks/tests/run.sh` unfiltered.
- Assertion integrity (the gate for this work): before changing anything, run each file you will change and record its PASS/assertion count; after, the new files' counts must SUM to the same number (state both numbers in your report). Shards are discovered automatically by run.sh (`hooks/tests/*.test.sh`); new shard files must be `chmod +x` (`test -x`) and source the same helpers the original did (`lib.sh` etc.).
- Shard naming: `<original-stem>-<part>.test.sh` (e.g. `resolve-review-loop-a.test.sh`); delete the original file only when it is fully moved. Shared setup goes in a small sourced helper under `hooks/tests/lib/` if needed, not copy-pasted (copy only if the setup is < 15 lines).
- Do not change product code (`scripts/`, `src/`, `hooks/*.js`) unless your unit says so.
- If something referenced the old filename (grep `hooks/ docs/ scripts/ .github/` for the stem), update that reference in the same commit.
- `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check` must pass (run the sync without `--check` if a mirror changed).

## Commit + report
ONE commit `test(speed): <unit summary>`; final message: SHA, `git diff --stat 1aea60d3..HEAD`, assertion counts before/after per file and summed, wall seconds before/after for each changed file (time each run), rc of every command. Then `git -C $C worktree remove $C/../st-<unit>` is NOT needed — leave the worktree.
