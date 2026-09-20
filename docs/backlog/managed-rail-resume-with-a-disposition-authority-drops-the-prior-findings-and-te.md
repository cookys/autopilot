# Managed rail: `--resume` with a disposition authority drops the prior findings and terminal-stops the campaign

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **FIRED — measured 2026-09-14** on mission-3b68ecb09a61 (backlog-entry-schema): round-1 review returned FIX-THEN-SHIP → `awaiting_disposition`; the re-invocation with `--resume --campaign-disposition-authority <valid file>` blocked at `disposition_resume` with `campaign review findings are unavailable for disposition binding`, then emitted `terminal_stop` (resumable:false). The AWAITING_DISPOSITION campaign event carried the findings; the durable controller body had `findings_snapshot: null`, so `resume.findings` was empty.
- **Context**: the disposition rail is unreachable end-to-end from the CLI — every non-empty review ends the campaign. Depth-0 adjudicated from the run JSON instead and merged on git evidence.
- **Effort**: S (persist `findings_snapshot` on AWAITING_DISPOSITION and rebind on resume; a test that drives review→disposition→resume with a real authority file).
- **Source**: this dogfood; evidence `docs/plans/_archive/2026/09/evidence/2026-09-14-backlog-entry-schema/impl-run3-resume-terminal-stop.json`.


## Resolution (v2.36.41, 2026-09-14)

The one-liner above ("persist `findings_snapshot` on AWAITING_DISPOSITION and rebind on resume") named the wrong layer. The engine already forwarded `findings_snapshot || unresolved_findings` on resume; both faults were in `src/engine/campaign-composition.js`:

- Writer: the AUTHORITY_REQUIRED adjudication carries no `findings`, so the fallback read `review.findings` — the normalized JSON *string* — through `classifyMissingDisposition`, which only reads arrays → snapshot `[]`.
- Resume binder: the snapshot *array* was spliced into `review.findings`; the disposition provider's `reviewFindingIds` accepts only the string → "unavailable for disposition binding" → `disposition_resume` blocked.

Fix commit `7ff84c21`, merge `9fd24051`. Verified at the composition layer (`hooks/tests/implementation-campaign-routing.test.sh`, "Disposition resume must rebind": review → wait → resume with a depth-0 authority → `DISPOSITION_RESUMED`; three mutants caught). **Not yet measured end-to-end through `engine implement-review --resume --campaign-disposition-authority`** — the next managed campaign's first non-empty review is the measurement point; the CLI resume sandbox in the same test file (`resume_intake_probe`, second-process resume) is where an e2e case would go.
