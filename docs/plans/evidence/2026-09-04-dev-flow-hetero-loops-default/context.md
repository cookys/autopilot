# Context moved out of the plan (growth rail) — dev-flow hetero loops as default

Usage investigation 2026-09-04 (878 local sessions + 7 fleet session replies, populations kept
separate): the owner's dominant phrasing is "叫 autopilot plan loop review hetero", "coding 完成後
過 hetero loop review", "engage hetero engine review". No skill `description:` contains any of these
words. `scripts/dispatch-plan-review.js` has exactly one caller (`research-to-ship` Phase 3); the
three-seat qc panel is reachable only through `finish-flow` L-5.2; per-phase code review inside
dev-flow L-4 is one free-text checklist line. The observed confusion between "hetero engine" and
"agent-call" is a routing gap: the verb decides the posture (ask/consult → a model; call/dispatch/
notify → a CLI engine if X is an engine name, a session if X is a host/project/pane).

Fleet replies: engines have fixed division of labour (sol reads/reviews, fable/kimi/grok discuss,
gemini flash implements, sonnet foremen); every "ask a model" happens via a raw CLI call;
`dispatch-consult` / `dispatch-explore` / codex plugin have zero use. Two peers declined a
behavioural survey (peer messages are not authorization; profiling is sensitive) — ask directly or
address by `--instance`.

Scorecard facts found while seating D0: there is no `plan_reviewer` role in the scorecard; sol's
reviewer qualification (event 141) is recorded under runner `codex-cli`, not `codex`; MiniMax's
reviewer row (event 9) is legacy (no effort partition); kimi is consult-qualified only (event 182)
and is not a `dispatch-plan-review.js` runner.

Generation-1 plan review artifact: `plan-review-g1.json` (sol STOP, GLM CONDITIONAL, MiniMax
CONDITIONAL; 20 findings; all 11 blockers accepted and folded into R1 of the plan).
