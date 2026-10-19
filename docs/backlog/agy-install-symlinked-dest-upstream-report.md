# Upstream report for the agy install symlinked-destination self-copy truncation

No sidecar existed in history. Original row text from 5d0b29c1d^:docs/BACKLOG.md. Only the still-open upstream report is in scope; the install guard already shipped.

> ### agy install symlinked-dest self-copy truncation — guard install script + upstream report
> - **Trigger**: before the next `agy plugin install` of autopilot anywhere in the fleet (until the guard ships, manually check the plugins directory for symlinks first), OR next S-size hardening slot.
> - **Context**: 2026-06-11 incident, mechanism confirmed by a sandboxed repro the same day. Install follows a symlinked destination and self-copies: open and truncate the destination (which is the source through the symlink), read back empty, write 0 bytes, file after file. Sandbox: symlinked dest zeroed 1497 files and destroyed git HEAD. The incident was a legacy symlink from the agy 1.0.1 era. Hazard and guards are documented in the portability reference.
> - **Remaining**: (c) upstream report to Antigravity — a short deterministic repro (clone, symlink the dest, install), verified on 1.0.5 and 1.0.7. Intentionality research the same day: plugins-dir symlinks are plausibly their own plumbing, so the kill condition is reachable without user error. The destructive follow is undocumented. No existing issue covers it.
> - **Done**: (b) v2.15.1 — preflight guards in the install scripts (symlink refuse never bypassable).
> - **Effort**: S
> - **Source**: 2026-06-11 incident + same-day sandboxed repro spike (H1/H2/H3 refuted, H6 symlink-dest confirmed).

Audit finding (section 3.3, dropped by 5d0b29c1d): the upstream report still needs the owner account and identity consent to send. Origin owner. Trigger-Type owner.

Restored 2026-10-19 from 5d0b29c1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
