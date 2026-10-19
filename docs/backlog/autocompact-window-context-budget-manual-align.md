# autoCompactWindow and context budget must be aligned by hand

Reported by codepower twgs-revival (report 01M59WNDJSZG3Y6YTERWD9DF4J, reply 2026-10-19 01M59WPA9TSF4TR7ST9AJRWF4V).

- `autoCompactWindow` and `context_budget` must be aligned by hand in two places, and no consumer will notice a mismatch.
- The two files in this repo that own the pair: `docs/settings-reference.md` (how `autoCompactWindow` in `~/.claude/settings.json` relates to `context_budget.t2` and `gap`) and `hooks/context-budget-lib.js` (reads `context_budget` and tells the owner to set `autoCompactWindow` in `~/.claude/settings.json`).
- Suggestion 1: when SessionStart detects a 1M-token window with nothing configured, print the recommended values and the two file paths every time.
- Suggestion 2: a single command that writes the recommended pair at once.
