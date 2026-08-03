# Repair Lineage Convergence

Status: complete

Plan: `docs/plans/2026-07-30-repair-lineage-convergence.md`

This is one P0 deliverable. It closes the retry pattern that produced eleven linear Kimi repair
branches for one P3 implementation lineage.

## Progress

- [x] Transcript and Git resource audit
- [x] Root-cause location in campaign controller and Grok dispatcher rail
- [x] Mission admission bootstrap (three pre-spend no-effect attempts; L3 fallback recorded)
- [x] Stable branch/worktree repair implementation
- [x] Grok exact-session resume and provider non-reuse receipts
- [x] Finding recurrence and two-round non-reduction stop-loss
- [x] Durable compaction/resume resource lineage
- [x] Lease-required retained worktrees and clean terminal cleanup
- [x] Focused regression suites and final 256-file full-suite pass
- [x] Depth-0 joint review
- [x] Merge, push, terminal cleanup, and historical branch disposition

## Verification

- `dispatch-hetero.test.sh`: 180 assertions
- `dispatch-worktree-lifecycle.test.sh`: 134 assertions
- `autopilot-engine.test.sh`: 464 assertions
- `implementation-campaign-state.test.sh`: 253 assertions
- `implementation-campaign-routing.test.sh`: 45 assertions
- `implementation-campaign-dogfood.test.sh`: 20 assertions, including SIGKILL/resume
- Full suite: 255 unaffected files passed in the final run; the sole failed
  action-catalog fixture was synchronized and then passed its targeted rerun.
  The preceding full run passed all 256/256 files.

## Implemented decisions

- Stable branch/worktree identity applies to every managed implementer runner.
- Retained reuse passes an inode/device/birth-time instance digest into the
  dispatcher and verifies it under the lifetime lock before runner execution.
- Grok is the first verified provider-session adapter and resumes an exact UUID.
  Other runners keep checkout continuity and report an explicit non-reuse reason.
- Retention is a marker-backed lease with owner, reason digest, and expiry; bare
  `--keep-worktree` is rejected before branch, checkout, or runner creation.
- Durable candidate references carry repair resource identity, so campaign
  resume validates Git tip/tree/ancestry plus the retained checkout and branch.
- Recurring normalized findings stop after one bounded repair. Distinct or
  renamed findings also stop after two repair rounds without count reduction.
- Provider-reported input tokens are recorded when present; otherwise the
  receipt reports token measurement as unavailable and still records exact
  new-input bytes.

## Joint review disposition

- `gpt-5.6-sol` xhigh found five focused cleanup/state blockers. All five were
  reproduced and fixed: prior-intent-only crash recovery, one serialized cleanup
  transaction seam, pre-runner instance fencing, coherent zero-dispatch terminal
  lineage, and post-dispatch repair-counter mutation.
- `grok-4.5` high independently checked the same six frozen blocker families and
  returned `SHIP-AS-IS`; its output included a preamble before the nonce block,
  so the mechanical parser correctly retained the run as `no_verdict` and the
  raw result is supporting evidence rather than an authoritative gate pass.
