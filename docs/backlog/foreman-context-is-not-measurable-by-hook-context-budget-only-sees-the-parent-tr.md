# ~~Foreman context is not measurable by hook — `context-budget` only sees the parent transcript~~ (CLOSED 2026-09-05, v2.36.1: `subagentStatusLine` `tasks[].tokenCount` is the per-agent usage field; `foreman-guard.js` denies at T2 from the tmpfs live file — `docs/plans/_archive/2026-09-05-statusline-live-context-feed.md`)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: Claude Code's hook payload carries the SUBAGENT's own `transcript_path` (or an equivalent per-agent usage field) — check the CC changelog / a SPIKE on the running version; or a second cost incident where a foreman's context (not its Bash count) is the driver.
- **Context**: v2.35.15 put ironlaw #6 in the loop through `foreman-guard` (Bash cap, polling, Monitor), but the digest's second burn shape — waking after cache TTL and re-writing a ≈900K context — is a CONTEXT ceiling, and `context-budget` deliberately exits on `agent_id` because the payload's `transcript_path` is the parent's. Until the payload identifies the subagent transcript, the Bash cap + 一刀一命 are the foreman's only ceilings. Fix shape: when a per-agent transcript is available, apply T1/T2 to it and make T2 a `deny` for subagents (a foreman can be forced to hand off; depth-0 cannot).
- **Effort**: Fix (once the payload exists) / Spike first
- **Source**: cuda quota digest 2026-09-04; `docs/plans/2026-09-04-foreman-cost-discipline.md` D2

