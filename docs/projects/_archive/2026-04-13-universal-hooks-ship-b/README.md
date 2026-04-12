# Universal Hooks Ship B (v2.5.0)

**Date**: 2026-04-13
**Status**: In Progress
**Branch**: `feature/v2.5.0-universal-hooks`
**Plan**: `docs/plans/2026-04-12-universal-hooks.md`
**Size**: L
**Source**: [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 (MIT) — 14 hooks port with Ship A review adjustments

## Project Goal

> **Final goal**: Port 14 universal hooks (8 default-on Tier A + 6 opt-in Tier B) into autopilot plugin, bringing hook-layer enforcement to complement the methodology agent layer shipped in v2.4.0.
> **Success criteria**:
> 1. 8 Tier A hooks registered in `hooks/hooks.json` and functional (verified by 8/8 positive+negative manual tests in P4)
> 2. 6 Tier B hooks with opt-in examples in `settings.example.json` (verified by 3/6 spot-check)
> 3. `branch-protection.js` uses anchored whole-ref regex (not substring) — verified by `echo "main" | node hooks/branch-protection.js` blocks + `echo "mainline"` passes
> 4. Secret patterns shared module used by both `audit-log.js` and `commit-secret-scan.js` — verified by grep for `require.*secret-patterns` in both files
> 5. Version bump 2.4.0→2.5.0 complete — verified by `grep -rn "2.4.0" . | grep -v CHANGELOG | grep -v docs/plans/` returning empty
> 6. Zero breaking change — existing autopilot users unaffected after upgrade
> **Scope boundary**:
> - IN: 14 hooks, shared secret-patterns module, hooks.json registration, settings.example.json, project-config-template/hooks.json, hooks/README.md, README updates, version bump, CHANGELOG
> - OUT: Unit tests (no Node test framework convention), Windows support (Unix/Node.js assumed), Ship A agent/quality-pipeline changes, TWGameProject-specific hooks
> - OUT: Automated test suite (manual testing in P4 only)

## Scope Completeness Audit (L-1.5)

| Dimension | In Scope? | Coverage |
|-----------|-----------|----------|
| Source code | Yes | P1 (Tier A ×8 + shared module) + P2 (Tier B ×6) |
| Tests | No (OOS) | Manual testing in P4; no unit test framework convention |
| User-facing docs | Yes | P3: hooks/README.md, README.md, README.zh-TW.md |
| Config templates | Yes | P2: settings.example.json, project-config-template/hooks.json |
| CHANGELOG | Yes | P3: v2.5.0 entry |
| Version bump | Yes | P3: plugin.json + marketplace.json |
| Version sync grep | Yes | P3.5: grep old version returns empty |
| Migration | No | Zero breaking change |
| Dependent repos | No | Hooks internal to plugin |
| Credit/attribution | Yes | P3: README Inspired By update |
| Dogfood | Yes | autopilot eats its own hooks from v2.5.0 |

## Progress

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| P0 | Plan review (2+ reviewers) | Pending | — |
| P1 | Tier A hooks (8 default-on + shared module) | Pending | — |
| P2 | Tier B hooks (6 opt-in) | Pending | — |
| P3 | Docs + version bump | Pending | — |
| P4 | Manual testing (8/8 Tier A + 3/6 Tier B) | Pending | — |
| L-5 | finish-flow closing sequence | Pending | — |

**Last updated**: 2026-04-13
