# Rubric — 2026-09-12-input-containment-gates.md

> Source plan: docs/plans/2026-09-12-input-containment-gates.md

R1: Node >= 20.10, built-ins only; both scripts parse JSON so both are `.js` per the language-choice table.
R2: The containment assertion is METHOD-SELECTED. An unconditional `is-ancestor` fails this plan outright, however green its own tests are.
R3: The apply-style green case — source NOT an ancestor, accepted IS — must exist and must PASS. Its absence means the defect is unfixed regardless of the rest.
R4: The inputs gate names EVERY failing entry in one run. Stopping at the first failure fails this plan.
R5: Each failure message carries the OPERANDS — id, sha, target, and the command that was run — not only a verdict (`references/evidence-discipline.md` §34).
R6: Neither gate mutates the repository. Read-only: no checkout, no fetch, no ref write, no commit.
R7: Both scripts are wired in all four places: reference doc, SKILL/inventory row, `docs/scripts-inventory.md`, and the grouped name list in `CLAUDE.md`. `check-claude-md-inventory.js` must pass.
R8: Neither gate is switched on by default in this deliverable; shipping it on requires its own evidence.
R9: These gates consume the fields added by `p1-integration-receipt-sha-ledger` and must not redefine or duplicate that schema.
R10: A missing or unreadable receipt must be an explicit refusal naming the path, never a silent pass. A parser that dies must not be readable as valid-but-empty input.
R11: ADR-0001 binding — containment is re-derived from git, never read from a claim in the receipt about whether something landed.
R12: RISK — the gate is pointed at the wrong target ref and reports containment against a branch nobody integrates into. Mitigation: the target is an explicit required argument and is echoed in every message.
R13: RISK — the apply-style branch is written but never exercised because no fixture uses that method. Mitigation is R3, and reviewers must confirm the fixture actually carries a non-ancestor source.
R13a: The apply-style fixture must be EMITTED by `scripts/record-integration.js` against a real sandbox integration, not hand-authored. A fixture written by the same hand that wrote the assertion proves the two agree, not that the code is right.
R14: Version bump is PATCH (two new scripts); CHANGELOG entry and INDEX rows required.
R15: No new severity vocabulary.
