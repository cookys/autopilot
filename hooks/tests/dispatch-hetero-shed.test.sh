#!/usr/bin/env bash
# Mechanical unpinned work on a listed seat routes to the shed target and reports its run id.
. "$(dirname "$0")/lib.sh"
TEST_NAME="dispatch-hetero-shed"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX" "$TEST_TMP/bin" "$TEST_TMP/runs" "$TEST_TMP/session-mode"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'Work-Class: 文件\nTask-Shape: from-scratch\nPlease make a tiny change.\n' > "$PROMPT"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$TEST_TMP/burn-more.json" <<EOF_JSON
{"schema":"capacity.burn_more/1","run_id":"bm-hook-fixture","generated_at":"$NOW","shed":{"pools":[{"pool":"fixture-pool","seats":["capacity--claude"]}],"rules":{"mechanical_classes":["文件"],"targets_in_order":["codex"],"keep_on_origin":[],"prefer":"from scratch"}}}
EOF_JSON
cat > "$TEST_TMP/bin/codex" <<'EOF_CODEX'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*) echo 'codex-cli 9.9.9 (test stub)'; exit 0 ;;
esac
printf 'shed fixture\n' > shed-result.txt
git add shed-result.txt
git -c user.email=t@t -c user.name=t commit -q -m 'stub change'
EOF_CODEX
chmod +x "$TEST_TMP/bin/codex"
export AUTOPILOT_SHED_ROUTE=1 AUTOPILOT_BURN_MORE="$TEST_TMP/burn-more.json"
export AUTOPILOT_FLEET_ADDRESS='ns/host/capacity--claude@fixture'
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs" AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$TEST_TMP/capabilities"
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
mkdir -p "$ENGINE_CAPABILITY_DIR"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" "$SCRIPT" --no-verify-tip --context-window off --codex-bin "$TEST_TMP/bin/codex" --branch feat/shed-test --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/dispatch.err")"
EXIT=$?
assert_eq 0 "$EXIT" 'shed codex dispatch exits successfully'
JSON="$(printf '%s\n' "$OUT" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const o=s.trim().split(/\r?\n/).filter(x=>x.startsWith("{")).map(JSON.parse).pop();process.stdout.write(JSON.stringify(o||{}))})')"
node -e 'const o=JSON.parse(process.argv[1]); if(o.runner!=="codex"||!o.shed||o.shed.run_id!=="bm-hook-fixture") { console.error(JSON.stringify({runner:o.runner,shed:o.shed})); process.exit(1); }' "$JSON" || fail 'status JSON carries shed.run_id and selects codex'
MF="$(node -e 'const fs=require("fs"),p=process.argv[1]; const f=fs.readdirSync(p).find(x=>x.endsWith(".manifest.json")); process.stdout.write(f?`${p}/${f}`:"")' "$AUTOPILOT_DISPATCH_RUNS_DIR")"
assert_file_exists "$MF" 'dispatch manifest written'
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(o.shed?.run_id!=="bm-hook-fixture") process.exit(1)' "$MF" || fail 'manifest carries shed decision'

REAL_NODE="$(command -v node)"
cat > "$TEST_TMP/bin/node" <<'EOF_NODE'
#!/usr/bin/bash
if [[ "${SHED_TEST_GATE:-}" == reject-all && "${1:-}" == *"shed-route.js" ]]; then
  printf '%s\n' '{"shed":true,"run_id":"bm-hook-fixture","pool":"fixture-pool","target":"codex","reason":"listed_mechanical"}'
  exit 0
fi
if [[ "${1:-}" == *"cn-model-dispatch-gate.js" ]]; then
  case "${SHED_TEST_GATE:-} $*" in
    *"--runner cc-shim"*) echo 'cn_model_dispatch_barred minimax restricted_operator_private_workdir' >&2; exit 2 ;;
    *"--runner kimi"*) echo 'cn_model_dispatch_barred moonshot restricted_operator_unknown_endpoint' >&2; exit 2 ;;
    reject-all*"--runner codex"*) echo 'cn_model_dispatch_barred codex restricted_operator_unknown_endpoint' >&2; exit 2 ;;
  esac
fi
exec "$SHED_TEST_REAL_NODE" "$@"
EOF_NODE
chmod +x "$TEST_TMP/bin/node"
cat > "$TEST_TMP/bin/bash" <<'EOF_BASH'
#!/usr/bin/bash
case "${1:-}" in
  */resolve-endpoint.sh) exit 0 ;;
esac
exec "$SHED_TEST_REAL_BASH" "$@"
EOF_BASH
chmod +x "$TEST_TMP/bin/bash"
cat > "$TEST_TMP/bin/grok" <<'EOF_GROK'
#!/usr/bin/bash
printf 'normal route fixture\n' > normal-result.txt
git add normal-result.txt
git -c user.email=t@t -c user.name=t commit -q -m 'stub normal route'
EOF_GROK
chmod +x "$TEST_TMP/bin/grok"
export SHED_TEST_REAL_NODE="$REAL_NODE" SHED_TEST_REAL_BASH="/usr/bin/bash"
cat > "$TEST_TMP/burn-more.json" <<EOF_JSON
{"schema":"capacity.burn_more/1","run_id":"bm-hook-fixture","generated_at":"$NOW","shed":{"pools":[{"pool":"fixture-pool","seats":["capacity--claude"]}],"rules":{"mechanical_classes":["文件"],"targets_in_order":["minimax","kimi","codex"],"keep_on_origin":[],"prefer":"from scratch"}}}
EOF_JSON
rm -f "$AUTOPILOT_DISPATCH_RUNS_DIR"/*
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" SHED_TEST_GATE=reject-restricted "$SCRIPT" --no-verify-tip --context-window off --codex-bin "$TEST_TMP/bin/codex" --grok-bin "$TEST_TMP/bin/grok" --branch feat/shed-skip --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/skip.err")"
EXIT=$?
assert_eq 0 "$EXIT" 'refused shed targets fall through to codex'
JSON="$(printf '%s\n' "$OUT" | "$REAL_NODE" -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const o=s.trim().split(/\r?\n/).filter(x=>x.startsWith("{")).map(JSON.parse).pop();process.stdout.write(JSON.stringify(o||{}))})')"
"$REAL_NODE" -e 'const o=JSON.parse(process.argv[1]),s=o.shed?.skipped_targets||[]; if(o.runner!=="codex"||s.length!==2||!s[0].reason.includes("restricted_operator_private_workdir")||!s[1].reason.includes("restricted_operator_unknown_endpoint")) process.exit(1)' "$JSON" || fail 'status records skipped targets and reasons, then selects codex'

sed -i 's/"targets_in_order":\["minimax","kimi","codex"\]/"targets_in_order":["minimax","kimi"]/' "$TEST_TMP/burn-more.json"
rm -f "$AUTOPILOT_DISPATCH_RUNS_DIR"/*
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" SHED_TEST_GATE=reject-restricted "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$TEST_TMP/bin/grok" --branch feat/shed-all-refused --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/all-refused.err")"
EXIT=$?
assert_eq 0 "$EXIT" 'all refused shed targets preserve ordinary routing'
JSON="$(printf '%s\n' "$OUT" | "$REAL_NODE" -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const o=s.trim().split(/\r?\n/).filter(x=>x.startsWith("{")).map(JSON.parse).pop();process.stdout.write(JSON.stringify(o||{}))})')"
"$REAL_NODE" -e 'const o=JSON.parse(process.argv[1]); if(o.runner!=="grok"||o.shed?.reason!=="no_eligible_target") process.exit(1)' "$JSON" || fail 'all-refused status reports normal route and no_eligible_target'
MF="$(node -e 'const fs=require("fs"),p=process.argv[1]; const f=fs.readdirSync(p).find(x=>x.endsWith(".manifest.json")); process.stdout.write(f?`${p}/${f}`:"")' "$AUTOPILOT_DISPATCH_RUNS_DIR")"
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(o.shed!==null) process.exit(1)' "$MF" || fail 'all-refused manifest records shed null'

sed -i 's/"targets_in_order":\["minimax","kimi"\]/"targets_in_order":["minimax","kimi","codex"]/' "$TEST_TMP/burn-more.json"
rm -f "$AUTOPILOT_DISPATCH_RUNS_DIR"/*
OUT="$(cd "$SBX" && timeout 60 env PATH="$TEST_TMP/bin:$PATH" SHED_TEST_GATE=reject-all "$SCRIPT" --no-verify-tip --context-window off --codex-bin "$TEST_TMP/bin/codex" --grok-bin "$TEST_TMP/bin/grok" --branch feat/shed-codex-refused --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/codex-refused.err")"
EXIT=$?
assert_eq 0 "$EXIT" 'refused codex shed target terminates within 60 seconds'
JSON="$(printf '%s\n' "$OUT" | "$REAL_NODE" -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const o=s.trim().split(/\r?\n/).filter(x=>x.startsWith("{")).map(JSON.parse).pop();process.stdout.write(JSON.stringify(o||{}))})')"
"$REAL_NODE" -e 'const o=JSON.parse(process.argv[1]); if(o.runner!=="grok") process.exit(1)' "$JSON" || fail 'refused codex status falls back to normal routing'
MF="$(node -e 'const fs=require("fs"),p=process.argv[1]; const f=fs.readdirSync(p).find(x=>x.endsWith(".manifest.json")); process.stdout.write(f?`${p}/${f}`:"")' "$AUTOPILOT_DISPATCH_RUNS_DIR")"
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(o.shed!==null) process.exit(1)' "$MF" || fail 'refused codex manifest records shed null'
if ! node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!s.includes("shed route pre-check exceeded target limit; falling back to normal routing")) process.exit(1)' "$TEST_TMP/codex-refused.err"; then fail 'refused codex emits iteration-limit warning'; fi

rm -f "$AUTOPILOT_DISPATCH_RUNS_DIR"/*
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_SHED_ROUTE=0 "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$TEST_TMP/bin/grok" --branch feat/shed-off --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/off.err")"
EXIT=$?
assert_eq 0 "$EXIT" 'disabled shedding preserves ordinary routing'
MF="$(node -e 'const fs=require("fs"),p=process.argv[1]; const f=fs.readdirSync(p).find(x=>x.endsWith(".manifest.json")); process.stdout.write(f?`${p}/${f}`:"" )' "$AUTOPILOT_DISPATCH_RUNS_DIR")"
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(o.shed!==null) process.exit(1)' "$MF" || fail 'not-applied manifest records shed null'
unset SHED_TEST_REAL_NODE SHED_TEST_REAL_BASH
finalize_test
