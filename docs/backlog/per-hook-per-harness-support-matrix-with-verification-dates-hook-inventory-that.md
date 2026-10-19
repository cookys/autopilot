# Per-hook × per-harness support matrix with verification dates (hook inventory that is periodically re-checked)

Source: docs/BACKLOG.md as of 061cc11c7^, migrated 2026-09-14. Old id BL-0026. Audit 3.3: the script shipped, every cell is unverified, and the 60-day expiry check never entered preflight or CI.

- **Trigger**: the next hook that is registered on a second harness (Codex `Stop`/`SessionEnd` for `dirty-protected-paths` is the first, v2.36.11, and its Codex live-fire is unverified), or a `harness-maintenance` run that finds a hook-event claim older than 60 days.
- **Context**: owner question 2026-09-07 「那些 hook 是不是要統一做個盤點表定期 check 所有 harness 是否支援」. Today the facts are split: `references/multi-agent-portability.md` has one "Hook event names" row per harness (prose, last-verified date at file top), `scripts/check-hook-inventory.js` checks Claude wiring vs tiers, `scripts/platform-capability-claims.js` + `harness-maintenance` track harness capability staleness — but nothing joins hook stem × harness × event × evidence date. Shape: `hooks/harness-support.json` (stem → {harness → {event, registered, verified_at, evidence}}), a checker that (i) fails when a wired hook has no row, (ii) warns when `verified_at` is older than N days, (iii) is read by `harness-maintenance`; evidence for a row = a hook-probe run (Codex hook-probe package / Claude test) that shows the event actually fired — a hook existing is not a hook running.
- **Source**: owner 2026-09-07 during the dirty-tree hook ship; `references/evidence-discipline.md` (script existing ≠ running).

Restored 2026-10-19 from 061cc11c7^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
