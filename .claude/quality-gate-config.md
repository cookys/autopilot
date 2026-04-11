# Quality Gate — autopilot Project Config

> Self-hosting: autopilot's own `.claude/quality-gate-config.md`. Loaded when
> `autopilot:quality-pipeline` runs inside the autopilot repo.

## Test Command

**N/A** — autopilot ships prose skills and markdown agent definitions. There is no test suite, no test runner, no lint target. Skip the `test` step entirely.

## Scan Command

**N/A** — autopilot has no pre-commit scan script. Use the inline completeness gate: `git diff develop..HEAD | grep -iE 'TODO|FIXME|XXX|HACK|placeholder|stub|not.implemented'` returns empty.

## Code Review

Primary: dispatch `autopilot:reviewer` (the methodology-disciplined reviewer that ships with this plugin — reads Three Red Lines into the system prompt).

Fallback: `superpowers:code-reviewer` — only when `autopilot:reviewer` is not available in the current session (e.g., dev-mode plugin and new agents added mid-session that require restart to register).

Follow `skills/quality-pipeline/references/code-review.md` for the 4-tier severity grading and Handoff enum consumption table.

## Route Overrides

- **S**: completeness scan → review (skip test, skip scan script)
- **L**: completeness scan → review per phase + final pre-merge review (skip test, skip scan script)
- **hotfix**: completeness scan → review only

## autopilot-Specific Notes

- **Description changes are high-risk**: editing a skill's `description:` field changes Claude Code's routing behavior. Always include description changes in the review scope, not as "cosmetic".
- **Inspired By attribution**: if the diff absorbs external OSS / prior art, reviewer must check that `README.md` + `README.zh-TW.md` `Inspired By` sections have a corresponding entry (v2.2.1 mandate + v2.4.0 cross-check).
- **Version sync**: if `plugin.json` or `marketplace.json` version bumps, reviewer must confirm `grep -rn "<old-version>" . | grep -v CHANGELOG | grep -v "docs/plans/"` returns empty.

## CEO Mode

Quality gate is non-negotiable, even in CEO mode. CEO cannot self-certify — the reviewer dispatch is the audit committee.
