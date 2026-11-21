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
finalize_test
