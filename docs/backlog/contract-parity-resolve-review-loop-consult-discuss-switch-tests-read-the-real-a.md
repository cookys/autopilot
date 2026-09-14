# `contract-parity` / `resolve-review-loop-consult-discuss-switch` tests read the real `~/.autopilot/topology.json`

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next time either test goes red on one host and green on another with the same tree (2026-09-07: red on this host for three days because the host cache carried two legacy `effort: ""` rungs; the fix landed in v2.36.16 but the *test* still depends on host state — the consult-seat drift allowance in the switch parity is host-dependent for the same reason)
- **Context**: both tests resolve the shipped template with `implementer_ladder: auto` / `consult_dispatch: auto`, so the resolver reads whatever topology cache the host has. `resolve-review-loop.test.sh` already shows the hermetic pattern (`AUTOPILOT_TOPOLOGY_FILE` pointed at a fixture per case); port it. Related: the stale-cache item above (regenerate-or-warn) would shrink the blast radius but not the test's host dependence
- **Effort**: S
- **Source**: v2.36.16 (2026-09-07), CHANGELOG「未做」

