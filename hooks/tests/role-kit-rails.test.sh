#!/usr/bin/env bash
# --role-kit <dir> on the Claude dispatch rails (dispatch-hetero worker, dispatch-review, dispatch-author; claude-native only).
# No model call: `claude` is a stub that records its argv (NUL separated) and answers like the rail expects; the account
# layer cases use the Node claude shim of the G37 fixtures with FAKE tokens.
#  (a) no kit -> argv has no --system-prompt/--plugin-dir and the review/author rails still send `--tools ""` (today's argv)
#  (b) kit    -> argv carries --system-prompt with exactly role.md's bytes, --plugin-dir <kit>/plugin, --tools <list>;
#               result JSON (and the hetero manifest) record path + sha256 of role.md and tools
#  (c) each validation failure -> refused before any spawn (stub records no call), one-line reason
#  (d) a runner other than claude-native -> "role-kit unsupported for runner <r>"
#  (e) account-layer path: the same argv goes through claude-account.js run
#  (f) negative controls: a rail copy that drops the argv, and one that skips the runner refusal, turn (b) / (d) red
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/real-claude"; seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_ACCOUNTS_DIR="$TEST_TMP/no-accounts"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_CONFIG_FILE
node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null 2>&1

# ---- stub claude: argv -> $ARGV_NUL (one file per call, appended count in $CALLS), then the rail-specific answer
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
ARGV_NUL="$TEST_TMP/argv.nul"; CALLS="$TEST_TMP/calls.log"
cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\0' "$@" > "$KIT_ARGV_NUL"
echo call >> "$KIT_CALLS"
{ env | sort; pwd; } > "$KIT_ARGV_NUL.env"
case "${KIT_INNER:-}" in
  review) exec "$KIT_STUB_VERDICT" "$@" ;;
  author)
    prompt="$(cat)"
    b="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-AUTHOR-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
    e="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
    printf '%s\n{"verdict":"READY","findings":[]}\n%s\n' "$b" "$e" ;;
  *) cat >/dev/null; echo kit-edited > kit_out.txt; printf '{"type":"result","is_error":false,"result":"done"}\n' ;;
esac
EOF
chmod +x "$BIN/claude"
export KIT_ARGV_NUL="$ARGV_NUL" KIT_CALLS="$CALLS" KIT_STUB_VERDICT="$STUB_VERDICT"
export PATH="$BIN:$PATH"

SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; printf 'update repo file\n' > "$PROMPT"
AUTHOR_PROMPT="$TEST_TMP/author-prompt.txt"; printf 'Return a small JSON object.\n' > "$AUTHOR_PROMPT"
OUTSIDE="$TEST_TMP/outside.txt"; printf 'not part of the kit\n' > "$OUTSIDE"

# mkkit <dir> : a good kit. The role card has quotes, a $( ) text, a leading dash line and a trailing newline pair.
mkkit() {
  rm -rf "$1"; mkdir -p "$1/plugin/skills/only-skill"
  printf -- '# Role card\n- keep "quotes" and $(not run) and `ticks`\n--not-a-flag\nlast line\n\n' > "$1/role.md"
  printf 'Read,Grep\n' > "$1/tools"
  printf 'skill\n' > "$1/plugin/skills/only-skill/SKILL.md"
}
KIT="$TEST_TMP/kit"; mkkit "$KIT"
BAD_EMPTY="$TEST_TMP/bad-empty-role"; mkkit "$BAD_EMPTY"; : > "$BAD_EMPTY/role.md"
KIT_NOPLUG="$TEST_TMP/kit-noplugin"; mkkit "$KIT_NOPLUG"; rm -rf "$KIT_NOPLUG/plugin"; printf 'none\n' > "$KIT_NOPLUG/tools"

# run_rail <script-dir-or-file> <review|author|hetero> [extra args...] -> RC, OUT; resets argv/call logs
run_rail() {
  local script="$1" kind="$2"; shift 2
  rm -f "$ARGV_NUL" "$CALLS"; touch "$CALLS"
  case "$kind" in
    review) OUT="$(KIT_INNER=review "$script" --runner "${KIT_RUNNER:-claude-native}" --model haiku --diff-file "$DIFF" --bin "$BIN/claude" --timeout 30s --context-window off "$@" 2>&1 < /dev/null)" ;;
    author) OUT="$(KIT_INNER=author "$script" --runner "${KIT_RUNNER:-claude-native}" --model haiku --prompt-file "$AUTHOR_PROMPT" --bin "$BIN/claude" --timeout 30s --context-window off "$@" 2>&1 < /dev/null)" ;;
    hetero) OUT="$(cd "$SBX" && KIT_INNER=hetero "$script" --runner "${KIT_RUNNER:-claude-native}" --model claude-sonnet-4-6 --effort low --prompt-file "$PROMPT" --context-window off --branch "feat/kit-$RANDOM" "$@" 2>&1 < /dev/null)" ;;
  esac
  RC=$?
  NCALLS="$(grep -c call "$CALLS" 2>/dev/null || true)"; NCALLS="${NCALLS:-0}"
}

# argv_check <role.md> <tools-arg> <plugin-dir-or-empty> -> prints nothing when the recorded argv holds, else the reasons
argv_check() {
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "latin1");
    const argv = raw.split("\0"); argv.pop();
    const role = fs.readFileSync(process.argv[2]);
    const bad = [];
    const at = (f) => argv.indexOf(f);
    if (at("--system-prompt") < 0) bad.push("no --system-prompt");
    else if (Buffer.from(argv[at("--system-prompt") + 1], "latin1").compare(role) !== 0) bad.push("--system-prompt is not exactly role.md");
    if (at("--tools") < 0) bad.push("no --tools");
    else if (argv[at("--tools") + 1] !== process.argv[3]) bad.push("--tools [" + argv[at("--tools") + 1] + "] != [" + process.argv[3] + "]");
    if (process.argv[4]) { if (at("--plugin-dir") < 0 || argv[at("--plugin-dir") + 1] !== process.argv[4]) bad.push("--plugin-dir missing or wrong"); }
    else if (at("--plugin-dir") >= 0) bad.push("--plugin-dir given for a kit without plugin/");
    if (argv.filter((a) => a === "--tools").length !== 1) bad.push("--tools not exactly once");
    process.stdout.write(bad.join("; "));
  ' "$ARGV_NUL" "$1" "$2" "$3"
}
no_kit_flags() { # recorded argv carries neither kit flag
  node -e 'const a=require("fs").readFileSync(process.argv[1],"latin1").split("\0");process.stdout.write(a.includes("--system-prompt")||a.includes("--plugin-dir")?"kit flag present":"")' "$ARGV_NUL"
}
tools_arg() { node -e 'const a=require("fs").readFileSync(process.argv[1],"latin1").split("\0");a.pop();const i=a.indexOf("--tools");process.stdout.write(i<0?"ABSENT":"["+a[i+1]+"]")' "$ARGV_NUL"; }
sha_of() { sha256sum "$1" | cut -d' ' -f1; }
ROLE_SHA="$(sha_of "$KIT/role.md")"; TOOLS_SHA="$(sha_of "$KIT/tools")"
KIT_REAL="$(cd "$KIT" && pwd -P)"
json_has_kit() { # <json> -> "" when role_kit has path + both sha256 for the main kit
  node -e '
    const t = process.argv[1]; const line = t.split("\n").filter((l) => l.startsWith("{")).pop();
    const o = JSON.parse(line); const k = o.role_kit; const bad = [];
    if (!k) bad.push("no role_kit"); else {
      if (k.path !== process.argv[2]) bad.push("path " + k.path);
      if (k.role_md_sha256 !== process.argv[3]) bad.push("role sha");
      if (k.tools_sha256 !== process.argv[4]) bad.push("tools sha");
    }
    process.stdout.write(bad.join("; "));' "$1" "$KIT_REAL" "$ROLE_SHA" "$TOOLS_SHA"
}

for KIND in review author hetero; do
  SCRIPT_K="$REPO_ROOT/scripts/dispatch-$KIND.sh"

  # (a) no kit
  run_rail "$SCRIPT_K" "$KIND"; [ -n "${KIT_DEBUG:-}" ] && echo "DBG $KIND rc=$RC calls=$NCALLS out=$OUT" >&2
  assert_eq "1" "$NCALLS" "(a) $KIND: no kit -> one claude call"
  assert_eq "" "$(no_kit_flags)" "(a) $KIND: no kit -> no --system-prompt/--plugin-dir"
  if [ "$KIND" = hetero ]; then assert_eq "ABSENT" "$(tools_arg)" "(a) hetero: no kit -> no --tools (today's argv)"
  else assert_eq "[]" "$(tools_arg)" "(a) $KIND: no kit -> --tools \"\" (today's argv)"; fi
  assert_not_contains "$OUT" '"role_kit"' "(a) $KIND: no kit -> result JSON has no role_kit field"

  # (b) kit with plugin
  run_rail "$SCRIPT_K" "$KIND" --role-kit "$KIT"
  assert_eq "1" "$NCALLS" "(b) $KIND: kit -> one claude call (rc=$RC)"
  assert_eq "" "$(argv_check "$KIT/role.md" "Read,Grep" "$KIT_REAL/plugin")" "(b) $KIND: argv has exact role.md, --plugin-dir, --tools Read,Grep"
  assert_eq "" "$(json_has_kit "$OUT")" "(b) $KIND: result JSON records the kit (path + role.md and tools sha256)"

  # (b2) kit without plugin/, tools none
  run_rail "$SCRIPT_K" "$KIND" --role-kit "$KIT_NOPLUG"
  assert_eq "1" "$NCALLS" "(b2) $KIND: kit without plugin -> one claude call"
  assert_eq "" "$(argv_check "$KIT_NOPLUG/role.md" "" "")" "(b2) $KIND: no --plugin-dir, tools none -> --tools \"\""

  # (c) validation failures: refused before any spawn, with a one-line reason
  declare -a CASES=(missing-dir no-role empty-role big-role empty-tools bad-tools multi-tools plugin-file link-escape dangling)
  for C in "${CASES[@]}"; do
    K="$TEST_TMP/bad-$C"; mkkit "$K"; WHY=""
    case "$C" in
      missing-dir) K="$TEST_TMP/does-not-exist"; WHY="kit dir missing" ;;
      no-role) rm "$K/role.md"; WHY="role.md missing" ;;
      empty-role) : > "$K/role.md"; WHY="role.md is empty" ;;
      big-role) head -c 8193 /dev/zero | tr '\0' 'a' > "$K/role.md"; WHY="over the 8192 byte cap" ;;
      empty-tools) printf '\n' > "$K/tools"; WHY="tools line is empty" ;;
      bad-tools) printf 'Read;rm -rf\n' > "$K/tools"; WHY="unknown tool name shape" ;;
      multi-tools) printf 'Read\nGrep\n' > "$K/tools"; WHY="single line" ;;
      plugin-file) rm -rf "$K/plugin"; printf x > "$K/plugin"; WHY="plugin/ is not a directory" ;;
      link-escape) rm "$K/role.md"; ln -s "$OUTSIDE" "$K/role.md"; WHY="escapes the kit dir" ;;
      dangling) ln -s "$K/nowhere" "$K/plugin/skills/only-skill/dangling"; WHY="dangling symlink" ;;
    esac
    run_rail "$SCRIPT_K" "$KIND" --role-kit "$K"
    assert_eq "2" "$RC" "(c) $KIND/$C: exits 2"
    assert_eq "0" "$NCALLS" "(c) $KIND/$C: no claude spawned"
    assert_contains "$OUT" "role-kit refused" "(c) $KIND/$C: reason is a role-kit refusal"
    assert_contains "$OUT" "$WHY" "(c) $KIND/$C: reason names the cause [$WHY]"
  done
  if [ "$KIND" = hetero ]; then
    assert_eq "1" "$(git -C "$SBX" worktree list | wc -l)" "(c) hetero: refusals created no worktree"
  fi

  # (d) other runners are refused, never ignored
  for R in codex agy cc-shim opencode; do
    KIT_RUNNER="$R" run_rail "$SCRIPT_K" "$KIND" --role-kit "$KIT"
    assert_eq "2" "$RC" "(d) $KIND/$R: exits 2"
    assert_eq "0" "$NCALLS" "(d) $KIND/$R: nothing spawned"
    assert_contains "$OUT" "role-kit unsupported for runner $R" "(d) $KIND/$R: refused with the runner named"
  done
  KIT_RUNNER=""
done

# hetero manifest records the kit
run_rail "$HETERO" hetero --role-kit "$KIT"
RUN_ID="$(printf '%s' "$OUT" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p' | tail -1)"
assert_file_exists "$AUTOPILOT_DISPATCH_RUNS_DIR/$RUN_ID.manifest.json" "hetero manifest written"
assert_eq "" "$(json_has_kit "$(cat "$AUTOPILOT_DISPATCH_RUNS_DIR/$RUN_ID.manifest.json")")" "hetero manifest records the kit"
run_rail "$HETERO" hetero
RUN_ID="$(printf '%s' "$OUT" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p' | tail -1)"
assert_not_contains "$(cat "$AUTOPILOT_DISPATCH_RUNS_DIR/$RUN_ID.manifest.json")" 'role_kit' "hetero manifest without a kit has no role_kit field"

# (h) review round g1 fixes
# h1: -h shows the knob on every rail
for KIND in review author hetero; do
  assert_contains "$("$REPO_ROOT/scripts/dispatch-$KIND.sh" -h 2>&1)" "--role-kit" "(h1) $KIND: -h prints the --role-kit lines"
done
# h2: a role card whose first bytes are "--example" reaches claude whole, as the value after --system-prompt
KIT_DASH="$TEST_TMP/kit-dash"; mkkit "$KIT_DASH"; printf -- '--example\nsecond line' > "$KIT_DASH/role.md"
for KIND in review author hetero; do
  run_rail "$REPO_ROOT/scripts/dispatch-$KIND.sh" "$KIND" --role-kit "$KIT_DASH"
  assert_eq "1" "$NCALLS" "(h2) $KIND: dash-leading role card -> one claude call"
  assert_eq "" "$(argv_check "$KIT_DASH/role.md" "Read,Grep" "$(cd "$KIT_DASH" && pwd -P)/plugin")" "(h2) $KIND: --system-prompt value is the full text starting with --example"
done
# h3: a node warning on stderr must not break a good kit, and a refusal still gives its own one-line reason
cat > "$TEST_TMP/warn.js" <<'WEOF'
process.emitWarning('role-kit test warning');
WEOF
for KIND in review author hetero; do
  NODE_OPTIONS="--require $TEST_TMP/warn.js" run_rail "$REPO_ROOT/scripts/dispatch-$KIND.sh" "$KIND" --role-kit "$KIT"
  assert_eq "1" "$NCALLS" "(h3) $KIND: node warning on stderr, good kit still spawns"
  assert_eq "" "$(argv_check "$KIT/role.md" "Read,Grep" "$KIT_REAL/plugin")" "(h3) $KIND: argv intact under a node warning"
  NODE_OPTIONS="--require $TEST_TMP/warn.js" run_rail "$REPO_ROOT/scripts/dispatch-$KIND.sh" "$KIND" --role-kit "$TEST_TMP/bad-empty-role"
  assert_eq "0" "$NCALLS" "(h3) $KIND: node warning + bad kit -> refused"
  assert_contains "$OUT" "role-kit refused: role.md is empty" "(h3) $KIND: refusal reason is the validator line, not the warning"
done
# h4: an unreadable role.md is a one-line refusal, not a stack trace
if [ "$(id -u)" != 0 ]; then
  KIT_EACCES="$TEST_TMP/kit-eacces"; mkkit "$KIT_EACCES"; chmod 000 "$KIT_EACCES/role.md"
  for KIND in review author hetero; do
    run_rail "$REPO_ROOT/scripts/dispatch-$KIND.sh" "$KIND" --role-kit "$KIT_EACCES"
    assert_eq "2" "$RC" "(h4) $KIND: unreadable role.md exits 2"
    assert_eq "0" "$NCALLS" "(h4) $KIND: unreadable role.md spawns nothing"
    assert_contains "$OUT" "role-kit refused: " "(h4) $KIND: one-line refusal"
    assert_not_contains "$OUT" "at Object" "(h4) $KIND: no stack trace in the refusal"
  done
  chmod 644 "$KIT_EACCES/role.md"
fi
# h5: hetero with --gate-rules: the gate settings ride in, but only the kit adds anything after them
GR="$TEST_TMP/gate-rules.json"; echo '{"v":1,"forbid_paths":[{"id":"fp","glob":"src/legacy/**"}]}' > "$GR"
run_rail "$HETERO" hetero --gate-rules "$GR"
assert_eq "1" "$NCALLS" "(h5) hetero gate-rules, no kit -> one claude call (rc=$RC)"
assert_eq "" "$(no_kit_flags)" "(h5) hetero gate-rules, no kit -> no kit flags"
assert_eq "ABSENT" "$(tools_arg)" "(h5) hetero gate-rules, no kit -> no --tools"
H5_NO="$(tr '\0' '\n' < "$ARGV_NUL" | grep -c -- '^--settings$')"; assert_eq "1" "$H5_NO" "(h5) hetero gate-rules, no kit -> --settings once"
H5_NO_N="$(tr '\0' '\n' < "$ARGV_NUL" | wc -l)"
run_rail "$HETERO" hetero --gate-rules "$GR" --role-kit "$KIT"
assert_eq "1" "$NCALLS" "(h5) hetero gate-rules + kit -> one claude call"
assert_eq "" "$(argv_check "$KIT/role.md" "Read,Grep" "$KIT_REAL/plugin")" "(h5) hetero gate-rules + kit -> kit argv present"
assert_eq "1" "$(tr '\0' '\n' < "$ARGV_NUL" | grep -c -- '^--settings$')" "(h5) hetero gate-rules + kit -> --settings once"

# (e) account-layer path: the same argv through claude-account.js run
FX="$(node -e '
  const { makeFixture } = require(process.argv[1]);
  const f = makeFixture({ aliases: [{ alias: "a" }, { alias: "b" }] });
  const q = (s) => "\x27" + s + "\x27";
  const out = { FX_ROOT: f.root, FX_HOME: f.realHome, FX_BIN: f.shim.binDir, FX_LOG: f.shim.log, FX_ACC: f.accountsDir,
    FX_LIVE: f.liveDir, FX_STATE: f.stateDir, FX_RUN: f.env.XDG_RUNTIME_DIR, FX_TMP: f.env.TMPDIR, FX_CFG: f.configFile };
  for (const [k, v] of Object.entries(out)) console.log(k + "=" + q(v));
' "$REPO_ROOT/scripts/lib/account-fixtures/shim-install.js")"
eval "$FX"
acct_run() { # <kind> [args...] ; shim logs one JSON line per spawn with the argv
  local kind="$1"; shift
  : > "$FX_LOG"
  local -a envv=(HOME="$FX_HOME" PATH="$FX_BIN:$PATH" TMPDIR="$FX_TMP" XDG_RUNTIME_DIR="$FX_RUN" AUTOPILOT_ACCOUNTS_DIR="$FX_ACC"
    AUTOPILOT_LIVE_DIR="$FX_LIVE" AUTOPILOT_STATE_DIR="$FX_STATE" AUTOPILOT_CONFIG="$FX_CFG")
  case "$kind" in
    review) OUT="$(env "${envv[@]}" "$REVIEW" --runner claude-native --model haiku --diff-file "$DIFF" --bin "$FX_BIN/claude" --timeout 30s --context-window off "$@" 2>&1 < /dev/null)" ;;
    author) OUT="$(env "${envv[@]}" "$AUTHOR" --runner claude-native --model haiku --prompt-file "$AUTHOR_PROMPT" --bin "$FX_BIN/claude" --timeout 30s --context-window off "$@" 2>&1 < /dev/null)" ;;
    hetero)
      env HOME="$FX_HOME" node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null 2>&1
      OUT="$(cd "$SBX" && env "${envv[@]}" "$HETERO" --runner claude-native --model claude-sonnet-4-6 --effort low --prompt-file "$PROMPT" --context-window off --branch "feat/acct-$RANDOM" "$@" 2>&1 < /dev/null)" ;;
  esac
  RC=$?
}
shim_argv_check() { # <role.md> <tools> <plugin> against the first shim call
  node -e '
    const fs = require("fs");
    const l = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    if (l.length !== 1) { process.stdout.write("shim calls=" + l.length); process.exit(0); }
    const c = JSON.parse(l[0]); const argv = c.argv; const bad = [];
    const i = argv.indexOf("--system-prompt");
    if (i < 0 || Buffer.from(argv[i + 1]).compare(fs.readFileSync(process.argv[2])) !== 0) bad.push("system prompt");
    const t = argv.indexOf("--tools"); if (t < 0 || argv[t + 1] !== process.argv[3]) bad.push("tools");
    const p = argv.indexOf("--plugin-dir"); if (p < 0 || argv[p + 1] !== process.argv[4]) bad.push("plugin-dir");
    if (!c.account) bad.push("not through the account layer");
    process.stdout.write(bad.join("; "));' "$FX_LOG" "$1" "$2" "$3"
}
shim_no_kit_check() {
  node -e '
    const l = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    if (l.length !== 1) { process.stdout.write("shim calls=" + l.length); process.exit(0); }
    const a = JSON.parse(l[0]).argv; const t = a.indexOf("--tools");
    process.stdout.write(a.includes("--system-prompt") || a.includes("--plugin-dir") ? "kit flag" : (process.argv[2] === "keep-tools" ? (a[t + 1] === "" ? "" : "tools") : (t < 0 ? "" : "tools")));' "$FX_LOG" "$1"
}
for KIND in review author hetero; do
  acct_run "$KIND" --role-kit "$KIT"
  assert_eq "" "$(shim_argv_check "$KIT/role.md" "Read,Grep" "$KIT_REAL/plugin")" "(e) $KIND account layer: kit argv goes through claude-account.js run"
  acct_run "$KIND"
  if [ "$KIND" = hetero ]; then assert_eq "" "$(shim_no_kit_check hetero)" "(e) hetero account layer: no kit -> no kit flags, no --tools"
  else assert_eq "" "$(shim_no_kit_check keep-tools)" "(e) $KIND account layer: no kit -> --tools \"\" only"; fi
  acct_run "$KIND" --role-kit "$TEST_TMP/bad-big-role"
  assert_eq "2" "$RC" "(e) $KIND account layer: invalid kit refused"
  assert_eq "0" "$(grep -c . "$FX_LOG")" "(e) $KIND account layer: invalid kit spawned nothing"
done
rm -rf "$FX_ROOT"

# (f) negative controls
BAD="$TEST_TMP/mut-scripts"; cp -r "$REPO_ROOT/scripts" "$BAD"
sed_mutate "$BAD/dispatch-review.sh" 's/ \${ROLE_KIT_EXTRA\[@\]+"\${ROLE_KIT_EXTRA\[@\]}"}//g' >/dev/null
run_rail "$BAD/dispatch-review.sh" review --role-kit "$KIT"
assert_neq "" "$(argv_check "$KIT/role.md" "Read,Grep" "$KIT_REAL/plugin")" "(f) negative control: review rail that drops the kit argv is detected"
MUT2="$TEST_TMP/mut2-scripts"; cp -r "$REPO_ROOT/scripts" "$MUT2"
sed_mutate "$MUT2/lib/role-kit.sh" 's/^  \[ "${1:-}" = "claude-native" \] || die_precondition.*$/  :/' >/dev/null
KIT_RUNNER=codex run_rail "$MUT2/dispatch-review.sh" review --role-kit "$KIT"
assert_not_contains "$OUT" "role-kit unsupported for runner codex" "(f) negative control: rail without the runner refusal does not refuse (so (d) can go red)"
KIT_RUNNER=""
MUT3="$TEST_TMP/mut3-scripts"; cp -r "$REPO_ROOT/scripts" "$MUT3"
sed_mutate "$MUT3/lib/role-kit.js" "s/if (role.length > ROLE_MD_MAX_BYTES) fail/if (false) fail/" >/dev/null
K="$TEST_TMP/bad-big-role"
run_rail "$MUT3/dispatch-review.sh" review --role-kit "$K"
assert_neq "0" "$NCALLS" "(f) negative control: validator without the size cap lets an oversize kit through to a spawn"

MUT4="$TEST_TMP/mut4-scripts"; cp -r "$REPO_ROOT/scripts" "$MUT4"
sed_mutate "$MUT4/lib/role-kit.sh" 's/2>\/dev\/null < \/dev\/null/2>\&1 < \/dev\/null/' >/dev/null
NODE_OPTIONS="--require $TEST_TMP/warn.js" run_rail "$MUT4/dispatch-review.sh" review --role-kit "$KIT"
assert_eq "0" "$NCALLS" "(f) negative control: stderr merged into the parsed output makes a node warning refuse a good kit"
MUT5="$TEST_TMP/mut5-scripts"; cp -r "$REPO_ROOT/scripts" "$MUT5"
sed_mutate "$MUT5/dispatch-review.sh" "s/sed -n '2,63p'/sed -n '2,50p'/" >/dev/null
assert_not_contains "$("$MUT5/dispatch-review.sh" -h 2>&1)" "--role-kit" "(f) negative control: a -h range that stops early hides the --role-kit lines"

# (g) opt-in byte-identity check: ROLE_KIT_BASELINE_SCRIPTS=<scripts dir of the pre-change tree> -> without a kit the child argv
# and env are byte-identical to that tree's (random suffixes of temp names and session ids normalised).
if [ -n "${ROLE_KIT_BASELINE_SCRIPTS:-}" ]; then
  # The two trees differ legitimately in: the scripts path inside the marker hook settings, run ids, random temp-name suffixes.
  norm() { tr '\0' '\n' < "$1" | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/UUID/g; s#[^ "'"'"']*/scripts/session-mode\.js#SCRIPTS/session-mode.js#g; s/(review|author|hetero)-[0-9]+-[0-9]+-[0-9a-f]+/\1-RUNID/g; s/tmp\.[A-Za-z0-9]+/tmp.X/g; s/(claude-config-|cnativecwd-|dispatch-[A-Za-z]+-[A-Za-z0-9]*|feat-kit-|feat\/kit-|hetero-[a-z0-9-]*-log-)[A-Za-z0-9]+/\1X/g; s/-[A-Za-z0-9]{6}(\/|$)/-RND\1/g; /^(OLDPWD|SHLVL|_|RANDOM|EPOCHREALTIME|SECONDS|INVOCATION_ID)=/d'; }
  for KIND in review author hetero; do
    run_rail "$ROLE_KIT_BASELINE_SCRIPTS/dispatch-$KIND.sh" "$KIND"
    norm "$ARGV_NUL" > "$TEST_TMP/base.argv"; norm "$ARGV_NUL.env" > "$TEST_TMP/base.env"
    run_rail "$REPO_ROOT/scripts/dispatch-$KIND.sh" "$KIND"
    norm "$ARGV_NUL" > "$TEST_TMP/new.argv"; norm "$ARGV_NUL.env" > "$TEST_TMP/new.env"
    [ -z "${KIT_DEBUG:-}" ] || { diff "$TEST_TMP/base.argv" "$TEST_TMP/new.argv" | head -8 >&2; diff "$TEST_TMP/base.env" "$TEST_TMP/new.env" | head -8 >&2; }
    cmp -s "$TEST_TMP/base.argv" "$TEST_TMP/new.argv"; assert_eq "0" "$?" "(g) $KIND: no-kit argv byte-identical to the baseline tree"
    cmp -s "$TEST_TMP/base.env" "$TEST_TMP/new.env"; assert_eq "0" "$?" "(g) $KIND: no-kit child env + cwd byte-identical to the baseline tree"
    [ -s "$TEST_TMP/new.argv" ]; assert_eq "0" "$?" "(g) $KIND: the compared argv is not empty"
  done
fi

# (i) the reference states the two caveats
REFDOC="$(cat "$REPO_ROOT/references/hetero-dispatch.md")"
assert_contains "$REFDOC" "no longer zero-tool" "(i) reference: a review kit with tools is no longer zero-tool"
assert_contains "$REFDOC" "hooks and \`.mcp.json\` run" "(i) reference: plugin hooks and .mcp.json run"
assert_not_contains "$REFDOC" "holding only that role's skills" "(i) reference: the skills-only wording is gone"
assert_eq "$REFDOC" "$(cat "$REPO_ROOT/platforms/codex/plugin/references/hetero-dispatch.md")" "(i) codex mirror of the reference is in sync"

finalize_test
