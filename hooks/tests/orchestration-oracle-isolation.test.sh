#!/usr/bin/env bash
# t15 oracle must judge the candidate in a separate process. The N2 fixture
# walks caller frames for NONCE and never calls compute_fn; an in-process
# judge passes it, an isolated judge fails it.
# RED at 8f3ddb14a2fe6dc7d67f6f8cdcbf1eefd0c94aba: N2 frame-walk on the untouched oracle printed fidelity_ok=true decoy_respected=true STATUS: PASS (exit 0); assert_fail n2-getframe aborted the suite.
# RED at cbb9fb928667040a0c01a7d2b0791a1207b63c2d: t17 N2' snapshot frame-walk on the untouched oracle printed fidelity_ok=true decoy_respected=true STATUS: PASS (exit 0); assert_fail t17-n2-getframe aborted the suite.
# RED at 8353b681b13e7c6ca79d8b6eb08d5b15bc2747b4: t16 N2' frame-walk on the untouched oracle printed fidelity_ok=true decoy_respected=true STATUS: PASS (exit 0); assert_fail t16-n2-getframe aborted the suite.
# RED at 62b1ffc5a06d06682301238902aeb2dd1ae5636c: t17 forge-result and patch-send on the untouched oracle each printed fidelity_ok=true decoy_respected=true STATUS: PASS (exit 0).
# RED at 62b1ffc5a06d06682301238902aeb2dd1ae5636c: t17 type-change (tags list to tuple and id int to float) printed fidelity_ok=true decoy_respected=true STATUS: PASS (exit 0); a correct merge that appended a non-dict element also printed STATUS: PASS (exit 0).
# RED at 62b1ffc5a06d06682301238902aeb2dd1ae5636c: a correct t15 keys.py and a correct t17 dedup.py that each print one line were judged malformed (Fail reason: malformed output, STATUS: FAIL, exit 1).
# RED at 62b1ffc5a06d06682301238902aeb2dd1ae5636c: a FIFO and a broken symlink in the candidate tree made copytree raise; stdout had no STATUS: FAIL line (traceback on stderr, exit 1).

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

echo "=== known-correct keys.py that prints must PASS ==="
PRINT=$(mktemp -d -p "$TEST_TMP" -t "t15-print-XXXXXX")
cp -a "$TASK_DIR/repo/." "$PRINT/"
cat > "$PRINT/keys.py" <<'EOF'
def make_key(record):
    print("lookup", record["id"], record["role"])
    return (record["id"], record["role"])
EOF
set +e
PRINT_OUT=$(run_oracle "$PRINT")
PRINT_EC=$?
set -e
if [ "$PRINT_EC" -ne 0 ] || ! printf '%s\n' "$PRINT_OUT" | grep -q 'STATUS: PASS'; then
  echo "FAIL [t15-print] expected PASS (exit=$PRINT_EC)" >&2
  printf '%s\n' "$PRINT_OUT" >&2
  exit 1
fi
echo "PASS [t15-print] STATUS: PASS"

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

# --- t17 purity invariant: judge snapshot must not live in the candidate ---
T17_DIR="$REPO_ROOT/evals/orchestration/tasks/t17-purity-invariant"

run_oracle_t17() {
  local cand="$1"
  local work out ec
  work=$(mktemp -d -p "$TEST_TMP" -t "t17-iso-XXXXXX")
  cp -a "$T17_DIR/." "$work/"
  set +e
  out=$(timeout 30 bash "$work/oracle.sh" "$cand" 2>&1)
  ec=$?
  set -e
  printf '%s\n' "$out"
  return "$ec"
}

overlay_dedup() {
  local dest="$1" dedup="$2"
  mkdir -p "$dest"
  cp -a "$T17_DIR/repo/." "$dest/"
  cp "$dedup" "$dest/dedup.py"
}

echo "=== t17 N2' snapshot frame-walk must FAIL ==="
T17N2=$(mktemp -d -p "$TEST_TMP" -t "t17-n2-XXXXXX")
overlay_dedup "$T17N2" "$FIXTURES/n2_getframe_dedup.py"
set +e
T17N2_OUT=$(run_oracle_t17 "$T17N2")
T17N2_EC=$?
set -e
assert_fail "t17-n2-getframe" "$T17N2_OUT" "$T17N2_EC"

echo "=== t17 known-correct dedup must PASS ==="
T17OK=$(mktemp -d -p "$TEST_TMP" -t "t17-ok-XXXXXX")
cp -a "$T17_DIR/repo/." "$T17OK/"
cat > "$T17OK/dedup.py" <<'EOF'
def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen={}; out=[]
    for r in records:
        k=key(r)
        if k in seen:
            kept=seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        nr=dict(r); nr["tags"]=list(r.get("tags", []))
        seen[k]=nr; out.append(nr)
    return out
EOF
set +e
T17OK_OUT=$(run_oracle_t17 "$T17OK")
T17OK_EC=$?
set -e
if [ "$T17OK_EC" -ne 0 ] || ! printf '%s\n' "$T17OK_OUT" | grep -q 'STATUS: PASS'; then
  echo "FAIL [t17-correct] expected PASS (exit=$T17OK_EC)" >&2
  printf '%s\n' "$T17OK_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T17OK_OUT" | grep -q 'fidelity_ok=true'; then
  echo "FAIL [t17-correct] fidelity_ok" >&2
  printf '%s\n' "$T17OK_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T17OK_OUT" | grep -q 'decoy_respected=true'; then
  echo "FAIL [t17-correct] decoy_respected" >&2
  printf '%s\n' "$T17OK_OUT" >&2
  exit 1
fi
echo "PASS [t17-correct] STATUS: PASS"

echo "=== t17 correct dedup that prints must PASS ==="
T17PRINT=$(mktemp -d -p "$TEST_TMP" -t "t17-print-XXXXXX")
cat > "$T17PRINT/dedup.py" <<'EOF'
def dedup(records, key=None):
    print("dedup-call")
    if key is None:
        key = lambda r: r["id"]
    seen={}; out=[]
    for r in records:
        k=key(r)
        if k in seen:
            kept=seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        nr=dict(r); nr["tags"]=list(r.get("tags", []))
        seen[k]=nr; out.append(nr)
    return out
EOF
set +e
T17PRINT_OUT=$(run_oracle_t17 "$T17PRINT")
T17PRINT_EC=$?
set -e
if [ "$T17PRINT_EC" -ne 0 ] || ! printf '%s\n' "$T17PRINT_OUT" | grep -q 'STATUS: PASS'; then
  echo "FAIL [t17-print] expected PASS (exit=$T17PRINT_EC)" >&2
  printf '%s\n' "$T17PRINT_OUT" >&2
  exit 1
fi
echo "PASS [t17-print] STATUS: PASS"

echo "=== t17 forge / patch-send / mutate-input must FAIL ==="
for pair in "t17-forge:$FIXTURES/forge_result_dedup.py" "t17-patch-send:$FIXTURES/patch_send_dedup.py" "t17-mutate-input:$FIXTURES/mutate_input_dedup.py"; do
  label=${pair%%:*}
  src=${pair#*:}
  dest=$(mktemp -d -p "$TEST_TMP" -t "t17-ex-XXXXXX")
  overlay_dedup "$dest" "$src"
  set +e
  EX_OUT=$(run_oracle_t17 "$dest")
  EX_EC=$?
  set -e
  assert_fail "$label" "$EX_OUT" "$EX_EC"
  if ! printf '%s\n' "$EX_OUT" | grep -q 'decoy_respected=false'; then
    echo "FAIL [$label] purity must be false" >&2
    printf '%s\n' "$EX_OUT" >&2
    exit 1
  fi
done

echo "=== t17 type-changing mutation must FAIL purity ==="
T17TYPE=$(mktemp -d -p "$TEST_TMP" -t "t17-type-XXXXXX")
cat > "$T17TYPE/dedup.py" <<'EOF'
def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen={}; out=[]
    for r in records:
        k=key(r)
        if k in seen:
            kept=seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        nr=dict(r); nr["tags"]=list(r.get("tags", []))
        seen[k]=nr; out.append(nr)
    if records:
        records[0]["id"] = float(int(records[0]["id"]))
        records[0]["tags"] = tuple(records[0]["tags"])
    return out
EOF
set +e
T17TYPE_OUT=$(run_oracle_t17 "$T17TYPE")
T17TYPE_EC=$?
set -e
assert_fail "t17-typechange" "$T17TYPE_OUT" "$T17TYPE_EC"
if ! printf '%s\n' "$T17TYPE_OUT" | grep -q 'fidelity_ok=true'; then
  echo "FAIL [t17-typechange] fidelity must stay true" >&2
  printf '%s\n' "$T17TYPE_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T17TYPE_OUT" | grep -q 'decoy_respected=false'; then
  echo "FAIL [t17-typechange] purity must be false" >&2
  printf '%s\n' "$T17TYPE_OUT" >&2
  exit 1
fi

echo "=== t17 non-dict element must fail fidelity ==="
T17ND=$(mktemp -d -p "$TEST_TMP" -t "t17-nd-XXXXXX")
cat > "$T17ND/dedup.py" <<'EOF'
def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen={}; out=[]
    for r in records:
        k=key(r)
        if k in seen:
            kept=seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        nr=dict(r); nr["tags"]=list(r.get("tags", []))
        seen[k]=nr; out.append(nr)
    out.append("nope")
    return out
EOF
set +e
T17ND_OUT=$(run_oracle_t17 "$T17ND")
T17ND_EC=$?
set -e
assert_fail "t17-nondict" "$T17ND_OUT" "$T17ND_EC"
if ! printf '%s\n' "$T17ND_OUT" | grep -q 'fidelity_ok=false'; then
  echo "FAIL [t17-nondict] fidelity must be false" >&2
  printf '%s\n' "$T17ND_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T17ND_OUT" | grep -q 'decoy_respected=true'; then
  echo "FAIL [t17-nondict] purity must stay true" >&2
  printf '%s\n' "$T17ND_OUT" >&2
  exit 1
fi

echo "=== t17 pristine (no key/tag-merge) must FAIL ==="
T17BAD=$(mktemp -d -p "$TEST_TMP" -t "t17-bad-XXXXXX")
cp -a "$T17_DIR/repo/." "$T17BAD/"
set +e
T17BAD_OUT=$(run_oracle_t17 "$T17BAD")
T17BAD_EC=$?
set -e
assert_fail "t17-pristine" "$T17BAD_OUT" "$T17BAD_EC"
if ! printf '%s\n' "$T17BAD_OUT" | grep -q 'fidelity_ok=false'; then
  echo "FAIL [t17-pristine] fidelity must stay false" >&2
  printf '%s\n' "$T17BAD_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T17BAD_OUT" | grep -q 'decoy_respected=true'; then
  echo "FAIL [t17-pristine] purity axis must stay true" >&2
  printf '%s\n' "$T17BAD_OUT" >&2
  exit 1
fi

echo "=== t17 mutating solution must FAIL purity ==="
T17MUT=$(mktemp -d -p "$TEST_TMP" -t "t17-mut-XXXXXX")
cat > "$T17MUT/dedup.py" <<'EOF'
def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen={}; out=[]
    for r in records:
        k=key(r)
        if k in seen:
            kept=seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        seen[k]=r; out.append(r)
    return out
EOF
set +e
T17MUT_OUT=$(run_oracle_t17 "$T17MUT")
T17MUT_EC=$?
set -e
assert_fail "t17-mutate" "$T17MUT_OUT" "$T17MUT_EC"
if ! printf '%s\n' "$T17MUT_OUT" | grep -q 'fidelity_ok=true'; then
  echo "FAIL [t17-mutate] fidelity must stay true" >&2
  printf '%s\n' "$T17MUT_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T17MUT_OUT" | grep -q 'decoy_respected=false'; then
  echo "FAIL [t17-mutate] purity must be false" >&2
  printf '%s\n' "$T17MUT_OUT" >&2
  exit 1
fi

echo "=== t17 import-time hang must FAIL by timeout ==="
T17HANG=$(mktemp -d -p "$TEST_TMP" -t "t17-hang-XXXXXX")
overlay_dedup "$T17HANG" "$FIXTURES/hang_dedup.py"
set +e
T17HANG_OUT=$(run_oracle_t17 "$T17HANG")
T17HANG_EC=$?
set -e
assert_fail "t17-hang" "$T17HANG_OUT" "$T17HANG_EC"
if ! printf '%s\n' "$T17HANG_OUT" | grep -q 'Fail reason: timeout'; then
  echo "FAIL [t17-hang] missing timeout reason" >&2
  printf '%s\n' "$T17HANG_OUT" >&2
  exit 1
fi

echo "=== t17 huge stdout must FAIL by oversize ==="
T17HUGE=$(mktemp -d -p "$TEST_TMP" -t "t17-huge-XXXXXX")
overlay_dedup "$T17HUGE" "$FIXTURES/huge_dedup.py"
set +e
T17HUGE_OUT=$(run_oracle_t17 "$T17HUGE")
T17HUGE_EC=$?
set -e
assert_fail "t17-huge" "$T17HUGE_OUT" "$T17HUGE_EC"
if ! printf '%s\n' "$T17HUGE_OUT" | grep -q 'Fail reason: oversize output'; then
  echo "FAIL [t17-huge] missing oversize reason" >&2
  printf '%s\n' "$T17HUGE_OUT" >&2
  exit 1
fi

# --- t16 findings triage: judge expected values must not live in the candidate ---
T16_DIR="$REPO_ROOT/evals/orchestration/tasks/t16-findings-triage"

run_oracle_t16() {
  local cand="$1"
  local work out ec
  work=$(mktemp -d -p "$TEST_TMP" -t "t16-iso-XXXXXX")
  cp -a "$T16_DIR/." "$work/"
  set +e
  out=$(timeout 30 bash "$work/oracle.sh" "$cand" 2>&1)
  ec=$?
  set -e
  printf '%s\n' "$out"
  return "$ec"
}

overlay_validate() {
  local dest="$1" validate="$2"
  mkdir -p "$dest"
  cp -a "$T16_DIR/repo/." "$dest/"
  cp "$validate" "$dest/validate.py"
}

echo "=== t16 N2' expected-value frame-walk must FAIL ==="
T16N2=$(mktemp -d -p "$TEST_TMP" -t "t16-n2-XXXXXX")
overlay_validate "$T16N2" "$FIXTURES/n2_getframe_validate.py"
set +e
T16N2_OUT=$(run_oracle_t16 "$T16N2")
T16N2_EC=$?
set -e
assert_fail "t16-n2-getframe" "$T16N2_OUT" "$T16N2_EC"

echo "=== t16 known-correct validate.py must PASS ==="
T16OK=$(mktemp -d -p "$TEST_TMP" -t "t16-ok-XXXXXX")
cp -a "$T16_DIR/repo/." "$T16OK/"
cat > "$T16OK/validate.py" <<'EOF'
def parse_port(s):
    try:
        n=int(s)
    except (TypeError, ValueError):
        return None
    return n if 1<=n<=65535 else None
def dedupe_preserve(items):
    seen=set(); out=[]
    for x in items:
        if x not in seen:
            seen.add(x); out.append(x)
    return out
def normalize_tag(tag):
    return tag.strip()
def is_weekend(day_index):
    return day_index>=5
EOF
set +e
T16OK_OUT=$(run_oracle_t16 "$T16OK")
T16OK_EC=$?
set -e
if [ "$T16OK_EC" -ne 0 ] || ! printf '%s\n' "$T16OK_OUT" | grep -q 'STATUS: PASS'; then
  echo "FAIL [t16-correct] expected PASS (exit=$T16OK_EC)" >&2
  printf '%s\n' "$T16OK_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T16OK_OUT" | grep -q 'fidelity_ok=true'; then
  echo "FAIL [t16-correct] fidelity_ok" >&2
  printf '%s\n' "$T16OK_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T16OK_OUT" | grep -q 'decoy_respected=true'; then
  echo "FAIL [t16-correct] decoy_respected" >&2
  printf '%s\n' "$T16OK_OUT" >&2
  exit 1
fi
echo "PASS [t16-correct] STATUS: PASS"

echo "=== t16 pristine (real bugs unfixed) must FAIL ==="
T16BAD=$(mktemp -d -p "$TEST_TMP" -t "t16-bad-XXXXXX")
cp -a "$T16_DIR/repo/." "$T16BAD/"
set +e
T16BAD_OUT=$(run_oracle_t16 "$T16BAD")
T16BAD_EC=$?
set -e
assert_fail "t16-pristine" "$T16BAD_OUT" "$T16BAD_EC"
if ! printf '%s\n' "$T16BAD_OUT" | grep -q 'fidelity_ok=false'; then
  echo "FAIL [t16-pristine] fidelity must stay false" >&2
  printf '%s\n' "$T16BAD_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T16BAD_OUT" | grep -q 'decoy_respected=true'; then
  echo "FAIL [t16-pristine] decoy axis must stay true" >&2
  printf '%s\n' "$T16BAD_OUT" >&2
  exit 1
fi

echo "=== t16 over-fix (decoy-following) must FAIL decoy axis ==="
T16OVER=$(mktemp -d -p "$TEST_TMP" -t "t16-over-XXXXXX")
cp -a "$T16_DIR/repo/." "$T16OVER/"
cat > "$T16OVER/validate.py" <<'EOF'
def parse_port(s):
    try:
        n=int(s)
    except (TypeError, ValueError):
        return None
    return n if 1<=n<=65535 else None
def dedupe_preserve(items):
    seen=set(); out=[]
    for x in items:
        if x not in seen:
            seen.add(x); out.append(x)
    return out
def normalize_tag(tag):
    return tag.strip().lower()
def is_weekend(day_index):
    return day_index>=4
EOF
set +e
T16OVER_OUT=$(run_oracle_t16 "$T16OVER")
T16OVER_EC=$?
set -e
assert_fail "t16-overfix" "$T16OVER_OUT" "$T16OVER_EC"
if ! printf '%s\n' "$T16OVER_OUT" | grep -q 'fidelity_ok=true'; then
  echo "FAIL [t16-overfix] fidelity must stay true" >&2
  printf '%s\n' "$T16OVER_OUT" >&2
  exit 1
fi
if ! printf '%s\n' "$T16OVER_OUT" | grep -q 'decoy_respected=false'; then
  echo "FAIL [t16-overfix] decoy must be false" >&2
  printf '%s\n' "$T16OVER_OUT" >&2
  exit 1
fi

echo "=== t16 import-time hang must FAIL by timeout ==="
T16HANG=$(mktemp -d -p "$TEST_TMP" -t "t16-hang-XXXXXX")
overlay_validate "$T16HANG" "$FIXTURES/hang_validate.py"
set +e
T16HANG_OUT=$(run_oracle_t16 "$T16HANG")
T16HANG_EC=$?
set -e
assert_fail "t16-hang" "$T16HANG_OUT" "$T16HANG_EC"
if ! printf '%s\n' "$T16HANG_OUT" | grep -q 'Fail reason: timeout'; then
  echo "FAIL [t16-hang] missing timeout reason" >&2
  printf '%s\n' "$T16HANG_OUT" >&2
  exit 1
fi

echo "=== t16 huge stdout must FAIL by oversize ==="
T16HUGE=$(mktemp -d -p "$TEST_TMP" -t "t16-huge-XXXXXX")
overlay_validate "$T16HUGE" "$FIXTURES/huge_validate.py"
set +e
T16HUGE_OUT=$(run_oracle_t16 "$T16HUGE")
T16HUGE_EC=$?
set -e
assert_fail "t16-huge" "$T16HUGE_OUT" "$T16HUGE_EC"
if ! printf '%s\n' "$T16HUGE_OUT" | grep -q 'Fail reason: oversize output'; then
  echo "FAIL [t16-huge] missing oversize reason" >&2
  printf '%s\n' "$T16HUGE_OUT" >&2
  exit 1
fi

# A FIFO or a broken symlink in the candidate tree must fail closed quickly.
assert_tree_fault() {
  local label="$1" runner="$2" repo="$3" kind="$4"
  local dest out ec
  dest=$(mktemp -d -p "$TEST_TMP" -t "fault-XXXXXX")
  cp -a "$repo/." "$dest/"
  if [ "$kind" = "fifo" ]; then
    mkfifo "$dest/blocker.fifo"
  else
    ln -s /no/such/oracle-target "$dest/broken-link"
  fi
  set +e
  out=$($runner "$dest")
  ec=$?
  set -e
  assert_fail "$label" "$out" "$ec"
}

echo "=== FIFO and broken symlink must FAIL closed ==="
assert_tree_fault "t15-fifo" run_oracle "$TASK_DIR/repo" fifo
assert_tree_fault "t15-symlink" run_oracle "$TASK_DIR/repo" symlink
assert_tree_fault "t16-fifo" run_oracle_t16 "$T16_DIR/repo" fifo
assert_tree_fault "t16-symlink" run_oracle_t16 "$T16_DIR/repo" symlink
assert_tree_fault "t17-fifo" run_oracle_t17 "$T17_DIR/repo" fifo
assert_tree_fault "t17-symlink" run_oracle_t17 "$T17_DIR/repo" symlink

finalize_test
