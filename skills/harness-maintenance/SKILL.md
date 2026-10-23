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

For a bounded expiry warning (run on demand; no hook calls it at SessionStart, by owner decision):

```bash
node bin/autopilot.js harness report --stale-after 14d --required-level H3 --format warning
```

If any target harness is `stale`, `unverified`, `warning`, `unavailable`, or below the required harness level, do not implement H3+ dispatch, hooks, gating, or orchestration from memory. Run a survey or local spike first.

## Available Scripts

| Script | Use |
|--------|-----|
| [`scripts/measure-profile-context.js`](../../scripts/measure-profile-context.js) | Produce content-free source, rule-inventory, or persisted Codex context summaries. A byte estimate is conservative evidence only; it cannot prove an exact-token budget or another host's prompt visibility. |
| [`scripts/probe-skill-frontmatter-portability.sh`](../../scripts/probe-skill-frontmatter-portability.sh) | Run disposable Claude Code/Codex skill-load probes and emit a version-bound pass/fail/inconclusive receipt before changing frontmatter metadata. |
| [`scripts/probe-harness-capabilities.sh`](../../scripts/probe-harness-capabilities.sh) | Re-probe the exact platform surfaces consumed by the capability-trigger mission and delegate the closed aggregate receipt write to the canonical claim validator. |
| [`scripts/platform-capability-claims.js`](../../scripts/platform-capability-claims.js) | Generate and immediately revalidate content-addressed capability claims plus the exact D2/D3/D4 consumer partition. Only this script emits validated claim IDs. |
| [`scripts/probe-todo-tools-pin.js`](../../scripts/probe-todo-tools-pin.js) | Single live-call probe: do the task tools (TaskCreate family) reach a headless session from this directory's environment? Run after touching settings/env wiring; `--expect-absent` is the planted-red arm. Exit 0 met / 1 contradicted / 2 indeterminate. |
| [`scripts/install-token-discipline.js`](../../scripts/install-token-discipline.js) | Opt-in: write or remove the marked token-discipline block in Codex `AGENTS.md` and agy `GEMINI.md`; `--check` reports drift. Nothing calls `install` by default. |
| [`scripts/hook-harness-matrix.js`](../../scripts/hook-harness-matrix.js) | Regenerate or check `docs/hook-harness-matrix.md` (hook x harness registered events; a date only where `hooks/harness-support-evidence.json` has a probe-backed row, else 未驗證). Add an evidence row after a live-fire probe; `--check` warns on rows older than 60 days. |
| [`scripts/probe-codex-enforcement.js`](../../scripts/probe-codex-enforcement.js) | Live probe that the Codex plugin hook blocks a direct write (`--output <artifact.json>`). |
| [`scripts/probe-codex-postcompact-production.js`](../../scripts/probe-codex-postcompact-production.js) | Bounded live check of the production Codex PostCompact adapter. |

## Update Rules

- Capability records live in `src/harness/capabilities/*.json`.
- Records may contain observed versions, commands, probe results, and capability status.
- Records may contain `auth_domains`; use it to separate driver availability
  from native provider subscription quota and third-party provider quota.
- Records must not contain secrets.
- Records must not become runtime model/effort routing policy.
- Keep execution argv separate from roster tuple metadata. In particular, agy production transport
  selects the tiered model slug while effort stays roster metadata; a tier/effort mismatch fails closed.
- Engine code consumes capability data; it does not infer routing from harness or model names.
- Fresh H2 adapter evidence is not H3 dispatch/hook/gate readiness. Treat `required_level` warnings as blockers for H3+ work.

## Governance Gate

For implementation level and role qualification decisions, read:

- `skills/engine-onboarding/references/role-and-harness-governance.md`

Use that reference before changing scorecard rows, hook behavior, dispatch authority, or engine APIs.
