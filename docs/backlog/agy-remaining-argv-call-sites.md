# Remaining agy argv call sites should use agy-stream-json.js

BL-0298. Move to `scripts/lib/agy-stream-json.js`: qualification-review-provider.js (two sites; its own argv cap refuses explicitly), probe-engine-capability.sh, probe-harness-capabilities.sh (small prompt), qc-panel.js (dormant, ADR-0002). Consistency, not correctness.
