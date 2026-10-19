# Child processes must declare lifetime and parent to fleet

Reported by openclaw hangar (report 01M5A264B59E7ETAETJRAEBXJQ, converged in 01M5A28T490XEBJMD51RD5KNRM, reply 2026-10-19 01M5A27RA0AFGZ3WCDYFVWQK5X).

- Claude-family children that autopilot launches (review seats, eval runs) register in fleet as interactive sessions. The aimax395 roster accumulated about 200 stale entries. Fleet will honour only entrypoint cli and treat an explicit FLEET_LIFETIME as authoritative.
- Autopilot-side work (a): at the single junction `child_session_mint` in `scripts/lib/repo-identity.sh`, export `FLEET_LIFETIME=ephemeral`. `FLEET_PARENT` is the parent's fleet address, falling back to the CC session id when the address is unavailable. Optionally export `FLEET_ROLE` (display only, for example review-seat, hand, eval-run).
- (b) Audit every claude-family runner and confirm each passes `--strict-mcp-config`; add it where missing.
- (c) Register the new environment variables in `scripts/config-keys.json`.
- Converged contract with hangar: an explicit FLEET_LIFETIME always wins over entrypoint inference; a child is never promoted to durable; fleet records only parent, role, run_id, started_at and an optional expected_wall_s; fleet no longer finds the parent via AUTOPILOT_PARENT_SESSION_ID.
- Trigger-Type owner. Effort S. The operator decides when to start the autopilot-side work.
