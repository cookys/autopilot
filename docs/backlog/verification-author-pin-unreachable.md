# verification_author: a standing operator pin can never reach dispatch-author

Source: PEER-REPORTED by cuda/chatgpt-tunnel via fleet, 2026-10-02 (messages 01M3Y3Z3EG1M1KX10W5Z3Y5C3Q, 01M3Y41KSKP3Y30YJRH3Z0ZXMC); re-verified by reading code at 06087bdd, not by running it.

- **Trigger**: FIRED — queued after the test-suite repo write containment release; reproduce first with a fixture pin and a strict VA contract.
- **Context**: `scripts/dispatch-author.sh:548` calls `dispatch-contract.js check` without `--resolved-live`; the pin branches in `scripts/dispatch-contract.js:1505-1550` only run when `--resolved-live` is given (`:1405`); the only producer of that doc, `scripts/resolve-dispatch-topology.js --resolve-live`, rejects `verification_author` (`VALID_ROLES` `:35-37`, exit 2 at `:999-1003`). So `pin-seat --role verification_author` is stored but unreachable. Fix shape: add `verification_author` to the resolver's live roles and have the strict-contract author path pass `--resolved-live`; contract tests for pin-admitted, pin-mismatch and no-pin.
- **Effort**: S
