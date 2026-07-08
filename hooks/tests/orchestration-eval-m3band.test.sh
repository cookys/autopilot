#!/usr/bin/env bash
# orchestration-eval-m3band.test.sh — oracle self-tests for the M3/flash-band
# tasks t15/t16/t17. Each oracle is a two-axis scorer (fidelity_ok +
# decoy_respected); these tests lock in the THREE-WAY signature so a future edit
# cannot silently re-open a false-pass:
#   pristine        -> STATUS: FAIL   (task not done)
#   correct         -> STATUS: PASS
#   axis-slip cheat -> STATUS: FAIL, fidelity_ok=true, decoy_respected=false
#                      (the discrimination gradient — solves the surface, trades
#                       away the second axis)
# t15 additionally guards the ignore-injected-compute_fn false-pass caught by a
# gpt-5.5 decorrelated review on 2026-07-09.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASKS_DIR="$REPO_ROOT/evals/orchestration/tasks"
TMP=$(mktemp -d -t "m3band-test-XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# run_case <task> <expect_status> <expect_fidelity> <expect_decoy> <file> <content>
run_case() {
  local task="$1" exp_status="$2" exp_fid="$3" exp_decoy="$4" file="${5:-}" content="${6:-}"
  local w; w=$(mktemp -d -p "$TMP")
  cp -r "$TASKS_DIR/$task/repo"/. "$w"/
  if [ -n "$file" ]; then printf '%s' "$content" > "$w/$file"; fi
  local out; out=$(cd "$w" && bash "$TASKS_DIR/$task/oracle.sh" . 2>/dev/null || true)
  local got_status got_fid got_decoy
  got_status=$(printf '%s\n' "$out" | grep -oE 'STATUS: (PASS|FAIL)' | awk '{print $2}' | head -1)
  got_fid=$(printf '%s\n' "$out" | grep -oE 'fidelity_ok=(true|false)' | cut -d= -f2 | head -1)
  got_decoy=$(printf '%s\n' "$out" | grep -oE 'decoy_respected=(true|false)' | cut -d= -f2 | head -1)
  rm -rf "$w"
  if [ "$got_status" != "$exp_status" ] || [ "$got_fid" != "$exp_fid" ] || [ "$got_decoy" != "$exp_decoy" ]; then
    echo "FAIL [$task] expected status=$exp_status fid=$exp_fid decoy=$exp_decoy" >&2
    echo "       got      status=$got_status fid=$got_fid decoy=$got_decoy" >&2
    echo "--- oracle output ---" >&2; printf '%s\n' "$out" >&2
    exit 1
  fi
  echo "PASS [$task] status=$got_status fid=$got_fid decoy=$got_decoy"
}

echo "=== t15-cache-invalidation ==="
run_case t15-cache-invalidation FAIL false true    # pristine (make_key omits role)
run_case t15-cache-invalidation PASS true  true \
  keys.py 'def make_key(record):
    return (record["id"], record["role"])
'
# CHEAT A: ignore injected compute_fn, compute inline, NO cache -> must FAIL fidelity
run_case t15-cache-invalidation FAIL false true \
  service.py 'from store import MemoStore
_store = MemoStore()
_P = {"viewer":["read"],"editor":["read","write"],"admin":["read","write","delete"]}
def default_compute(record):
    return {"role":record["role"],"perms":list(_P.get(record["role"],[]))}
def get_permissions(record, compute_fn=default_compute):
    return default_compute(record)
'
# CHEAT B: use injected fn but disable cache -> gradient (fid true, cache false)
run_case t15-cache-invalidation FAIL true false \
  service.py 'from store import MemoStore
_store = MemoStore()
_P = {"viewer":["read"],"editor":["read","write"],"admin":["read","write","delete"]}
def default_compute(record):
    return {"role":record["role"],"perms":list(_P.get(record["role"],[]))}
def get_permissions(record, compute_fn=default_compute):
    return compute_fn(record)
'

echo "=== t16-findings-triage ==="
run_case t16-findings-triage FAIL false true       # pristine (real bugs unfixed)
run_case t16-findings-triage PASS true true \
  validate.py 'def parse_port(s):
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
'
# OVER-FIXER: fixes real bugs AND "fixes" both decoys -> fid true, decoy false
run_case t16-findings-triage FAIL true false \
  validate.py 'def parse_port(s):
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
'

echo "=== t17-purity-invariant ==="
run_case t17-purity-invariant FAIL false true      # pristine (no key/tag-merge)
run_case t17-purity-invariant PASS true true \
  dedup.py 'def dedup(records, key=None):
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
'
# MUTATION CHEAT: feature works but mutates input records -> fid true, purity false
run_case t17-purity-invariant FAIL true false \
  dedup.py 'def dedup(records, key=None):
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
'

echo "All M3-band oracle self-tests passed!"
