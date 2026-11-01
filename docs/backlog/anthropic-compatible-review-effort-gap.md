# anthropic-compatible review seat: qualification sends effort, daily review does not (BL-0354)

Reported by the peace session over fleet, 2026-10-31.
Report 2026-10-31 01M68NQPQT7HPEH2RASE0FRB7B; reply 2026-10-31 01M68NRJW96J2C0S63KV08ZH8Y.

## Problem
- scripts/qualification-review-provider.js around line 897 sends `output_config.effort` in the request body.
- scripts/dispatch-review.sh around lines 1955-1970 builds the argument list for dispatch-anthropic-review.js and passes no effort at all.
- A seat whose runner is anthropic-compatible (for example GLM-5.3) is therefore qualified at high but reviews at the endpoint default effort. The qualification record and the real review sit in different partitions.

## Scope
- Only seats whose runner is anthropic-compatible.
- Seats routed through cc-shim (claude CLI `--effort`) are not affected. The autopilot GLM review seat uses cc-shim.

## Fix direction
- dispatch-anthropic-review.js accepts `--effort` and puts `output_config.effort` in the request body.
- dispatch-review.sh forwards the resolved effort to it.
- Negative control: remove the forwarding; the test must go red.
- Rejected alternative: allow only default-effort qualification for these runners. That turns off effort capability for this runner class.

## Note
- peace re-ran GLM-5.3 high locally and got 41/42; the official default event 294 is 42/42.
- The lost point is a returned JSON with one extra `]`: model output format, not transport.
- The official default stays unchanged.
