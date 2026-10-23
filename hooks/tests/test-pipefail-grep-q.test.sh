#!/usr/bin/env bash
# Gate: no hooks/tests suite pipes a printed variable into `grep -q`. lib.sh sets `set -o pipefail`;
# `grep -q` exits on its first match, printf then takes SIGPIPE (141) and the pipeline reports
# failure, so a TRUE assertion fails about 0.4% of the time (check-test-integrity-precision flaked
# this way). The fix is a here-string: `grep -q PAT <<<"$VAR"`. Only the single-stage shape
# `printf '%s' "$VAR" | grep <any short-flag group containing q, or --quiet/--silent>` is gated; multi-stage pipelines are out of scope.
# RED at c1fafbfbaf8b2a2b191a1e0b8fd9eba7671a482d (before the here-string rewrite):
#   FAIL no printf-into-grep -q shape left in hooks/tests: expected '', got '<~100 file:line hits>'
TEST_NAME="test-pipefail-grep-q"
. "$(dirname "$0")/lib.sh"

# Built from pieces so this file does not match its own pattern.
PRINTF_WORD='printf'
GREP_WORD='grep'
SHAPE="${PRINTF_WORD} +'%s(\\\\n)?' +\"[^\"]+\" *\\| *${GREP_WORD} +(-[A-Za-z]*q[A-Za-z]*|--quiet|--silent)"
hits_in() { # dir -> file:line list of the offending shape
  grep -rnE "$SHAPE" "$1" --include='*.sh' 2>/dev/null | grep -v "/$(basename "$0"):" || true
}

assert_eq "$(hits_in "$REPO_ROOT/hooks/tests")" "" "no printf-into-grep -q shape left in hooks/tests"

# Negative control: the detector must see the shape when it is present.
NEG="$TEST_TMP/neg"; mkdir -p "$NEG"
printf '%s\n' "x=\$(echo hi); ${PRINTF_WORD} '%s' \"\$x\" | ${GREP_WORD} -q hi" > "$NEG/bad.sh"
printf '%s\n' "x=\$(echo hi); ${GREP_WORD} -q hi <<<\"\$x\"" > "$NEG/good.sh"
for flag in -q -vq -Eq -qF --quiet --silent; do
  printf '%s\n' "x=\$(echo hi); ${PRINTF_WORD} '%s' \"\$x\" | ${GREP_WORD} $flag hi" > "$NEG/bad-$flag.sh"
done
assert_contains "$(hits_in "$NEG")" "bad.sh" "detector flags the pipe shape"
for flag in -vq -Eq -qF --quiet --silent; do
  assert_contains "$(hits_in "$NEG")" "bad-$flag.sh" "detector flags grep $flag"
done
assert_not_contains "$(hits_in "$NEG")" "good.sh" "detector accepts the here-string"

finalize_test
