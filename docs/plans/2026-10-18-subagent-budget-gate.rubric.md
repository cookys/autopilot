# Rubric — 2026-10-18-subagent-budget-gate.md

> Source plan: docs/plans/2026-10-18-subagent-budget-gate.md

R1: [relay ceiling] The plan makes a 5th dispatch of the same lane (reviewer briefs excluded from the count) deny, whether or not a session-mode marker exists, and says how that is tested.
R2: [turn ceilings] The plan makes a dispatch deny when the lane's transcripts already hold at least 300 turns, or when the root's subagent turns in the last 60 minutes reach 400, and the 60-minute window has a defined time source.
R3: [counts are re-derived] The counts come from the subagent transcripts on every call (not from costs.jsonl), so an in-flight background agent is counted; the only persisted state is a parse cache and the card pointer, both under the live-state dir.
R4: [lane identity] The lane key rule (Lane: line, else the Agent description) is stated precisely enough that the hook and a subagent transcript derive the same key for the same lane, and its failure modes are named.
R5: [way through] A dispatch carrying a valid Budget-Ack line passes and leaves one decision-ledger row; an empty or short reason does not pass.
R6: [escalation] The hook opens exactly one owner panel card per (session, lane-or-root) on the first deny, deduplicated by a pointer file, and never more on later denies.
R7: [visibility] Every allowed Agent dispatch receives one context line with last-hour turns, estimated USD and the heaviest lane; USD is never a threshold.
R8: [fail-open] Missing transcript_path, unreadable or corrupt transcripts and any internal error allow the dispatch with no output beyond a stderr note.
R9: [latency] The plan bounds hook latency (p95 at most 300 ms over 200 transcripts of 300 turns, warm) and says how the bound is measured.
R10: [no collateral change] cost-fuse and brain-spend behaviour stay unchanged and the plan names the suites that prove it; the 10-12 ruling stands and the 09-25 ruling is recorded as superseded.
R11: [negative controls] Each new check has a named negative control that must be shown red before green.
R12: [wiring complete] Every surface a new default-on hook touches (hooks.json, hook classes and mirrors, config keys, settings docs, hook inventory counts, the l5 brief recipe, BL-0011) is in the file map.
R13: [scope] What the hook does not govern (Bash-started external engines, concurrency, repair-vs-relay, cross-host) is stated as out of scope.
