#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
install_cli_sentinels
unset AUTOPILOT_UPSTREAM_TASK_ID AUTOPILOT_LEVEL; export AUTOPILOT_FLEET_TASK=01M8F07CXPHRPDVC4JMFJDB8GM
export AUTOPILOT_DISPATCH_USAGE=off AUTOPILOT_ENDPOINT_PREPROBE=off DISPATCH_DETACH=0 DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session" ENGINE_CAPABILITY_DIR="$TEST_TMP/cap" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
export AUTOPILOT_PACE_FILE="$REPO_ROOT/scripts/fixtures/pace-select/scarce-codex.json" AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing"
mkdir -p "$TEST_TMP/repo" "$AUTOPILOT_SESSION_MODE_DIR" "$ENGINE_CAPABILITY_DIR" "$AUTOPILOT_DISPATCH_RUNS_DIR"
git -C "$TEST_TMP/repo" init -q -b develop
git -C "$TEST_TMP/repo" -c user.name=test -c user.email=test@example.test commit -q --allow-empty -m base
printf 'fixture\n' > "$TEST_TMP/prompt"
cat > "$TEST_TMP/codex" <<'STUB'
#!/usr/bin/env bash
case " $* " in *" exec --help "*) printf '%s\n' '--dangerously-bypass-hook-trust'; exit 0 ;; esac
printf 'fixture\n' > fixture.txt
exit 0
STUB
chmod +x "$TEST_TMP/codex"
# the pool may route to grok (scarce-codex pace fixture); give it an explicit stub so PATH's sentinel is never hit
printf '#!/usr/bin/env bash\ncase " $* " in *PONG*) echo PONG; exit 0 ;; esac\nprintf "fixture\\n" > fixture.txt\nexit 0\n' > "$TEST_TMP/grok-stub"; chmod +x "$TEST_TMP/grok-stub"
# pace-select's live grok probe must hit the stub and a sandbox cache, never PATH's grok or the real $HOME probe record
export AUTOPILOT_GROK_PROBE_BIN="$TEST_TMP/grok-stub" AUTOPILOT_GROK_PROBE_FILE="$TEST_TMP/grok-probe.json"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
warning='dispatch-hetero: warning: --runner/--model hard pin without --pin-reason (the pool should choose; say why you pinned)'
run_case() {
  local name="$1"; shift
  (cd "$TEST_TMP/repo" && "$SCRIPT" --no-verify-tip --context-window off --codex-bin "$TEST_TMP/codex" --grok-bin "$TEST_TMP/grok-stub" --run-id "$name" --branch "feat/$name" --prompt-file "$TEST_TMP/prompt" "$@") >"$TEST_TMP/$name.out" 2>"$TEST_TMP/$name.err"
  CASE_RC=$?
  [ "$CASE_RC" -eq 0 ] || [ "$name" = invalid ] || cat "$TEST_TMP/$name.out" "$TEST_TMP/$name.err" >&2
}
manifest_check() {
  node -e 'const m=require(process.argv[1]); if(m.pinned !== (process.argv[2]==="true") || m.pin_reason !== (process.argv[3]==="NULL" ? null : process.argv[3])) process.exit(1)' "$AUTOPILOT_DISPATCH_RUNS_DIR/$1.manifest.json" "$2" "$3"
  assert_eq 0 "$?" "$1 manifest pin fields"
}
run_case reason --runner codex --pin-reason 'specific "reason"'
assert_eq 0 "$CASE_RC" 'pinned with reason exits 0'
manifest_check reason true 'specific "reason"'
assert_not_contains "$(cat "$TEST_TMP/reason.err")" "$warning" 'reason suppresses warning'
run_case missing --runner codex
assert_eq 0 "$CASE_RC" 'pinned without reason exits 0'
manifest_check missing true NULL
assert_contains "$(cat "$TEST_TMP/missing.err")" "$warning" 'missing reason warns'
run_case pool --pace-role implementer
assert_eq 0 "$CASE_RC" 'pool dispatch exits 0'
manifest_check pool false NULL
assert_not_contains "$(cat "$TEST_TMP/pool.err")" "$warning" 'pool does not warn'
run_case pool_reason --pace-role implementer --pin-reason 'unused reason'
assert_eq 0 "$CASE_RC" 'pool with reason exits 0'
manifest_check pool_reason false NULL
AUTOPILOT_HETERO_FELL_BACK=1 AUTOPILOT_HETERO_PIN_ORIGIN=false run_case retry --runner codex
assert_eq 0 "$CASE_RC" 'internal retry exits 0'
manifest_check retry false NULL
assert_not_contains "$(cat "$TEST_TMP/retry.err")" "$warning" 'internal retry does not warn'
for value in '' "$(printf '%201s' | tr ' ' x)" $'two\nlines'; do
  run_case invalid --runner codex --pin-reason "$value"
  assert_eq 2 "$CASE_RC" 'invalid reason exits 2'
  assert_contains "$(cat "$TEST_TMP/invalid.out")" '--pin-reason requires 1..200 characters on one line' 'invalid reason explains error'
  assert_file_absent "$AUTOPILOT_DISPATCH_RUNS_DIR/invalid.manifest.json" 'invalid reason starts no dispatch'
done
printf '{"run_id":"old","runner":"codex","ended_at":"2020-01-01T00:00:00Z"}\n' > "$AUTOPILOT_DISPATCH_RUNS_DIR/old.manifest.json"
node "$REPO_ROOT/scripts/dispatch-status.js" --run old --dir "$AUTOPILOT_DISPATCH_RUNS_DIR" >"$TEST_TMP/status.out" 2>"$TEST_TMP/status.err"
assert_eq 0 "$?" 'old manifest status reads successfully'
assert_contains "$(cat "$TEST_TMP/status.out")" 'old' 'old manifest status retains identity'
finalize_test
