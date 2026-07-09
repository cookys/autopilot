# Reviewer-output expected sections (per case class)

This document defines the pre-declared per-case-class expected-sections list for the M3 reviewer-output structural checks. It is derived from the case-class taxonomy in `skills/quality-pipeline/references/code-review.md` and the mandatory Output Contract in `agents/reviewer.md`, and is fixed before the harness run.

## Always-required sections

Every review report must contain these sections:
- `## Reviewer Report` - The main report header.
- `### ✅ Verified Clean` - List of clean checks (always required even if empty; Exhaustiveness Red Line).
- `### Summary` - Summary of overall risk and top priorities.
- `### Handoff` - Handoff details containing the "Next consumer:" line (enum values: `MAIN_CLAUDE | AUTOPILOT_DEBUGGER | AUTOPILOT_PLANNER | NEEDS_DOMAIN_EXPERT | DOCUMENT_ONLY`).

*Note:* Severity finding sections (`### 🔴 Critical`, `### 🟠 Major`, `### 🟡 Minor`, `### 🔵 Suggestion`) only appear if findings are present.

## Conditional sections

- `### Scope Creep Findings` - Present only when scope creep is detected.
- **Scope-creep Verified Clean Line** - When no scope creep is detected, the `### ✅ Verified Clean` section must contain the line: "Reviewed full diff for scope creep — every changed line traces to the task" (omitting this is an Exhaustiveness violation).

## Per-case-class expected sections

| Case class | Baseline graded against | Always-required sections | Conditional / case-specific |
| :--- | :--- | :--- | :--- |
| Code diff review, size S | before commit; baseline = task intent | `## Reviewer Report`, `### ✅ Verified Clean`, `### Summary`, `### Handoff` (Next consumer enum) | `### Scope Creep Findings` if scope creep is detected, otherwise the scope-creep line inside `### ✅ Verified Clean`. |
| Code diff review, size M | before finishing branch; baseline = original objective | `## Reviewer Report`, `### ✅ Verified Clean`, `### Summary`, `### Handoff` (Next consumer enum) | `### Scope Creep Findings` if scope creep is detected, otherwise the scope-creep line inside `### ✅ Verified Clean`. |
| Code diff review, size L — per phase | after each phase; baseline = phase plan | `## Reviewer Report`, `### ✅ Verified Clean`, `### Summary`, `### Handoff` (Next consumer enum) | `### Scope Creep Findings` if scope creep is detected, otherwise the scope-creep line inside `### ✅ Verified Clean`. |
| Code diff review, size L — final | before finishing branch; baseline = full project plan | `## Reviewer Report`, `### ✅ Verified Clean`, `### Summary`, `### Handoff` (Next consumer enum) | `### Scope Creep Findings` if scope creep is detected, otherwise the scope-creep line inside `### ✅ Verified Clean`. |
| Plan / architecture review | reviewing a plan doc, not a code diff | `## Reviewer Report`, `### ✅ Verified Clean`, `### Summary`, `### Handoff` (Next consumer enum) | Plan/architecture checklist (hidden assumptions, completeness, risk, consistency); scope creep check does not apply. |

## Three Red Lines (must hold for every class)

- **Closure** - Every finding must have impact + fix direction.
- **Fact-driven** - Every finding must cite `file_path:line_number`.
- **Exhaustiveness** - Clean items must be explicitly listed under `### ✅ Verified Clean` with no silent caps.

This file is consumed by the M3 reviewer-output structural checks and must be updated in the same commit if code-review.md's taxonomy or reviewer.md's Output Contract changes.
