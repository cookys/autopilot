# Capability-claim identity is coupled to its observation timestamp

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: When a receipt refresh is next needed, or before adding a fourth consumer to `platform-capability-claims.js`.
- **Context**: `claim_id = sha256(claim body)` and the body includes `live_evidence.observed_at` + `freshness.expires_at`, while the required IDs are hardcoded constants in `dispatch-hetero.sh:1653-1654`, `dispatch-review.sh:169-170`, `post-compact.js` `REQUIRED_D3_CLAIM_IDS`, and three `platforms/codex/plugin/` mirrors. So re-probing — even a pure timestamp refresh — changes every ID and requires editing shipped product code at eight sites. Identity should describe **what is claimed** (consumer + capability + contract), not **when it was observed**; the observation is data the validator checks live. Separately: the receipt is live runtime input but lives in `docs/projects/_archive/` (a deliberate 2026-08-04 archive-closure choice — reversing it is a decision, not a cleanup).
- **Effort**: M
- **Source**: 2026-08-18 capability-receipt expiry investigation.

