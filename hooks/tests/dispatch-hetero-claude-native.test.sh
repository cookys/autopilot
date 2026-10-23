#!/usr/bin/env bash
# dispatch-hetero --runner claude-native: first-party Claude implementer behind a ONE-TIME owner
# confirmation. Only the `claude` binary is stubbed; the real dispatch-hetero.sh and run-approval.js run.
#   (a) no confirmation  -> exit 2 precondition_failed, stub never invoked (negative control)
#   (b) confirmed        -> stub gets --model + --effort low; commit on the hands branch; manifest records runner
#   (c) child config dir -> only .credentials.json, modes 0700/0600, removed at the end; missing source creds -> exit 2
#   (d) a --yes-style flag on the command line does not bypass the gate
# HETERO_SCRIPT overrides the script under test (used to show the suite RED against the unmodified script).
. "$(dirname "$0")/lib.sh"
SCRIPT="${HETERO_SCRIPT:-$REPO_ROOT/scripts/dispatch-hetero.sh}"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"

# Operator's REAL claude config (fake): credentials plus things the child must never see.
REAL_CLAUDE="$TEST_TMP/real-claude"
mkdir -p "$REAL_CLAUDE/projects/p1"
printf '{"claudeAiOauth":{"accessToken":"stub"}}\n' > "$REAL_CLAUDE/.credentials.json"
printf '{"hooks":{}}\n' > "$REAL_CLAUDE/settings.json"
export CLAUDE_CONFIG_DIR="$REAL_CLAUDE"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"   # canonical config <HOME>/.autopilot/config.json; absent = no owner confirmation
unset AUTOPILOT_CONFIG_FILE
CANON_CFG="$HOME/.autopilot/config.json"

ARGV_LOG="$TEST_TMP/claude-argv.log"
SEEN_LOG="$TEST_TMP/claude-seen.log"
BIN_DIR="$TEST_TMP/bin"; mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/claude" <<__EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$ARGV_LOG"
cat >/dev/null
{
  echo "CFG=\$CLAUDE_CONFIG_DIR"
  echo "DIRMODE=\$(stat -c %a "\$CLAUDE_CONFIG_DIR")"
  for f in "\$CLAUDE_CONFIG_DIR"/* "\$CLAUDE_CONFIG_DIR"/.[!.]*; do
    [ -e "\$f" ] && echo "ENTRY=\$(basename "\$f") MODE=\$(stat -c %a "\$f")"
  done
} > "$SEEN_LOG"
echo cn-edited > cn_out.txt
printf '{"type":"result","is_error":false,"result":"done"}\n'
__EOF
chmod +x "$BIN_DIR/claude"
export PATH="$BIN_DIR:$PATH"

run() { (cd "$SBX" && "$SCRIPT" --runner claude-native --model claude-sonnet-4-6 --effort low --prompt-file "$PROMPT" --context-window off "$@" 2>&1); }

# (a) no confirmation -> refused, stub never ran
OUT="$(run --branch feat/cn-noconf)"; RC=$?
assert_eq "2" "$RC" "(a) unconfirmed claude-native exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "(a) status precondition_failed"
assert_contains "$OUT" 'owner' "(a) message tells depth 0 to ask the owner"
assert_file_absent "$ARGV_LOG" "(a) negative control: stub claude never invoked"
assert_eq "" "$(git -C "$SBX" branch --list feat/cn-noconf)" "(a) no branch created"

# (d) --yes-style flags do not bypass the gate
for flag in --yes -y --confirm-claude-native --owner-confirmed; do
  OUT="$(run --branch feat/cn-yes "$flag")"; RC=$?
  assert_eq "2" "$RC" "(d) $flag does not bypass the gate (exit 2)"
  assert_file_absent "$ARGV_LOG" "(d) $flag: stub never invoked"
done
OUT="$(run --branch feat/cn-yes2 --yes)"
assert_not_contains "$OUT" '"status": "committed"' "(d) --yes never yields a committed run"

# Owner confirmation through the CLI depth 0 runs after the owner says yes
node "$REPO_ROOT/scripts/run-approval.js" claude-native-status >/dev/null 2>&1
assert_eq "1" "$?" "status is unconfirmed before confirm"
node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null
assert_eq "0" "$?" "confirm-claude-native succeeds"
assert_contains "$(cat "$CANON_CFG")" 'confirmed_at' "confirmation persisted in config"

# Reject confirmations that are not strict, real, non-future ISO 8601 date-times (real dispatch path)
cp "$CANON_CFG" "$TEST_TMP/good-cfg.json"
i=0
for bad in '"1"' '"2026-02-30T00:00:00Z"' '""' '12345' 'null' '"2999-01-01T00:00:00Z"' '"2026-01-01"'; do
  i=$((i+1))
  printf '{"implementer_claude_native":{"confirmed_at":%s}}\n' "$bad" > "$CANON_CFG"
  OUT="$(run --branch "feat/cn-bad$i")"; RC=$?
  assert_eq "2" "$RC" "invalid confirmed_at $bad exits 2"
  assert_file_absent "$ARGV_LOG" "invalid confirmed_at $bad: stub never invoked"
done
cp "$TEST_TMP/good-cfg.json" "$CANON_CFG"

# (e) hand-written confirmation referenced via AUTOPILOT_CONFIG_FILE must NOT count
mv "$CANON_CFG" "$CANON_CFG.off"
printf '{"implementer_claude_native":{"confirmed_at":"2026-01-01T00:00:00Z"}}\n' > "$TEST_TMP/forged.json"
OUT="$(AUTOPILOT_CONFIG_FILE="$TEST_TMP/forged.json" run --branch feat/cn-forged)"; RC=$?
assert_eq "2" "$RC" "(e) env-pointed forged confirmation exits 2"
assert_file_absent "$ARGV_LOG" "(e) forged confirmation: stub never invoked"
assert_eq "" "$(git -C "$SBX" branch --list feat/cn-forged)" "(e) no branch created"
assert_eq "1" "$(git -C "$SBX" worktree list | wc -l)" "(e) no worktree created"
mv "$CANON_CFG.off" "$CANON_CFG"

# (c-neg) confirmed but source credentials missing -> refuse exit 2, stub never invoked
mv "$REAL_CLAUDE/.credentials.json" "$REAL_CLAUDE/.credentials.json.off"
OUT="$(run --branch feat/cn-nocreds)"; RC=$?
assert_eq "2" "$RC" "(c) missing source credentials exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "(c) missing credentials is precondition_failed"
assert_file_absent "$ARGV_LOG" "(c) missing credentials: stub never invoked"
mv "$REAL_CLAUDE/.credentials.json.off" "$REAL_CLAUDE/.credentials.json"

# (b) confirmed -> runs
OUT="$(run --branch feat/cn-ok)"; RC=$?
assert_eq "0" "$RC" "(b) confirmed claude-native exits 0"
assert_contains "$OUT" '"status": "committed"' "(b) committed"
assert_contains "$OUT" '"runner": "claude-native"' "(b) runner claude-native in result JSON"
ARGV="$(cat "$ARGV_LOG")"
assert_contains "$ARGV" '--model claude-sonnet-4-6' "(b) stub got the model"
assert_contains "$ARGV" '--effort low' "(b) stub got --effort low"
assert_eq "base" "$(git -C "$SBX" log -1 --format=%s)" "(b) caller HEAD untouched"
assert_eq "cn-edited" "$(git -C "$SBX" show feat/cn-ok:cn_out.txt)" "(b) edit committed on the hands branch"
OUT_JSON="$(printf '%s\n' "$OUT" | grep '^{ "status"' | tail -1)"
RUN_ID="$(printf '%s' "$OUT_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
assert_file_exists "$RUNS_DIR/$RUN_ID.manifest.json" "(b) manifest (ledger record) written"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"runner": "claude-native"' "(b) ledger records runner"

# (c) child config dir: only .credentials.json, 0700/0600, removed afterwards
SEEN="$(cat "$SEEN_LOG")"
assert_contains "$SEEN" 'DIRMODE=700' "(c) config dir mode 0700"
assert_contains "$SEEN" 'ENTRY=.credentials.json MODE=600' "(c) credentials copy mode 0600"
assert_eq "1" "$(printf '%s\n' "$SEEN" | grep -c '^ENTRY=')" "(c) exactly one entry in the child config dir"
assert_not_contains "$SEEN" 'settings.json' "(c) no settings.json"
assert_not_contains "$SEEN" 'projects' "(c) no projects/"
CFG="$(printf '%s\n' "$SEEN" | sed -n 's/^CFG=//p')"
assert_neq "$REAL_CLAUDE" "$CFG" "(c) child config dir is not the real one"
[ ! -e "$CFG" ] && assert_eq "gone" "gone" "(c) seeded config dir removed after dispatch" || assert_eq "gone" "present" "(c) seeded config dir removed after dispatch"
assert_eq "0" "$(find "$TMPDIR" -maxdepth 1 -name 'claude-config-*' | wc -l)" "(c) no leftover claude-config-* temp dirs"

finalize_test
