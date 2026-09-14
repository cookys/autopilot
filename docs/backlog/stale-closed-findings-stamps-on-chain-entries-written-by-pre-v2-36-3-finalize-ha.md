# Stale `closed_findings` stamps on chain entries written by pre-v2.36.3 finalize have no repair path short of a new generation

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a second field report of a receipt refused with "attributes … to generation N, which is aborted", or a request to re-finalize without re-collecting.
- **Context**: v2.36.3 made `review-chain-derive` evidence-only (chain-entry `closed_findings` stamps are output, ignored as input) and the checker refuses a receipt whose `closed_findings` names an aborted generation. The stamps the old derive wrote onto chain.json entries stay on disk (deep-equal with the receipt keeps them consistent) and are now inert, but the only way to get a fresh receipt is `collect` + `finalize` of one more generation — `finalize` refuses a generation that is not pending. Fix shape if wanted: `hetero-review-loop.js refinalize --generation <n>` that re-derives from the existing findings/dispositions of a finalized generation and rewrites receipt + stamps, refusing when any finding/disposition sha no longer matches.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066 ledger, 2026-09-05

