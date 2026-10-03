# dispatch-plan-review: reusing a terminal ticket makes a quiet 0-call run

- **Trigger**: next touch of `scripts/dispatch-plan-review.js`.
- **Symptom**: `--ticket` reusing a ticket whose session is already terminal resolves to the existing session (session key = sha256(repo identity + ticket), `dispatch-plan-review.js:1574`). The run makes 0 seat calls and returns the old terminal verdict with no explanation.
- **Wanted**: a named, explicit message (for example `ticket_session_already_terminal: <logical id> <verdict>`) instead of the quiet result. Visibility only; no semantic change.
- **Source**: PEER-REPORTED cuda/chatgpt-tunnel 2026-10-03, msg 01M406CPGN828NHBQJJMAD01M9. The consumer worked around it with a new machine-phase ticket.
- **Effort**: S
