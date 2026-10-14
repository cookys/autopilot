#!/usr/bin/env bash
# hooks/tests/completeness-scan.test.sh — BL-0119: mktemp XXXXXX templates are not
# XXX markers; --files with a whitespace-joined single arg must not scan 0 files.
# COMPLETENESS_SCAN overrides the script under test (negative control: point it at
# the pre-fix script and this test must go red).

. "$(dirname "$0")/lib.sh"

SCAN="${COMPLETENESS_SCAN:-$REPO_ROOT/scripts/completeness-scan.sh}"
W="$TEST_TMP/work"; mkdir -p "$W"; cd "$W"

printf 't=$(mktemp -d /tmp/foo.XXXXXX)\nu=$(mktemp /tmp/bar.XXXXXXXX)\n' > tmpl.sh
printf 'x=1\n# XXX fix later\n' > real.sh
printf '# TODO a\n' > a.sh
printf '# FIXME b\n' > b.sh

count() { printf '%s' "$1" | sed -n 's/.*"total": \([0-9]*\).*/\1/p'; }
scanned() { printf '%s' "$1" | sed -n 's/.*"scannedFiles": \([0-9]*\).*/\1/p'; }

# (1) mktemp templates are not markers
out="$(bash "$SCAN" --files tmpl.sh 2>/dev/null)"
assert_eq "$(count "$out")" "0" "mktemp XXXXXX templates not reported as markers"
# (1b) a real XXX marker is still caught
out="$(bash "$SCAN" --files real.sh 2>/dev/null)"
assert_eq "$(count "$out")" "1" "real XXX marker still caught"
# (1c) template and real marker in the same file: only the marker counts
cat tmpl.sh real.sh > mixed.sh
out="$(bash "$SCAN" --files mixed.sh 2>/dev/null)"
assert_eq "$(count "$out")" "1" "mixed file: only the real XXX counted"

# (2) multi-file --files
out="$(bash "$SCAN" --files a.sh b.sh 2>/dev/null)"
assert_eq "$(scanned "$out")" "2" "--files a b scans 2 files"
assert_eq "$(count "$out")" "2" "--files a b finds 2 markers"
# (2b) one whitespace-joined argument must not silently scan 0
out="$(bash "$SCAN" --files "a.sh b.sh" 2>/dev/null)"
assert_eq "$(scanned "$out")" "2" "--files \"a b\" (single joined arg) scans 2 files"
assert_eq "$(count "$out")" "2" "--files \"a b\" finds 2 markers"
# (2c) a missing file is reported on stderr, not silent
err="$(bash "$SCAN" --files nope.sh a.sh 2>&1 >/dev/null)"
assert_contains "$err" "nope.sh" "missing file named on stderr"

finalize_test
