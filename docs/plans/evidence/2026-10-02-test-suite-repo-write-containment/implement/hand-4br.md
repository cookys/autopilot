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

This is a repair pass on top of the head of hands/trwc/4b (the P4b work is already committed there; add ONE new commit). Two MUST-FIX findings.

Finding 1: a host without the flock command must not fail the suite. Today the outer flow either prints a construction failure about flock and exits 1, or enters snapshot mode without being able to take the live lock. Treat a missing flock exactly like a missing rsync: in hooks/tests/run.sh, next to the rsync decision, when flock is not on PATH print the single stderr line "test-snapshot: disabled (flock missing)" and take the in-place wrapped run (baseline check and the config drift guard still active, same path as AUTOPILOT_TEST_SNAPSHOT=0). Remove the old fatal "flock missing" construction failure so there is one decision point. Also make the reaper (hooks/tests/lib/suite-residue-reap.sh) safe when flock is absent: it must treat a snapshot container as live (skip) when it cannot probe the lock, never reclaim. Name flock in the README paragraph's list of opt-outs.

Finding 2: run.sh contains a branch that runs a full suite in place whenever the parent process command line (read through ps for the parent pid) contains suite-oracle-lock.test.sh, and it prints nothing. G3 allows an in-place run only with a stderr line starting "test-snapshot: disabled". In that branch print "test-snapshot: disabled (suite-oracle-lock parent)" to stderr before the in-place wrapped run, and list this case among the opt-outs in the README paragraph.

## Tests (RED-first)

Append to hooks/tests/test-snapshot.test.sh; keep every existing case. Add a real outer fixture case where PATH is built to hide flock: create a directory under TEST_TMP containing symlinks to every command the runner and fixture need except flock (or filter PATH so no directory containing flock remains while keeping bash, git, rsync and coreutils reachable, for example by building the shim directory from the output of command -v for a fixed list of tool names), run the fixture runner with the one-file filter, and assert: the exit is 0; stderr contains the line "test-snapshot: disabled (flock missing)"; the marker shows the fixture ROOT as the repo root (in place); and the guard still fires: a variant where the child writes git config --local zz.touched 1 into its REPO_ROOT makes the run fail naming zz.touched with the key restored. Add a case for the oracle-lock-parent line only if it can be driven cheaply; otherwise assert by a source grep that the branch prints the disabled line. Record the red output of the new flock case at the base as a comment starting with "# RED at 8b222da3:".

## Verify

Run, with AUTOPILOT_SESSION_ID unset, stdin from /dev/null and one at a time: bash hooks/tests/test-snapshot.test.sh; env AUTOPILOT_TEST_SNAPSHOT=0 bash hooks/tests/test-snapshot.test.sh; bash hooks/tests/test-identity-guard.test.sh; every suite from: ls hooks/tests | grep -E 'reap|run-sh|oracle|residue' (each solo); node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh --check. Never run the full hooks/tests/run.sh without a filter.

## Allowed files

hooks/tests/run.sh, hooks/tests/lib/test-snapshot.sh, hooks/tests/lib/suite-residue-reap.sh, hooks/tests/test-snapshot.test.sh, hooks/README.md.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.

Unset AUTOPILOT_SESSION_ID before every test command. Never run the full `hooks/tests/run.sh` without a filter.
