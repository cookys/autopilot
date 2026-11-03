# Remaining entry gaps from the 2026-10-21 audit

BL-0277. The row's Pointer is the audit archive README. This sidecar holds the leftovers that still need an entry. Trigger-Type ready. Effort M.

- scripts/dispatch-tree.js: read-only merge of the subagent tree and the rail tree. The audit found one entry line, a usage note in references/hetero-dispatch.md. No skill, agent, AGENTS.md, src/hooks or mods caller. A comment calls it the live pane's identity hand-off step 1, and it is not wired.
- scripts/dispatch-foreman.sh: references/hetero-dispatch.md says it is not wired into /l5 yet. The only entry found is the clone-per-unit recipe in skills/l5/references/hetero-impl-loop.md.
- `harness report --format warning` is described as SessionStart-style in skills/harness-maintenance/SKILL.md. No hook calls it (hooks, src/hooks, settings). An agent runs it only if that skill is loaded.
- Mission subcommands other than prepare and grant have no entry hit. prepare and grant are taught in skills/l5/references/hetero-impl-loop.md. The audit lists successor, init, consume, withdraw, control, finalize-abort, check and receipt as engine-internal or manual, with no skill entry. The audit's own suggestion was that they need not enter the table unless someone wants them kept and labelled internal. This row keeps that as an open gap, not a decision to teach every subcommand.
- roundtable stays on BL-0216. Original trigger: three more manual rooms under the Phase 0 protocol, each with an evidence dir, or the owner asks for the skill by name.
- task-card stays on BL-0243. Original trigger, unchanged: P3, handoff reads the snapshot and dev-flow calls task-card, after guidance and eval. discover-audit.md item 6 is the same deferral.

Owner decision 2026-10-23 (d-7a800dcb): the `harness report --format warning` expiry warning is not wired to SessionStart.

Dispatch-tree withdrawal 2026-10-23: in two bpack pilots neither arm ever opened `skills/ceo-agent/references/depth0-control-loop.md`, so a dispatch-tree sentence placed there is never read. Teaching dispatch-tree needs a SKILL.md-level change with its own ON/OFF eval. The other gaps stay as listed.
