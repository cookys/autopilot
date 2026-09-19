# REPORT — unit L (leasegc)

## Branches
- r1: `hands/par5-l/leasegc-l` @ `a5299a4c` (base `964aaa4a`) — 6 files, +457/-3
- r2 (repair): `hands/par5-l/leasegc-l-r2` @ `edaac2c3` (base = r1 head) — 3 files, +32/-4

diff --stat vs base (r1..r2 combined, i.e. base_sha..r2 head):
```
docs/scripts-inventory.md                                     |   2 +-
hooks/tests/reap-dispatch-worktrees.test.sh                   |  20 ++
hooks/tests/run-ledger-lease-gc.test.sh                       | 134 +++++++
platforms/codex/plugin/scripts/reap-dispatch-worktrees.sh     |  15 +
platforms/codex/plugin/scripts/run-ledger.sh                  | 151 ++++++++
scripts/reap-dispatch-worktrees.sh                            |  15 +
scripts/run-ledger.sh                                         | 151 ++++++++
7 files changed, ~489 insertions(+), 7 deletions(-)
```

## Review verdict
FIX-THEN-SHIP (claude-native/claude-fable-5-1, effort high) on r1 diff. 4 findings:
- 🟠 `reap-ledger-path` MUST-FIX — **accepted, real.** Hand hardcoded `$repo/.autopilot/run-ledger.jsonl` in the
  reap wiring; depth-0 verified the real host ledger is `.git/autopilot/implementation-campaign.jsonl` (confirmed
  by `ls` on the main checkout's `.git/autopilot/`) — `.autopilot/run-ledger.jsonl` does not exist anywhere on
  this host, so the wiring was a silent no-op (`-f` guard always false, `lease_gc` reports zeros). Fixed in r2:
  path now resolved via `git -C "$repo" rev-parse --path-format=absolute --git-common-dir` joined with
  `autopilot/implementation-campaign.jsonl`, same pattern already used by `mission-terminal-reconcile.js`. r2
  also added a fixture-ledger assertion (`hooks/tests/reap-dispatch-worktrees.test.sh`) pinning
  `.lease_gc.scanned` against a ledger placed at the real resolved path.
- 🟡 `gc-abort-midloop` CUT/FOLLOW-UP — refuted for this round (not blocking): `command_stage_transition` failure
  mid-loop aborts with no JSON; reap wrapper's `|| true` masks it as zeros. Real but scoped as a follow-up by
  the reviewer itself; not dispatched for repair. BACKLOG candidate, not filed by me — depth-0 to decide.
- 🔵 `flock-pin-loose` CUT/FOLLOW-UP — refuted/non-blocking, reviewer's own read: predicate (c)'s directory-absence
  check already makes the `lockHolderPid` branch redundant in the pinned test case; behavior is still correctly
  pinned (dead-pid + live-flock lease skipped, appended=0).
- 🔵 `hb-rows-rotated` CUT/FOLLOW-UP — refuted/non-blocking: heartbeat rows older than last rotation are invisible
  to lease-gc; reviewer judges this rare given 12h TTL + predicate (c) and does not block.

One repair round dispatched (r2) for the 🟠 finding only, per the "at most one repair round" budget. Not
re-reviewed by a second heterogeneous pass; instead I verified the r2 diff and full suite green myself.

## Verify (run in the r2 worktree, all exit 0, `< /dev/null`)
```
bash hooks/tests/run-ledger-lease-gc.test.sh        rc=0
bash hooks/tests/run-ledger-rotation.test.sh        rc=0
bash hooks/tests/run-ledger-rotation-order.test.sh  rc=0
bash hooks/tests/reap-dispatch-worktrees.test.sh    rc=0
bash hooks/tests/run-ledger-directive.test.sh       rc=0
bash hooks/tests/dispatch-detach.test.sh            rc=0
bash hooks/tests/campaign-claim-resolve.test.sh     rc=0
bash hooks/tests/implementation-campaign-dogfood.test.sh  rc=0
bash scripts/sync-codex-plugin-skills.sh --check    rc=0
node scripts/check-js-syntax.js                     rc=0
node scripts/check-claude-md-inventory.js           rc=0
```

## Consumer sweep
`grep -l 'lease.gc\|lease_gc' hooks/tests/*.test.sh` beyond the Verify-list suites returned nothing extra — no
red consumers found.

## Not done / notes for depth-0
- Wiring script chosen: `scripts/reap-dispatch-worktrees.sh` (`reap` subcommand only, gated on
  `command_name = "reap"`), per brief's pick-the-one-right-place instruction.
- BACKLOG row text ("109 runs leased since July keep the ~2 MB carry alive... `.git/autopilot/implementation-campaign.jsonl`")
  is correct for the carry mechanism; but the r1 hand initially wired the reap script to the WRONG default path
  (`.autopilot/run-ledger.jsonl`, `run-ledger.sh`'s bare code default when no `--ledger` is given) instead of the
  real deployed path — fixed in r2. I confirmed the real path only via `ls .git/autopilot/`, not by running
  `lease-gc --json` against the live ledger (out of scope: "never touch the host's `.git/autopilot/` ledger").
  Depth-0 may want one more sanity check before merge.
- 🟡 `gc-abort-midloop` finding is a legitimate hardening gap (mid-loop transition failure not tolerated) —
  recommend a BACKLOG row if not already tracked; not filed by me (foreman scope).
- Cursor hand used `--effort low` both rounds per brief; wall times 667s (r1) + 279s (r2).
