# No supported withdraw for a never-granted DRAFT Mission adoption; graph revisions mint unbounded lineages

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: next time a frozen execution graph must be revised before or between grants (three adoptions now exist for `qualification-verdict-stability`: 2e784929 DRAFT, 83828e5e ACTIVE with an unreleasable live claim, 420ac261 current).
- **Context**: `mission prepare` binds the adoption key to {repo_identity, intent, acceptance hashes} (`src/engine/mission-policy.js:195-233`) and pins the graph digest; revising the graph re-derives the same key and fails `MISSION_BINDING_MISMATCH` (`src/mission/runtime.js:781-787`). `successor` needs a terminal source and re-runs the same graph (`:902-907`, `:952`); `rollover` needs COMPLETE. The only way forward is perturbing the intent (graph digest folded into `requirements_hash`, commit 5402cbd5). Add `mission withdraw --prepared <receipt>` refusing unless zero claims and zero events; also a release path for a claim whose campaign was killed mid-flight (attempt-3 claim c434b7f9 stays live).
- **Effort**: S
- **Source**: mission-lineage authoring 2026-08-29 (commits 0279dccc, 5402cbd5, 500703b1).

