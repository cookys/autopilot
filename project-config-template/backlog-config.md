# Backlog — Project Config
# Place this file at: `.claude/backlog-config.md`
#
# Schema (fields, caps, pointer rule, styles): [`references/backlog-entry.md`](../references/backlog-entry.md).
# Caps overrides may only LOWER a schema cap; the gate reports `config_raises_cap` otherwise.

## Style
# One of: heading · table · checklist
- style: heading

## Pointer Roots
- docs/plans/
- docs/projects/
- docs/backlog/

## Id Pattern
# `none` unless table ids are required (e.g. `^\d{4}$`)
- id_pattern: none

## Mode
# warn (report, exit 0) · block (exit 1 on new violations)
- mode: warn

## Allowlist
- allowlist_path: .claude/backlog-debt.json

## Done Retention Days
- done_retention_days: 30

## Caps
# Optional per-field lowers only, e.g. `- caps.Title: 80`
