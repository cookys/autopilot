# One command that writes autoCompactWindow and context_budget together

Reported by codepower twgs-revival (report 01M59WNDJSZG3Y6YTERWD9DF4J, reply 2026-10-19 01M59WPA9TSF4TR7ST9AJRWF4V). BL-0250.

Shipped in merge e993e0fc0:

- The t2_gap_over_window rule (t2 + gap above autoCompactWindow minus 33000) used to run only on the SessionStart that announces a new plugin version.
- hooks/session-start.js now runs that one rule on every other SessionStart and prints at most two lines, and nothing when the pair agrees.
- Opt out with AUTOPILOT_CONFIG_PAIR_CHECK=0, or the existing update_check / AUTOPILOT_UPDATE_CHECK.
- The T1 tip and the no_autocompact_window suggestion name both halves of the pair and both files (~/.claude/settings.json, ~/.autopilot/config.json).
- AUTOCOMPACT_BUFFER is defined once in scripts/lib/autocompact-window.js. config-audit.js reuses it.
- Output with nothing configured is unchanged.

Not built: the reporter's other suggestion, one command that writes the recommended pair in both places. That is the only remainder of this row. Trigger-Type event.
