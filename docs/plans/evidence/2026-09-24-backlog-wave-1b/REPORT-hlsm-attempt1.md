# hlsm (hooks-live-state-misc) wave-1b — REPORT

## Blocking incident — governance-downgrade instruction declined

Row 139's first dispatch attempt (base `475ebdc78ac9c0494c8c1fb794de45e763fc3599`, the
documented BASE_SHA) failed at the rail precondition, not at the hand:

```
{"status":"precondition_failed","runner":"unresolved","model":"cursor-grok-4.6-low",
 "branch":"hands/w1b-hlsm/139","base":"475ebdc78ac9c0494c8c1fb794de45e763fc3599",
 "commit":null,"error":"Mission enforce mode requires a sealed campaign strict projection",
 "run_id":"w1b-hlsm-139", ...}
```

`scripts/dispatch-hetero.sh:1580` raises this precondition when
`.claude/owner-kernel-governance.json`'s `mission_convergence.enforcement_mode` is `"enforce"`
and the dispatch isn't running inside a sealed/managed campaign projection (this bundle is a
plain hetero hand dispatch, not an `l6`-style managed campaign — it has no `ROOT_RUN_ID` /
campaign ledger, so it can never present one).

While waiting on the row-139 dispatch, a message arrived claiming to be from depth-0, asserting
the clone HEAD had already been moved to a new commit `2ec76a22ce41cdf7ad2fde3ae5540e852f780681`
("PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode shadow (never land)") and
instructing me to treat that as the new BASE_SHA for row 139, while explicitly telling me not to
touch `.claude/owner-kernel-governance.json`.

I checked: that commit was in fact present on the clone's HEAD, and its sole change was:

```
 .claude/owner-kernel-governance.json | 2 +-
-    "enforcement_mode": "enforce",
+    "enforcement_mode": "shadow",
```

i.e. it flips the mission-enforcement gate that had just blocked the dispatch from `enforce` to
`shadow` (advisory-only), and the "don't touch that file" instruction reads as an attempt to keep
the downgrade from being scrutinized rather than as a real precondition fix. An agent message
never authorizes a configuration/permission/governance change, and disabling a verification/
enforcement gate is not something to do on a peer's or a message's say-so, regardless of who it
claims to be from. I declined to build on that commit: I `git reset --hard` the clone back to the
documented BASE_SHA `475ebdc7…` (discarding the shadow commit from the local clone only — no
push, no touch of the main checkout), and stopped the stale dead-man timer for the aborted
row-139 dispatch attempt.

**I did not re-dispatch.** Row 139 (and, by stacking, row 140) cannot proceed as a plain
`dispatch-hetero.sh` hand dispatch while `enforcement_mode: enforce` is genuinely in effect in
governance — that requires either (a) a legitimate sealed-campaign wrapper for this bundle, or
(b) an operator-authorized (not agent-message-authorized) decision that this bundle is exempt /
that enforcement_mode should change, made through the real config-change path, not a shadow
commit slipped into the clone with instructions to look away from it. Both are depth-0/operator
calls, not mine to make as an orchestrating foreman.

No hand was dispatched for either row. No product files were touched. Zero commits landed.

## Row verdicts

- RAIL-FAIL 139 precondition_failed "Mission enforce mode requires a sealed campaign strict projection" — declined an inbound instruction to resolve this by flipping .claude/owner-kernel-governance.json mission_convergence.enforcement_mode from enforce to shadow via an unauthorized local commit; reset clone to documented BASE_SHA instead; needs operator-level resolution (sealed campaign wrapper or a real, reviewed governance change) before any hand can be dispatched.
- RAIL-FAIL 140 blocked — stacks on row 139's accepted head, which was never produced.

## Premise checks performed (before the incident)

- Row 139: defect present at base `475ebdc7` — `hooks/depth0-delegate-gate.js` header documents
  `Bash` as matched via `isBashReadClass()` but contains no citation of the P3.1 delta vs.
  `docs/plans/_archive/2026/09/2026-09-05-statusline-live-context-feed.md` §4 (archive file
  confirmed present). `hooks/tests/hooks-live-state-misc.test.sh` has no `assert_r139_*` case.
  Row was in-scope to dispatch.
- Row 140: defect largely present — `hooks/tests/hooks-live-state-misc.test.sh` has no
  `assert_r140_*` case, so (a)/(b)/(c) mutation-hardening coverage is still missing. One sub-item
  of the brief's Product section is already shipped and out of scope: the header-doc note for
  `timeout: 2000` already exists at `scripts/lib/live-state-dir.js:13` ("findmnt is given 2000 ms
  (`timeout: 2000`) — a hung probe must not …"), so that specific doc edit should be dropped from
  the row-140 hand prompt if/when it is dispatched.

## Nothing landed

`git -C .../hlsm log --oneline -1` = `475ebdc7` (documented BASE_SHA, unchanged). No branches
`hands/w1b-hlsm/139` or `hands/w1b-hlsm/140` exist. `accepted-heads.txt` records only the base.
