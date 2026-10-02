Engine: cursor-grok-4.6-low

# Hand brief trwc-3

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

- **P3 (S)** pre-commit + pre-merge-commit + pre-push (KR4, G8). RED, each in a fixture repo using `.githooks`:
  test-identity commit, merge commit, and push of a range containing one are refused. NC: owner identity
  passes; a fixture with `autopilot.testIdentityGate=off` passes; the env var `AUTOPILOT_ALLOW_TEST_IDENT=1`
  does NOT bypass; a push whose only test-identity commits are already on the target remote passes, and a new ref whose bad commit exists only on an unrelated remote is refused; a leaked `GIT_CONFIG_COUNT` overlay setting the key does NOT bypass, nor does the key in a repo outside TMPDIR. Re-run every suite
  that drives `.githooks/*` (`qc-gate`, `mission-terminal-rollover`, `codex-plugin-package`, + `git grep -l githooks`).

## Product

This is a repair pass on top of the head of hands/trwc/3 (the row work is already committed there; add ONE new commit). One review finding (MUST-FIX): three P3 fixtures in hooks/tests/test-identity-guard.test.sh (the ones named p3-bypass, p3-remote-ok and p3-unrelated) are created with fixed names directly under a bare TMPDIR instead of under TEST_TMP. This breaks when TMPDIR is unset (the path becomes a root-level directory), never cleans up, makes a second run fail with nothing to commit, and collides under concurrent runs. Rebuild those three fixtures under TEST_TMP. Check first whether TEST_TMP lives under the real path of TMPDIR (default /tmp) as the bypass requires; if TEST_TMP is not under TMPDIR, instead create them with mktemp -d under the TMPDIR default (/tmp when unset) and remove them in the suite's existing cleanup or with a trap that does not replace lib.sh's own trap handling. The case that needs a repository OUTSIDE TMPDIR must keep working and also be cleaned up afterwards. Do not change any hook file and never weaken an assertion.

## Tests (RED-first)

Run the suite twice in a row and once with TMPDIR unset; all three runs must be green and leave no p3-* directory behind in /tmp or in the repository (check with ls after each run). Keep the existing RED comment.

## Verify

Run, with AUTOPILOT_SESSION_ID unset, stdin from /dev/null and one at a time: bash hooks/tests/test-identity-guard.test.sh (twice, then once under env -u TMPDIR); bash hooks/tests/qc-gate.test.sh; node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh --check.

## Allowed files

hooks/tests/test-identity-guard.test.sh only.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.

Unset AUTOPILOT_SESSION_ID before every test command. Never run the full `hooks/tests/run.sh` without a filter.
