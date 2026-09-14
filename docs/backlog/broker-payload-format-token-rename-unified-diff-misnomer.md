# Broker payload format token rename (unified_diff misnomer)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: Next time the broker client protocol version bumps for any reason, or before onboarding a fourth non-diff payload family.
- **Context**: `qualification-case-broker.js` hardcodes `payload.format: unified_diff` in its sandbox client; brain round bundles (v2.34.14) and VA spec envelopes (v2.34.17) ship JSON content under that diff-named token (VA plan G1-F11; the reviewer noted the misnomer risks being rediscovered as a bug). Renaming means a coordinated broker+provider+engine-qualify change and a client-protocol version bump — pure hygiene, zero behavioral effect today (the field is an opaque constant all three parties pin).
- **Effort**: S.
- **Source**: VA suite plan v3 §6 (G1-F11 deferral); v2.34.17 pre-merge review.

