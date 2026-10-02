#!/usr/bin/env bash
# cleanroom-launch-kimi-agy.test.sh — final-panel isolation phase 2: launcher profiles kimi and agy.
#
# Part A (always runs, fake bwrap seam): argv design, no credential/repo in the preflight argv,
#   credentials only on the launch path, codex profile byte-identical to base 53ddc02f.
# Part B (AUTOPILOT_HOST_ISOLATION=1, real bwrap): isolation facts per runner, plus MODEL-FREE
#   probes of the real kimi/agy binaries (--version / `agy agents` only; no prompt ever reaches a model).
#
# RED at 53ddc02f (base launcher via CLEANROOM_LAUNCHER_UNDER_TEST):
#   FAIL kimi preflight with fake bwrap rc0 exits 0 (unknown arg: --bin): expected '2', got '0'
#   FAIL kimi preflight JSON names the runner: '"runner": "kimi"' not found in output
#   FAIL kimi preflight inner rc 3 is refused with exit 3: expected '2', got '3'
#   FAIL kimi launch with fake bwrap exits 0: expected '2', got '0'  (then aborts: no args captured)
. "$(dirname "$0")/lib.sh"

LAUNCHER="${CLEANROOM_LAUNCHER_UNDER_TEST:-$REPO_ROOT/scripts/lib/cleanroom-launch.sh}"
BASE_SHA=53ddc02f

# ---------- fixtures ----------
STUBS="$TEST_TMP/stubs"
mkdir -p "$STUBS/nodedir/bin" "$STUBS/nodedir/lib/kimi" "$STUBS/credkimi/credentials" "$STUBS/credkimi/oauth" \
  "$STUBS/credagy" "$STUBS/hostrepo"
printf '#!/bin/sh\necho "stub-node $*"\n' > "$STUBS/nodedir/bin/node"
chmod +x "$STUBS/nodedir/bin/node"
printf '// stub entry\n' > "$STUBS/nodedir/lib/kimi/main.mjs"
printf 'tok\n' > "$STUBS/credkimi/credentials/token"
printf 'tok\n' > "$STUBS/credkimi/oauth/state"
printf 'model="x"\n' > "$STUBS/credkimi/config.toml"
printf 'agy-secret-token\n' > "$STUBS/credagy/antigravity-oauth-token"
printf 'iid\n' > "$STUBS/credagy/installation_id"
printf '{}\n' > "$STUBS/credagy/settings.json"
printf 'repo\n' > "$STUBS/hostrepo/package.json"
printf '#!/bin/sh\necho stub-agy "$@"\n' > "$STUBS/agy"
chmod +x "$STUBS/agy"
printf 'PROMPT-BODY-DO-NOT-PUT-IN-ARGV\n' > "$STUBS/prompt.txt"

# fake bwrap: records the --args fd (9) content and the inner argv; rc from FAKE_BWRAP_RC
cat > "$STUBS/fakebwrap" <<'EOF'
#!/bin/sh
cap="${FAKE_BWRAP_CAPTURE:?}"
if [ "$1" = "--args" ]; then
  cat <&9 > "$cap/args.bin"
  shift 2
fi
[ "$1" = "--" ] && shift
: > "$cap/inner.txt"
for a in "$@"; do printf '%s\n' "$a" >> "$cap/inner.txt"; done
exit "${FAKE_BWRAP_RC:-0}"
EOF
chmod +x "$STUBS/fakebwrap"

args_lines() { tr '\0' '\n' < "$1"; }

run_fake() { # capdir rc launcher args...
  local cap="$1" rc="$2" l="$3"; shift 3
  mkdir -p "$cap"
  FAKE_BWRAP_CAPTURE="$cap" FAKE_BWRAP_RC="$rc" "$l" --bwrap "$STUBS/fakebwrap" "$@"
}

DENY_ARGS=(--deny-path "$STUBS/hostrepo")

# ---------- Part A: preflight argv carries no credential / repo / packet ----------
for R in kimi agy; do
  CAP="$TEST_TMP/pf-$R"; SEAT="$TEST_TMP/seat-pf-$R"
  if [ "$R" = kimi ]; then BINARG="$STUBS/nodedir/lib/kimi/main.mjs"; else BINARG="$STUBS/agy"; fi
  set +e
  run_fake "$CAP" 0 "$LAUNCHER" --preflight --profile "$R" "${DENY_ARGS[@]}" --bin "$BINARG" \
    --node-dir "$STUBS/nodedir" --cred-dir "$STUBS/cred$R" --seat-root "$SEAT" --keep-seat \
    > "$TEST_TMP/pf-$R.json" 2> "$TEST_TMP/pf-$R.err"
  RC=$?
  set -e
  assert_eq "0" "$RC" "$R preflight with fake bwrap rc0 exits 0 ($(head -c 200 "$TEST_TMP/pf-$R.err"))"
  assert_contains "$(cat "$TEST_TMP/pf-$R.json")" "\"runner\": \"$R\"" "$R preflight JSON names the runner"
  if [ -f "$CAP/args.bin" ]; then
    A="$(args_lines "$CAP/args.bin")"
    assert_contains "$A" "--clearenv" "$R preflight argv uses --clearenv"
    assert_contains "$A" "--unshare-all" "$R preflight argv unshares all"
    assert_not_contains "$A" "$STUBS/cred$R" "$R preflight argv has no credential dir bind"
    assert_not_contains "$A" "$STUBS/hostrepo" "$R preflight argv has no repo path"
    assert_not_contains "$A" "$STUBS/prompt.txt" "$R preflight argv has no prompt/packet bind"
    assert_not_contains "$A" "$HOME" "$R preflight argv has no real HOME path"
    # no `--ro-bind / /` pair
    if args_lines "$CAP/args.bin" | awk 'prev=="--ro-bind"&&$0=="/"{getline n; if(n=="/")f=1} {prev=$0} END{exit f?0:1}'; then
      fail "$R preflight argv contains --ro-bind / /"
    fi
  else
    fail "$R preflight did not reach bwrap (no args captured)"
  fi
  # empty HOME: no credential material anywhere in the kept preflight seat
  if [ -d "$SEAT" ]; then
    assert_file_absent "$SEAT/home/.kimi-code" "$R preflight seat has no kimi credential store"
    assert_file_absent "$SEAT/home/.gemini/antigravity-cli/antigravity-oauth-token" "$R preflight seat has no agy token"
    assert_eq "" "$(grep -rl 'agy-secret-token' "$SEAT" 2>/dev/null || true)" "$R preflight seat holds no credential bytes"
  else
    fail "$R preflight --keep-seat left no seat to inspect"
  fi
  rm -rf "$SEAT"
done

# fake rc mapping: 3 -> 3 (deny path readable), 1 -> 2 (runtime), unchanged semantics per runner
for R in kimi agy; do
  if [ "$R" = kimi ]; then BINARG="$STUBS/nodedir/lib/kimi/main.mjs"; else BINARG="$STUBS/agy"; fi
  set +e
  run_fake "$TEST_TMP/pf3-$R" 3 "$LAUNCHER" --preflight --profile "$R" "${DENY_ARGS[@]}" --bin "$BINARG" \
    --node-dir "$STUBS/nodedir" >/dev/null 2>&1
  assert_eq "3" "$?" "$R preflight inner rc 3 is refused with exit 3"
  run_fake "$TEST_TMP/pf1-$R" 1 "$LAUNCHER" --preflight --profile "$R" "${DENY_ARGS[@]}" --bin "$BINARG" \
    --node-dir "$STUBS/nodedir" >/dev/null 2>&1
  assert_eq "2" "$?" "$R preflight inner rc 1 maps to exit 2"
  set -e
done

# negative control: sabotaged kimi agent (no description) refused before bwrap is reached
printf -- '---\nname: x\ntools: []\n---\nbody\n' > "$STUBS/broken-agent.md"
set +e
run_fake "$TEST_TMP/pf-broken" 0 "$LAUNCHER" --preflight --profile kimi "${DENY_ARGS[@]}" \
  --bin "$STUBS/nodedir/lib/kimi/main.mjs" --node-dir "$STUBS/nodedir" --agent-file "$STUBS/broken-agent.md" \
  >/dev/null 2> "$TEST_TMP/pf-broken.err"
RC=$?
set -e
assert_neq "0" "$RC" "kimi agent file without description fails preflight"
assert_contains "$(cat "$TEST_TMP/pf-broken.err")" "tool-less agent" "broken agent refusal is named"
assert_file_absent "$TEST_TMP/pf-broken/args.bin" "broken agent never reaches bwrap"

# negative control: kimi entry outside the node dir refused
set +e
run_fake "$TEST_TMP/pf-outside" 0 "$LAUNCHER" --preflight --profile kimi "${DENY_ARGS[@]}" \
  --bin "$STUBS/agy" --node-dir "$STUBS/nodedir" >/dev/null 2> "$TEST_TMP/pf-outside.err"
assert_eq "2" "$?" "kimi entry outside node dir exits 2"
set -e

# ---------- Part A: launch path (credentials copied here only; prompt never in argv) ----------
set +e
run_fake "$TEST_TMP/l-kimi" 0 "$LAUNCHER" --profile kimi --prompt-file "$STUBS/prompt.txt" \
  --out "$TEST_TMP/l-kimi.out" --err "$TEST_TMP/l-kimi.err" --timeout 20s --model kimi-code/k3 \
  --bin "$STUBS/nodedir/lib/kimi/main.mjs" --node-dir "$STUBS/nodedir" --cred-dir "$STUBS/credkimi" \
  --seat-root "$TEST_TMP/seat-l-kimi" --keep-seat > "$TEST_TMP/l-kimi.json"
RC=$?
set -e
assert_eq "0" "$RC" "kimi launch with fake bwrap exits 0"
A="$(args_lines "$TEST_TMP/l-kimi/args.bin")"
assert_contains "$A" "/opt/node" "kimi launch binds the node dir at /opt/node"
assert_contains "$A" "--hostname" "kimi launch argv has --hostname"
assert_not_contains "$A" "$STUBS/credkimi" "kimi launch argv never names the credential source"
assert_not_contains "$A" "$STUBS/hostrepo" "kimi launch argv has no repo path"
I="$(cat "$TEST_TMP/l-kimi/inner.txt")"
assert_contains "$I" "-m" "kimi inner argv has -m"
assert_contains "$I" "kimi-code/k3" "kimi inner argv has the model"
assert_contains "$I" "--agent-file" "kimi inner argv selects the tool-less agent file"
assert_not_contains "$I" "PROMPT-BODY" "kimi prompt text is not in host-visible argv"
assert_file_exists "$TEST_TMP/seat-l-kimi/home/.kimi-code/credentials/token" "kimi credential copied on launch path"
assert_file_exists "$TEST_TMP/seat-l-kimi/home/.kimi-code/config.toml" "kimi config copied on launch path"
assert_contains "$(cat "$TEST_TMP/l-kimi.json")" '"seat_root_removed": false' "kept seat reported for the audit"
rm -rf "$TEST_TMP/seat-l-kimi"

set +e
run_fake "$TEST_TMP/l-agy" 0 "$LAUNCHER" --profile agy --prompt-file "$STUBS/prompt.txt" \
  --out "$TEST_TMP/l-agy.out" --err "$TEST_TMP/l-agy.err" --timeout 20s --model gemini-x --effort low \
  --bin "$STUBS/agy" --cred-dir "$STUBS/credagy" --seat-root "$TEST_TMP/seat-l-agy" --keep-seat \
  > "$TEST_TMP/l-agy.json"
RC=$?
set -e
assert_eq "0" "$RC" "agy launch with fake bwrap exits 0"
A="$(args_lines "$TEST_TMP/l-agy/args.bin")"
assert_contains "$A" "/opt/agybin" "agy launch binds the agy binary"
assert_not_contains "$A" "$STUBS/credagy" "agy launch argv never names the credential source"
I="$(cat "$TEST_TMP/l-agy/inner.txt")"
assert_contains "$I" "autopilot-toolless-reviewer" "agy inner argv selects the tool-less agent"
assert_contains "$I" "--dangerously-skip-permissions" "agy inner argv keeps the existing flag set"
assert_not_contains "$I" "PROMPT-BODY" "agy prompt text is not in host-visible argv"
assert_file_exists "$TEST_TMP/seat-l-agy/home/.gemini/antigravity-cli/antigravity-oauth-token" "agy token copied on launch path"
assert_file_exists "$TEST_TMP/seat-l-agy/home/.gemini/antigravity-cli/agents/autopilot-toolless-reviewer/agent.md" \
  "agy tool-less agent written into the seat"
assert_file_exists "$TEST_TMP/seat-l-agy/home/.gemini/antigravity-cli/log" "agy log dir exists for the audit"
rm -rf "$TEST_TMP/seat-l-agy"

# missing credential -> refuse before launch
set +e
run_fake "$TEST_TMP/l-nocred" 0 "$LAUNCHER" --profile agy --prompt-file "$STUBS/prompt.txt" \
  --out "$TEST_TMP/nc.out" --err "$TEST_TMP/nc.err" --timeout 20s --model m --effort low \
  --bin "$STUBS/agy" --cred-dir "$TEST_TMP/no-such-cred" >/dev/null 2>&1
assert_eq "2" "$?" "agy launch without a credential exits 2"
set -e

# ---------- Part A: codex profile byte-identical to base ----------
BASEDIR="$TEST_TMP/base-launcher/lib"
mkdir -p "$BASEDIR"
git -C "$REPO_ROOT" show "$BASE_SHA:scripts/lib/cleanroom-launch.sh" > "$BASEDIR/cleanroom-launch.sh" 2>/dev/null \
  || fail "cannot extract base launcher at $BASE_SHA (need full history)"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$BASEDIR/json-emit.sh"
chmod +x "$BASEDIR/cleanroom-launch.sh"
BASE_L="$BASEDIR/cleanroom-launch.sh"

codex_capture() { # launcher tag rc mode -> writes $TEST_TMP/cx-<tag>/{args.bin,inner.txt,json,rc}
  local l="$1" tag="$2" rc="$3" mode="$4" cap="$TEST_TMP/cx-$2" seat="$TEST_TMP/cx-seat"
  rm -rf "$seat" "$cap"; mkdir -p "$cap"
  local bd="$TEST_TMP/cx-bin"; mkdir -p "$bd"; printf 'x\n' > "$bd/codex"
  local pk="$TEST_TMP/cx-pkt"; mkdir -p "$pk/tree"; printf 'pkt\n' > "$pk/tree/f"
  printf 'p\n' > "$TEST_TMP/cx-prompt"; printf '{}\n' > "$TEST_TMP/cx-auth"
  set +e
  if [ "$mode" = pf ]; then
    FAKE_BWRAP_CAPTURE="$cap" FAKE_BWRAP_RC="$rc" "$l" --preflight --deny-path "$STUBS/hostrepo" \
      --bwrap "$STUBS/fakebwrap" --seat-root "$seat" --keep-seat > "$cap/json" 2> "$cap/err"
  elif [ "$mode" = pfp ]; then
    FAKE_BWRAP_CAPTURE="$cap" FAKE_BWRAP_RC="$rc" "$l" --preflight --profile codex --deny-path "$STUBS/hostrepo" \
      --bwrap "$STUBS/fakebwrap" --seat-root "$seat" --keep-seat > "$cap/json" 2> "$cap/err"
  else
    FAKE_BWRAP_CAPTURE="$cap" FAKE_BWRAP_RC="$rc" "$l" --profile codex --packet-dir "$pk" \
      --prompt-file "$TEST_TMP/cx-prompt" --out "$cap/o" --err "$cap/e" --timeout 9s --model m --effort low \
      --bin-dir "$bd" --auth-file "$TEST_TMP/cx-auth" --bwrap "$STUBS/fakebwrap" \
      --seat-root "$seat" --keep-seat > "$cap/json" 2> "$cap/err"
  fi
  echo $? > "$cap/rc"
  set -e
  rm -rf "$seat"
}
for MODE in pf pfp launch; do
  for RCX in 0 2 3; do
    codex_capture "$BASE_L" "base-$MODE-$RCX" "$RCX" "$MODE"
    codex_capture "$LAUNCHER" "new-$MODE-$RCX" "$RCX" "$MODE"
    B="$TEST_TMP/cx-base-$MODE-$RCX"; N="$TEST_TMP/cx-new-$MODE-$RCX"
    assert_eq "$(cat "$B/rc")" "$(cat "$N/rc")" "codex $MODE rc=$RCX exit code matches base"
    cmp -s "$B/args.bin" "$N/args.bin" || fail "codex $MODE rc=$RCX bwrap argv differs from base"
    cmp -s "$B/inner.txt" "$N/inner.txt" || fail "codex $MODE rc=$RCX inner argv differs from base"
    cmp -s "$B/json" "$N/json" || fail "codex $MODE rc=$RCX stdout JSON differs from base"
  done
done
assert_eq "0" "$(cat "$TEST_TMP/cx-new-pf-0/rc")" "codex preflight green exits 0"
assert_eq "2" "$(cat "$TEST_TMP/cx-new-pf-2/rc")" "codex preflight runtime exits 2"
assert_eq "3" "$(cat "$TEST_TMP/cx-new-pf-3/rc")" "codex preflight deny exits 3"

# negative control: a mutated launcher (codex argv touched) must be caught by the same comparison
MUT="$TEST_TMP/mut/lib"; mkdir -p "$MUT"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$MUT/json-emit.sh"
sed '0,/^  append review$/s//  append reviewX/' "$LAUNCHER" > "$MUT/cleanroom-launch.sh"
chmod +x "$MUT/cleanroom-launch.sh"
codex_capture "$MUT/cleanroom-launch.sh" "mut" 0 launch
if cmp -s "$TEST_TMP/cx-base-launch-0/args.bin" "$TEST_TMP/cx-mut/args.bin"; then
  fail "negative control: mutated codex argv was NOT detected"
fi

# negative control: a credential bind injected into the preflight argv fails the assertion helper
CRED_MUT="$TEST_TMP/credmut/lib"; mkdir -p "$CRED_MUT"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$CRED_MUT/json-emit.sh"; cp "$REPO_ROOT/scripts/lib/agy-containment.js" "$CRED_MUT/"
sed 's#^    write_runner_probe$#    write_runner_probe; CRED_DIR="'"$STUBS/credagy"'"; copy_runner_credentials#' \
  "$LAUNCHER" > "$CRED_MUT/cleanroom-launch.sh"
chmod +x "$CRED_MUT/cleanroom-launch.sh"
set +e
run_fake "$TEST_TMP/credmut-cap" 0 "$CRED_MUT/cleanroom-launch.sh" --preflight --profile agy "${DENY_ARGS[@]}" \
  --bin "$STUBS/agy" --seat-root "$TEST_TMP/credmut-seat" --keep-seat >/dev/null 2>&1
set -e
if [ -f "$TEST_TMP/credmut-seat/home/.gemini/antigravity-cli/antigravity-oauth-token" ]; then
  : # the mutation put a credential in the preflight seat: the Part A seat check above would flag it
else
  fail "negative control: credential-copy mutation did not take effect (control is vacuous)"
fi

# ---------- Part B: real bwrap (host-gated) ----------
if [[ "${AUTOPILOT_HOST_ISOLATION:-}" != "1" ]]; then
  echo "SKIP part B: set AUTOPILOT_HOST_ISOLATION=1 for the real-bwrap kimi/agy suite"
  finalize_test
  exit 0
fi
command -v bwrap >/dev/null 2>&1 || fail "bwrap missing while AUTOPILOT_HOST_ISOLATION=1"

REPO_ABS="$(readlink -f "$REPO_ROOT")"
HOME_ABS="$(readlink -f "$HOME")"

# stub CLIs that report what the seat can see
SENTINEL="$TEST_TMP/host-sentinel"; printf 'host-secret\n' > "$SENTINEL"
report_body() {
  cat <<EOF
echo "HOSTNAME=\$(cat /proc/sys/kernel/hostname)"
echo "PWD=\$(pwd)"
echo "WORK_ENTRIES=\$(ls -A /home/review/work | wc -l)"
if ls "$HOME_ABS" >/dev/null 2>&1; then echo "HOME=readable"; else echo "HOME=DENIED"; fi
if cat "$REPO_ABS/package.json" >/dev/null 2>&1; then echo "REPO=readable"; else echo "REPO=DENIED"; fi
if cat "$SENTINEL" >/dev/null 2>&1; then echo "SENTINEL=readable"; else echo "SENTINEL=DENIED"; fi
if touch /home/review/work/x 2>/dev/null; then echo "WORK=writable"; else echo "WORK=readonly"; fi
if touch /usr/x 2>/dev/null; then echo "USR=writable"; else echo "USR=readonly"; fi
echo "ENV=\$(env | cut -d= -f1 | grep -v -E '^(PWD|SHLVL|_|OLDPWD)$' | sort | tr '\n' ' ')"
echo "HOMEDIR=\$(ls -A /home/review | tr '\n' ' ')"
echo "ARGS=\$*"
EOF
}
mkdir -p "$STUBS/rb/nodedir/bin" "$STUBS/rb/nodedir/lib/kimi"
{ printf '#!/bin/sh\n'; report_body; } > "$STUBS/rb/nodedir/bin/node"; chmod +x "$STUBS/rb/nodedir/bin/node"
printf '//\n' > "$STUBS/rb/nodedir/lib/kimi/main.mjs"
{ printf '#!/bin/sh\n'; report_body; } > "$STUBS/rb/agy"; chmod +x "$STUBS/rb/agy"
export TEST_ENV_LEAK_CANARY=leak-me

for R in kimi agy; do
  OUT="$TEST_TMP/rb-$R.out"
  if [ "$R" = kimi ]; then
    EXTRA=(--bin "$STUBS/rb/nodedir/lib/kimi/main.mjs" --node-dir "$STUBS/rb/nodedir" --cred-dir "$STUBS/credkimi")
  else
    EXTRA=(--bin "$STUBS/rb/agy" --effort low --cred-dir "$STUBS/credagy")
  fi
  set +e
  "$LAUNCHER" --profile "$R" --prompt-file "$STUBS/prompt.txt" --out "$OUT" --err "$TEST_TMP/rb-$R.err" \
    --timeout 20s --model m "${EXTRA[@]}" > "$TEST_TMP/rb-$R.json"
  RC=$?
  set -e
  assert_eq "0" "$RC" "$R real-bwrap stub launch exits 0 ($(head -c 200 "$TEST_TMP/rb-$R.err"))"
  O="$(cat "$OUT")"
  assert_contains "$O" "HOSTNAME=review" "$R seat hostname is review (flag proven in a real seat)"
  assert_contains "$O" "PWD=/home/review/work" "$R seat cwd is the empty work dir"
  assert_contains "$O" "WORK_ENTRIES=0" "$R seat work dir is empty"
  assert_contains "$O" "HOME=DENIED" "$R seat cannot read the operator HOME"
  assert_contains "$O" "REPO=DENIED" "$R seat cannot read the repo"
  assert_contains "$O" "SENTINEL=DENIED" "$R seat cannot read a host sentinel"
  assert_contains "$O" "WORK=readonly" "$R seat work dir is read-only"
  assert_contains "$O" "USR=readonly" "$R seat /usr is read-only"
  assert_not_contains "$O" "TEST_ENV_LEAK_CANARY" "$R seat env does not inherit the caller env"
  assert_contains "$O" "ENV=HOME PATH TERM" "$R seat env is exactly HOME PATH TERM"
  assert_contains "$O" "PROMPT-BODY" "$R stub receives the prompt inside the seat (read in-seat, not host argv)"
done
assert_contains "$(cat "$TEST_TMP/rb-kimi.out")" "HOMEDIR=.kimi-code agent.md" "kimi seat HOME holds only .kimi-code and the agent"
assert_contains "$(cat "$TEST_TMP/rb-agy.out")" "HOMEDIR=.gemini" "agy seat HOME holds only .gemini"

# real binaries, MODEL-FREE: preflight only (--version / `agy agents`); never a prompt
for R in kimi agy; do
  if ! command -v "$R" >/dev/null 2>&1; then
    echo "SKIP real $R preflight: $R not installed on this host"
    continue
  fi
  set +e
  "$LAUNCHER" --preflight --profile "$R" --deny-path "$REPO_ABS" --deny-path "$HOME_ABS" \
    > "$TEST_TMP/real-$R.json" 2> "$TEST_TMP/real-$R.err"
  RC=$?
  set -e
  assert_eq "0" "$RC" "real $R preflight is green on this host ($(head -c 200 "$TEST_TMP/real-$R.err"))"
  set +e
  "$LAUNCHER" --preflight --profile "$R" --deny-path /usr/bin/sh > /dev/null 2> "$TEST_TMP/real-$R-deny.err"
  assert_eq "3" "$?" "real $R preflight with a readable deny path exits 3"
  set -e
done
if command -v kimi >/dev/null 2>&1; then
  set +e
  "$LAUNCHER" --preflight --profile kimi --deny-path "$REPO_ABS" --agent-file "$STUBS/broken-agent.md" \
    > /dev/null 2> "$TEST_TMP/real-kimi-broken.err"
  assert_neq "0" "$?" "real kimi preflight refuses an agent file without description"
  set -e
fi

finalize_test
