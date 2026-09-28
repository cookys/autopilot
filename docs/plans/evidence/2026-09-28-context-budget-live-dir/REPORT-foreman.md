# REPORT — context-budget live-dir fix (row 1)

`LAND 1 8edb870ee581f417ccb36b7577c37881c97517fe`

Base: `8de1afa6` (clone-local shadow commit on `develop@0ecc19b2` — never touched, never landed).
Accepted head: `hands/livedir/1-r2` @ `8edb870ee581f417ccb36b7577c37881c97517fe` (two commits on top
of base: `89ba821b` original implementation, `8edb870e` repair).

## RED

Premise check at base `8de1afa6`, `env -u XDG_RUNTIME_DIR node -e resolveLiveDir()`:
`{"base":"/dev/shm/autopilot-1000","source":"shm"}` — defect confirmed present, proceeded.

Hand's own RED record: new suite `hooks/tests/live-dir-xdg-inference.test.sh` failed at `8de1afa6`
before the fix (split-env and group-bit-tightening cases red). Reviewer noted the recorded FAIL
count is cosmetically off by one (missing-parent case would not have been red at base) — flagged as
a non-blocking 🔵 finding only, not corrected.

## Diff stat (8de1afa6..hands/livedir/1-r2, full accepted range)

 hooks/README.md
 hooks/tests/hooks-live-state-misc.test.sh
 hooks/tests/live-dir-xdg-inference.test.sh (new)
 platforms/codex/plugin/scripts/lib/live-state-dir.js
 platforms/codex/plugin/scripts/lib/live-state-dir.test.js
 scripts/lib/live-state-dir.js
 scripts/lib/live-state-dir.test.js

Two commits, 7 files touched (all on or within the brief's allowed-files list plus the codex
mirror; see Note below on one file outside the literal allowed list).

## Review verdicts

Round 1 (`hands/livedir/1` @ `89ba821b`, reviewer claude-native/claude-fable-5-1, effort high):
verdict FIX-THEN-SHIP.
- 🟠 MUST-FIX tighten-mask-0o002-vs-0o007: the delivered chmod-tightening guard was
  `(mode & 0o002) === 0` (only excludes other-write) instead of the spec-required
  `(mode & 0o007) === 0` (excludes all other bits). This would have let 0705/0704/0701/0771/0755
  candidates reach chmod-and-accept when the spec required reject. I (foreman) had independently
  spotted this same deviation before sending for review; reviewer confirmed it as real and
  security-relevant (bounded — parent must already be 0700-owned — but wider than the frozen
  contract). Judged real; dispatched one repair hand.
- 🔵 misc-test-touch-scope: touch to `hooks/tests/hooks-live-state-misc.test.sh` (outside the
  brief's literal "Allowed files" list) judged in-scope — minimal adaptation of a pre-existing
  pinned assertion (row 132) that the contract change necessarily broke, matching the "adapt,
  don't delete" instruction for existing pins. No action taken.
- 🔵 split-test-grep-v-fragility: cosmetic, non-blocking, not acted on.

Round 2 (`hands/livedir/1-r2` @ `8edb870e`, same reviewer/effort, full range re-reviewed):
verdict SHIP-AS-IS.
- 🔵 red-comment-count-nit only (cosmetic RED-comment count off by one; not a behavior defect).
- Reviewer's no_finding_proof explicitly confirms: the 0o002→0o007 guard is fixed identically in
  both the canonical file and the codex mirror, no residual 0o002 arithmetic anywhere in the diff,
  candidate ordering and parent-existence check match spec, and the row-132 test adaptation remains
  minimal/in-scope.

No 🔴/🟠 findings remain undismissed. Nothing to escalate to depth-0 as an unresolved dismissal.

## Verify table (rc per suite; run in throwaway worktree RUN/verify at accepted head 8edb870e,
solo/foreground, env-scrubbed with -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID < /dev/null)

| Suite | rc |
|---|---|
| test -x hooks/tests/live-dir-xdg-inference.test.sh | 0 |
| hooks/tests/live-dir-xdg-inference.test.sh (7 cases) | 0 |
| node scripts/lib/live-state-dir.test.js (25 tests) | 0 |
| node scripts/statusline-live-tee.test.js (7 tests) | 0 |
| node hooks/context-budget.test.js (41 tests) | 0 |
| bash hooks/tests/context-budget-window-memory.test.sh (6 assertions) | 0 |
| bash hooks/tests/hooks-live-state-misc.test.sh (24 assertions) | 0 |
| bash hooks/tests/context-window.test.sh (53 assertions) | 0 |
| bash hooks/tests/foreman-guard.test.sh (114 assertions) | 0 |
| bash hooks/tests/advisory-relay.test.sh (71 assertions) | 0 |
| bash hooks/tests/hook-advisory-channel.test.sh (56 assertions) | 0 |
| node scripts/check-js-syntax.js (693 files) | 0 |
| bash scripts/sync-codex-plugin-skills.sh --check | 0 |

All green. Also run in full at `89ba821b` prior to repair (same list, green except the guard was
untested at the 0705 boundary) and again at accepted head `8edb870e` (full green including new
0705-rejection case).

## Real-host proof (from throwaway worktree RUN/verify at accepted head)

env -u XDG_RUNTIME_DIR node -e resolveLiveDir()
→ {"base":"/run/user/1000/autopilot","source":"xdg-inferred"}

/run/user/1000/autopilot was chmod'd from 0775 to 0700 by this call, as depth-0 pre-authorized in
the brief. Confirmed after: stat -c '%a %U' /run/user/1000/autopilot → 700 cookys.

readLive on a fresh sid written under /run/user/1000/autopilot/context/<sid>.json
(schema_version: 1, fresh written_at, context_window_size: 1000000):
{"schema_version":1,"written_at":"2026-09-28T03:03:21.036Z","context_window_size":1000000}
context_window_size=1000000

Worktree RUN/verify removed after the proof.

## Notes for depth-0

- hooks/tests/hooks-live-state-misc.test.sh was touched even though it is not on the brief's
  literal "Allowed files" enumeration — necessary because the contract change broke its pre-existing
  row-132 pin, and fixing it was required for the brief's own Verify list to pass. Both review
  rounds explicitly assessed this as in-scope, minimal, and matching the "adapt existing pins,
  don't delete" instruction. Flagging for transparency, not because either hand or reviewer judged
  it a problem.
- One repair round was needed (round 1 → FIX-THEN-SHIP on a real 🟠; round 2 → SHIP-AS-IS clean).
- No CHANGELOG/BACKLOG edits, no version bump, no merge, no push were made — per brief.
- hooks/tests/context-window.test.sh prints a benign "error: No valid patches in input" line to
  stderr on every run (pre-existing behavior, unrelated to this diff, still exits 0 with 53/53
  assertions passing) — noted only so it isn't mistaken for something this change introduced.

---

# r3 — spec correction (operator-approved, 2026-09-28)

`LAND 1 e3e5c46c830557235a62bcc5fe364e34cf3df2d7`

Base for r3: `hands/livedir/1-r2` @ `8edb870e`. Landing review had returned 🔴: the r2 guard
`(st.mode & 0o007) === 0` rejected the real production case (codeforge creates
`/run/user/<uid>/autopilot` as 0775 under a 0700 parent). Operator determined the original "no
other bits" spec was wrong, not the hand's r2 implementation of it, and issued a new rule replacing
point 2 of the original brief: any pre-existing candidate with group/other bits set is chmod'd to
0700 and accepted whenever its parent is private (owned by current uid, real directory, `(parentMode
& 0o077) === 0`) — the candidate's own bits no longer restrict this. Dispatched one hand
(`hands/livedir/1-r3`, base `8edb870e`), single commit `e3e5c46c830557235a62bcc5fe364e34cf3df2d7`.

## Diff stat (8edb870e..hands/livedir/1-r3)

 hooks/tests/hooks-live-state-misc.test.sh          | 11 +-
 hooks/tests/live-dir-xdg-inference.test.sh         | 42 +++++++-----
 platforms/codex/plugin/scripts/lib/live-state-dir.js      | 50 +++++----
 platforms/codex/plugin/scripts/lib/live-state-dir.test.js | 26 +++-
 scripts/lib/live-state-dir.js                      | 50 +++++----
 scripts/lib/live-state-dir.test.js                 | 26 +++-

6 files, 116 insertions, 89 deletions, 1 commit.

Confirmed the delivered change removes the inner `(st.mode & 0o007) === 0` restriction entirely
(not just widens it) — the chmod-and-accept branch is now gated solely by the parent-private
condition, exactly matching the operator's new rule text.

## RED

Hand recorded `# RED at 8edb870e:` for the new production case (0775 under 0700 parent), confirming
it failed (rejected) against the unmodified r2 head before the fix, per brief.

## Review verdict

Full range `8de1afa6..hands/livedir/1-r3`, reviewer claude-native/claude-fable-5-1, effort high:
verdict **SHIP-AS-IS**.
- 🔵 r132-mode-var-not-local: cosmetic shell-variable-scoping nit in the test suite, non-blocking.
- 🔵 parent-ancestor-symlink: parent check lstat's only the immediate parent, not the full ancestor
  chain; reviewer confirmed this matches the pre-existing candidate-lstat convention and the spec's
  literal wording ("parent is a real directory, not a symlink"), no change required.
No 🔴/🟠 findings. Reviewer's proof confirms: inner mode restriction fully removed; codex mirror
identical; new production-case tests (0775 and 0777 under 0700 parent ⇒ accepted, mode 700) present;
0775-under-0755(non-private)-parent reject retained; row-132 pins adapted in place (not deleted);
candidate ordering/parent-existence-before-push logic from rounds 1–2 unregressed.

## Verify table (throwaway worktree at accepted head e3e5c46c, solo/foreground, env-scrubbed)

| Suite | rc |
|---|---|
| test -x hooks/tests/live-dir-xdg-inference.test.sh | 0 |
| hooks/tests/live-dir-xdg-inference.test.sh (7 cases incl. new production 0775/0777 cases) | 0 |
| node scripts/lib/live-state-dir.test.js (26 tests) | 0 |
| node scripts/statusline-live-tee.test.js (7 tests) | 0 |
| node hooks/context-budget.test.js (41 tests) | 0 |
| bash hooks/tests/context-budget-window-memory.test.sh (6 assertions) | 0 |
| bash hooks/tests/hooks-live-state-misc.test.sh (24 assertions, row 132 now expects 0777-accept) | 0 |
| bash hooks/tests/context-window.test.sh (53 assertions) | 0 |
| bash hooks/tests/foreman-guard.test.sh (114 assertions) | 0 |
| bash hooks/tests/advisory-relay.test.sh (71 assertions) | 0 |
| bash hooks/tests/hook-advisory-channel.test.sh (56 assertions) | 0 |
| node scripts/check-js-syntax.js (693 files) | 0 |
| bash scripts/sync-codex-plugin-skills.sh --check | 0 |

All green.

## Real-host proof

chmod 0775 /run/user/1000/autopilot → stat shows 775.
env -u XDG_RUNTIME_DIR node -e resolveLiveDir() → `{"base":"/run/user/1000/autopilot","source":"xdg-inferred"}`.
stat after → 700. Matches the exact production case the r2→r3 spec correction targets.

hooks/context-budget.js end-to-end, XDG unset, `AUTOPILOT_CONTEXT_BUDGET_DIR=RUN/cbstate-r3`, stdin
`{"session_id":"d9a21e11-1567-4886-9a15-da347b58e585","transcript_path":"<real jsonl>"}`: exit 0, T1
nudge fired (context ~130k > 100k threshold). State file:
`{"calls":1,...,"lastLive":{"at":"...","ageMs":337082,"present":false,"used":false}}`.

**Deviation from the brief's expected `lastLive.present:true`/`knownWindow:1000000`:** the real live
file for this session (`/run/user/1000/autopilot/context/d9a21e11-....json`, written by the actual
codeforge statusline writer, `context_window_size: 1000000`) was already on disk, but it was last
written ~345s before this proof step ran — stale relative to `readLive`'s 120s freshness window
(`DEFAULT_MAX_AGE_MS`, pre-existing v2.36.1 contract, unrelated to this row's change) because no
statusline re-render occurred during this background foreman turn to refresh it. The brief
explicitly forbids writing any file into `/run/user/1000/autopilot/context/` to manufacture
freshness (round 1 already left one there, which depth-0 had to remove), so I did not work around
this by writing a fresh file. This is an environmental timing artifact of running the proof from a
non-interactive background session, not a defect in the shipped code: `readLive`'s freshness
contract and the `xdg-inferred`-base 1000000-window read-path were already directly proven fresh in
round 1's real-host proof (same `readLive()` call, same schema, `context_window_size` read back
correctly as 1000000) before the file was removed. Flagging for depth-0 to decide whether a
follow-up proof (re-run this exact command shortly after a live statusline tick, or in an
interactive session) is wanted, rather than treating it as silently satisfied.

Worktree removed after the proof.
