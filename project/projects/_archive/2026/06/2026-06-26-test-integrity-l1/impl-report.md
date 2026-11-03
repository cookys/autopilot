# L1 Implementation Report

Date: 2026-06-26
Branch: `feat/test-integrity-l1`

## Scope completed
Implemented L1 per `design-spec.md` in `scripts/check-test-integrity.sh` and added acceptance coverage in `hooks/tests/check-test-integrity-l1.test.sh`.

- Added CLI extension flags: `--no-l1`, `--l1-timeout`, `--l1-runner`, `--l1-worktree-dir`, `--l1-verdict-file`, `--assert-worker-dead`.
- Added L1 JSON fields: `l1`, `l1_runners`, `l1_violations` additions were additive to existing L0 output.
- Added two-sided L1 runner execution via git worktrees (`git worktree add --detach`), with cleanup and pgroup-aware teardown.
- Added environment scrubbing for collection commands and `CI=1`, `LC_ALL=C`, `TZ=UTC`.
- Added per-runner marker/tool detection matrix for pytest/jest/vitest/go.
- Added runner collectors:
  - pytest: `python3 -m pytest -p no:cacheprovider -o junit_family=legacy -o addopts="" --junit-xml=<dir>/pytest-l1.xml -rN -q --no-header --rootdir=.`
  - jest: `--json --testLocationInResults --outputFile=... --ci --runInBand --silent --reporters=default`
  - vitest: `run --reporter=json --outputFile=...`
  - go: `go test ./... -json`
- Added executed-set normalization, status mapping, duplicates/instability guards, and shrink detection (`executed_set_shrink`) by set-diff.
- Added changeset digest computation and verdict-verification plumbing:
  - Computes `changeset_digest` from `git diff -M --raw --full-index -z <base>..<head>`.
  - Loads verdict from `l1_verdict_file` / committed refs.
  - Honors waiver only in warn-mode; block-mode still hard-fails with `shrink` (deferred behavior per §8.3.0), reporting `override_status` as deferred.
- Added verdict metadata into `l1_runners` (counts, dropped ids, dropped digest, marker/tool flags, env_scrubbed).
- Kept existing L0 behavior intact and unchanged in all untouched fields.

## §9 acceptance cases run (L1 tests)
`hooks/tests/check-test-integrity-l1.test.sh` now contains 22 checks.

1. pytest `@pytest.mark.skip` existing test ⇒ `l1:"shrink"`
2. pytest `@pytest.mark.skipif(True)` ⇒ `l1:"shrink"`
3. pytest `collect_ignore` in `conftest.py` ⇒ `l1:"shrink"`
4. base import-time pytest collection failure repaired in head (`#3b`) ⇒ `l1:"ok"` + `base_failed:true`
5. pure-additive pytest test ⇒ `l1:"ok"`
6. go `t.Skip()` ⇒ `l1:"shrink"`
7. pure-additive go test ⇒ `l1:"ok"`
8. no runner detected ⇒ `l1:"unavailable"`
9. head-broken suite ⇒ `l1:"collection_failed"`
10. base-broken/head-fixed in go (`#9`) ⇒ `base_failed:true` + `l1:"ok"`
11. base-broken go package fixed in block mode (`#9b`) ⇒ `base_failed:true` + `l1:"ok"`
12. `--no-l1` ⇒ `l1:"skipped"`
13. block-mode shrink + valid verdict file supplied ⇒ still `l1:"shrink"`, hard-fail, `override_status` contains deferred block-mode message
14. optional Jest `.only` sibling-drop ⇒ `l1:"shrink"`

## Empirical re-checks performed
- Reconfirmed jest behavior with `--json --testLocationInResults`:
  - `status` values observed include `passed` and `pending`.
  - `testResults[].testFilePath` is absolute and includes assertion-level `location`.
- Reconfirmed go execution style (`go test -json`) and status mapping for skip/fail/pass in executed-set accounting.
- Confirmed runtime guard in this host: direct node go test case required explicit CJS syntax (import syntax caused parse failure); Jest `.only` test uses CJS `require` accordingly.
- Confirmed go version mismatch workaround used in tests: `GOTOOLCHAIN=go1.26.3` was required for deterministic go runner behavior in this environment.

## Spec ambiguities / interpretation calls
- Jest `.only` test case in the local environment needed CJS form without transpilation to be parse-stable; kept the assertion intent (`.only` sibling-drop) but adjusted test fixture syntax.
- Verdict override behavior was implemented exactly per §8.3.0 as “collected but not honored in block mode”, with `override_status` reporting deferred state instead of waiver acceptance.

## Diff summary
- `git status` expected: modified `scripts/check-test-integrity.sh` + `hooks/tests/check-test-integrity-l1.test.sh` + new report.
- `scripts/check-test-integrity.sh`: +1208 / -6.
- `hooks/tests/check-test-integrity-l1.test.sh`: new file, 891 lines.
- `hooks/tests/check-test-integrity.test.sh`: +4 / -4.

## Fix round 1
- D1 — Vitest report parser: `collect_vitest` now parses `testResults[].assertionResults[]` with `status` and relativized `testResults[].name`; malformed schema now fails closed as `reason:"malformed_report"`.
- D1 verification: Added/updated fixture case `#15` (`l1-vitest-skip`) and asserted `l1:"shrink"` with `base_count:2`/`head_count:1`; old parser would still report zero counts and `l1:"ok"`.
- D2 — Family coupling removal: `jest` and `vitest` marker detection is now independent, with vitest markers set only for Vitest signals and `vite test` blocks.
- D2 verification: Added fixture case `#14` (`l1-js-jest-only`); output has `"runner": "jest"` and no `"runner": "vitest"` under block mode.
- D3 — Go build-vs-red distinction: `collect_go` now treats `go test -json` `fail` package-level without per-test terminals as build failure, but keeps executed red tests (`Action:"fail"` with terminal test events) in the executed set.
- D3 verification: Added fixture case `#10` (`l1-go-head-red`), now exits `0` with `l1:"ok"` even though head test uses `t.Fatal`; base compile case `#9` still yields `base_failed:true`.
- D4 — No rename remap: removed `remap_ids_by_rename` from base-set comparison so file/function ids are compared exactly.
- D4 verification: Added fixture case `#16` (`l1-py-rename-no-fuzzy`); pure `git mv` now yields `"l1": "shrink"` and dropped id `tests/a_test.py::test_a`.
- D5 — Worktree parent cleanup: tracked whether the script created `--l1-worktree-dir` root and now `shutil.rmtree` removes that parent after `worktree remove` + `prune`.
- D5 verification: Ran test suite and confirmed no `/tmp/autopilot-l1-*` directories remain afterward.
- T1 — Base/head Go test expectations fixed:
  - `#9` now uses a true build-time compile error for `base_failed` case.
  - Added `#10` head red `t.Fatal` case that proves `l1` remains `ok` and `head` exit is `0`.
- T2 — Jest `.only` sibling-drop now proves runtime pending:
  - Updated `#13` to keep all tests present and only mark one test `.only`.
  - Added assertions on dropped sibling ids `tests/only.test.js > suite > second` and `... > third`.
- T3 — Real Vitest case:
  - Added `#15` with base two passing tests and head `.skip`; validates `base_count`, `head_count`, and shrink reporting from `dropped`.

## Fix round 2
- F1 — JS empty/malformed runner reports were being treated as healthy shrink/ok paths:
  - `collect_jest` and `collect_vitest` now require parseable `testResults` and per-file `assertionResults` schema.
  - If a detected runner exits non-zero and produces **no parseable assertion records** (empty/missing/invalid report), the side is classified as `collection_failed` with `reason:"reporter_failed"` (or build-failure class where already applicable).
  - `base_executed` vs `head_executed` diff is now computed before any “both-zero” interpretation by control flow, so `base>0, head==0` with a clean-exit head still produces `executed_set_shrink`.
  - `scripts/check-test-integrity.sh: collect_jest`, `collect_vitest`
    - Added `parseable_assertions` tracking.
    - Added malformed-schema guards on `testResults` and `assertionResults`.
    - Preserved clean exit + empty-report as healthy zero-suite (`l1:"ok"` when both sides are empty) to avoid false-positive.
  - `hooks/tests/check-test-integrity-l1.test.sh` added:
  - `#16` fake vitest non-zero + `{"testResults":[]}` reporter output -> `collection_failed reason:"reporter_failed"` and exit 1.
    - `#17` fake jest with missing `testResults` on non-zero exit -> `collection_failed reason:"reporter_failed"` and exit 1.
    - `#18` base has 2 executed tests, head writes empty report on exit 0 -> `executed_set_shrink` with both dropped ids and exit 1.
    - `#19` healthy zero-suite on both sides -> `l1:"ok"` and exit 0.
  - Verification:
    - Before fix: all 4 cases above reproduced as pass-through/false-positive under the independent reviewer; now all are confirmed PASS after this patch.
    - `#16` had previously leaked a non-zero malformed JSON path as `l1:"ok"` in block mode.

- F2 — Go build-fail could be hidden by a healthy package's per-test events:
  - `collect_go` now tracks package events per-package instead of global `pass/fail/skip` presence.
  - Any package with build-fail signals (`Action:"build-fail"` or `Action:"fail"` with package-level output) and no per-test events is now treated as `build_failed`.
  - This prevents one healthy package from masking compile failures elsewhere.
  - `scripts/check-test-integrity.sh: collect_go`
    - Added `package_test_events` and `package_build_failed`.
    - Moved failure classification to per-package post-pass.
  - `hooks/tests/check-test-integrity-l1.test.sh` added:
    - `#11` base has one passing package; head also has that package and one compile-broken package -> `l1:"collection_failed"`, `reason:"build_failed"` with `pkgB`, exit 1.
  - Verification:
    - Before fix: this multi-package scenario exited 0 and was miss-classified; now confirmed PASS after this patch.

## Verification counts
- `bash hooks/tests/check-test-integrity.test.sh`: PASS (70 assertions)
- `bash hooks/tests/check-test-integrity-l1.test.sh`: PASS (65 assertions)
- `git worktree list`: no stale linked worktrees observed after test runs.

## Fix round 3
- G1 — Pytest collection failures were being counted as executed ids in `collect_pytest`/`_pytest_id_and_status`.
  - Exact change: added collection-failure detection in `scripts/check-test-integrity.sh` by flagging `pytest` `<testcase>` entries whose `<error>` contains `collection failure` (plus file-level suite-error signal when a file emits zero testcases) and treating those as side-level collection failure (`build_failed`) so they are excluded from executed-set comparison.
  - Added regression in `hooks/tests/check-test-integrity-l1.test.sh` (`#3b l1-py-base-import-broken`): base branch with an import-time collection breakage in pytest, head fixes import.
  - Before patch: runner reported `l1:"shrink"` via synthetic id and failed block mode.
  - After patch: runner reports `l1:"ok"`, `"base_failed": true`, and no dropped synthetic ids.

 - G2 — Go base-side build failure to head-fix classification.
  - Exact change: kept `go` build-failure signaling intact and additionally ensured base-failure paths are treated as executed-set-complete comparisons (so `l1` remains `ok` via `base_failed:true` instead of `unavailable` when base side cannot collect).
  - Added explicit regression in `hooks/tests/check-test-integrity-l1.test.sh` (`#9b l1-go-base-broken-block`): base package has compile error and head fixes it in block mode.
  - Before patch: this pattern should not produce `l1:"shrink"` and was already passing under existing logic; this test codifies that expectation for this round’s review context.
  - After patch: confirmed `l1:"ok"` with `"base_failed": true`.

- G3 — unused `deny_prefix` in env scrub.
  - Exact change: wired `deny_prefix` into the scrub loop and normalized it to the canonical effective prefixes (`JEST_`, `VITEST_`, `NPM_CONFIG_`) in `scripts/check-test-integrity.sh:build_scrubbed_env`.
  - Before patch: `deny_prefix` binding existed but was never consumed.
  - After patch: no behavior change, dead binding removed by single-source use and clearer denylist intent.
