# depth-0 per-turn gate: status detail

BL-0306. Plan: docs/plans/2026-10-26-depth0-per-turn-gate.md

- P0 evidence: commit bfde42aa1 (0.0433 USD), docs/plans/evidence/2026-10-26-depth0-gate-p0.
- P1 shipped, merged ae44b5a0a: scripts/gate-verify.js, schemas/gate-rules.schema.json, 183 tests, 87 mutations all shown red. Not wired into any hook.
- P2 (hook wiring) open design questions: BL-0318, BL-0319.
- P3 cap 20 USD approved. Owner instruction: after the mechanism passes acceptance, run P3 without asking again.
- Follow-on of BL-0055.
