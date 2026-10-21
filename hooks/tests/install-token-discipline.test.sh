#!/usr/bin/env bash
# RED at 69fe38bdd7af775498227abdf24f4ed6850b8ef3: script absent (MODULE_NOT_FOUND); 19 passed, 22 failed — install exits 1, no AGENTS.md/GEMINI.md, no markers, second install not byte-identical, block not inserted, --check not 0 when "consistent", top-level default_subagent_model not flagged, dry-run exit 1.
# RED at 9d2e05ebe5c2314f224c4e05bd6d0725fa718f2d: 50 passed, 12 failed — installed files still contain context_budget and Known per-harness facts; a doc with no install-block markers and an unpaired marker both install (exit 0) and write files; compact_token_budget inside a section is not flagged.
# Opt-in installer for the token-discipline block (Codex AGENTS.md, agy GEMINI.md).
# Does not source hooks/tests/lib.sh: no git operations.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/install-token-discipline.js"
BEGIN='<!-- autopilot:token-discipline begin v1 -->'
END='<!-- autopilot:token-discipline end -->'
PASS=0
FAIL=0

fail() {
  echo "FAIL: $*" >&2
  FAIL=$((FAIL + 1))
}

ok() {
  echo "PASS: $*"
  PASS=$((PASS + 1))
}

assert_eq() {
  if [[ "$1" == "$2" ]]; then ok "$3"; else fail "$3 (expected '$2' got '$1')"; fi
}

assert_contains() {
  if [[ "$1" == *"$2"* ]]; then ok "$3"; else fail "$3 (missing '$2')"; fi
}

assert_not_contains() {
  if [[ "$1" != *"$2"* ]]; then ok "$3"; else fail "$3 (unexpected '$2')"; fi
}

assert_file_exists() {
  if [[ -f "$1" ]]; then ok "$2"; else fail "$2 (missing $1)"; fi
}

assert_file_absent() {
  if [[ ! -e "$1" ]]; then ok "$2"; else fail "$2 (exists $1)"; fi
}

new_home() {
  local base
  base="$(mktemp -d)"
  mkdir -p "$base/home" "$base/codex"
  printf '%s\n' "$base"
}

run_it() {
  local home="$1" codex="$2"
  shift 2
  HOME="$home" CODEX_HOME="$codex" node "$SCRIPT" "$@" < /dev/null
}

# install writes both files with both markers
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
OUT="$(run_it "$HOME_D" "$CODEX_D" install 2>&1)"; EC=$?
assert_eq "$EC" "0" "install exits 0"
assert_file_exists "$CODEX_D/AGENTS.md" "install writes Codex AGENTS.md"
assert_file_exists "$HOME_D/.gemini/GEMINI.md" "install writes agy GEMINI.md"
for f in "$CODEX_D/AGENTS.md" "$HOME_D/.gemini/GEMINI.md"; do
  body="$(cat "$f")"
  assert_contains "$body" "$BEGIN" "begin marker in $(basename "$f")"
  assert_contains "$body" "$END" "end marker in $(basename "$f")"
done

# second install is byte-identical and does not duplicate the marker
cp "$CODEX_D/AGENTS.md" "$BASE/agents-1"
cp "$HOME_D/.gemini/GEMINI.md" "$BASE/gemini-1"
OUT="$(run_it "$HOME_D" "$CODEX_D" install 2>&1)"; EC=$?
assert_eq "$EC" "0" "second install exits 0"
cmp -s "$BASE/agents-1" "$CODEX_D/AGENTS.md" && ok "second install Codex file byte-identical" || fail "second install Codex file byte-identical"
cmp -s "$BASE/gemini-1" "$HOME_D/.gemini/GEMINI.md" && ok "second install agy file byte-identical" || fail "second install agy file byte-identical"
BEGIN_COUNT="$(grep -c -F "$BEGIN" "$CODEX_D/AGENTS.md" || true)"
assert_eq "$BEGIN_COUNT" "1" "second install does not duplicate the begin marker"

# pre-existing content is preserved around the block
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
mkdir -p "$CODEX_D" "$HOME_D/.gemini"
printf 'BEFORE-CODEX\n' > "$CODEX_D/AGENTS.md"
printf 'AFTER-KEEP\n' >> "$CODEX_D/AGENTS.md"
printf 'BEFORE-AGY\n' > "$HOME_D/.gemini/GEMINI.md"
OUT="$(run_it "$HOME_D" "$CODEX_D" install 2>&1)"; EC=$?
assert_eq "$EC" "0" "install into pre-existing files exits 0"
assert_contains "$(cat "$CODEX_D/AGENTS.md")" "BEFORE-CODEX" "Codex preamble kept"
assert_contains "$(cat "$CODEX_D/AGENTS.md")" "AFTER-KEEP" "Codex trailer kept"
assert_contains "$(cat "$HOME_D/.gemini/GEMINI.md")" "BEFORE-AGY" "agy preamble kept"
assert_contains "$(cat "$CODEX_D/AGENTS.md")" "$BEGIN" "block inserted beside pre-existing Codex content"

# uninstall removes only the block and keeps other content
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall 2>&1)"; EC=$?
assert_eq "$EC" "0" "uninstall exits 0"
assert_not_contains "$(cat "$CODEX_D/AGENTS.md")" "$BEGIN" "uninstall removes Codex block"
assert_contains "$(cat "$CODEX_D/AGENTS.md")" "BEFORE-CODEX" "uninstall keeps Codex preamble"
assert_contains "$(cat "$CODEX_D/AGENTS.md")" "AFTER-KEEP" "uninstall keeps Codex trailer"
assert_not_contains "$(cat "$HOME_D/.gemini/GEMINI.md")" "$BEGIN" "uninstall removes agy block"
assert_contains "$(cat "$HOME_D/.gemini/GEMINI.md")" "BEFORE-AGY" "uninstall keeps agy preamble"

# uninstall deletes a file that held only the block
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall 2>&1)"; EC=$?
assert_eq "$EC" "0" "uninstall of block-only files exits 0"
assert_file_absent "$CODEX_D/AGENTS.md" "uninstall deletes block-only Codex file"
assert_file_absent "$HOME_D/.gemini/GEMINI.md" "uninstall deletes block-only agy file"

# --check: 0 consistent, 1 after hand edit, 3 when not installed
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "3" "--check exits 3 when not installed"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "--check exits 0 when consistent"
python3 - "$CODEX_D/AGENTS.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
p.write_text(t.replace("Five rules", "Five rules HAND-EDITED", 1))
PY
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "1" "--check exits 1 after the block was hand-edited"

# top-level key is flagged; the same key under [agents] is not
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
cat > "$CODEX_D/config.toml" <<'EOF'
# comment
default_subagent_model = "cheap"

[other]
max_concurrent_threads_per_session = 9
EOF
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "config hint does not change a consistent --check exit code"
assert_contains "$OUT" "default_subagent_model" "top-level default_subagent_model is flagged"
assert_contains "$OUT" "[agents]" "hint names the [agents] section"
assert_not_contains "$OUT" "max_concurrent_threads_per_session" "key inside a section is not flagged"

cat > "$CODEX_D/config.toml" <<'EOF'
[agents]
default_subagent_model = "cheap"
EOF
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "negative control --check stays 0"
assert_not_contains "$OUT" "default_subagent_model" "key under [agents] is not flagged"
assert_not_contains "$OUT" "correct location" "negative control prints no placement hint"

# --dry-run writes no files
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
OUT="$(run_it "$HOME_D" "$CODEX_D" install --dry-run 2>&1)"; EC=$?
assert_eq "$EC" "0" "dry-run exits 0"
assert_file_absent "$CODEX_D/AGENTS.md" "dry-run writes no Codex file"
assert_file_absent "$HOME_D/.gemini/GEMINI.md" "dry-run writes no agy file"
assert_contains "$OUT" "dry-run" "dry-run prints what it would write"

# missing docs source: copy of the script with no docs/token-discipline.md
COPY="$(mktemp -d)"
mkdir -p "$COPY/scripts"
cp "$SCRIPT" "$COPY/scripts/install-token-discipline.js"
OUT="$(HOME="$HOME_D" CODEX_HOME="$CODEX_D" node "$COPY/scripts/install-token-discipline.js" install 2>&1)"; EC=$?
if [[ "$EC" -ne 0 ]]; then ok "missing docs source exits non-zero"; else fail "missing docs source exits non-zero (got 0)"; fi
assert_file_absent "$CODEX_D/AGENTS.md" "missing source writes nothing"

# narrowed block: seat key and the facts section stay out of the installed text
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
OUT="$(run_it "$HOME_D" "$CODEX_D" install 2>&1)"; EC=$?
assert_eq "$EC" "0" "install for narrowed-block checks exits 0"
for f in "$CODEX_D/AGENTS.md" "$HOME_D/.gemini/GEMINI.md"; do
  body="$(cat "$f")"
  assert_not_contains "$body" "context_budget" "installed $(basename "$f") omits context_budget"
  assert_not_contains "$body" "Known per-harness facts" "installed $(basename "$f") omits per-harness facts"
  assert_contains "$body" "Five rules" "installed $(basename "$f") keeps the Five rules"
done

# doc without install-block markers: real script refuses; a mutant that ignores markers writes
marker_tree() {
  local dest="$1" doc="$2" script_src="$3"
  mkdir -p "$dest/scripts" "$dest/docs"
  cp "$script_src" "$dest/scripts/install-token-discipline.js"
  printf '%s\n' "$doc" > "$dest/docs/token-discipline.md"
}

BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
NOMARK="$(mktemp -d)"
marker_tree "$NOMARK" $'# Token discipline\n\n## Five rules\n\n1. Hand off.\n' "$SCRIPT"
OUT="$(HOME="$HOME_D" CODEX_HOME="$CODEX_D" node "$NOMARK/scripts/install-token-discipline.js" install 2>&1)"; EC=$?
if [[ "$EC" -ne 0 ]]; then ok "doc without install-block markers exits non-zero"; else fail "doc without install-block markers exits non-zero (got 0)"; fi
assert_file_absent "$CODEX_D/AGENTS.md" "doc without markers writes no file"
assert_file_absent "$HOME_D/.gemini/GEMINI.md" "doc without markers writes no agy file"

MUT="$(mktemp -d)"
python3 - "$SCRIPT" "$MUT/mutant.js" <<'PY'
import pathlib, sys
src = pathlib.Path(sys.argv[1]).read_text()
start = src.find("function readSource() {")
end = src.find("\nfunction targetsFor(")
if start < 0 or end < 0:
    raise SystemExit("readSource span not found")
# Negative control: this mutant ignores install-block markers and installs the whole file.
mutant = (
    "function readSource() {\n"
    "  let body;\n"
    "  try { body = fs.readFileSync(SOURCE, 'utf8'); }\n"
    "  catch (error) { fail('cannot read ' + SOURCE); }\n"
    "  if (!body.endsWith('\\n')) body += '\\n';\n"
    "  return BEGIN + '\\n' + body + END + '\\n';\n"
    "}\n"
)
pathlib.Path(sys.argv[2]).write_text(src[:start] + mutant + src[end + 1:])
PY
marker_tree "$MUT" $'# Token discipline\n\n## Five rules\n\n1. Hand off.\n' "$MUT/mutant.js"
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
OUT="$(HOME="$HOME_D" CODEX_HOME="$CODEX_D" node "$MUT/scripts/install-token-discipline.js" install 2>&1)"; EC=$?
assert_eq "$EC" "0" "negative control: mutant that ignores markers exits 0"
assert_file_exists "$CODEX_D/AGENTS.md" "negative control: mutant that ignores markers writes a file"

# unpaired marker
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
UNPAIRED="$(mktemp -d)"
marker_tree "$UNPAIRED" $'<!-- install-block begin -->\n## Five rules\n\n1. Hand off.\n' "$SCRIPT"
OUT="$(HOME="$HOME_D" CODEX_HOME="$CODEX_D" node "$UNPAIRED/scripts/install-token-discipline.js" install 2>&1)"; EC=$?
if [[ "$EC" -ne 0 ]]; then ok "unpaired install-block marker exits non-zero"; else fail "unpaired install-block marker exits non-zero (got 0)"; fi
assert_file_absent "$CODEX_D/AGENTS.md" "unpaired marker writes no file"
shopt -s nullglob
baks=("$CODEX_D"/AGENTS.md.bak-* "$HOME_D"/.gemini/GEMINI.md.bak-*)
shopt -u nullglob
assert_eq "${#baks[@]}" "0" "unpaired marker writes no backup"

# compact_token_budget is flagged in a section and at the top level
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
cat > "$CODEX_D/config.toml" <<'EOF'
[agents]
compact_token_budget = 1000
default_subagent_model = "cheap"
EOF
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "deprecated key inside a section does not change --check exit"
assert_contains "$OUT" "compact_token_budget" "compact_token_budget inside a section is flagged"
assert_not_contains "$OUT" "default_subagent_model" "default_subagent_model under [agents] stays unflagged beside the deprecated key"

cat > "$CODEX_D/config.toml" <<'EOF'
compact_token_budget = 1000

[agents]
default_subagent_model = "cheap"
EOF
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "top-level deprecated key does not change --check exit"
assert_contains "$OUT" "compact_token_budget" "top-level compact_token_budget is flagged"
assert_not_contains "$OUT" "default_subagent_model" "key under [agents] stays unflagged beside top-level deprecated key"

# RED at a84d9453d129bb5a4cbc447c2a99b7302c84ad69: 78 passed, 16 failed — two begin markers: --check exits 0 (expected 1), no drift; install got 0; uninstall got 0 and rewrote the file. two end markers: --check exits 0, no drift; install got 0. whitespace remainder dry-run said would delete (not would write) and uninstall deleted the file. CRLF install left a bare LF (prefix/uninstall round-trip and --check of that mixed file already passed); a CRLF-encoded copy of the installed block made --check exit 1 and omit "codex: consistent". dotted key and inline table hinted compact_token_budget 0 times (expected 2).
# two complete marked blocks are drift: install, uninstall, and --check refuse
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install --harness codex >/dev/null
ONE="$(cat "$CODEX_D/AGENTS.md")"
printf '%s\nkeep\n%s\n' "$ONE" "$ONE" > "$CODEX_D/AGENTS.md"
cp "$CODEX_D/AGENTS.md" "$BASE/two-blocks"
OUT="$(run_it "$HOME_D" "$CODEX_D" --check --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "1" "two begin markers: --check exits 1"
assert_contains "$OUT" "drift" "two begin markers: --check reports drift"
OUT="$(run_it "$HOME_D" "$CODEX_D" install --harness codex 2>&1)"; EC=$?
if [[ "$EC" -ne 0 ]]; then ok "two begin markers: install refuses"; else fail "two begin markers: install refuses (got 0)"; fi
cmp -s "$BASE/two-blocks" "$CODEX_D/AGENTS.md" && ok "two begin markers: install writes nothing" || fail "two begin markers: install writes nothing"
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall --harness codex 2>&1)"; EC=$?
if [[ "$EC" -ne 0 ]]; then ok "two begin markers: uninstall refuses"; else fail "two begin markers: uninstall refuses (got 0)"; fi
cmp -s "$BASE/two-blocks" "$CODEX_D/AGENTS.md" && ok "two begin markers: uninstall writes nothing" || fail "two begin markers: uninstall writes nothing"
# two END markers, one BEGIN
python3 - "$BASE/two-blocks" "$CODEX_D/AGENTS.md" "$END" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
end = sys.argv[3]
pathlib.Path(sys.argv[2]).write_text(text.replace(end, end + "\n" + end, 1))
PY
cp "$CODEX_D/AGENTS.md" "$BASE/two-ends"
OUT="$(run_it "$HOME_D" "$CODEX_D" --check --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "1" "two end markers: --check exits 1"
assert_contains "$OUT" "drift" "two end markers: --check reports drift"
OUT="$(run_it "$HOME_D" "$CODEX_D" install --harness codex 2>&1)"; EC=$?
if [[ "$EC" -ne 0 ]]; then ok "two end markers: install refuses"; else fail "two end markers: install refuses (got 0)"; fi
cmp -s "$BASE/two-ends" "$CODEX_D/AGENTS.md" && ok "two end markers: install writes nothing" || fail "two end markers: install writes nothing"

# whitespace-only remainder is written back; only the empty string deletes the file
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
printf ' \n' > "$CODEX_D/AGENTS.md"
run_it "$HOME_D" "$CODEX_D" install --harness codex >/dev/null
cp "$CODEX_D/AGENTS.md" "$BASE/ws-installed"
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall --harness codex --dry-run 2>&1)"; EC=$?
assert_eq "$EC" "0" "whitespace remainder dry-run exits 0"
assert_contains "$OUT" "would write" "whitespace remainder dry-run would write"
assert_not_contains "$OUT" "would delete" "whitespace remainder dry-run does not delete"
cmp -s "$BASE/ws-installed" "$CODEX_D/AGENTS.md" && ok "whitespace remainder dry-run writes nothing" || fail "whitespace remainder dry-run writes nothing"
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "0" "whitespace remainder uninstall exits 0"
assert_file_exists "$CODEX_D/AGENTS.md" "whitespace remainder keeps the file"
printf ' \n' > "$BASE/ws-expect"
cmp -s "$BASE/ws-expect" "$CODEX_D/AGENTS.md" && ok "whitespace remainder is the bytes outside the block" || fail "whitespace remainder is the bytes outside the block"
# exactly empty remainder still deletes
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall --dry-run 2>&1)"; EC=$?
assert_contains "$OUT" "would delete" "empty remainder dry-run would delete"
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall 2>&1)"; EC=$?
assert_eq "$EC" "0" "empty remainder uninstall exits 0"
assert_file_absent "$CODEX_D/AGENTS.md" "empty remainder deletes the file"

# CRLF file: install then uninstall preserves outside bytes; --check is consistent
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
printf 'before\r\n\r\nafter\r\n' > "$CODEX_D/AGENTS.md"
cp "$CODEX_D/AGENTS.md" "$BASE/crlf-orig"
OUT="$(run_it "$HOME_D" "$CODEX_D" install --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "0" "CRLF install exits 0"
OUT="$(run_it "$HOME_D" "$CODEX_D" --check --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "0" "CRLF installed file --check exits 0"
assert_contains "$OUT" "codex: consistent" "CRLF installed file reports consistent"
python3 - "$CODEX_D/AGENTS.md" <<'PY'
import pathlib, sys
got = pathlib.Path(sys.argv[1]).read_bytes()
begin = b"<!-- autopilot:token-discipline begin v1 -->"
bare = got.replace(b"\r\n", b"")
if begin not in got or b"\n" in bare or not got.startswith(b"before\r\n\r\nafter\r\n"):
    raise SystemExit(1)
PY
if [[ "$?" -eq 0 ]]; then ok "CRLF install keeps prefix and writes CRLF"; else fail "CRLF install keeps prefix and writes CRLF"; fi
OUT="$(run_it "$HOME_D" "$CODEX_D" uninstall --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "0" "CRLF uninstall exits 0"
cmp -s "$BASE/crlf-orig" "$CODEX_D/AGENTS.md" && ok "CRLF uninstall restores outside bytes" || fail "CRLF uninstall restores outside bytes"
# A file whose marked block is the installed body with CRLF line endings.
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install --harness codex >/dev/null
python3 - "$CODEX_D/AGENTS.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))
PY
OUT="$(run_it "$HOME_D" "$CODEX_D" --check --harness codex 2>&1)"; EC=$?
assert_eq "$EC" "0" "CRLF-encoded installed block --check exits 0"
assert_contains "$OUT" "codex: consistent" "CRLF-encoded installed block reports consistent"

# dotted key and inline table hint compact_token_budget; the other keys stay top-level-only
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
cat > "$CODEX_D/config.toml" <<'EOF'
profiles.x.compact_token_budget = 1
x = { compact_token_budget = 1 }
profiles.x.default_subagent_model = "z"
y = { default_subagent_model = "z" }
default_subagent_reasoning_effort = "low"
EOF
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "dotted and inline deprecated key does not change --check exit"
HINTS="$(printf '%s\n' "$OUT" | grep -c 'compact_token_budget' || true)"
assert_eq "$HINTS" "2" "dotted key and inline table each hint compact_token_budget"
assert_not_contains "$OUT" "default_subagent_model" "dotted or inline default_subagent_model stays unflagged"
assert_contains "$OUT" "default_subagent_reasoning_effort" "top-level sibling key is still hinted"

echo "Summary: $PASS passed, $FAIL failed"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
exit 0
