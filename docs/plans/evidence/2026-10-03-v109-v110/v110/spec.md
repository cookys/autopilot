# Readiness probe: a nonce-exact single-line frame (`OPEN OK CLOSE`) is reported as frame_missing → transport_failure

Source: PEER-REPORTED by cuda/chatgpt-tunnel via fleet, 2026-10-03 (message 01M3Z60BJDY7JVW7MVR6H8NZGX): claude-native / claude-fable-5 / max, two real probe attempts each returned 110 bytes with opening marker + `OK` + closing marker on ONE line; manifest final_status=truncated; coordinator generalized to unknown/transport_failure; Sol's identical probe was ready. Peer evidence on cuda: `/data/rw3d-evidence/2026-10-02/ea-delivery/Q01/PRODUCT-PLAN-G1/FAILURE-DIAG` (raw sha256 b79b603e…, 5a57d20a…). Code path verified by reading: `scripts/dispatch-author.sh:1426` (`truncated` / `frame_missing` exit 5), `src/readiness/live-probe.js:24-33` (one compliance retry, then unknown).

- **Trigger**: FIRED — queued; reproduce first with a stub runner emitting the single-line frame.
- **Context**: do NOT loosen the general parser. Options: (a) for the readiness probe only, accept exactly `^<open-marker-with-nonce>OK<close-marker-with-nonce>$` (nonce must match, payload must equal the expected token) — a strict extra form, not a relaxation; (b) classify "both nonce markers present but not on separate lines" as a named `frame_format` failure instead of transport_failure, and keep stderr + the dispatch-result envelope in the probe receipt so the operator can see it. (b) is needed regardless; (a) needs operator agreement that it is not a parser relaxation.
- **Effort**: S


Note: operator approved (a) as a strict probe-only extra form (nonce-exact single-line OK), not a parser relaxation; (b) frame_format classification + diagnostics kept in receipt.
