# `peer-addressing.md` says message rows live forever; a spec says 7 days

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: hangar-bridge implements message-row retention. Today it has not — `packages/relay/src/purge.ts` deletes only `token` and `human` rows, `message` has no trigger or CASCADE, and a repo-wide search finds no `DELETE FROM message` — so the doc's "durably means indefinitely" is currently accurate.
- **Context**: `hangar-bridge/SUBJECT_ROUTING_SPEC.md:516,614` records an accepted 7-day retention/replay bound for subjected `@team` chat that was never built. If it ships, `references/peer-addressing.md`'s persistence paragraph goes stale in the direction that matters — it would be promising permanence that no longer exists.
- **Effort**: XS (one clause), but only correct after the code lands.
- **Source**: `autopilot:reviewer` round 4 on `0d3554e3`, 2026-09-01.


