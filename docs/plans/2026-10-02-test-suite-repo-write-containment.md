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
- Cost: `git clone` (hardlinked objects) + `rsync -a --exclude .git` of the working tree = 3.2 s, 413 MB.
- `git grep '/home/cookys' -- hooks/tests scripts src`: only fixture payload strings, no path a test writes.
  No test runs push/fetch/pull/ls-remote against `$REPO_ROOT`.

## 1. Problem and honest scope

The suite runs as the operator's UID with write access to the repo it lives in; any env leak or cwd slip turns
a scratch write into a real one, silently, and it gets pushed. After this plan:

- Writes aimed at `$REPO_ROOT` or cwd during a full `run.sh` land in a disposable copy. This is redirection,
  not prevention: a test that names the real repo's absolute path, or inherits a real `GIT_DIR`, could still
  reach it. The `GIT_DIR` route is closed by the env unset (now inventory-enforced); the absolute-path route is
  caught by the outer config diff and by the commit/push identity gate.
- A single `bash hooks/tests/x.test.sh` does not use the snapshot; it relies on `lib.sh` hygiene + the identity gate.

## 2. KRs

- KR1: In a full `run.sh`, every L1/L2 child sees `$REPO_ROOT` = the snapshot, never the real root; a probe test
  that runs `git config --local x.y 1` in `$REPO_ROOT` leaves the real repo's `git config --local --list`
  byte-identical.
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
- G3: Snapshot is the default for a full `run.sh` and opt-out with `AUTOPILOT_TEST_SNAPSHOT=0` (one stderr line starting `test-snapshot: disabled`). Re-exec happens at most once, keyed on `AUTOPILOT_TEST_SNAPSHOT_ROOT` being set; original argv preserved verbatim.
- G4: Snapshot construction: `git clone --quiet --no-checkout "$REAL_ROOT" "$SNAP"` (default local clone — hardlinked objects, NEVER `--shared`, NEVER `git worktree add`), then `git -C "$SNAP" checkout --quiet <real HEAD sha>`, then copy the real working tree with `rsync -a --delete --exclude /.git` (a real copy: NEVER `cp -al`, `--link-dest`, or any hardlink of working-tree files), then `git -C "$SNAP" remote set-url origin /nonexistent/autopilot-test-snapshot-origin`. The snapshot carries HEAD + working tree; staged-only index state is not carried.
- G5: `$SNAP` lives under `${TMPDIR:-/tmp}/autopilot-test-snapshot.XXXXXX`; the EXIT/INT/TERM trap removes it AFTER the residue reaper has run inside it. The real root is exported as `AUTOPILOT_TEST_REAL_ROOT` for the guard and the KR1 test only; no other test may read it.
- G6: The config drift guard runs in the OUTER process against the REAL repo: `git -C "$REAL_ROOT" config --local --list` before the re-exec and after the inner run returns, ignoring keys matching `^(branch|remote)\.`; on drift it restores the before-values (unsetting keys that were absent), prints the key name only, and fails the suite. With the snapshot disabled it runs around the in-place run.
- G7: The polluted-baseline check (KR3) runs first, prints the two `git config --local --unset` fix commands, and exits non-zero. It never edits the config itself.
- G8: Hooks stay fail-open on internal error (missing lib ⇒ allow), except the identity verdict itself. `AUTOPILOT_ALLOW_TEST_IDENT=1` bypasses the commit/push check; only a test that deliberately drives `.githooks/*` with a fixture identity may set it, inline on that single command.
- G9: `hooks/tests/lib.sh` exports `GIT_CEILING_DIRECTORIES` including `${TMPDIR:-/tmp}` and `/tmp`, so a scratch dir without its own `.git` never discovers a repo above it.
- G10: Bash ≥ 4; `rsync` is required for snapshot mode (absent ⇒ the G3 line with reason `rsync missing` and an in-place run). No version/CHANGELOG/plugin.json edits in implementation commits; landing owns release.
- G11: Existing suites change only to (a) source `lib.sh`, (b) move a real-repo write into a scratch dir, (c) add `AUTOPILOT_ALLOW_TEST_IDENT=1` per G8, (d) the P0 fix. Never weaken an assertion.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — test runner and repo-local git hooks; no skill, script CLI or config schema change.
- **Dependency decision**: `existing` — `git` and `rsync` are already on every dev host; no new runtime dependency.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/lib/test-identity.sh` (new) | `is_test_identity_email <email>` — the G2 rule, sole copy |
| `hooks/tests/run.sh` | G3–G7: outer guard + snapshot re-exec; replaces the identity-only `__id_snapshot` guard |
| `hooks/tests/lib.sh` | G9 ceiling dirs |
| `hooks/tests/lib/suite-residue-reap.sh` | verify it reaps the snapshot's own worktrees before removal (G5) |
| `.githooks/pre-commit`, `.githooks/pre-merge-commit` (new), `.githooks/pre-push` | KR4 |
| `hooks/tests/test-identity-guard.test.sh` (new) | KR2–KR5 + negative control `2537196+cookys@users.noreply.github.com`, `cookys@stranity.com` |
| `hooks/tests/test-snapshot.test.sh` (new) | KR1, G3 opt-out line, G4 origin neutered, no hardlinked working-tree file (`stat -c %h` = 1) |
| `hooks/tests/check-canonical-invariants.test.sh` | P0 fix |
| the 5 non-`lib.sh` tests | source `lib.sh` |
| `hooks/README.md` (test section) | one paragraph: snapshot, guard, identity gate, opt-outs |
| `docs/scripts-inventory.md`, `CLAUDE.md` group list | register `lib/test-identity.sh` |
| `docs/BACKLOG.md` + sidecar | `.opencode/package.json` working-tree drift (out of scope) |

## 4. Phases (stacked rows, one hand commit each)

- **P0 (S, test-only)** `check-canonical-invariants.test.sh`: `git init -q` + `git add -A` in its sandbox so the
  reader-allowlist check runs. Done when the suite passes and its rogue-consumer assertions fail if the gate is
  reverted to skip (negative control).
- **P1 (S)** `test-identity.sh` + inventory test (KR5): enumerate fixture emails with
  `git grep -hoE "user\.email [^;&|)]+"` and `GIT_(AUTHOR|COMMITTER)_EMAIL=` across `hooks/tests scripts`; any
  outside G2 is rewritten to `@example.invalid`. Second assertion: every git-invoking `*.test.sh` sources
  `lib.sh`; fix the five. Add G9 to `lib.sh`. Find the `/tmp/.git` creator: grep
  `mkdir(Sync)?` / `path.join(...,'.git')` over tests whose base can be `os.tmpdir()`/`$TMPDIR` itself; fix it
  or, if not found, record "not reproduced" in the hand report.
- **P2 (S)** run.sh G6 + G7 replacing `__id_snapshot` (works with snapshot off). RED: a child test sets
  `core.foo` in the real root; a baseline with `user.email t@t`.
- **P3 (S)** pre-commit + pre-merge-commit + pre-push (KR4, G8). Verify `qc-gate.test.sh`,
  `mission-terminal-rollover.test.sh`, `codex-plugin-package.test.sh` and any other test that runs `.githooks/*`.
- **P4 (L)** run.sh snapshot (G3–G5, G10) + `test-snapshot.test.sh`. Verify: full `run.sh --parallel 16` with
  snapshot on and with `AUTOPILOT_TEST_SNAPSHOT=0`; red sets compared to §0.1; real repo `git status --porcelain`
  and `--local --list` identical before/after the snapshot-on run.

## 5. Test / validation

Script-gated: the new suites + full suite both modes. depth-0-gated replay: in a scratch clone with a linked
worktree, export the worktree's `GIT_DIR` and run v2.36.102's `hetero-review-loop.test.sh` body under the new
run.sh → the scratch clone's config is unchanged or the suite fails naming `user.name`.

## 6. Risks + inversion

- What guarantees failure? (a) A hardlinked working-tree copy — an in-place write then edits the real file;
  G4 forbids it and the snapshot test asserts link count 1. (b) A live `origin` in the snapshot — a test push
  lands in the real repo; G4 neuters it and the test asserts the URL. (c) The guard measuring the snapshot
  instead of the real repo; G6 pins it to the outer process.
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
