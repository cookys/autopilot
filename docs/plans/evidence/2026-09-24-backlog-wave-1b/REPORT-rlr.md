# REPORT — rlr (review-loop-resolver-b), wave-1b

Unit: rows 131, 136, 137 (stacked). Clone: `scratchpad/w1b/rlr`.

## Rail unblock (depth-0 shadow fix)

Original BASE_SHA `475ebdc78ac9c0494c8c1fb794de45e763fc3599` blocked every hand dispatch at
`dispatch-hetero.sh`'s `check_mission_enforcement_gate()`: the clone's `.claude/owner-kernel-governance.json`
had `mission_convergence.enforcement_mode: "enforce"`, which requires a sealed campaign strict projection
this bundle-unit foreman does not provision (see earlier RAIL-FAIL entries, now superseded). Depth-0 applied
a clone-local-only shadow commit `2ec76a22ce41cdf7ad2fde3ae5540e852f780681` ("PARALLEL-RUN LOCAL ONLY —
mission_convergence enforcement_mode shadow (never land)") flipping that one field to `"shadow"`; this commit
never lands and the hand's commit is cherry-picked at landing. NEW BASE_SHA for row 131 =
`2ec76a22ce41cdf7ad2fde3ae5540e852f780681`. A first retry at this new base still hit the same gate because the
foreman's shell cwd was `/home/cookys/projects/autopilot` (the main checkout, untouched — read-only
`git rev-parse --show-toplevel` only) rather than the clone, so `dispatch-hetero.sh` resolved the wrong repo's
governance file; re-running with `cd` into the clone before invoking `dispatch-hetero.sh` fixed it. All three
rows below dispatched and landed cleanly after that.

## Premise checks (done before any hand dispatch, against original BASE_SHA — unaffected by the shadow commit)

- Row 131: defect PRESENT. `scripts/check-phase-review-receipt.js` `validateFindingObj()` required
  `candidate_blocker` mandatory for every finding regardless of `sourceName`, including `'dispositions'`.
- Row 136: defect PRESENT. `scripts/lib/exclude-allowlist.js` `EXCLUDE_ALLOWLIST` hardcoded, no
  consumer-declared extension point; `isPathspecAllowed()` took only one argument.
- Row 137: defect PRESENT. `scripts/hetero-review-loop.js` dispatched all seats with no pre-check of
  estimated agy payload size against `agy_argv_ceiling_bytes()`.

## Row 131 — plan-loop dispatcher/checker disposition-shape freeze

- Hand branch `hands/w1b-rlr/131`, base `2ec76a22ce41cdf7ad2fde3ae5540e852f780681`, head
  `a5ff00469280f5e360b045db628f2c42db1b8193`. `diff --stat`: 3 files, +62/-2
  (`scripts/check-phase-review-receipt.js` + codex mirror, `hooks/tests/review-loop-resolver-b.test.sh`).
- Review: `claude-native`/`claude-fable-5-1` → **SHIP-AS-IS**, no findings.
- Verify (in worktree `/tmp/hetero-hands-w1b-rlr-131-lLW7nO`): `dispatch-plan-review.test.sh` PASS,
  `check-phase-review-receipt.test.sh` PASS, `review-loop-resolver-b.test.sh` PASS.
- No repair needed. Nothing outstanding.

## Row 136 — hetero-review-loop consumer-declared exclude allowlist

- Hand branch `hands/w1b-rlr/136`, base `a5ff00469280f5e360b045db628f2c42db1b8193`, head
  `91ca8706801c27b1c9c6e54b150ae28dbc838a53`. `diff --stat`: 7 files, +219/-26
  (`scripts/hetero-review-loop.js`, `scripts/check-phase-review-receipt.js`,
  `scripts/lib/exclude-allowlist.js` + their 3 codex mirrors, `hooks/tests/review-loop-resolver-b.test.sh`).
- Review: `claude-native`/`claude-fable-5-1` → **SHIP-AS-IS**. Three 🔵 suggestion-only findings, all
  explicitly excluded by the reviewer as spec-consistent behavior or optional hardening (top-level dir
  without `/` in the pre-`/**` core is dropped by design to keep `src/**` rejected per spec; markdown
  decoration tolerance in row parsing is optional; extension check applies to the row text as spec requires).
  Accepted as-is — none are correctness or security regressions.
- Verify (in worktree `/tmp/hetero-hands-w1b-rlr-136-nI5a3i`): `hetero-review-loop.test.sh` PASS (208
  assertions), `check-phase-review-receipt.test.sh` PASS (68 assertions), `review-loop-resolver-b.test.sh`
  PASS (45 assertions), `check-js-syntax.js` PASS (682 files).
- No repair needed. Nothing outstanding.

## Row 137 — hetero-review-loop pre-computed agy seat payload ceiling

- Hand branch `hands/w1b-rlr/137`, base `91ca8706801c27b1c9c6e54b150ae28dbc838a53`, head
  `39c2a9828751cfef727c35b9eca721be24ebcbad`. `diff --stat`: 3 files, +117/-0
  (`scripts/hetero-review-loop.js` + codex mirror, `hooks/tests/review-loop-resolver-b.test.sh`).
- Review: first `dispatch-review.sh` call returned `no_verdict` ("no derived BEGIN frame found in
  response" — tool-call-shaped text instead of a verdict). Retried once per the WAVE-1b override, appending
  "You have no tools. Answer only with the verdict JSON." to the spec file → `claude-native`/`claude-fable-5-1`
  → **SHIP-AS-IS**. Three 🔵 suggestion-only findings (unverified pre-existing `assert_file_absent` harness
  helper — confirmed by the tests actually passing rather than vacuously; `--runner` flag-coupling in the
  test stub; `python3` fixture-generation dependency vs. a pure-shell alternative). All accepted as
  non-blocking; no correctness/security defect.
- Verify (in worktree `/tmp/hetero-hands-w1b-rlr-137-h4ChDw`): `hetero-review-loop.test.sh` PASS (208
  assertions), `review-loop-resolver-b.test.sh` PASS (49 assertions), `check-js-syntax.js` PASS (682 files).
- No repair needed. Nothing outstanding.

## Aggregate

Running head after all 3 rows: `39c2a9828751cfef727c35b9eca721be24ebcbad` (branch `hands/w1b-rlr/137`).
Accepted-heads trail: `2ec76a22...` (shadow base, never lands) → `a5ff0046...` (131) → `91ca8706...` (136) →
`39c2a982...` (137). No version/CHANGELOG/BACKLOG/doc edits made. No merges performed. Depth-0 lands
(cherry-picks the hand commits; the local-only mission-mode shadow commit `2ec76a22...` must NOT land).

## Per-row lines

LAND 131 a5ff00469280f5e360b045db628f2c42db1b8193
LAND 136 91ca8706801c27b1c9c6e54b150ae28dbc838a53
LAND 137 39c2a9828751cfef727c35b9eca721be24ebcbad
