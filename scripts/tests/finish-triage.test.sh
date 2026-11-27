#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$REPO_ROOT/scripts/lib/test-git-env.sh"
SCRIPT="$REPO_ROOT/scripts/finish-triage.js"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

export HOME="$TMPDIR/home"
mkdir -p "$HOME"

# Create a minimal git repo for --repo
TEST_REPO="$TMPDIR/repo"
mkdir -p "$TEST_REPO"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email "test@example.com"
git -C "$TEST_REPO" config user.name "Test"
echo "hello" > "$TEST_REPO/README.md"
git -C "$TEST_REPO" add README.md
git -C "$TEST_REPO" commit -q -m "init"
MERGED_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
SHA16="${MERGED_SHA:0:16}"

# Helper to write stub fleet script
STUB_FLEET="$TMPDIR/stub-fleet"
write_stub_fleet() {
  local json_file="$1"
  cat > "$STUB_FLEET" <<EOF
#!/usr/bin/env bash
cat "$json_file"
EOF
  chmod +x "$STUB_FLEET"
}
export FINISH_TRIAGE_FLEET_BIN="$STUB_FLEET"

# Helper to build a valid command evidence file
make_cmd_file() {
  local out_file="$1"
  local rc_val="$2"
  local body="$3"
  local sha
  sha="$(printf '%s' "$body" | sha256sum | awk '{print $1}')"
  {
    echo "cmd: node -v"
    echo "rc=$rc_val"
    echo "out-sha256: $sha"
    printf '%s\n' "$body"
  } > "$out_file"
}

# Helper to build a valid PNG (>=2048 bytes) + .meta
make_png_file() {
  local png_file="$1"
  local result_val="$2"
  local meta_sha="$3"
  node -e "
    const fs = require('fs');
    const magic = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    const pad = Buffer.alloc(2048, 0x41);
    fs.writeFileSync(process.argv[1], Buffer.concat([magic, pad]));
  " "$png_file"
  local png_sha
  png_sha="$(sha256sum "$png_file" | awk '{print $1}')"
  cat > "${png_file}.meta" <<EOF
png-sha256: $png_sha
action: verify-ui
result: $result_val
sha: $meta_sha
EOF
}

pass=0
fail=0

assert_ok() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass=$((pass + 1))
  else
    echo "FAIL (expected 0): $name" >&2
    fail=$((fail + 1))
  fi
}

assert_fail() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL (expected non-zero): $name" >&2
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
}

# 1. Positive: Used: command + Pinned: host sha16 -> exit 0, skip
CMD_OK="$TMPDIR/cmd_ok.txt"
make_cmd_file "$CMD_OK" 0 $'line1\nline2\nline3 sha='"$SHA16"
cat > "$TMPDIR/task_ok.json" <<EOF
{
  "id": "T1",
  "state": "done",
  "progress": "",
  "comments": [
    {"author": "dev", "at": "2026-11-25T00:00:00Z", "text": "Pinned: host-a $SHA16\nUsed: command $CMD_OK"}
  ]
}
EOF
write_stub_fleet "$TMPDIR/task_ok.json"
assert_ok "positive command + pinned sha16" node "$SCRIPT" --task T1 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 2. Positive: Used: screenshot + Pin: not-needed (>=20 chars)
PNG_OK="$TMPDIR/ss_ok.png"
make_png_file "$PNG_OK" "ok" "$SHA16"
cat > "$TMPDIR/task_ss.json" <<EOF
{
  "id": "T2",
  "state": "done",
  "comments": [
    {"author": "dev", "at": "2026-11-25T00:00:00Z", "text": "Pin: not-needed local-only CLI change with no live daemon\nUsed: screenshot $PNG_OK"}
  ]
}
EOF
write_stub_fleet "$TMPDIR/task_ss.json"
assert_ok "positive screenshot + pin not-needed" node "$SCRIPT" --task T2 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 2b. Negative control: Pin: not-needed is refused when the diff touches a plugin-shipped path
mkdir -p "$TEST_REPO/hooks"
echo "x" > "$TEST_REPO/hooks/new-gate.js"
git -C "$TEST_REPO" add hooks/new-gate.js
git -C "$TEST_REPO" commit -q -m "add hook"
SHIPPED_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
SHIPPED16="${SHIPPED_SHA:0:16}"
PNG_SH="$TMPDIR/ss_shipped.png"
make_png_file "$PNG_SH" "ok" "$SHIPPED16"
cat > "$TMPDIR/task_shipped.json" <<JSON
{
  "id": "T2b",
  "state": "done",
  "comments": [
    {"author": "dev", "at": "2026-11-25T00:00:00Z", "text": "Pin: not-needed local-only CLI change with no live daemon\nUsed: screenshot $PNG_SH"}
  ]
}
JSON
write_stub_fleet "$TMPDIR/task_shipped.json"
assert_fail "negative pin not-needed with plugin-shipped diff" node "$SCRIPT" --task T2b --sha "$SHIPPED_SHA" --repo "$TEST_REPO"

# 3. Positive triage: First-live: yes -> look
cat > "$TMPDIR/task_first_live.json" <<EOF
{
  "id": "T3",
  "state": "done",
  "comments": [
    {"author": "dev", "at": "2026-11-25T00:00:00Z", "text": "Pinned: host-a $SHA16\nUsed: command $CMD_OK\nFirst-live: yes"}
  ]
}
EOF
write_stub_fleet "$TMPDIR/task_first_live.json"
OUT_T3="$(node "$SCRIPT" --task T3 --sha "$MERGED_SHA" --repo "$TEST_REPO" --json)"
if printf '%s' "$OUT_T3" | grep -q '"decision": "look"'; then
  pass=$((pass + 1))
else
  echo "FAIL: First-live: yes should triage to look" >&2
  fail=$((fail + 1))
fi

# 4. Negative controls (all must exit non-zero)
# 4a. Placeholder n/a|TBD|none|-
for ph in "n/a" "TBD" "none" "-"; do
  cat > "$TMPDIR/task_ph.json" <<EOF
{"id":"T4","comments":[{"author":"a","at":"t","text":"Pinned: $ph $SHA16\nUsed: command $CMD_OK"}]}
EOF
  write_stub_fleet "$TMPDIR/task_ph.json"
  assert_fail "negative placeholder ($ph)" node "$SCRIPT" --task T4 --sha "$MERGED_SHA" --repo "$TEST_REPO"
done

# 4b. Empty command file
EMPTY_CMD="$TMPDIR/empty.txt"
: > "$EMPTY_CMD"
cat > "$TMPDIR/task_empty.json" <<EOF
{"id":"T5","comments":[{"author":"a","at":"t","text":"Pinned: host-a $SHA16\nUsed: command $EMPTY_CMD"}]}
EOF
write_stub_fleet "$TMPDIR/task_empty.json"
assert_fail "negative empty file" node "$SCRIPT" --task T5 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 4c. Output < 3 lines
SHORT_CMD="$TMPDIR/short.txt"
make_cmd_file "$SHORT_CMD" 0 $'line1\nline2 '"$SHA16"
cat > "$TMPDIR/task_short.json" <<EOF
{"id":"T6","comments":[{"author":"a","at":"t","text":"Pinned: host-a $SHA16\nUsed: command $SHORT_CMD"}]}
EOF
write_stub_fleet "$TMPDIR/task_short.json"
assert_fail "negative output < 3 lines" node "$SCRIPT" --task T6 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 4d. Output modified (sha256 mismatch)
MOD_CMD="$TMPDIR/mod.txt"
cp "$CMD_OK" "$MOD_CMD"
echo "tampered" >> "$MOD_CMD"
cat > "$TMPDIR/task_mod.json" <<EOF
{"id":"T7","comments":[{"author":"a","at":"t","text":"Pinned: host-a $SHA16\nUsed: command $MOD_CMD"}]}
EOF
write_stub_fleet "$TMPDIR/task_mod.json"
assert_fail "negative output modified" node "$SCRIPT" --task T7 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 4e. PNG swapped (png-sha256 mismatch)
PNG_SWAP="$TMPDIR/ss_swap.png"
make_png_file "$PNG_SWAP" "ok" "$SHA16"
printf 'extra' >> "$PNG_SWAP"
cat > "$TMPDIR/task_swap.json" <<EOF
{"id":"T8","comments":[{"author":"a","at":"t","text":"Pinned: host-a $SHA16\nUsed: screenshot $PNG_SWAP"}]}
EOF
write_stub_fleet "$TMPDIR/task_swap.json"
assert_fail "negative png swapped" node "$SCRIPT" --task T8 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 4f. result not ok in .meta
PNG_BADRES="$TMPDIR/ss_badres.png"
make_png_file "$PNG_BADRES" "fail" "$SHA16"
cat > "$TMPDIR/task_badres.json" <<EOF
{"id":"T9","comments":[{"author":"a","at":"t","text":"Pinned: host-a $SHA16\nUsed: screenshot $PNG_BADRES"}]}
EOF
write_stub_fleet "$TMPDIR/task_badres.json"
assert_fail "negative meta result != ok" node "$SCRIPT" --task T9 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 4g. sha16 mismatch
cat > "$TMPDIR/task_badsha.json" <<EOF
{"id":"T10","comments":[{"author":"a","at":"t","text":"Pinned: host-a 0000000000000000\nUsed: command $CMD_OK"}]}
EOF
write_stub_fleet "$TMPDIR/task_badsha.json"
assert_fail "negative sha16 mismatch" node "$SCRIPT" --task T10 --sha "$MERGED_SHA" --repo "$TEST_REPO"

# 4h. rc != 0 in command file
RC1_CMD="$TMPDIR/rc1.txt"
make_cmd_file "$RC1_CMD" 1 $'line1\nline2\nline3 '"$SHA16"
cat > "$TMPDIR/task_rc1.json" <<EOF
{"id":"T11","comments":[{"author":"a","at":"t","text":"Pinned: host-a $SHA16\nUsed: command $RC1_CMD"}]}
EOF
write_stub_fleet "$TMPDIR/task_rc1.json"
assert_fail "negative rc != 0" node "$SCRIPT" --task T11 --sha "$MERGED_SHA" --repo "$TEST_REPO"

echo "finish-triage.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
