# Verification-author seats on agy / cc-shim / anthropic-compatible are structurally NO-GO under the exact-tuple quota gate

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: next time a VA seat other than codex/grok/qoderclicn is configured (GLM-5.3@anthropic-compatible is VA-qualified, event 142, yet unroutable on 2026-08-29).
- **Context**: `dispatch-contract.js` always queries capability state with `--effort <resolver effort>` (and `withResolverConfig` injects `verification_author_effort: high` when absent), but `probe-engine-capability.sh` refuses to observe an effort-bearing tuple for runners that do not consume `--effort` (agy carries effort in the model name; cc-shim/anthropic-compatible have none) ⇒ `quota: unknown` ⇒ NO-GO forever. Either the checker must query the effort-less partition for those runners or the probe must observe it.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1 roster rotation 2026-08-29 (commits 8d6f8786, 83d993a5).

