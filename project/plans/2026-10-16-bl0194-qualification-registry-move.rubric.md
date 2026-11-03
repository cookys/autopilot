# Rubric — 2026-10-16-bl0194-qualification-registry-move.md (Revision 2026-10-19)

> Source plan: docs/plans/2026-10-16-bl0194-qualification-registry-move.md

R1: [owner direction carried] Both owner sentences of 2026-10-19 are quoted and every section the revision touches (thesis, KRs, constraints, write path, read side, phases) agrees with them; no older paragraph still says autopilot is where exams start or that the feed is never admission evidence.
R2: [trust modes defined] `qualification_feed.trust` auto (default) / confirm / off is defined precisely enough to implement: what admission does in each mode, where the confirm prompt appears and what is recorded once the user confirms, and how off is shown byte-identical to no feed.
R3: [invariants hold] Local evidence is never overwritten by the feed, a local strike always wins and the feed cannot lift it, and a user pin always wins; each has a named negative control.
R4: [gate is the existing preflight] The trust gate (schema, strict JSON, digest, 30-day freshness) reuses the shipped P4a preflight rather than a second implementation, and a gate failure means no feed plus a loud report, never partial trust.
R5: [headless contract implementable] P5 (a)(b)(c) names exit codes, the write boundary (only --store and --raw-dir, no ~/.autopilot write, no outbox enqueue), the --seat-file schema source, and the schema-2 record that ingest-qualification-record.py already accepts, with a test that proves the boundary on a temp home.
R6: [P4b replacement coherent] The cancellation of the old P4b writer switch and the residual pull replacement are consistent with KR1 (one authoritative store), with P3 being optional/default-off, and with the 200-row scorecard vs 31-record registry gap; nothing still depends on a zero store diff that will never occur.
R7: [cross-repo ownership] Each phase states which repo owns it (P7 is llm-playground's) and the interface between P5 and P7 is specified once, not in two places that can drift.
R8: [open decision honest] The 14 raw conflicts are presented as an owner decision with the evidence (commit 5580ce919, three-key vs four-key seat_hash) and options, and no phase silently assumes one answer.
R9: [security of auto trust] The plan states what an attacker or a broken publisher could do once the default is auto (e.g. a forged or stale feed admitting a seat), and how the gate, digest and invariants bound it.
R10: [negative controls] Every new check in P5 and P6 has a named negative control that must be shown red before green.
