# Uncalled-script follow-ups

BL-0279. Each item below was deferred for its own reason.

(a) `skills/retro/SKILL.md` could name `check-escalation-coverage.js --gate` next to its `tree.js` escalations step. A retro skill edit needs a guidance eval.

(b) `skills/l4`, `l5`, `l6` `SKILL.md` and `skills/dev-flow/references/card-relocated.md` state that the `profile-session.js` lane only proves no-effect isolation but never say when or who runs it, so point them at the profile doc. The l4/l5/l6/dev-flow card statements need a guidance eval.

(c) Wire `scripts/qc-panel.js` to emit to `qc-metric-emit.js` only if the owner wants the depth-0 panel measured again (store last written 2026-09-03). Wiring qc-panel.js is a code change needing an owner decision.

(d) Archive `docs/plans/2026-08-03-next-touch-debt-retirement.md` is blocked because the sealed mission graph `docs/mission-next-touch-debt-retirement-execution-graph.json` pins the plan path.
