# hooks/tests/lib.sh — assertions + per-test sandbox for *.test.sh scripts.
#
# Source this from each test file:
#   . "$(dirname "$0")/lib.sh"
#
# Provides:
#   - TEST_NAME, TEST_TMP (mktemp -d, auto-cleaned on exit)
#   - HOOKS_DIR, REPO_ROOT
#   - assert_eq, assert_neq, assert_contains, assert_not_contains
#   - assert_file_exists, assert_file_absent, assert_exit_code
#   - run_hook (capture stdout/stderr/exit into vars)
#   - fail (print + exit 1), finalize_test (call once at EOF: PASS/FAIL summary + exit)
#   - Per-test sandbox AUTOPILOT_HOME (overrides ~/.autopilot so tests don't
#     touch the user's real state). Hooks read os.homedir() → HOME, so we set
#     HOME to TEST_TMP for hook invocations via run_hook.

set -uo pipefail   # NOT -e — we want to handle assertion failures explicitly

# Fake-runner prompt + nonce-frame helpers (generic over AUTOPILOT-REVIEW /
# AUTOPILOT-AUTHOR). Lifted from hooks/tests/dispatch-review.test.sh so consumer
# suites do not duplicate the parser. Source with AUTOPILOT_TEST_LIB_HELPERS_ONLY=1
# from a --bin stub so this file does not create a nested TEST_TMP / EXIT trap.
read_fake_runner_prompt() {
  local prompt=""
  local i=1
  local arg next_index next_arg
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1))
      next_arg="${!next_index}"
      case "$next_arg" in
        ''|-*) : ;;
        *)
          if [ -f "$next_arg" ]; then
            prompt="$(cat "$next_arg")"
          else
            prompt="$next_arg"
          fi
          break
          ;;
      esac
    fi
    i=$((i + 1))
  done
  if [ -z "$prompt" ]; then
    prompt="$(cat)"
  fi
  printf '%s' "$prompt"
}

extract_autopilot_frame_markers() {
  local prefix="$1"
  local prompt="$2"
  local begin end
  if [ -z "$prompt" ]; then
    return 1
  fi
  begin="$(printf '%s\n' "$prompt" | sed -n "s/^\\(<<<${prefix}-[0-9a-f]\\{32\\}>>>\\)\$/\\1/p" | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  if [ -z "$begin" ] || [ -z "$end" ]; then
    return 1
  fi
  printf '%s\n%s\n' "$begin" "$end"
}

print_autopilot_frame_markers() {
  local prefix="$1"
  shift
  local prompt
  prompt="$(read_fake_runner_prompt "$@")"
  extract_autopilot_frame_markers "$prefix" "$prompt"
}

if [ "${AUTOPILOT_TEST_LIB_HELPERS_ONLY:-}" = 1 ]; then
  return 0 2>/dev/null || exit 0
fi


# Hermetic assert_eq: Node util.inspect under FORCE_COLOR wraps numbers in ANSI
# (e.g. expected '2' vs got '[33m2[39m'). Disable color for all hook tests.
export NO_COLOR=1
unset FORCE_COLOR 2>/dev/null || true

TEST_NAME="${TEST_NAME:-$(basename "${BASH_SOURCE[1]:-$0}" .test.sh)}"
TEST_TMP=$(mktemp -d -t "autopilot-test-${TEST_NAME}-XXXXXX")
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HOOKS_DIR/.." && pwd)"

# Each hook reads from os.homedir(). Redirecting HOME to the per-test sandbox
# isolates ~/.autopilot/* writes.
HOOK_HOME="$TEST_TMP/home"
mkdir -p "$HOOK_HOME"

# Some hooks also write to os.tmpdir() (accumulator.js, batch-format.js,
# suggest-compact.js, intent-capture.js SESSION_TOOL_COUNTER). Redirect TMPDIR
# alongside HOME so test runs don't leak `/tmp/claude-*` files into the host
# tmp namespace. The hook-spawning `run_hook` exports this for the child.
HOOK_TMPDIR="$TEST_TMP/tmp"
mkdir -p "$HOOK_TMPDIR"

# Export the redirect GLOBALLY, not just via run_hook: tests that invoke
# scripts/*.sh directly (dispatch-hetero.test.sh etc.) used to inherit the REAL
# /tmp, so every mktemp the script-under-test performed leaked into the host tmp
# namespace — 616 hetero-feat-*/hetero-t-* fixture logs accumulated and helped
# exhaust the /tmp per-user quota (2026-07-13 incident, BACKLOG (c)). TEST_TMP
# itself was created above with the REAL TMPDIR (it must be, to survive this
# export) and the EXIT trap cleans everything under it. A test that needs a
# different TMPDIR can still export its own after sourcing lib.sh.
export TMPDIR="$HOOK_TMPDIR"

# Same class of leak, one layer up (2026-08-22 incident). HOOK_HOME above exists
# precisely because "~/.autopilot/* writes must be isolated", but HOME is only
# handed to hook children — a test that invokes scripts/*.sh directly still lets
# the SCRIPT resolve its store from the real os.homedir(). That is how
# dispatch-hetero.sh's seat_strike_capture wrote 46 fixture strike rows into the
# operator's ~/.autopilot/engine-capability/strikes.jsonl across three separate
# suites (dispatch-hetero, and the dispatch-lineage family found only on a second
# sweep). Patching suites one at a time kept missing one, so isolate the stores
# GLOBALLY here — the same reasoning, and the same fix, that TMPDIR got above.
# A suite needing a different store can still export its own after sourcing lib.sh
# (several do, for case-specific fixtures).
#
# Note this is a floor, not a substitute for asserting: a store env var that is set
# but never checked is indistinguishable from one that is ignored. Suites that
# actually dispatch also assert the real store's size is unchanged.
HOOK_ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
HOOK_ENGINE_SCORECARD_DIR="$TEST_TMP/engine-scorecard"
mkdir -p "$HOOK_ENGINE_CAPABILITY_DIR" "$HOOK_ENGINE_SCORECARD_DIR"
export ENGINE_CAPABILITY_DIR="$HOOK_ENGINE_CAPABILITY_DIR"
export ENGINE_SCORECARD_DIR="$HOOK_ENGINE_SCORECARD_DIR"

write_mission_governance() {
  local target="$1"
  local mode="$2"
  node - "$REPO_ROOT/.claude/owner-kernel-governance.json" "$target" "$mode" <<'NODE'
const fs = require('fs');
const [source, target, mode] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
value.mission_convergence = {
  schema_version: 1,
  enforcement_mode: mode,
  max_campaigns: 8,
  max_wall_seconds: 7200,
  max_tool_calls: 1000,
  max_engine_attempts: 100,
  max_external_wait_seconds: 600,
  max_canonical_changed_files: 100,
  max_output_bytes: 1000000,
  max_deliverables: 8,
  max_parallel: 3,
  max_batches: 4,
  max_graph_depth: 4,
  max_gate_attempts: 16,
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE
}

# Promote an executable test double to the minimum agy CLI contract used by
# production dispatch: an exact version probe plus transparent delegation for
# every other invocation. Call this only after the fixture body is complete.
make_agy_stub_versioned() {
  local stub="$1"
  local implementation="${stub}.agy-implementation"
  mv "$stub" "$implementation"
  cat > "$stub" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '1.1.10\n'
  exit 0
fi
if [ "${1:-}" = "models" ]; then
  # Model inventory is part of the minimum contract: the built-in --model default is an agy
  # *alias*, so every --model-less dispatch resolves it here. A fixture that answers `models`
  # needs a different inventory sets AGY_STUB_MODELS (delegating to the implementation is NOT an
  # option: these stubs commit files and print fixture JSON for every argv shape).
  # Two columns on purpose — real `agy models` prints "<id><TAB><Display Name>", and an id-only
  # fixture is exactly what hid the whole-line alias-matching bug until 2026-09-02.
  if [ -n "${AGY_STUB_MODELS:-}" ]; then
    printf '%s\n' "$AGY_STUB_MODELS"
    exit 0
  fi
  printf 'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\n'
  printf 'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)\n'
  printf 'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n'
  exit 0
fi
exec "${0}.agy-implementation" "$@"
STUB
  chmod +x "$stub"
}

# Best-effort liveness sidecar: hold an exclusive flock on
# $TEST_TMP/.autopilot-live.lock for the lifetime of this test. This is what
# lets a standalone `*.test.sh` run survive hooks/tests/lib/suite-residue-reap.sh
# when it fires from a concurrently running suite in another shell — TEST_TMP
# carries no dispatch-worktree marker or lock of its own, so without this the
# reaper's lockless branch would `rm -rf` a live test's TEST_TMP out from under
# it. Entirely best-effort: any failure here (no flock, no free fd, etc.)
# leaves the test running exactly as before this lock was added.
#
# This `exec {fd}>>path` creates the lock FILE before the flock a few lines
# down acquires it — the reaper's age gate on this exact open->flock gap
# (AUTOPILOT_SUITE_REAP_MIN_AGE, hooks/tests/lib/suite-residue-reap.sh) is
# what makes this window safe rather than a race the reaper could win.
__TEST_LIVE_LOCK_PATH="$TEST_TMP/.autopilot-live.lock"
__TEST_LIVE_LOCK_FD=""
# NOTE: `exec {fd}>>path` with no command applies ALL its redirections
# (including a same-line `2>/dev/null`) PERMANENTLY to this shell — that
# would silently blackhole every later stderr in the test (assertion
# diagnostics, -x traces, everything). Wrapping the bare `exec` in a `{ ; }`
# group scopes the group's own `2>/dev/null` to the group only (restored
# after), while the fd the exec opens still escapes the group and persists,
# which is exactly the behavior wanted here.
if { exec {__TEST_LIVE_LOCK_FD}>>"$__TEST_LIVE_LOCK_PATH"; } 2>/dev/null; then
  if ! flock -n "$__TEST_LIVE_LOCK_FD" 2>/dev/null; then
    { exec {__TEST_LIVE_LOCK_FD}>&-; } 2>/dev/null || true
    __TEST_LIVE_LOCK_FD=""
  fi
else
  __TEST_LIVE_LOCK_FD=""
fi

cleanup_test_tmp() {
  if [ -n "$__TEST_LIVE_LOCK_FD" ]; then
    { exec {__TEST_LIVE_LOCK_FD}>&-; } 2>/dev/null || true
  fi
  rm -rf "$TEST_TMP"
}
trap cleanup_test_tmp EXIT

# Some legacy dispatch integration tests exercise behavior after the engine-admission
# precondition. Production now projects every disk scorecard pass as provisional, so
# those tests use a process-local Node preload to preserve their downstream coverage.
# This helper changes only the calling test's NODE_OPTIONS; production exposes no
# bypass flag, environment switch, or serializable authority format.
enable_legacy_scorecard_test_projection() {
  local preload="$TEST_TMP/legacy-scorecard-test-projection.cjs"
  cat > "$preload" <<'NODE'
'use strict';
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;

childProcess.spawnSync = function projectedSpawnSync(command, args, options) {
  const result = originalSpawnSync.call(this, command, args, options);
  if (!Array.isArray(args) || args.length < 2
      || path.basename(String(args[0])) !== 'engine-scorecard.js'
      || args[1] !== 'current' || result.status !== 0) {
    return result;
  }
  try {
    const rows = JSON.parse(String(result.stdout || ''));
    if (!Array.isArray(rows)) return result;
    const projected = rows.map((row) => (
      row && row.status === 'provisional' && row.observed_status === 'qualified'
        ? { ...row, status: 'qualified' }
        : row
    ));
    return { ...result, stdout: `${JSON.stringify(projected)}\n` };
  } catch {
    return result;
  }
};
NODE
  if [ -n "${NODE_OPTIONS:-}" ]; then
    export NODE_OPTIONS="$NODE_OPTIONS --require=$preload"
  else
    export NODE_OPTIONS="--require=$preload"
  fi
}

# Assertion bookkeeping for the run.sh summary.
__TEST_PASS_COUNT=0
__TEST_FAIL_MSGS=()

fail() {
  echo "FAIL [$TEST_NAME] $*" >&2
  __TEST_FAIL_MSGS+=("$*")
}

assert_eq() {
  # assert_eq <actual> <expected> <msg>
  if [ "$1" = "$2" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${3:-assert_eq}: expected '$2', got '$1'"
  fi
}

assert_neq() {
  if [ "$1" != "$2" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${3:-assert_neq}: expected != '$2', got '$1'"
  fi
}

assert_contains() {
  # assert_contains <haystack> <needle> <msg>
  case "$1" in
    *"$2"*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
    *)      fail "${3:-assert_contains}: '$2' not found in output" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) fail "${3:-assert_not_contains}: unexpected '$2' in output" ;;
    *)      __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  esac
}

assert_file_exists() {
  if [ -e "$1" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${2:-assert_file_exists}: $1 does not exist"
  fi
}

assert_file_absent() {
  if [ ! -e "$1" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${2:-assert_file_absent}: $1 exists but should not"
  fi
}

assert_exit_code() {
  # assert_exit_code <actual> <expected> <msg>
  if [ "$1" = "$2" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${3:-assert_exit_code}: expected exit $2, got $1"
  fi
}

# run_hook <hook-relative-path> [<stdin>]
# Captures into __RUN_STDOUT, __RUN_STDERR, __RUN_EXIT. Uses sandboxed HOME.
run_hook() {
  local hook="$1"
  local stdin_content="${2:-}"
  local stdout_file="$TEST_TMP/.stdout.$$"
  local stderr_file="$TEST_TMP/.stderr.$$"
  local cmd_exit

  case "$hook" in
    *.js)
      if [ -n "$stdin_content" ]; then
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          node "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" <<< "$stdin_content"
      else
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          node "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" </dev/null
      fi
      ;;
    *.sh)
      if [ -n "$stdin_content" ]; then
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          bash "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" <<< "$stdin_content"
      else
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          bash "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" </dev/null
      fi
      ;;
    *)
      fail "run_hook: unsupported hook extension: $hook"
      __RUN_STDOUT=""; __RUN_STDERR=""; __RUN_EXIT=255
      return
      ;;
  esac
  cmd_exit=$?
  __RUN_STDOUT=$(cat "$stdout_file")
  __RUN_STDERR=$(cat "$stderr_file")
  __RUN_EXIT=$cmd_exit
  rm -f "$stdout_file" "$stderr_file"
}

# setup_sync_version_sandbox <sandbox-dir>
# Materialises a self-contained mini-repo so sync-version.js can be invoked
# WITHOUT touching the live repo's manifest files. sync-version uses
# `path.resolve(__dirname, '..')` to find REPO_ROOT, so by copying the script
# into <sandbox-dir>/scripts/ and the tracked mirrors into the sandbox at the
# same relative paths, the script edits the sandbox copies.
#
# Echoes the sandbox script's full path. Caller can pass it to `node`.
#
# Files mirrored. sync-version's editPlan writes manifest versions and description
# fragments where it owns them; README.md = version badge only. README.md +
# hooks/README.md are still copied so round-trip / dry-run can assert byte-identity
# where appropriate — the hooks badge + hooks/README tier tables are owned by
# check-hook-inventory.js, NOT sync-version, so they must stay untouched:
#   - .claude-plugin/plugin.json   (canonical)
#   - plugin.json                  (root mirror)
#   - .claude-plugin/marketplace.json
#   - platforms/codex/plugin/.codex-plugin/plugin.json
#   - README.md                    (version badge; hooks badge NOT sync-version's)
#   - hooks/README.md              (untouched by sync-version; byte-identity guard)
setup_sync_version_sandbox() {
  local sandbox="$1"
  mkdir -p "$sandbox/.claude-plugin" "$sandbox/scripts" "$sandbox/hooks" "$sandbox/platforms/codex/plugin/.codex-plugin" "$sandbox/platforms/codex/.agents/plugins"
  cp "$REPO_ROOT/scripts/sync-version.js"        "$sandbox/scripts/sync-version.js"
  cp "$REPO_ROOT/.claude-plugin/plugin.json"     "$sandbox/.claude-plugin/plugin.json"
  cp "$REPO_ROOT/.claude-plugin/marketplace.json" "$sandbox/.claude-plugin/marketplace.json"
  cp "$REPO_ROOT/plugin.json"                    "$sandbox/plugin.json"
  cp "$REPO_ROOT/platforms/codex/plugin/.codex-plugin/plugin.json" "$sandbox/platforms/codex/plugin/.codex-plugin/plugin.json"
  cp "$REPO_ROOT/platforms/codex/.agents/plugins/marketplace.json" "$sandbox/platforms/codex/.agents/plugins/marketplace.json"
  cp "$REPO_ROOT/README.md"                      "$sandbox/README.md"
  cp "$REPO_ROOT/hooks/README.md"                "$sandbox/hooks/README.md"
  echo "$sandbox/scripts/sync-version.js"
}

# ---------------------------------------------------------------------------
# Timing helpers (load-sensitive test windows under --parallel contention)
# ---------------------------------------------------------------------------
# AUTOPILOT_TEST_TIMING_FACTOR: positive integer multiplier (default 1).
# factor=1 keeps serial timings byte-identical to the historical suite;
# raise under CPU load to widen upper-bound margins and poll timeouts.
_AUTOPILOT_TEST_TIMING_FACTOR_RAW="${AUTOPILOT_TEST_TIMING_FACTOR:-1}"
case "$_AUTOPILOT_TEST_TIMING_FACTOR_RAW" in
  ''|*[!0-9]*) AUTOPILOT_TEST_TIMING_FACTOR=1 ;;
  0)           AUTOPILOT_TEST_TIMING_FACTOR=1 ;;
  *)           AUTOPILOT_TEST_TIMING_FACTOR="$_AUTOPILOT_TEST_TIMING_FACTOR_RAW" ;;
esac
unset _AUTOPILOT_TEST_TIMING_FACTOR_RAW

# test_timing_scale <base_int>
# Echoes base_int * factor (integer arithmetic). Never smaller than base_int
# (floor is implicit in bash $(( )); overflow / zero-factor clamp to base).
test_timing_scale() {
  local base="${1:?test_timing_scale: base_int required}"
  local factor="${AUTOPILOT_TEST_TIMING_FACTOR:-1}"
  local scaled=$(( base * factor ))
  if [ "$scaled" -lt "$base" ]; then
    scaled=$base
  fi
  printf '%s\n' "$scaled"
}

# poll_until <timeout_secs> <shell-cmd...>
# Re-evaluate the command every ~0.1s until it exits 0 (return 0) or the
# (timing-factor-scaled) timeout elapses (return 1). Dependency-free (bash +
# sleep). Safe under `set -uo pipefail`: a failing command is expected while
# waiting and does not abort the helper.
poll_until() {
  local timeout_base="${1:?poll_until: timeout_secs required}"
  shift
  if [ "$#" -lt 1 ]; then
    echo "poll_until: command required" >&2
    return 1
  fi
  local timeout
  timeout="$(test_timing_scale "$timeout_base")"
  local start now
  start=$(date +%s)
  while true; do
    if "$@"; then
      return 0
    fi
    now=$(date +%s)
    if [ $(( now - start )) -ge "$timeout" ]; then
      return 1
    fi
    sleep 0.1
  done
}

# Hermetic D4 strict-roster fixture (provider-readiness-consumer + autopilot-cli).
# Roster names ONLY the six STRICT_L5_PROVIDER_POLICY tuples. Scorecard rows are
# written via the real engine-scorecard.js record CLI into TEST_TMP � never the
# host capability dir. Caller exports REVIEW_LOOP_CONFIG_OVERRIDE /
# ENGINE_SCORECARD_DIR; the helper only sets HERMETIC_REVIEW_LOOP_CFG and
# HERMETIC_SCORECARD_DIR.
write_d4_strict_roster_fixture() {
  HERMETIC_REVIEW_LOOP_CFG="$TEST_TMP/hermetic-review-loop-config.md"
  HERMETIC_SCORECARD_DIR="$TEST_TMP/hermetic-scorecard"
  mkdir -p "$HERMETIC_SCORECARD_DIR"
  cat > "$HERMETIC_REVIEW_LOOP_CFG" <<'CFG'
- reviewer_engine: MiniMax-M3
- reviewer_effort: high
- reviewer_runner: cc-shim
- reviewer_endpoint: minimax
- reviewer_limitation: minimax-false-central-claim-5-of-6
- reviewer_limitation_required: true
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- verification_author_present: true
- verification_author_engine: GLM-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: glm
- qc_panel: gpt-5.6-sol, GLM-5.2, MiniMax-M3
- qc_panel_runners: codex, cc-shim, cc-shim
- qc_panel_efforts: max, high, high
- qc_panel_endpoints: @none, glm, minimax
- qc_panel_aggregation: union-on-verified-critical
- min_panel_size: 3
- provider_readiness_receipt_ttl_seconds: 300
- provider_readiness_fallback_family_constraint: different
CFG
  _hermetic_scorecard_row() {
    local engine="$1" runner="$2" family="$3" role="$4"
    local rec="$HERMETIC_SCORECARD_DIR/rec-${role}-${engine}.json"
    cat > "$rec" <<JSON
{"engine":"${engine}","runner":"${runner}","family":"${family}","role":"${role}","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
    ENGINE_SCORECARD_DIR="$HERMETIC_SCORECARD_DIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$rec" >/dev/null
  }
  _hermetic_scorecard_row grok-4.5 grok xai implementer
  _hermetic_scorecard_row MiniMax-M3 cc-shim minimax reviewer
  _hermetic_scorecard_row GLM-5.2 cc-shim zhipu verification_author
}

# Call once at end of each *.test.sh file.
# Terminates the suite — it EXITS, it does not return. Anything appended after
# the finalize_test call never runs, and the suite still reports PASS, so a new
# case parked below it is invisible rather than failing. Insert new cases ABOVE
# the call, and confirm each one can actually go red before trusting it.
finalize_test() {
  if [ "${#__TEST_FAIL_MSGS[@]}" -eq 0 ]; then
    echo "PASS [$TEST_NAME] $__TEST_PASS_COUNT assertions"
    exit 0
  else
    echo "FAIL [$TEST_NAME] $__TEST_PASS_COUNT passed, ${#__TEST_FAIL_MSGS[@]} failed" >&2
    for msg in "${__TEST_FAIL_MSGS[@]}"; do echo "      - $msg" >&2; done
    exit 1
  fi
}
