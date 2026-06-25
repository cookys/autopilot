# Test Integrity Gate (Anti-Gaming Enforcement)

**L0 static diff-based test-integrity checks. Runs post-commit to block developers/agents from gaming tests to go green.**

## What Gets Scanned

| Category | Description | Violation Kind |
|----------|-------------|----------------|
| **Deleted Test Lines** | For files matching test paths, the diff must contain no deleted (`-`) lines (prevents assertion weakening or deletion). | `deleted_line` |
| **Skip/Solo Markers** | Added (`+`) lines in test files must not introduce skip, xfail, pending, or solo/only markers. | `skip_marker` / `solo_marker` |
| **Rename Escapes** | Renaming a test file to a non-test path or name that no longer matches test path conventions is blocked. | `rename_escape` |
| **Integrity Surface Touch** | Touches to non-test integrity surface files (e.g. config, conftest, fixtures, snapshots, workflows) are flagged. | `surface_touch` |

## Execution

```bash
# Invocation (requires a range and repo path)
scripts/check-test-integrity.sh validate --range <base>..<head> [--repo <dir>]
```

**What the script does:**
1. Resolves the configuration via `$TEST_INTEGRITY_CONFIG_OVERRIDE` or `.claude/test-integrity-config.md`.
2. Resolves git diffs between `<base>` and `<head>`.
3. Verifies if `.qc/<head-sha>.verdict.json` has a valid tree-digest matching the head commit's tree (to allow authorized overrides).
4. Performs static regex-based and path-based L0 checks.
5. Exit codes: `0` clean/warn-mode, `1` block-violation, `2` usage error.

## Mode Semantics
- **`block`**: Fails on any L0 violation or surface touch (exit 1) unless covered by a valid verdict override. Malformed configuration automatically triggers this fail-closed mode.
- **`warn`**: Reports violations but does not block (exit 0). Used by default when no configuration file is present.
- **`off`**: Bypasses the gate entirely (still reports changes, exits 0).

## Override verdicts (Escape Hatch)
To authorize a change that triggers an L0 violation, a verdict file must be placed at `.qc/<head-sha>.verdict.json` carrying the expected tree digest.
```json
{
  "tree": "<expected-head-tree-sha>"
}
```
If the tree digest matches `git rev-parse <head>^{tree}`, the override is accepted.

## Protected Paths
The following paths are protected from unauthorized modification by the gate itself (to prevent a task from editing the rules/checks):
- `.qc/**` (verdict directory)
- `scripts/check-test-integrity.sh` (this script)
- `.claude/test-integrity-config.md` (project configuration)

## See Also

| Skill | Boundary |
|-------|----------|
| `quality-pipeline` (completeness-gate) | Anti-stub scan (runs on staging/range) |
| `quality-pipeline` (code-review) | Runs after test integrity and completeness gates pass |
| `dev-flow` | Orchestrates development flow and triggers quality gates |
