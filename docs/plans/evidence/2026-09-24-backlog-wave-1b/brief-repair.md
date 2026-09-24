Engine: sonnet

# Repair foreman — wave-1b landing reds (5 suites red only on release/w1b)

`W=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/w1b`, `RUN=$W/run-repair` (create it).
Clone: `$W/land`, branch `release/w1b`, tip `ca39a653`, which is 10 row commits on top of `origin/develop` `8564ef2c`. The landing report is at
`$W/run-land/REPORT.md`, the gate logs are in `$W/run-land/gates/`, and a clean-base worktree is at `$W/base-wt`. You orchestrate: hands write the code, and you never
edit product or test files yourself. Stay under ~40 tool calls and combine read-only commands. Do not push. Do not touch `/home/cookys/projects/autopilot`.
Prefix every suite, rail, and git-bisect command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`. Run suites one at a time.

## Red suites (all green at 8564ef2c)
A. `hooks/tests/dispatch-author-contract.test.sh`, `hooks/tests/dispatch-contract.test.sh`, `hooks/tests/dispatch-hetero.test.sh`: VA quota for glm-5.2,
   missing `assurance` key, sealed/no-op projected-unit keys absent. Suspect: row 122 `1b2e2485` (dispatch-contract.js).
B. `hooks/tests/implementation-campaign-routing.test.sh`, `defaultCleanroomProbe`: fails with `mission_repo_identity_invalid`. Suspect: row 15 `ea81dcdb`
   (the new pre-claim `canonicalRepoIdentity` guard in campaign-intake.js rejects a fixture repo that legitimately reached the claim before).
C. `hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh`: population pins 42→43 and 6→7. Suspect: whichever row added a file to the
   counted population. The precedent `fc44b910` ("explicit-switch tripwire 5 -> 6 …") shows that a re-pin is the accepted fix when the new file is legitimate.

## Step 1 — attribute (evidence first, one Bash call per cluster)
In a throwaway worktree off `release/w1b`, run `git bisect start ca39a653 8564ef2c && git bisect run bash -c '<suite> >/dev/null 2>&1'`
for ONE representative suite per cluster (A: dispatch-contract.test.sh; B: implementation-campaign-routing.test.sh; C: the switch suite). Record the first-bad
commit for each. If the first-bad commit is not the suspect, trust the bisect.

## Step 2 — one repair hand per cluster, stacked on release/w1b
For each cluster in the order C, B, A: write `RUN/hand-<X>.md` containing the failing assertions verbatim (copy them from the gate log), the first-bad commit
and its row's intent (from `$W/run-*/REPORT.md` / `$W/brief-*.md`), and this rule: **preserve the row's intended behavior AND make the pre-existing
suite green. Change product code only when the row broke a legitimate existing contract. Change a test fixture/pin only when the row's new behavior is
correct and the fixture encoded the old defect (say which, and why, in the commit message).** For B specifically: if the fixture is a legitimate non-git or
worktree repo that must be allowed, then the guard is wrong; if the fixture is a fake path that only passed because of the defect row 15 fixes, then the fixture is wrong.
Name its Verify: the cluster's red suites + the row's own bundle suite (`hooks/tests/{managed-rail-core-engine,dispatch-lifecycle-residue-mission,…}.test.sh`)
+ `bash scripts/sync-codex-plugin-skills.sh --check`.
Dispatch (background, with a same-turn dead-man `sleep 2700; echo WAKE-repair-<X>`, then end your turn; on wake check `rc=`):
`cd $W/land && scripts/dispatch-hetero.sh --branch hands/w1b-repair/<X> --base <current release/w1b tip> --ledger RUN/hands.ledger --run-id w1b-repair-<X> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<X>.md`
Mission enforcement: `$W/land` is at real origin/develop governance (`enforce`), so a raw dispatch will be refused. Add one clone-local commit on a SEPARATE
branch `w1b-shadow` = release/w1b + "PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode shadow (never land)" (the same one-line
`.claude/owner-kernel-governance.json` flip as in `$W/dlrm` commit `d3ff6b67`, which is the documented recipe in
`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`), and use `w1b-shadow`'s tip as the hand's `--base`. Then cherry-pick ONLY the hand's commit
onto `release/w1b` (never the shadow commit) and rebuild `w1b-shadow` on top before the next cluster. After each pick,
`git show release/w1b:.claude/owner-kernel-governance.json | grep enforcement_mode` must still say `enforce`.
Review each hand diff: `scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <diff> --spec-file RUN/hand-<X>.md`
(if you get no verdict, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec). At most one repair round per cluster.

## Step 3 — re-gate
On the final `release/w1b` tip, rerun ALL 5 previously red suites plus the 4 bundle suites, solo, one at a time. Every one must be green.

## Report
`RUN/REPORT.md`: the bisect result per cluster, each hand's commit and the SHA it landed as on release/w1b, the review verdict, the re-gate rc table, and the final release/w1b tip.
Final message: the REPORT path, the final tip, and a per-cluster line `FIXED <X> <sha>` / `FAIL <X> <why>`.
