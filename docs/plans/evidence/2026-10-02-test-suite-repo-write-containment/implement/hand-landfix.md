Engine: sonnet

# Repair hand — test-suite repo write containment, landing review round 1

You are a hand: you edit code and commit ONE commit. depth-0 authorized this brief.

## Where
- Repo: `C=/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc/clone` (a clone; never touch `/home/cookys/projects/autopilot`; never fetch/pull/push).
- First: `git -C $C checkout -q -b hands/trwc/landfix e0cf0511` (e0cf0511 = last accepted head; it sits on a clone-local shadow commit 63c4caeb — never modify it, never touch `.claude/owner-kernel-governance.json`).
- The plan (frozen): `$C/docs/plans/2026-10-02-test-suite-repo-write-containment.md`. §2.5 G1–G11 bind you; read them first.
- The review that found these: `/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc/run-land/trwc.review.json` (read its findings text).

## Fix exactly these (depth-0 accepted them)
1. 🟠 pre-push commit set (`.githooks/lib/test-identity-gate.sh`): for EVERY pushed ref (new or existing) judge `git rev-list <local_sha> --not --remotes=<remote name, pre-push argv $1>`; skip deletions (all-zero local sha). If `--remotes=<name>` matches no ref at all (remote never fetched), judge `<local_sha> --not <remote_sha>` when remote_sha exists locally, else all of `<local_sha>`'s ancestry is NOT judged blindly — instead refuse with a message telling the operator to `git fetch <remote>` first (fail closed, never silent pass). Tests (in `hooks/tests/test-identity-guard.test.sh`): (a) pushing an existing branch that merges a base containing an already-on-remote test-identity commit PASSES; (b) a new test-identity commit on top is REFUSED; (c) a remote whose old tip is absent locally does NOT silently pass; (d) the existing two-remote case still holds.
2. 🟠 `hooks/tests/run.sh` outer shutdown (`__suite_on_exit` and the INT/TERM/HUP traps): on EVERY exit path (normal, non-zero, INT, TERM, HUP) — TERM the child's process group, wait until the group is gone (bounded wait, then KILL the group), THEN reap worktrees inside `$SNAP/repo`, THEN remove `$SNAP`; idempotent; exit status = child's status or 128+signal. Add HUP to the trapped signals. Tests in `hooks/tests/test-snapshot.test.sh`: a child that leaves a lingering descendant on normal exit → after the outer returns, no process from the snapshot path survives and `$SNAP` is gone; HUP mid-run → same.
3. 🟡 child-pid/trap-install race in run.sh: install the traps BEFORE starting the child, and make them safe when the child pid is not yet set.
4. 🟡 the pgid-INT test's readiness loop: assert the readiness marker appeared (fail the case explicitly if it times out) instead of falling through.
5. 🟡 `P3X_ROOT` in `test-identity-guard.test.sh`: move it under the test's own mktemp dir, not `XDG_CACHE_HOME`.

Nothing else. Do not change the identity rule, the snapshot construction, or any other file than: `.githooks/lib/test-identity-gate.sh`, `hooks/tests/run.sh`, `hooks/tests/lib/test-snapshot.sh` (only if the shutdown helper lives there), the two test suites, and their `platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`.

## RED first
Write the new cases, run them on the unmodified e0cf0511 and paste the red lines as a `# RED at e0cf0511:` comment, then fix.

## Verify (foreground, each with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and `< /dev/null`)
- `bash hooks/tests/test-identity-guard.test.sh`, `bash hooks/tests/test-snapshot.test.sh` (run test-snapshot 3 times, all must pass), `bash hooks/tests/qc-gate.test.sh`, `bash hooks/tests/suite-residue-reaper.test.sh`, `bash hooks/tests/suite-oracle-lock.test.sh`;
- `bash hooks/tests/run.sh test-identity` (a filtered outer run, exercises the snapshot path);
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`.
Never run the unfiltered full `hooks/tests/run.sh`.

## Commit
ONE commit on `hands/trwc/landfix`, message `fix(test-snapshot,githooks): landing review round 1 — remote-scoped pre-push set, child-group shutdown on every exit path`. Your git identity in this clone is already real (cookys); never set a test identity, never `--no-verify`. Touch no other file.

## Report (final message)
The commit SHA, `git diff --stat e0cf0511..HEAD`, the RED lines, and the rc of every Verify command.
