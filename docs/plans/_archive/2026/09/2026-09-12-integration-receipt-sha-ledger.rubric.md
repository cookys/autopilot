# Rubric — 2026-09-12-integration-receipt-sha-ledger.md

> Source plan: docs/plans/2026-09-12-integration-receipt-sha-ledger.md

R1: Node >= 20.10, built-ins only; no new npm dependency.
R2: ADR-0001 binding — the receipt records observable git facts, never an attestation; no hash chain, witness receipt or tamper-evidence.
R3: `mode` is not modified, renamed, or given new enum members; existing consumers of `mode` are untouched and this must be shown by `git diff`.
R4: `integration_method` is a CLOSED enum; an unknown value is rejected by the schema, and that rejection is asserted by a red fixture.
R5: `source_sha` and `accepted_sha` are both required; a receipt omitting either is rejected, asserted by a red fixture.
R6: The writer must be shown emitting two DIFFERENT values for a real merge. A test that only validates hand-written fixtures does not satisfy this plan — it is the exact vacuity that let the D4 admission bypass ship green.
R7: `unit_id` is not a ref name and must not be derived from one.
R7a: `apply+fresh-commit` must be emitted by a REAL writer (`scripts/record-integration.js`) against a real sandbox integration, never only by a hand-authored fixture. An enum member with no producer is a shape no test can honestly exercise.
R7b: `record-integration.js` is wired in all four discovery places (reference doc, inventory row, `docs/scripts-inventory.md`, the grouped name list in `CLAUDE.md`); `check-claude-md-inventory.js` must pass.
R7c: `record-integration.js` is read-only with respect to the repository: it records, it never integrates, checks out, or writes a ref.
R8: No behavioural change to merge execution itself — the same merges succeed and fail as before; `hooks/tests` covering `src/merge/cli.js` stay green unmodified except for added cases.
R9: Codex mirror parity holds: `bash scripts/sync-codex-plugin-skills.sh --check` exits 0.
R10: Every acceptance in the plan names the file, the command and the expected output; no "add validation" shaped step.
R11: RISK — the writer sets both SHAs from one variable and every schema check still passes. Mitigation is R6 and it must be attacked specifically by reviewers.
R12: RISK — the schema change breaks an existing receipt consumer that iterates required keys. Mitigation: enumerate consumers of `edgeReceipt` before editing and name them in the diff scope.
R13: Version bump is PATCH (schema + writer, no new user-facing surface); CHANGELOG entry required.
R14: No new severity vocabulary; the unified four tiers only.
