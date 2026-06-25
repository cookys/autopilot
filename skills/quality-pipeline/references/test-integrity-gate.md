# Test Integrity Gate (Anti-Gaming Enforcement)

**L0 static, git-artifact-based test-integrity checks. Runs post-commit to block a developer/agent from gaming tests to go green** — by deleting assertions, skipping/soloing tests, escaping the test dir, or weakening the integrity surface. Reads git artifacts only; never trusts agent self-report. Sibling of `check-disjointness.sh` (files) — this one certifies *test integrity*.

## What Gets Scanned

| Category | Description | Violation Kind |
|----------|-------------|----------------|
| **Deleted test lines** | In a test-path file, the diff must contain no deleted (`-`) lines — weakening an existing assertion (`assertEqual→assertTrue`) necessarily produces one. | `deleted_line` |
| **Skip/solo markers** | Added (`+`) lines in test files must not introduce skip / xfail / pending / todo or solo/only/focused markers (per-language set: `xit`/`.only`/`fit`/`fdescribe`/`@pytest.mark.skip`/`t.Skipf`/`#[ignore]`/…). | `skip_marker` / `solo_marker` |
| **Rename escapes** | A test file renamed to a non-test path / non-matching name (removes coverage) is blocked. Pure rename that stays in a test path is OK. | `rename_escape` |
| **Integrity-surface touch** | Edits to non-test integrity-surface files (conftest, fixtures, mocks, snapshots/goldens, runner config, setupTests/matchers, `package.json` scripts, CI workflows) are flagged — **independently of whether the path is also a test path**. In `block` mode a surface touch is itself a violation unless waived. | `surface_touch` |
| **Protected-path touch** | The candidate diff touching `.qc/**`, the gate script, the config, or `.gitattributes` is a **non-waivable** structural violation. | `protected_path_touch` |
| **Config / git failure** | Malformed (present-but-unparseable) config fails closed to `block`; an invalid range/ref or git failure exits 2. Both **non-waivable**. | `malformed_config` / `git_error` |

## Execution

```bash
scripts/check-test-integrity.sh validate --range <base>..<head> [--repo <dir>] [--base <ref>] [--allow-env-config]
```

1. **Config from the TRUSTED base ref** (`git show <base>:.claude/test-integrity-config.md`), NOT the candidate head — so a candidate cannot weaken the gate (`mode: off`, bogus `test_paths`) in the same diff. Falls back to `project-config-template/test-integrity-config.md` then built-in defaults. `$TEST_INTEGRITY_CONFIG_OVERRIDE` is ignored unless `--allow-env-config`.
2. Reads `git diff -M --name-status -z` (authoritative paths, whitespace/rename safe) + hunks.
3. Runs the L0 checks above.
4. Exit: `0` clean (or warn/off) · `1` block-violation · `2` usage/internal error (non-overridable).

## Mode Semantics
- **`block`** — fails (exit 1) on any L0 violation/surface touch unless waived. **Default for `/l5` hetero-impl dispatch (opt-in per project).**
- **`warn`** — reports but does not block (exit 0). **Global default** (shadow→calibrate→gate). Used when no config is present.
- **`off`** — gate disabled.

## Override verdicts (escape hatch — see limitation)
A verdict at the **committed** path `.qc/<head_sha>.verdict.json` (read via `git show`, NOT the filesystem — untracked forgery is rejected) may waive **specific** violations it enumerates:
```json
{ "tree": "<head^{tree} sha>", "waives": [ {"file": "tests/x_test.py", "kind": "deleted_line"} ] }
```
A violation is waived only if `tree == git rev-parse <head>^{tree}` AND its `{file,kind}` is listed. **Never waivable:** `protected_path_touch`, `malformed_config`, `git_error`.

> **Known limitation (P1a):** the override is a **fail-safe stub**. Because a committed verdict changes the commit SHA that its filename must match, a legitimate override cannot currently be constructed (fixed-point). It fails *closed* (cannot be forged, cannot accidentally waive). Full depth-0 override provenance (out-of-commit verdict ref + digest binding) is deferred to the **L1 project**. In `block` dispatched flows the depth-0 orchestrator controls the merge regardless.

## See Also

| Skill / script | Boundary |
|-------|----------|
| `check-disjointness.sh` | Sibling gate — certifies *files* (allowlist/denylist), not test behavior. |
| `quality-pipeline` (completeness-gate) | Anti-stub scan; this gate is about *not weakening existing tests*. |
| `quality-pipeline` (code-review) | Runs after the gates pass; catches semantic "green-but-meaningless" weakening that no deterministic gate can. |
