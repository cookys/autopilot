# ADR-0002 — Task-tree and qc-panel are dormant

- **Status**: Accepted (owner, 2026-10-22, d-22217b38)
- **Deciders**: owner (d-22217b38, 2026-10-22)

## Context

Original goal: [`../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md`](../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md). Quote: "Manager context grows with the number of decisions made, never with the amount of work produced." Meaning: the CEO context grows with the number of decisions, not with the amount of work. Three means: work content lives in the tree/events.jsonl event log; qc-panel uses cross-family judges to check whether a node report overclaims; fetch --raw writes a manager_raw_read audit event.

Termination evidence: [`../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl`](../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl) line 33 is a board_signoff event dated 2026-08-22, decision=abort, authorized_by "board:cookys (CEO-delegated 2026-08-23)". Scope text verbatim: "amendment-6-overdue-review: 2/50 samples in 72 days, agreement 0/2, sample-accrual rate proves the shadow instrument cannot reach graduation on this repo's workflow; abort shadow, adapter stays inactive; re-entry = fresh campaign if reviewer-baseline sampling becomes routine (e.g. qc-panel shadow rows)". Also commit 97c48b0af (2026-08-23).

Current state: no in-progress project has a tree/ directory; archived projects hold 20 tree/events.jsonl files, the newest entry dated 2026-08-30.

## Decision

Scripts, tests and archived records stay in place, not deleted. Both mechanisms are dormant and no workflow triggers them. A tree is no longer initialised by default. The re-entry condition is the abort scope text verbatim: "amendment-6-overdue-review: 2/50 samples in 72 days, agreement 0/2, sample-accrual rate proves the shadow instrument cannot reach graduation on this repo's workflow; abort shadow, adapter stays inactive; re-entry = fresh campaign if reviewer-baseline sampling becomes routine (e.g. qc-panel shadow rows)".

## Consequences

Superseded capabilities:

| Need | Now |
| --- | --- |
| Decisions that need the owner | [`../../scripts/open-decision.js`](../../scripts/open-decision.js) and [`../../scripts/decision-ledger.js`](../../scripts/decision-ledger.js) |
| Stages and progress | [`../../scripts/stage-graph.js`](../../scripts/stage-graph.js), [`../../scripts/stage-advance.js`](../../scripts/stage-advance.js) and the Mission graph ([`../../scripts/scaffold-mission.js`](../../scripts/scaffold-mission.js)) |
| Acceptance and review | Foreman acceptance plus [`../../scripts/hetero-review-loop.js`](../../scripts/hetero-review-loop.js) (four families review the diff, dispositions recorded in the ledger) |

NOT superseded: (1) the manager_raw_read audit: today only the depth-0 do-not-edit-yourself discipline exists, with no record at all. (2) the qc-panel review style: ACHIEVED/EXTRA/MISSED plus one refute round, i.e. "did what was claimed actually get done"; hetero review only checks a diff for bugs and has no such check.

Skill and reference text that still contradicts the abort is not edited here. It waits for a guidance eval, tracked as BL-0283 in [`../BACKLOG.md`](../BACKLOG.md). Known sites: [`../../skills/ceo-agent/SKILL.md`](../../skills/ceo-agent/SKILL.md) line 309 (c2, L/XL default runs `tree.js init`); [`../../skills/quality-pipeline/SKILL.md`](../../skills/quality-pipeline/SKILL.md) (qc-panel described as a mandatory shadow reviewer; line 66 "the dispatcher MUST run `scripts/qc-panel.js`"); [`../../references/blind-dispatch.md`](../../references/blind-dispatch.md) line 297 (qc-panel listed as the blind-review exception); [`../../references/tree-contracts.md`](../../references/tree-contracts.md) carries no dormant marking.

`git grep -n 'tree.js'` and `git grep -n 'qc-panel'` limited to `skills/`, `references/` and `agents/` (read-only, 2026-10-22). `agents/` had no hits. Other sentences of the same kind (file:line plus a few words):

- `skills/ceo-agent/SKILL.md:407` `scripts/tree.js board-status`
- `skills/ceo-agent/SKILL.md:410` decisions flow from `scripts/tree.js next-decision`
- `skills/ceo-agent/SKILL.md:416` `next-decision` is the manager's ONLY default input
- `skills/ceo-agent/SKILL.md:422` read MUST go through `scripts/tree.js fetch`
- `skills/ceo-agent/SKILL.md:439` Tree CLI `init`, `emit`, `next-decision`
- `skills/ceo-agent/SKILL.md:472` Route decisions through `tree.js next-decision`
- `skills/ceo-agent/SKILL.md:473` artifact reads go through `fetch --raw`
- `skills/ceo-agent/SKILL.md:476` `tree.js` rejects `_archive/<proj>`
- `skills/ceo-agent/references/tree-adapter.md:34` `scripts/tree.js board-status`
- `skills/ceo-agent/references/tree-adapter.md:49` Do NOT route decisions through `tree.js next-decision` (pre-signoff)
- `skills/ceo-agent/references/tree-adapter.md:51` Post-signoff: decisions flow from `tree.js next-decision`
- `skills/ceo-agent/references/tree-adapter.md:63` `scripts/tree.js next-decision`
- `skills/ceo-agent/references/tree-adapter.md:95` `scripts/tree.js fetch`
- `skills/ceo-agent/references/tree-adapter.md:105` Emit events via `scripts/tree.js emit`
- `skills/ceo-agent/references/tree-adapter.md:233` `scripts/tree.js init`
- `skills/ceo-agent/references/tree-adapter.md:237` `` `tree.js init` as part of project setup ``
- `skills/ceo-agent/references/tree-adapter.md:251` a qc-panel run writes a per-run verdict
- `skills/distill/SKILL.md:100` direct `tree.js escalations` sweep
- `skills/retro/SKILL.md:31` run `node scripts/tree.js escalations`
- `skills/quality-pipeline/SKILL.md:58` Cross-family interrogation panel (shadow mode)
- `skills/quality-pipeline/SKILL.md:70` Run `scripts/qc-panel.js`
- `skills/quality-pipeline/references/code-review.md:349` `scripts/qc-panel.js` in parallel with authoritative reviewer
- `skills/quality-pipeline/references/code-review.md:351` every panel run MUST write a verdict artifact
- `skills/quality-pipeline/references/code-review.md:373` `qc-panel.js` 4th shape = refute pass
- `references/hetero-dispatch.md:134` `scripts/qc-panel.js` carries the same check
- `references/hetero-dispatch.md:711` do NOT count pi toward reviewer/qc-panel family coverage
- `references/hetero-dispatch.md:897` `scripts/qc-panel.js` dispatches its Gemini judge
- `references/multi-agent-portability.md:341` Tree engine (`scripts/tree.js`) stays the cross-session source of truth
- `references/multi-agent-portability.md:343` Task-tree engine is platform-universal (`scripts/tree.js`)
- `references/multi-agent-portability.md:353` Operational caveats for P4's `qc-panel.js`
- `references/four-layer-design.md:17` qc-panel fan-out
- `references/blind-dispatch.md:553` depth-0 qc-panel re-review after fixes
- `references/tree-contracts.md:4` consumers (tree.js, check-node-report.js, QC panel)
- `references/tree-contracts.md:52` Emitted exactly once by `tree.js init`
- `references/tree-contracts.md:181` Emitted automatically by `tree.js fetch`
- `references/knowledge-routing.md:48` names `scripts/tree.js` as an in-repo path example

## Evidence

- Design spec quote, line 9: [`../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md`](../plans/_archive/2026/06/2026-06-12-task-tree-engine-design-spec.md).
- Abort event, line 33: [`../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl`](../projects/_archive/2026/06/2026-06-12-task-tree-engine/tree/events.jsonl). Commit 97c48b0af (2026-08-23).
- Kept scripts: [`../../scripts/tree.js`](../../scripts/tree.js), [`../../scripts/qc-panel.js`](../../scripts/qc-panel.js), [`../../scripts/calibration.sh`](../../scripts/calibration.sh), [`../../scripts/check-node-report.js`](../../scripts/check-node-report.js).
