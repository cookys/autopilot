# Rubric — BL-0194 qualification registry move

- R1: [single-store] After the final phase there is exactly one authoritative store of exam records, and the plan names the mechanism that proves no second silent writer remains.
- R2: [admission-independent] Admission of a seat depends only on locally re-derived identity and local strike state; metrics, the feed and the cache can never admit, deny or silently un-admit a seat, online or offline.
- R3: [no-loss-write] No exam result or strike can be lost or duplicated when the network, the ingest or CI fails at any step of the write path, and the plan shows how that is tested.
- R4: [schema-sound] The feed schema is unambiguous and consumable: fields have defined types, units, rounding and null semantics, kinds never mix, unknown is never zero, and the compatibility story for existing consumers is explicit.
- R5: [phases-shippable] Each phase leaves both repos working and shippable on its own, with explicit ordering and dependencies, and the single breaking step is clearly isolated and gated.
- R6: [enforced-not-advised] Each rule the plan states is enforced by a mechanism that fails when the rule breaks, and each new check names a negative control that can fail.
- R7: [offline-and-stale] Behaviour when the feed is unreachable or stale is defined and advisory-only (warn, never block), with bounded staleness that is observable.
- R8: [disclosure-safe] The published feed leaks no infrastructure detail (hostnames, paths, endpoints) and carries no trust machinery (ADR-0001); the plan states how both are checked.
- R9: [scope-honest] The plan's scope, file map, sizing and out-of-scope list are consistent with each other and with the current code; claims about existing scripts and files are true.
