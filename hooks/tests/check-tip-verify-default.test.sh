#!/usr/bin/env bash
# check-tip-verify-default.sh: OK/NONE, placeholder skip, grace update never adds.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_TIP_VERIFY_GRACE_FILE AUTOPILOT_TIP_VERIFY_REQUIRE

READER="$REPO_ROOT/scripts/lib/tip-verify-repo-default.js"
CHECK_SRC="$REPO_ROOT/scripts/check-tip-verify-default.sh"
REAL_GRACE="$REPO_ROOT/scripts/lib/tip-verify-grace.json"
REAL_CFG="$REPO_ROOT/.claude/quality-gate-config.md"
ERR="$TEST_TMP/err.txt"
TREE="$TEST_TMP/scripts"
mkdir -p "$TREE/lib"
cp "$CHECK_SRC" "$TREE/check-tip-verify-default.sh"
cp "$READER" "$TREE/lib/tip-verify-repo-default.js"
chmod +x "$TREE/check-tip-verify-default.sh" "$TREE/lib/tip-verify-repo-default.js"
CHECK="$TREE/check-tip-verify-default.sh"
GRACE="$TREE/lib/tip-verify-grace.json"
cp "$REAL_GRACE" "$GRACE"
GRACE_BEFORE="$(cksum "$REAL_GRACE")"

USAGE='usage: check-tip-verify-default.sh [--update-grace] <repo-dir>[@<ref>] ...'

if grep -q 'AUTOPILOT_TIP_VERIFY_GRACE_FILE' "$CHECK_SRC"; then
  fail "checker must not read the test-only grace env"
fi

run() {
  EXIT=0
  OUT="$("$CHECK" "$@" 2>"$ERR")" || EXIT=$?
}

gitc() {
  local dir="$1"
  shift
  git -C "$dir" "$@"
}

init_repo() {
  local dir="$1" name="$2"
  mkdir -p "$dir"
  git -C "$dir" init -q -b develop
  gitc "$dir" commit -q --allow-empty -m base
  git -C "$dir" remote add origin "https://example.invalid/org/${name}.git"
}

commit_cfg() {
  local dir="$1" msg="$2" body="$3"
  mkdir -p "$dir/.claude"
  printf '%s\n' "$body" > "$dir/.claude/quality-gate-config.md"
  git -C "$dir" add .claude/quality-gate-config.md
  gitc "$dir" commit -q -m "$msg"
}

# --- CLI of the shared reader matches the old heredoc, byte for byte ---
OLD="$TEST_TMP/old-reader.js"
cat > "$OLD" <<'EOF'
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
function executableLooking(cmd) {
  const trimmed = String(cmd).trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const token = trimmed.split(/\s+/)[0];
  if (token.startsWith('./') || token.startsWith('../') || token.startsWith('/')) return true;
  return /^[A-Za-z][A-Za-z0-9_+-]*$/.test(token);
}
function hasPlaceholder(s) {
  return /<[A-Za-z_][A-Za-z0-9_-]*>/.test(s);
}
const lines = text.split(/\n/);
let inSection = false;
let fence = null;
const cmds = [];
for (const line of lines) {
  if (!inSection) {
    if (/^## Test Command\s*$/.test(line)) inSection = true;
    continue;
  }
  if (/^## /.test(line)) break;
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) {
    if (fence !== null) fence = null;
    else {
      const lang = trimmed.slice(3).trim().split(/\s+/)[0] || '';
      fence = (lang === '' || lang === 'bash' || lang === 'sh') ? 'cmd' : 'other';
    }
    continue;
  }
  let candidate = null;
  if (fence === 'cmd') candidate = trimmed;
  else if (fence === null) {
    const m = trimmed.match(/^`([^`\n]+)`$/);
    if (m) candidate = m[1].trim();
  }
  if (candidate === null || !candidate || hasPlaceholder(candidate)) continue;
  if (executableLooking(candidate)) cmds.push(candidate);
}
if (cmds.length) process.stdout.write(JSON.stringify(cmds));
EOF

node "$READER" "$REAL_CFG" > "$TEST_TMP/lib.out"
node "$OLD" "$REAL_CFG" > "$TEST_TMP/old.out"
cmp -s "$TEST_TMP/lib.out" "$TEST_TMP/old.out" || fail "lib stdout differs from the old heredoc on the real config"
printf '%s' '["node scripts/affected-suites.js --base develop --run"]' > "$TEST_TMP/golden.out"
cmp -s "$TEST_TMP/lib.out" "$TEST_TMP/golden.out" || fail "real config command is not the affected-suites fence"
node -e 'const m=require(process.argv[1]); const fs=require("fs"); const t=fs.readFileSync(process.argv[2],"utf8"); const c=m.commandsFromText(t); if (c.length) process.stdout.write(JSON.stringify(c));' \
  "$READER" "$REAL_CFG" > "$TEST_TMP/mod.out"
cmp -s "$TEST_TMP/lib.out" "$TEST_TMP/mod.out" || fail "commandsFromText disagrees with the CLI"

EXIT=0
node "$READER" >/dev/null 2>"$ERR" || EXIT=$?
assert_eq "$EXIT" "2" "reader with no file exits 2"
assert_eq "$(cat "$ERR")" "usage: node scripts/lib/tip-verify-repo-default.js <config-file>" "reader usage line"

NAME_OUT="$(node -e 'const m=require(process.argv[1]); process.stdout.write([m.repoName(process.argv[2], process.argv[3]), m.repoName("", "/work/aaa-race-cc-haiku55"), m.repoName("git"+"@example.invalid:org/aaa-race-cc-haiku55.git", "/ignored")].join("\n"))' \
  "$READER" "https://example.invalid/org/fleet.git" "/work/other")"
assert_eq "$NAME_OUT" $'fleet\naaa-race-cc-haiku55\naaa-race-cc-haiku55' "repoName strips .git and falls back to toplevel"

SEED="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (JSON.stringify(j).includes("@")) process.exit(3); const rows=j.repos.map(r=>r.name+" "+r.owner+" "+Object.keys(r).sort().join(",")); process.stdout.write(rows.join("\n"));' "$REAL_GRACE")" || fail "seed grace file is not the two short-name rows"
assert_eq "$SEED" $'fleet fleet--claude name,owner\naaa-race-cc-haiku55 game-lead--claude name,owner' "seed grace rows"

# --- usage ---
run --help
assert_eq "$EXIT" "0" "--help exits 0"
assert_eq "$OUT" "$USAGE" "--help prints usage only"
assert_eq "$(cat "$ERR")" "" "--help stderr is empty"
run --update-grace --help
assert_eq "$EXIT" "0" "--help before work exits 0"
assert_eq "$OUT" "$USAGE" "--help with other flags still prints usage only"
run
assert_eq "$EXIT" "1" "no args exits 1"
assert_eq "$OUT" "" "no args prints nothing on stdout"
assert_eq "$(cat "$ERR")" "$USAGE" "no args prints usage on stderr"
run --nope
assert_eq "$EXIT" "1" "unknown flag exits 1"
assert_eq "$(cat "$ERR")" "$USAGE" "unknown flag prints usage on stderr"
run --
assert_eq "$EXIT" "1" "only -- exits 1"

# --- repos ---
DROP="$TEST_TMP/drop-me"
INLINE="$TEST_TMP/inline"
PH="$TEST_TMP/ph"
STAY="$TEST_TMP/stay"
MISS="$TEST_TMP/missing"
BAD="$TEST_TMP/badref"
PLAIN="$TEST_TMP/plaindir"
REF="$TEST_TMP/refrepo"
AT="$TEST_TMP/foo@bar"
STRANGER="$TEST_TMP/stranger"

init_repo "$DROP" drop-me
commit_cfg "$DROP" cfg "$(cat <<'EOF'
## Test Command

```bash
true
false
```
EOF
)"

init_repo "$INLINE" inline
commit_cfg "$INLINE" cfg "$(cat <<'EOF'
## Test Command

`true`
EOF
)"

init_repo "$PH" ph
commit_cfg "$PH" cfg "$(cat <<'EOF'
## Test Command

```bash
bash <target>
```
EOF
)"

init_repo "$STAY" stay
commit_cfg "$STAY" cfg "$(cat <<'EOF'
## Test Command

1. `true`

```python
true
```
EOF
)"

init_repo "$MISS" missing

init_repo "$BAD" badref
commit_cfg "$BAD" cfg "$(cat <<'EOF'
## Test Command

`true`
EOF
)"

mkdir -p "$PLAIN"

init_repo "$REF" refrepo
commit_cfg "$REF" good "$(cat <<'EOF'
## Test Command

```bash
true
```
EOF
)"
commit_cfg "$REF" prose "$(cat <<'EOF'
## Test Command

Run the suite when you can.
EOF
)"

init_repo "$AT" "foo@bar"
commit_cfg "$AT" cfg "$(cat <<'EOF'
## Test Command

`true`
EOF
)"

init_repo "$STRANGER" stranger
commit_cfg "$STRANGER" cfg "$(cat <<'EOF'
## Test Command

`true`
EOF
)"

run "$DROP"
assert_eq "$EXIT" "0" "fenced true/false exits 0"
assert_eq "$OUT" 'OK drop-me ["true","false"]' "fenced true/false is OK"

run "$INLINE"
assert_eq "$EXIT" "0" "whole-line inline span exits 0"
assert_eq "$OUT" 'OK inline ["true"]' "whole-line inline span is a command"

run "$PH"
assert_eq "$EXIT" "1" "placeholder-only exits 1"
assert_eq "$OUT" "NONE ph no-command" "placeholder fence is not a command"

run "$STAY"
assert_eq "$EXIT" "1" "numbered span plus python fence exits 1"
assert_eq "$OUT" "NONE stay no-command" "numbered span and other-language fence are not commands"

run "$MISS"
assert_eq "$EXIT" "1" "missing config exits 1"
assert_eq "$OUT" "NONE missing missing-config" "missing config reason"

run "${BAD}@no-such-ref"
assert_eq "$EXIT" "1" "bad ref exits 1"
assert_eq "$OUT" "NONE badref bad-ref" "bad ref reason"

run "$PLAIN"
assert_eq "$EXIT" "1" "plain dir exits 1"
assert_eq "$OUT" "NONE plaindir not-a-repo" "plain dir reason"

run "$REF"
assert_eq "$OUT" "NONE refrepo no-command" "HEAD prose is no-command"
run "${REF}@HEAD~1"
assert_eq "$EXIT" "0" "older ref with a command exits 0"
assert_eq "$OUT" 'OK refrepo ["true"]' "HEAD~1 is the fenced true"

run -- "$DROP"
assert_eq "$EXIT" "0" "-- is not a repo argument"
assert_eq "$OUT" 'OK drop-me ["true","false"]' "-- still checks the repo"

run "$AT"
assert_eq "$EXIT" "0" "directory whose name contains @ is not split"
assert_eq "$OUT" 'OK foo@bar ["true"]' "existing directory keeps the @ in the repo name"

run "$DROP" "$STAY"
assert_eq "$EXIT" "1" "mixed OK and NONE exits 1"
assert_eq "$OUT" $'OK drop-me ["true","false"]\nNONE stay no-command' "mixed lines keep argument order"

# --- --update-grace removes only listed OK repos and never adds ---
cat > "$GRACE" <<'EOF'
{
  "repos": [
    {"name": "fleet", "owner": "fleet--claude"},
    {"name": "drop-me", "owner": "lane-drop"},
    {"name": "stay", "owner": "lane-stay"}
  ]
}
EOF
GRACE_SNAP="$(cat "$GRACE")"
run "$STAY" --update-grace
assert_eq "$EXIT" "1" "NONE-only update exits 1"
assert_eq "$OUT" $'NONE stay no-command\nremaining 3' "NONE-only update removes nothing"
assert_eq "$(cat "$GRACE")" "$GRACE_SNAP" "NONE-only update does not rewrite the file"

run "$DROP" "$STAY" "$STRANGER" --update-grace
assert_eq "$EXIT" "1" "mixed update exits 1"
assert_eq "$OUT" $'OK drop-me ["true","false"]\nNONE stay no-command\nOK stranger ["true"]\nremaining 2' "update prints remaining 2"
ROWS="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(j.repos.map(r=>r.name+" "+r.owner).join(","));' "$GRACE")"
assert_eq "$ROWS" "fleet fleet--claude,stay lane-stay" "update drops only the OK listed repo"
assert_eq "$(printf '%s\n' "$ROWS" | grep -c stranger || true)" "0" "update never adds the unlisted OK repo"

run "$DROP" "$STAY" "$STRANGER" --update-grace
assert_eq "$OUT" $'OK drop-me ["true","false"]\nNONE stay no-command\nOK stranger ["true"]\nremaining 2' "second update is idempotent"
ROWS="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(j.repos.map(r=>r.name+" "+r.owner).join(","));' "$GRACE")"
assert_eq "$ROWS" "fleet fleet--claude,stay lane-stay" "second update still has no stranger"

printf '%s\n' '{"repos":[]}' > "$GRACE"
run "$DROP" --update-grace
assert_eq "$EXIT" "0" "empty grace plus OK exits 0"
assert_eq "$OUT" $'OK drop-me ["true","false"]\nremaining 0' "empty grace remaining 0"
assert_eq "$(cat "$GRACE")" '{"repos":[]}' "empty grace is not filled"

rm -f "$GRACE"
run "$DROP" --update-grace
assert_eq "$EXIT" "0" "missing grace plus OK exits 0"
assert_eq "$OUT" $'OK drop-me ["true","false"]\nremaining 0' "missing grace remaining 0"
assert_file_absent "$GRACE" "missing grace file is not created"

printf '%s\n' '{"nope":true}' > "$GRACE"
BAD_SNAP="$(cat "$GRACE")"
run "$DROP" --update-grace
assert_eq "$EXIT" "1" "grace file without repos exits 1"
assert_contains "$(cat "$ERR")" "check-tip-verify-default: grace file is not a repos list" "bad grace names the error"
assert_eq "$(cat "$GRACE")" "$BAD_SNAP" "bad grace file is not rewritten"
assert_eq "$(printf '%s\n' "$OUT" | grep -c remaining || true)" "0" "bad grace prints no remaining count"

assert_eq "$(cksum "$REAL_GRACE")" "$GRACE_BEFORE" "committed grace file was not edited"

finalize_test
