#!/usr/bin/env bash
# hooks/tests/run.sh — umbrella runner for autopilot's hook test suite.
#
# Discovers and runs:
#   - L1 unit tests: `node --test` on hooks/*.test.js + scripts/*.test.js
#   - L2 integration tests: every hooks/tests/*.test.sh + scripts/*.test.sh file
#
# Exit 0 only if every layer passes. Per-file pass/fail summary at the end.
#
# Usage:
#   bash hooks/tests/run.sh                    # run everything (serial L2)
#   bash hooks/tests/run.sh state-checkpoint   # filter (substring match on file)
#   bash hooks/tests/run.sh --parallel [N]     # parallel L2 (N workers; default nproc)
#   bash hooks/tests/run.sh --parallel 8 filter

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$TESTS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$HOOKS_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Argument parsing ──
# Support, in any order: optional --parallel [N], optional substring FILTER.
# Serial (no --parallel) is the default and must stay byte-identical to pre-flag.
PARALLEL=0
PARALLEL_N=""
FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --parallel)
      PARALLEL=1
      shift
      # Optional positive integer N immediately after --parallel
      if [ $# -gt 0 ] && [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
        PARALLEL_N="$1"
        shift
      fi
      ;;
    --parallel=*)
      PARALLEL=1
      PARALLEL_N="${1#--parallel=}"
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: bash hooks/tests/run.sh [--parallel [N]] [filter]" >&2
      exit 2
      ;;
    *)
      if [ -n "$FILTER" ]; then
        echo "Unexpected argument: $1 (filter already set to '$FILTER')" >&2
        exit 2
      fi
      FILTER="$1"
      shift
      ;;
  esac
done

# Resolve parallel worker count when requested.
if [ "$PARALLEL" -eq 1 ]; then
  if [ -n "$PARALLEL_N" ] && [[ "$PARALLEL_N" =~ ^[1-9][0-9]*$ ]]; then
    : # use explicit N
  else
    # Invalid or missing N → default from nproc; fall back to 4 if unavailable.
    if command -v nproc >/dev/null 2>&1; then
      PARALLEL_N="$(nproc)"
    else
      PARALLEL_N=4
    fi
    if ! [[ "$PARALLEL_N" =~ ^[1-9][0-9]*$ ]]; then
      PARALLEL_N=4
    fi
  fi
  # Widen load-sensitive timing windows in PROPORTION to the worker count. N concurrent
  # workers — each spawning several subprocesses (git, stubs, dispatch subshells) — oversubscribe
  # the cores and inflate every test's wall-clock by up to ~N× under scheduler contention (measured:
  # a ~1s genuine-empty dispatch took ~30s at N=32). test_timing_scale is applied ONLY to upper
  # bounds (assert_le), never to minimums, so scaling it up cannot make a "waits >= Ns" check pass
  # spuriously. Serial runs keep factor 1 — the strict gate that catches real timing regressions;
  # only the parallel convenience path gets headroom. A user-set factor still wins.
  if [ -z "${AUTOPILOT_TEST_TIMING_FACTOR+x}" ]; then
    export AUTOPILOT_TEST_TIMING_FACTOR="$PARALLEL_N"
  fi
fi

TOTAL=0
FAILED=0
declare -a FAILED_TESTS=()

run_one() {
  local file="$1"
  local rel="${file#$REPO_ROOT/}"
  TOTAL=$((TOTAL + 1))
  if [ -n "$FILTER" ] && [[ "$rel" != *"$FILTER"* ]]; then
    TOTAL=$((TOTAL - 1))
    return
  fi
  echo ""
  echo "──────── $rel ────────"
  if bash "$file"; then
    : # PASS line printed by finalize_test
  else
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("$rel")
  fi
}

# ── L1 unit tests via node --test ──
# Node's test runner reports its own pass/fail.
echo "════════ L1 unit tests (node --test) ════════"
# scripts/*.test.js rides the same node --test pass — scripts-side unit tests
# used to live outside every scan glob and never ran in CI (found 2026-07-16).
shopt -s nullglob
UNIT_FILES=("$HOOKS_DIR"/*.test.js "$REPO_ROOT"/scripts/*.test.js)
shopt -u nullglob
if [ "${#UNIT_FILES[@]}" -eq 0 ]; then
  echo "(no L1 unit tests yet)"
else
  if [ -n "$FILTER" ]; then
    # Filter unit files too
    FILTERED=()
    for f in "${UNIT_FILES[@]}"; do
      case "$f" in *"$FILTER"*) FILTERED+=("$f");; esac
    done
    UNIT_FILES=("${FILTERED[@]}")
  fi
  if [ "${#UNIT_FILES[@]}" -gt 0 ]; then
    TOTAL=$((TOTAL + ${#UNIT_FILES[@]}))
    if ! node --test "${UNIT_FILES[@]}"; then
      FAILED=$((FAILED + 1))
      FAILED_TESTS+=("L1 unit suite")
    fi
  else
    # Filter matched nothing — neutral
    :
  fi
fi

# ── L2 integration tests ──
echo ""
echo "════════ L2 integration tests (*.test.sh) ════════"
shopt -s nullglob
NON_EXEC=()
for file in "$TESTS_DIR"/*.test.sh; do
  if [ ! -x "$file" ]; then
    NON_EXEC+=("${file#$REPO_ROOT/}")
  fi
done
if [ "${#NON_EXEC[@]}" -gt 0 ]; then
  echo "ERROR: shell test files must be executable:" >&2
  for rel in "${NON_EXEC[@]}"; do
    echo "   - $rel" >&2
  done
  shopt -u nullglob
  exit 1
fi

if [ "$PARALLEL" -eq 0 ]; then
  # ── Serial path (default; byte-identical to pre--parallel) ──
  for file in "$TESTS_DIR"/*.test.sh; do
    run_one "$file"
  done
  # scripts/*.test.sh — same never-scanned gap as the L1 note above.
  for file in "$REPO_ROOT"/scripts/*.test.sh; do
    run_one "$file"
  done
  shopt -u nullglob
else
  # ── Parallel path: fan L2 files across N workers ──
  # Collect candidate files (same set as serial), apply FILTER, count TOTAL.
  #
  # A small serial tail is load-bearing. These tests either inspect the canonical
  # tree while other tests may have short-lived in-repo fixtures (sync-all), or
  # exercise detached ledger ownership/process handoff under real timing. Mixing
  # them into the general worker pool produced reproducible false failures on the
  # constrained GitHub runner even though each group, including a 32-worker
  # dispatch-only stress run, passed independently.
  declare -a L2_FILES=()
  declare -a SERIAL_L2_FILES=()
  for file in "$TESTS_DIR"/*.test.sh "$REPO_ROOT"/scripts/*.test.sh; do
    [ -f "$file" ] || continue
    rel="${file#$REPO_ROOT/}"
    if [ -n "$FILTER" ] && [[ "$rel" != *"$FILTER"* ]]; then
      continue
    fi
    case "$(basename "$file")" in
      dispatch-detach.test.sh|dispatch-hetero.test.sh|dispatch-lineage.test.sh|dispatch-pi.test.sh|sync-all.test.sh)
        SERIAL_L2_FILES+=("$file")
        ;;
      *)
        L2_FILES+=("$file")
        ;;
    esac
  done
  shopt -u nullglob

  TOTAL=$((TOTAL + ${#L2_FILES[@]} + ${#SERIAL_L2_FILES[@]}))

  n_files="${#L2_FILES[@]}"
  if [ "$n_files" -eq 0 ]; then
    : # nothing to run
  else
    # Cap workers to file count (no point spawning idle slots).
    N="$PARALLEL_N"
    if [ "$N" -gt "$n_files" ]; then
      N="$n_files"
    fi

    # Temp dir for per-file stdout/stderr buffers + exit codes + done markers.
    PARALLEL_TMP="$(mktemp -d "${TMPDIR:-/tmp}/hooks-run-parallel.XXXXXX")"
    # shellcheck disable=SC2064
    trap 'rm -rf "$PARALLEL_TMP"' EXIT

    start_one() {
      local file="$1"
      local i="$2"
      local out="$PARALLEL_TMP/$i.out"
      local ecf="$PARALLEL_TMP/$i.ec"
      local donef="$PARALLEL_TMP/$i.done"
      (
        bash "$file" >"$out" 2>&1
        echo $? >"$ecf"
        # Done marker last so readers only see complete buffers.
        touch "$donef"
      ) &
    }

    print_result() {
      local i="$1"
      local file="${L2_FILES[$i]}"
      local rel="${file#$REPO_ROOT/}"
      local out="$PARALLEL_TMP/$i.out"
      local ecf="$PARALLEL_TMP/$i.ec"
      local ec=1
      if [ -f "$ecf" ]; then
        ec="$(cat "$ecf")"
        # Non-numeric guard
        if ! [[ "$ec" =~ ^[0-9]+$ ]]; then
          ec=1
        fi
      fi
      # Atomic block: header + full file output (never interleaved).
      echo ""
      echo "──────── $rel ────────"
      if [ -f "$out" ]; then
        cat "$out"
      fi
      if [ "$ec" -ne 0 ]; then
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$rel")
      fi
    }

    started=0
    finished=0
    active=0

    while [ "$finished" -lt "$n_files" ]; do
      # Fill the worker pool.
      while [ "$active" -lt "$N" ] && [ "$started" -lt "$n_files" ]; do
        start_one "${L2_FILES[$started]}" "$started"
        started=$((started + 1))
        active=$((active + 1))
      done

      # Print one completed file's block (completion order).
      found=0
      i=0
      while [ "$i" -lt "$started" ]; do
        if [ -f "$PARALLEL_TMP/$i.done" ] && [ ! -f "$PARALLEL_TMP/$i.printed" ]; then
          # Mark printed first to avoid double-print under any retry.
          touch "$PARALLEL_TMP/$i.printed"
          print_result "$i"
          finished=$((finished + 1))
          active=$((active - 1))
          found=1
          break
        fi
        i=$((i + 1))
      done

      if [ "$found" -eq 0 ]; then
        # Block until some child exits so we don't busy-spin.
        if [ "$active" -gt 0 ]; then
          wait -n 2>/dev/null || {
            # bash without wait -n: wait for any single known child via short poll.
            sleep 0.05
          }
        else
          # No active workers but not finished — should not happen; avoid hang.
          break
        fi
      fi
    done

    # Reap any remaining children (should already be done).
    wait 2>/dev/null || true

    rm -rf "$PARALLEL_TMP"
    trap - EXIT
  fi

  # Run global-state/timing-sensitive tests only after the parallel pool is fully
  # reaped, preserving their normal assertions without weakening timeouts.
  for file in "${SERIAL_L2_FILES[@]}"; do
    rel="${file#$REPO_ROOT/}"
    echo ""
    echo "──────── $rel (serial tail) ────────"
    if AUTOPILOT_TEST_TIMING_FACTOR=1 bash "$file"; then
      :
    else
      FAILED=$((FAILED + 1))
      FAILED_TESTS+=("$rel")
    fi
  done
fi

# ── Summary ──
echo ""
echo "════════ Summary ════════"
if [ "$FAILED" -eq 0 ]; then
  echo "✅ ALL TESTS PASSED ($TOTAL test files)"
  exit 0
else
  echo "❌ $FAILED / $TOTAL test files FAILED:"
  for t in "${FAILED_TESTS[@]}"; do echo "   - $t"; done
  exit 1
fi
