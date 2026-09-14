# Foreman model is hardcoded as `opus` in /l4–/l6 prose; routing config already overrides it

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: any consuming project sets `tree:sub-orchestrator` in `.claude/model-routing-config.md`
  (revival.3d did on 2026-08-28: `sub-orchestrator → sonnet`, `judge → haiku`), or a cost audit shows
  the foreman dominating spend.
- **Context**: `skills/l6/SKILL.md`, `skills/ceo-agent/references/level-front-door.md` (§"Dispatching
  the foreman", Amendment 11 note) and `skills/l4/SKILL.md` state "foreman / sub-orchestrator = `opus`"
  as a rule, while `scripts/resolve-dispatch.sh --tree --role sub-orchestrator` correctly honours the
  project override (`source:"project"`). Evidence from revival.3d session `5ca9b104` (grok cost split,
  one day, ~25 lines): opus foremen 7,929 turns ≈ $1,081 (62% of spend), sonnet leaves 23%, the
  Fable depth-0 16%. Foreman work was ≥90% protocol execution (dispatch leaf, run probe, wait, run
  gates, write run doc); the 3–5 judgment points per line were criteria-driven and caught by
  pre-registered criteria, not by model tier. Owner decision: "smart at decision points, not in the
  supervision loop" — foreman = cheapest model that follows the protocol, judge reads the four-state
  criteria table, only BLOCKED escalates to depth-0.
  Three things to fix: (1) reword the three docs so `opus` is the *default* not the *rule*, and
  point to the routing override; (2) `hooks/dispatch-model-guard` (opt-in, Tier B) must read
  `resolve-dispatch.sh` output rather than assert `opus` for `sub-orchestrator`, else enabling it
  will reject a legitimate `sonnet` foreman; (3) offer a deterministic foreman shape — a Workflow
  script (`implement → verify-author → gates → harness → criteria table → escalate on BLOCKED`) —
  as the documented alternative to a model-driven foreman loop, since most foreman turns are
  deterministic.
- **Effort**: S (docs + hook read path) · L for (3) if shipped as a bundled workflow
- **Source**: revival.3d `15edf5e7` (routing override), `NOTE-FOR-FABLE-QUOTA.md` (grok cost split),
  revival.3d `docs/governance/dispatch.md`


