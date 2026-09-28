# Hand brief — context-budget live-dir fix (row 1)

## Product

You are working in `scripts/lib/live-state-dir.js`. Base commit is `8de1afa6`. Implement exactly
the following four points, nothing else.

1. Inferred-xdg candidate. In `resolveLiveDir()`, when `XDG_RUNTIME_DIR` is unset or empty, insert
   an additional candidate whose directory is `<runUserRoot>/<uid>/autopilot` and whose source is
   the string `xdg-inferred`. This candidate goes into the candidates list after the (absent) xdg
   slot and before the shm candidate — i.e. candidate order becomes: override, xdg (only if
   `XDG_RUNTIME_DIR` set), xdg-inferred (only if `XDG_RUNTIME_DIR` unset/empty), shm, tmp.
   `runUserRoot` defaults to the literal string `/run/user` and must be injectable via
   `opts.runUserRoot`, following the exact same pattern already used for `opts.procMountsPath`
   (read it once at the top of `resolveLiveDir`, default when not provided). The xdg-inferred
   candidate is only pushed onto the candidates list at all if its parent directory,
   `<runUserRoot>/<uid>`, already exists on disk at the time `resolveLiveDir()` runs. Never create
   `<runUserRoot>/<uid>` yourself — if the parent is missing, skip adding this candidate entirely
   and fall through to shm/tmp as before.

2. Bounded group-bit tightening in `isOwnedMode700Dir`. Currently any pre-existing candidate
   directory with `mode & 0o077 !== 0` is rejected outright. Add a narrow exception: if the
   pre-existing candidate is a real directory (not a symlink), owned by the current uid, its mode
   has group bits set but no other bits at all (i.e. `(mode & 0o007) === 0` while `(mode & 0o070)
   !== 0` — meaning some group permission bit is on but zero "other" bits are on), AND its parent
   directory is itself owned by the current uid with `(parentMode & 0o077) === 0` (parent is
   private to the owning uid), then chmod the candidate to `0o700` and accept it instead of
   rejecting it. Every other case — any "other" bits set, foreign uid on the candidate or the
   parent, symlink, or a parent that is not private — keeps the existing reject-and-fall-through
   behavior unchanged. You will need to stat the parent directory in addition to the candidate to
   evaluate this. Update the existing code comment above the reject that currently reads
   approximately "reject if group/other bits are set... do not chmod-and-accept — a same-group
   plant under 0o750/0o770 survives chmod" — narrow that warning so it describes only the case it
   still actually covers (foreign-uid-in-group scenarios where the parent is NOT private), and add
   a comment next to the new tightening branch explaining the rationale: when the parent is private
   to the owning uid (mode & 0o077 === 0), no other user could ever have traversed into the parent
   to plant the candidate, so the old "same-group plant survives chmod" concern does not apply to
   this narrower case, and tightening the mode is safe.

3. Update the header contract comment block at the top of the file (the block starting
   "Contract (plan §2.5, ...)"). Revise the candidate-order line to reflect the new order
   (override, xdg, xdg-inferred, shm, tmp) and describe when xdg-inferred applies. Revise the
   rejection-rule description to mention the new bounded group-bit-tightening exception (briefly —
   point at the function for full detail rather than duplicating the whole condition in the header).
   Add a short note that the Rust twin, codeforge's `src/live.rs`, needs no change for path
   resolution because the statusline-writer process always has `XDG_RUNTIME_DIR` set, but that
   codeforge should create its runtime directory as 0700 — file that as a separate backlog item
   yourself only as a one-line comment pointer; do not modify any codeforge / Rust file, and do not
   write to CHANGELOG or BACKLOG.

4. No code for this point — informational only, for your awareness, not something to implement:
   hook-owned state currently living under `/dev/shm/autopilot-<uid>/{advisory-queue,
   context-budget, depth0-gate,dirty-tree-reminder}` becomes orphaned once hooks resolve to the new
   xdg-inferred path instead of shm. All of that state is advisory and rebuildable. Do not write
   any migration code or note about this in the repo — depth-0 records it elsewhere.

## Tests (RED-first)

Add a new suite at `hooks/tests/live-dir-xdg-inference.test.sh`. Make it executable with
`chmod +x`, and verify executability yourself with `test -x` on it before you finish — a
`git update-index --chmod` alone does not survive a later `git add`, so the actual file mode on
disk must be +x.

All cases use a temp directory as the injected `runUserRoot` (the temp root may live on whatever
filesystem the test host gives it — that is fine because you must inject `procMountsPath` pointing
at a synthetic mounts file that declares the temp root's path as tmpfs, and you must also inject an
`execFile` function that always throws an error with `code: 'ENOENT'`, so `isRamBacked` is forced
down the `/proc/mounts` fallback path rather than actually shelling out to `findmnt`). Mirror the
existing test-harness conventions in `scripts/lib/live-state-dir.test.js` for how it builds these
injected fixtures (synthetic mounts content, fake execFile, temp dirs) — read that file first and
reuse its patterns rather than inventing new ones.

Cases to implement, each as its own assertion function named exactly as listed:

- `assert_r1_split_env_reader_finds_writer`: simulate the writer process by calling
  `resolveLiveDir` with `env` containing `XDG_RUNTIME_DIR` set to `<root>/<uid>` (with the injected
  `runUserRoot` and a chosen uid), confirm it resolves through the ordinary xdg path, and write a
  valid live file at `<base>/context/<sid>.json` containing `schema_version: 1`, a fresh
  `written_at` (current ISO timestamp), and `context_window_size: 1000000`. Then simulate the
  reader process (a hook) by calling `resolveLiveDir` again with `XDG_RUNTIME_DIR` unset/empty but
  the same injected `runUserRoot`, confirm it returns `source: 'xdg-inferred'` and the expected
  base, then call `readLive` on that base/sid and confirm it returns the object with
  `context_window_size` 1000000 (not null).

- `assert_r1_group_bits_tightened`: pre-create the candidate directory under
  `<runUserRoot>/<uid>/autopilot` with mode `0775`, owned by the current process uid, and its
  parent `<runUserRoot>/<uid>` with mode `0700`. Call the resolution path (XDG unset) and confirm
  the candidate is accepted and its on-disk mode is now `0700`.

- `assert_r1_other_bits_rejected`: same setup but candidate mode `0777`. Confirm it is still
  rejected (resolution falls through past it, e.g. to shm/tmp/ssd-fallback rather than accepting
  it), and its on-disk mode is unchanged (not chmodded).

- `assert_r1_public_parent_rejected`: candidate mode `0775` but parent `<runUserRoot>/<uid>` mode
  `0755` (not private). Confirm the candidate is still rejected and NOT chmodded.

- `assert_r1_missing_parent_skipped`: do not create `<runUserRoot>/<uid>` at all. Confirm
  resolution never creates that directory (assert it still does not exist after the call) and
  falls through to a later candidate (shm/tmp/ssd-fallback).

- `assert_r1_context_budget_reads_1m`: first read the header comment of `hooks/context-budget.js`
  to determine how that hook takes its input and which environment variable or options seam
  controls which live-state directory it reads from (do not guess — read the file). Using
  whatever the real seam is, if one already exists, use it; only fall back to setting
  `AUTOPILOT_LIVE_DIR` if you find no other injection seam in that hook, and if you do fall back to
  `AUTOPILOT_LIVE_DIR`, say so explicitly in a comment in the test. Run `hooks/context-budget.js`
  with `XDG_RUNTIME_DIR` unset, with a live file already written declaring
  `context_window_size: 1000000`, and assert the hook's output does not treat the context window
  as 200000 (i.e. it picks up the 1,000,000 value rather than falling back to a 200K default).

Before making any production-code change, run this new suite against the unmodified base commit
(`8de1afa6`) and confirm it fails (RED). Record the literal red output as a comment in the test
file or in your commit message, formatted as a line starting with `# RED at 8de1afa6:` followed by
a short summary of the failure. Then implement the fix and confirm the suite goes green.

Existing pins: `scripts/lib/live-state-dir.test.js` almost certainly has test cases that pin the
old candidate order and the old "reject on any mode & 0o077" rule. Find those cases and update them
to match the new contract (new candidate order including xdg-inferred; group-bit-tightening
exception). Do not delete those existing test cases — adapt them in place so they still exist and
still pass, just updated for the new behavior.

## Verify

Run `test -x hooks/tests/live-dir-xdg-inference.test.sh` first to confirm executability. Then run
each of the following commands solo, in the foreground, one at a time, each prefixed with
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and redirecting stdin from `/dev/null`:

- the new suite: `hooks/tests/live-dir-xdg-inference.test.sh`
- `node scripts/lib/live-state-dir.test.js`
- `node scripts/statusline-live-tee.test.js`
- `node hooks/context-budget.test.js`
- `bash hooks/tests/context-budget-window-memory.test.sh`
- `bash hooks/tests/hooks-live-state-misc.test.sh`
- `bash hooks/tests/context-window.test.sh`
- `bash hooks/tests/foreman-guard.test.sh`
- `bash hooks/tests/advisory-relay.test.sh`
- `bash hooks/tests/hook-advisory-channel.test.sh`
- any other suite found by `grep -rl resolveLiveDir hooks scripts`
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`

All of these must pass before you commit. If `sync-codex-plugin-skills.sh --check` reports drift
because a mirrored file under `platforms/codex/plugin/` needs updating, run
`bash scripts/sync-codex-plugin-skills.sh` (without `--check`) to regenerate the mirror and include
the resulting mirror changes in your one commit.

## Allowed files

Only touch: `scripts/lib/live-state-dir.js`, `scripts/lib/live-state-dir.test.js`,
`hooks/tests/live-dir-xdg-inference.test.sh`, `hooks/tests/run.sh` (only if suites must be
registered there by name for the harness to pick them up), `hooks/README.md` (only if it documents
the candidate order and needs updating to match), plus whatever files
`scripts/sync-codex-plugin-skills.sh` regenerates under `platforms/codex/plugin/`. Touch nothing
else.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
