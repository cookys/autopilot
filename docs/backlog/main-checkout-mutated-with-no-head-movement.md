# P4 round discarded as `main_checkout_mutated` though the reflog proves HEAD never moved

Status: UNVERIFIED hypothesis (no reproduction). Peer report (hangar, bundle docs/hangar-harvest-2026-10 ea8b40a95, 2026-10-23); source session d12f8e4c 2026-09-19T12:41. The observation is the peer's account and was not re-derived here; only the code facts under Hypothesis were checked against develop c38fc9620.

## Observation

2026-09-19, P4 campaign (kimi implementer): `boundary_rejected: main checkout mutated`, while `git reflog` showed
the main checkout's HEAD never moved. The only refs that changed during the round were the campaign branch (the
hands' own commit) and `refs/autopilot/lifecycle-roots/*`. P2b had the same shape and passed.

## Hypothesis

`scripts/lib/main-checkout-boundary.sh` fingerprints every ref except the dispatch's own branch plus
caller-declared sibling prefixes. Autopilot's own bookkeeping refs (`refs/autopilot/lifecycle-roots/*`, written
by `scripts/reap-dispatch-branches.sh`) changing mid-round could trip it. `grep lifecycle
scripts/lib/main-checkout-boundary.sh` is empty, so nothing excludes them today. Not confirmed: the usual cause
is another writer on the same `.git` (a second rail, or depth-0 committing or fetching in the main checkout; see
`skills/l5/references/hetero-impl-loop.md`, "Parallel units").

## Constraints for a fix

- Reproduce first (run a round while a lifecycle-roots ref is written) and keep the reproduction as the red case.
- Do not widen the exclusion without a negative control: a hands-written `refs/autopilot/x` must still be rejected.
