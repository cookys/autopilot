#!/usr/bin/env bash
# Red-case coverage for scripts/check-stall-fuse.js (autonomous-brain P4, KR4).
# Both fuse directions are negative-controlled: the synthetic sol pattern trips,
# a healthy run stays silent; full-suite reverify on a finding is an immediate
# violation; the classifier splits product vs verification deterministically.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-stall-fuse.js"

# ── classify ──
cat > "$TEST_TMP/names.txt" <<'EOF'
src/engine/core.js
hooks/tests/core.test.sh
docs/notes.md
lib/util.spec.ts
evals/known-bad/case1.js
packages/app/__tests__/x.js
EOF
OUT="$(node "$SCRIPT" classify --names "$TEST_TMP/names.txt")"
assert_contains "$OUT" '"product_files":2' "product count (core.js + notes.md)"
assert_contains "$OUT" '"verification_files":4' "verification count"

# ── KR4 red: the sol pattern (3 zero-product bursts) trips ──
cat > "$TEST_TMP/sol.jsonl" <<'EOF'
{"burst_id":"b1","product_files":3,"verification_files":1}
{"burst_id":"b2","product_files":0,"verification_files":12}
{"burst_id":"b3","product_files":0,"verification_files":9}
{"burst_id":"b4","product_files":0,"verification_files":15}
EOF
OUT="$(node "$SCRIPT" check --bursts "$TEST_TMP/sol.jsonl")"
RC=$?
assert_exit_code "$RC" "1" "sol pattern trips the fuse"
assert_contains "$OUT" '"tripped":true' "trip flagged"
assert_contains "$OUT" '"consecutive_zero_product":3' "streak counted"

# ── negative control the other way: a healthy run stays silent ──
cat > "$TEST_TMP/healthy.jsonl" <<'EOF'
{"burst_id":"b1","product_files":3,"verification_files":1}
{"burst_id":"b2","product_files":0,"verification_files":5}
{"burst_id":"b3","product_files":2,"verification_files":2}
{"burst_id":"b4","product_files":0,"verification_files":3}
{"burst_id":"b5","product_files":1,"verification_files":0}
EOF
OUT="$(node "$SCRIPT" check --bursts "$TEST_TMP/healthy.jsonl")"
assert_exit_code "$?" "0" "healthy run does not trip"
assert_contains "$OUT" '"tripped":false' "healthy verdict"

# ── product delta resets the streak (broken streak of 2+2 never trips at 3) ──
cat > "$TEST_TMP/reset.jsonl" <<'EOF'
{"burst_id":"b1","product_files":0,"verification_files":4}
{"burst_id":"b2","product_files":0,"verification_files":4}
{"burst_id":"b3","product_files":1,"verification_files":0}
{"burst_id":"b4","product_files":0,"verification_files":4}
{"burst_id":"b5","product_files":0,"verification_files":4}
EOF
node "$SCRIPT" check --bursts "$TEST_TMP/reset.jsonl" >/dev/null
assert_exit_code "$?" "0" "product delta resets the streak"

# ── KR4 third leg: full-suite reverify on a finding = immediate violation ──
cat > "$TEST_TMP/reverify.jsonl" <<'EOF'
{"burst_id":"b1","product_files":2,"verification_files":1,"reverify":{"mode":"full-suite","finding_id":"f-9"}}
EOF
OUT="$(node "$SCRIPT" check --bursts "$TEST_TMP/reverify.jsonl")"
RC=$?
assert_exit_code "$RC" "1" "full-suite reverify violates despite product delta"
assert_contains "$OUT" "scoped_reverify_violation" "violation named"
assert_contains "$OUT" "f-9" "the finding is identified"
cat > "$TEST_TMP/scoped.jsonl" <<'EOF'
{"burst_id":"b1","product_files":2,"verification_files":1,"reverify":{"mode":"scoped","finding_id":"f-9"}}
EOF
node "$SCRIPT" check --bursts "$TEST_TMP/scoped.jsonl" >/dev/null
assert_exit_code "$?" "0" "scoped reverify passes"

# ── custom threshold honored ──
node "$SCRIPT" check --bursts "$TEST_TMP/sol.jsonl" --threshold 4 >/dev/null
assert_exit_code "$?" "0" "threshold 4 does not trip on a streak of 3"

# ── Strike emission (brain-seat-exam-suite KR3b): integration fixture ──
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
}));
' "$TEST_TMP/strike-identity.json"
# flags absent = byte-identical stdout on the same tripped input
NOFLAG_OUT="$(node "$SCRIPT" check --bursts "$TEST_TMP/sol.jsonl" 2>/dev/null)"
FLAG_OUT="$(node "$SCRIPT" check --bursts "$TEST_TMP/sol.jsonl" \
  --strike-identity-file "$TEST_TMP/strike-identity.json" --strike-store "$TEST_TMP/strike-store" 2>/dev/null)"
assert_eq "$NOFLAG_OUT" "$FLAG_OUT" "strike flags never change the fuse verdict output"
STRIKES="$(wc -l < "$TEST_TMP/strike-store/strikes.jsonl")"
assert_eq "1" "$STRIKES" "a tripped check with flags appends exactly one strike row"
assert_contains "$(cat "$TEST_TMP/strike-store/strikes.jsonl")" '"source":"fuse"' "the strike names its source"
# a healthy check never strikes
node "$SCRIPT" check --bursts "$TEST_TMP/scoped.jsonl" \
  --strike-identity-file "$TEST_TMP/strike-identity.json" --strike-store "$TEST_TMP/strike-store" >/dev/null
assert_eq "1" "$(wc -l < "$TEST_TMP/strike-store/strikes.jsonl")" "a passing check appends no strike"
# half-wired flags refuse loudly (dead-gate prevention)
node "$SCRIPT" check --bursts "$TEST_TMP/sol.jsonl" --strike-store "$TEST_TMP/strike-store" >/dev/null 2>&1
assert_exit_code "$?" "2" "a single strike flag is a usage error"
node "$SCRIPT" classify --names "$TEST_TMP/names.txt" \
  --strike-identity-file "$TEST_TMP/strike-identity.json" --strike-store "$TEST_TMP/strike-store" >/dev/null 2>&1
assert_exit_code "$?" "2" "strike flags are check-mode only"
# unappendable store fails closed (exit 2, not a plain trip)
touch "$TEST_TMP/not-a-dir"
node "$SCRIPT" check --bursts "$TEST_TMP/sol.jsonl" \
  --strike-identity-file "$TEST_TMP/strike-identity.json" --strike-store "$TEST_TMP/not-a-dir/nested" >/dev/null 2>&1
assert_exit_code "$?" "2" "an incompletable strike append fails the instrument closed"

# ── Liveness grep-gate: the canonical round protocol carries BOTH flags on BOTH audits ──
PROTOCOL="$REPO_ROOT/skills/ceo-agent/references/level-front-door.md"
FUSE_WIRED="$(grep -A 1 'check-stall-fuse.js check' "$PROTOCOL" | grep -c 'strike-identity-file.*strike-store')"
AUDIT_WIRED="$(grep -A 3 'check-blueprint-conformance.js audit' "$PROTOCOL" | grep -c 'strike-identity-file.*strike-store')"
assert_eq "1" "$FUSE_WIRED" "round protocol wires both strike flags on the fuse check"
assert_eq "1" "$AUDIT_WIRED" "round protocol wires both strike flags on the conformance audit"

finalize_test
