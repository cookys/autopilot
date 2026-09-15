# Backlog entry schema

A backlog entry is an **index row**. It names what, when it fires, size, who saw it, and where evidence lives. Measurement numbers, log excerpts, call stacks, decision narratives, and more than one sentence of context live **at the pointer**, never in the row. Preferred pointer targets, in order: an existing `docs/plans/…` file, an existing `docs/projects/…` file, a ticket id matching `id_pattern`, then a sidecar `docs/backlog/<slug>.md`.

Caps are UTF-8 **bytes** (not characters). The gate (`scripts/check-backlog-entries.js`) is the measuring instrument. A consumer config may only **lower** a cap.

## Fields

Every style carries the same fields. `Context` is the only optional field.

| Title | 120 | one line; unique per file case-insensitively; no trailing period |
| Status | 64 | `open` · `fired <YYYY-MM-DD>` · `shipped <version-or-sha> <YYYY-MM-DD>` · `dropped <YYYY-MM-DD>` — done rows carry the date so retention can be measured |
| Trigger | 240 | one line; for `fired` rows the date replaces the condition |
| Effort | — | `S` · `Fix` · `M` · `L` · `H` |
| Source | 160 | who/what surfaced it |
| Pointer | 200 | a path under a configured `pointer_roots` that **exists**, or an id matching `id_pattern`; `none` only when the whole entry is ≤ 600 B (pointer threshold; distinct from the 900 B entry cap) |
| Context | 240 | optional; one-line problem statement |

**Entry cap**: 900 B total. Nothing but these fields — an extra bullet, sub-list, or code fence is `extra_content`.

**Done handling**: `shipped` / `dropped` rows older than `done_retention_days` (default 30) are `done_not_moved`. The fix is **deleting the row** (history is in git and at the pointer).

## Styles

A file declares one style in `backlog-config.md`. The gate parses all three.

**heading** — `### Title` then `- **Field**: value` bullets (this repo).

**table** — `| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |` rows; `Id` matches `id_pattern`. Several tables (one per `##` section) may repeat the header; `\|` inside a cell is a literal pipe. A table with foreign headers (e.g. `id｜標題｜狀態｜體量｜來源｜spec｜備註`) is converted once by `migrate-backlog-entries.js`: map headers under a `## Columns` config section (`- 標題: Title`) and state words under `## Status map` (`- planned: open`); a `Trigger：…` inside the Status cell becomes Trigger; a row whose cells carry text the schema columns cannot hold moves its original row line verbatim to a sidecar, a row they can hold stays with `none`.

**checklist** — `- [ ] [Severity] Title` plus indented `- Field: value`. Severity is a tag, not a field.
