# ADR-0002 — Task-tree and qc-panel are dormant

- **Status**: Accepted (owner, 2026-10-22, d-22217b38)
- **Deciders**: owner (d-22217b38, 2026-10-22)

## Context

Original goal: [`../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md`](../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md). Quote: "Manager context grows with the number of decisions made, never with the amount of work produced." Meaning: the CEO context grows with the number of decisions, not with the amount of work. Three means: work content lives in the tree/events.jsonl event log; qc-panel uses cross-family judges to check whether a node report overclaims; fetch --raw writes a manager_raw_read audit event.

Termination evidence: [`../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl`](../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl) line 33 is a board_signoff event dated 2026-08-22, decision=abort, authorized_by "board:cookys (CEO-delegated 2026-08-23)". Scope text verbatim: "amendment-6-overdue-review: 2/50 samples in 72 days, agreement 0/2, sample-accrual rate proves the shadow instrument cannot reach graduation on this repo's workflow; abort shadow, adapter stays inactive; re-entry = fresh campaign if reviewer-baseline sampling becomes routine (e.g. qc-panel shadow rows)". Also commit 97c48b0af (2026-08-23).

Current state: no in-progress project has a tree/ directory; archived projects hold 20 tree/events.jsonl files, the newest entry dated 2026-08-30.

The owner recalls the original need as "structuring the whole project flow", but the original design spec states the goal as keeping the manager's context from growing with the amount of work; the structured task tree on disk (the spec calls it the universal substrate) is the means. Facts from the spec (docs/plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md): North star is the quoted sentence; the task tree is structured data on disk owned by deterministic scripts; the manager talks to the tree only through its CLI.

## Decision

Scripts, tests and archived records stay in place, not deleted. Both mechanisms are dormant and no workflow triggers them. A tree is no longer initialised by default. The re-entry condition quotes only this sentence of the abort scope: "re-entry = fresh campaign if reviewer-baseline sampling becomes routine (e.g. qc-panel shadow rows)".

## Consequences

Superseded capabilities:

| Need | Now |
| --- | --- |
| Decisions that need the owner | [`../../scripts/open-decision.js`](../../scripts/open-decision.js) and [`../../scripts/decision-ledger.js`](../../scripts/decision-ledger.js) |
| Stages and progress | [`../../scripts/stage-graph.js`](../../scripts/stage-graph.js), [`../../scripts/stage-advance.js`](../../scripts/stage-advance.js) and the Mission graph ([`../../scripts/scaffold-mission.js`](../../scripts/scaffold-mission.js)) |
| Acceptance and review | Foreman acceptance plus [`../../scripts/hetero-review-loop.js`](../../scripts/hetero-review-loop.js) (four families review the diff, dispositions recorded in the ledger) |

NOT superseded: (1) the manager_raw_read audit: today only the depth-0 do-not-edit-yourself discipline exists, with no record at all. (2) the qc-panel review style: ACHIEVED/EXTRA/MISSED plus one refute round, i.e. "did what was claimed actually get done"; hetero review only checks a diff for bugs and has no such check.

Skill and reference text that still contradicts the abort is not edited here. It waits for a guidance eval, tracked as BL-0283 in [`../BACKLOG.md`](../BACKLOG.md). Known sites: [`../../skills/ceo-agent/SKILL.md`](../../skills/ceo-agent/SKILL.md) line 309 (c2, L/XL default runs `tree.js init`); [`../../skills/quality-pipeline/SKILL.md`](../../skills/quality-pipeline/SKILL.md) (qc-panel described as a mandatory shadow reviewer; line 66 "the dispatcher MUST run `scripts/qc-panel.js`"); [`../../references/blind-dispatch.md`](../../references/blind-dispatch.md) line 297 (qc-panel listed as the blind-review exception); [`../../references/tree-contracts.md`](../../references/tree-contracts.md) carries no dormant marking.

The full list of sentences (file:line, original text, suggested change) is in [`../backlog/dormant-tree-qc-panel-skill-text.md`](../backlog/dormant-tree-qc-panel-skill-text.md), tracked by BL-0283.

## Evidence

- Design spec quote, line 9: [`../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md`](../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md).
- Abort event, line 33: [`../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl`](../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl). Commit 97c48b0af (2026-08-23).
- Kept scripts: [`../../scripts/tree.js`](../../scripts/tree.js), [`../../scripts/qc-panel.js`](../../scripts/qc-panel.js), [`../../scripts/calibration.sh`](../../scripts/calibration.sh), [`../../scripts/check-node-report.js`](../../scripts/check-node-report.js).
