# Plan A — the managed loop derives its own repair branch
1. RED: strict campaign, in-run repair round and disposition resume both block "caller branch disagrees with campaign stage".
2. `currentBranch` = round 1 ? branch : buildRepairBranchName(branch, round, currentBase); one owner with expectedBranch.
3. GREEN both cases; non-strict control unchanged; parity pin for generations 1..3.
4. New suite (+x); mirrors; verify; ONE commit.
Acceptance: `--resume --campaign-disposition-authority` into a repair round dispatches `<branch>-repair-r2-<sha7>` without the caller changing `--branch`.
