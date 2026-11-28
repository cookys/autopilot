---
name: lead-watch
description: >
  Opt-in for leads only (never workers): proactively check overdue reports or idle members with open work.
  Use when: "/lead-watch", "autopilot:lead-watch".
---

# Lead-watch - a lead keeps watching its team

Scope: applies to a session that dispatched or coordinates other members. A stuck member sends nothing, so the lead detects and responds on a fixed rule, not on good intentions.

## Patrol (the first step once you go)

`fleet pm status` prints one line per project. For any project shown stuck or overdue, drill down with
`fleet pm <project> status` (a project name, or a task id / 8+ char prefix): every unfinished task of
that project, stuck or overdue first. This is what the lead runs once a trigger fires — when you go is
still event-driven (Work orders, Detection), this is what you do there.

## Detection

| Condition (mechanical) | Verdict |
|---|---|
| A running hand's process or rail ended (task notification, `fleet watch` event) with no report, or its evidence time passed | check now |
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

The lead keeps three things: judgment, checking the key facts, and irreversible actions. Mechanical or read-only work goes to a light- or standard-tier executor (`hands`, or `fast-worker` / `implementer`) or a cheaper engine seat; do it yourself only when it is one or two tool calls. Spread the load by what quota each account and engine has left. The tier names the role; the model comes from `scripts/resolve-dispatch.sh` and `references/model-routing.md`, never from this file. If the resolve output has an `engine` field (pool route), dispatch through `scripts/dispatch-hetero.sh --runner <runner>` (decision: `scripts/resolve-launch.sh --role <role>`) instead of a Claude subagent.

- grep or file-by-file comparison: light tier (`hands` role).
- Edit files to a template, run a fixed check: standard tier (`fast-worker` / `implementer` role).
- Judge a result, merge, push: the lead.

## Work orders

- Every dispatch lists N, N+1 and N+2 with each one's entry condition and an evidence time, so the chain runs without a round trip.
- When an item ends the member starts the next ready item inside the go at once and reports both in one line.
- Check-ins are event-driven: a task notification, a `fleet watch` condition (`pid` / `until_file` / `until`) or the evidence time passing. There is no fixed polling interval (fleet plan pm-inbox-issue-model S4, retiring the 30-minute poll).
