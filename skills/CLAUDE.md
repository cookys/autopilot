# skills/ - directory rules (Claude Code)

Loaded when a session reads or edits a file under `skills/`. Root `CLAUDE.md` keeps the one-line versions of boy-scout, scorecard-first and mechanism-vs-guidance.

## Skill evolution rules

- **童子軍規則 (boy-scout)**: any touch of a skill trims it toward contract-card shape — canonical definition + review checklist: [`references/skill-contract-card.md`](../references/skill-contract-card.md). The north-star gate (prose↓ engine↑, incl. the per-skill ratchet) watches per release.
- **成績單前置 (scorecard-first)**: rewriting or deleting any skill requires prior eval ON/OFF evidence (evals/orchestration harness); an unevidenced rewrite = unevidenced trust.
- **機制 vs 指引 (mechanism-vs-guidance)**: scorecard-first gates changes to *what a skill asks for*, not changes to *whether something it already asks for actually happens*. Making an already-stated gate genuinely block is a **mechanism** change and needs no eval — `finish-flow` exists precisely because a passive markdown checklist gets skipped, and that question is already answered. Changing what the gate demands is a **guidance** change and does need eval evidence. The test is literal, not a judgement call: list the requirements before and after, and if the list is unchanged it is mechanism. A mechanism change **must not** also edit the requirement text; when both are wanted, ship them as two commits so each meets its own bar.

- Don't hardcode dispatch model/mode in skill files - use `scripts/resolve-dispatch.sh`.
