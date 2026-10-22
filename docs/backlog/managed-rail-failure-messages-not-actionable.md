# Managed-rail failure messages do not say what to do

Reported by codepower twgs-revival (report 01M59ZPRRAH8CGMG59HHD8816N, reply 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX).

- Managed rail failure messages are not actionable.
- provider_readiness does not say a 401 happened or that a re-login is needed.
- "no qualified scorecard row" does not say which seat or which host.
- After a failure the grant is released and must be re-granted by hand.

## Status 2026-10-23

Fixed by bf611fd7b (railintake): a released grant carries operator_action (seat, host, re-login hint, re-grant by hand); readiness failure names the host and the re-probe step. Left: the "no qualified scorecard row" text in scripts/dispatch-contract.js, pinned by tests, an owner decision (BL-0249).
