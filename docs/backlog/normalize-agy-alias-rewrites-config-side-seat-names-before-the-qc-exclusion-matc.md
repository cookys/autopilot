# `normalize_agy_alias()` rewrites config-side seat names before the qc-exclusion match in `consult_dispatch: auto`

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a `qc_panel` entry written as an agy alias (e.g. `gemini-flash`) while the topology ladder carries the resolved name — the exclusion set never matches and a qc seat can be picked as the consult seat
- **Context**: found by the D4 hermetic test's first fixture (2026-09-04); the fixture was changed to a non-aliased name, the resolver was not. Fix: normalise both sides (or compare on the resolved tuple) in the exclusion builder
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D4.md`

