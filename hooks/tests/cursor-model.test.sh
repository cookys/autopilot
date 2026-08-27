#!/usr/bin/env bash
# cursor-model.sh integration test — the (family, effort, fast) → model-id
# mapper for the Cursor CLI rail, validated against a stubbed live
# `--list-models` inventory (P14 shape). Sibling of grok-effort.sh, but with
# a live-inventory equality check instead of a hardcoded clamp table — see
# scripts/lib/cursor-model.sh header and
# docs/plans/2026-08-26-cursor-cli-adaptor.md §4 Phase 1 / §5.
#
# Contract under test:
#   cursor_model_for <bin> <family> <effort> <fast> → id on stdout, 0/non-zero
#   cursor_enabled_ids                                → pure, 16 ids
#   cursor_is_enabled_id <id>                          → pure, 0/1
. "$(dirname "$0")/lib.sh"

TEST_NAME="cursor-model"
LIB="$REPO_ROOT/scripts/lib/cursor-model.sh"
assert_file_exists "$LIB" "cursor-model.sh exists"
# shellcheck source=/dev/null
. "$LIB"

# ---------------------------------------------------------------------------
# Stub cursor-agent — the test seam. Emits a fixed P14-shaped --list-models
# listing (header line, blank line, then "<id> - <display name>" entries).
# The full 16-id fast-closed table, so the "all 16" enumeration test and the
# live-inventory equality checks share one fixture.
# ---------------------------------------------------------------------------
STUB_BIN="$TEST_TMP/cursor-agent"
cat > "$STUB_BIN" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then
  cat <<'EOF'
Available models

cursor-grok-4.6-low - Grok 4.6 (low)
cursor-grok-4.6-low-fast - Grok 4.6 (low, fast)
cursor-grok-4.6-medium - Grok 4.6 (medium)
cursor-grok-4.6-medium-fast - Grok 4.6 (medium, fast)
cursor-grok-4.6-high - Grok 4.6 (high)
cursor-grok-4.6-high-fast - Grok 4.6 (high, fast)
cursor-grok-4.6-xhigh - Grok 4.6 (xhigh)
cursor-grok-4.6-xhigh-fast - Grok 4.6 (xhigh, fast)
gpt-5.3-codex-low - GPT-5.3 Codex (low)
gpt-5.3-codex-low-fast - GPT-5.3 Codex (low, fast)
gpt-5.3-codex - GPT-5.3 Codex (medium)
gpt-5.3-codex-fast - GPT-5.3 Codex (medium, fast)
gpt-5.3-codex-high - GPT-5.3 Codex (high)
gpt-5.3-codex-high-fast - GPT-5.3 Codex (high, fast)
gpt-5.3-codex-xhigh - GPT-5.3 Codex (xhigh)
gpt-5.3-codex-xhigh-fast - GPT-5.3 Codex (xhigh, fast)
EOF
  exit 0
fi
echo "unexpected invocation: $*" >&2
exit 1
STUB
chmod +x "$STUB_BIN"

# A second stub whose inventory has `cursor-grok-4.6-low` REMOVED but its
# `-fast` sibling still present — the P15 regression fixture.
STUB_BIN_P15="$TEST_TMP/cursor-agent-p15"
cat > "$STUB_BIN_P15" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then
  cat <<'EOF'
Available models

cursor-grok-4.6-low-fast - Grok 4.6 (low, fast)
cursor-grok-4.6-medium - Grok 4.6 (medium)
gpt-5.3-codex - GPT-5.3 Codex (medium)
EOF
  exit 0
fi
echo "unexpected invocation: $*" >&2
exit 1
STUB
chmod +x "$STUB_BIN_P15"

# A stub whose --list-models fails outright (non-zero exit, empty stdout).
STUB_BIN_FAIL="$TEST_TMP/cursor-agent-fail"
cat > "$STUB_BIN_FAIL" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
chmod +x "$STUB_BIN_FAIL"

# ---------------------------------------------------------------------------
# 1. max clamps to xhigh, with a clamp note on stderr
# ---------------------------------------------------------------------------
OUT="$(cursor_model_for "$STUB_BIN" grok46 max 0 2>"$TEST_TMP/stderr.1")"; RC=$?
assert_eq "0" "$RC" "grok46 max 0 → exit 0"
assert_eq "cursor-grok-4.6-xhigh" "$OUT" "grok46 max 0 → clamped to xhigh"
assert_contains "$(cat "$TEST_TMP/stderr.1")" "not a cursor level" "clamp note printed on stderr"

# ---------------------------------------------------------------------------
# 2. DISPATCH_QUIET=1 suppresses the clamp note
# ---------------------------------------------------------------------------
OUT="$(DISPATCH_QUIET=1 cursor_model_for "$STUB_BIN" grok46 max 0 2>"$TEST_TMP/stderr.2")"
assert_eq "cursor-grok-4.6-xhigh" "$OUT" "quiet mode still resolves the id"
assert_eq "" "$(cat "$TEST_TMP/stderr.2")" "DISPATCH_QUIET=1 suppresses the clamp note"

# ---------------------------------------------------------------------------
# 3. low, non-fast → the plain id, NOT -low-fast
# ---------------------------------------------------------------------------
OUT="$(cursor_model_for "$STUB_BIN" grok46 low 0 2>/dev/null)"; RC=$?
assert_eq "0" "$RC" "grok46 low 0 → exit 0"
assert_eq "cursor-grok-4.6-low" "$OUT" "grok46 low 0 → non-fast id"

# ---------------------------------------------------------------------------
# 4. low, fast=1 → the -fast id
# ---------------------------------------------------------------------------
OUT="$(cursor_model_for "$STUB_BIN" grok46 low 1 2>/dev/null)"; RC=$?
assert_eq "0" "$RC" "grok46 low 1 → exit 0"
assert_eq "cursor-grok-4.6-low-fast" "$OUT" "grok46 low 1 → fast id"

# ---------------------------------------------------------------------------
# 5. codex53 medium 0 → gpt-5.3-codex (the medium row has no suffix)
# ---------------------------------------------------------------------------
OUT="$(cursor_model_for "$STUB_BIN" codex53 medium 0 2>/dev/null)"; RC=$?
assert_eq "0" "$RC" "codex53 medium 0 → exit 0"
assert_eq "gpt-5.3-codex" "$OUT" "codex53 medium 0 → gpt-5.3-codex"

# ---------------------------------------------------------------------------
# 6. unknown family → non-zero exit
# ---------------------------------------------------------------------------
cursor_model_for "$STUB_BIN" bogus-family low 0 >/dev/null 2>"$TEST_TMP/stderr.6"; RC=$?
assert_neq "0" "$RC" "unknown family → non-zero exit"
assert_contains "$(cat "$TEST_TMP/stderr.6")" "unknown family" "unknown family message"

# ---------------------------------------------------------------------------
# 7. a fabricated / absent-from-inventory id → non-zero (fail-closed)
# ---------------------------------------------------------------------------
cursor_model_for "$STUB_BIN_P15" grok46 high 0 >/dev/null 2>"$TEST_TMP/stderr.7"; RC=$?
assert_neq "0" "$RC" "id absent from stubbed inventory → non-zero"
assert_contains "$(cat "$TEST_TMP/stderr.7")" "not in the live inventory" "fail-closed message names the inventory check"

# --list-models itself failing / empty → hard failure, not a silent id
cursor_model_for "$STUB_BIN_FAIL" grok46 low 0 >/dev/null 2>"$TEST_TMP/stderr.7b"; RC=$?
assert_neq "0" "$RC" "--list-models failure → non-zero"
assert_contains "$(cat "$TEST_TMP/stderr.7b")" "list-models" "--list-models failure message"

# ---------------------------------------------------------------------------
# 8. THE P15 REGRESSION — stub inventory has cursor-grok-4.6-low REMOVED but
# cursor-grok-4.6-low-fast still present. cursor_model_for(... low 0) MUST
# FAIL. This proves the check is string equality, not containment: a
# containment implementation (grep/case *"$id"*) would match the -fast
# sibling and silently pass.
# ---------------------------------------------------------------------------
cursor_model_for "$STUB_BIN_P15" grok46 low 0 >/dev/null 2>"$TEST_TMP/stderr.8"; RC=$?
assert_neq "0" "$RC" "P15 regression: removed non-fast id must NOT validate against its -fast sibling"

# ---------------------------------------------------------------------------
# 9. cursor_enabled_ids emits all 16 fast-closed ids
# ---------------------------------------------------------------------------
ENABLED="$(cursor_enabled_ids)"
ENABLED_COUNT="$(printf '%s\n' "$ENABLED" | grep -c .)"
assert_eq "16" "$ENABLED_COUNT" "cursor_enabled_ids emits exactly 16 ids"
for id in \
  cursor-grok-4.6-low cursor-grok-4.6-low-fast \
  cursor-grok-4.6-medium cursor-grok-4.6-medium-fast \
  cursor-grok-4.6-high cursor-grok-4.6-high-fast \
  cursor-grok-4.6-xhigh cursor-grok-4.6-xhigh-fast \
  gpt-5.3-codex-low gpt-5.3-codex-low-fast \
  gpt-5.3-codex gpt-5.3-codex-fast \
  gpt-5.3-codex-high gpt-5.3-codex-high-fast \
  gpt-5.3-codex-xhigh gpt-5.3-codex-xhigh-fast \
; do
  assert_contains "$ENABLED" "$id" "cursor_enabled_ids includes $id"
done

# ---------------------------------------------------------------------------
# 10. cursor_is_enabled_id membership predicate
# ---------------------------------------------------------------------------
if cursor_is_enabled_id "gpt-5.3-codex-low-fast"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "cursor_is_enabled_id gpt-5.3-codex-low-fast → expected true"
fi

if cursor_is_enabled_id "gpt-5.2"; then
  fail "cursor_is_enabled_id gpt-5.2 → expected false"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

if cursor_is_enabled_id "cursor-grok-4.5-high"; then
  fail "cursor_is_enabled_id cursor-grok-4.5-high → expected false"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ---------------------------------------------------------------------------
# 10b. cursor_is_family_alias — the vocabulary SSOT the wrappers derive from.
# Every member of _CURSOR_FAMILIES must test true (this is the property that
# makes the wrappers' `grok46|codex53` literal removable); a full model id and
# an unknown word must test false.
# ---------------------------------------------------------------------------
for _fam in $_CURSOR_FAMILIES; do
  if cursor_is_family_alias "$_fam"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "cursor_is_family_alias $_fam → expected true (member of _CURSOR_FAMILIES)"
  fi
done

if cursor_is_family_alias "cursor-grok-4.6-high"; then
  fail "cursor_is_family_alias cursor-grok-4.6-high → expected false (full id, not an alias)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

if cursor_is_family_alias "grok"; then
  fail "cursor_is_family_alias grok → expected false (prefix of grok46, not equal)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

if cursor_is_family_alias ""; then
  fail "cursor_is_family_alias '' → expected false"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ---------------------------------------------------------------------------
# 11. PURITY — cursor_enabled_ids / cursor_is_enabled_id invoke NO binary.
# Poison PATH with a cursor-agent stub that writes a sentinel file if it is
# ever invoked; assert the sentinel does not exist after calling both.
# ---------------------------------------------------------------------------
SENTINEL="$TEST_TMP/purity-sentinel"
POISON_DIR="$TEST_TMP/poison-bin"
mkdir -p "$POISON_DIR"
cat > "$POISON_DIR/cursor-agent" <<STUB
#!/usr/bin/env bash
touch "$SENTINEL"
echo "Available models"
echo
echo "cursor-grok-4.6-low - Grok 4.6 (low)"
STUB
chmod +x "$POISON_DIR/cursor-agent"

( PATH="$POISON_DIR:$PATH" cursor_enabled_ids >/dev/null )
( PATH="$POISON_DIR:$PATH" cursor_is_enabled_id "gpt-5.3-codex-low-fast" >/dev/null )
assert_file_absent "$SENTINEL" "purity: cursor_enabled_ids / cursor_is_enabled_id never invoke cursor-agent, even with it on PATH"

# ---------------------------------------------------------------------------
# 12. purity (source-level lint): the hot-path functions contain no fork
# construct at all — not just "never happens to invoke cursor-agent" (test
# 11, a PATH sentinel) but "cannot fork a subshell, period". Test 11 alone
# would still pass if these functions forked a subshell that did nothing
# observable (a bare `$(true)`, a `< <(:)`) — a subprocess that just never
# happens to touch PATH. This is the "suite that passes when you delete the
# gate it tests" failure mode named in references/evidence-discipline.md,
# applied to the "no subprocess" contract in the header of cursor-model.sh.
#
# There is no portable pure-bash runtime oracle for "did this shell function
# fork a subshell" observable from outside the function (short of strace,
# which isn't available/portable across the target platforms). So this is a
# SOURCE-LEVEL LINT, not a runtime oracle: it extracts the literal source
# text of each hot-path function from cursor-model.sh and asserts that text
# contains none of `$(`, a backtick, or `<(`. SCOPE, stated honestly: those
# are three fork-inducing constructs, NOT all of them — a pipeline, a bare
# `( )` subshell and a trailing `&` also fork and are NOT detected here. They
# are the three these functions could plausibly regress into (the pre-repair
# code used `$(` and `<(`), so the lint is calibrated to the real regression,
# not to the general problem. It is named a source-level lint so nobody
# mistakes it for proof about runtime behavior.
# ---------------------------------------------------------------------------

# _extract_fn_body <file> <fn-name> — print the source lines of a `name() {
# ... }` function definition (opening brace on the def line, closing brace
# alone on its own line — matches this file's own style). Pure awk, no
# subprocess fork inside the *test's* own hot path (irrelevant here — the
# test itself is allowed to fork; only the library functions under test are
# constrained).
_extract_fn_body() {
  awk -v fn="$2" '
    $0 ~ "^" fn "\\(\\) \\{" { grab=1; next }
    grab && /^}/ { grab=0; next }
    grab { print }
  ' "$1"
}

_assert_source_fork_free() {
  local fn="$1" body
  body="$(_extract_fn_body "$LIB" "$fn")"
  [ -n "$body" ] || fail "purity (source-level lint): could not locate function body for $fn in $LIB — extraction pattern is stale"
  case "$body" in
    *'$('*)  fail "purity (source-level lint): $fn contains a command substitution \$( ) — forks a subshell" ;;
    *'`'*)   fail "purity (source-level lint): $fn contains a backtick command substitution — forks a subshell" ;;
    *'<('*)  fail "purity (source-level lint): $fn contains a process substitution <( ) — forks a subshell" ;;
    *)       __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  esac
}

for fn in cursor_enabled_ids cursor_is_enabled_id cursor_is_family_alias _cursor_model_base; do
  _assert_source_fork_free "$fn"
done

finalize_test
