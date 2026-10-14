# 2-D D1 (suite/panel station overlap) — declined 2026-10-14

D1 is not built. Two findings, both from 2026-10-14 at develop `ffd111df`:

## 1. The plan's premise does not hold and its own hard stop fires

- The plan (§4 D1 step 2) assumes the `fullSuite` and `reviewPanel` adapters are async and can be joined with
  `Promise.allSettled`. They are synchronous: `runCampaignComposition` (`src/engine/campaign-composition.js`) has no
  `async`/`await`, the engine calls `this.campaignComposer({...})` without awaiting, and `fullSuite` runs the suite
  through `spawnSync` (`defaultVerifyCommandRunner` in `src/engine/autopilot-engine.js`). Overlap would need either
  an async rewrite of the composition and engine, or a start/join split of `fullSuite` interleaved with the panel's
  seat batch. Neither is the "reorder only" change the plan sized.
- Hard stop (plan §3, `implementation-campaign.js` row): a freshly run `full_suite` writes no ledger row (only the
  cache-hit branch pushes one), and the panel's ledger unit is `full_diff_review`, not `dispatch_review`. KR1's
  ledger comparison has nothing to compare.
- Also unplanned: gate-journal reuse gives four reuse/fresh combinations per generation, and
  `reserveEffectInvocation` must run before dispatch, so "the composer is the only writer after the join" does not
  hold as written.

## 2. The saving is too small to justify either rewrite

Measured with `analyze.js` (read-only) over every controller checkpoint in this repo's
`<git-common-dir>/autopilot/controller-authority/`. The raw output is in `analysis-output.txt`.

| Measure | Value |
|---|---|
| Campaign roots / calendar days | 64 / 14 (2026-07-30 .. 2026-09-20) |
| `full_suite` gate entries | 15: 12 fresh, 3 cache hits (≤ 1 s) |
| Fresh suite seconds | median 258, max 1175 |
| Panel (`full_diff_review`) seconds | median 144 (20 entries) |
| Overlappable pairs (both fresh) | 12; saving `min(suite, panel)` median 71 s, total 1108 s |
| Share of campaign wall | 0.97 % of all roots; 3.13 % of the 12 overlappable roots; best single root 6.3 % |

All three cache hits come after `full_suite_reuse: true` appeared in campaign records (2026-09-18). With reuse on,
the suite is a cache hit and the overlap saves 0 s. The 12-pair figure is also an upper bound: it assumes the two
stations run fully in parallel on one host without slowing each other.

Limits: small sample (12 pairs, 09-11 .. 09-17); no checkpoints after 2026-09-20 on this host; panel times mostly
derived from `controller_effect_reserved` → `controller_effect_result` audit events because most gate entries
stamp start = finish.

## Decision

Close D1 and the BL-0016 row; the rest of the blind-review redesign shipped (1a-A..2-C, v2.36.59-69; 2-D D2,
v2.36.77). Reopen only if `full_suite_reuse` is commonly off **and** fresh suites dominate campaign wall. If it is
reopened, re-plan around the synchronous composition first.

The plan file itself is left byte-for-byte unchanged: `.claude/mission-routing-config.json`'s sources manifest pins
its sha (active mission lineage), so its status line still reads "frozen g2". This README is the closing record.
