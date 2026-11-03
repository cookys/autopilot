# Backlog — Project Config
# Place this file at: `.claude/backlog-config.md`
#
# Schema: [`references/backlog-entry.md`](../references/backlog-entry.md).

## Style
- style: heading

## Pointer Roots
- project/plans/
- project/projects/
- project/backlog/
- docs/plans/evidence/

## Id Pattern
- id_pattern: none

## Mode
- mode: block
- required_fields: Id, Since, Origin, Problem, Impact

## Allowlist
- allowlist_path: .claude/backlog-debt.json

## Done Retention Days
# BACKLOG is a queue: a shipped/dropped row is done_not_moved on sight (gate default
# 0). Existing shipped/dropped debt is cleared by `check-plan-graduation.js --fix`
# (deletes the row outright), not by widening this override.
- done_retention_days: 0

## Caps
