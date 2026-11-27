#!/usr/bin/env bash
# dispatch-hetero.sh disk guard: a nearly full disk is a precondition failure (exit 2, "nothing was
# created") before any worktree, branch or record; a healthy disk dispatches as before.
. "$(dirname "$0")/lib.sh"

install_cli_sentinels
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'S backlog fix: correct the status string typo in the backlog note.\n' > "$PROMPT"
RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1
EMPTY_SESSION="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION"
export AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION"
RAN="$TEST_TMP/runner-ran"
AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOF'
#!/usr/bin/env bash
RESPONSE="${1:-self-report: DONE}" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: process.env.RESPONSE,
    status: "SUCCESS",
    usage: { cache_read_tokens: 7, input_tokens: 101, output_tokens: 23, thinking_tokens: 11, total_tokens: 142 },
  }));
'
EOF
chmod +x "$AGY_FIXTURE_HELPER"
export AGY_FIXTURE_HELPER

STUB="$TEST_TMP/agy-ok"
cat > "$STUB" <<EOF
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: backlog S fix"
touch "$RAN"
"\$AGY_FIXTURE_HELPER" "self-report: DONE"
exit 0
EOF
chmod +x "$STUB"
make_agy_stub_versioned "$STUB"

# enforcement_mode may be shadow or enforce when the section is present.
# Mode off is the projection with no mission_convergence section.
set_mode() {
  mkdir -p "$SBX/.claude"
  if [ "$1" = "off" ]; then
    node - "$REPO_ROOT/.claude/owner-kernel-governance.json" "$SBX/.claude/owner-kernel-governance.json" <<'NODE'
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
delete value.mission_convergence;
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE
  else
    write_mission_governance "$SBX/.claude/owner-kernel-governance.json" "$1"
  fi
}

status_line() {
  printf '%s\n' "$1" | grep '^{ "status"' | tail -1
}

run_dispatch() {
  rm -f "$RAN"
  (cd "$SBX" && "$SCRIPT" --no-verify-tip --prompt-file "$PROMPT" --agy-bin "$STUB" --runner agy --pin-reason "test fixture" "$@")
}

set_mode shadow
printf '{"free_pct":1}\n' > "$TEST_TMP/dg-statfs.json"
WT_BEFORE="$(git -C "$SBX" worktree list --porcelain | grep -c '^worktree ')"
OUT="$(AUTOPILOT_DISK_GUARD_FAKE_STATFS="$TEST_TMP/dg-statfs.json" run_dispatch --branch feat/dg-low --no-campaign)"; RC=$?
assert_eq "2" "$RC" "low free space exits 2"
assert_contains "$(status_line "$OUT")" '"status": "precondition_failed"' "precondition_failed"
assert_contains "$OUT" "disk-guard: refused" "reason names the guard"
assert_file_absent "$RAN" "runner was not started"
assert_eq "$(git -C "$SBX" worktree list --porcelain | grep -c '^worktree ')" "$WT_BEFORE" "no worktree created"
assert_eq "$(git -C "$SBX" branch --list 'feat/dg-low' | wc -l | tr -d ' ')" "0" "no branch created"

printf '{"free_pct":80}\n' > "$TEST_TMP/dg-statfs.json"
OUT="$(AUTOPILOT_DISK_GUARD_FAKE_STATFS="$TEST_TMP/dg-statfs.json" run_dispatch --branch feat/dg-ok --no-campaign)"; RC=$?
assert_eq "0" "$RC" "healthy disk dispatches: $OUT"
assert_file_exists "$RAN" "runner ran"

finalize_test
