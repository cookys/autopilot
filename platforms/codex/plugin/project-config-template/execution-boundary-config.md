# Execution Boundary Config

Per-project configuration for the opt-in `exec-boundary` hook (`hooks/exec-boundary.js`) —
the non-LLM deny gate at the Bash execution boundary (four-layer Kernel rule K2,
`references/four-layer-design.md`). Copy to `.claude/execution-boundary-config.md` in the
consuming project. All keys optional; shipped defaults apply when absent.

Enable the hook: `~/.autopilot/config.json` → `{"hooks": {"exec-boundary": true}}` or
`AUTOPILOT_HOOK_EXEC_BOUNDARY=1`.

## Keys (`key: value` lines; parsed mechanically — keep the format exact)

protected_refs: main|master

sanctioned_roots: /var/tmp

allow_sql: false

## Semantics

- `protected_refs` — regex alternation of branch names whose force-push is denied (rule E1).
  Deliberately overlaps the default-on `branch-protection.js` hook: an opt-in and a
  default-on hook covering the same accident class is defense-in-depth, not a conflict.
- `sanctioned_roots` — comma-separated absolute path prefixes where recursive `rm` is
  permitted, IN ADDITION to the always-sanctioned cwd, `/tmp`, and `$TMPDIR` (rule E2).
- `allow_sql` — `true` disables the raw `DROP TABLE`/`TRUNCATE` denial (rule E3) for repos
  that legitimately run destructive SQL (e.g. DB tooling with test DSNs).
- Rule E4 (`sudo rm`) has no config override — turn the hook off deliberately if a session
  genuinely needs root deletion, then re-enable.

The gate makes no LLM calls and cannot be argued with — that is its entire value
(the survey's Replit lesson: "the freeze lived only in the instructions").
