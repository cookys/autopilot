# A campaign's `output_paths` must enumerate every codex mirror, and the rejection arrives after the model has done the work

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Status 2026-09-13**: **SHIPPED v2.36.36** (depth-0 adjudicated: this rule fell between the round-2 and round-3 review diffs, so no decorrelated seat read it; `mission-policy-graph.test.sh` pins refuse/accept/prefix-trap/nesting) — `mission-execution-graph-check.js --mirror-roots <(scripts/sync-codex-plugin-skills.sh --mirror-roots-json)`; exact-path rule on `campaign.output_paths`, refused at graph-check time.
- **Trigger**: `boundary_rejected: changed path 'platforms/codex/plugin/...' is outside sealed output surface`.
- **Measured 2026-09-12** on the same graph. The `p1-integration-receipt-sha-ledger` node listed `schemas/merge-execution-receipt.schema.json`, `src/merge/cli.js` and `scripts/record-integration.js` in `output_paths`, plus the codex mirror of the new script — but not the mirrors of the schema or of `src/merge/cli.js`. `scripts/sync-codex-plugin-skills.sh` mirrors `bin src profiles schemas evals/clean evals/known-bad hooks/_shared references scripts project-config-template`, and the node's own `verify_cmd` runs `sync-codex-plugin-skills.sh --check`, so the implementer was **required by its verification to touch paths its contract forbade**. It did the work, wrote nine files, and the whole round was discarded at the boundary check.
- **The authoring error is mine, but the shape is a trap worth a mechanism**: a graph author enumerates the files they are thinking about, while the mirror set is a property of the repo. Candidate fix: a graph-check rule that, for every `output_paths` entry under a mirrored root, requires the corresponding `platforms/codex/plugin/` path to be present too — refusing at `mission-execution-graph-check.js` time, which is free, rather than after a paid implementation round.
- **Effort**: Fix for the graph-check rule.
- **Source**: /l5 dogfood, 2026-09-12.

