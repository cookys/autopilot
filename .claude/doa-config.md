# DOA Config — autopilot (this repo)

> Read by `scripts/resolve-doa.sh`. This repo adds no Project Override rows; presets come from
> the code defaults. The section below is the production target table (see
> `project-config-template/doa-config.md` § Production Targets for the rules and residual risks).

## Production Targets

A per-project list of deploy targets and their class. Consulted by `scripts/resolve-doa.sh`
only when the caller passes `--target <name>`; calls without `--target` are unaffected.

| Target | Class |
|--------|-------|
| example-prod | production |
| example-staging | staging |

Rules (enforced by `scripts/resolve-doa.sh`, tests in `hooks/tests/resolve-doa.test.sh`):

- `Class` is exactly `production` or `staging`. `Target` is matched by exact name: no glob, case-sensitive.
- `production` → the action is **refused** (`production_denied`, exit 10), never escalated: no decision
  card is opened and no in-session "go" turns it into permission. The operator runs production himself.
- `staging` → the ordinary DOA class for the (role, tier), same as a call without `--target`.
- A target that is not on the table, a missing table, or **any malformed row** (misspelt class, wrong
  column count, bad name) → fail closed (`target_unlisted`, exit 11).
- The table is read **only** from the committed `.claude/doa-config.md` at the repository root.
  `$DOA_CONFIG_OVERRIDE` and the Project Override rows can never relax, or add to, this list.
- Every change to this list must
  be a reviewed commit.

Accepted residual risks (master plan: operator console, §6):

1. The caller self-reports `--target`. Passing the wrong target name bypasses the check; this is the
   same class as a request that mislabels production. No command content is parsed.
2. An agent that edits this list is not stopped. The edit is visible only in git history, which is why
   every change to the list must be a reviewed commit.
