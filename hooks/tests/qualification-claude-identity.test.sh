#!/usr/bin/env bash
# BL-0052: the claude CLI qualification transport reads the runtime model id from the
# `claude -p --output-format json` envelope (`modelUsage` keys, probed 2026-10-18) and
# refuses a case whose served model is not the declared one. Fixture stub binary only:
# no credentials, no network. Each refusal case has a negative control: the same input
# run through a copy of the provider with that check neutralized must be ACCEPTED.
. "$(dirname "$0")/lib.sh"

PROVIDER="$REPO_ROOT/scripts/qualification-review-provider.js"
STUB="$TEST_TMP/claude-stub"
cat >"$STUB" <<'SH'
#!/usr/bin/env bash
cat >/dev/null
if [ -n "${STUB_ARGS_FILE:-}" ]; then printf '%s\n' "$@" >"$STUB_ARGS_FILE"; fi
cat "$STUB_OUT"
SH
chmod +x "$STUB"

REQ='{"role":"reviewer","payload":{"format":"case_content","content":"diff --git a/f b/f\n+x\n"}}'
env_json() { # env_json <modelUsageJson> -> envelope with a reviewer-contract result
  printf '{"type":"result","is_error":false,"result":"{\\"findings\\":[]}","modelUsage":%s}' "$1"
}

# run <provider-script> <declared-model> <stdout-file>
run() {
  STUB_OUT="$3" QRP_CLI_BIN="$STUB" QRP_TRANSPORT=cli QRP_CLI_KIND=claude QRP_PROVIDER=t \
    QRP_MODEL="$2" node "$1" <<<"$REQ" 2>"$TEST_TMP/err"
}

# Negative-control provider: same file, one check neutralized per mutant, lib/ symlinked.
mutant() { # mutant <name> <sed-expr>
  mkdir -p "$TEST_TMP/$1"
  ln -sfn "$REPO_ROOT/scripts/lib" "$TEST_TMP/$1/lib"
  ln -sfn "$REPO_ROOT/evals" "$TEST_TMP/evals"
  sed "$2" "$PROVIDER" >"$TEST_TMP/$1/p.js"
  if cmp -s "$PROVIDER" "$TEST_TMP/$1/p.js"; then fail "mutant $1 changed nothing"; fi
}
mutant nomatch 's/if (bad.length) {/if (false) {/'
mutant nousage 's/if (keys.length === 0) {/if (false) {/'
mutant nojson 's/throw new Error(.claude CLI identity unverifiable: stdout is not the --output-format json envelope.);/return { text: stdoutText, resolvedModel: null };/'

# 1. match (incl. date suffix, [1m] suffix, family alias) -> accepted, args carry json format
env_json '{"claude-sonnet-5-5":{"inputTokens":1}}' >"$TEST_TMP/ok.json"
OUT="$(STUB_ARGS_FILE="$TEST_TMP/args" run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/ok.json")"; EX=$?
assert_eq "$EX" "0" "match: exit 0"
assert_contains "$OUT" 'findings' "match: answer text is the envelope result"
assert_contains "$(cat "$TEST_TMP/args")" "--output-format" "claude is asked for the json envelope"
env_json '{"claude-opus-4-1-20250805":{}}' >"$TEST_TMP/dated.json"
run "$PROVIDER" 'claude-opus-4-1[1m]' "$TEST_TMP/dated.json" >/dev/null; assert_eq "$?" "0" "date + [1m] suffix normalised"
env_json '{"claude-haiku-5-5":{}}' >"$TEST_TMP/alias.json"
run "$PROVIDER" haiku "$TEST_TMP/alias.json" >/dev/null; assert_eq "$?" "0" "family alias matches its family"
run "$PROVIDER" opus "$TEST_TMP/alias.json" >/dev/null; assert_neq "$?" "0" "family alias of another family refused"

# 2. mismatch -> refused; negative control accepts
env_json '{"claude-sonnet-5-4":{}}' >"$TEST_TMP/mm.json"
run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/mm.json" >/dev/null; EX=$?
assert_neq "$EX" "0" "mismatch: refused"
assert_contains "$(cat "$TEST_TMP/err")" "model identity mismatch" "mismatch: named in the error"
env_json '{"claude-sonnet-5-5":{},"claude-haiku-5-5":{}}' >"$TEST_TMP/two.json"
run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/two.json" >/dev/null; assert_neq "$?" "0" "extra served model refused"
run "$TEST_TMP/nomatch/p.js" claude-sonnet-5-5 "$TEST_TMP/mm.json" >/dev/null
assert_eq "$?" "0" "NEGATIVE CONTROL mismatch: comparison removed -> accepted (so the check is what refuses)"

# 3. no modelUsage / empty modelUsage -> refused (fail closed); negative control accepts
printf '{"type":"result","is_error":false,"result":"{\\"findings\\":[]}"}' >"$TEST_TMP/nu.json"
run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/nu.json" >/dev/null; assert_neq "$?" "0" "no modelUsage: refused"
assert_contains "$(cat "$TEST_TMP/err")" "no modelUsage" "no modelUsage: named in the error"
env_json '{}' >"$TEST_TMP/empty.json"
run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/empty.json" >/dev/null; assert_neq "$?" "0" "empty modelUsage: refused"
run "$TEST_TMP/nousage/p.js" claude-sonnet-5-5 "$TEST_TMP/nu.json" >/dev/null
assert_eq "$?" "0" "NEGATIVE CONTROL no modelUsage: presence check removed -> accepted"

# 4. broken JSON -> refused; negative control accepts
printf '{"type":"result","result":"{\\"findings\\":[]}","modelUs' >"$TEST_TMP/bad.json"
run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/bad.json" >/dev/null; assert_neq "$?" "0" "broken JSON: refused"
assert_contains "$(cat "$TEST_TMP/err")" "not the --output-format json envelope" "broken JSON: named in the error"
printf '{"findings":[]}' >"$TEST_TMP/plain.json"
run "$PROVIDER" claude-sonnet-5-5 "$TEST_TMP/plain.json" >/dev/null; assert_neq "$?" "0" "plain-text answer (no envelope): refused"
run "$TEST_TMP/nojson/p.js" claude-sonnet-5-5 "$TEST_TMP/bad.json" >/dev/null
assert_eq "$?" "0" "NEGATIVE CONTROL broken JSON: parse guard removed -> accepted"

finalize_test
