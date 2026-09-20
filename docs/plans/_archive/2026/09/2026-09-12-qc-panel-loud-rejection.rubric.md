# Rubric — 2026-09-12-qc-panel-loud-rejection.md

> Source plan: docs/plans/2026-09-12-qc-panel-loud-rejection.md

R1: Shell only; this script is a dev/CI-time resolver and stays `.sh`. No port to Node.
R2: All FOUR sites emit, not three. A diff touching only the per-seat cases fails this plan.
R3: Every message names the REJECTED VALUE and the ACCEPTED SET. A message carrying only a verdict reproduces the defect and fails (`references/evidence-discipline.md` §34).
R4: The arity message names which array disagreed and both lengths.
R5: Exit 3 is unconditional; no `ENFORCE` guard is added to input validation.
R6: The valid-panel green case must be asserted, so the change cannot turn a working panel into a refusal.
R7: `hooks/tests/resolve-review-loop.test.sh` stays green with no edits other than added cases; any edit to an existing assertion must be justified in the commit message.
R8: The panel allowlist membership is frozen — no runner, effort or endpoint form is added or removed.
R9: Messages go to stderr, never stdout; stdout stays parseable JSON for every caller.
R10: Codex mirror parity: `bash scripts/sync-codex-plugin-skills.sh --check` exits 0.
R11: RISK — exiting 3 unconditionally breaks a caller that today tolerates an empty panel. Mitigation: enumerate callers of `qc_panel_seats` before editing and name them; if one genuinely depends on the empty-panel path, report it rather than silently keeping the old behaviour.
R12: RISK — a message is added but the site still falls through to the same silent outcome. Mitigation: each red case asserts BOTH the exit code and the message text.
R13: Version bump is PATCH; CHANGELOG entry required.
R14: No new severity vocabulary.
