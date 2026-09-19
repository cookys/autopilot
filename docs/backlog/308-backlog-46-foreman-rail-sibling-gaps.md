# 308 BACKLOG #46 — foreman rail 多軌 sibling 缺口

Source: 308 repo BACKLOG #46, HANDOFF 09-20 ("多軌 rail 缺口 autopilot 側"). Three gaps observed
2026-09-17/18 in `scripts/dispatch-foreman.sh` and `scripts/lib/main-checkout-boundary.sh`.

## Gap 1 — parallel hands on one foreman worktree reject each other

A foreman that dispatches several `dispatch-hetero.sh` hands in parallel from the same worktree
gets `boundary_rejected` / `main_checkout_mutated`: each hand's own fingerprint only exempts its
OWN `--branch`, so a sibling hand's branch moving mid-round is a mutation. Fix:

- `dispatch-foreman.sh`'s `protocol.md` now tells the foreman to pass
  `--sibling-ref-prefix refs/heads/hands/<run>/` (and its own `--sibling-path-prefix <dir>/`) to
  every `dispatch-hetero.sh` it runs in parallel.
- `FOREMAN_ENV` (what every hand inherits) now carries
  `AUTOPILOT_DISPATCH_SIBLING_REF_PREFIX=refs/heads/hands/<run>/` as a default.
- `scripts/lib/main-checkout-boundary.sh` gained `main_checkout_seed_sibling_env_defaults`,
  which appends `AUTOPILOT_DISPATCH_SIBLING_REF_PREFIX` / `_PATH_PREFIX` (colon-separated) into
  the existing `MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES` / `_PATHS` arrays, validated the same way as
  the CLI flags. `dispatch-hetero.sh` calls it right after sourcing the lib (2-line change).
  CLI flags still apply and simply add to the same arrays — the env var never overrides them.

## Gap 2 — two concurrent foremen on one repo reject each other

Each foreman's own `refs/heads/foreman/<run>` and `refs/heads/hands/<run>/*` count as a mutation
for a SIBLING foreman's fingerprint (only the run's own namespace was ever exempt). Fix:
`dispatch-foreman.sh` gained `--sibling-ref-prefix` / `--sibling-path-prefix` (repeatable), same
flag names and validation as `dispatch-hetero.sh`'s (the validators were extracted into the
shared lib as `main_checkout_validate_sibling_ref_prefix` / `_path_prefix` so both rails use one
implementation). An operator dispatching two foremen concurrently declares each one's namespace
to the other. This does NOT auto-detect "other live runs" — the lib's design comment is explicit
that exclusion is caller-declared, not discovered by the fingerprint (a stat walk by design); the
smallest change consistent with that design is the explicit flag, not a live-run registry.

## Gap 3 — the boundary error doesn't name the depth-0 rule

A depth-0 merge/commit on the main checkout while a foreman is running trips
`main_checkout_mutated` by design (308 SOP: depth-0 must not touch the main checkout while a
hand/foreman is in flight). Behaviour unchanged; the `ERROR` string and `protocol.md` now both
name this rule in one sentence so an operator reading the JSON understands it is not a run bug.

## Verification

`hooks/tests/dispatch-foreman.test.sh` test 13 covers all three (protocol text, env default,
control/fix pair for two concurrent foremen, CLI validation). Manually re-verified against the
real (non-stub) `dispatch-foreman.sh` / `dispatch-hetero.sh` in a throwaway sandbox repo for all
three gaps (control rejects, declared-sibling / env-default both pass). The local
`hooks/tests/run.sh` invocation of this file has a pre-existing, unrelated failure on a clean
`develop` checkout (`legacy-scorecard-test-projection.cjs` / `TEST_TMP` disappearing mid-run,
consistent with concurrent activity on a shared host) — not caused by this change.
