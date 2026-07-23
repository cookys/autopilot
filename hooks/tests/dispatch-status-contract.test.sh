#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

json_get() {
  echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p=process.argv[1].split('.');let v=o;for(const k of p){v=v?.[k];}console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('')}})" "$2"
}

M="$TEST_TMP/runs"
mkdir -p "$M"

touch "$TEST_TMP/log1.txt"

cat > "$M/t-strict.manifest.json" <<EOF
{"schema":1,"run_id":"t-strict","role":"implementer","runner":"codex","model":"m","log":"$TEST_TMP/log1.txt","worktree":"","lock":"","pid":0,"unit_id":"u-1","contract_sha256":"abc123","go":"GO"}
EOF

cat > "$M/t-legacy.manifest.json" <<EOF
{"schema":1,"run_id":"t-legacy","role":"implementer","runner":"codex","model":"m","log":"$TEST_TMP/log1.txt","worktree":"","lock":"","pid":0}
EOF

if [ ! -f "$TEST_TMP/log1.txt" ]; then
  fail "setup failed: log1.txt was not created"
fi

if [ ! -f "$M/t-strict.manifest.json" ]; then
  fail "setup failed: strict manifest was not created"
fi

if [ ! -f "$M/t-legacy.manifest.json" ]; then
  fail "setup failed: legacy manifest was not created"
fi

strict_out=$(AUTOPILOT_DISPATCH_RUNS_DIR="$M" node "$REPO_ROOT/scripts/dispatch-status.js" --run t-strict 2>&1)
strict_rc=$?

legacy_out=$(AUTOPILOT_DISPATCH_RUNS_DIR="$M" node "$REPO_ROOT/scripts/dispatch-status.js" --run t-legacy 2>&1)
legacy_rc=$?

assert_eq 0 "$strict_rc" "strict dispatch-status.js exit code"
assert_eq 0 "$legacy_rc" "legacy dispatch-status.js exit code"

if [ "$strict_rc" -ne 0 ]; then
  fail "strict dispatch-status.js exited nonzero: $strict_out"
fi

if [ "$legacy_rc" -ne 0 ]; then
  fail "legacy dispatch-status.js exited nonzero: $legacy_out"
fi

strict_unit=$(json_get "$strict_out" "unit_id")
strict_contract=$(json_get "$strict_out" "contract_sha256")
strict_go=$(json_get "$strict_out" "go")

legacy_unit=$(json_get "$legacy_out" "unit_id")
legacy_contract=$(json_get "$legacy_out" "contract_sha256")
legacy_go=$(json_get "$legacy_out" "go")

assert_eq "u-1" "$strict_unit" "strict manifest surfaces unit_id"
assert_eq "abc123" "$strict_contract" "strict manifest surfaces contract_sha256"
assert_eq "GO" "$strict_go" "strict manifest surfaces go"

assert_eq "" "$legacy_unit" "legacy manifest hides unit_id"
assert_eq "" "$legacy_contract" "legacy manifest hides contract_sha256"
assert_eq "" "$legacy_go" "legacy manifest hides go"

finalize_test