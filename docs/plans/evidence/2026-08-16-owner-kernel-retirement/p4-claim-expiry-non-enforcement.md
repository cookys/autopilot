# KR4 case (c) — claim-expiry runtime enforcement: none exists

Verified 2026-08-16 on retire/owner-kernel (base develop 3fd980b6), per plan P4 step 2.

## Sweep

`grep -rn "expires_at|freshness" src scripts` — every hit classified:

| Site | What it is | Enforces cap-v1 claim expiry at /l5 runtime? |
|---|---|---|
| `scripts/platform-capability-claims.js:242,302-304` | claim AUTHORING tool: constructs `freshness.expires_at` and shape/digest-validates it when (re)signing claims | No — zero `require()` consumers in `src/`, `scripts/`, `bin/` (verified); never on the dispatch path |
| `src/readiness/probe.js:446`, `src/readiness/receipt.js:320,354` | LIVE-probe observation freshness + readiness-receipt TTL (`provider_readiness_receipt_ttl_seconds`) | No — this is probe-observation freshness, a separate system that remains fully active |
| `scripts/dispatch-hetero.sh:815,1171` | run-marker TTL (`started_at`/`expires_at` on session markers) | No — unrelated to capability claims |
| `scripts/import-aa-capabilities.js:390,442` | evidence TTL stamping for imported AA capabilities | No — import-time metadata |
| `src/readiness/provider-bootstrap.js` | `STRICT_L5_CLAIM_IDS` are compile-time hash constants; the D4 claim FILES (and their `freshness.expires_at`, incl. the 2026-08-17 date) are never read at runtime | No |

## Conclusion

The "2026-08-17 claim expiry hard block" exists only inside the claim-authoring
tool's own validation, which runs when someone re-signs the claim set — not on
any /l5 dispatch path. KR4 case (c) is therefore satisfied by this record: there
is no enforcement site to downgrade. Roster-identity advisory behavior (cases
a/b/d) is enforced and tested in `hooks/tests/provider-readiness-consumer.test.sh`
and `hooks/tests/autopilot-cli.test.sh`.
