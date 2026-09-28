Engine: sonnet

# Repair foreman — {{BUNDLE_NAME}} landing reds ({{RED_SUITE_COUNT}} suites red only on {{RELEASE_BRANCH}})

`W={{SCRATCH}}`, `RUN=$W/run-repair` (create it).
Clone: `$W/land`, branch `{{RELEASE_BRANCH}}`, tip `{{RELEASE_TIP_SHA}}`, which is {{ROW_COUNT}} row commits on top of `origin/develop` `{{BASE_SHA}}`. The landing report is at
`$W/run-land/REPORT.md`, the gate logs are in `$W/run-land/gates/`, and a clean-base worktree is at `$W/base-wt`. You orchestrate: hands write the code, and you never
edit product or test files yourself. Stay under ~40 tool calls and combine read-only commands. Do not push. Do not touch `{{REPO}}`.
Prefix every suite, rail, and git-bisect command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`. Run suites one at a time.

## Red suites (all green at {{BASE_SHA}})
List each red suite in its own cluster, with the suspect row and why:
{{RED_CLUSTERS}}

## Step 1 — attribute (evidence first, one Bash call per cluster)
In a throwaway worktree off `{{RELEASE_BRANCH}}`, run `git bisect start {{RELEASE_TIP_SHA}} {{BASE_SHA}} && git bisect run bash -c '<suite> >/dev/null 2>&1'`
for ONE representative suite per cluster. Record the first-bad commit for each. If the first-bad commit is not the suspect, trust the bisect.

## Step 2 — one repair hand per cluster, stacked on {{RELEASE_BRANCH}}
For each cluster, write `RUN/hand-<X>.md` containing the failing assertions verbatim (copy them from the gate log), the first-bad commit
and its row's intent (from `$W/run-*/REPORT.md` / the implement brief), and this rule: **preserve the row's intended behavior AND make the pre-existing
suite green. Change product code only when the row broke a legitimate existing contract. Change a test fixture/pin only when the row's new behavior is
correct and the fixture encoded the old defect (say which, and why, in the commit message).**
Name its Verify: the cluster's red suites + the row's own bundle suite + `bash scripts/sync-codex-plugin-skills.sh --check`.
Dispatch (background, with a same-turn dead-man `sleep 2700; echo WAKE-repair-<X>`, then end your turn; on wake check `rc=`):
`cd $W/land && scripts/dispatch-hetero.sh --branch hands/{{TAG}}-repair/<X> --base <current {{RELEASE_BRANCH}} tip> --ledger RUN/hands.ledger --run-id {{TAG}}-repair-<X> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<X>.md`
Mission enforcement: `$W/land` is at real origin/develop governance (`enforce`), so a raw dispatch will be refused. Add one clone-local commit on a SEPARATE
branch `{{TAG}}-shadow` = `{{RELEASE_BRANCH}}` + "PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode shadow (never land)" (the same one-line
`.claude/owner-kernel-governance.json` flip as the documented recipe in `docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`), and use `{{TAG}}-shadow`'s tip as the hand's `--base`. Then cherry-pick ONLY the hand's commit
onto `{{RELEASE_BRANCH}}` (never the shadow commit) and rebuild `{{TAG}}-shadow` on top before the next cluster. After each pick,
`git show {{RELEASE_BRANCH}}:.claude/owner-kernel-governance.json | grep enforcement_mode` must still say `enforce`.
Review each hand diff: `scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <diff> --spec-file RUN/hand-<X>.md`
(if you get no verdict, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec). At most one repair round per cluster.

## Step 3 — re-gate
On the final `{{RELEASE_BRANCH}}` tip, rerun ALL previously red suites plus the bundle suites, solo, one at a time. Every one must be green.

## Report
`RUN/REPORT.md`: the bisect result per cluster, each hand's commit and the SHA it landed as on `{{RELEASE_BRANCH}}`, the review verdict, the re-gate rc table, and the final `{{RELEASE_BRANCH}}` tip.
Final message: the REPORT path, the final tip, and a per-cluster line `FIXED <X> <sha>` / `FAIL <X> <why>`.
