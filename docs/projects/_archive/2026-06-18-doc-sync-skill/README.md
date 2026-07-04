# doc-sync skill — doc↔code drift audit (v2.19.0)

> L-ship. Adds `autopilot:doc-sync`, a portable doc↔code drift auditor, and wires
> it into the orchestrator.

## Project Goal

> **Final goal**: Promote the codeforge-local doc-drift audit into a first-class,
> portable autopilot skill that the orchestrator invokes.
> **Success criteria**:
> - `skills/doc-sync/SKILL.md` exists and passes `scripts/validate.sh` (boolean).
> - Skill is portable: default `native` dispatch, `Workflow` tool only a capability-gated fast path (no hard dependency) — verified by reading the SKILL.md dispatch section.
> - Wired into orchestrator: `dispatch-config.md` `## Doc Drift Audit` chain + `finish-flow` L-5.4 + dev-flow `post-feature-doc-sync.md` reference (3 edits present).
> - Release hygiene: version 2.19.0 synced across mirrors (`sync-version.js --check` exit 0), skill count 19→20, CHANGELOG v2.19.0 entry, INDEX row.
> **Scope boundary**: autopilot side only (skill + templates + wiring + release). The codeforge-side `.claude/doc-drift-config.md` + existing Workflow scripts are the consuming project's concern (done separately in the codeforge repo).

## Phases

| Phase | Status |
|-------|--------|
| P1 doc-sync SKILL.md (generic, portable) | ✅ |
| P2 doc-drift-config.md template | ✅ |
| P3 orchestrator wiring (dispatch-config + finish-flow + dev-flow ref) | ✅ |
| P4 README skill table + counts + CHANGELOG + INDEX | ✅ |
| P5 release sync (sync-version 2.14.0 / skills 20) + validate | ✅ |

## Notes

Origin: a codeforge doc↔code drift audit (2026-06-18) found 48 confirmed drift
items (13 WRONG / 27 STALE / 8 MISSING) in a mature repo — strong signal that
doc drift is systematic and worth a standing tool. codeforge ships two
Claude-Code `Workflow` scripts (`doc-drift-scoped.js`, `doc-code-drift-audit.js`)
as its CC fast-path implementation; this skill is the portable, generic layer.
