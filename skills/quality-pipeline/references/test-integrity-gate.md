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

## L1 — Executed-Set Invariance (v2.25.7, additive)

L0 reads diff text only, so it misses gaming that is additions-only or happens outside test files. **L1 RUNS the test collector on base vs head and fails (`executed_set_shrink`) if the set of tests that *actually execute* shrinks** — catching `test.only`/`fit`, module `pytestmark=skip`, `collect_ignore`, runner-config exclusions (`testPathIgnorePatterns`), go build-tag drops, and fixture changes that skip tests. Per-runner: **pytest / jest / vitest / go**.

- **RUN-not-collect**: `--collect-only`/`--listTests`/`-list` still list *skipped* tests, so L1 uses execution/report status (pytest junit, jest/vitest `--json`, go `-json`), never collection listing.
- **Best-effort**: runs only when a runner is detected on both sides (`l1:"unavailable"` otherwise — L0 + reviewer backstop). Two-sided `git worktree` collection, env-scrubbed, pgroup-killed timeout, always-cleanup.
- **Fail-closed** on a broken head runner (`collection_failed` — go multi-package build-fail, JS empty/crashed report, timeout), never a silent pass (a candidate could break the runner to dodge L1).
- **No fuzzy rename matching** — a renamed test id is a drop (documented false-positive requiring a depth-0 override); this is the main false-positive cost, justifying the `warn` default.
- Flags: `--no-l1`, `--l1-timeout`, `--l1-runner`, `--l1-verdict-file`, `--assert-worker-dead <pgid>`. JSON adds `l1` + `l1_runners[]` (backward-compatible with L0).

Full per-runner contract (detection markers, normalized test-ids, status→executed mapping, failure-classification table, override design): [`docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md`](../../../docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md).

## Mode Semantics
- **`block`** — fails (exit 1) on any L0 violation/surface touch, or an L1 `executed_set_shrink`/`collection_failed`, unless waived. **Default for `/l5` hetero-impl dispatch (opt-in per project).**
- **`warn`** — reports but does not block (exit 0). **Global default** (shadow→calibrate→gate). Used when no config is present.
- **`off`** — gate disabled.

## Override verdicts (escape hatch — see limitation)
A verdict at the **committed** path `.qc/<head_sha>.verdict.json` (read via `git show`, NOT the filesystem — untracked forgery is rejected) may waive **specific** violations it enumerates:
```json
{ "tree": "<head^{tree} sha>", "waives": [ {"file": "tests/x_test.py", "kind": "deleted_line"} ] }
```
A violation is waived only if `tree == git rev-parse <head>^{tree}` AND its `{file,kind}` is listed. **Never waivable:** `protected_path_touch`, `malformed_config`, `git_error`.

> **Known limitation (L0 stub + L1 deferral):** the L0 committed-path override is a **fail-safe stub** (a committed verdict changes the commit SHA its filename must match — a fixed-point that makes a legit override unconstructable; it fails *closed*). L1 (v2.25.7) builds real out-of-commit verdict verification (changeset-digest + dropped-digest bound), **but HONORING it in `block` mode is DEFERRED** — in the same-user linked-worktree `/l5` dispatch model a worker can forge the override channel, and `--assert-worker-dead <pgid>` can't stop a `setsid`-escaped descendant. So a block-mode `executed_set_shrink` is a hard fail with **no honored override** until `dispatch-hetero.sh` gains descendant-containment (own-session + tree-sweep reap on all exit paths). Refusing a forgeable waiver is fail-safe; in `block` dispatched flows the depth-0 orchestrator controls the merge regardless. See design-spec §8.3.

## See Also

| Skill / script | Boundary |
|-------|----------|
| `check-disjointness.sh` | Sibling gate — certifies *files* (allowlist/denylist), not test behavior. |
| `quality-pipeline` (completeness-gate) | Anti-stub scan; this gate is about *not weakening existing tests*. |
| `quality-pipeline` (code-review) | Runs after the gates pass; catches semantic "green-but-meaningless" weakening that no deterministic gate can. |
