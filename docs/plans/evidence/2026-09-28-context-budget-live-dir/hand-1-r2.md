# Hand repair brief — context-budget live-dir fix (row 1, repair 2)

Base is the head of `hands/livedir/1`. Your job is ONE narrow fix confirmed by review, nothing else.

## Product

In `scripts/lib/live-state-dir.js`, function `isOwnedMode700Dir`, the bounded group-bit-tightening
guard is currently written as `(st.mode & 0o002) === 0`. This is wider than the spec: it only
excludes the other-write bit, so a pre-existing candidate with mode 0705, 0704, 0701, 0771, or 0755
(other-read and/or other-execute set, but not other-write) would incorrectly reach the
chmod-and-accept branch. The correct guard, per spec, is that the candidate must have group bits
set but NO other bits at all: change the condition to `(st.mode & 0o007) === 0`. This checks that
none of other-read, other-write, or other-execute are set, while the enclosing `(st.mode & 0o077)
!== 0` check (from the outer branch) guarantees at least one of the group or other bits is set —
combined with `(st.mode & 0o007) === 0` this means a qualifying candidate always has at least one
group bit set and zero other bits.

Update the inline comment next to this guard: it currently describes the check as "other-write is
off (mode & 0o002 === 0 — 0775/0750 umask leftovers, not 0777)". Change it to say the guard
requires zero other bits at all (no other-read, other-write, or other-execute), narrowing the
rationale accordingly — the concern is that ANY other-permission bit means some non-group user
could plausibly interact with the entry, so only a mode with other bits fully clear and at least
one group bit set is eligible for the chmod-and-accept path.

Apply the identical fix (same guard change, same comment update) to the mirrored copy of this file
at `platforms/codex/plugin/scripts/lib/live-state-dir.js` — do this by running
`bash scripts/sync-codex-plugin-skills.sh` after fixing the canonical file, and verify the mirror
picked up the change (do not hand-edit the mirror directly if the sync script regenerates it from
the canonical source — read the sync script first to confirm which direction it copies).

## Tests

Add one new case to `hooks/tests/live-dir-xdg-inference.test.sh` (or if more natural given its
existing structure, to `scripts/lib/live-state-dir.test.js` — pick whichever file the equivalent
existing 0777/0775 cases live in, so the new case sits next to its siblings): a candidate directory
with mode 0705, owned by the current uid, under a private (0700) parent. Assert it is REJECTED
(falls through, does not get chmod'd, on-disk mode stays 0705) — confirming the fix. Name it
`assert_r1_other_read_exec_bits_rejected` (or the matching convention in whichever file you add it
to).

Before fixing, you may optionally confirm this new case fails against the current (unfixed) head —
not required, but if you have time note the result.

## Verify

Run every command from the original Verify list again, solo, foreground, each prefixed with
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and `< /dev/null`:

- `test -x hooks/tests/live-dir-xdg-inference.test.sh`
- `hooks/tests/live-dir-xdg-inference.test.sh`
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

All must pass before committing.

## Allowed files

Only touch: `scripts/lib/live-state-dir.js`, `scripts/lib/live-state-dir.test.js`,
`hooks/tests/live-dir-xdg-inference.test.sh`, plus whatever `scripts/sync-codex-plugin-skills.sh`
regenerates under `platforms/codex/plugin/`. Touch nothing else — this is a narrow repair, not a
rewrite.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
