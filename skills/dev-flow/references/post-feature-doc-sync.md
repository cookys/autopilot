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
