#!/usr/bin/env bash
# supersession-anchors.test.sh — scripts/check-supersession-anchors.js
#
# The gate's whole value is that it goes RED, so every case here removes something
# and asserts the named failure, rather than only confirming the shipped tree is green.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$REPO_ROOT/scripts/check-supersession-anchors.js"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "ok — $1"; }
nope() { FAIL=$((FAIL+1)); echo "FAIL — $1"; }

# Never assert through a pipe: a pipeline reports the LAST stage's status, so
# `node … | grep` would report grep's exit and hide a crash in the checker.
run_check() { node "$CHECK" --manifest "$1" >"$2" 2>&1; echo $?; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# --- case 1: the shipped manifest is green -------------------------------------
OUT="$SANDBOX/out1"
node "$CHECK" >"$OUT" 2>&1; RC=$?
if [ "$RC" -eq 0 ]; then ok "shipped tree passes"; else nope "shipped tree should pass (rc=$RC): $(cat "$OUT")"; fi

# --- case 2: a missing pointer is named ----------------------------------------
# Build a sandbox copy so the real tree is never mutated by a test.
mkdir -p "$SANDBOX/repo/scripts" "$SANDBOX/repo/hooks/fixtures"
printf '%s\n' \
  '// some preamble' \
  '// P7/KR6: the operator explicit per-invocation override is the only' \
  '// evidence-free path' \
  > "$SANDBOX/repo/scripts/target.js"
cat > "$SANDBOX/manifest-missing.json" <<EOF
{"schema_version":1,"marker":"superseded by owner ruling 2026-09-11","window_lines":3,
 "anchors":[{"id":"t1","file":"$SANDBOX/repo/scripts/target.js","symbol":"P7/KR6","superseded_ruling":"x"}],
 "protected_regions":[]}
EOF
# The manifest resolves files against REPO_ROOT, so an absolute path must still work:
OUT="$SANDBOX/out2"; RC="$(run_check "$SANDBOX/manifest-missing.json" "$OUT")"
if [ "$RC" -ne 0 ] && grep -q 'no "superseded by owner ruling 2026-09-11" pointer' "$OUT"; then
  ok "missing pointer fails and names the marker"
else
  nope "missing pointer should fail naming the marker (rc=$RC): $(cat "$OUT")"
fi

# --- case 3: a stale manifest entry fails rather than silently skipping ---------
cat > "$SANDBOX/manifest-stale.json" <<EOF
{"schema_version":1,"marker":"superseded by owner ruling 2026-09-11","window_lines":3,
 "anchors":[{"id":"gone","file":"$SANDBOX/repo/scripts/target.js","symbol":"THIS SYMBOL DOES NOT EXIST","superseded_ruling":"x"}],
 "protected_regions":[]}
EOF
OUT="$SANDBOX/out3"; RC="$(run_check "$SANDBOX/manifest-stale.json" "$OUT")"
if [ "$RC" -ne 0 ] && grep -q 'manifest is stale' "$OUT"; then
  ok "a vanished anchor fails loudly instead of passing vacuously"
else
  nope "vanished anchor should fail as stale (rc=$RC): $(cat "$OUT")"
fi

# --- case 4: a changed protected region is named with both digests -------------
printf '%s\n' 'START' 'body line' 'END' > "$SANDBOX/repo/scripts/region.sh"
cat > "$SANDBOX/manifest-region.json" <<EOF
{"schema_version":1,"marker":"superseded by owner ruling 2026-09-11","window_lines":3,
 "anchors":[],
 "protected_regions":[{"id":"r1","file":"$SANDBOX/repo/scripts/region.sh","start_marker":"START","end_marker":"END","why":"test"}]}
EOF
node "$CHECK" --manifest "$SANDBOX/manifest-region.json" --update-digests >/dev/null 2>&1
OUT="$SANDBOX/out4a"; RC="$(run_check "$SANDBOX/manifest-region.json" "$OUT")"
[ "$RC" -eq 0 ] || nope "region should be green right after --update-digests (rc=$RC)"
printf '%s\n' 'START' 'body line CHANGED' 'END' > "$SANDBOX/repo/scripts/region.sh"
OUT="$SANDBOX/out4b"; RC="$(run_check "$SANDBOX/manifest-region.json" "$OUT")"
if [ "$RC" -ne 0 ] && grep -q 'changed:' "$OUT" && grep -q 'expected' "$OUT"; then
  ok "a changed protected region fails and shows both digests"
else
  nope "changed region should fail with both digests (rc=$RC): $(cat "$OUT")"
fi

# --- case 5: an unrecorded digest fails rather than defaulting to trust ---------
cat > "$SANDBOX/manifest-nodigest.json" <<EOF
{"schema_version":1,"marker":"superseded by owner ruling 2026-09-11","window_lines":3,
 "anchors":[],
 "protected_regions":[{"id":"r2","file":"$SANDBOX/repo/scripts/region.sh","start_marker":"START","end_marker":"END","why":"test"}]}
EOF
OUT="$SANDBOX/out5"; RC="$(run_check "$SANDBOX/manifest-nodigest.json" "$OUT")"
if [ "$RC" -ne 0 ] && grep -q 'no recorded digest' "$OUT"; then
  ok "an unrecorded digest fails closed"
else
  nope "unrecorded digest should fail closed (rc=$RC): $(cat "$OUT")"
fi

echo ""
echo "supersession-anchors: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
