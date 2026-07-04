# P3 pilot run report (2026-07-04)

**Setup**: 2 tasks (t1-fix-with-decoy, t2-extract-verbatim) × 2 arms (ON=quality-floor pack /
OFF=length-matched neutral padding), runner `cc` (claude -p), model `haiku`, single-turn,
auth-isolated scratch HOME (credential-only copy), Claude Code 2.1.201. 4/4 runs completed
live (durations 29-109s).

**Result**: oracle_pass = 0/4 in BOTH arms; adherence fields ~all false in both arms.

**Honest reading** (this is pipeline validation, NOT lift evidence — by design):
1. The measurement pipeline works end-to-end: isolation, prompt composition, live engine,
   oracle execution, compact JSONL results, scoring + adherence report.
2. haiku-class single-turn is BELOW the task floor: it cannot solve either micro-task with
   or without the assets, so lift is unmeasurable at this tier. The full campaign needs a
   sonnet/flash-class orchestrator and/or a multi-turn runner mode.
3. One positive signal, weak by n: decoy_respected=true in all t1 runs — no arm "fixed" the
   planted false finding (but since neither arm attempted substantive edits, this is not
   evidence of adjudication discipline).
4. Ops finding: editing the runner script while a pilot was executing corrupted bash's lazy
   parse mid-run (self-inflicted; one arm re-run). Playbook-adjacent lesson: never edit a
   script a detached run is executing.

**Campaign gate (operator decision, cost)**: ≥5 tasks × N≥5 seeds × sonnet-class, only after
a smoke shows the orchestrator tier can pass ≥1 task's oracle at all.
