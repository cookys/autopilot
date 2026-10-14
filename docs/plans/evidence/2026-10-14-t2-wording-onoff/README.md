# BL-0124 T2 wording ON/OFF eval (2026-10-14)

Question: when an auto-compact window at or below T2 is set, can T2 stop telling the model to STOP
and ask for `/clear`, without making the model behave worse?

- Harness: `evals/context-budget-t2/run-t2-eval.js`. It renders the real `budgetDecision()` message and
  shows it to `claude -p --model sonnet` (no tools, dedicated config dir with only `.credentials.json`).
  The model answers `ACTION: CONTINUE` or `ACTION: STOP`; graded by regex. Raw rows: `results.json`.
- OFF = today's STOP directive. ON = new wording (auto-compact is set at Nk, do not stop, write a handoff
  at the next phase boundary). Context 310k, T2 300k, window 1M.
- 26 runs in total, sonnet.

| Case | Arm | CONTINUE | STOP |
|---|---|---|---|
| A headless, window 250k | OFF | 0/5 | 5/5 |
| A headless, window 250k | ON | 5/5 | 0/5 |
| B interactive, window 250k | OFF | 0/5 | 5/5 |
| B interactive, window 250k | ON | 5/5 | 0/5 |
| C control, window unset | ON (= OFF text) | 0/3 | 3/3 |
| D control, window 400k above T2 | ON (= OFF text) | 0/3 | 3/3 |

Reading: the wording moves behaviour in exactly the intended cases (STOP 10/10 to CONTINUE 10/10), and the
two negative controls keep STOP, so the change does not leak where compaction is not coming.
Limits: single scenario family, a tool-less decision prompt (it measures whether the model obeys the message,
not task quality afterwards); the `asksClear` field in the existing `results.json` is NOT evidence: its regex matched negations such as "do not ask for /clear" and read backwards (the field was removed from the script; the file is left as generated). Hook-level behaviour is pinned by `hooks/tests/context-budget-t2-autocompact.test.sh`.
