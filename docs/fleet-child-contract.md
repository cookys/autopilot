# Fleet child-process contract

Claude-family children that autopilot launches (review seats, hands, probes, eval and profile runs) must declare
themselves to fleet as short-lived workers, not interactive sessions. Without this, fleet registered them as
interactive sessions and the aimax395 roster accumulated about 200 stale entries.

Source: peer report from openclaw hangar (report 01M5A264B59E7ETAETJRAEBXJQ, converged in 01M5A28T490XEBJMD51RD5KNRM,
reply 01M5A27RA0AFGZ3WCDYFVWQK5X), 2026-10-19; fleet commit 650f649 took effect on aimax395 the same day.
This contract was taken from that exchange and has not been checked against fleet source.

## Variables

| Variable | Value | Who sets it |
|----------|-------|-------------|
| `FLEET_LIFETIME` | `ephemeral`, always; an inherited value is overridden | the launcher, at `child_session_mint` |
| `FLEET_PARENT` | the parent's fleet address if known; otherwise an inherited `FLEET_PARENT`, else the launching CC session id | the launcher |
| `FLEET_ROLE` | display only: `hand`, `review-seat`, `probe`, `eval-run`, `profile-run`; fallback `child` | the launcher (optional argument) |

## Rules agreed with hangar

- An explicit `FLEET_LIFETIME` always wins over entrypoint inference; a child is never promoted to durable.
- Fleet records only parent, role, run_id, started_at and an optional expected_wall_s.
- Fleet no longer finds the parent through `AUTOPILOT_PARENT_SESSION_ID`.
- With fleet 650f649, `FLEET_*` children and non-TUI Claude sessions become ephemeral and drop about 10 s after disconnect.
- Every claude-family launch site also passes `--strict-mcp-config`.

Implementation: `child_session_mint` in `scripts/lib/repo-identity.sh`; test: `hooks/tests/fleet-child-contract.test.sh`.
