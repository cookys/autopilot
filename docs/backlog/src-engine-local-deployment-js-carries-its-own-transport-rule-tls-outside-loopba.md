# `src/engine/local-deployment.js` carries its own transport rule (TLS outside loopback) — align with `resolve-endpoint.sh` before it gets a live caller

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: `dispatch-local-openai.js` / `probe-local-engine.js` gain a caller on a real rail, or a second transport-policy divergence between the two is reported.
- **Context**: the named-endpoint resolver now owns the transport policy (loopback + disclosed `plaintext-private` for private-range IP literals). `local-deployment.js` still enforces "authenticated TLS outside loopback" with no opt-in and no `transport_security` disclosure; today it has no live callers so the divergence is dormant. Either make it consume `resolve-endpoint.sh` (credential_endpoint already references a named endpoint) or delete the duplicate rule.
- **Effort**: Fix
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)

