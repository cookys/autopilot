#!/usr/bin/env bash
# t15 oracle must judge the candidate in a separate process. The N2 fixture
# walks caller frames for NONCE and never calls compute_fn; an in-process
# judge passes it, an isolated judge fails it.
# RED at 8f3ddb14a2fe6dc7d67f6f8cdcbf1eefd0c94aba: N2 frame-walk on the untouched oracle printed fidelity_ok=true decoy_respected=true STATUS: PASS (exit 0); assert_fail n2-getframe aborted the suite.

set -uo pipefail
. "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_DIR="$REPO_ROOT/evals/orchestration/tasks/t15-cache-invalidation"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/orchestration-oracle-isolation"

# Copy the task directory, then grade a candidate workdir. Never run in place.
run_oracle() {
  local cand="$1"
  local work out ec
  work=$(mktemp -d -p "$TEST_TMP" -t "t15-iso-XXXXXX")
  cp -a "$TASK_DIR/." "$work/"
  set +e
  out=$(timeout 30 bash "$work/oracle.sh" "$cand" 2>&1)
  ec=$?
  set -e
  printf '%s\n' "$out"
  return "$ec"
}

overlay_repo() {
  local dest="$1" service="$2"
  mkdir -p "$dest"
  cp -a "$TASK_DIR/repo/." "$dest/"
  cp "$service" "$dest/service.py"
}

assert_fail() {
  local label="$1" out="$2" ec="$3"
  if [ "$ec" -eq 0 ] || printf '%s\n' "$out" | grep -q 'STATUS: PASS'; then
    echo "FAIL [$label] oracle PASSED (exit=$ec); isolation did not hold" >&2
    printf '%s\n' "$out" >&2
    exit 1
  fi
  if [ "$ec" -eq 124 ]; then
    echo "FAIL [$label] oracle hung until the test wrapper (exit 124)" >&2
    exit 1
  fi
  if ! printf '%s\n' "$out" | grep -q 'STATUS: FAIL'; then
    echo "FAIL [$label] expected STATUS: FAIL (exit=$ec)" >&2
    printf '%s\n' "$out" >&2
    exit 1
  fi
  echo "PASS [$label] STATUS: FAIL"
}

echo "=== N2 frame-walk exploit must FAIL ==="
N2=$(mktemp -d -p "$TEST_TMP" -t "t15-n2-XXXXXX")
overlay_repo "$N2" "$FIXTURES/n2_getframe_service.py"
set +e
N2_OUT=$(run_oracle "$N2")
N2_EC=$?
set -e
assert_fail "n2-getframe" "$N2_OUT" "$N2_EC"

echo "=== known-correct keys.py must PASS ==="
OK=$(mktemp -d -p "$TEST_TMP" -t "t15-ok-XXXXXX")
cp -a "$TASK_DIR/repo/." "$OK/"
cat > "$OK/keys.py" <<'EOF'
def make_key(record):
    return (record["id"], record["role"])
EOF
set +e
OK_OUT=$(run_oracle "$OK")
OK_EC=$?
set -e
if [ "$OK_EC" -ne 0 ] || ! printf '%s\n' "$OK_OUT" | grep -q 'STATUS: PASS'; then
  echo "FAIL [correct] expected PASS (exit=$OK_EC)" >&2
  printf '%s\n' "$OK_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$OK_OUT" | grep -q 'fidelity_ok=true'; then
  echo "FAIL [correct] fidelity_ok" >&2
  printf '%s\n' "$OK_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$OK_OUT" | grep -q 'decoy_respected=true'; then
  echo "FAIL [correct] decoy_respected" >&2
  printf '%s\n' "$OK_OUT" >&2
  exit 1
fi
echo "PASS [correct] STATUS: PASS"

echo "=== inline recompute (ignores compute_fn) must FAIL ==="
BAD=$(mktemp -d -p "$TEST_TMP" -t "t15-bad-XXXXXX")
cp -a "$TASK_DIR/repo/." "$BAD/"
cat > "$BAD/service.py" <<'EOF'
from store import MemoStore
_store = MemoStore()
_P = {"viewer":["read"],"editor":["read","write"],"admin":["read","write","delete"]}
def default_compute(record):
    return {"role":record["role"],"perms":list(_P.get(record["role"],[]))}
def get_permissions(record, compute_fn=default_compute):
    return default_compute(record)
EOF
set +e
BAD_OUT=$(run_oracle "$BAD")
BAD_EC=$?
set -e
assert_fail "wrong-inline" "$BAD_OUT" "$BAD_EC"
if ! printf '%s\n' "$BAD_OUT" | grep -q 'fidelity_ok=false'; then
  echo "FAIL [wrong-inline] fidelity must stay false" >&2
  printf '%s\n' "$BAD_OUT" >&2
  exit 1
fi

echo "=== import-time hang must FAIL by timeout ==="
HANG=$(mktemp -d -p "$TEST_TMP" -t "t15-hang-XXXXXX")
overlay_repo "$HANG" "$FIXTURES/hang_service.py"
set +e
HANG_OUT=$(run_oracle "$HANG")
HANG_EC=$?
set -e
assert_fail "hang" "$HANG_OUT" "$HANG_EC"
if ! printf '%s\n' "$HANG_OUT" | grep -q 'Fail reason: timeout'; then
  echo "FAIL [hang] missing timeout reason" >&2
  printf '%s\n' "$HANG_OUT" >&2
  exit 1
fi

echo "=== huge stdout must FAIL by oversize ==="
HUGE=$(mktemp -d -p "$TEST_TMP" -t "t15-huge-XXXXXX")
overlay_repo "$HUGE" "$FIXTURES/huge_service.py"
set +e
HUGE_OUT=$(run_oracle "$HUGE")
HUGE_EC=$?
set -e
assert_fail "huge" "$HUGE_OUT" "$HUGE_EC"
if ! printf '%s\n' "$HUGE_OUT" | grep -q 'Fail reason: oversize output'; then
  echo "FAIL [huge] missing oversize reason" >&2
  printf '%s\n' "$HUGE_OUT" >&2
  exit 1
fi

finalize_test
