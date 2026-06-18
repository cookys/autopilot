# Post-Feature Doc Sync

> On-demand reference for dev-flow. Loaded at Session End after code changes.
> Origin: `dev-flow/SKILL.md` Session End.

After code changes, verify documentation matches the new state:

| Changed | Should Update |
|---------|--------------|
| Core logic / business rules | Module docs or skills |
| Architecture / system design | Architecture docs |
| Interfaces / API contracts | API spec files |
| New/removed components | Component index, project config |
| Environment / infra changes | Deploy or infra docs |

Skip doc sync for: bug fixes, minor value tweaks, log message changes.

## Automated check — `autopilot:doc-sync`

The table above is the manual checklist. For an automated doc↔code drift audit
(finds WRONG / STALE / MISSING claims, adversarially verified, report-only),
invoke **`autopilot:doc-sync`**:

- **scoped** mode (cheap, default) — audits only the docs describing the modules
  this diff touched. Run it whenever user-facing behavior or 3+ modules changed.
- **full** mode (expensive) — whole-repo sweep; OFFER for large/user-facing ships
  or periodically (>30 days since last).

doc-sync is also wired into `finish-flow` L-5.4 (Post-Merge Review). It is
report-only — triage + fix per its fix policy. Configure per-project domains via
`.claude/doc-drift-config.md` (template in `project-config-template/`).
