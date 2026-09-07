# Rubric — 2026-09-07-unknown-escalation-ladder.md

> Source plan: docs/plans/2026-09-07-unknown-escalation-ladder.md

R1: Node ≥ 20.10, built-ins only; no new npm dependencies.
R2: New scripts emit one JSON object on stdout, human lines on stderr, exit 0 on any classification; non-zero only for usage errors or `--strict`.
R3: Ladder receipts are append-only JSONL rows in the existing decision ledger file (`kind: unknown | hypothesis | ladder`), never a second ledger.
R4: The ladder never emits a hook Stop decision and never halts a phase; it recommends, records, and (in `auto`) dispatches through the existing rails only.
R5: Rung dispatches go through the existing scripts unchanged: `dispatch-consult.sh`, the `survey` skill, the `think-tank` skill. No new seat, no new transport.
R6: Severity vocabulary stays `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`; the ladder uses rung ids `U0..U4`, not a new severity.
R7: `identifier-scan.js` is not a novelty detector; S4 uses its own term lookup.
R8: Knob `unknown_escalation` copies the `consult_dispatch` tri-state semantics byte-for-byte (`off` ⇒ opt-out receipt + `capability_warnings`; `on` ⇒ explicit budgets required; `auto` default = on with default budgets). Owner ruling 2026-09-07: a switch, default on, in participatory and just-results modes alike.
R9: **The probe is wired but never called** (the inventory caution). Mitigation: KR1 is measured from receipts, and P3/P4 acceptance requires a call site with exact argv; P4 dogfood must show a real row.
R10: **Signals fire on every task** (S4 zero-hit on any new noun). Mitigation: S4 alone only recommends U0/U1; U2 needs S4 plus a second signal (S1/S2/S3/S5), or an S4 fast-moving-name cue; thresholds are argv-overridable and the report exposes the false-positive rate.
R11: **The ladder becomes a blocker** in the name of rigour. Mitigation: KR5 exit-0 rule, remind-only posture, `--strict` opt-in only.
R12: **Consult is not heterogeneous** and the receipt hides it. Mitigation: `heterogeneous: false` is a first-class field and skips the rung (C5).
R13: **Foreman climbs cost money silently**. Mitigation: budgets are per-task integers in config, default 1 each; `cost-fuse` hook and the round ledger already surface spend.
R14: **Nothing is written back** and every session pays again. Mitigation: P5 makes learn mandatory on a resolved climb; KR4 makes the repeat rate visible.
R15: **The ladder widens scope**: an S4 zero-hit on a nearby thing the task never asked about triggers research. Mitigation: terms come from the task brief; a hit outside the brief is reported as a follow-up in the summary, never a climb.
R16: **Self-reported unknowns game the ladder** (an agent declares `unknown` to get a cheaper engine to do its thinking). Mitigation: S6 alone caps at U1; the round-end report lists S6-only climbs separately.
