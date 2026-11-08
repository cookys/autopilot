#!/usr/bin/env bash
# Tests for the credential-file fallback of scripts/resolve-endpoint.sh: a var that is not set in
# the process env is filled from ${AUTOPILOT_ENDPOINTS_ENV:-$HOME/.autopilot/endpoints.env}, but only
# when the file is a regular non-symlink file owned by the current uid with mode exactly 0600.
# Fixtures only: HOME and the file live under mktemp, every token is a FAKE- value. Each check has
# a negative control: a sed_mutant copy of the script with the guarded line removed must go red.
. "$(dirname "$0")/lib.sh"

R="$REPO_ROOT/scripts/resolve-endpoint.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; cleanup_test_tmp' EXIT

FAKE_TOKEN="FAKE-TOKEN-7f3a91c2"
FAKE_URL="https://glm.example.invalid/anthropic"
drop() { mkdir -p "$WORK/trash"; [ -e "$1" ] && mv -f "$1" "$WORK/trash/$RANDOM.$$"; return 0; }
HOMEDIR="$WORK/home"; mkdir -p "$HOMEDIR/.autopilot"
EF="$HOMEDIR/.autopilot/endpoints.env"

write_good() {
  drop "$EF"
  printf '# comment\nexport AUTOPILOT_ENDPOINT_GLM_URL=%s\nAUTOPILOT_ENDPOINT_GLM_TOKEN="%s"\n' "$FAKE_URL" "$FAKE_TOKEN" > "$EF"
  chmod 600 "$EF"
}

# run_r <script> [VAR=val ...] -> OUT ERR EC ; HOME is the fixture, nothing else leaks in.
run_r() {
  local script="$1"; shift
  OUT="$(env -i PATH="$PATH" HOME="$HOMEDIR" "$@" bash "$script" glm 2>"$WORK/err")"; EC=$?
  ERR="$(cat "$WORK/err")"
}

# mutant <name> <sed-cmd> -> $WORK/mut-<name>/resolve-endpoint.sh (lib dir copied beside it)
mutant() {
  local d="$WORK/mut-$1"; mkdir -p "$d"; cp -r "$REPO_ROOT/scripts/lib" "$d/lib"
  sed_mutant "$R" "$d/resolve-endpoint.sh" "$2" || return 1
  MUT="$d/resolve-endpoint.sh"
}

# (a) env empty, file 0600 and ours -> ready, token_present, no token value anywhere
write_good
run_r "$R"
assert_exit_code "$EC" 0 "(a) file fallback: exits 0"
assert_contains "$OUT" '"ready":true' "(a) ready"
assert_contains "$OUT" '"token_present":true' "(a) token_present"
assert_contains "$OUT" "\"base_url\":\"$FAKE_URL\"" "(a) base_url reported"
assert_not_contains "$OUT$ERR" "$FAKE_TOKEN" "(a) token value not in output"
mutant a 's|^endpoints_file_fallback \|\| true$|:|' || fail "(a) mutant not applied"
run_r "$MUT"
assert_contains "$OUT" '"ready":false' "(a) NEG: without the fallback call it is not ready"

# MiniMax uses the namespace layer (AUTOPILOT_ENDPOINT_MINIMAX_*), not MINIMAX_API_KEY
drop "$EF"
printf 'AUTOPILOT_ENDPOINT_MINIMAX_URL=https://mm.example.invalid/anthropic\nAUTOPILOT_ENDPOINT_MINIMAX_TOKEN=%s\n' "$FAKE_TOKEN" > "$EF"; chmod 600 "$EF"
mm="$(env -i PATH="$PATH" HOME="$HOMEDIR" bash "$R" minimax 2>&1)"
assert_contains "$mm" '"source":"autopilot-namespace"' "minimax resolves from the namespace layer"
assert_contains "$mm" '"ready":true' "minimax ready from file"
assert_not_contains "$mm" "$FAKE_TOKEN" "minimax: no token value in output"

# (b) mode 0644 -> refused, reason names the mode
write_good; chmod 644 "$EF"
run_r "$R"
assert_contains "$OUT" '"ready":false' "(b) 0644: not ready"
assert_contains "$OUT" '"token_present":false' "(b) 0644: no token"
assert_contains "$ERR" 'mode 0644, expected 0600' "(b) 0644: reason names the mode"
assert_not_contains "$OUT$ERR" "$FAKE_TOKEN" "(b) token value not in output"
mutant b 's|\[ "\$mode" != "600" \]|[ "$mode" = "never" ]|' || fail "(b) mutant not applied"
run_r "$MUT"
assert_contains "$OUT" '"ready":true' "(b) NEG: without the mode check a 0644 file is read"

# (c) symlink -> refused
write_good
mv "$EF" "$WORK/real.env"; ln -s "$WORK/real.env" "$EF"
run_r "$R"
assert_contains "$OUT" '"ready":false' "(c) symlink: not ready"
assert_contains "$ERR" 'symlink' "(c) symlink: reason"
mutant c 's|if \[ -L "\$f" \]; then|if [ -L "$f.never" ]; then|' || fail "(c) mutant not applied"
# a link's own mode is 777, so the mode gate would still catch it: make stat follow links too
sed_mutate "$MUT" 's|stat -c|stat -L -c|g' || fail "(c) second mutation not applied"
run_r "$MUT"
assert_contains "$OUT" '"ready":true' "(c) NEG: without the symlink check the link is followed"
drop "$EF"

# (d) not owned by the current uid: /etc/passwd is a root-owned regular file; only its owner is
# looked at (never its content). Skipped when the tests run as root.
if [ "$(id -u)" != "0" ] && [ -f /etc/passwd ] && [ ! -L /etc/passwd ]; then
  run_r "$R" AUTOPILOT_ENDPOINTS_ENV=/etc/passwd
  assert_contains "$OUT" '"ready":false' "(d) other owner: not ready"
  assert_contains "$ERR" 'not owned' "(d) other owner: reason"
  # The mutant also drops the mode gate so the owner check is the only thing under test.
  mutant d 's|\[ "\$owner" != "\$(id -u)" \]|[ "$owner" = "never" ]|' || fail "(d) mutant not applied"
  run_r "$MUT" AUTOPILOT_ENDPOINTS_ENV=/etc/passwd
  assert_not_contains "$ERR" 'not owned' "(d) NEG: without the owner check that reason is gone"
else
  echo "SKIP (d): running as root or /etc/passwd unusable"
fi

# (e) env already has the values -> env wins, file not used
write_good
run_r "$R" AUTOPILOT_ENDPOINT_GLM_URL=https://env.example.invalid/x AUTOPILOT_ENDPOINT_GLM_TOKEN=FAKE-ENV-TOKEN
assert_contains "$OUT" '"base_url":"https://env.example.invalid/x"' "(e) env url wins over the file"
assert_not_contains "$OUT" "$FAKE_URL" "(e) file url not used"
mutant e 's|\[ -n "\${!key+x}" \] && continue|false \&\& continue|' || fail "(e) mutant not applied"
run_r "$MUT" AUTOPILOT_ENDPOINT_GLM_URL=https://env.example.invalid/x AUTOPILOT_ENDPOINT_GLM_TOKEN=FAKE-ENV-TOKEN
assert_contains "$OUT" "$FAKE_URL" "(e) NEG: without the precedence check the file overrides env"

# (f) $(...) and backticks in the file are never executed
MARK="$WORK/executed.marker"
drop "$EF"
{
  printf 'AUTOPILOT_ENDPOINT_GLM_URL=%s/$(touch %s)\n' "$FAKE_URL" "$MARK"
  printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=%s`touch %s`\n' "$FAKE_TOKEN" "$MARK"
  printf 'BAD_KEY=$(touch %s)\n' "$MARK"
  printf '$(touch %s)\n' "$MARK"
} > "$EF"; chmod 600 "$EF"
run_r "$R"
[ ! -e "$MARK" ] && assert_eq ok ok "(f) nothing in the file was executed" || fail "(f) the file was executed"
assert_not_contains "$OUT$ERR" "$FAKE_TOKEN" "(f) token value not in output"
mutant f 's|^  local line key val$|  local line key val; . "$f" >/dev/null 2>\&1|' || fail "(f) mutant not applied"
drop "$MARK"; run_r "$MUT"
[ -e "$MARK" ] && assert_eq ok ok "(f) NEG: sourcing the file runs the substitution" || fail "(f) NEG: mutant did not execute the file"

# (g) the token never reaches stdout or stderr, in single and --list mode
write_good
run_r "$R"
lst="$(env -i PATH="$PATH" HOME="$HOMEDIR" bash "$R" --list 2>&1)"
assert_not_contains "$OUT$ERR$lst" "$FAKE_TOKEN" "(g) no token value in single or --list output"
assert_contains "$lst" '"name":"glm"' "(g) --list sees the file endpoint"
mutant g 's|^  local -a missing=()$|&; printf "%s\\n" "${!ns_token_var-}" >\&2|' || fail "(g) mutant not applied"
run_r "$MUT"
assert_contains "$ERR" "$FAKE_TOKEN" "(g) NEG: a leaking mutant is caught by the same grep"

# no file at all -> silent no-op
drop "$EF"
run_r "$R"
assert_contains "$OUT" '"ready":false' "no file: not ready"
assert_eq "$ERR" "" "no file: silent"
