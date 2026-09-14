# Campaign bridge resolves lease identity from `campaignControl.initial_state` — correct today only because every append refreshes it

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any change to `recordCampaignEvent` / the campaign event appender that stops assigning `campaignControl.initial_state = appended.state` (`src/engine/autopilot-engine.js:~4557`), or a second appender path that bypasses it.
- **Context**: `onCampaignEvent` (`autopilot-engine.js:~6487`) calls `resolveCampaignEventLeaseIdentity(campaignControl.initial_state, …)`; the field name says "initial" but it is the live journal-replayed state because the closure refreshes it on every append. Two reviewer seats flagged the naming as a latent no-op risk (rail-fix qc, 2026-08-30). Rename to `live_state` (or read from the journal replay) and add one end-to-end fixture that drives BOUNDARY_REJECTED through the real bridge after IMPLEMENTATION_STARTED.
- **Effort**: S
- **Source**: rail-fix qc panel 2026-08-30 (gpt-5.6-sol 🟠 downgraded after verification; GLM-5.2 🔵).

