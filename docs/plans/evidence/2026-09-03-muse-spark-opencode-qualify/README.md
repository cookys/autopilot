# muse-spark-1.3 (OpenCode Go contributor tier, `--runner opencode`) implementer qualification — QUALIFIED 24/24 (2026-09-03)

First administration over the new opencode rail (`docs/plans/2026-09-03-opencode-implementer-rail.md`),
via `scripts/qualification-sweep.sh --roster roster.json --execute`; same generator / corpus /
grader pins as the 2026-08-22 sweep. Result: **qualified**, `corpus_pass: 24/24`, capability_score
1.0, every family 4/4.

- **Scorecard event 187**; qualification-evidence store event 334. Expires 2026-12-02 (advisory).
  `seat-status` → `admission_status: qualified`, seat_hash `14cbfb7f…`.
- **Identity**: engine/model `opencode-go/muse-spark-1.3-contributor`, model_version
  `opencode-go:muse-spark-1.3-contributor` (the sweep's strict-TOKEN derivation of the id, `/`→`:`),
  runner `opencode` (opencode 1.18.25 → runner_version `1.18.25`), family `meta`, effort `high`
  (label only — this route has no effort flag), harness `dispatch-hetero:1eeb3cac`,
  `--version-source operator-asserted`.
- **Deployment examined**: Meta Muse Spark 1.3 reached through the OpenCode Go plan's contributor
  tier (opencode's own auth; no endpoint definition involved). llm-playground registers the same
  cell as `opencode/muse-spark-1.3-contributor` (`access = "opencode-go"`); the direct-api route
  (`meta/muse-spark-1.3` via Vercel AI Gateway) was NOT examined.
- **Fingerprints**: prompt_config_hash `16b45e1a…`, semantic_fingerprint `d8af5290…`,
  containment_fingerprint `2c1042fc…` (`contained: true` on the Stage-0 probe) — byte-identical to the
  2026-08-22 sweep and to the flash-next bundle, so the row is directly comparable.
- **Efficiency**: 24 cases, 580 s dispatch wall (min/median/p90/max 18/22/32/34 s); seat wall 600 s.
  Slower per case than flash-next (14 s) and sonnet (16 s), faster than luna (26 s). Usage is `null`
  on this rail (BACKLOG: parse `step_finish.tokens`).
- **Attempt history (append-only, honest)** — three probe receipts, ONE recorded administration:
  1. Attempt 1: Stage-0 probe committed (real dispatch over the rail, 1 charge); administration bounced
     at argv — `--engine must be a protocol token` (the id carries `/`). Zero case dispatches.
     `muse-spark-1.3-qualify/qualify-err.attempt1-argv-bounce.log`.
  2. Attempt 2: probe committed; **all 24 cases dispatched**, then refused at the evidence step —
     `identity.model_version must be a bounded protocol token` — because argv had been loosened past
     the compiler's grammar. **No row; 24 case dispatches charged against the Go plan for nothing.**
     `qualify-err.attempt2-identity-bounce-after-24-dispatches.log`. Fixed in `b107d936` (argv rejects
     exactly what the compiler rejects; the sweep derives the version token).
  3. Attempt 3: probe committed; 24/24; row recorded. This bundle's `qualify-out.json` / `raw/`.
- **Construct scope**: same honesty clause as the 2026-08-22 bundles — contract-obedient commit
  production over the dispatch-hetero rail. Not claimed: multi-round review-loop convergence, L-size
  planning, cross-runner transfer (the direct-api route is a different deployment).
- **Files**: `roster.json`, `sweep-stdout.attempt1.log`, `sweep-stdout.attempt2.log`, `sweep-stdout.log`
  (attempt 3), `qualification-sweep-progress.txt`, `muse-spark-1.3-qualify/{probe-receipts.jsonl,
  qualify-out.json, qualify-err.log, record-out.json, record-err.log, raw/}`.
