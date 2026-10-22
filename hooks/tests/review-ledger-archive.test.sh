#!/usr/bin/env bash
# Review-ledger archive: lib copy, import, status. Temp HOME only.
# RED at 01bd3ae2a866050d4bab9e3ce51005e658f841b0: the suite cannot load
# scripts/lib/review-ledger-copy.js (MODULE_NOT_FOUND) and every case fails.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

export HOME="$HOOK_HOME"
unset AUTOPILOT_CONFIG_FILE
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

LIB="$REPO_ROOT/scripts/lib/review-ledger-copy.js"
CLI="$REPO_ROOT/scripts/review-ledger-archive.js"
REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q

make_ledger() {
  local dest="$1" phase="$2" ts="$3"
  mkdir -p "$dest/review-$phase/g1"
  cat > "$dest/review-$phase/chain.json" <<EOF
[
  {
    "generation": 1,
    "base": "aaa",
    "head": "bbb",
    "seats": ["s0"],
    "status": "pending",
    "collected_at": "$ts"
  }
]
EOF
  printf '%s\n' '{"findings":[]}' > "$dest/review-$phase/g1/findings.json"
  printf '%s\n' '{"dispositions":[]}' > "$dest/review-$phase/g1/dispositions.json"
  printf '%s\n' '{"seat":"s0"}' > "$dest/review-$phase/g1/seat-s0.json"
  printf '%s\n' '{"base":"aaa","head":"bbb"}' > "$dest/review-$phase/g1/range.json"
  printf '%s\n' 'DIFF' > "$dest/review-$phase/g1/diff.txt"
  printf '%s\n' "{\"phase\":\"$phase\"}" > "$dest/receipt-$phase.json"
}

add_generation() {
  local dest="$1" phase="$2" n="$3" ts="$4"
  mkdir -p "$dest/review-$phase/g$n"
  printf '%s\n' '{"findings":[]}' > "$dest/review-$phase/g$n/findings.json"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const chain = JSON.parse(fs.readFileSync(p, "utf8"));
    chain.push({ generation: Number(process.argv[2]), base: "bbb", head: "ccc", seats: ["s0"], status: "pending", collected_at: process.argv[3] });
    fs.writeFileSync(p, JSON.stringify(chain, null, 2) + "\n");
  ' "$dest/review-$phase/chain.json" "$n" "$ts"
}

# (a) unset key and unset env: a copy writes nothing.
LEDGER_A="$TEST_TMP/ledger-a"
make_ledger "$LEDGER_A" alpha "2026-03-04T01:02:03.000Z"
node -e '
  const lib = require(process.argv[1]);
  const r = lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3] });
  if (r.copied) process.exit(3);
' "$LIB" "$LEDGER_A" "$REPO"
assert_exit_code "$?" "0" "case a: copy with archive off returns without copying"
# lib.sh seeds one empty operator config. The copy must not add a file or an archive directory.
FOUND=$(find "$HOME" -type f ! -path '*/.autopilot/config.json' 2>/dev/null | wc -l | tr -d ' ')
assert_eq "$FOUND" "0" "case a: archive off writes no file"
CFG_BODY=$(cat "$HOME/.autopilot/config.json")
assert_eq "$CFG_BODY" "{}" "case a: seeded config is unchanged"

# (b) env dir: layout A, no diff, modes 0700/0600.
ARCH="$TEST_TMP/archive-b"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH"
DEST=$(node -e '
  const lib = require(process.argv[1]);
  const r = lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3] });
  process.stdout.write(r.dest);
' "$LIB" "$LEDGER_A" "$REPO")
assert_exit_code "$?" "0" "case b: copy exits 0"
assert_file_exists "$DEST/archive.json" "case b: archive.json"
PHASE_CHAIN=$(find "$DEST" -path '*/review-alpha/chain.json' | head -1)
assert_file_exists "$PHASE_CHAIN" "case b: review-alpha/chain.json"
DIFFS=$(find "$DEST" -name diff.txt | wc -l | tr -d ' ')
assert_eq "$DIFFS" "0" "case b: diff.txt absent"
# layout A: root / bucket / YYYY-MM / ledger-id
REL=${DEST#"$ARCH/"}
PARTS=$(printf '%s' "$REL" | awk -F/ '{print NF}')
assert_eq "$PARTS" "3" "case b: three path parts under the archive root"
MONTH=$(printf '%s' "$REL" | cut -d/ -f2)
assert_eq "$MONTH" "2026-03" "case b: month is the first collect"
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (j.imported_from !== null) process.exit(4);
  if (!j.source_realpath || !j.repo_identity || !j.first_collect_at || !j.tool_version) process.exit(5);
' "$DEST/archive.json"
assert_exit_code "$?" "0" "case b: archive.json metadata, imported_from null"
MODE_DIR=$(stat -c %a "$ARCH")
MODE_FILE=$(stat -c %a "$DEST/archive.json")
MODE_PHASE=$(stat -c %a "$(dirname "$PHASE_CHAIN")")
assert_eq "$MODE_DIR" "700" "case b: archive root mode 0700"
assert_eq "$MODE_PHASE" "700" "case b: phase dir mode 0700"
assert_eq "$MODE_FILE" "600" "case b: archive.json mode 0600"

# (c) include_diff copies diff.txt
ARCH_C="$TEST_TMP/archive-c"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_C"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF=true
DEST_C=$(node -e '
  const lib = require(process.argv[1]);
  const r = lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3] });
  process.stdout.write(r.dest);
' "$LIB" "$LEDGER_A" "$REPO")
assert_file_exists "$DEST_C/review-alpha/g1/diff.txt" "case c: diff.txt copied"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF

# (d) same phase string, different generation-1 timestamps → two ledger ids
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-d"
L1="$TEST_TMP/ledger-d1"
L2="$TEST_TMP/ledger-d2"
make_ledger "$L1" alpha "2026-04-01T00:00:00.000Z"
make_ledger "$L2" alpha "2026-04-02T00:00:00.000Z"
D1=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$L1" "$REPO")
D2=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$L2" "$REPO")
assert_neq "$D1" "$D2" "case d: two ledger-id directories"
assert_file_exists "$D1/review-alpha/chain.json" "case d: first chain"
assert_file_exists "$D2/review-alpha/chain.json" "case d: second chain"

# (e) import twice changes nothing and sets imported_from
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-e"
IMP_OUT=$(node "$CLI" import --ledger "$LEDGER_A" --repo "$REPO")
assert_exit_code "$?" "0" "case e: import exits 0"
IMP_DEST=$(printf '%s\n' "$IMP_OUT" | tail -1)
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (j.imported_from !== fs.realpathSync(process.argv[2])) process.exit(6);
' "$IMP_DEST/archive.json" "$LEDGER_A"
assert_exit_code "$?" "0" "case e: imported_from is the source realpath"
SNAP="$TEST_TMP/snap-e"
mkdir -p "$SNAP"
cp -a "$TEST_TMP/archive-e" "$SNAP/before"
node "$CLI" import --ledger "$LEDGER_A" --repo "$REPO" >/dev/null
assert_exit_code "$?" "0" "case e: second import exits 0"
DIFF_OUT=$(diff -r "$SNAP/before" "$TEST_TMP/archive-e" || true)
assert_eq "$DIFF_OUT" "" "case e: second import changes nothing"

# (f) config file key works and env wins
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
CFG="$TEST_TMP/operator.json"
ARCH_CFG="$TEST_TMP/archive-cfg"
ARCH_ENV="$TEST_TMP/archive-env"
cat > "$CFG" <<EOF
{ "review_ledger_archive": { "dir": "$ARCH_CFG", "include_diff": false, "warn_mb": 500 } }
EOF
export AUTOPILOT_CONFIG_FILE="$CFG"
DEST_CFG=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_A" "$REPO")
assert_file_exists "$DEST_CFG/archive.json" "case f: config key selects the archive"
case "$DEST_CFG" in
  "$ARCH_CFG"/*) ;;
  *) fail "case f: dest not under config dir: $DEST_CFG" ;;
esac
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_ENV"
DEST_ENV=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_A" "$REPO")
case "$DEST_ENV" in
  "$ARCH_ENV"/*) ;;
  *) fail "case f: env did not win: $DEST_ENV" ;;
esac
unset AUTOPILOT_CONFIG_FILE
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (g) status on a populated archive and on an unset archive
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB=0
ST_POP=$(node "$CLI" status)
assert_exit_code "$?" "0" "case g: status on a populated archive exits 0"
assert_contains "$ST_POP" "ledgers:" "case g: ledger count"
assert_contains "$ST_POP" "bytes:" "case g: byte size"
assert_contains "$ST_POP" "archive:" "case g: archive root"
assert_contains "$ST_POP" "warning:" "case g: warn line when over warn_mb"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB
ST_OFF=$(node "$CLI" status)
assert_exit_code "$?" "0" "case g: unset archive exits 0"
assert_contains "$ST_OFF" "archive is off" "case g: off message"

# (h) two processes, two phases, one ledger-id
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-h"
export AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=200
LEDGER_H="$TEST_TMP/ledger-h"
make_ledger "$LEDGER_H" alpha "2026-05-01T00:00:00.000Z"
make_ledger "$LEDGER_H" beta "2026-05-01T00:00:01.000Z"
node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["alpha"]});' "$LIB" "$LEDGER_H" "$REPO" &
P1=$!
node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["beta"]});' "$LIB" "$LEDGER_H" "$REPO" &
P2=$!
wait "$P1"; R1=$?
wait "$P2"; R2=$?
assert_exit_code "$R1" "0" "case h: phase alpha exits 0"
assert_exit_code "$R2" "0" "case h: phase beta exits 0"
CHAIN_H=$(find "$TEST_TMP/archive-h" -name chain.json -path '*/20*' | head -1)
# ledger-id/chain.json is the merged chain (not a review-* chain)
MERGED=$(find "$TEST_TMP/archive-h" -name chain.json -not -path '*/review-*/*')
node -e '
  const fs = require("fs");
  const chains = process.argv.slice(1);
  if (chains.length !== 1) process.exit(7);
  const j = JSON.parse(fs.readFileSync(chains[0], "utf8"));
  const phases = new Set(j.map((e) => e.phase));
  if (!phases.has("alpha") || !phases.has("beta")) process.exit(8);
' $MERGED
assert_exit_code "$?" "0" "case h: merged chain.json parses and has both phases"
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS

# (i) negative control: lock acquisition removed, delay makes the race lose a phase
MUT="$TEST_TMP/mut/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT")"
sed 's/const release = acquireLedgerLock(lockDir);/const release = function () {};/' "$LIB" > "$MUT"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=150
LOST=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-i-$i"
  node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["alpha"]});' "$MUT" "$LEDGER_H" "$REPO" >/dev/null 2>&1 &
  Q1=$!
  node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["beta"]});' "$MUT" "$LEDGER_H" "$REPO" >/dev/null 2>&1 &
  Q2=$!
  wait "$Q1"; E1=$?
  wait "$Q2"; E2=$?
  MERGED_I=$(find "$TEST_TMP/archive-i-$i" -name chain.json -not -path '*/review-*/*' 2>/dev/null || true)
  if [ "$E1" != 0 ] || [ "$E2" != 0 ]; then LOST=$((LOST + 1)); continue; fi
  node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(9); }
    const phases = new Set(j.map((e) => e.phase));
    if (!phases.has("alpha") || !phases.has("beta")) process.exit(9);
  ' $MERGED_I >/dev/null 2>&1 || LOST=$((LOST + 1))
done
if [ "$LOST" -lt 1 ]; then
  fail "case i: removing the lock never lost a phase or failed (negative control is blind)"
fi
echo "case i: lockless copies lost or failed $LOST/20"

unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# usage: rotate and prune are a one-line error
ROT=$(node "$CLI" rotate 2>&1); ROT_RC=$?
assert_exit_code "$ROT_RC" "2" "rotate exits 2"
assert_contains "$ROT" "usage" "rotate prints usage"
HELP=$(node "$CLI" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "help exits 0"
assert_contains "$HELP" "import" "help names import"

finalize_test
