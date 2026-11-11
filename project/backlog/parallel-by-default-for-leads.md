# Parallel-by-default for leads and lanes (BL-0426)

Operator rule (2026-11-11, PM SOP 8157002): a lead or lane runs unrelated incoming work in parallel immediately. Any new item that does not depend on the one in hand gets its own worker (subagent, hetero seat or member) at once. Read-only and mechanical work goes to Haiku, Sonnet or a non-Claude seat; the lead keeps judgment, verification and irreversible ops. Only a real dependency on the previous result, or the same scarce resource, justifies "queued behind X"; otherwise the answer is "dispatched to <worker>, due <time>".

Gap: grep of skills/lead-watch, skills/team, skills/l3 to skills/l6, skills/dev-flow and skills/ceo-agent (SKILL.md) finds no statement of this default, so sessions queue unrelated work serially.

Files that would need the change:

- skills/lead-watch/SKILL.md
- skills/team/SKILL.md
- skills/l3/SKILL.md, skills/l4/SKILL.md, skills/l5/SKILL.md, skills/l6/SKILL.md
- skills/dev-flow/SKILL.md (dispatch guidance)
- skills/ceo-agent/SKILL.md

Constraint: this changes what a skill demands, so skills/CLAUDE.md requires eval ON/OFF evidence (scorecard-first) before the wording ships. Trim each touched skill toward contract-card shape (references/skill-contract-card.md).

Source: PM 01M74K28MQ (2026-11-11).
