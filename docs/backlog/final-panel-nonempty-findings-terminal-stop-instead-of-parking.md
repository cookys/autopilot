# Final panel with non-empty findings terminal-stops instead of parking for depth-0 disposition

- **Context**: the final path (`src/engine/campaign-composition.js:3159-3167`) adjudicates the terminal panel with
  `final: true`; non-empty findings with no bound authority throw `AUTHORITY_REQUIRED`
  (`src/engine/campaign-adjudication.js:416-419`, any severity incl. 🔵), and the path returns
  `blocked('final_adjudication', 'final finding registry is incomplete')` with no durable-wait marker, so the engine
  terminalizes the campaign. Only the in-loop path (`final: false`) parks via `awaitingDisposition`
  (`:2783-2830`). Supplying authority at intake cannot help: `--campaign-disposition-authority` binds the panel's
  `review_digest`, which does not exist until the panel runs. Terminal campaigns cannot be resumed
  (`src/engine/campaign-intake.js:1238-1247`, `src/campaign/cli.js:858`), and v2.36.112 reaps seat artifacts at terminal.
- **Fix (direction, needs a plan)**: on the final path, an incomplete registry whose only cause is missing
  disposition authority parks in `AWAITING_DISPOSITION` (same classification as `incompleteIsDurableWait`), keeps the
  panel seat artifacts, and resumes into final adjudication only — no new model call, no new writer, no ledger edit;
  depth-0 supplies an authority bound to the stored panel `review_digest`. Hard-fail classifications still terminalize.
  Watch the design note `docs/plans/2026-09-18-blind-review-panel-station.md:24` ("only the in-loop adjudication can
  authorise a repair") — parking for disposition is not authorising a repair; a FIX disposition still routes to the
  existing degrade path.
- **Test**: a campaign whose final panel returns 🔵-only findings parks (not TERMINAL_STOP); resume with a bound
  depth-0 authority reaches terminal success without any runner call; an unbound/stale authority is rejected; a seat
  fault still fails at `final_panel`.
- **Workaround today**: depth-0 re-derives the preserved panel JSON and lands via l3 degrade + depth-0 hand repair or
  acceptance (no engine ledger entry), or a fresh campaign.
- **Source**: peer-reported cuda/chatgpt-tunnel 2026-10-03, msg 01M416P22N8XA90FX5YC8AQ3GV (campaign 028e…abd8c,
  candidate ed34); trace re-verified by depth-0.
