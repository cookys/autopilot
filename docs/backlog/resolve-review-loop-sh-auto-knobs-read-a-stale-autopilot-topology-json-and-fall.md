# `resolve-review-loop.sh` `auto` knobs read a stale `~/.autopilot/topology.json` and fall back natively

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a host whose cached topology predates a plugin version that added roles (observed 2026-09-04: cache without `consult_ladder` ⇒ `consult_resolved_from: native-fallback` until `resolve-dispatch-topology.js` was re-run)
- **Context**: the resolver never regenerates the cache; `sync-all.sh` runs `--check` only. Candidate: regenerate when the cache lacks a role key the resolver asks for, or emit a distinct warning naming the stale cache
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D1.md`

