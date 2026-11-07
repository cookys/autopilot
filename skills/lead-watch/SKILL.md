---
name: lead-watch
description: >
  Opt-in for LEADS only (the PM, a game or GPU lead, or any lane's depth-0 toward the hands it dispatched); workers never
  load it. Named invocations only: "/lead-watch" and "autopilot:lead-watch". Makes the lead go and check on its team when a
  report is overdue or a member sits idle with open work, instead of waiting for a message.
---

# Lead-watch - a lead keeps watching its team

Scope: applies to a session that dispatched or coordinates other members. A stuck member sends nothing, so the lead detects and responds on a fixed rule, not on good intentions.

## Detection

| Condition (mechanical) | Verdict |
|---|---|
| A running hand has gone more than 30 minutes since the lead last checked it (PM rule) | check now |
| A dispatched item passed its evidence time with no report | overdue: go and find out |
| A member finished an item, its next item is ready and inside the go, and it is idle | **stall**, same as an overdue report |
| A member's live pane or log shows a permission prompt or a wait with no progress | blocked: treat as an alert |

- An **evidence time** is the latest moment the lead looks back to confirm the work is still moving. It is not a start time and not a delivery time: start when inputs are ready, hand over when done.
- The lead checks on its own when the time passes or a member idles. It never waits for a notification. Read the member's own artifacts (git log, files, pane), never its self-report.
- Fixed clock times are only for a real external constraint, written with the reason beside it (`scripts/check-fixed-times.js` enforces this).
- The fleet task-lease stale/alert is a planned switch from 2026-11-10; do not rely on it before then.

## On an alert

1. Read the raw evidence first (log tail, pane, `git status` in the member's worktree) before classifying.
2. Unblock: answer the prompt or question, free the resource, or start the ready next item. If an engine switch is the fix, route it through `scripts/resolve-dispatch.sh`.
3. Reply to the member, then record the finding; escalate to the lead's own lead once, with a recommendation, only when the lead cannot unblock it.

## Pick the executor

The lead keeps three things: judgment, checking the key facts, and irreversible actions. Mechanical or read-only work goes to a light-tier executor (the `hands` role) or a cheaper engine seat; do it yourself only when it is one or two tool calls. Spread the load by what quota each account and engine has left. The tier names the role; the model comes from `scripts/resolve-dispatch.sh` and `references/model-routing.md`, never from this file.

- grep or file-by-file comparison: light tier (`hands` role).
- Edit files to a template, run a fixed check: standard tier (`fast-worker` / `implementer` role).
- Judge a result, merge, push: the lead.

## Work orders

- Every dispatch lists N, N+1 and N+2 with each one's entry condition and an evidence time, so the chain runs without a round trip.
- When an item ends the member starts the next ready item inside the go at once and reports both in one line.
- Check-ins are scheduled at the evidence time, at the latest 30 minutes apart while a hand runs.
