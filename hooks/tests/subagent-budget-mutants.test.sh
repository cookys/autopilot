#!/usr/bin/env bash
# Mutant oracle for the subagent-budget concurrency advisory (P2).
#
# The hook reads AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT (a row name) only when
# AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_MUTANT is exactly 1. Otherwise the mutant
# name is ignored and the reader stays on the production walk. Neither variable
# is a user config knob (they are internal test seams, same gate shape as
# AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK). The hook passes the row name as
# opts.mutant into scanRunningAdvisory; workflow-snapshot honours that option
# only when it is set, and the production walk is unchanged when it is absent.
#
# Each table row must FAIL under its mutant with the marker "ASSERT <row>" in
# the output, then PASS with the mutant unset. reader_throw_fail_open must PASS
# under mutant name reader_throw. resume_mtime_after_ended_counts_running is
# SKIPPED because evidence note 03 records that SubagentStart fired on resume.
. "$(dirname "$0")/lib.sh"

FIX="$HOOKS_DIR/tests/lib/subagent-budget-fixture.js"
NOW=1790000000000
export AUTOPILOT_SUBAGENT_BUDGET_NOW_MS=$NOW
export AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK=1
unset AUTOPILOT_SUBAGENT_BUDGET_MODE AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX \
  AUTOPILOT_SUBAGENT_BUDGET_LANE_TURNS_MAX AUTOPILOT_SUBAGENT_BUDGET_ROOT_TURNS_PER_HOUR_MAX \
  AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX AUTOPILOT_AGENT_ACTIVITY \
  AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_MUTANT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
REPO="$TEST_TMP/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q 2>/dev/null
PROJ="$TEST_TMP/claude/projects/p"; mkdir -p "$PROJ"
HOOK=subagent-budget.js
ADV_MARK='appear running'
STALE_MS=$((31 * 60 * 1000))

mk() { node "$FIX" "$PROJ" "$1" "$NOW" "$2"; }
payload() {
  node -e '
    const [sid, prompt] = process.argv.slice(1);
    console.log(JSON.stringify({
      tool_name: "Agent", session_id: sid, cwd: process.argv[4],
      transcript_path: process.argv[3] + "/" + sid + ".jsonl",
      tool_input: { prompt: prompt, model: "sonnet" },
    }));
  ' "$1" "$2" "$PROJ" "$REPO"
}
fire() { run_hook "$HOOK" "$(payload "$1" "Task: x")"; }

write_rows() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { sanitizeSessionId } = require(process.argv[1]);
    const dir = path.join(process.argv[2], "agents", sanitizeSessionId(process.argv[3]));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const rows = JSON.parse(process.argv[4]);
    for (const r of rows) {
      const file = path.join(dir, r.file);
      fs.writeFileSync(file, r.text);
      if (r.mtimeMs != null) { const d = new Date(Number(r.mtimeMs)); fs.utimesSync(file, d, d); }
    }
  ' "$REPO_ROOT/scripts/lib/live-state-dir.js" "$AUTOPILOT_LIVE_DIR" "$1" "$2"
}

iso_at() { node -e 'process.stdout.write(new Date(Number(process.argv[1])).toISOString())' "$1"; }
FRESH="$(iso_at "$NOW")"
OLD="$(iso_at $((NOW - STALE_MS)))"

# Three fresh running stamps.
fresh_running() {
  local sid="$1" n="${2:-3}"
  node -e '
    const n = +process.argv[1], iso = process.argv[2];
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ file: "run-" + i + ".json", text: JSON.stringify({ agent_id: "run-" + i, last_tool_at: iso }) + "\n" });
    process.stdout.write(JSON.stringify(rows));
  ' "$n" "$FRESH" | { read -r json; write_rows "$sid" "$json"; }
}

prepare() {
  local sid="$1"
  mk "$sid" '[]'
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { sanitizeSessionId } = require(process.argv[1]);
    fs.rmSync(path.join(process.argv[2], "agents", sanitizeSessionId(process.argv[3])), { recursive: true, force: true });
  ' "$REPO_ROOT/scripts/lib/live-state-dir.js" "$AUTOPILOT_LIVE_DIR" "$sid"
}

bad() { echo "ASSERT $1"; return 1; }

# Expect no concurrency advisory and no deny. Baseline is this same session before stamps, captured by the caller.
expect_silent_advisory() {
  local row="$1"
  fire "$2"
  if [ "$__RUN_EXIT" != 0 ]; then bad "$row"; return; fi
  case "$__RUN_STDOUT" in
    *'"permissionDecision":"deny"'*) bad "$row"; return ;;
  esac
  case "$__RUN_STDOUT" in
    *"$ADV_MARK"*) bad "$row"; return ;;
  esac
  [ "$__RUN_STDOUT" = "$3" ] || bad "$row"
}

scenario_parked_ended_not_running() {
  local sid="m-parked" base
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  local ended
  ended="$(iso_at "$NOW")"
  node -e '
    const iso = process.argv[1];
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push({ file: "end-" + i + ".json", text: JSON.stringify({ agent_id: "end-" + i, ended_at: iso, last_tool_at: iso }) + "\n" });
    process.stdout.write(JSON.stringify(rows));
  ' "$ended" | { read -r json; write_rows "$sid" "$json"; }
  expect_silent_advisory parked_ended_not_running "$sid" "$base"
}

scenario_resume_restart_counts_running() {
  local sid="m-resume"
  prepare "$sid"
  fresh_running "$sid" 3
  fire "$sid"
  local want='3 subagents appear running (advisory threshold 3; token-discipline: keep lightweight subagents at most 3 at a time)'
  case "$__RUN_STDOUT" in
    *"$want"*) ;;
    *) bad resume_restart_counts_running; return ;;
  esac
  case "$__RUN_STDOUT" in
    *'"permissionDecision":"deny"'*) bad resume_restart_counts_running; return ;;
  esac
  [ "$__RUN_EXIT" = 0 ] || bad resume_restart_counts_running
}

scenario_crash_stale_not_running() {
  local sid="m-crash" base
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  node -e '
    const iso = process.argv[1];
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push({ file: "crash-" + i + ".json", text: JSON.stringify({ agent_id: "crash-" + i, last_tool_at: iso }) + "\n" });
    process.stdout.write(JSON.stringify(rows));
  ' "$OLD" | { read -r json; write_rows "$sid" "$json"; }
  expect_silent_advisory crash_stale_not_running "$sid" "$base"
}

scenario_quota_silent_ages_out() {
  local sid="m-quota" base older
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  older="$(iso_at $((NOW - 2 * 60 * 60 * 1000)))"
  node -e '
    const iso = process.argv[1];
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push({ file: "quota-" + i + ".json", text: JSON.stringify({ agent_id: "quota-" + i, last_tool_at: iso, note: "quota-silent" }) + "\n" });
    process.stdout.write(JSON.stringify(rows));
  ' "$older" | { read -r json; write_rows "$sid" "$json"; }
  expect_silent_advisory quota_silent_ages_out "$sid" "$base"
}

scenario_unparseable_not_counted() {
  local sid="m-bad" base
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  write_rows "$sid" '[{"file":"a.json","text":"{"},{"file":"b.json","text":"{"},{"file":"c.json","text":"not-json"}]'
  expect_silent_advisory unparseable_not_counted "$sid" "$base"
}

scenario_compaction_no_double_count() {
  local sid="m-compact"
  prepare "$sid"
  node -e '
    const iso = process.argv[1];
    const text = JSON.stringify({ agent_id: "same", last_tool_at: iso }) + "\n";
    process.stdout.write(JSON.stringify([{ file: "a.json", text: text }, { file: "b.json", text: text }]));
  ' "$FRESH" | { read -r json; write_rows "$sid" "$json"; }
  AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX=2 fire "$sid"
  local first="$__RUN_STDOUT" e1="$__RUN_EXIT"
  AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX=2 fire "$sid"
  unset AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX
  if [ "$e1" != 0 ] || [ "$__RUN_EXIT" != 0 ]; then bad compaction_no_double_count; return; fi
  case "$first$__RUN_STDOUT" in
    *"$ADV_MARK"*|*'permissionDecision":"deny'*) bad compaction_no_double_count ;;
  esac
}

scenario_knob_zero_silent() {
  local sid="m-zero" base
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  fresh_running "$sid" 3
  AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX=0 fire "$sid"
  unset AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX
  expect_match_base knob_zero_silent "$base"
}

expect_match_base() {
  local row="$1" base="$2"
  if [ "$__RUN_EXIT" != 0 ]; then bad "$row"; return; fi
  case "$__RUN_STDOUT" in
    *'"permissionDecision":"deny"'*) bad "$row"; return ;;
  esac
  [ "$__RUN_STDOUT" = "$base" ] || bad "$row"
}

scenario_activity_off_silent() {
  local sid="m-off" base
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  fresh_running "$sid" 3
  AUTOPILOT_AGENT_ACTIVITY=off fire "$sid"
  unset AUTOPILOT_AGENT_ACTIVITY
  expect_match_base activity_off_silent "$base"
}

scenario_older_running_stamp_included() {
  local sid="m-older"
  prepare "$sid"
  node -e '
    const now = Number(process.argv[1]);
    const iso = new Date(now).toISOString();
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ file: "ended-" + String(i).padStart(2, "0") + ".json", mtimeMs: now - i * 1000,
        text: JSON.stringify({ agent_id: "ended-" + i, ended_at: iso, last_tool_at: iso }) + "\n" });
    }
    rows.push({ file: "running-old.json", mtimeMs: now - 86400000,
      text: JSON.stringify({ agent_id: "still-running", last_tool_at: iso }) + "\n" });
    process.stdout.write(JSON.stringify(rows));
  ' "$NOW" | { read -r json; write_rows "$sid" "$json"; }
  AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX=1 fire "$sid"
  unset AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX
  local want='1 subagents appear running (advisory threshold 1; token-discipline: keep lightweight subagents at most 3 at a time)'
  case "$__RUN_STDOUT" in
    *"$want"*) ;;
    *) bad older_running_stamp_included; return ;;
  esac
  case "$__RUN_STDOUT" in
    *'"permissionDecision":"deny"'*) bad older_running_stamp_included; return ;;
  esac
  [ "$__RUN_EXIT" = 0 ] || bad older_running_stamp_included
}

scenario_oversized_dir_op_budget() {
  local sid="m-over"
  prepare "$sid"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { sanitizeSessionId } = require(process.argv[1]);
    const dir = path.join(process.argv[2], "agents", sanitizeSessionId(process.argv[3]));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const iso = process.argv[4];
    for (let i = 0; i < 5000; i++) {
      fs.writeFileSync(path.join(dir, "run-" + String(i).padStart(4, "0") + ".json"), JSON.stringify({ agent_id: "run-" + i, last_tool_at: iso }) + "\n");
    }
  ' "$REPO_ROOT/scripts/lib/live-state-dir.js" "$AUTOPILOT_LIVE_DIR" "$sid" "$FRESH"
  fire "$sid"
  case "$__RUN_STDOUT" in
    *'appear running (scan truncated)'*) ;;
    *) bad oversized_dir_op_budget; return ;;
  esac
  case "$__RUN_STDOUT" in
    *'"permissionDecision":"deny"'*) bad oversized_dir_op_budget; return ;;
  esac
  [ "$__RUN_EXIT" = 0 ] || bad oversized_dir_op_budget
}

scenario_reader_throw_fail_open() {
  local sid="m-throw" empty="m-empty" 
  prepare "$empty"
  fire "$empty"
  local base="$__RUN_STDOUT" be="$__RUN_EXIT"
  prepare "$sid"
  fresh_running "$sid" 3
  fire "$sid"
  if [ "$be" != 0 ] || [ "$__RUN_EXIT" != 0 ]; then echo "ASSERT reader_throw_fail_open"; return 1; fi
  case "$__RUN_STDOUT" in
    *'"permissionDecision":"deny"'*) echo "ASSERT reader_throw_fail_open"; return 1 ;;
  esac
  [ "$__RUN_STDOUT" = "$base" ] || { echo "ASSERT reader_throw_fail_open"; return 1; }
}

run_one() {
  local row="$1" fn="$2"
  local mout mrc gout grc
  mout=$(
    export AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_MUTANT=1
    export AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT="$row"
    "$fn"
  )
  mrc=$?
  if [ "$row" = "reader_throw" ]; then
    if [ "$mrc" -eq 0 ] && ! printf '%s' "$mout" | grep -q 'ASSERT '; then
      echo "reader_throw_fail_open PASS"
      return 0
    fi
    echo "reader_throw_fail_open expected PASS under reader_throw, rc=$mrc" >&2
    printf '%s\n' "$mout" >&2
    return 1
  fi
  gout=$(
    unset AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_MUTANT AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT
    "$fn"
  )
  grc=$?
  if [ "$mrc" -eq 0 ]; then
    echo "$row unexpected PASS under mutant" >&2
    printf '%s\n' "$mout" >&2
    return 1
  fi
  if ! printf '%s' "$mout" | grep -q "ASSERT $row"; then
    echo "$row mutant failed without marker ASSERT $row (rc=$mrc)" >&2
    printf '%s\n' "$mout" >&2
    return 1
  fi
  if [ "$grc" -ne 0 ]; then
    echo "$row green run failed (rc=$grc)" >&2
    printf '%s\n' "$gout" >&2
    return 1
  fi
  echo "$row mutant=FAIL green=PASS"
}

# Gate: the mutant name does nothing unless the allow variable is exactly 1.
gate_without_allow() {
  local sid="m-gate" base
  prepare "$sid"
  fire "$sid"; base="$__RUN_STDOUT"
  fresh_running "$sid" 3
  AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT=knob_zero_silent \
    AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX=0 \
    fire "$sid"
  unset AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX
  [ "$__RUN_STDOUT" = "$base" ] && [ "$__RUN_EXIT" = 0 ]
}

ORACLE_FAIL=0
if gate_without_allow; then
  echo "mutant_ignored_without_allow PASS"
else
  echo "mutant_ignored_without_allow FAIL" >&2
  ORACLE_FAIL=1
fi

echo "SKIPPED resume_mtime_after_ended_counts_running: SubagentStart fired on resume (evidence note 03), so a stamp that still has ended_at is not treated as running from transcript mtime"

run_one parked_ended_not_running scenario_parked_ended_not_running || ORACLE_FAIL=1
run_one resume_restart_counts_running scenario_resume_restart_counts_running || ORACLE_FAIL=1
run_one crash_stale_not_running scenario_crash_stale_not_running || ORACLE_FAIL=1
run_one quota_silent_ages_out scenario_quota_silent_ages_out || ORACLE_FAIL=1
run_one unparseable_not_counted scenario_unparseable_not_counted || ORACLE_FAIL=1
run_one compaction_no_double_count scenario_compaction_no_double_count || ORACLE_FAIL=1
run_one knob_zero_silent scenario_knob_zero_silent || ORACLE_FAIL=1
run_one activity_off_silent scenario_activity_off_silent || ORACLE_FAIL=1
run_one older_running_stamp_included scenario_older_running_stamp_included || ORACLE_FAIL=1
run_one oversized_dir_op_budget scenario_oversized_dir_op_budget || ORACLE_FAIL=1
run_one reader_throw scenario_reader_throw_fail_open || ORACLE_FAIL=1

if [ "$ORACLE_FAIL" -ne 0 ]; then
  echo "FAIL [$TEST_NAME] mutant oracle" >&2
  exit 1
fi
echo "PASS [$TEST_NAME] mutant oracle"
exit 0
