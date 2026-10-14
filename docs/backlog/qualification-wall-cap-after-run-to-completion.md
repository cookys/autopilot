# Qualification wall cap and truncation rules after run-to-completion

Source: review of 763f77de / ad5b1e87 (qualification run-to-completion), 2026-10-14.

- `scripts/engine-qualify.js:3750,3765`: the consult/discuss wall budget (1800 s × 3 administrations
  × 2) was sized when a sitting stopped at the first decided verdict. Every sitting now runs the full
  pool (60 consult / 48 discuss cases), so a slow candidate is more likely to hit the wall.
- After ad5b1e87: a decided `locked_fail` or `tier1` survives truncation as `failed`; an undecided pool
  (`stop_reason=continue`) that is truncated is `no_verdict`.
- Open question: a `locked_qualify` pool that is truncated stays `qualified`, although Tier-1 is now
  sticky and an unadministered case could have failed it. Decide whether that should be `no_verdict`
  (owner rule: "資格考應該要全部題目考完").
- Evidence to collect first: whether the 2026-10-14 re-sittings of consult/discuss produce any
  `wall_truncated: true` rows, and the per-case wall time per seat.
