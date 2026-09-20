# Rubric — 2026-09-14-backlog-entry-migration.md

> Source plan: docs/plans/_archive/2026/09/2026-09-14-backlog-entry-migration.md

R1: The migration parses with the gate's grammar (the gate exports its parser; no second parser).
R2: Byte preservation is verified by re-reading each sidecar and locating the moved text verbatim; `preserved: true` only then.
R3: `--apply` is opt-in; the default writes nothing and prints a manifest plus a diff.
R4: Within-schema entries are byte-identical after migration; a second `--apply` moves zero bytes.
R5: Status/Effort synthesis follows the plan's rules exactly; unknown → `open` / `M`.
R6: Sidecar slugs are deterministic, ≤ 80 chars, de-duplicated with numeric suffixes; CJK titles produce a valid slug.
R7: A sidecar write failure leaves the backlog untouched and exits 1.
R8: The real docs/BACKLOG.md dry-run completes without crashing.
R9: No file under docs/backlog/ is created by the campaign.
R10: Inventory wiring (docs/scripts-inventory.md row, CLAUDE.md group list) and mirror parity.
