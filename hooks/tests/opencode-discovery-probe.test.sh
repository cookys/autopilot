#!/usr/bin/env bash
# opencode-discovery-probe.test.sh — negative controls for preflight-portability checks 16-18
# (OpenCode plugin version / skill discovery / agent body) and for the probe they share
# (scripts/lib/opencode-discovery-probe.js). Every gate here is shown RED against a deliberately
# broken fixture repo before it is trusted green: a check that cannot fail proves nothing.
. "$(dirname "$0")/lib.sh"

if ! command -v opencode >/dev/null 2>&1; then
  echo "SKIP [$TEST_NAME] opencode not found"
  exit 0
fi

# Isolation canary: read (never write) the owner's real opencode log. Record its byte offset now,
# and at the end read only what was appended after it: that text must not name any probe temp root
# or serve port. (size/mtime was unusable: a resident `opencode serve --service` appends to it.)
# Skipped, with the reason, when the log does not exist.
REAL_LOG="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/log/opencode.log"
if [ -f "$REAL_LOG" ]; then
  CANARY_OFFSET="$(stat -c '%s' "$REAL_LOG")"
else
  CANARY_OFFSET=""
  echo "SKIP [$TEST_NAME] isolation canary: $REAL_LOG does not exist (nothing of the owner's to protect)"
fi
PORTS_FILE="$TEST_TMP/probe-ports"; : > "$PORTS_FILE"

# canary_leaks <log> <offset> -> prints the appended lines that name a probe temp root or port
canary_leaks() {
  local log="$1" off="$2" tail_text pat=""
  tail_text="$(tail -c +"$((off + 1))" "$log" 2>/dev/null)"
  printf '%s\n' "$tail_text" | grep -F -e "$TEST_TMP" -e "/oc-probe-" || true
  while read -r p; do
    [ -n "$p" ] && printf '%s\n' "$tail_text" | grep -E "(:|port[= ])$p([^0-9]|$)" || true
  done < "$PORTS_FILE"
}

PROBE="$REPO_ROOT/scripts/lib/opencode-discovery-probe.js"
PREFLIGHT="$REPO_ROOT/scripts/preflight-portability.sh"

# A fixture repo = the consumer layer only (what the probe copies), freely breakable.
new_fixture() { # <name> -> prints dir
  local d="$TEST_TMP/fixture-$1"
  mkdir -p "$d/.opencode"
  cp -R "$REPO_ROOT/.claude-plugin" "$d/.claude-plugin"
  ( cd "$REPO_ROOT/.opencode" && for f in *; do case "$f" in node_modules|package.json|package-lock.json) ;; *) cp -R "$f" "$d/.opencode/$f" ;; esac; done )
  ln -s "$REPO_ROOT/.agents" "$d/.agents"
  echo "$d"
}

probe_json() { # <bin> <fixture> <name>
  local out
  out="$(node "$PROBE" --bin "$1" --repo "$2" --root "$TEST_TMP/root-$3" 2>&1)"
  printf '%s' "$out" | grep -o '"serve_port":[0-9]*' | cut -d: -f2 >> "$PORTS_FILE" || true
  printf '%s\n' "$out"
}

preflight_oc() { # <fixture> [bin] -> the OpenCode lines of preflight (stdout+stderr)
  PREFLIGHT_OPENCODE_REPO="$1" OPENCODE_BIN="${2:-opencode}" bash "$PREFLIGHT" --opencode-only </dev/null 2>&1 | grep -E 'OpenCode|opencode' || true
}

# ── green control: the real repo passes all three ──
OUT="$(PREFLIGHT_OPENCODE_REPO="$REPO_ROOT" bash "$PREFLIGHT" --opencode-only </dev/null 2>&1 | grep -E '^  [✓✗] OpenCode' || true)"
assert_contains "$OUT" '✓ OpenCode plugin getPluginVersion returns real version' "green: plugin version check passes on the real repo"
assert_contains "$OUT" '✓ OpenCode agent body resolves without frontmatter leak' "green: agent body check passes on the real repo"
assert_not_contains "$OUT" '✗' "green: no OpenCode check fails on the real repo"

ADAPTOR="$(probe_json opencode "$REPO_ROOT" adaptor | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).adaptor)')"

# ── red 1: agent body whose YAML frontmatter leaked into the prompt ──
F="$(new_fixture leak)"
printf -- '---\nname: reviewer\ndescription: leaked\n---\n# Reviewer\n' > "$F/.opencode/agent-bodies/reviewer.body.md"
J="$(probe_json opencode "$F" leak)"
assert_contains "$J" '"agent_frontmatter_leak":true' "red 1: probe reports the frontmatter leak"
OUT="$(preflight_oc "$F")"
assert_contains "$OUT" '✗ OpenCode agent body resolves without frontmatter leak' "red 1: agent-body check goes red on a leaking body"

# ── red 2: plugin that reports a fake version ──
F="$(new_fixture fakever)"
sed -i 's/getPluginVersion())/"9.9.9")/' "$F/.opencode/plugin-package/server.ts"
grep -q '"9.9.9"' "$F/.opencode/plugin-package/server.ts" || { echo "FIXTURE: fake-version sed did not apply"; exit 1; }
J="$(probe_json opencode "$F" fakever)"
assert_contains "$J" '"plugin_loaded_version":"9.9.9"' "red 2: probe reads the version the plugin printed"
OUT="$(preflight_oc "$F")"
assert_contains "$OUT" '✗ OpenCode plugin getPluginVersion returns real version' "red 2: plugin-version check goes red on a fake version"

# ── red 3: plugin entry in the pre-2.x shape (a file path; 2.x wants a directory) never loads ──
F="$(new_fixture filepath)"
sed -i 's#"./plugin-package"#"./plugin-package/server.ts"#' "$F/.opencode/opencode.json"
J="$(probe_json opencode "$F" filepath)"
OUT="$(preflight_oc "$F")"
case "$ADAPTOR" in
  v2)
    assert_contains "$J" '"plugin_loaded_version":null' "red 3: file-path plugin entry never loads on 2.x"
    assert_contains "$OUT" '✗ OpenCode plugin getPluginVersion returns real version' "red 3: plugin-version check goes red when the plugin never loads" ;;
  *) echo "NOTE [$TEST_NAME] installed opencode is not 2.x: red 3 (2.x file-path rejection) not applicable" ;;
esac

# ── red 4: skills not discoverable (empty .agents/skills) ──
F="$(new_fixture noskill)"
rm "$F/.agents"; mkdir -p "$F/.agents/skills/unrelated"
printf -- '---\nname: unrelated\ndescription: not dev-flow\n---\nbody\n' > "$F/.agents/skills/unrelated/SKILL.md"
J="$(probe_json opencode "$F" noskill)"
assert_contains "$J" '"skill_found":false' "red 4: probe does not find dev-flow in a fixture without it"
OUT="$(preflight_oc "$F")"
case "$ADAPTOR" in
  v2) assert_contains "$OUT" '✗ OpenCode discovers autopilot skills' "red 4: skill-discovery check is a hard failure on 2.x" ;;
  *) assert_contains "$OUT" 'ADVISORY' "red 4: skill-discovery shortfall is advisory on 1.x" ;;
esac

# ── red 5: unknown major fails closed (probe exit 3, preflight check red), nothing guessed ──
BIN="$TEST_TMP/fake-opencode"
printf '#!/bin/sh\necho "opencode 3.1.0"\n' > "$BIN"; chmod +x "$BIN"
J="$(probe_json "$BIN" "$REPO_ROOT" unknownmajor)"; RC=$?
node "$PROBE" --bin "$BIN" --repo "$REPO_ROOT" --root "$TEST_TMP/root-unknownmajor2" >/dev/null 2>&1; RC=$?
assert_eq "$RC" "3" "red 5: unknown opencode major exits 3 (fail closed)"
assert_contains "$J" 'refusing to guess' "red 5: unknown major names the refusal"
OUT="$(preflight_oc "$REPO_ROOT" "$BIN")"
assert_contains "$OUT" '✗ OpenCode plugin getPluginVersion returns real version' "red 5: preflight check goes red on an unknown major"

# ── signals: an interrupted probe must take its detached serve and its temp root with it ──
# The serve runs in its own process group, so `timeout`/kill on the probe alone cannot reach it;
# only the probe's own SIGINT/SIGTERM/SIGHUP handler can. PID comes from the probe's --pid-file.
run_signal_case() { # <probe.js> <signal> <name> -> sets SERVE_ALIVE, TMP_LEFT, SIG_RC
  local probe="$1" sig="$2" name="$3" tmpd="$TEST_TMP/sig-tmp-$3" pidf="$TEST_TMP/sig-$3.pid" pp i
  mkdir -p "$tmpd"; rm -f "$pidf"
  TMPDIR="$tmpd" node "$probe" --bin opencode --repo "$REPO_ROOT" --pid-file "$pidf" >/dev/null 2>&1 &
  pp=$!
  for i in $(seq 1 200); do [ -s "$pidf" ] && break; sleep 0.05; done
  SERVE_PID="$(cat "$pidf" 2>/dev/null)"
  kill "-$sig" "$pp" 2>/dev/null
  wait "$pp" 2>/dev/null; SIG_RC=$?
  sleep 0.5
  SERVE_ALIVE=no; [ -n "$SERVE_PID" ] && [ -d "/proc/$SERVE_PID" ] && SERVE_ALIVE=yes
  TMP_LEFT="$(find "$tmpd" -mindepth 1 -maxdepth 1 -name 'oc-probe-*' | head -1)"
  [ "$SERVE_ALIVE" = yes ] && kill -KILL "-$SERVE_PID" 2>/dev/null   # never leave the control's serve behind
  return 0
}
case "$ADAPTOR" in
  v2)
    for SIG in TERM INT HUP; do
      run_signal_case "$PROBE" "$SIG" "good-$SIG"
      assert_neq "$SERVE_PID" "" "signal $SIG: probe reported its serve pid"
      assert_eq "$SERVE_ALIVE" "no" "signal $SIG: serve process is gone after the probe is interrupted"
      assert_eq "$TMP_LEFT" "" "signal $SIG: temp root removed"
      case "$SIG" in TERM) N=143 ;; INT) N=130 ;; HUP) N=129 ;; esac
      assert_eq "$SIG_RC" "$N" "signal $SIG: probe exits 128+signo"
    done
    # negative control: the same probe with its signal handlers removed leaks both
    CTL="$TEST_TMP/ctl-lib"; mkdir -p "$CTL"
    cp "$REPO_ROOT"/scripts/lib/opencode-containment.js "$CTL/"
    sed "s/^for (const \[sig, no\] of .*/for (const [sig, no] of []) {/" "$PROBE" > "$CTL/opencode-discovery-probe.js"
    grep -q 'of \[\]) {' "$CTL/opencode-discovery-probe.js" || { echo "FIXTURE: handler removal did not apply"; exit 1; }
    run_signal_case "$CTL/opencode-discovery-probe.js" TERM ctl
    assert_eq "$SERVE_ALIVE" "yes" "control: without the signal handlers the detached serve survives (so the check above can fail)"
    assert_neq "$TMP_LEFT" "" "control: without the signal handlers the temp root is left behind"
    ;;
  *) echo "NOTE [$TEST_NAME] installed opencode is not 2.x: signal cases (detached serve) not applicable" ;;
esac

# ── isolation: the probe's opencode wrote its state inside the sandbox root ──
assert_file_exists "$TEST_TMP/root-adaptor/xdg-data/opencode" "isolation: opencode data dir lives under the probe root (XDG_DATA_HOME redirected)"
assert_file_exists "$TEST_TMP/root-adaptor/home" "isolation: HOME is the probe root's home"
if [ -n "$CANARY_OFFSET" ]; then
  LEAKS="$(canary_leaks "$REAL_LOG" "$CANARY_OFFSET")"
  assert_eq "$LEAKS" "" "isolation canary: nothing appended to the real opencode.log names a probe root or port"
  echo "CANARY [$TEST_NAME] real opencode.log offset=$CANARY_OFFSET now=$(stat -c %s "$REAL_LOG") ports_seen=$(wc -l < "$PORTS_FILE")"
fi
# negative control (fixture log, no real run): a line naming a probe root after the offset must trip the canary
FAKE_LOG="$TEST_TMP/fake-opencode.log"; printf 'old line\n' > "$FAKE_LOG"; FAKE_OFF="$(stat -c %s "$FAKE_LOG")"
printf 'INFO service started cwd=%s/root-x/project\n' "$TEST_TMP" >> "$FAKE_LOG"
assert_neq "$(canary_leaks "$FAKE_LOG" "$FAKE_OFF")" "" "canary control: appended line with a probe temp root is flagged"
printf 'old line\nINFO unrelated resident-service line\n' > "$FAKE_LOG"
assert_eq "$(canary_leaks "$FAKE_LOG" 9)" "" "canary control: unrelated appended line is not flagged"
echo 4242 > "$PORTS_FILE"; printf 'old line\nINFO listening 127.0.0.1:4242\n' > "$FAKE_LOG"
assert_neq "$(canary_leaks "$FAKE_LOG" 9)" "" "canary control: appended line with a probe port is flagged"

finalize_test
