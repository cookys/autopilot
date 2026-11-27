#!/usr/bin/env bash
# ask-guard (c4140 regression): the PM question gate judges the seat from the session's fleet
# address, never team.json. No fleet address = the operator's own session (allowed, silent
# card write). ask_guard.allow_members (default ["pm--claude", "glm-trial*"], glob on the
# member part) and a PM-console cwd are allowed. Every other seat rolls out on
# ask_guard.enforce_from (foreman_guard.poll_enforce_from shape): until that instant + 1 h the
# ask proceeds with a stderr warning and one ~/.autopilot/ask-guard/hits.jsonl line; at or
# after it PreToolUse denies and points at scripts/request-decision.js. HOME is the suite
# sandbox, so the hits file lands under $HOOK_HOME.
. "$(dirname "$0")/lib.sh"

# Isolate from parent fleet/session env and never reach the real fleet binary.
unset CLAUDE_CODE_SESSION_ID FLEET_ADDRESS AUTOPILOT_FLEET_ADDRESS FLEET_BIN
DEFAULT_FLEET_STUB="$TEST_TMP/fleet-default-stub"
printf '#!/usr/bin/env bash\nexit 2\n' > "$DEFAULT_FLEET_STUB"
chmod +x "$DEFAULT_FLEET_STUB"
export FLEET_BIN="$DEFAULT_FLEET_STUB"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q

# The whole point of the c4140 case: no team.json on this home.
rm -f "$HOOK_HOME/.autopilot/team.json"
HITS="$HOOK_HOME/.autopilot/ask-guard/hits.jsonl"

# Window anchors relative to now: PAST is 2 h ago (the 1 h warn window is over -> deny);
# INSIDE is 30 min ago (still inside the window -> warn).
PAST="$(node -e 'process.stdout.write(new Date(Date.now() - 2 * 3600e3).toISOString())')"
INSIDE="$(node -e 'process.stdout.write(new Date(Date.now() - 30 * 60e3).toISOString())')"

set_cfg() { # $1 = enforce_from ISO
  printf '{"ask_guard":{"enforce_from":"%s"}}\n' "$1" > "$AUTOPILOT_CONFIG_FILE"
}

payload() {
  node -e 'process.stdout.write(JSON.stringify({tool_name:"AskUserQuestion",session_id:"s1",cwd:process.argv[1],tool_input:{questions:[{question:"要刪嗎？",options:[{label:"刪",description:"刪掉"},{label:"留",description:"留下"}]}]}}))' "$1"
}

entry_count() {
  node -e '
    const fs = require("fs"); const path = require("path");
    const dir = path.join(process.argv[1], ".git", "autopilot", "decisions");
    let n = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const body = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        n += Array.isArray(body.decisions) ? body.decisions.length : 0;
      }
    } catch (e) { if (e.code !== "ENOENT") throw e; }
    process.stdout.write(String(n));
  ' "$1"
}

expect_deny() {
  local before after
  before="$(entry_count "$REPO")"
  run_hook ask-decision.js "$(payload "$REPO")"
  after="$(entry_count "$REPO")"
  assert_eq 0 "$__RUN_EXIT" "$1: exit 0"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "$1: denies"
  assert_contains "$__RUN_STDOUT" "request-decision.js" "$1: points at request-decision.js"
  assert_eq "$before" "$after" "$1: writes no decision entry"
}

expect_allow() {
  local before after
  before="$(entry_count "$REPO")"
  run_hook ask-decision.js "$(payload "$REPO")"
  after="$(entry_count "$REPO")"
  assert_eq 0 "$__RUN_EXIT" "$1: exit 0"
  assert_eq "" "$__RUN_STDOUT" "$1: silent"
  assert_eq "$((before + 1))" "$after" "$1: writes one entry"
}

# --- the c4140 gpu-lead regression: no team.json, fleet address cookys/c4140/gpu-lead--claude
export FLEET_ADDRESS=cookys/c4140/gpu-lead--claude
set_cfg "$PAST"
expect_deny "gpu-lead (c4140) after the warn window"

rm -f "$HITS"
set_cfg "$INSIDE"
before="$(entry_count "$REPO")"
run_hook ask-decision.js "$(payload "$REPO")"
assert_eq 0 "$__RUN_EXIT" "gpu-lead (c4140) inside the warn window: exit 0"
assert_eq "" "$__RUN_STDOUT" "gpu-lead inside the window: no deny output"
assert_contains "$__RUN_STDERR" "ask-guard" "gpu-lead inside the window: stderr warning"
assert_eq "$before" "$(entry_count "$REPO")" "gpu-lead inside the window: writes no decision entry"
assert_file_exists "$HITS" "gpu-lead inside the window: hits.jsonl exists"
assert_eq 1 "$(wc -l < "$HITS" | tr -d ' ')" "gpu-lead inside the window: exactly one hits line"
assert_contains "$(cat "$HITS")" '"seat":"cookys/c4140/gpu-lead--claude"' "hits line names the seat"
assert_contains "$(cat "$HITS")" '"mode":"warn"' "hits line is a warn"

# --- rule 1: a session with no fleet address is the operator's own session: allowed
unset FLEET_ADDRESS
set_cfg "$PAST"
expect_allow "operator session (no fleet address)"

# --- rule 2: the allow list (defaults) matches on the member part of the address
export FLEET_ADDRESS=cookys/c4140/pm--claude
expect_allow "pm--claude (default allow list)"
export FLEET_ADDRESS=cookys/c4140/glm-trial-x
expect_allow "glm-trial-x (default allow list glob)"

# --- rule 2: the existing isPmConsole check allows a gated seat inside the PM console
PMREPO="$TEST_TMP/pmrepo"
mkdir -p "$PMREPO/.claude"
git -C "$PMREPO" init -q
printf '{"schema":"autopilot.console/1","mode":"program"}\n' > "$PMREPO/.claude/console.json"
export FLEET_ADDRESS=cookys/c4140/gpu-lead--claude
pm_before="$(entry_count "$PMREPO")"
run_hook ask-decision.js "$(payload "$PMREPO")"
assert_eq 0 "$__RUN_EXIT" "isPmConsole: exit 0"
assert_eq "" "$__RUN_STDOUT" "isPmConsole: silent"
assert_eq "$((pm_before + 1))" "$(entry_count "$PMREPO")" "isPmConsole: writes one entry"

# --- rule 2: ask_guard.allow_members in the config extends the list
export FLEET_ADDRESS=cookys/c4140/gpu-lead--claude
printf '{"ask_guard":{"enforce_from":"%s","allow_members":["gpu-lead--claude"]}}\n' "$PAST" > "$AUTOPILOT_CONFIG_FILE"
expect_allow "config allow_members extension"

# --- rule 4: team.json is not consulted at all. A pm role cannot ungate a fleet seat
# (with the old team.json decision this seat would have been allowed); the operator path
# (no address) still writes its card with a team.json present.
unset FLEET_ADDRESS
set_cfg "$PAST"
printf '{"role":"pm"}\n' > "$HOOK_HOME/.autopilot/team.json"
expect_allow "operator session (no fleet address) with team.json present"
export FLEET_ADDRESS=cookys/c4140/gpu-lead--claude
expect_deny "team.json role=pm does not ungate a fleet seat"
rm -f "$HOOK_HOME/.autopilot/team.json"

# --- the AUTOPILOT_FLEET_ADDRESS fallback is the same seat
unset FLEET_ADDRESS
export AUTOPILOT_FLEET_ADDRESS=ns/c4140/lane-x--claude
set_cfg "$PAST"
expect_deny "AUTOPILOT_FLEET_ADDRESS fallback gates the same seat"
unset AUTOPILOT_FLEET_ADDRESS

# --- negative control 1: revert rule 1 to the team.json role -> the gpu-lead deny goes red
MUT1="$TEST_TMP/mut-teamrole"
mkdir -p "$MUT1/hooks/lib"
ln -s "$REPO_ROOT/scripts" "$MUT1/scripts"
ln -s "$REPO_ROOT/src" "$MUT1/src"
ln -s "$REPO_ROOT/hooks/_shared" "$MUT1/hooks/_shared"
for f in "$REPO_ROOT"/hooks/*.js; do [ "$(basename "$f")" = ask-decision.js ] || ln -s "$f" "$MUT1/hooks/$(basename "$f")"; done
cp "$REPO_ROOT/hooks/ask-decision.js" "$MUT1/hooks/ask-decision.js"
for f in "$REPO_ROOT"/hooks/lib/*.js; do [ "$(basename "$f")" = ask-guard.js ] || ln -s "$f" "$MUT1/hooks/lib/$(basename "$f")"; done
sed_mutant "$REPO_ROOT/hooks/lib/ask-guard.js" "$MUT1/hooks/lib/ask-guard.js" \
  's#const raw = String(env.FLEET_ADDRESS || env.AUTOPILOT_FLEET_ADDRESS || '"'"''"'"');#const raw = require("../../scripts/lib/team.js").resolve().role === "solo" ? "" : "ns/c4140/gate--claude";#'
export FLEET_ADDRESS=cookys/c4140/gpu-lead--claude
set_cfg "$PAST"
MUT1_OUT="$(HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
  node "$MUT1/hooks/ask-decision.js" 2>/dev/null <<< "$(payload "$REPO")")"
assert_not_contains "$MUT1_OUT" '"permissionDecision":"deny"' \
  "control (team.json role, no team.json): gpu-lead is NOT denied, so the deny test is red"

# --- negative control 2: drop the allow list -> the pm--claude allow goes red
MUT2="$TEST_TMP/mut-noallow"
mkdir -p "$MUT2/hooks/lib"
ln -s "$REPO_ROOT/scripts" "$MUT2/scripts"
ln -s "$REPO_ROOT/src" "$MUT2/src"
ln -s "$REPO_ROOT/hooks/_shared" "$MUT2/hooks/_shared"
for f in "$REPO_ROOT"/hooks/*.js; do [ "$(basename "$f")" = ask-decision.js ] || ln -s "$f" "$MUT2/hooks/$(basename "$f")"; done
cp "$REPO_ROOT/hooks/ask-decision.js" "$MUT2/hooks/ask-decision.js"
for f in "$REPO_ROOT"/hooks/lib/*.js; do [ "$(basename "$f")" = ask-guard.js ] || ln -s "$f" "$MUT2/hooks/lib/$(basename "$f")"; done
sed_mutant "$REPO_ROOT/hooks/lib/ask-guard.js" "$MUT2/hooks/lib/ask-guard.js" \
  's#const DEFAULT_ALLOW_MEMBERS = \['"'"'pm--claude'"'"', '"'"'glm-trial\*'"'"'\];#const DEFAULT_ALLOW_MEMBERS = [];#'
export FLEET_ADDRESS=cookys/c4140/glm-trial-x  # pm--claude is allowed by hooks/_shared/pm-console.js too, so only the glob proves the list
set_cfg "$PAST"
MUT2_OUT="$(HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
  node "$MUT2/hooks/ask-decision.js" 2>/dev/null <<< "$(payload "$REPO")")"
assert_contains "$MUT2_OUT" '"permissionDecision":"deny"' \
  "control (allow list dropped): glm-trial-x is denied, so the allow test is red"

# --- whoami fallback when FLEET_ADDRESS and AUTOPILOT_FLEET_ADDRESS are unset
unset FLEET_ADDRESS
unset AUTOPILOT_FLEET_ADDRESS
STUB_BIN="$TEST_TMP/fleet-stub"
STUB_MARKER="$TEST_TMP/fleet-stub-called"
cat > "$STUB_BIN" <<'SH'
#!/usr/bin/env bash
[ -n "${STUB_MARKER:-}" ] && touch "$STUB_MARKER"
printf '%s\n' "${STUB_OUT:-}"
exit "${STUB_EXIT:-0}"
SH
chmod +x "$STUB_BIN"
export FLEET_BIN="$STUB_BIN"
export STUB_MARKER

# (a) no env address + stub prints cookys/c4140/gpu-lead--claude exit 0 + enforce_from in the past -> deny
export CLAUDE_CODE_SESSION_ID="sess-whoami-a"
export STUB_OUT="cookys/c4140/gpu-lead--claude"
export STUB_EXIT="0"
set_cfg "$PAST"
expect_deny "whoami fallback: gpu-lead--claude is denied"

# (b) same with stub printing cookys/aimax395/pm--claude -> allow
export STUB_OUT="cookys/aimax395/pm--claude"
export STUB_EXIT="0"
expect_allow "whoami fallback: pm--claude is allowed"

# (c) stub exit 2 -> allow
export STUB_OUT=""
export STUB_EXIT="2"
rm -f "$HITS"
expect_allow "whoami fallback: exit 2 (session_unknown) is allowed"

# (d) stub exit 3 -> allow + hits line seat_unresolved
export STUB_OUT=""
export STUB_EXIT="3"
rm -f "$HITS"
expect_allow "whoami fallback: exit 3 (unresolved) is allowed"
assert_contains "$__RUN_STDERR" "seat_unresolved" "whoami fallback: exit 3 writes stderr warn"
assert_file_exists "$HITS" "whoami fallback: exit 3 creates hits.jsonl"
assert_contains "$(cat "$HITS")" '"reason":"seat_unresolved"' "whoami fallback: hits line has reason seat_unresolved"

# (e) no CLAUDE_CODE_SESSION_ID -> stub never called
unset CLAUDE_CODE_SESSION_ID
rm -f "$STUB_MARKER"
export STUB_OUT="cookys/c4140/gpu-lead--claude"
export STUB_EXIT="0"
expect_allow "whoami fallback: no CLAUDE_CODE_SESSION_ID allows without calling stub"
if [ -e "$STUB_MARKER" ]; then
  echo "FAIL: stub was called without CLAUDE_CODE_SESSION_ID" >&2
  exit 1
fi

# --- negative control 3: remove whoami fallback -> case (a) goes red
MUT3="$TEST_TMP/mut-nowhoami"
mkdir -p "$MUT3/hooks/lib"
ln -s "$REPO_ROOT/scripts" "$MUT3/scripts"
ln -s "$REPO_ROOT/src" "$MUT3/src"
ln -s "$REPO_ROOT/hooks/_shared" "$MUT3/hooks/_shared"
for f in "$REPO_ROOT"/hooks/*.js; do [ "$(basename "$f")" = ask-decision.js ] || ln -s "$f" "$MUT3/hooks/$(basename "$f")"; done
cp "$REPO_ROOT/hooks/ask-decision.js" "$MUT3/hooks/ask-decision.js"
for f in "$REPO_ROOT"/hooks/lib/*.js; do [ "$(basename "$f")" = ask-guard.js ] || ln -s "$f" "$MUT3/hooks/lib/$(basename "$f")"; done
sed_mutant "$REPO_ROOT/hooks/lib/ask-guard.js" "$MUT3/hooks/lib/ask-guard.js" \
  's#if (fromEnv) return { address: fromEnv, unresolved: false };#return { address: fromEnv, unresolved: false };#'
export CLAUDE_CODE_SESSION_ID="sess-whoami-a"
export STUB_OUT="cookys/c4140/gpu-lead--claude"
export STUB_EXIT="0"
set_cfg "$PAST"
MUT3_OUT="$(HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
  node "$MUT3/hooks/ask-decision.js" 2>/dev/null <<< "$(payload "$REPO")")"
assert_not_contains "$MUT3_OUT" '"permissionDecision":"deny"' \
  "control (whoami fallback removed): gpu-lead is NOT denied, so case (a) is red"

unset CLAUDE_CODE_SESSION_ID FLEET_BIN STUB_OUT STUB_EXIT STUB_MARKER

finalize_test
