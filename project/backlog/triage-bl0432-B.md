# Triage BL-0432 group B

Suites: `hooks/tests/decide-undo.test.sh`, `hooks/tests/decision-claim.test.sh`, `hooks/tests/dev-setup.test.sh`.

## Reproduce

Under the harness verify command with a PATH that prefers a TypeScript-capable Node (type stripping on), all three were already green at HEAD and at `HEAD~1`.

They go red when PATH prefers a Node **without** type stripping and without a sibling `npm` (typical: system `/usr/bin/node` ahead of a user install that has both `node` and `npm`):

| Suite | Failing assertion (verbatim) |
| --- | --- |
| decide-undo | `(a)(b)(c)(d)(e) the real pane code, both surfaces: every expectation holds: expected '0', got '15'` |
| decision-claim | `(b) the pane reply starts with the head line: expected '[待決回覆]', got ''` (+ 6 more (b) cases) |
| dev-setup | `OpenCode installer explains pinned nightly mismatch: 'version mismatch' not found in output` |

`got '15'` is the line count of Node's `ERR_UNKNOWN_FILE_EXTENSION` stack on stderr, merged into stdout by `driver(){ … 2>&1; }` and counted by `bad_count`.

## Bisect

Candidate good: `9a0d2e409` (last merge on or before 2026-11-08 20:00 +0800). Bad end: `HEAD~1` (`77c3497ad`; parent of the local-only shim).

Under the reproducing PATH, **all three are red at the good candidate and at `HEAD~1`**. Bisect therefore finds no product first-bad commit between those ends. The assumption has been present since each suite started depending on type stripping / sibling npm.

Under a TypeScript-capable Node first on PATH, both ends are green (not caused by the local shim `f51e9461e`).

## Cause

Wrong side: **test** (environment assumption), not product.

- decide-undo / decision-claim load real `mods/live/*.ts` via Node native type stripping. A non-TS Node first on PATH crashes the driver; decide-undo mis-counts the crash as 15 failed expectations; decision-claim's pane round-trip returns empty output.
- dev-setup's OpenCode mismatch case set `NODE_BIN_DIR="$(dirname "$(command -v node)")"`. When that dir has no `npm`, `install-opencode.sh` exits on `npm not found` before printing `version mismatch`.

## Fix

Test hermeticity in `hooks/tests/lib.sh`:

- `pick_ts_node` / `prefer_ts_node` — walk PATH for a Node with `process.features.typescript` in `{strip,transform}`, put it first via a `TEST_TMP` bin dir.
- `pick_node_npm_dir` — walk PATH for an entry that holds both `node` and `npm`.

Wired into the three suites. No product code changed. Assertions unchanged.

## Table

| suite | failing tests | first bad commit (short sha + subject) | cause | wrong side | fix commit or "needs decision" | green after fix |
| --- | --- | --- | --- | --- | --- | --- |
| hooks/tests/decide-undo.test.sh | `(a)(b)(c)(d)(e) the real pane code, both surfaces` (expected 0, got 15) | none in good..HEAD~1 (red at both under repro PATH); assumption since `fe6ef52f8` paneundo | non-TS Node first on PATH → driver crash counted as failures | test | uncommitted: `prefer_ts_node` in suite + helpers in `hooks/tests/lib.sh` | yes |
| hooks/tests/decision-claim.test.sh | (b) pane head / parseDecideLine / same_id / says / hook close / free-text close / unverified (7) | none in good..HEAD~1 (red at both under repro PATH); `.ts` pane path since `2ead0e4d7` paneundo claim | same non-TS Node → empty pane driver output | test | uncommitted: `prefer_ts_node` in suite + helpers in `hooks/tests/lib.sh` | yes |
| hooks/tests/dev-setup.test.sh | OpenCode installer explains pinned nightly mismatch | none in good..HEAD~1 (red at both under repro PATH); `NODE_BIN_DIR` pattern since sibling-npm assumption | `dirname $(command -v node)` lacks `npm` → preflight exits before mismatch text | test | uncommitted: `pick_node_npm_dir` for that case + helper in `hooks/tests/lib.sh` | yes |

## Verify (exit codes)

Harness command, ambient PATH (one suite at a time):

- `decide-undo.test.sh` → rc=0
- `decision-claim.test.sh` → rc=0
- `dev-setup.test.sh` → rc=0

Reproducing PATH (system Node first, TS-capable Node still later on PATH):

- `decide-undo.test.sh` → rc=0
- `decision-claim.test.sh` → rc=0
- `dev-setup.test.sh` → rc=0

## Changed files

- `hooks/tests/lib.sh` — add `pick_ts_node`, `prefer_ts_node`, `pick_node_npm_dir`
- `hooks/tests/decide-undo.test.sh` — call `prefer_ts_node` before the `.ts` driver
- `hooks/tests/decision-claim.test.sh` — call `prefer_ts_node` before the pane `.ts` driver
- `hooks/tests/dev-setup.test.sh` — use `pick_node_npm_dir` for the OpenCode mismatch PATH
- `project/backlog/triage-bl0432-B.md` — this report

## Deferred / out of scope

- No product changes to `mods/live/*`, `install-opencode.sh`, or Node version policy docs.
- No commit/push/PR (harness directive).
- Did not change other BL-0432 groups (A/C/…).
- Did not make suites pass when **no** TS-capable Node exists anywhere on PATH (they fail clearly via `prefer_ts_node` / `pick_node_npm_dir`).
- Did not edit `BACKLOG.md`.
