Engine: cursor-grok-4.6-low

# Hand brief trwc-4

Plan: docs/plans/2026-10-02-test-suite-repo-write-containment.md (frozen). You implement exactly one row.

## Global Constraints (verbatim from plan section 2.5)

- G1: One canonical test-identity rule, in `scripts/lib/test-identity.sh`, sourced by run.sh, pre-commit, pre-merge-commit and pre-push. No second copy of the pattern anywhere.
- G2: The rule matches on EMAIL only: domain is `example`, `example.com|org|net`, or ends in `.invalid`, `.test`, `.example`, `.local`, `.localhost` (RFC 2606/6761 reserved), or the domain has no dot (e.g. `t@t`), or the email is empty. Names are never matched.
- G3: Snapshot is the default for a full `run.sh` and opt-out with `AUTOPILOT_TEST_SNAPSHOT=0` (one stderr line starting `test-snapshot: disabled`). The outer run.sh runs `$SNAP/repo/hooks/tests/run.sh` with the original argv as a waited CHILD in its own process group — NEVER `exec` — with cwd `$SNAP/repo`, `PWD`/`OLDPWD` unset, with `AUTOPILOT_TEST_SNAPSHOT_ROOT=$SNAP` set; that variable makes the inner run skip snapshotting, G6 and G7. The outer exit code is the inner one unless G6 fails.
- G4: Snapshot construction, in order: `git clone --quiet --no-hardlinks --no-checkout "$REAL_ROOT" "$SNAP/repo"` (NEVER `--shared`, NEVER `git worktree add`); `git -C "$SNAP/repo" checkout --quiet -B <real current branch, or detached if none> <real HEAD sha>`; then `rsync -a --delete --exclude .git` (every nested `.git` file or dir, e.g. `.claude/worktrees/*/.git`, never only the top one) of the real working tree onto it — a real copy (NEVER `cp -al`, `--link-dest`, or any hardlink), and because it runs after checkout it carries unstaged edits, untracked and ignored files; then `git -C "$SNAP/repo" remote set-url origin /nonexistent/autopilot-test-snapshot-origin`. Construction fails closed (non-zero, no in-place fallback) if `$SNAP/repo/.git/objects/info/alternates` exists or any symlink under `$SNAP/repo` resolves into `$REAL_ROOT`. Named divergences from an in-place run: staged-only index state; only the current branch, remote-tracking heads and tags exist (no other local branches, no `refs/autopilot/*`); the local config is the fresh clone's. §0.1 found zero reds from these.
- G5: `$SNAP` = `${TMPDIR:-/tmp}/autopilot-test-snapshot.XXXXXX`, a container holding `.autopilot-live.lock` and `repo/` (the clone target, absent until G4). The outer run creates the lock and holds `flock` on it before G4 and for its whole life. `suite-residue-reap.sh` (same TMPDIR) treats a container as residue only when that lock is free, fail-closed when the lock file is missing; when it reclaims one, it prunes worktrees registered in `repo/.git/worktrees` from inside `repo/` first, then removes the container. Outer shutdown on EXIT/INT/TERM, idempotent: TERM the child's process group, wait until the group is gone, reap `repo/`'s worktrees from inside it, remove `$SNAP`, exit with the child's status (or 128+signal). The real root lives in a non-exported outer variable; nothing in the inner run can read it.
- G6: The config drift guard runs only in the OUTER process against the REAL repo: `git -C "$REAL_ROOT" config --local --list` before starting the child and after it returns, ignoring keys matching `^(branch|remote)\.`; on drift it restores the before-values (unsetting keys that were absent), prints the key name only, and fails the suite. The same before/after pair of `for-each-ref`, `worktree list --porcelain` and `status --porcelain` only WARNS (§1). With the snapshot disabled the guard wraps the in-place run.
- G7: The polluted-baseline check (KR3) runs first in the outer process only, prints the two `git config --local --unset` fix commands, and exits non-zero. It never edits the config itself.
- G8: Hooks stay fail-open on internal error (missing lib ⇒ allow), except the identity verdict itself. pre-commit/pre-merge-commit judge `git var GIT_AUTHOR_IDENT` and `GIT_COMMITTER_IDENT` (what git will write); pre-push judges author and committer of `git rev-list <remote_sha>..<local_sha>` (a new ref: `<local_sha> --not --remotes=<pushed remote name, argv $1>`), so only history already on THAT remote is excluded. The only bypass is `autopilot.testIdentityGate=off` read with `git config --file "$(git rev-parse --git-path config)"` (no env overlays), honoured only when the target's common dir is under `${TMPDIR:-/tmp}`; there is no env-var bypass.
- G9: `hooks/tests/lib.sh` exports `GIT_CEILING_DIRECTORIES` including `${TMPDIR:-/tmp}` and `/tmp`, so a scratch dir without its own `.git` never discovers a repo above it.
- G10: Bash ≥ 4; `rsync` is required for snapshot mode (absent ⇒ the G3 line with reason `rsync missing` and an in-place run). No version/CHANGELOG/plugin.json edits in implementation commits; landing owns release.
- G11: Existing suites change only to (a) source `lib.sh`, (b) move a real-repo write into a scratch dir, (c) set `autopilot.testIdentityGate=off` in their own fixture repo per G8, (d) the P0 fix. Never weaken an assertion.

## Row text (verbatim from plan section 4)

- **P4 (L)** snapshot build/run/remove (G3–G5, G10) + `test-snapshot.test.sh`. RED: KR1 on a fixture; link count
  1; origin URL neutered; inversion (c) — a guard moved into the child misses the fixture write, so the test pins
  the outer call; exit paths (normal, non-zero child, INT mid-run with a delayed descendant, TERM mid-construction) leave no `$SNAP`, worktree or lock; a relative tracked-file write lands only in the snapshot; construction fails closed on an alternates source and on an absolute symlink into the fixture real repo; a nested gitdir file in the fixture working tree is not copied; reaper vs a live container skips it.
  NC: `AUTOPILOT_TEST_SNAPSHOT=0` runs in place with the G3 line. Verify: full `run.sh --parallel 16` both modes;
  red sets compared by file name to §0.1 (its clone was built differently: plain `git clone`); real repo
  `--local --list`, `for-each-ref`, `status --porcelain` identical before/after.

## Product

This is a repair pass on top of the head of hands/trwc/4a (the P4a work is already committed there; add ONE new commit). Four review findings, all MUST-FIX.

Finding 1 (critical): the previous commit added a stray root-level file tracked.txt (four lines of rel-child) that is outside the allowed files. Delete it from the tree in this commit. Its cause is the relative-write test case: ts_snapshot_build is called unchecked and the cd into the snapshot repo has no failure guard, so when the build fails the relative write lands in the runner's cwd. In hooks/tests/test-snapshot.test.sh make that case fail (not continue) when the build fails, and guard the cd so a failed cd never lets the write run in the current directory. Check every other case that does cd into a snapshot path and writes relatively for the same defect.

Finding 2: hooks/tests/run.sh contains a preview branch (a helper whose name contains _ts_preview_parallel) that sends any run with the --parallel option to the in-place wrapper without the test-snapshot: disabled line. G3 says the snapshot is the default for every run and AUTOPILOT_TEST_SNAPSHOT=0 (or missing rsync) is the only opt-out, and a full parallel run must be contained too. Delete that preview scan and its elif so that --parallel takes the OUTER flow and the original argv passes through unchanged to the inner run.

Finding 3: the child is started as a background subshell without set -m and without setsid, so it stays in the outer's process group, kill of a negative pid cannot reach it, and bash starts async children with SIGINT ignored, so the inner run.sh cannot trap INT. Start the child in its OWN process group while keeping it a waited child (never exec): enable set -m just around starting it and turn it off again, or use setsid with a wait on the pid. Verify with a small test that the child's process group id differs from the outer's and equals the child's own pid, and that a SIGINT delivered to the child's group is trapped by the inner run.sh (the inner run keeps its existing interrupt trap behaviour).

Finding 4: the two real outer run.sh cases in the test suite unset AUTOPILOT_TEST_SNAPSHOT_ROOT but not AUTOPILOT_TEST_SNAPSHOT, so an inherited opt-out makes them run in place and go red. Add -u AUTOPILOT_TEST_SNAPSHOT to the env invocation of the success case and the non-zero-child case (the opt-out NC case sets it to 0 explicitly and must keep doing so).

## Tests (RED-first)

Keep all existing cases and the RED comment; add the process-group case from Finding 3, and one case that a real outer run with the --parallel option and the one-file filter (use a fixture runner with the tiny test file) also runs in the snapshot (marker shows a REPO_ROOT under the private TMPDIR, not the fixture root). All cases must be green, also when the suite is invoked with AUTOPILOT_TEST_SNAPSHOT=0 in the environment.

## Verify

Run, with AUTOPILOT_SESSION_ID unset, stdin from /dev/null and one at a time: bash hooks/tests/test-snapshot.test.sh; env AUTOPILOT_TEST_SNAPSHOT=0 bash hooks/tests/test-snapshot.test.sh; bash hooks/tests/test-identity-guard.test.sh; every suite from: ls hooks/tests | grep -E 'reap|run-sh|oracle|residue' (each solo); git status --porcelain of the repo must show no untracked or modified file after the runs; node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh --check. Never run the full hooks/tests/run.sh without a filter.

## Allowed files

hooks/tests/run.sh, hooks/tests/lib/test-snapshot.sh, hooks/tests/test-snapshot.test.sh, and the deletion of tracked.txt at the repo root.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.

Unset AUTOPILOT_SESSION_ID before every test command. Never run the full `hooks/tests/run.sh` without a filter.
