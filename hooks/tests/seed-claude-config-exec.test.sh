#!/usr/bin/env bash
# seed-claude-config.js --exec removes the seeded dir on every child outcome, and --sweep only lists.
# Every case points CLAUDE_CONFIG_DIR and HOME at fixtures under $TEST_TMP. A case that can reach the
# real config dir is a bug.
. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
REAL="$TEST_TMP/real-claude-config"
mkdir -p "$REAL"
printf '%s\n' '{"fake":"FAKE-token"}' > "$REAL/.credentials.json"
export CLAUDE_CONFIG_DIR="$REAL"
PARENT="$TEST_TMP/parent"
mkdir -p "$PARENT"
SCRIPT="$REPO_ROOT/scripts/lib/seed-claude-config.js"

left() {
  find "$PARENT" -mindepth 1 -maxdepth 1 -type d -name 'claude-config-*' 2>/dev/null | wc -l | tr -d ' '
}

reset_parent() {
  rm -rf "$PARENT"
  mkdir -p "$PARENT"
}

# a. child true -> 0, nothing left
reset_parent
node "$SCRIPT" --exec --parent "$PARENT" -- true
assert_eq "$?" "0" "a: wrapper exits 0 when the child exits 0"
assert_eq "$(left)" "0" "a: no claude-config-* dir left"

# b. child exits 3
reset_parent
node "$SCRIPT" --exec --parent "$PARENT" -- bash -c 'exit 3'
assert_eq "$?" "3" "b: wrapper returns the child exit code"
assert_eq "$(left)" "0" "b: dir removed after a non-zero child"

# c. child SIGKILL
reset_parent
node "$SCRIPT" --exec --parent "$PARENT" -- bash -c 'kill -9 $$'
assert_eq "$?" "137" "c: child SIGKILL is wrapper rc 137"
assert_eq "$(left)" "0" "c: dir removed after SIGKILL of the child"

# d. child sees the seeded dir; stdio passes through
reset_parent
REC="$TEST_TMP/d-rec"
rm -f "$REC"
OUT="$(printf 'hello-stdin\n' | node "$SCRIPT" --exec --parent "$PARENT" -- bash -c 'ls -A "$CLAUDE_CONFIG_DIR" > "$1"; stat -c %a "$CLAUDE_CONFIG_DIR/.credentials.json" >> "$1"; printf "%s\n" "$CLAUDE_CONFIG_DIR" >> "$1"; cat' _ "$REC")"
assert_eq "$?" "0" "d: stdio child exits 0"
assert_eq "$OUT" "hello-stdin" "d: stdin and stdout pass through"
assert_eq "$(sed -n '1p' "$REC")" ".credentials.json" "d: seeded dir contains only .credentials.json"
assert_eq "$(sed -n '2p' "$REC")" "600" "d: credentials mode is 600"
case "$(sed -n '3p' "$REC")" in
  "$PARENT"/claude-config-*) ;;
  *) fail "d: CLAUDE_CONFIG_DIR is not inside --parent: $(sed -n '3p' "$REC")" ;;
esac
assert_eq "$(left)" "0" "d: dir removed after the stdio child"

# e. SIGTERM to the wrapper is forwarded; rc 143; dir gone
reset_parent
READY="$TEST_TMP/e-ready"
MARKER="$TEST_TMP/e-marker"
export READY MARKER
rm -f "$READY" "$MARKER"
cat > "$TEST_TMP/e-child.sh" <<'EOF'
#!/usr/bin/env bash
trap 'echo termed > "$MARKER"; exit 143' TERM
echo ready > "$READY"
sleep 30
EOF
chmod +x "$TEST_TMP/e-child.sh"
node "$SCRIPT" --exec --parent "$PARENT" -- "$TEST_TMP/e-child.sh" >/dev/null 2>&1 &
WPID=$!
i=0
while [ ! -e "$READY" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
kill -TERM "$WPID"
wait "$WPID"
assert_eq "$?" "143" "e: SIGTERM to the wrapper exits 143"
assert_eq "$(cat "$MARKER" 2>/dev/null)" "termed" "e: child trap saw SIGTERM"
assert_eq "$(left)" "0" "e: dir removed after SIGTERM"

# f. missing source credentials
reset_parent
mv "$REAL/.credentials.json" "$REAL/.credentials.json.off"
node "$SCRIPT" --exec --parent "$PARENT" -- true >/dev/null 2>"$TEST_TMP/f.err"
assert_eq "$?" "2" "f: missing source credentials exits 2"
assert_eq "$(left)" "0" "f: nothing created"
mv "$REAL/.credentials.json.off" "$REAL/.credentials.json"

# g. --sweep lists and does not delete
reset_parent
mkdir -p "$PARENT/claude-config-b" "$PARENT/claude-config-a"
printf '%s\n' '{"fake":"FAKE-token"}' > "$PARENT/claude-config-b/.credentials.json"
printf '%s\n' '{"fake":"FAKE-token"}' > "$PARENT/claude-config-a/.credentials.json"
SWEEP="$(node "$SCRIPT" --sweep "$PARENT")"
assert_eq "$?" "1" "g: sweep exits 1 when leftovers exist"
A="$(cd "$PARENT/claude-config-a" && pwd)/.credentials.json"
B="$(cd "$PARENT/claude-config-b" && pwd)/.credentials.json"
assert_eq "$SWEEP" "$(printf '%s\n%s' "$A" "$B")" "g: sweep prints absolute paths, sorted"
assert_eq "$(test -f "$A" && test -f "$B" && echo yes)" "yes" "g: sweep does not delete"
EMPTY="$(node "$SCRIPT" --sweep "$PARENT/clean-absent-but-make")"
# clean parent that exists
mkdir -p "$PARENT/clean"
EMPTY="$(node "$SCRIPT" --sweep "$PARENT/clean")"
assert_eq "$?" "0" "g: clean parent exits 0"
assert_eq "$EMPTY" "" "g: clean parent prints nothing"
node "$SCRIPT" --sweep "$PARENT/does-not-exist" >/dev/null
assert_eq "$?" "0" "g: missing parent exits 0"

# h. single-shot unchanged
reset_parent
SHOT="$(node "$SCRIPT" --parent "$PARENT")"
assert_eq "$?" "0" "h: single-shot exits 0"
test -d "$SHOT"
assert_eq "$?" "0" "h: printed path exists"
assert_eq "$(ls -A "$SHOT" | tr '\n' ' ')" ".credentials.json " "h: only .credentials.json"
rm -rf "$SHOT"
assert_eq "$(left)" "0" "h: the test removed the single-shot dir"

# usage
node "$SCRIPT" --exec >/dev/null 2>&1
assert_eq "$?" "2" "exec without -- exits 2"
node "$SCRIPT" --check --exec -- true >/dev/null 2>&1
assert_eq "$?" "2" "--check with --exec exits 2"

# j. SIGTERM in the seeding window (test-only pause after the credentials copy is written): dir gone
for SIGNAME in TERM HUP INT; do
  reset_parent
  SEED_TEST_PAUSE_AFTER_WRITE_MS=3000 node "$SCRIPT" --exec --parent "$PARENT" -- sleep 30 >/dev/null 2>&1 &
  WPID=$!
  i=0
  while [ -z "$(find "$PARENT" -name .credentials.json 2>/dev/null)" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i + 1)); done
  kill -"$SIGNAME" "$WPID"
  wait "$WPID" 2>/dev/null
  assert_eq "$(left)" "0" "j: SIG$SIGNAME inside the seeding window leaves no claude-config-* dir"
done

# i. negative control: neutralising fs.rmSync must leave a dir (the leftover check can fail)
MUT="$TEST_TMP/seed-noclean.js"
cp "$SCRIPT" "$MUT"
sed_mutate "$MUT" 's/fs\.rmSync(/(()=>{})(/'
reset_parent
node "$MUT" --exec --parent "$PARENT" -- true >/dev/null
assert_neq "$(left)" "0" "i: negative control leaves a claude-config-* dir when removal is neutralised"
rm -rf "$PARENT"/claude-config-*

finalize_test
