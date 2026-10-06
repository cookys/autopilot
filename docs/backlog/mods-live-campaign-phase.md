# mods live band shows no phase for an in-progress campaign

Source: mods P1c C3b report (`docs/plans/evidence/2026-10-04-mods-p1c/README.md`, section C3b); owner asked for a phase on the band ("which project, which phase, how long, progress").

- **Gap 1, engine runs**: a live campaign's state is in `<git-common-dir>/autopilot/implementation-campaign.jsonl`, keyed by `campaign-v1-<hash>` (repo identity + ticket + contract digest). `task_status_receipt` validates only campaigns with a terminal receipt, and nothing maps `root_run_id` to that id. Needed: a resolver (or a field stamped on the run manifest / session marker when the campaign starts) so the watcher or renderer can read the live phase. Then `PHASE_LABEL` in `scripts/render-review-page.js` already has the labels.
- **Gap 2, dev-flow sessions**: the stages L-1..L-5 and the plan's P0..P4 exist as prose only. A writer (for example `stage-advance.js --to <node>`; the marker `phase` field was removed in stage-graph P2b) called from dev-flow would feed the band. That edits `skills/dev-flow/SKILL.md`, a guidance change, so it needs eval ON/OFF evidence first (CLAUDE.md scorecard-first).
- Until then a run in progress without a frozen progress receipt shows `—` for phase.
