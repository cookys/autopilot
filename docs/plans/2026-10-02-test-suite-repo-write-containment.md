# Plan — test suite repo write containment

> Status: active · Owner: depth-0 (opus) · Branch: landing clone off `origin/develop` · Frame: PATCH (v2.36.105 unless taken)

## 0. Context / thesis

From 2026-09-04 20:36 until 2026-10-02, the main clone on cookys-aimax395 carried a local
`user.name=Test User` / `user.email=test@example.com` in `.git/config`, and 632 commits on `origin/develop`
carry that author. The vector: git exports `GIT_DIR` to hooks in a linked worktree; a test's `git init` in a
scratch dir then creates nothing, and its bare `git config user.name …` writes the real clone's shared config.
v2.36.103 (`0f5675ab`) unsets `git rev-parse --local-env-vars` in `hooks/tests/run.sh` and `lib.sh` and adds
an identity drift guard. On 2026-10-02 three more facts surfaced:

- **The guard trusts a polluted baseline.** It snapshots the local identity at suite start and restores *that*
  value, so an already-polluted clone stays polluted (`c99e2a16` was pushed as Test User after v2.36.103).
- **The suite writes outside scratch dirs by other routes too.** A full run in a clone left
  `.opencode/package.json` + lock modified (working tree); an empty `/tmp/.git` dir created 2026-09-30 10:11
  made every git-discovering scratch dir under `/tmp` resolve to it (3 suites red for that reason alone).
- **Five git-using tests do not source `lib.sh`** (`calendar-teeth-negative`, `orchestration-eval`,
  `pin-evidence-anchors`, `session-mode`, `skill-onoff-markers`), so a standalone run of them is unprotected.

Thesis: stop relying on every test writing correctly. The full suite runs against a throwaway copy of the
repo; the real repo's config is diffed around that run; and commits/pushes with a test identity are refused.

### 0.1 Probes (2026-10-02, depth-0, this host)

- **Kernel read-only mount is not viable.** `bwrap --dev-bind / / --ro-bind .git .git` makes `git config --local`
  fail with EROFS, but this host has `kernel.apparmor_restrict_unprivileged_userns=1`: inside bwrap a nested
  `bwrap` fails (`No permissions to create a new namespace`). Ten suites and the production reviewer sandbox
  run bwrap themselves, so a bwrap-wrapped suite turns them red. Landlock forbids mount inside a domain too.
- **A full suite in a fresh `git clone` works.** `bash hooks/tests/run.sh --parallel 16` in a clone at
  `6bdd1a38`: 6/383 files red, every one classified: `engine-qualify`, `resolve-review-loop` = known load
  timeouts (both were red-then-solo-green at the 2026-09-29 landing); `import-aa-capabilities` (L1),
  `qualification-feed-adopt`, `qualification-scorecard-tools` = the stray `/tmp/.git` (green with
  `TMPDIR=/dev/shm/…`; the dir is now removed); `check-canonical-invariants` = genuine red on develop (its sandbox
  is not a git repo, and b152d723/fe39adf2 made the gate skip outside a checkout). Zero clone-induced reds.
- No ref, config or worktree entry of the real repo changed during that run (mtime check on `.git/refs`,
  `packed-refs`, `config`, `worktrees`).
- Cost: `git clone` (hardlinked objects; `--no-hardlinks` adds ~0.9 s) + `rsync -a --exclude .git` of the working tree = 3.2 s, 413 MB.
- `git grep '/home/cookys' -- hooks/tests scripts src`: only fixture payload strings, no path a test writes.
  No test runs push/fetch/pull/ls-remote against `$REPO_ROOT`.

## 1. Problem and honest scope

The suite runs as the operator's UID with write access to the repo it lives in; any env leak or cwd slip turns
a scratch write into a real one, silently, and it gets pushed. After this plan:

- Writes aimed at `$REPO_ROOT` or cwd during a full `run.sh` land in a disposable copy. This is redirection,
  not prevention. Residual routes to the real repo, by write class:
  - inherited `GIT_DIR`: closed by the env unset, now inventory-enforced (KR5);
  - absolute-path write of a local config key: caught + restored + suite fails (G6);
  - absolute-path write of a ref/worktree entry or a working-tree file: detected only — the outer run diffs the
    real repo's `for-each-ref`, `worktree list` and `git status --porcelain` and WARNS with the names (a
    concurrent operator edit must not fail the suite);
  - a commit with a test identity: refused at commit/merge/push (KR4). `--no-verify` on both commit and push is a
    deliberate operator act and an accepted residual;
  - writes into `.git/hooks`, `.git/info`, objects, or other git-dir files outside config/refs/worktrees: unprotected
    residual (no test is known to do this);
  - snapshot opt-out (`AUTOPILOT_TEST_SNAPSHOT=0`) and the rsync-missing in-place run: covered only by the G6 guard,
    the warn diff, KR4 and the env unset.
- A single `bash hooks/tests/x.test.sh` does not use the snapshot; it relies on `lib.sh` hygiene + the identity gate.

## 2. KRs

- KR1: In a full `run.sh`, every L1/L2 child sees `$REPO_ROOT` = the snapshot, never the real root. Proven on a
  fixture "real" repo driven through `hooks/tests/lib/test-snapshot.sh`: a child that runs `git config --local x.y 1`
  and edits a tracked file in its `$REPO_ROOT` leaves the fixture's `--local --list` and file bytes identical.
- KR2: The outer run fails, names the key (never the value), and restores, when any real-repo local config key
  outside `branch.*`/`remote.*` changed between before and after the inner run.
- KR3: `run.sh` refuses to start when the real repo's local `user.email` already matches the test-identity rule.
- KR4: `git commit` and a merge commit in the real repo with a test author/committer email are refused by
  `.githooks/pre-commit` / `.githooks/pre-merge-commit`; `git push` of a range containing one is refused by
  `.githooks/pre-push`.
- KR5: Every fixture identity email in `hooks/tests/` and `scripts/` matches the test-identity rule, and every
  git-invoking test sources `lib.sh` (both inventory-enforced).
- KR6: The full suite on the release branch is green except documented load timeouts that pass solo.

## 2.5 Global Constraints (copied verbatim into every dispatch)

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

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — test runner and repo-local git hooks; no skill, script CLI or config schema change.
- **Dependency decision**: `existing` — `git` and `rsync` are already on every dev host; no new runtime dependency.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/lib/test-identity.sh` (new) | `is_test_identity_email <email>` — the G2 rule, sole copy |
| `hooks/tests/lib/test-snapshot.sh` (new) | functions: build/remove snapshot (G4/G5), guard before/after (G6), baseline check (G7) — parameterised by real root so tests drive them on fixtures |
| `hooks/tests/run.sh` | G3: sources the above, runs the inner child; replaces the identity-only `__id_snapshot` guard |
| `hooks/tests/lib.sh` | G9 ceiling dirs |
| `hooks/tests/lib/suite-residue-reap.sh` | G5: `autopilot-test-snapshot.*` is lock-gated residue |
| `.githooks/pre-commit`, `.githooks/pre-merge-commit` (new), `.githooks/pre-push` | KR4 |
| `hooks/tests/test-identity-guard.test.sh` (new) | KR3–KR5 + negative control `2537196+cookys@users.noreply.github.com`, `cookys@stranity.com` |
| `hooks/tests/test-snapshot.test.sh` (new) | KR1, KR2, G3 opt-out line, G4 (origin neutered, link count 1 on objects and files), G5 exit paths, inversion (c) |
| `hooks/tests/check-canonical-invariants.test.sh` | P0 fix |
| the 5 non-`lib.sh` tests | source `lib.sh` |
| `hooks/README.md` (test section) | one paragraph: snapshot, guard, identity gate, opt-outs |
| `docs/scripts-inventory.md`, `CLAUDE.md` group list | register `lib/test-identity.sh` |
| `docs/BACKLOG.md` + sidecar | `.opencode/package.json` working-tree drift (out of scope) |

## 4. Phases (stacked rows, one hand commit each)

Each row: RED = the new case fails at the row's base; NC = negative control that must stay green.

- **P0 (S, test-only)** `check-canonical-invariants.test.sh`: `git init -q` + `git add -A` in its sandbox.
  RED: the rogue-consumer assertions fail today. NC: a sandbox without a rogue consumer still passes.
- **P1 (S)** `test-identity.sh` + inventory (KR5) + G9. Inventory syntaxes: `config user.email`, `-c user.email=`,
  `GIT_AUTHOR_EMAIL=`, `GIT_COMMITTER_EMAIL=`, `EMAIL=`, JS argv arrays with `user.email`; any other `@`-address in
  a git-invoking test fails the inventory with file:line. Non-G2 fixtures → `@example.invalid`; the only accepted non-matching emails are one declared control list in `test-identity-guard.test.sh`. Tests call
  `is_test_identity_email`, never restate G2. Second inventory: every git-invoking `*.test.sh` sources `lib.sh`
  (fix the five). Hunt the `/tmp/.git` creator (a `.git` mkdir whose base can be `os.tmpdir()`/`$TMPDIR`); fix
  or record "not reproduced". RED: rule cases + both inventories fail at base. NC: the two owner emails, and
  `foo@example.community`, are NOT test identities.
- **P2 (S)** `lib/test-snapshot.sh` guard + baseline functions (G6, G7), wired into run.sh with the snapshot
  still off. RED: a child sets `core.foo` in a fixture real repo → fail + restored + key named, value absent from
  output; baseline `user.email t@t` → refuse. NC: a child setting `branch.x.remote` passes; a clean baseline runs.
- **P3 (S)** pre-commit + pre-merge-commit + pre-push (KR4, G8). RED, each in a fixture repo using `.githooks`:
  test-identity commit, merge commit, and push of a range containing one are refused. NC: owner identity
  passes; a fixture with `autopilot.testIdentityGate=off` passes; the env var `AUTOPILOT_ALLOW_TEST_IDENT=1`
  does NOT bypass; a push whose only test-identity commits are already on the target remote passes, and a new ref whose bad commit exists only on an unrelated remote is refused; a leaked `GIT_CONFIG_COUNT` overlay setting the key does NOT bypass, nor does the key in a repo outside TMPDIR. Re-run every suite
  that drives `.githooks/*` (`qc-gate`, `mission-terminal-rollover`, `codex-plugin-package`, + `git grep -l githooks`).
- **P4 (L)** snapshot build/run/remove (G3–G5, G10) + `test-snapshot.test.sh`. RED: KR1 on a fixture; link count
  1; origin URL neutered; inversion (c) — a guard moved into the child misses the fixture write, so the test pins
  the outer call; exit paths (normal, non-zero child, INT mid-run with a delayed descendant, TERM mid-construction) leave no `$SNAP`, worktree or lock; a relative tracked-file write lands only in the snapshot; construction fails closed on an alternates source and on an absolute symlink into the fixture real repo; a nested gitdir file in the fixture working tree is not copied; reaper vs a live container skips it.
  NC: `AUTOPILOT_TEST_SNAPSHOT=0` runs in place with the G3 line. Verify: full `run.sh --parallel 16` both modes;
  red sets compared by file name to §0.1 (its clone was built differently: plain `git clone`); real repo
  `--local --list`, `for-each-ref`, `status --porcelain` identical before/after.

## 5. Test / validation

Script-gated: the new suites + full suite both modes. depth-0-gated replay: in a scratch clone with a linked
worktree, export the worktree's `GIT_DIR` and run v2.36.102's `hetero-review-loop.test.sh` body under the new
run.sh → the scratch clone's config is unchanged or the suite fails naming `user.name`.

## 6. Risks + inversion

- What guarantees failure? (a) A hardlinked working-tree copy — an in-place write then edits the real file;
  G4 forbids it and the snapshot test asserts link count 1. (b) A live `origin` in the snapshot — a test push
  lands in the real repo; G4 neuters it and the test asserts the URL. (c) The guard measuring the snapshot
  instead of the real repo; G6 pins it to the outer process and P4's inversion-(c) test fails if it moves. (d)
  An inheritable bypass; G8 has none (P3 NC asserts the env var does not bypass).
- An identity rule that matches a real owner email blocks real commits → G2 is reserved-domain only; P3 has
  negative controls.
- A concurrent session editing a non-`branch|remote` key of the same clone during a suite run fails that run
  once: accepted, loud, named.
- Tests that depend on gitignored local state are covered because rsync copies ignored files; tests that need
  staged-only index state must stage it themselves (none found in §0.1).
- Snapshot removal before reaping would orphan hetero worktrees registered in the snapshot → G5 orders reap first.

## 7. Out of scope

Rewriting history (`.mailmap` folds it); kernel-level isolation (§0.1); `.opencode/package.json` drift (BACKLOG
row); macOS-specific sandboxing; dispatch-time identity containment (shipped 07-16).

## 8. Open questions

None for the Board; the operator approved the snapshot design on 2026-10-02.

## Review log

R0 author: depth-0 (opus), 2026-10-02. Design pivot before R0: bwrap read-only mount → disposable snapshot (§0.1).
G1 (sol / grok / MiniMax, all transported; all STOP): 22 findings, depth-0 dispositions in
`…g1-dispositions.json` — 11 accepted blockers, 3 accepted non-blocking, 7 duplicates, 1 rejected (rsync runs
after checkout, so unstaged edits are carried). Folded: `--no-hardlinks`; child-not-exec + outer-only guard;
no exported real root (functions in `lib/test-snapshot.sh` tested on fixtures); ref/config divergence named;
config-key bypass replaces the env var; pre-push commit-set algorithm; per-row RED + NC; lock-gated reaping;
residual routes listed per write class in §1.
G2 (terminal; sol STOP, grok STOP, MiniMax READY): 15 findings, dispositions in `…g2-dispositions.json` — 12
accepted blockers, 1 non-blocking, 2 duplicates. `check-phase-review-receipt.js` exits 0 on the G2 artifact.
This commit is the bounded repair: container dir (lock beside `repo/`), shutdown order, nested `.git`
exclusion, symlink/alternates fail-closed, child cwd, remote-scoped pre-push, overlay-proof bypass limited to
TMPDIR, P0 stay-green NC, declared control list, §1 residual classes. No G3. Frozen.
