# REPORT — Unit D (dispatch-author positive completion predicate)

## Branches / commits
- `hands/par3-d/author-d` @ `ad2cf9a9` — base `6d19cd18` (clone HEAD incl. shadow commit).
  `diff --stat`: 4 files, +726/-30 (`scripts/dispatch-author.sh`, codex twin, both test files).
- `hands/par3-d/author-d-r2` (repair) @ `cf55f9db` — base `ad2cf9a9`.
  `diff --stat`: 2 files, +12/-12 (`scripts/dispatch-author.sh` + codex twin only).
- Both branches carry exactly one commit each (`git log --oneline <base>..<branch>` confirmed).

## Review verdict (round 1, claude-native/claude-fable-5-1, effort high)
Verdict: **FIX-THEN-SHIP**. 4 findings:
- 🟠 `errexit-leak` — **accepted, real.** `set +e` … `set -e` around the frame-parse `awk` turned errexit ON
  for the rest of the script even though the script runs under `set -uo pipefail` (no `-e`) — confirmed by
  `grep '^set '` showing only `set -uo pipefail` at line 112, plus the `set -e` at line ~1383 in the diff.
  Silent behavior change to unrelated later paths (codex checks, containment, emit_result/trap).
- 🟠 `codex-gate-mismatch` — **accepted, real.** Prompt wrap gated on `[[ "$RUNNER" != "codex" ]]` (line 979)
  but the completion predicate was gated on `[[ "${CODEX_TRANSPORT:-0}" -ne 1 ]]` (line 1301) — a different
  condition. `--runner codex` without `CODEX_TRANSPORT=1` got no frame injected but still ran the locator →
  always `frame_missing`/5; a non-codex runner with `CODEX_TRANSPORT=1` got wrapped but never stripped →
  consumers would see a framed artifact.
- 🟡 `forbidden-scan-narrowed` — **not repaired** (below MUST-FIX severity threshold for a repair round per
  brief's 🔴/🟠 rule; flagging here for depth-0/owner follow-up): `validate_json_result` now scans only the
  last `^{` line instead of full `$out`, narrowing the forbidden-substring (endpoint/token) scan coverage in
  the test harness.
- 🔵 `dead-close-file`, 🔵 `report-md-note` — CUT/FOLLOW-UP, not MUST-FIX, not repaired.

## Repair round (author-d-r2)
Dispatched one repair hand fixing only the two 🟠 findings. Diff (12 lines each file, both `scripts/` and
codex mirror):
- Predicate now gated on `[[ "$RUNNER" != "codex" ]]` (same condition as the wrap).
- `set +e`/`set -e` replaced with `PARSE_RC=0` before the awk and `|| PARSE_RC=$?` after it — errexit state
  is never touched.
Per brief, at most one repair round; not re-sent to a third review pass. Diff inspected directly against the
two findings' remediation text — both match exactly.

## Verify (from both hands' self-reported tails, not taken as ground truth — corroborated by clean
`diff --stat` scoped to Allowed files and single-commit branches)
All 8 commands reported exit 0 in both hand runs:
`dispatch-author.test.sh` (134), `dispatch-author-result-failures.test.sh` (13),
`dispatch-author-kimi.test.sh` (6), `dispatch-author-codex-transport.test.sh` (204),
`dispatch-plan-review.test.sh` (274), `verification-author-resolver.test.sh` (31),
`sync-codex-plugin-skills.sh --check` (0), `check-js-syntax.js` (0).
Round-1 hand log noted an unrelated agy/`bwrap` sandbox failure on a read-only tmpfs `.gemini` log dir in
an *earlier* full run of the author suite, not in the frame-predicate cases; it reported "an earlier full
run was 134/134" for that suite, matching the verify-table 134 count from round 1's own final run.

## Not done / deferred (named by the hands, consistent with brief scope)
- Shared locator lib to de-duplicate the dispatch-review/dispatch-author frame parser — flagged in
  `scripts/dispatch-author.sh` header as a follow-up, per brief instruction (do not hand-roll a third
  parser owner, do not extract it here).
- `dispatch-plan-review.js` / `dispatch-review.sh` / `dispatch-hetero.sh` / schema files — untouched, as the
  brief requires (sibling unit owns `dispatch-plan-review.js`'s generic non-`authored`+`error` handling,
  which already carries `truncated`).
- No commit/push/PR by the hands themselves — foreman (this unit) did not merge, push, or checkout main;
  depth-0 owns cherry-pick.
- 🟡 `forbidden-scan-narrowed` left unfixed — below the repair-round bar in the brief, surfaced above for
  triage.

## BACKLOG row accuracy
Confirmed accurate against base: `scripts/dispatch-author.sh:1205-1208`-equivalent non-empty-grep-only gate
before `emit_result "authored"` was real at base (verified via the RED tests added in round 1, which recorded
the base-sha `authored` result for both the 100-byte-preamble and tool-narration-fence cases per the "RED
first" instruction). No corrections to the BACKLOG row text found.

## r3 (depth-0-ordered repair: 🟡 forbidden-scan-narrowed reclassified as must-fix)
Branch `hands/par3-d/author-d-r3` @ `46f2be61`, base `cf55f9db` (author-d-r2 head).
`diff --stat`: 1 file, +5/-4 — `hooks/tests/dispatch-author-result-failures.test.sh` only. One commit.

1. Forbidden-substring scan restored to scan the FULL captured `$out` (now passed as argv[8]), while the
   JSON-shape checks still parse only the last `^{` line via `json_line`. Both live in the same
   `validate_json_result`; neither weakens the other.
2. Root cause of case 4's non-JSON stderr lines under `DISPATCH_QUIET=1`: **not** `dispatch-author.sh`
   ignoring `DISPATCH_QUIET` — its own progress notes (lines ~895, ~1016) already gate on it correctly.
   The 3 extra lines come from `scripts/resolve-review-loop.sh` (`⚠ qc_panel[N] seat … has no recorded
   operator admission …`), an existing warning path unrelated to the truncated/frame feature, present on
   ALL four cases (not case-4-specific) and never redirected by `dispatch-author.sh`. `resolve-review-loop.sh`
   is outside this unit's Allowed files, so per the depth-0 instruction's fallback clause the script was
   left unchanged — correct call, no code fix applied, no codex sync needed (no author-script/twin change).
3. Verify: all 8 commands exit 0 (hand's first background run reported a spurious failure caused by a
   leaked `HOME`/`TMPDIR`/`AUTOPILOT_SETTLE_MS` from its own repro steps; after resetting env, clean pass).

Not re-reviewed per depth-0 instruction (no re-review needed for r3).
