# Managed rail: `--resume` with a disposition authority drops the prior findings and terminal-stops the campaign

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **FIRED — measured 2026-09-14** on mission-3b68ecb09a61 (backlog-entry-schema): round-1 review returned FIX-THEN-SHIP → `awaiting_disposition`; the re-invocation with `--resume --campaign-disposition-authority <valid file>` blocked at `disposition_resume` with `campaign review findings are unavailable for disposition binding`, then emitted `terminal_stop` (resumable:false). The AWAITING_DISPOSITION campaign event carried the findings; the durable controller body had `findings_snapshot: null`, so `resume.findings` was empty.
- **Context**: the disposition rail is unreachable end-to-end from the CLI — every non-empty review ends the campaign. Depth-0 adjudicated from the run JSON instead and merged on git evidence.
- **Effort**: S (persist `findings_snapshot` on AWAITING_DISPOSITION and rebind on resume; a test that drives review→disposition→resume with a real authority file).
- **Source**: this dogfood; evidence `docs/plans/evidence/2026-09-14-backlog-entry-schema/impl-run3-resume-terminal-stop.json`.

