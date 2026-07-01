---
name: harness-maintenance
description: >
  Audit or refresh Autopilot harness capability state. Use when checking whether Codex,
  Claude Code, agy, Grok, MiniMax, Copilot CLI, or another harness currently supports
  skills, hooks, agents, status lines, headless dispatch, DI, gating, or runner roles;
  when platform facts may be stale; or before expanding cross-harness integrations.
---

# Harness Maintenance

Use this skill to keep fast-moving harness facts out of memory and out of engine code.

## Start Here

Run the read-only capability report first:

```bash
node bin/autopilot.js harness report --stale-after 14d
```

For a bounded SessionStart-style warning:

```bash
node bin/autopilot.js harness report --stale-after 14d --required-level H3 --format warning
```

If any target harness is `stale`, `unverified`, `warning`, `unavailable`, or below the required harness level, do not implement H3+ dispatch, hooks, gating, or orchestration from memory. Run a survey or local spike first.

## Update Rules

- Capability records live in `src/harness/capabilities/*.json`.
- Records may contain observed versions, commands, probe results, and capability status.
- Records must not contain secrets.
- Records must not become runtime model/effort routing policy.
- Engine code consumes capability data; it does not infer routing from harness or model names.
- Fresh H2 adapter evidence is not H3 dispatch/hook/gate readiness. Treat `required_level` warnings as blockers for H3+ work.

## Governance Gate

For implementation level and role qualification decisions, read:

- `skills/engine-onboarding/references/role-and-harness-governance.md`

Use that reference before changing scorecard rows, hook behavior, dispatch authority, or engine APIs.
