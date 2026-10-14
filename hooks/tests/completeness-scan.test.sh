#!/usr/bin/env bash
# hooks/tests/completeness-scan.test.sh — BL-0119: mktemp templates (six or more X in a
# row) are not markers; --files with a joined single arg must not scan 0 files.
# COMPLETENESS_SCAN overrides the script under test (negative control: point it at a
# broken copy and this test must go red).
# Fixtures are assembled with printf so this file never carries a literal marker word.

. "$(dirname "$0")/lib.sh"

SCAN="${COMPLETENESS_SCAN:-$REPO_ROOT/scripts/completeness-scan.sh}"
W="$TEST_TMP/work"; mkdir -p "$W"; cd "$W"

xs() { local i s=""; for ((i = 0; i < $1; i++)); do s+="X"; done; printf '%s' "$s"; }
X3="$(xs 3)"; X4="$(xs 4)"; X5="$(xs 5)"; X6="$(xs 6)"; X8="$(xs 8)"

printf 't=$(mktemp -d /tmp/foo.%s)\nu=$(mktemp /tmp/bar.%s)\n' "$X6" "$X8" > tmpl.sh
printf 'x=1\n# %s fix later\n' "$X3" > real.sh
printf '# TO%s a\n' DO > a.sh
printf '# FIX%s b\n' ME > b.sh
printf '%s later\n' "$X3" > bol.sh
printf '# TO%s spaced\n' DO > "my file.sh"

count() { printf '%s' "$1" | sed -n 's/.*"total": \([0-9]*\).*/\1/p'; }
scanned() { printf '%s' "$1" | sed -n 's/.*"scannedFiles": \([0-9]*\).*/\1/p'; }

# (1) mktemp templates are not markers
out="$(bash "$SCAN" --files tmpl.sh 2>/dev/null)"
assert_eq "$(count "$out")" "0" "mktemp templates not reported as markers"
# (1b) a real triple-X marker is still caught
out="$(bash "$SCAN" --files real.sh 2>/dev/null)"
assert_eq "$(count "$out")" "1" "real triple-X marker still caught"
# (1c) template and real marker in the same file: only the marker counts
cat tmpl.sh real.sh > mixed.sh
out="$(bash "$SCAN" --files mixed.sh 2>/dev/null)"
assert_eq "$(count "$out")" "1" "mixed file: only the real marker counted"
# (1d) marker at line start (mutation control: a rule of [^X]+marker misses this)
out="$(bash "$SCAN" --files bol.sh 2>/dev/null)"
assert_eq "$(count "$out")" "1" "line-start marker caught"

# (2) multi-file --files
out="$(bash "$SCAN" --files a.sh b.sh 2>/dev/null)"
assert_eq "$(scanned "$out")" "2" "--files a b scans 2 files"
assert_eq "$(count "$out")" "2" "--files a b finds 2 markers"
# (2b) one whitespace-joined argument must not silently scan 0
out="$(bash "$SCAN" --files "a.sh b.sh" 2>/dev/null)"
assert_eq "$(scanned "$out")" "2" "single joined arg scans 2 files"
assert_eq "$(count "$out")" "2" "single joined arg finds 2 markers"
# (2c) a missing file is reported on stderr, not silent
err="$(bash "$SCAN" --files nope.sh a.sh 2>&1 >/dev/null)"
assert_contains "$err" "nope.sh" "missing file named on stderr"
# (2d) newline-separated single argument: every line is a file
out="$(bash "$SCAN" --files "$(printf 'a.sh\nb.sh')" 2>/dev/null)"
assert_eq "$(scanned "$out")" "2" "newline-joined arg scans 2 files"
assert_eq "$(count "$out")" "2" "newline-joined arg finds 2 markers"
# (2e) newline list containing a name with a space: split on newlines only
out="$(bash "$SCAN" --files "$(printf 'a.sh\nmy file.sh\nb.sh')" 2>/dev/null)"
assert_eq "$(scanned "$out")" "3" "newline list with 'my file.sh' scans 3 files"
assert_eq "$(count "$out")" "3" "newline list with 'my file.sh' finds 3 markers"
# (2f) a real file whose name has a space, passed as one argument (mutation control:
# dropping the -f guard splits it and scans 0)
out="$(bash "$SCAN" --files "my file.sh" 2>/dev/null)"
assert_eq "$(scanned "$out")" "1" "real 'my file.sh' as one arg scans 1 file"
# (2g) CRLF line endings in a newline list
out="$(bash "$SCAN" --files "$(printf 'a.sh\r\nb.sh\r')" 2>/dev/null)"
assert_eq "$(scanned "$out")" "2" "CRLF newline list scans 2 files"
# (2h) a missing piece warns exactly once, naming the original argument
err="$(bash "$SCAN" --files "a.sh nope.sh" 2>&1 >/dev/null)"
assert_contains "$err" "argument 'a.sh nope.sh' was split" "split warning quotes the original argument"
assert_contains "$err" "piece 'nope.sh'" "split warning names the missing piece"
assert_eq "$(printf '%s\n' "$err" | grep -c 'nope.sh')" "1" "missing piece warned once"
# (2i) a directory argument is not warned about
mkdir adir
err="$(bash "$SCAN" --files adir a.sh 2>&1 >/dev/null)"
assert_eq "$err" "" "directory argument gives no warning"

# (3) marker length: 4 and 5 X are markers, 6+ is a mktemp template
printf 'a=1 # %s\n' "$X4" > x4.sh
printf 'a=1 # %s\n' "$X5" > x5.sh
printf 'a=mktemp /tmp/q.%s\n' "$X6" > x6.sh
for n in 4 5; do
  out="$(bash "$SCAN" --files "x$n.sh" 2>/dev/null)"
  assert_eq "$(count "$out")" "1" "$n X still a marker"
done
out="$(bash "$SCAN" --files x6.sh 2>/dev/null)"
assert_eq "$(count "$out")" "0" "6 X is a template, not a marker"

finalize_test
