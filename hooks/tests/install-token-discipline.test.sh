#!/usr/bin/env bash
# RED at 69fe38bdd7af775498227abdf24f4ed6850b8ef3: script absent (MODULE_NOT_FOUND); 19 passed, 22 failed — install exits 1, no AGENTS.md/GEMINI.md, no markers, second install not byte-identical, block not inserted, --check not 0 when "consistent", top-level default_subagent_model not flagged, dry-run exit 1.
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

# --check: 0 consistent, 1 after hand edit, 1 when not installed
BASE="$(new_home)"
HOME_D="$BASE/home"
CODEX_D="$BASE/codex"
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "1" "--check exits 1 when not installed"
run_it "$HOME_D" "$CODEX_D" install >/dev/null
OUT="$(run_it "$HOME_D" "$CODEX_D" --check 2>&1)"; EC=$?
assert_eq "$EC" "0" "--check exits 0 when consistent"
python3 - "$CODEX_D/AGENTS.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
p.write_text(t.replace("Token discipline", "Token discipline HAND-EDITED", 1))
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

echo "Summary: $PASS passed, $FAIL failed"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
exit 0
