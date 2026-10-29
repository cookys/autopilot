### Per-turn gate for a hand with hard rules

When you dispatch a hand with `scripts/dispatch-hetero.sh --runner claude-native` and the brief
carries hard rules that a file check can decide (a path the hand must not touch, a file that must exist, a text
that must not appear), arm the hand's per-turn gate: write a rule list and pass it as `--gate-rules <file>`.
The list is data, not commands: one entry per hard rule in the brief (`forbid_paths`, `require_files`,
`forbid_text`; `require_text` for a literal), each with an `id` and a repo-relative path or glob. Check the
list first with `node scripts/gate-verify.js --check --rules <file> --base <sha>`; fix it until it exits 0.
Write the list before the dispatch call; never hand-write the gate file. Use no flag when the brief has no hard
rule. The gate lets the hand stop after at most two blocks, so a list that forbids a path the task needs
costs the hand two rounds, not a hang: if the hand reports being blocked by a rule you now think is wrong,
change the list before you dispatch again, and never re-dispatch with the same list. The gate is not
acceptance: you still verify the result yourself.
