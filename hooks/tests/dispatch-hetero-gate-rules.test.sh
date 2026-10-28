#!/usr/bin/env bash
# dispatch-hetero --gate-rules (BL-0306 P2, rail part): T-R1..T-R6 of the work order. Only the `claude`
# binary is faked; the real dispatch-hetero.sh, per-turn-gate-arm.js, hooks/per-turn-gate.js and
# gate-verify.js run. The fake claude reads its own --settings file and runs the Stop hook command in it
# the way claude would at the end of a turn. Each check also runs against a deliberately broken copy of the
# rail (a symlink farm of the plugin tree with one file changed): the broken copy must make it fail.
. "$(dirname "$0")/lib.sh"
REAL_SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_CONFIG_FILE CHILD_SESSION_ID
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
GD="$AUTOPILOT_LIVE_DIR/per-turn-gate"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/hookcfg.json"; echo '{}' >"$AUTOPILOT_CONFIG_FILE"
# claude-native needs the owner's one-time confirmation and real-looking credentials
export CLAUDE_CONFIG_DIR="$TEST_TMP/real-claude"; mkdir -p "$CLAUDE_CONFIG_DIR"; echo '{"claudeAiOauth":{"accessToken":"stub"}}' >"$CLAUDE_CONFIG_DIR/.credentials.json"
unset AUTOPILOT_CONFIG_FILE_SAVE
node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null 2>&1
export ANTHROPIC_BASE_URL="http://127.0.0.1:9/x" ANTHROPIC_AUTH_TOKEN="stub"

mkrepo() { rm -rf "$1"; mkdir -p "$1/src/legacy"; git -C "$1" init -q -b develop
  echo ok >"$1/src/keep.js"; echo ok >"$1/src/legacy/old.js"; git -C "$1" add -A; git -C "$1" -c user.email=t@t -c user.name=t commit -q -m base; }
SBX="$TEST_TMP/repo"; mkrepo "$SBX"
PROMPT="$TEST_TMP/prompt.txt"; echo 'do work' >"$PROMPT"
RULES="$TEST_TMP/rules.json"; echo '{"v":1,"forbid_paths":[{"id":"fp","glob":"src/legacy/**"}]}' >"$RULES"
BAD_RULES="$TEST_TMP/bad-rules.json"; echo '{"v":1,"forbid_paths":[{"id":"x","glob":"../x/**"}]}' >"$BAD_RULES"

# Fake claude. FAKE_MODE: gate (default; violate, run the settings hook 4 times), fail (exit 1), sleep, race, plain.
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
cat >"$BIN/claude" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "$*" >>"$FAKE_ARGV"
echo "$PWD" >>"$FAKE_CALLS"
sid=""; settings=""; prev=""
for a in "$@"; do
  [ "$prev" = --session-id ] && sid="$a"
  [ "$prev" = --settings ] && settings="$a"
  prev="$a"
done
echo "$sid" >"$FAKE_SID"; echo "$settings" >"$FAKE_SETTINGS"
case "${FAKE_MODE:-gate}" in
  fail) printf '{"type":"result","is_error":true,"result":"boom"}\n'; exit 1 ;;
  sleep) touch "$FAKE_STARTED"; sleep "${FAKE_SLEEP:-4}"; exit 0 ;;
  plain) echo edited >plain_out.txt; printf '{"type":"result","is_error":false,"result":"done"}\n'; exit 0 ;;
esac
echo x >src/legacy/new.js
[ -n "$settings" ] || { printf '{"type":"result","is_error":false,"result":"done"}\n'; exit 0; }
cmd="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).hooks.Stop[0].hooks[0].command)' "$settings")"
[ -z "${FAKE_HOOK:-}" ] || cmd="'$(command -v node)' '$FAKE_HOOK'"
payload() { printf '{"session_id":"%s","cwd":"%s","stop_hook_active":%s,"prompt_id":"p"}' "$sid" "$PWD" "$1"; }
if [ "${FAKE_MODE:-gate}" = race ]; then
  payload false | sh -c "$cmd" >>"$FAKE_HOOKOUT" 2>/dev/null
  for i in 1 2 3 4; do payload true | sh -c "$cmd" >>"$FAKE_HOOKOUT" 2>/dev/null & done
  wait
else
  for a in false true true true; do payload "$a" | sh -c "$cmd" >>"$FAKE_HOOKOUT" 2>/dev/null; done
fi
if [ -n "${FAKE_INNER:-}" ]; then
  # a second dispatch while this one is still armed: both gate files must exist at once
  ls "$FAKE_GD" >"$FAKE_BOTH_BEFORE" 2>/dev/null
  ( cd "$FAKE_INNER_REPO" && FAKE_INNER="" FAKE_ARGV="$FAKE_ARGV.inner" FAKE_SID="$FAKE_SID.inner" FAKE_SETTINGS="$FAKE_SETTINGS.inner" \
      FAKE_CALLS="$FAKE_CALLS.inner" FAKE_HOOKOUT="$FAKE_HOOKOUT.inner" FAKE_BOTH_BEFORE=/dev/null \
      "$FAKE_SCRIPT" --runner cc-shim --model m --prompt-file "$FAKE_PROMPT" --context-window off --gate-rules "$FAKE_RULES" --branch feat/inner >/dev/null 2>&1 )
  ls "$FAKE_GD" >"$FAKE_BOTH_AFTER" 2>/dev/null
fi
printf '{"type":"result","is_error":false,"result":"done"}\n'
EOF
chmod +x "$BIN/claude"; export PATH="$BIN:$PATH"
export FAKE_GD="$GD" FAKE_PROMPT="$PROMPT" FAKE_RULES="$RULES"

# farm <name> <file-in-plugin-tree> <sed-expr...> : symlink copy of the plugin tree with one file changed.
farm() {
  local d="$TEST_TMP/farm-$1" f="$2"; shift 2; rm -rf "$d"; mkdir -p "$d"
  local e; for e in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do [ -e "$e" ] && [ "$(basename "$e")" != .git ] && ln -s "$e" "$d/$(basename "$e")"; done
  local dir; dir="$(dirname "$f")"
  # replace every directory on the path to $f by a real directory of symlinks
  local acc="$d" part; IFS=/ read -ra parts <<<"$dir"
  for part in "${parts[@]}"; do
    local nxt="$acc/$part" real; real="$(readlink -f "$nxt")"; rm "$nxt"; mkdir "$nxt"
    for e in "$real"/* "$real"/.[!.]*; do [ -e "$e" ] && ln -s "$e" "$nxt/$(basename "$e")"; done; acc="$nxt"
  done
  local target="$d/$f" src; src="$(readlink -f "$target")"; rm "$target"; cp "$src" "$target"
  local ex; for ex in "$@"; do sed -i -e "$ex" "$target"; cmp -s "$src" "$target" && { echo "farm $1: sed matched nothing: $ex" >&2; return 1; }; done
  echo "$d"
}

# go <script> <repo> <runner> [args...] : one dispatch. Sets OUT, RC; resets the fake's files.
go() {
  local script="$1" repo="$2" runner="$3"; shift 3
  rm -f "$TEST_TMP"/fake-*; export FAKE_ARGV="$TEST_TMP/fake-argv" FAKE_CALLS="$TEST_TMP/fake-calls" FAKE_SID="$TEST_TMP/fake-sid" \
    FAKE_SETTINGS="$TEST_TMP/fake-settings" FAKE_HOOKOUT="$TEST_TMP/fake-hookout" FAKE_STARTED="$TEST_TMP/fake-started" \
    FAKE_BOTH_BEFORE="$TEST_TMP/fake-both-before" FAKE_BOTH_AFTER="$TEST_TMP/fake-both-after" FAKE_SCRIPT="$script"
  : >"$FAKE_HOOKOUT"; BR="feat/g$RANDOM$RANDOM"
  OUT="$(cd "$repo" && "$script" --runner "$runner" --model claude-sonnet-4-6 --prompt-file "$PROMPT" --context-window off --branch "$BR" "$@" 2>&1)"; RC=$?
}
sid() { cat "$FAKE_SID" 2>/dev/null; }
nblocks() { grep -c '"decision":"block"' "$FAKE_HOOKOUT" 2>/dev/null || true; }
jl() { echo "$GD/$(sid).jsonl"; }

# T-R1 (claude-native and cc-shim, real launch shape): block, block, then the cap; records carry source.
r1() { local script="$1" runner
  for runner in cc-shim claude-native; do
    rm -rf "$GD"; export FAKE_MODE=gate; go "$script" "$SBX" "$runner" --gate-rules "$RULES"
    [ "$RC" = 0 ] || { echo "r1 $runner rc=$RC $OUT" >&2; return 1; }
    [ -n "$(sid)" ] && grep -q -- '--settings' "$FAKE_ARGV" || return 1
    [ "$(nblocks)" = 2 ] || return 1
    [ "$(grep -c '"decision":"allow","reason":"cap"' "$(jl)")" = 2 ] && grep -q '"source":"session"' "$(jl)" || return 1
  done; }
# no flag: the argv is what it was before, no --settings, no gate state
r1_noflag() { local script="$1"
  rm -rf "$GD"; export FAKE_MODE=plain; go "$script" "$SBX" claude-native
  [ "$RC" = 0 ] && ! grep -q -- '--settings' "$FAKE_ARGV" && [ ! -e "$GD" ] || return 1
  [ "$(cat "$FAKE_ARGV")" = "-p --session-id $(sid) --model claude-sonnet-4-6 --strict-mcp-config --dangerously-skip-permissions --effort low --output-format json" ] || \
    [ "$(cat "$FAKE_ARGV" | sed 's/--effort [a-z]* //')" = "-p --session-id $(sid) --model claude-sonnet-4-6 --strict-mcp-config --dangerously-skip-permissions --output-format json" ] || { cat "$FAKE_ARGV" >&2; return 1; }
  go "$script" "$SBX" cc-shim; [ "$RC" = 0 ] && ! grep -q -- '--settings' "$FAKE_ARGV" && [ ! -e "$GD" ]; }
r1_badrules() { local script="$1"
  rm -rf "$GD"; export FAKE_MODE=plain; go "$script" "$SBX" cc-shim --gate-rules "$BAD_RULES"
  [ ! -e "$FAKE_CALLS" ] && [ ! -e "$GD/$(sid).gate.json" ]; }

# T-R2: the gate file and the settings file are gone after success, failure, timeout and TERM.
gone_after() { local sid_; sid_="$(sid)"; local s; s="$(cat "$FAKE_SETTINGS" 2>/dev/null)"
  [ -n "$sid_" ] && [ ! -e "$GD/$sid_.gate.json" ] && { [ -z "$s" ] || [ ! -e "$s" ]; } && [ -n "$s" ]; }
r2() { local script="$1"
  rm -rf "$GD"; export FAKE_MODE=plain; go "$script" "$SBX" cc-shim --gate-rules "$RULES"; gone_after || { echo "r2 success" >&2; return 1; }
  export FAKE_MODE=fail; go "$script" "$SBX" cc-shim --gate-rules "$RULES"; gone_after || { echo "r2 failure" >&2; return 1; }
  export FAKE_MODE=sleep FAKE_SLEEP=20; go "$script" "$SBX" cc-shim --gate-rules "$RULES" --timeout 2s; gone_after || { echo "r2 timeout" >&2; return 1; }
  # TERM: the dispatcher is stopped while the worker runs
  export FAKE_MODE=sleep FAKE_SLEEP=4; rm -f "$TEST_TMP"/fake-*
  export FAKE_ARGV="$TEST_TMP/fake-argv" FAKE_CALLS="$TEST_TMP/fake-calls" FAKE_SID="$TEST_TMP/fake-sid" FAKE_SETTINGS="$TEST_TMP/fake-settings" FAKE_HOOKOUT="$TEST_TMP/fake-hookout" FAKE_STARTED="$TEST_TMP/fake-started"
  ( cd "$SBX" && timeout -s TERM 2 "$script" --runner cc-shim --model m --prompt-file "$PROMPT" --context-window off --branch "feat/term$RANDOM" --gate-rules "$RULES" >/dev/null 2>&1 )
  sleep 5
  gone_after || { echo "r2 TERM" >&2; return 1; }; }

# T-R3: distinct ids, files and counters for two overlapping hands; a stale CHILD_SESSION_ID is replaced; no id, no dispatch.
r3() { local script="$1"
  local repo2="$TEST_TMP/repo2"; mkrepo "$repo2"; rm -rf "$GD"
  export FAKE_MODE=gate FAKE_INNER=1 FAKE_INNER_REPO="$repo2"; go "$script" "$SBX" cc-shim --gate-rules "$RULES"; unset FAKE_INNER FAKE_INNER_REPO
  local a b; a="$(cat "$FAKE_SID")"; b="$(cat "$FAKE_SID.inner" 2>/dev/null)"
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" != "$b" ] || { echo "r3 ids [$a] [$b]" >&2; return 1; }
  grep -q "$b" "$FAKE_BOTH_AFTER" 2>/dev/null && [ -e "$GD/$a.t1.count" ] && [ -e "$GD/$b.t1.count" ] || { echo "r3 files" >&2; return 1; }
  export FAKE_MODE=plain; CHILD_SESSION_ID=fixed-id-123 go "$script" "$SBX" cc-shim --gate-rules "$RULES"
  [ -n "$(sid)" ] && [ "$(sid)" != fixed-id-123 ]; }
r3_nomint() { local script="$1"
  export FAKE_MODE=plain; go "$script" "$SBX" cc-shim --gate-rules "$RULES"; [ ! -e "$FAKE_CALLS" ] && [ "$RC" != 0 ]; }

# T-R4: the user-level hook and the --settings hook fire for the same Stop: never more than max_blocks, one record per call.
r4() { local script="$1" hook="${2:-}"
  rm -rf "$GD"; export FAKE_MODE=race; [ -z "$hook" ] || export FAKE_HOOK="$hook"; go "$script" "$SBX" cc-shim --gate-rules "$RULES"; unset FAKE_HOOK
  [ "$(nblocks)" -le 2 ] && [ "$(wc -l <"$(jl)" | tr -d ' ')" = 5 ]; }

# T-R5: the directory the arm script writes to is the directory the hook (inside the fake claude) reads.
r5() { r1 "$1"; }

# T-R6: the flag on any other runner is refused before a worker exists.
r6() { local script="$1"
  rm -f "$FAKE_CALLS"; export FAKE_MODE=plain; go "$script" "$SBX" codex --gate-rules "$RULES"
  [ "$RC" = 2 ] && case "$OUT" in *"--gate-rules applies only"*) true ;; *) false ;; esac && [ ! -e "$FAKE_CALLS" ]; }

pass_on() { if "$2" "$REAL_SCRIPT" ${3:-}; then assert_eq 0 0 "$1 holds on the real rail"; else fail "$1 broken on the real rail"; fi; }
nc() { # <label> <fn> <farm-name> <file> <sed...> : the check must hold on the real rail and fail on the broken copy
  pass_on "$1" "$2"
  local d; d="$(farm "$3" "$4" "${@:5}")" || { fail "$1 farm not built"; return; }
  if "$2" "$d/scripts/dispatch-hetero.sh"; then fail "$1 negative control: the broken rail passed"; else assert_eq 0 0 "$1 red on the broken rail"; fi
}

nc R1 r1 nosettings scripts/dispatch-hetero.sh 's# ${8:+--settings "$8"}##; s# ${7:+--settings "$7"}##'
pass_on R1-noflag r1_noflag
pass_on R1-badrules r1_badrules
nc R2 r2 nodisarm scripts/dispatch-hetero.sh '/per-turn-gate-arm.js" disarm/d'
nc R3 r3 reuseid scripts/dispatch-hetero.sh 's#\[ -z "${GATE_RULES_FILE:-}" \] || unset CHILD_SESSION_ID#:#'
# R3 mint: a rail whose child_session_mint mints nothing refuses to dispatch
d="$(farm nomint scripts/lib/repo-identity.sh 's#^  CHILD_SESSION_ID="$(printf .%s. "$u" | tr .A-Z. .a-z.)"#  CHILD_SESSION_ID=""#')" || fail "R3-mint farm not built"
if r3_nomint "$d/scripts/dispatch-hetero.sh"; then assert_eq 0 0 "R3-mint no id, no dispatch"; else fail "R3-mint dispatched without an id"; fi
if r3_nomint "$REAL_SCRIPT"; then fail "R3-mint negative control: the real rail also refused"; else assert_eq 0 0 "R3-mint control: real rail dispatches"; fi
# R4: a hook without its lock exceeds the cap under the double fire
node -e '
const fs = require("fs"); const [hooks, root, out] = process.argv.slice(1);
let t = fs.readFileSync(hooks + "/per-turn-gate.js", "utf8");
const rep = (a, b) => { if (!t.includes(a)) { console.error("no match: " + a); process.exit(1); } t = t.split(a).join(b); };
rep("require(\x27./_shared", "require(\x27" + hooks + "/_shared");
rep("require(\x27../", "require(\x27" + root + "/");
rep("path.resolve(__dirname, \x27..\x27, \x27scripts\x27, \x27gate-verify.js\x27)", "\x27" + root + "/scripts/gate-verify.js\x27");
const stub = "{ release: () => true, writeInt: (f, n) => fs.writeFileSync(f, n + String.fromCharCode(10)) }";
rep("const lockA = acquireLock(lockDir);", "const lockA = " + stub + ";");
rep("const lockB = acquireLock(lockDir);", "const lockB = " + stub + ";");
rep("counterNow = readInt(countFile);", "counterNow = readInt(countFile); sleepMs(150);");
fs.writeFileSync(out, t);' "$HOOKS_DIR" "$REPO_ROOT" "$TEST_TMP/hook-nolock.js" || fail "R4 mutant not built"
pass_on R4 r4
if r4 "$REAL_SCRIPT" "$TEST_TMP/hook-nolock.js"; then fail "R4 negative control: the lockless hook passed"; else assert_eq 0 0 "R4 red with a lockless hook"; fi
d="$(farm nolive scripts/per-turn-gate-arm.js "s#path.join(resolveLiveDir().base, STEM)#path.join('$TEST_TMP/elsewhere', STEM)#")" || fail "R5 farm not built"
pass_on R5 r5
if r5 "$d/scripts/dispatch-hetero.sh"; then fail "R5 negative control: arm ignoring AUTOPILOT_LIVE_DIR passed"; else assert_eq 0 0 "R5 red when arm writes elsewhere"; fi
nc R6 r6 ignoreflag scripts/dispatch-hetero.sh '/--gate-rules applies only to --runner/d'

finalize_test
