#!/usr/bin/env bash
# check-fixed-times.test.sh - scripts/check-fixed-times.js with negative controls.
# Red: a fixed clock time with no reason is reported. Green twins: the same time with each reason marker passes,
# and the real templates pass.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

LINT="$REPO_ROOT/scripts/check-fixed-times.js"
D="$TEST_TMP/ft"; mkdir -p "$D"
run() { node "$LINT" "$@" 2>&1; }

printf '| unit | review |\n| a | 12:30Z 送審 |\n' > "$D/bad.md"
OUT="$(run --root "$D" bad.md)"; assert_eq "$?" "1" "red: fixed time without reason fails"
assert_contains "$OUT" "bad.md:2" "red: names file and line"

printf '| a | 09:00 開工 |\n' > "$D/bad2.md"
OUT="$(run --root "$D" bad2.md)"; assert_eq "$?" "1" "red: HH:MM + 開工 without reason fails"

printf '| a | 12:30Z 送審（外部限制：review seat quota resets then） |\n' > "$D/g1.md"
OUT="$(run --root "$D" g1.md)"; assert_eq "$?" "0" "green: same line, 外部限制 marker"

printf 'push at 18:00Z\nreason: registry freeze window\n' > "$D/g2.md"
OUT="$(run --root "$D" g2.md)"; assert_eq "$?" "0" "green: next line, reason: marker"

printf 'push at 18:00Z\n\nreason: too far away\n' > "$D/bad3.md"
OUT="$(run --root "$D" bad3.md)"; assert_eq "$?" "1" "red: reason two lines away does not count"

printf 'push at 18:00Z (external limit: freeze)\n' > "$D/g3.md"
OUT="$(run --root "$D" g3.md)"; assert_eq "$?" "0" "green: external limit marker"

printf 'no times here, ratio 3:1 and v1:2\n' > "$D/g4.md"
OUT="$(run --root "$D" g4.md)"; assert_eq "$?" "0" "green: ratios are not clock times"

OUT="$(run --root "$D" missing.md)"; assert_eq "$?" "2" "usage: a named missing file is rc 2"

mkdir -p "$D/skills/ceo-agent/references" "$D/references"
printf 'ok\n' > "$D/references/batch-dispatch.md"
printf 'x 10:00Z y\n' > "$D/skills/ceo-agent/references/level-front-door.md"
OUT="$(run --root "$D")"; assert_eq "$?" "1" "red: default targets scanned, absent lead-watch skipped"
printf 'x 10:00Z (external limit: z)\n' > "$D/skills/ceo-agent/references/level-front-door.md"
OUT="$(run --root "$D")"; assert_eq "$?" "0" "green: default targets with reason"

OUT="$(run)"; assert_eq "$?" "0" "the real templates pass"
assert_contains "$OUT" "clean" "real templates: clean line"

finalize_test
