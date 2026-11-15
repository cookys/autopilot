#!/usr/bin/env bash
# hooks/fleet-stop.js (opt-in Stop wrapper around `fleet hook stop`) and the dev-setup fleet_stop_hook state line.
# A fake `fleet` on PATH only; the real fleet is never called; HOME and config live in TEST_TMP.
. "$(dirname "$0")/lib.sh"

HOOK="$REPO_ROOT/hooks/fleet-stop.js"
SCRIPT="$REPO_ROOT/scripts/dev-setup.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_CONFIG_FILE AUTOPILOT_HOOK_FLEET_STOP
NODE_BIN="$TEST_TMP/node-bin"; mkdir -p "$NODE_BIN"; ln -s "$(command -v node)" "$NODE_BIN/node"
NOFLEET_PATH="$NODE_BIN:/usr/bin:/bin"
SHIM="$TEST_TMP/shim"; mkdir -p "$SHIM"
MARK="$TEST_TMP/fleet.marker"; STDIN_COPY="$TEST_TMP/fleet.stdin"; ARGV="$TEST_TMP/fleet.argv"
cat > "$SHIM/fleet" <<SHIMEOF
#!/usr/bin/env bash
echo called > "$MARK"
printf '%s\n' "\$@" > "$ARGV"
cat > "$STDIN_COPY"
if [ -f "$TEST_TMP/shim-exit2" ]; then echo "fleet says no" >&2; echo '{"decision":"block","reason":"task open"}'; exit 2; fi
echo '{"ok":true}'
exit 0
SHIMEOF
chmod +x "$SHIM/fleet"
FLEET_PATH="$SHIM:$NOFLEET_PATH"
PAYLOAD='{"session_id":"s1","transcript_path":"/x/y.jsonl","stop_hook_active":false}'
set_knob() { mkdir -p "$HOME/.autopilot"; printf '{"hooks":{"fleet-stop":%s}}' "$1" > "$HOME/.autopilot/config.json"; }
run_wrap() { # <path>
  __OUT="$(printf '%s' "$PAYLOAD" | PATH="$1" node "$HOOK" 2>"$TEST_TMP/wrap.err")"; __RC=$?
}

# 1. knob off: exit 0, fleet never called
rm -f "$MARK"; run_wrap "$FLEET_PATH"
assert_eq "0" "$__RC" "knob off: exit 0"
assert_file_absent "$MARK" "knob off: fleet never called"

# 2. knob on, no fleet on PATH: exit 0
set_knob true; rm -f "$MARK"; run_wrap "$NOFLEET_PATH"
assert_eq "0" "$__RC" "knob on, fleet missing: exit 0"

# 3. knob on: fleet hook stop gets the stdin byte-identical, stdout passes through
run_wrap "$FLEET_PATH"
assert_eq "0" "$__RC" "knob on: exit 0 from fleet"
assert_eq '{"ok":true}' "$__OUT" "knob on: fleet stdout passed through"
assert_eq "$(printf 'hook\nstop')" "$(cat "$ARGV")" "knob on: argv is exactly hook stop"
printf '%s' "$PAYLOAD" | cmp -s - "$STDIN_COPY" && R=same || R=different
assert_eq "same" "$R" "knob on: fleet stdin byte-identical to the Stop payload"

# 4. fleet exits 2 with stderr: passthrough
touch "$TEST_TMP/shim-exit2"; run_wrap "$FLEET_PATH"
assert_eq "2" "$__RC" "fleet exit 2 passed through"
assert_contains "$(cat "$TEST_TMP/wrap.err")" "fleet says no" "fleet stderr passed through"
assert_contains "$__OUT" '"decision":"block"' "fleet block decision passed through on stdout"
rm -f "$TEST_TMP/shim-exit2"

# 5. env knob also enables; env 0 beats config
rm -f "$HOME/.autopilot/config.json"; rm -f "$MARK"
__OUT="$(printf '%s' "$PAYLOAD" | AUTOPILOT_HOOK_FLEET_STOP=1 PATH="$FLEET_PATH" node "$HOOK" 2>/dev/null)"
assert_file_exists "$MARK" "env AUTOPILOT_HOOK_FLEET_STOP=1 enables the wrapper"

# 6. dev-setup --check: fleet host + knob off -> FAIL line and non-zero; fleet missing -> fleet_missing, exit 0
rm -f "$HOME/.autopilot/config.json"
OUT="$(PATH="$FLEET_PATH" bash "$SCRIPT" --check 2>&1)"; RC=$?
assert_contains "$OUT" "fleet_stop_hook: off" "check, knob off on a fleet host: state line off"
assert_neq "0" "$RC" "check, knob off on a fleet host: non-zero"
OUT="$(PATH="$NOFLEET_PATH" bash "$SCRIPT" --check 2>&1)"; RC=$?
assert_contains "$OUT" "fleet_stop_hook: fleet_missing" "check without fleet: fleet_missing"
assert_eq "0" "$RC" "check without fleet: exit 0"

# 7. enable (default claude setup path) turns the knob on; a second check says on and exits 0
set_knob false
OUT="$(PATH="$FLEET_PATH" bash "$SCRIPT" --enable-fleet-stop 2>&1)"; RC=$?
assert_eq "0" "$RC" "--enable-fleet-stop exits 0"
assert_contains "$OUT" "fleet_stop_hook: on" "enable prints the new state"
OUT="$(PATH="$FLEET_PATH" bash "$SCRIPT" --check 2>&1)"; RC=$?
assert_contains "$OUT" "fleet_stop_hook: on" "check after enable: on"
assert_eq "0" "$RC" "check after enable: exit 0"
set_knob true
node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(c.hooks["fleet-stop"]===true?0:1)' "$HOME/.autopilot/config.json"
assert_eq "0" "$?" "config file holds hooks.fleet-stop=true"
# no fleet: enable is a no-op that leaves other keys alone
printf '{"x":1}' > "$HOME/.autopilot/config.json"
PATH="$NOFLEET_PATH" bash "$SCRIPT" --enable-fleet-stop >/dev/null 2>&1
assert_eq '{"x":1}' "$(cat "$HOME/.autopilot/config.json")" "enable without fleet leaves config untouched"

finalize_test
