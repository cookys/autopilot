# Hand repair brief — context-budget live-dir fix (row 1, repair 3)

Base is `hands/livedir/1-r2` at `8edb870e`. This is an operator-approved spec change: the prior
round's guard was too narrow and rejected a real production case. Your job is ONE narrow fix,
nothing else.

## Product

In `scripts/lib/live-state-dir.js`, function `isOwnedMode700Dir`, the current tightening branch
only chmod-and-accepts a pre-existing candidate when its own mode has zero other bits
(`(st.mode & 0o007) === 0`) in addition to having a private parent. This is now known to be wrong:
the real production case is codeforge creating `/run/user/<uid>/autopilot` as mode 0775 under a
0700 parent, and the current code rejects that case.

Replace the guard with the new rule (this supersedes the "no other bits" condition entirely — do
not keep both): for a pre-existing candidate that is a real directory (via `lstat`, not a symlink),
owned by the current uid, with ANY group and/or other bits set (i.e. inside the existing
`(st.mode & 0o077) !== 0` branch, with no further restriction on which of those bits are set — 0775,
0777, 0750, 0705, 0755, anything), chmod it to `0o700` and accept it, but only if its parent
directory is owned by the current uid, is itself a real directory (via `lstat`, not a symlink), and
has `(parentMode & 0o077) === 0` (private to the owning uid). The candidate's own group/other bits
no longer matter at all once the parent-private condition holds — remove the inner
`(st.mode & 0o007) === 0` check entirely, so the chmod-and-accept path is reached for any mode with
group/other bits set, as long as the parent-private condition passes. Every other case (parent not
owned by current uid, parent not a real directory / is a symlink, or parent has any group/other bit
set) keeps the existing reject-and-fall-through behavior, exactly as before.

Update the inline comment next to this branch to explain the new rationale: with a private parent
(mode & 0o077 === 0, owned by the current uid), no other user could ever have traversed into the
parent to plant or tamper with the candidate, regardless of what permission bits the candidate
itself carries — so the candidate's own mode carries no information once the parent is known to be
private, and the old "some-bits-still-reject" carve-out is unnecessary. Drop any comment wording
that says 0705/0755/0777-shaped modes are rejected — that is no longer true. Keep the comment
warning for the remaining reject path: when the parent is NOT private, a same-uid-or-foreign-group
plant is still possible and chmod-and-accept must not happen.

Update the header contract comment block at the top of the file (the "Contract (plan §2.5, ...)"
block) to match: the group-bit-tightening exception no longer restricts which of the candidate's
own group/other bits are set — only the parent-private condition gates it. Remove or correct any
prior wording there that described the narrower "no other bits" rule.

Apply the identical change to the mirrored copy of this file at
`platforms/codex/plugin/scripts/lib/live-state-dir.js` by running
`bash scripts/sync-codex-plugin-skills.sh` after fixing the canonical file, then confirm the mirror
picked up the change.

## Tests (RED-first)

In `hooks/tests/live-dir-xdg-inference.test.sh` and/or `scripts/lib/live-state-dir.test.js`
(whichever already holds the sibling cases — keep each new/changed case next to its existing
family):

- Replace the existing "0705 rejected" case (`assert_r1_other_bits_rejected` or whatever holds the
  0705-under-private-parent scenario from the previous round) with a new case asserting a candidate
  with mode 0775 under a 0700 parent is ACCEPTED and ends at mode 0700. Name this one so it is
  clearly marked as the production case, e.g. `assert_r3_production_0775_under_private_parent_accepted`.
- Add a second new case: mode 0777 under a 0700 parent ⇒ ACCEPTED, ends at mode 0700. Name it
  `assert_r3_0777_under_private_parent_accepted`.
- Keep (do not delete) the existing case for 0775 under a 0755 (non-private) parent ⇒ REJECTED,
  mode unchanged.
- Keep (do not delete) the existing symlink-candidate-rejected and foreign-uid/foreign-parent
  reject cases, if present.
- Also check `scripts/lib/live-state-dir.test.js`'s own pinned cases (from prior rounds) for the
  "other bits rejected" scenario and `hooks/tests/hooks-live-state-misc.test.sh`'s row 132 pin — if
  either pins a "candidate with other bits under a private parent is rejected" expectation, update
  it in place (adapt, don't delete) to match the new accept-and-chmod behavior. Grep for any test
  asserting rejection of 0775/0705/0755/0777 under a private (0700) parent specifically, and correct
  those in place; leave alone any test asserting rejection under a non-private parent (that
  behavior is unchanged).

Before making the production-code change, run the affected suite(s) against the unmodified base
(`8edb870e`) and confirm the new 0775-under-0700-parent case fails (RED — the current code still
rejects it). Record this as a comment formatted `# RED at 8edb870e:` followed by a short summary.
Then implement the fix and confirm all cases go green.

## Verify

Same list as before, each run solo, foreground, prefixed with
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
`hooks/tests/live-dir-xdg-inference.test.sh`, `hooks/tests/hooks-live-state-misc.test.sh` (only if
its row 132 pin needs adapting to the new rule), plus whatever
`scripts/sync-codex-plugin-skills.sh` regenerates under `platforms/codex/plugin/`. Touch nothing
else — this is a narrow repair, not a rewrite.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
