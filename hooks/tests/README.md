# autopilot hook test suite

Three-layer test pyramid (see `docs/plans/2026-05-14-test-suite.md` for design rationale).

```
                       ┌──────────────────────────┐
                       │   L3 E2E / Dogfood       │  manual, real session
                       └──────────────────────────┘
                  ┌────────────────────────────────────┐
                  │   L2 integration (this directory)  │  *.test.sh per hook/script,
                  │   spawn process, assert side-effects│  fixtures in fixtures/
                  └────────────────────────────────────┘
            ┌─────────────────────────────────────────────────┐
            │   L1 unit tests (hooks/*.test.js)               │  pure helpers,
            │   node:test runner (Node 18+), no deps          │  no IO
            └─────────────────────────────────────────────────┘
```

## Running

```bash
# Everything (L1 + L2)
bash hooks/tests/run.sh

# Filter by substring (matches file paths)
bash hooks/tests/run.sh state-checkpoint
bash hooks/tests/run.sh sync-version

# L1 only
node --test hooks/*.test.js

# Single L2 file
bash hooks/tests/state-checkpoint-empty-stdin.test.sh
```

CI runs the same `bash hooks/tests/run.sh` (see `.github/workflows/test.yml`).

## Layout

```
hooks/tests/
├── lib.sh                 # assertions + sandboxed run_hook
├── run.sh                 # umbrella runner (L1 + L2)
├── fixtures/              # input files (JSONL transcripts, JSON payloads, …)
│   └── *.{json,jsonl,md}
├── <hook>-<scenario>.test.sh   # L2 integration tests
└── README.md              # this file
```

L1 unit tests live as siblings of the hook source: `hooks/state-checkpoint.test.js` next to `hooks/state-checkpoint.js`. The Node test runner picks them up via the glob in `run.sh`.

## Writing an L2 integration test

```bash
#!/usr/bin/env bash
# hooks/tests/state-checkpoint-empty-stdin.test.sh
. "$(dirname "$0")/lib.sh"

# `run_hook` runs the hook with HOME=sandbox + CLAUDE_PLUGIN_ROOT=repo,
# captures stdout/stderr/exit into __RUN_STDOUT / __RUN_STDERR / __RUN_EXIT.
run_hook state-checkpoint.js '{}'

assert_exit_code "$__RUN_EXIT" 0 "fail-open on empty stdin"
# Hook should write the diag file under the sandbox $HOOK_HOME (= TEST_TMP/home)
assert_file_exists "$HOOK_HOME/.autopilot/.state-checkpoint.log" "diag log written"

finalize_test
```

Each test file MUST call `finalize_test` at the end — it prints `PASS [name] N assertions` or `FAIL [name] …` and exits with the right code so the umbrella runner can aggregate.

## Writing an L1 unit test

```javascript
// hooks/state-checkpoint.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { truncateUtf8Safe } = require('./state-checkpoint-lib.js');

test('truncateUtf8Safe cuts at codepoint boundary', () => {
  const r = truncateUtf8Safe('你好世界', 5);  // 你=3 bytes, 好=3 more would overflow
  assert.equal(r.text, '你');
  assert.equal(r.truncated, true);
});
```

The hook source files (`hooks/<name>.js`) are kept as **thin process wrappers** that call into a sibling lib (`hooks/<name>-lib.js`). Unit tests target the lib; integration tests target the wrapper.

## Sandbox semantics

Each `*.test.sh` gets a fresh `TEST_TMP=$(mktemp -d)` and exports `HOME=$TEST_TMP/home` for any `run_hook` invocation. Hooks that write to `~/.autopilot/…` therefore write inside the sandbox and don't pollute the user's real state. `trap cleanup_test_tmp EXIT` removes the sandbox.

This is also why tests can run in any order without isolation flags.

## Conventions

- One scenario per file. Filename: `<hook-or-script>-<scenario>.test.sh` (e.g. `state-checkpoint-malformed-jsonl.test.sh`).
- Fixtures go in `fixtures/`; reference via `$TESTS_DIR/fixtures/<name>` (test files set `$TESTS_DIR`).
- Tests fail loudly: never silently `|| true` away an assertion failure.
- Tests must not require network, sudo, or modify `$PWD`.
- New hook → add at least one happy-path test + one fail-open assertion (`assert_exit_code "$__RUN_EXIT" 0`).
