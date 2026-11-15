#!/usr/bin/env bash
# render-fleet-inventory.js — host table + quota-pool table from pace and seats files only.
# RED before the script exists: node cannot find scripts/render-fleet-inventory.js.
# Negative controls (the gate must block, and a disabled gate must not):
#   a stamp whose sha16 differs, a report with no stamp, and a mutant whose
#   sha compare is replaced with true (that mutant exits 0 on the bad stamp).
#   A second mutant sets STALE_AFTER_MS to 0 so fresh input gains the staleness note.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_INVENTORY_PACE AUTOPILOT_INVENTORY_SEATS
SRC="$REPO_ROOT/scripts/render-fleet-inventory.js"
D="$TEST_TMP/fix"
mkdir -p "$D"

run() {
  RC=0
  OUT="$(node "$SRC" "$@" < /dev/null 2>"$TEST_TMP/err")" || RC=$?
  ERR="$(cat "$TEST_TMP/err")"
}
run_bin() {
  local bin="$1"; shift
  RC=0
  OUT="$(node "$bin" "$@" < /dev/null 2>"$TEST_TMP/err")" || RC=$?
  ERR="$(cat "$TEST_TMP/err")"
}
tp() {
  node -e 'const ms=Date.parse(process.argv[1]); if(!Number.isFinite(ms)) process.exit(2); const t=new Date(ms+8*3600*1000); const p=n=>String(n).padStart(2,"0"); process.stdout.write(t.getUTCFullYear()+"-"+p(t.getUTCMonth()+1)+"-"+p(t.getUTCDate())+"T"+p(t.getUTCHours())+":"+p(t.getUTCMinutes())+":"+p(t.getUTCSeconds())+"+08:00");' "$1"
}
sha16() { sha256sum "$1" | awk '{print substr($1,1,16)}'; }
iso_ago() {
  node -e 'process.stdout.write(new Date(Number(process.argv[1]) - Number(process.argv[2])*60000).toISOString())' "$NOW_MS" "$1"
}
write_pace() {
  node - "$1" "$2" <<'JS'
const fs = require('fs');
const doc = {
  schema: 'capacity.pace/1',
  generated_at: process.argv[3],
  digest_reading_at: 'digest-do-not-print-9f3c',
  rows: [
    { id: 'id-do-not-print-9f3d', pool: 'alpha', display_name: 'Alpha 池', class: 'weekly', used_pct: 41, expected_pct: 40, gap_pts: 1, reset_at: '2026-11-16T00:00:00Z', seen_at: 'seen-do-not-print-9f3e', stale: false, status: 'ok' },
    { id: 'id-b', pool: 'beta', display_name: 'Beta 池', class: 'daily', used_pct: null, expected_pct: 20, gap_pts: null, reset_at: null, seen_at: 'seen-do-not-print-9f3e', stale: true, status: 'unknown' },
    { id: 'id-c', pool: 'gamma', display_name: 'Gamma 池', class: 'other', expected_pct: 10, gap_pts: -5, reset_at: '2026-11-16T16:00:00Z', seen_at: 'seen-do-not-print-9f3e', stale: false, status: 'ok' },
  ],
};
fs.writeFileSync(process.argv[2], JSON.stringify(doc));
JS
}
write_one() {
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({schema:"capacity.pace/1", generated_at:process.argv[3], digest_reading_at:"x", rows:[{id:"1", pool:"p", display_name:process.argv[2], class:"weekly", used_pct:1, expected_pct:1, gap_pts:0, reset_at:null, seen_at:null, stale:false, status:"ok"}]}));' "$1" "$2" "$3"
}
write_seats() {
  printf 'member\thost\tclaude_config_dir\tpool\treset\tsampled_at\n' > "$1"
  printf 'ada\thost-a\tcfg-do-not-print-9f3a\talpha\tseat-reset-do-not-print\t%s\n' "$2" >> "$1"
  printf 'bea\thost-a\tcfg-do-not-print-9f3a\tbeta\tseat-reset-do-not-print\t%s\n' "$3" >> "$1"
  printf 'cy\thost-b\tcfg-do-not-print-9f3b\talpha\tseat-reset-do-not-print\t%s\n' "$4" >> "$1"
}
pool_data_rows() {
  printf '%s\n' "$1" | awk 'BEGIN{p=0} /\| display_name \|/{p=1; next} p && /^\| ---/{next} p && /^\| /{c++} p && /^來源/{exit} END{print c+0}'
}

NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
GEN="$(iso_ago 5)"
T_ADA="$(iso_ago 30)"
T_BEA="$(iso_ago 10)"
T_CY="$(iso_ago 20)"
PACE="$D/pace.json"
SEATS="$D/seats.tsv"
write_pace "$PACE" "$GEN"
write_seats "$SEATS" "$T_ADA" "$T_BEA" "$T_CY"
TP_BEA="$(tp "$T_BEA")"
TP_CY="$(tp "$T_CY")"
TP_GEN="$(tp "$GEN")"
PACE_SHA="$(sha16 "$PACE")"
SEATS_SHA="$(sha16 "$SEATS")"
STAMP="來源：pace generated_at ${TP_GEN} sha16 ${PACE_SHA}；seats sampled_at max ${TP_BEA} sha16 ${SEATS_SHA}"

# ---- fresh md: 3 pace rows, null and absent used_pct are 未知, 2 hosts grouped ----
run --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 0 "fresh md: exit 0"
assert_contains "$OUT" "| host | members | pools | sampled_at |" "hosts header"
assert_contains "$OUT" "| host-a | ada, bea | alpha, beta | ${TP_BEA} |" "host-a grouped, sampled_at is the later seat"
assert_contains "$OUT" "| host-b | cy | alpha | ${TP_CY} |" "host-b grouped"
assert_contains "$OUT" "| display_name | class | 用量 | 預期 | 差距 | 重置（台北） | 狀態 | stale |" "pools header"
assert_contains "$OUT" "| Alpha 池 | weekly | 41 | 40 | 1 | 2026-11-16T08:00:00+08:00 | ok | false |" "alpha row, reset in Taipei"
assert_contains "$OUT" "| Beta 池 | daily | 未知 | 20 | 未知 | 未知 | unknown | true |" "null used_pct and gap are 未知, not 0"
assert_contains "$OUT" "| Gamma 池 | other | 未知 | 10 | -5 | 2026-11-17T00:00:00+08:00 | ok | false |" "absent used_pct is 未知"
assert_eq "$(pool_data_rows "$OUT")" 3 "three pool rows, no summed total row"
assert_not_contains "$OUT" "cfg-do-not-print-9f3a" "claude_config_dir value is not printed"
assert_not_contains "$OUT" "cfg-do-not-print-9f3b" "second claude_config_dir value is not printed"
assert_not_contains "$OUT" "claude_config_dir" "claude_config_dir column name is not printed"
assert_not_contains "$OUT" "seat-reset-do-not-print" "seats reset column is not printed"
assert_not_contains "$OUT" "seen-do-not-print-9f3e" "seen_at is not printed"
assert_not_contains "$OUT" "digest-do-not-print-9f3c" "digest_reading_at is not printed"
assert_not_contains "$OUT" "id-do-not-print-9f3d" "pace id is not printed"
assert_not_contains "$OUT" "Z" "no Z timestamps"
assert_not_contains "$OUT" "資料已" "fresh input has no staleness note"
last="$(printf '%s\n' "$OUT" | awk 'NF{line=$0} END{print line}')"
assert_eq "$last" "$STAMP" "stamp line is pace generated_at and seats sampled_at max, with sha16"

# ---- tsv ----
run --pace "$PACE" --seats "$SEATS" --format tsv
assert_eq "$RC" 0 "tsv: exit 0"
assert_contains "$OUT" "$(printf 'host-a\tada, bea\talpha, beta\t%s' "$TP_BEA")" "tsv host row"
assert_contains "$OUT" "$(printf 'Beta 池\tdaily\t未知\t20\t未知\t未知\tunknown\ttrue')" "tsv null usage is 未知"
assert_not_contains "$OUT" "| host |" "tsv is not a markdown table"
assert_not_contains "$OUT" "Z" "tsv has no Z"
assert_not_contains "$OUT" "cfg-do-not-print-9f3a" "tsv hides claude_config_dir"
assert_eq "$(printf '%s\n' "$OUT" | awk 'NF{line=$0} END{print line}')" "$STAMP" "tsv stamp matches md"

# ---- missing seats: !! line, exit 0, no invented host list ----
run --pace "$PACE" --seats "$D/missing-seats.tsv"
assert_eq "$RC" 0 "missing seats: exit 0"
assert_contains "$OUT" "!! seats 不可讀（找不到）" "missing seats: !! line"
assert_contains "$OUT" "| Alpha 池 |" "missing seats: pools still render"
assert_not_contains "$OUT" "host-a" "missing seats: no hand-made host"
assert_not_contains "$OUT" "| host |" "missing seats: no hosts table"

# ---- both missing: exit 3 ----
run --pace "$D/missing-pace.json" --seats "$D/missing-seats.tsv"
assert_eq "$RC" 3 "both missing: exit 3"
assert_contains "$OUT" "!! pace 不可讀（找不到）" "both missing: pace !! "
assert_contains "$OUT" "!! seats 不可讀（找不到）" "both missing: seats !! "
assert_not_contains "$OUT" "| host |" "both missing: no hosts table"
assert_not_contains "$OUT" "| display_name |" "both missing: no pools table"
assert_not_contains "$OUT" "sha16" "both missing: no invented stamp sha"
assert_eq "$ERR" "pace 與 seats 都不可讀（找不到、找不到）" "both missing: one-line reason"

# ---- both unreadable (present, but not files): exit 3, no stamp ----
mkdir -p "$D/pace-dir" "$D/seats-dir"
run --pace "$D/pace-dir" --seats "$D/seats-dir"
assert_eq "$RC" 3 "both unreadable: exit 3"
assert_eq "$ERR" "pace 與 seats 都不可讀（是目錄、是目錄）" "both unreadable: one-line reason"
assert_contains "$OUT" "!! pace 不可讀（是目錄）" "both unreadable: pace !! "
assert_contains "$OUT" "!! seats 不可讀（是目錄）" "both unreadable: seats !! "
assert_not_contains "$OUT" "sha16" "both unreadable: no invented stamp sha"

# ---- wrong schema ----
printf '%s\n' '{"schema":"not-pace","generated_at":"2026-11-16T00:00:00Z","rows":[{"display_name":"ShouldNotRender","used_pct":0}]}' > "$D/bad-schema.json"
run --pace "$D/bad-schema.json" --seats "$SEATS"
assert_eq "$RC" 0 "wrong schema: exit 0"
assert_contains "$OUT" "!! pace schema 不符" "wrong schema: !! line"
assert_not_contains "$OUT" "ShouldNotRender" "wrong schema: rows are not rendered"
assert_contains "$OUT" "| host-a |" "wrong schema: seats table still renders"

# ---- pace JSON invalid ----
printf '%s\n' '{' > "$D/bad.json"
run --pace "$D/bad.json" --seats "$SEATS"
assert_eq "$RC" 0 "bad json: exit 0"
assert_contains "$OUT" "!! pace 不可讀（JSON 無效）" "bad json: !! line"
assert_not_contains "$OUT" "| display_name |" "bad json: no pools table"

# ---- --check: fresh stamp passes; differing sha16 or no stamp fails ----
REP="$D/report.md"
run --pace "$PACE" --seats "$SEATS"
printf '%s\n' "$OUT" > "$REP"
run --check "$REP" --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 0 "check fresh stamp: exit 0"
assert_eq "$OUT" "" "check success prints nothing"
assert_eq "$ERR" "" "check success is silent"

sed "s/sha16 ${PACE_SHA}/sha16 aaaaaaaaaaaaaaaa/" "$REP" > "$D/stale.md"
assert_not_contains "$(cat "$D/stale.md")" "sha16 ${PACE_SHA}" "fixture stamp sha was replaced"
run --check "$D/stale.md" --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 1 "check differing sha16: exit 1"
assert_contains "$ERR" "手打" "check fail says the list was hand-typed"
assert_contains "$ERR" "過期" "check fail says the list was stale"
assert_contains "$ERR" "render-fleet-inventory.js" "check fail says to paste this script's output"

printf '%s\n' 'host-a 上有所有人，池子都還很空' > "$D/hand.md"
run --check "$D/hand.md" --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 1 "check with no stamp: exit 1"
assert_contains "$ERR" "手打" "no stamp: hand-typed message"

# ---- one unreadable input: that half passes --check only while it stays unreadable ----
run --pace "$D/missing-pace.json" --seats "$SEATS"
assert_eq "$RC" 0 "pace missing: render exit 0"
assert_contains "$OUT" "來源：pace 不可讀；seats sampled_at max ${TP_BEA} sha16 ${SEATS_SHA}" "pace missing: stamp says pace 不可讀"
printf '%s\n' "$OUT" > "$D/pace-gone.md"
run --check "$D/pace-gone.md" --pace "$D/missing-pace.json" --seats "$SEATS"
assert_eq "$RC" 0 "pace missing: check of the same text exits 0"
assert_eq "$ERR" "" "pace missing: check success is silent"
cp "$PACE" "$D/missing-pace.json"
run --check "$D/pace-gone.md" --pace "$D/missing-pace.json" --seats "$SEATS"
assert_eq "$RC" 1 "pace readable again: 不可讀 stamp is stale"
assert_contains "$ERR" "過期" "pace readable again: check says stale"

run --pace "$PACE" --seats "$D/missing-seats-2.tsv"
assert_eq "$RC" 0 "seats missing: render exit 0"
assert_contains "$OUT" "來源：pace generated_at ${TP_GEN} sha16 ${PACE_SHA}；seats 不可讀" "seats missing: stamp says seats 不可讀"
printf '%s\n' "$OUT" > "$D/seats-gone.md"
run --check "$D/seats-gone.md" --pace "$PACE" --seats "$D/missing-seats-2.tsv"
assert_eq "$RC" 0 "seats missing: check of the same text exits 0"
run --check "$D/seats-gone.md" --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 1 "seats readable again: 不可讀 stamp is stale"

HALF_OLD="$(iso_ago 180)"
write_seats "$D/half-old-seats.tsv" "$HALF_OLD" "$HALF_OLD" "$HALF_OLD"
run --pace "$D/missing-pace-2.json" --seats "$D/half-old-seats.tsv"
assert_eq "$RC" 0 "stale seats + missing pace: render exit 0"
assert_contains "$OUT" "pace 不可讀" "stale seats + missing pace: pace half"
assert_contains "$OUT" "（資料已 3 小時未更新）" "stale seats + missing pace: staleness note"
printf '%s\n' "$OUT" > "$D/half-stale.md"
run --check "$D/half-stale.md" --pace "$D/missing-pace-2.json" --seats "$D/half-old-seats.tsv"
assert_eq "$RC" 0 "不可讀 half plus staleness note passes --check"

# ---- 3 h old input: staleness note; fresh threshold is older-than 2 h ----
OLD_GEN="$(iso_ago 180)"
OLD_A="$(iso_ago 180)"
OLD_B="$(iso_ago 180)"
OLD_C="$(iso_ago 180)"
write_pace "$D/old-pace.json" "$OLD_GEN"
write_seats "$D/old-seats.tsv" "$OLD_A" "$OLD_B" "$OLD_C"
run --pace "$D/old-pace.json" --seats "$D/old-seats.tsv"
assert_eq "$RC" 0 "3h input: exit 0"
assert_contains "$OUT" "（資料已 3 小時未更新）" "3h input: staleness note"
assert_not_contains "$OUT" "Z" "3h output has no Z"
assert_contains "$OUT" "| Beta 池 | daily | 未知 |" "3h output still prints 未知 for null usage"

# ---- flags override env override defaults ----
DEF_HOME="$TEST_TMP/empty-home"
run_bin "$SRC" --pace "$DEF_HOME/projects/capacity/out/pace.v1.json" --seats "$DEF_HOME/.local/state/hangar-seats/seats-overlay.tsv"
assert_eq "$RC" 3 "absent defaults via explicit missing paths already covered"
mkdir -p "$DEF_HOME/projects/capacity/out" "$DEF_HOME/.local/state/hangar-seats"
write_one "$DEF_HOME/projects/capacity/out/pace.v1.json" "Default 池" "$GEN"
cp "$SEATS" "$DEF_HOME/.local/state/hangar-seats/seats-overlay.tsv"
write_one "$D/env-pace.json" "Env 池" "$GEN"
write_one "$D/flag-pace.json" "Flag 池" "$GEN"
RC=0
OUT="$(HOME="$DEF_HOME" node "$SRC" < /dev/null 2>"$TEST_TMP/err")" || RC=$?
ERR="$(cat "$TEST_TMP/err")"
assert_eq "$RC" 0 "defaults: exit 0"
assert_contains "$OUT" "Default 池" "defaults read ~/projects/capacity and hangar seats"
assert_not_contains "$OUT" "Env 池" "defaults do not invent an env name"
RC=0
OUT="$(HOME="$DEF_HOME" AUTOPILOT_INVENTORY_PACE="$D/env-pace.json" node "$SRC" < /dev/null 2>"$TEST_TMP/err")" || RC=$?
assert_eq "$RC" 0 "env: exit 0"
assert_contains "$OUT" "Env 池" "env overrides the default pace path"
assert_not_contains "$OUT" "Default 池" "env does not also print the default file"
RC=0
OUT="$(HOME="$DEF_HOME" AUTOPILOT_INVENTORY_PACE="$D/env-pace.json" node "$SRC" --pace "$D/flag-pace.json" < /dev/null 2>"$TEST_TMP/err")" || RC=$?
assert_eq "$RC" 0 "flag: exit 0"
assert_contains "$OUT" "Flag 池" "flag overrides env"
assert_not_contains "$OUT" "Env 池" "flag does not also print the env file"

# ---- help names the pre-send gate ----
run --help
assert_eq "$RC" 0 "help: exit 0"
assert_contains "$OUT" "--check" "help documents --check"
assert_contains "$OUT" "送出" "help says to run the gate before sending"

run --format xml
assert_eq "$RC" 2 "bad format: exit 2"

# ---- negative control: sha compare removed, a bad stamp is not blocked ----
sed_mutant "$SRC" "$D/no-compare.js" 's/paceSha === (stampPace || null) && seatsSha === (stampSeats || null)/true/'
run_bin "$D/no-compare.js" --check "$D/stale.md" --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 0 "negative control: without the sha compare the stale stamp is not blocked"
run --check "$D/stale.md" --pace "$PACE" --seats "$SEATS"
assert_eq "$RC" 1 "real gate still blocks the stale stamp"

# ---- negative control: threshold 0 marks fresh input stale ----
sed_mutant "$SRC" "$D/zero-stale.js" 's/const STALE_AFTER_MS = 2 \* 60 \* 60 \* 1000;/const STALE_AFTER_MS = 0;/'
run_bin "$D/zero-stale.js" --pace "$PACE" --seats "$SEATS"
assert_contains "$OUT" "資料已" "negative control: threshold 0 adds a staleness note to fresh input"
run --pace "$PACE" --seats "$SEATS"
assert_not_contains "$OUT" "資料已" "real threshold leaves fresh input unmarked"

finalize_test
