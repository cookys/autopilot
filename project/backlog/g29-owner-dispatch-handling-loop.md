# G29: owner-side dispatch and handling loop, thin plan to write (BL-0405)

Source: PM go-ledger G29, PM ruling 2026-11-05. Priority: after the role-members plan.

## Scope of the thin plan
- The owner dispatches hands as fleet child seats instead of through the Agent tool.
- The owner's wake-up handling loop: judge the result against the acceptance, a small retry budget, escalate to the PM when the budget is spent.
- Subtree-level structured progress display: phase, attempt, evidence, deadline.
- A WIP or queue unit is optional.

## Not covered elsewhere
Neither the team charter v1 nor the fleet task lease covers these.
