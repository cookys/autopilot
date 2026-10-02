Engine: cursor-grok-4.6-low

# Hand brief trwc-2

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

- **P2 (S)** `lib/test-snapshot.sh` guard + baseline functions (G6, G7), wired into run.sh with the snapshot
  still off. RED: a child sets `core.foo` in a fixture real repo → fail + restored + key named, value absent from
  output; baseline `user.email t@t` → refuse. NC: a child setting `branch.x.remote` passes; a clean baseline runs.

## Product

This is a repair pass on top of the head of hands/trwc/2 (the row work is already committed there; add ONE new commit). Fix two review findings in hooks/tests/lib/test-snapshot.sh.

Finding A (MUST-FIX): the warnings for refs, worktrees and status are built from name sets only, so a change that keeps the same name prints nothing. For example a child that commits on the real repo's current branch moves the branch ref to a new sha but the ref name set is unchanged, so no warning appears; the same holds for a status code change on an existing path and a worktree whose HEAD or branch changed. Fix: compare the sorted full before and after lines (comm -3 on the full lines), then extract the names from the differing lines and print the sorted unique names only, never shas or values. The return code stays unaffected by these warnings.

Finding B (MUST-FIX): the helper that explodes the null-delimited config listing uses the raw config key as a file name, but subsection keys can contain slashes (for example url.https://example.com/.insteadof, http.https://github.com/.extraheader). Such keys are silently dropped, so drift on them goes undetected and a baseline containing one prints shell errors. Fix: encode each key into a safe file name (escape the percent sign first, then the slash, and any other unsafe character) and decode it for the DRIFT line and for the restore. Use a method that never depends on a key being a valid path.

## Tests (RED-first)

Add to hooks/tests/test-snapshot.test.sh: one case that moves an existing ref between before and after (commit on the fixture's current branch) and asserts the WARNING names that ref (return code stays 0 for a refs-only change); one case with a slash-containing key (git config --local url.https://example.invalid/.insteadOf x set by the simulated child) asserting drift is reported by key name, the value x does not appear in output, and the key is removed again afterwards; and one case where the fixture baseline already contains such a slash key and a no-change guard run returns 0 with empty output. All earlier cases must stay green; never weaken an assertion.

## Verify

Run, with AUTOPILOT_SESSION_ID unset, stdin from /dev/null and one at a time: bash hooks/tests/test-snapshot.test.sh; bash hooks/tests/test-identity-guard.test.sh; the consumer suites listed by: ls hooks/tests | grep -E 'reap|run-sh|oracle|residue' (each solo); bash hooks/tests/run.sh test-snapshot (filtered only); node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh --check.

## Allowed files

hooks/tests/lib/test-snapshot.sh and hooks/tests/test-snapshot.test.sh only.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.

Unset AUTOPILOT_SESSION_ID before every test command. Never run the full `hooks/tests/run.sh` without a filter.
