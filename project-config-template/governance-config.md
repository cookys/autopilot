# Project Governance Config

Place the resolved project policy in `.claude/owner-kernel-governance.json`. The filename is
historical (it predates the 2026-08-16 owner-kernel retirement — see
`docs/plans/2026-08-16-owner-kernel-retirement.md`); the file itself is a **live** input to
mission and campaign machinery and must not be removed while those consumers exist.

## Who reads it

| Consumer | Field(s) it reads | Effect |
|---|---|---|
| `scripts/mission-routing-admission.js` | `mission_convergence` | Mission routing admission and its `enforcement_mode` (`enforce` / `shadow` / `off`). **A missing file silently resolves to `off`** — deleting the file is a policy change, not a cleanup. |
| `scripts/implementation-campaign-check.js` | whole document via `resolveGovernancePolicy()` | Campaign-check validation of the frozen project policy. |
| `src/mission/cli.js` (`mission prepare`) | whole document (default `--config` path) | Mission preparation fails closed when the file is absent. |
| `platforms/codex/hooks/pre-effect.js` | mission projection | Codex-side mission projection; missing file drops the projection. |
| execution-profile machinery (`resolve-execution-profile.js`, keeper `policy.js` / `task-authority.js`) | `guidance_profile`, `assurance_profile`, `topology_preference`, `data_egress`, rosters, `action_catalog` | Project defaults and ceilings for role grants; a task envelope may narrow but never weaken them. |

## Field semantics

- `mission_convergence` — the operationally decisive section: `enforcement_mode` plus the
  convergence budgets (`max_campaigns`, `max_wall_seconds`, `max_tool_calls`,
  `max_engine_attempts`, `max_external_wait_seconds`).
- `governance.red_lines` — canonical token list frozen with the policy. A run can add tokens
  (`-x`), never remove or replace project tokens.
- `governance.guidance_profile` / `assurance_profile` / `topology_preference` / `data_egress` —
  project defaults; omitted fields resolve to `guided`, `conservative`, `auto`, `allowlisted`.
  Overrides may narrow but cannot weaken the project ceiling, and profile choice cannot grant a
  tool, effect, reviewer, or approval.
- `governance.default_mode` (`owner-led` / `milestone-led`), rosters, `approval_policy`,
  `action_catalog`, and the budget fields are part of the frozen schema validated by
  `resolveGovernancePolicy()`. The decision/acceptance state machine that once acted on the mode
  and rosters was retired; the fields remain schema-required and are treated as declarative
  policy until a successor consumer exists (see the four-layer redesign row in
  `docs/BACKLOG.md`).

## Example

```json
{
  "schema_version": 1,
  "governance": {
    "default_mode": "owner-led",
    "red_lines": ["no-production-push", "no-secret-disclosure"],
    "assurance_profile": "conservative",
    "guidance_profile": "guided",
    "topology_preference": "auto",
    "data_egress": "allowlisted",
    "owner_roster": [],
    "challenger_roster": [],
    "trusted_runner_roster": [],
    "approval_policy": {
      "read_only": { "requires_approval": false, "max_uses": 1 },
      "reversible": { "requires_approval": false, "max_uses": 1 },
      "external": { "requires_approval": true, "max_uses": 1 },
      "irreversible": { "requires_approval": true, "max_uses": 1 }
    },
    "action_catalog": [],
    "capability_ttl_seconds": 3600,
    "checkpoint_interval_closed_events": 100,
    "max_blocked_duration_seconds": 86400
  },
  "mission_convergence": {
    "schema_version": 1,
    "enforcement_mode": "enforce",
    "max_campaigns": 6,
    "max_wall_seconds": 14400,
    "max_tool_calls": 600,
    "max_engine_attempts": 3,
    "max_external_wait_seconds": 1800
  }
}
```

The dogfood copy in this repo (`.claude/owner-kernel-governance.json`) is the canonical worked
example.
