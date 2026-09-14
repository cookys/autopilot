# `mission withdraw` cannot bind a `mission-subject-v2` claim to its ICC campaign — the intake journals no mission binding

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any operator calling `mission withdraw --campaign-ledger <real ICC ledger>` on a claim minted by `grantMissionCampaign` (`identity_scheme: 'mission-subject-v2'`) whose campaign DID run; or the next time `campaign-intake.js`'s intake artifact schema is touched.
- **Context**: the claim id is `campaign-v2-<domain sha of the subject>` (`src/engine/mission-campaign-identity.js`); the ICC intake row is keyed `campaign-v1-<sha of repo, ticket, raw contract bytes>` (`src/engine/campaign-intake.js` ~1664) and `createCampaignState` keeps only ticket/profile/limits — no claim id, no `mission_grant_ref`, no subject digest reaches the ledger. **v2.36.6** did NOT close this (a contract-digest bridge was tried and reviewed as inert: subject digest ≠ raw byte digest); it added the never-started exit (`--never-started true`, refused when the ledger holds any intake root for the claim's own ticket — `mission_withdraw_campaign_ticket_present`). Fix shape: journal `mission_claim_id` + `mission_campaign_id` on the intake artifact (`INTAKE_ARTIFACT_KEYS` is exact-keys in both `campaign-intake.js` and `campaign/cli.js`, so this is a schema bump with a compat read for old rows), then resolve by that exact fact and apply the terminal rule.
- **Effort**: S–M (schema bump + two validators + compat + e2e with a real v2 grant fixture)
- **Source**: U4 foreman 2026-08-31; cuda revival.3d QUIET-a 2026-09-06; v2.36.6 pre-merge review (opus) 🔴 C1.

