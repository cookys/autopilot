#!/usr/bin/env bash
# Review-ledger archive: lib copy, import, status. Temp HOME only.
# RED at 01bd3ae2a866050d4bab9e3ce51005e658f841b0: the suite cannot load
# scripts/lib/review-ledger-copy.js (MODULE_NOT_FOUND) and every case fails.
# RED at d585f6027d8e29fce8349a3bda1f05ea439f6f46: finalize ignores
# AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR (k/m/n write no archive.json), and the
# try/catch and require markers are absent so o and p cannot patch the loop.
# RED at 9291adb33678d22a13f3162d751ff1b07793c63f: a real-shaped chain.json
# (no collected_at, no at) fails copy, import, and finalize with
# "generation 1 collected timestamp missing from chain.json".
# RED at 1b8cc7d49b9bbf3490f6f0eef2cd508b58aeab9d: cp -r of one ledger (mtimes
# differ) imports as two ledger-ids; the date prefix follows range.json mtime.
# RED at ff7f356bb2b3d1b201cdfeb923680ee3a85bfc54: an empty review-* directory
# aborts the whole import with "phase content missing: no g1/range.json or
# g1/findings.json"; a range-only phase is never reached; a 184-phase import
# is not attempted.
# RED at 8694f710fe00e5df9f515e19f8e1872a91d345f0: enforceModes chmods the whole archive root; "~/x" is not
# expanded; a live lock is not refreshed so a copy longer than staleMs is stolen.
# RED at 3caa2b554ec7b688c73c3f6d65ef888f67b02186: wording still says finalize is not wired; a chain.json
# with no generation 1 aborts the import; a read-only archive root is not
# rejected before copy; --phase ../x is an unknown argument; a symlinked
# review-* directory is followed.
# RED at c8768d0b882d37b62e1076bbdead04421bda7a59: AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=3000 with
# AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY unset, or set to 2 or true,
# still sleeps. A one-phase copy of a small ledger exceeds 1500 ms, so case an
# fails closed. The ungated reader is the production file itself.
# RED at 3c4f0f5f58e91e5ebef13a2347450ae7b649f63a: repoBucket uses
# basename(repoDir), so a worktree named lane-x gets its own bucket and a
# second ledger-id; the main checkout bucket is not mainrepo-<hash>.
# RED at 0439fe7d4: rotate is still "not available yet" (exit 2). Cases ar–ax
# and ba fail (no tar.gz, no "rotated"/"skipped"/"summary" lines, archive-off
# stays exit 2). ay does not print "rotatable months:" or the rotate hint.
# aw cannot patch scripts/lib/review-ledger-tar.js because the file is absent.
# RED at c25d40e8ea08c1e99f40266a6794200606f5119b: prune is still
# "not available yet" (exit 2). Dry-run lists nothing and --execute deletes
# nothing (bb/bd). Sibling, archive-root, and symlink --target runs also exit 2
# with no refusal line (be/bf/bg). The prefix-check mutant cannot be applied
# because pruneTargetAllowed is absent (bh). status --phase x exits 0 (bj).
# import --phase of a symlink phase exits 1 and copies no review-good (bk).
# RED at 71eb5b4ffb1bd6d1c5522e920efc59b66cdbb464: rotate and prune take only the bucket lock. A copy that
# holds <ledgerId>.lock and sleeps before writing review-beta loses that phase:
# rotate tars and removes the old month, and review-beta is absent from the tar.
# A planted <month>.tar.gz.tmp-123 is left behind. A *.lock directory under the
# month is stored in the tar. pruneArchive calls fs.rmSync with no in-place
# pruneTargetAllowed check in front of it.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

export HOME="$HOOK_HOME"
unset AUTOPILOT_CONFIG_FILE
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT
unset AUTOPILOT_REVIEW_LEDGER_LOCK_STALE_MS

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
  local range='{"base":"aaa","head":"bbb"}'
  if [ -n "${4:-}" ]; then range="$4"; fi
  printf '%s\n' '{"findings":[]}' > "$dest/review-$phase/g1/findings.json"
  printf '%s\n' '{"dispositions":[]}' > "$dest/review-$phase/g1/dispositions.json"
  printf '%s\n' '{"seat":"s0"}' > "$dest/review-$phase/g1/seat-s0.json"
  printf '%s\n' "$range" > "$dest/review-$phase/g1/range.json"
  printf '%s\n' 'DIFF' > "$dest/review-$phase/g1/diff.txt"
  printf '%s\n' "{\"phase\":\"$phase\"}" > "$dest/receipt-$phase.json"
}

# Real hetero-review chain.json: no collected_at and no at. Optional 4th arg is
# the g1/range.json body so two ledgers can differ by bytes. touch -d only moves
# mtime; identity must not read it.
make_real_ledger() {
  local dest="$1" phase="$2" when="$3" range="${4:-}"
  mkdir -p "$dest/review-$phase/g1"
  cat > "$dest/review-$phase/chain.json" <<EOF
[
  {
    "generation": 1,
    "base": "aaa",
    "head": "bbb",
    "seats": ["s0"],
    "reviewed_seats": ["s0"],
    "total_seats": 1,
    "reviewed_seats_count": 1,
    "total_seats_count": 1,
    "status": "pending",
    "diff_sha256": "ab",
    "full_range_sha256": "cd",
    "findings_sha256": "ef",
    "seat_artifact_sha256": "01",
    "dispositions_path": "g1/dispositions.json",
    "dispositions_sha256": "23"
  }
]
EOF
  printf '%s\n' '{"findings":[]}' > "$dest/review-$phase/g1/findings.json"
  printf '%s\n' '{"dispositions":[]}' > "$dest/review-$phase/g1/dispositions.json"
  printf '%s\n' '{"seat":"s0"}' > "$dest/review-$phase/g1/seat-s0.json"
  if [ -n "$range" ]; then
    printf '%s\n' "$range" > "$dest/review-$phase/g1/range.json"
  else
    printf '%s\n' '{"base":"aaa","head":"bbb"}' > "$dest/review-$phase/g1/range.json"
  fi
  printf '%s\n' 'DIFF' > "$dest/review-$phase/g1/diff.txt"
  printf '%s\n' "{\"phase\":\"$phase\"}" > "$dest/receipt-$phase.json"
  if [ -n "$when" ]; then
    touch -d "$when" "$dest/review-$phase/g1/range.json"
  fi
  node -e '
    const fs = require("fs");
    const chain = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const g1 = chain.find((e) => e && e.generation === 1);
    if (!g1 || "collected_at" in g1 || "at" in g1) process.exit(11);
  ' "$dest/review-$phase/chain.json"
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

# (d) same phase name, different g1/range.json bytes → two ledger ids
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-d"
L1="$TEST_TMP/ledger-d1"
L2="$TEST_TMP/ledger-d2"
make_ledger "$L1" alpha "2026-04-01T00:00:00.000Z" '{"base":"aaa","head":"d1"}'
make_ledger "$L2" alpha "2026-04-02T00:00:00.000Z" '{"base":"aaa","head":"d2"}'
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
export AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=400
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1
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
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY

# (i) negative control: lock acquisition removed, delay makes the race lose a phase
MUT="$TEST_TMP/mut/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT")"
sed 's/const release = acquireLedgerLock(lockDir);/const release = function () {};/' "$LIB" > "$MUT"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=400
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1
LOST=0
I_RUNS=3
for i in 1 2 3; do
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
if [ "$LOST" -ne "$I_RUNS" ]; then
  fail "case i: removing the lock never lost a phase or failed (negative control is blind) lost=$LOST/$I_RUNS"
fi
echo "case i: lockless copies lost or failed $LOST/$I_RUNS"

unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# usage: prune is a one-line error. rotate with no archive dir exits 1 (case ba).
ROT=$(node "$CLI" rotate 2>&1); ROT_RC=$?
assert_exit_code "$ROT_RC" "1" "rotate with no archive dir exits 1"
assert_contains "$ROT" "archive is off" "rotate with no archive dir says off"
PRUNE=$(node "$CLI" prune 2>&1); PRUNE_RC=$?
assert_exit_code "$PRUNE_RC" "2" "prune exits 2"
assert_contains "$PRUNE" "usage" "prune prints usage"
HELP=$(node "$CLI" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "help exits 0"
assert_contains "$HELP" "import" "help names import"

# Finalize hook. The loop is the real script unless a case points at a temp copy.
LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"

write_fin_disp() {
  local path="$1" phase="$2"
  cat > "$path" <<EOF
{
  "schema_version": 1,
  "phase": "$phase",
  "generation": 1,
  "findings": []
}
EOF
}

# (j) unset: finalize writes no archive. stdout and rc are the baseline.
LEDGER_J="$TEST_TMP/ledger-j"
make_ledger "$LEDGER_J" pj "2026-06-01T00:00:00.000Z"
write_fin_disp "$TEST_TMP/disp-j.json" pj
HOME_BEFORE=$(find "$HOME" -print | sort)
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_J" --phase pj --generation 1 --dispositions "$TEST_TMP/disp-j.json" >"$TEST_TMP/j.out" 2>"$TEST_TMP/j.err"
J_RC=$?
BASE_OUT=$(cat "$TEST_TMP/j.out")
BASE_RC=$J_RC
assert_exit_code "$J_RC" "0" "case j: finalize exits 0 with archive unset"
assert_eq "$(cat "$TEST_TMP/j.err")" "" "case j: no stderr when archive is unset"
assert_file_absent "$HOME/.autopilot/review-ledger-archive" "case j: default archive path is not created"
assert_file_absent "$TEST_TMP/archive-unset-sentinel" "case j: sentinel archive path is not created"
HOME_AFTER=$(find "$HOME" -print | sort)
assert_eq "$HOME_AFTER" "$HOME_BEFORE" "case j: HOME tree is unchanged"
ARCH_JSON_J=$(find "$HOME" -name archive.json 2>/dev/null | wc -l | tr -d ' ')
assert_eq "$ARCH_JSON_J" "0" "case j: no archive.json under HOME"

# (k) env dir: finalize creates layout A.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-k"
LEDGER_K="$TEST_TMP/ledger-k"
make_ledger "$LEDGER_K" pk "2026-07-02T03:04:05.000Z"
write_fin_disp "$TEST_TMP/disp-k.json" pk
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_K" --phase pk --generation 1 --dispositions "$TEST_TMP/disp-k.json" >"$TEST_TMP/k.out" 2>"$TEST_TMP/k.err"
assert_exit_code "$?" "0" "case k: finalize exits 0"
assert_file_exists "$TEST_TMP/archive-k" "case k: archive root exists"
K_META=$(find "$TEST_TMP/archive-k" -name archive.json)
K_CHAIN=$(find "$TEST_TMP/archive-k" -path '*/review-pk/chain.json')
assert_file_exists "$K_META" "case k: archive.json"
assert_file_exists "$K_CHAIN" "case k: review-pk/chain.json"
K_REL=${K_META#"$TEST_TMP/archive-k/"}
K_PARTS=$(printf '%s' "$K_REL" | awk -F/ '{print NF}')
assert_eq "$K_PARTS" "4" "case k: archive.json is root/bucket/month/ledger-id/archive.json"
case "$K_REL" in
  */2026-07/2026-07-02-*) ;;
  *) fail "case k: layout A month or ledger-id missing: $K_REL" ;;
esac
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (l) read-only archive root: rc and stdout match the unset baseline.
if [ "$(id -u)" -eq 0 ]; then
  echo "case l skipped: running as root, chmod 0555 is not a write barrier"
else
  export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-l"
  mkdir -p "$TEST_TMP/archive-l"
  chmod 0555 "$TEST_TMP/archive-l"
  LEDGER_L="$TEST_TMP/ledger-l"
  make_ledger "$LEDGER_L" pj "2026-07-03T00:00:00.000Z"
  write_fin_disp "$TEST_TMP/disp-l.json" pj
  node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_L" --phase pj --generation 1 --dispositions "$TEST_TMP/disp-l.json" >"$TEST_TMP/l.out" 2>"$TEST_TMP/l.err"
  L_RC=$?
  assert_exit_code "$L_RC" "$BASE_RC" "case l: rc matches unset baseline"
  assert_eq "$(cat "$TEST_TMP/l.out")" "$BASE_OUT" "case l: stdout matches unset baseline"
  L_LINES=$(grep -c '^review-ledger-archive' "$TEST_TMP/l.err" || true)
  if [ "$L_LINES" -gt 1 ]; then
    fail "case l: more than one review-ledger-archive stderr line ($L_LINES)"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  chmod 0755 "$TEST_TMP/archive-l" || true
  unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
fi

# (m) same phase name, different g1/range.json bytes, two ledger ids.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-m"
LEDGER_M1="$TEST_TMP/ledger-m1"
LEDGER_M2="$TEST_TMP/ledger-m2"
make_ledger "$LEDGER_M1" samephase "2026-08-01T00:00:00.000Z" '{"base":"m","head":"one"}'
make_ledger "$LEDGER_M2" samephase "2026-08-09T00:00:00.000Z" '{"base":"m","head":"two"}'
write_fin_disp "$TEST_TMP/disp-m1.json" samephase
write_fin_disp "$TEST_TMP/disp-m2.json" samephase
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_M1" --phase samephase --generation 1 --dispositions "$TEST_TMP/disp-m1.json" >"$TEST_TMP/m1.out" 2>"$TEST_TMP/m1.err"
assert_exit_code "$?" "0" "case m: first finalize exits 0"
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_M2" --phase samephase --generation 1 --dispositions "$TEST_TMP/disp-m2.json" >"$TEST_TMP/m2.out" 2>"$TEST_TMP/m2.err"
assert_exit_code "$?" "0" "case m: second finalize exits 0"
M_IDS=$(find "$TEST_TMP/archive-m" -mindepth 3 -maxdepth 3 -type d | sort)
M_COUNT=$(printf '%s\n' "$M_IDS" | grep -c . || true)
assert_eq "$M_COUNT" "2" "case m: two ledger-id directories"
M_A=$(printf '%s\n' "$M_IDS" | sed -n '1p')
M_B=$(printf '%s\n' "$M_IDS" | sed -n '2p')
assert_neq "$M_A" "$M_B" "case m: ledger ids differ"
assert_file_exists "$M_A/review-samephase/chain.json" "case m: first chain"
assert_file_exists "$M_B/review-samephase/chain.json" "case m: second chain"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (n) two phases, one ledger, concurrent finalize, one ledger-id.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-n"
export AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=400
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1
LEDGER_N="$TEST_TMP/ledger-n"
make_ledger "$LEDGER_N" alpha "2026-09-01T00:00:00.000Z"
make_ledger "$LEDGER_N" beta "2026-09-01T00:00:01.000Z"
write_fin_disp "$TEST_TMP/disp-na.json" alpha
write_fin_disp "$TEST_TMP/disp-nb.json" beta
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_N" --phase alpha --generation 1 --dispositions "$TEST_TMP/disp-na.json" >"$TEST_TMP/na.out" 2>"$TEST_TMP/na.err" &
N1=$!
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_N" --phase beta --generation 1 --dispositions "$TEST_TMP/disp-nb.json" >"$TEST_TMP/nb.out" 2>"$TEST_TMP/nb.err" &
N2=$!
wait "$N1"; RN1=$?
wait "$N2"; RN2=$?
assert_exit_code "$RN1" "0" "case n: phase alpha exits 0"
assert_exit_code "$RN2" "0" "case n: phase beta exits 0"
MERGED_N=$(find "$TEST_TMP/archive-n" -name chain.json -not -path '*/review-*/*')
node -e '
  const fs = require("fs");
  const chains = process.argv.slice(1).filter(Boolean);
  if (chains.length !== 1) process.exit(7);
  const j = JSON.parse(fs.readFileSync(chains[0], "utf8"));
  const phases = new Set(j.map((e) => e.phase));
  if (!phases.has("alpha") || !phases.has("beta")) process.exit(8);
' $MERGED_N
assert_exit_code "$?" "0" "case n: archived chain.json parses and has both phases"
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (o) negative control: catch rethrows, read-only finalize must diverge.
if [ "$(id -u)" -eq 0 ]; then
  echo "case o skipped: running as root, chmod 0555 is not a write barrier"
else
  LOOP_O="$TEST_TMP/hetero-review-loop-o.js"
  cp "$LOOP" "$LOOP_O"
  python3 - "$LOOP_O" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = """  } catch (archiveErr) {
    console.error(`review-ledger-archive: ${archiveErr && archiveErr.message ? archiveErr.message : archiveErr}`);
  }"""
new = """  } catch (archiveErr) {
    throw archiveErr;
  }"""
if old not in t:
    sys.stderr.write("case o: archive try/catch marker missing\n")
    sys.exit(2)
p.write_text(t.replace(old, new, 1))
PY
  O_PATCH=$?
  assert_exit_code "$O_PATCH" "0" "case o: temp loop catch rethrows"
  export AUTOPILOT_REVIEW_LOOP_RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
  export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-o"
  mkdir -p "$TEST_TMP/archive-o"
  chmod 0555 "$TEST_TMP/archive-o"
  LEDGER_O="$TEST_TMP/ledger-o"
  make_ledger "$LEDGER_O" pj "2026-07-04T00:00:00.000Z"
  write_fin_disp "$TEST_TMP/disp-o.json" pj
  node "$LOOP_O" finalize --repo-root "$REPO" --ledger "$LEDGER_O" --phase pj --generation 1 --dispositions "$TEST_TMP/disp-o.json" >"$TEST_TMP/o.out" 2>"$TEST_TMP/o.err"
  O_RC=$?
  if [ "$O_RC" = "$BASE_RC" ] && [ "$(cat "$TEST_TMP/o.out")" = "$BASE_OUT" ]; then
    fail "case o: read-only finalize without the catch matched the baseline"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  chmod 0755 "$TEST_TMP/archive-o" || true
  unset AUTOPILOT_REVIEW_LOOP_RESOLVER
  unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
fi

# (p) negative control: lock acquisition removed, concurrent finalize must lose a phase.
MUT_P="$TEST_TMP/mut-p/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_P")"
sed 's/const release = acquireLedgerLock(lockDir);/const release = function () {};/' "$LIB" > "$MUT_P"
LOOP_P="$TEST_TMP/hetero-review-loop-p.js"
cp "$LOOP" "$LOOP_P"
python3 - "$LOOP_P" "$MUT_P" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "require('./lib/review-ledger-copy.js')"
new = "require(" + repr(sys.argv[2]) + ")"
if old not in t:
    sys.stderr.write("case p: archive require marker missing\n")
    sys.exit(2)
p.write_text(t.replace(old, new, 1))
PY
assert_exit_code "$?" "0" "case p: temp loop points at the lockless lib"
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=400
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1
LOST_P=0
P_RUNS=3
for i in 1 2 3; do
  export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-p-$i"
  LEDGER_P="$TEST_TMP/ledger-p-$i"
  make_ledger "$LEDGER_P" alpha "2026-09-11T00:00:00.000Z"
  make_ledger "$LEDGER_P" beta "2026-09-11T00:00:01.000Z"
  write_fin_disp "$TEST_TMP/disp-pa-$i.json" alpha
  write_fin_disp "$TEST_TMP/disp-pb-$i.json" beta
  node "$LOOP_P" finalize --repo-root "$REPO" --ledger "$LEDGER_P" --phase alpha --generation 1 --dispositions "$TEST_TMP/disp-pa-$i.json" >"$TEST_TMP/pa-$i.out" 2>"$TEST_TMP/pa-$i.err" &
  P1=$!
  node "$LOOP_P" finalize --repo-root "$REPO" --ledger "$LEDGER_P" --phase beta --generation 1 --dispositions "$TEST_TMP/disp-pb-$i.json" >"$TEST_TMP/pb-$i.out" 2>"$TEST_TMP/pb-$i.err" &
  P2=$!
  wait "$P1"; E1=$?
  wait "$P2"; E2=$?
  MERGED_P=$(find "$TEST_TMP/archive-p-$i" -name chain.json -not -path '*/review-*/*' 2>/dev/null || true)
  if [ "$E1" != 0 ] || [ "$E2" != 0 ]; then LOST_P=$((LOST_P + 1)); continue; fi
  node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(9); }
    const phases = new Set(j.map((e) => e.phase));
    if (!phases.has("alpha") || !phases.has("beta")) process.exit(9);
  ' $MERGED_P >/dev/null 2>&1 || LOST_P=$((LOST_P + 1))
done
if [ "$LOST_P" -ne "$P_RUNS" ]; then
  fail "case p: lockless concurrent finalize never lost a phase or failed lost=$LOST_P/$P_RUNS"
fi
echo "case p: lockless finalizes lost or failed $LOST_P/$P_RUNS"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

# Real-shaped chain.json (no collected_at / at). With no chain stamp the
# ledger-id date is the local calendar date of the first archive.
REAL_WHEN="2026-01-20T08:09:10Z"
TODAY=$(node -e 'const d=new Date(); const p=n=>String(n).padStart(2,"0"); process.stdout.write(d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()));')
TODAY_MONTH=${TODAY:0:7}

count_ledger_ids() {
  find "$1" -mindepth 3 -maxdepth 3 -type d ! -name '.*' 2>/dev/null | grep -c . || true
}

# (q) copyLedger. Date prefix is the first-archive local date, not range.json mtime.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-q"
LEDGER_Q="$TEST_TMP/ledger-q"
make_real_ledger "$LEDGER_Q" alpha "$REAL_WHEN"
DEST_Q=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_Q" "$REPO")
assert_exit_code "$?" "0" "case q: copyLedger exits 0"
assert_file_exists "$DEST_Q/archive.json" "case q: archive.json"
assert_file_exists "$DEST_Q/review-alpha/chain.json" "case q: review-alpha/chain.json"
REL_Q=${DEST_Q#"$TEST_TMP/archive-q/"}
case "$REL_Q" in
  */"$TODAY_MONTH"/"$TODAY"-*) ;;
  *) fail "case q: ledger-id date prefix is not the first-archive date: $REL_Q" ;;
esac
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!j.first_collect_at || !j.first_collect_at.startsWith(process.argv[2])) process.exit(12);
' "$DEST_Q/archive.json" "$TODAY"
assert_exit_code "$?" "0" "case q: first_collect_at is the first-archive date"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (r) import CLI
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-r"
LEDGER_R="$TEST_TMP/ledger-r"
make_real_ledger "$LEDGER_R" alpha "$REAL_WHEN"
IMP_R=$(node "$CLI" import --ledger "$LEDGER_R" --repo "$REPO")
assert_exit_code "$?" "0" "case r: import exits 0"
DEST_R=$(printf '%s\n' "$IMP_R" | tail -1)
assert_file_exists "$DEST_R/archive.json" "case r: archive.json"
REL_R=${DEST_R#"$TEST_TMP/archive-r/"}
case "$REL_R" in
  */"$TODAY_MONTH"/"$TODAY"-*) ;;
  *) fail "case r: ledger-id date prefix is not the first-archive date: $REL_R" ;;
esac
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (s) finalize
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-s"
LEDGER_S="$TEST_TMP/ledger-s"
make_real_ledger "$LEDGER_S" ps "$REAL_WHEN"
write_fin_disp "$TEST_TMP/disp-s.json" ps
node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_S" --phase ps --generation 1 --dispositions "$TEST_TMP/disp-s.json" >"$TEST_TMP/s.out" 2>"$TEST_TMP/s.err"
assert_exit_code "$?" "0" "case s: finalize exits 0"
S_META=$(find "$TEST_TMP/archive-s" -name archive.json)
assert_file_exists "$S_META" "case s: archive.json"
S_REL=${S_META#"$TEST_TMP/archive-s/"}
case "$S_REL" in
  */"$TODAY_MONTH"/"$TODAY"-*/archive.json) ;;
  *) fail "case s: ledger-id date prefix is not the first-archive date: $S_REL" ;;
esac
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (t) two phases, one source path, archived successively. The second phase has
# an earlier range.json mtime and different bytes. Both land in the first id.
# The date prefix is the first-archive date, not either mtime.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-t"
LEDGER_T="$TEST_TMP/ledger-t"
make_real_ledger "$LEDGER_T" alpha "2026-02-02T00:00:00Z" '{"base":"t","head":"alpha"}'
DEST_T1=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["alpha"]}).dest);' "$LIB" "$LEDGER_T" "$REPO")
make_real_ledger "$LEDGER_T" beta "2026-01-15T00:00:00Z" '{"base":"t","head":"beta"}'
DEST_T2=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["beta"]}).dest);' "$LIB" "$LEDGER_T" "$REPO")
assert_eq "$DEST_T1" "$DEST_T2" "case t: later phase reuses the first ledger-id"
T_IDS=$(count_ledger_ids "$TEST_TMP/archive-t")
assert_eq "$T_IDS" "1" "case t: one ledger-id directory"
assert_file_exists "$DEST_T1/review-alpha/chain.json" "case t: alpha chain"
assert_file_exists "$DEST_T1/review-beta/chain.json" "case t: beta chain"
case "$DEST_T1" in
  */"$TODAY_MONTH"/"$TODAY"-*) ;;
  *) fail "case t: reused id is not the first-archive date: $DEST_T1" ;;
esac
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!j.phase_keys || !j.phase_keys["review-alpha"] || !j.phase_keys["review-beta"]) process.exit(13);
  if (j.phase_keys["review-alpha"] === j.phase_keys["review-beta"]) process.exit(14);
' "$DEST_T1/archive.json"
assert_exit_code "$?" "0" "case t: phase_keys records both phases"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (u) mtime is not identity. Touching range.json keeps the id and the first-archive
# date. New range.json bytes at a different path get a new id. New bytes at the
# same path reuse the id because source_realpath still matches.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-u"
LEDGER_U="$TEST_TMP/ledger-u"
make_real_ledger "$LEDGER_U" alpha "2026-03-03T00:00:00Z" '{"base":"u","head":"one"}'
DEST_U1=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_U" "$REPO")
touch -d "2026-04-04T00:00:00Z" "$LEDGER_U/review-alpha/g1/range.json"
DEST_U_TOUCH=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_U" "$REPO")
assert_eq "$DEST_U1" "$DEST_U_TOUCH" "case u: range.json mtime change keeps the ledger-id"
case "$DEST_U1" in
  */"$TODAY_MONTH"/"$TODAY"-*) ;;
  *) fail "case u: date prefix is not the first-archive date: $DEST_U1" ;;
esac
printf '%s\n' '{"base":"u","head":"reset"}' > "$LEDGER_U/review-alpha/g1/range.json"
DEST_U_RESET=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_U" "$REPO")
assert_eq "$DEST_U1" "$DEST_U_RESET" "case u: same realpath reuses the id after a chain reset"
LEDGER_U2="$TEST_TMP/ledger-u2"
make_real_ledger "$LEDGER_U2" alpha "2026-04-04T00:00:00Z" '{"base":"u","head":"other"}'
DEST_U2=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_U2" "$REPO")
assert_neq "$DEST_U1" "$DEST_U2" "case u: different range bytes at a different path yield a new ledger-id"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (v) plain cp -r does not preserve mtime. Import original, then the copy: one id.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-v"
LEDGER_V="$TEST_TMP/ledger-v"
COPY_V="$TEST_TMP/ledger-v-copy"
make_real_ledger "$LEDGER_V" alpha "2026-01-20T08:09:10Z" '{"base":"v","head":"same"}'
sleep 1
cp -r "$LEDGER_V" "$COPY_V"
MT_SRC=$(stat -c %Y "$LEDGER_V/review-alpha/g1/range.json")
MT_CP=$(stat -c %Y "$COPY_V/review-alpha/g1/range.json")
assert_neq "$MT_SRC" "$MT_CP" "case v: cp -r left different range.json mtimes"
node "$CLI" import --ledger "$LEDGER_V" --repo "$REPO" >/dev/null
assert_exit_code "$?" "0" "case v: import original exits 0"
node "$CLI" import --ledger "$COPY_V" --repo "$REPO" >/dev/null
assert_exit_code "$?" "0" "case v: import copy exits 0"
V_IDS=$(count_ledger_ids "$TEST_TMP/archive-v")
assert_eq "$V_IDS" "1" "case v: original and cp -r copy share one ledger-id"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (w) collected_at still wins over the clock. Fixture keeps a chain stamp.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-w"
LEDGER_W="$TEST_TMP/ledger-w"
make_ledger "$LEDGER_W" alpha "2026-06-07T08:09:10.000Z"
DEST_W=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_W" "$REPO")
case "$DEST_W" in
  */2026-06/2026-06-07-*) ;;
  *) fail "case w: collected_at did not supply the date prefix: $DEST_W" ;;
esac
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!j.first_collect_at || !j.first_collect_at.startsWith("2026-06-07")) process.exit(15);
' "$DEST_W/archive.json"
assert_exit_code "$?" "0" "case w: first_collect_at matches collected_at"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (x) red-on-broken: a lib whose phase key is range.json mtime fails case v.
MUT_X="$TEST_TMP/mut-x/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_X")"
cp "$LIB" "$MUT_X"
python3 - "$MUT_X" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
start = t.find("function phaseContentKey(")
if start < 0:
    sys.stderr.write("case x: phaseContentKey missing\n")
    sys.exit(2)
end = t.find("\nfunction ", start + 1)
if end < 0:
    sys.stderr.write("case x: phaseContentKey end missing\n")
    sys.exit(2)
broken = """function phaseContentKey(ledgerDir, phaseName) {
  const rangePath = path.join(ledgerDir, phaseName, 'g1', 'range.json');
  const mtimeMs = fs.statSync(rangePath).mtimeMs;
  return crypto.createHash('sha1').update(String(mtimeMs)).digest('hex');
}
"""
p.write_text(t[:start] + broken + t[end+1:])
PY
assert_exit_code "$?" "0" "case x: mtime phase key patched onto a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-x"
LEDGER_X="$TEST_TMP/ledger-x"
COPY_X="$TEST_TMP/ledger-x-copy"
make_real_ledger "$LEDGER_X" alpha "2026-01-20T08:09:10Z" '{"base":"x","head":"same"}'
sleep 1
cp -r "$LEDGER_X" "$COPY_X"
# The CLI loads the real lib. Drive the broken copy the same way import does.
node -e '
  const lib = require(process.argv[1]);
  lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3], importedFrom: require("fs").realpathSync(process.argv[2]) });
  lib.copyLedger({ ledgerDir: process.argv[4], repoDir: process.argv[3], importedFrom: require("fs").realpathSync(process.argv[4]) });
' "$MUT_X" "$LEDGER_X" "$REPO" "$COPY_X" >/dev/null
X_RC=$?
X_IDS=$(count_ledger_ids "$TEST_TMP/archive-x")
if [ "$X_RC" != 0 ]; then
  fail "case x: broken lib did not run (exit $X_RC)"
elif [ "$X_IDS" = "1" ]; then
  fail "case x: mtime phase key still produced one ledger-id (negative control is blind)"
else
  echo "case x: red-on-broken (mtime key split one ledger into $X_IDS ids)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# (y) one unusable phase must not abort the copy. Three real-shaped phases,
# one empty aborted directory, one chain.json with no g1, one g1 that has
# only range.json. Optional files are absent, not an error.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-y"
LEDGER_Y="$TEST_TMP/ledger-y"
make_real_ledger "$LEDGER_Y" good1 "" '{"base":"y","head":"1"}'
make_real_ledger "$LEDGER_Y" good2 "" '{"base":"y","head":"2"}'
make_real_ledger "$LEDGER_Y" good3 "" '{"base":"y","head":"3"}'
mkdir -p "$LEDGER_Y/review-bl0044-g1-aborted-allowlist"
mkdir -p "$LEDGER_Y/review-nog1"
cp "$LEDGER_Y/review-good1/chain.json" "$LEDGER_Y/review-nog1/chain.json"
mkdir -p "$LEDGER_Y/review-rangeonly/g1"
cp "$LEDGER_Y/review-good1/chain.json" "$LEDGER_Y/review-rangeonly/chain.json"
printf '%s\n' '{"base":"y","head":"range"}' > "$LEDGER_Y/review-rangeonly/g1/range.json"
node "$CLI" import --ledger "$LEDGER_Y" --repo "$REPO" >"$TEST_TMP/y.out" 2>"$TEST_TMP/y.err"
assert_exit_code "$?" "0" "case y: import with unusable phases exits 0"
DEST_Y=$(cat "$TEST_TMP/y.out")
for phase in good1 good2 good3 rangeonly; do
  assert_file_exists "$DEST_Y/review-$phase/chain.json" "case y: review-$phase copied"
  assert_file_exists "$DEST_Y/review-$phase/g1/range.json" "case y: review-$phase range.json"
done
assert_file_absent "$DEST_Y/review-bl0044-g1-aborted-allowlist" "case y: empty phase not copied"
assert_file_absent "$DEST_Y/review-nog1" "case y: chain-only phase not copied"
assert_file_absent "$DEST_Y/review-rangeonly/g1/findings.json" "case y: missing findings.json is not an error"
assert_file_absent "$DEST_Y/review-rangeonly/g1/dispositions.json" "case y: missing dispositions.json is not an error"
grep -F 'review-ledger-archive: skipped review-bl0044-g1-aborted-allowlist' "$TEST_TMP/y.err" >/dev/null
assert_exit_code "$?" "0" "case y: stderr names the empty phase"
grep -F 'review-ledger-archive: skipped review-nog1' "$TEST_TMP/y.err" >/dev/null
assert_exit_code "$?" "0" "case y: stderr names the phase with no g1"
grep -F 'review-ledger-archive: skipped review-rangeonly' "$TEST_TMP/y.err" >/dev/null && fail "case y: range-only phase was skipped"
Y_IDS=$(count_ledger_ids "$TEST_TMP/archive-y")
assert_eq "$Y_IDS" "1" "case y: one ledger-id"
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const keys = Object.keys(j.phase_keys || {}).sort();
  const want = ["review-good1", "review-good2", "review-good3", "review-rangeonly"];
  if (keys.join() !== want.join()) process.exit(16);
' "$DEST_Y/archive.json"
assert_exit_code "$?" "0" "case y: phase_keys covers only copied phases"
# A skipped phase must not change the id. Same copied bytes, no empty dirs.
LEDGER_Y2="$TEST_TMP/ledger-y2"
make_real_ledger "$LEDGER_Y2" good1 "" '{"base":"y","head":"1"}'
make_real_ledger "$LEDGER_Y2" good2 "" '{"base":"y","head":"2"}'
make_real_ledger "$LEDGER_Y2" good3 "" '{"base":"y","head":"3"}'
mkdir -p "$LEDGER_Y2/review-rangeonly/g1"
cp "$LEDGER_Y/review-rangeonly/chain.json" "$LEDGER_Y2/review-rangeonly/chain.json"
cp "$LEDGER_Y/review-rangeonly/g1/range.json" "$LEDGER_Y2/review-rangeonly/g1/range.json"
node "$CLI" import --ledger "$LEDGER_Y2" --repo "$REPO" >"$TEST_TMP/y2.out" 2>/dev/null
assert_exit_code "$?" "0" "case y: twin without skipped phases exits 0"
assert_eq "$(cat "$TEST_TMP/y2.out")" "$DEST_Y" "case y: skipped phases do not change the ledger-id"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (z) a ledger of only unusable phases exits non-zero and archives nothing.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-z"
LEDGER_Z="$TEST_TMP/ledger-z"
mkdir -p "$LEDGER_Z/review-bl0044-g1-aborted-allowlist"
mkdir -p "$LEDGER_Z/review-nog1"
printf '%s\n' '[{"generation":1,"base":"a","head":"b","status":"pending"}]' > "$LEDGER_Z/review-nog1/chain.json"
node "$CLI" import --ledger "$LEDGER_Z" --repo "$REPO" >"$TEST_TMP/z.out" 2>"$TEST_TMP/z.err"
assert_exit_code "$?" "1" "case z: only unusable phases exits 1"
Z_IDS=$(count_ledger_ids "$TEST_TMP/archive-z")
assert_eq "$Z_IDS" "0" "case z: nothing archived"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (aa) 184 phase directories, four of them empty. One id, 180 copied, under 60s.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-aa"
LEDGER_AA="$TEST_TMP/ledger-aa"
node -e '
  const fs = require("fs");
  const path = require("path");
  const dest = process.argv[1];
  const chain = JSON.stringify([{
    generation: 1, base: "aaa", head: "bbb", seats: ["s0"], status: "pending",
    diff_sha256: "ab", findings_sha256: "ef"
  }], null, 2) + "\n";
  for (let i = 0; i < 180; i++) {
    const name = "review-p" + String(i).padStart(3, "0");
    const g1 = path.join(dest, name, "g1");
    fs.mkdirSync(g1, { recursive: true });
    fs.writeFileSync(path.join(dest, name, "chain.json"), chain);
    fs.writeFileSync(path.join(g1, "range.json"), "{\"base\":\"aa\",\"head\":\"" + i + "\"}\n");
  }
  for (let i = 0; i < 4; i++) {
    fs.mkdirSync(path.join(dest, "review-empty" + i), { recursive: true });
  }
' "$LEDGER_AA"
assert_exit_code "$?" "0" "case aa: 184-phase fixture written"
timeout 60 node "$CLI" import --ledger "$LEDGER_AA" --repo "$REPO" >"$TEST_TMP/aa.out" 2>"$TEST_TMP/aa.err"
assert_exit_code "$?" "0" "case aa: 184-phase import finishes within 60s and exits 0"
AA_IDS=$(count_ledger_ids "$TEST_TMP/archive-aa")
assert_eq "$AA_IDS" "1" "case aa: one ledger-id"
DEST_AA=$(cat "$TEST_TMP/aa.out")
AA_PHASES=$(find "$DEST_AA" -mindepth 1 -maxdepth 1 -type d -name 'review-*' | wc -l)
assert_eq "$AA_PHASES" "180" "case aa: 180 copied phases (184 minus 4 empty)"
grep -c 'review-ledger-archive: skipped review-empty' "$TEST_TMP/aa.err" >/dev/null
assert_eq "$(grep -c 'review-ledger-archive: skipped review-empty' "$TEST_TMP/aa.err")" "4" "case aa: four empty phases named on stderr"
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const keys = Object.keys(j.phase_keys || {});
  if (keys.length !== 180) process.exit(17);
  if (keys.some((k) => k.startsWith("review-empty"))) process.exit(18);
' "$DEST_AA/archive.json"
assert_exit_code "$?" "0" "case aa: phase_keys omits the empty phases"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (ab) red-on-broken: skip replaced by the old throw fails case y.
MUT_AB="$TEST_TMP/mut-ab/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AB")"
cp "$LIB" "$MUT_AB"
python3 - "$MUT_AB" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
start = t.find("function partitionLedgerPhases(")
if start < 0:
    sys.stderr.write("case ab: partitionLedgerPhases missing\n")
    sys.exit(2)
end = t.find("\nfunction ", start + 1)
if end < 0:
    sys.stderr.write("case ab: partitionLedgerPhases end missing\n")
    sys.exit(2)
broken = """function partitionLedgerPhases(ledgerDir, names) {
  for (const name of names) {
    const rangePath = path.join(ledgerDir, name, 'g1', 'range.json');
    const findingsPath = path.join(ledgerDir, name, 'g1', 'findings.json');
    if (!fs.existsSync(rangePath) && !fs.existsSync(findingsPath)) {
      throw new Error('phase content missing: no g1/range.json or g1/findings.json');
    }
  }
  return { usable: names.slice(), skipped: [] };
}
"""
p.write_text(t[:start] + broken + t[end+1:])
PY
assert_exit_code "$?" "0" "case ab: throwing partition patched onto a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ab"
# The CLI loads the real lib. Drive the broken copy the same way import does.
node -e '
  const fs = require("fs");
  const lib = require(process.argv[1]);
  const r = lib.copyLedger({
    ledgerDir: process.argv[2],
    repoDir: process.argv[3],
    importedFrom: fs.realpathSync(process.argv[2]),
  });
  if (r && r.skipped) {
    for (const name of r.skipped) console.error("review-ledger-archive: skipped " + name);
  }
  if (r && r.dest) console.log(r.dest);
' "$MUT_AB" "$LEDGER_Y" "$REPO" >"$TEST_TMP/ab.out" 2>"$TEST_TMP/ab.err"
AB_RC=$?
AB_IDS=$(count_ledger_ids "$TEST_TMP/archive-ab")
if [ "$AB_RC" = 0 ] && [ "$AB_IDS" = "1" ]; then
  fail "case ab: throwing partition still imported the mixed ledger (negative control is blind)"
else
  echo "case ab: red-on-broken (throwing partition exit $AB_RC, ledger-ids $AB_IDS)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# (ac) mode enforcement touches only dirs this call created and the ledger-id
# subtree. Pre-existing root, file, and subdirectory modes stay put.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ac"
ARCH_AC="$TEST_TMP/archive-ac"
mkdir -p "$ARCH_AC/keepdir"
printf '%s\n' '#!/bin/sh' > "$ARCH_AC/exec.sh"
printf '%s\n' 'plain' > "$ARCH_AC/plain.txt"
chmod 0755 "$ARCH_AC" "$ARCH_AC/keepdir" "$ARCH_AC/exec.sh"
chmod 0644 "$ARCH_AC/plain.txt"
LEDGER_AC="$TEST_TMP/ledger-ac"
make_ledger "$LEDGER_AC" alpha "2026-08-01T00:00:00.000Z"
DEST_AC=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_AC" "$REPO")
assert_exit_code "$?" "0" "case ac: copy into a pre-existing root exits 0"
assert_eq "$(stat -c %a "$ARCH_AC")" "755" "case ac: pre-existing archive root stays 0755"
assert_eq "$(stat -c %a "$ARCH_AC/keepdir")" "755" "case ac: pre-existing subdirectory stays 0755"
assert_eq "$(stat -c %a "$ARCH_AC/exec.sh")" "755" "case ac: pre-existing 0755 file stays 0755"
assert_eq "$(stat -c %a "$ARCH_AC/plain.txt")" "644" "case ac: pre-existing 0644 file stays 0644"
assert_eq "$(stat -c %a "$DEST_AC")" "700" "case ac: ledger-id dir is 0700"
assert_eq "$(stat -c %a "$DEST_AC/archive.json")" "600" "case ac: ledger-id file is 0600"
AC_BUCKET=$(dirname "$(dirname "$DEST_AC")")
AC_MONTH=$(dirname "$DEST_AC")
assert_eq "$(stat -c %a "$AC_BUCKET")" "700" "case ac: repo bucket created by this call is 0700"
assert_eq "$(stat -c %a "$AC_MONTH")" "700" "case ac: month dir created by this call is 0700"
MUT_AC="$TEST_TMP/mut-ac/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AC")"
cp "$LIB" "$MUT_AC"
python3 - "$MUT_AC" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "enforceModes(dest);"
new = "enforceModes(cfg.dir);"
if old not in t:
    sys.stderr.write("case ac: enforceModes(dest) missing\n")
    sys.exit(2)
p.write_text(t.replace(old, new, 1))
PY
assert_exit_code "$?" "0" "case ac: whole-root enforceModes patched onto a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ac-neg"
ARCH_ACN="$TEST_TMP/archive-ac-neg"
mkdir -p "$ARCH_ACN/keepdir"
printf '%s\n' 'plain' > "$ARCH_ACN/plain.txt"
chmod 0755 "$ARCH_ACN" "$ARCH_ACN/keepdir"
chmod 0644 "$ARCH_ACN/plain.txt"
node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]});' "$MUT_AC" "$LEDGER_AC" "$REPO" >/dev/null
ACN_RC=$?
ACN_PLAIN=$(stat -c %a "$ARCH_ACN/plain.txt")
if [ "$ACN_RC" != 0 ]; then
  fail "case ac: broken lib did not run (exit $ACN_RC)"
elif [ "$ACN_PLAIN" = "644" ]; then
  fail "case ac: whole-root enforceModes left the pre-existing file at 0644 (negative control is blind)"
else
  echo "case ac: red-on-broken (pre-existing file mode became $ACN_PLAIN)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# (ad) "~" expands to the home argument / HOME. A still-relative dir is a
# configuration error: one stderr line, nothing written, finalize rc/stdout unchanged.
AD_HOME="$TEST_TMP/home-ad"
mkdir -p "$AD_HOME/.autopilot"
cat > "$AD_HOME/.autopilot/config.json" <<'EOF'
{ "review_ledger_archive": { "dir": "~/x" } }
EOF
export HOME="$AD_HOME"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
LEDGER_AD="$TEST_TMP/ledger-ad"
make_ledger "$LEDGER_AD" alpha "2026-08-02T00:00:00.000Z"
AD_CWD="$TEST_TMP/cwd-ad"
mkdir -p "$AD_CWD"
DEST_AD=$(cd "$AD_CWD" && node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],home:process.argv[4]}).dest);' "$LIB" "$LEDGER_AD" "$REPO" "$AD_HOME")
assert_exit_code "$?" "0" "case ad: ~/x via config and home argument exits 0"
case "$DEST_AD" in
  "$AD_HOME/x/"*) ;;
  *) fail "case ad: ~/x did not land under HOME/x: $DEST_AD" ;;
esac
assert_file_absent "$AD_CWD/~" "case ad: literal tilde directory was not created"
# env form of the same expansion
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="~/x-env"
DEST_AD_ENV=$(cd "$AD_CWD" && node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],home:process.argv[4]}).dest);' "$LIB" "$LEDGER_AD" "$REPO" "$AD_HOME")
case "$DEST_AD_ENV" in
  "$AD_HOME/x-env/"*) ;;
  *) fail "case ad: env ~/x-env did not land under HOME/x-env: $DEST_AD_ENV" ;;
esac
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
# relative config: status exits 0, import exits non-zero, nothing created
python3 - "$AD_HOME/.autopilot/config.json" <<'PY'
import pathlib, sys
pathlib.Path(sys.argv[1]).write_text('{ "review_ledger_archive": { "dir": "rel/x" } }\n')
PY
AD_CWD2="$TEST_TMP/cwd-ad-rel"
mkdir -p "$AD_CWD2"
REPO_BEFORE=$(find "$REPO" -print | sort)
node "$CLI" status >"$TEST_TMP/ad-status.out" 2>"$TEST_TMP/ad-status.err"
assert_exit_code "$?" "0" "case ad: status on a relative dir exits 0"
assert_eq "$(wc -l < "$TEST_TMP/ad-status.err" | tr -d ' ')" "1" "case ad: status prints one stderr line"
grep -q '^review-ledger-archive' "$TEST_TMP/ad-status.err"
assert_exit_code "$?" "0" "case ad: status stderr starts with review-ledger-archive"
grep -q 'misconfigured' "$TEST_TMP/ad-status.err"
assert_exit_code "$?" "0" "case ad: status says the archive is misconfigured"
assert_eq "$(cat "$TEST_TMP/ad-status.out")" "" "case ad: status writes no stdout"
( cd "$AD_CWD2" && node "$CLI" import --ledger "$LEDGER_AD" --repo "$REPO" >"$TEST_TMP/ad-import.out" 2>"$TEST_TMP/ad-import.err" )
assert_exit_code "$?" "1" "case ad: import of a relative dir exits 1"
assert_eq "$(wc -l < "$TEST_TMP/ad-import.err" | tr -d ' ')" "1" "case ad: import prints one stderr line"
grep -q '^review-ledger-archive' "$TEST_TMP/ad-import.err"
assert_exit_code "$?" "0" "case ad: import stderr starts with review-ledger-archive"
AD_CWD_COUNT=$(find "$AD_CWD2" -mindepth 1 -print | wc -l | tr -d ' ')
assert_eq "$AD_CWD_COUNT" "0" "case ad: relative dir created nothing under cwd"
REPO_AFTER=$(find "$REPO" -print | sort)
assert_eq "$REPO_AFTER" "$REPO_BEFORE" "case ad: relative dir created nothing under the repo"
# env form, finalize rc/stdout unchanged
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="rel/x"
LEDGER_AD_FIN="$TEST_TMP/ledger-ad-fin"
make_ledger "$LEDGER_AD_FIN" pj "2026-06-01T00:00:00.000Z"
write_fin_disp "$TEST_TMP/disp-ad.json" pj
AD_FIN_CWD="$TEST_TMP/cwd-ad-fin"
mkdir -p "$AD_FIN_CWD"
( cd "$AD_FIN_CWD" && node "$LOOP" finalize --repo-root "$REPO" --ledger "$LEDGER_AD_FIN" --phase pj --generation 1 --dispositions "$TEST_TMP/disp-ad.json" >"$TEST_TMP/ad-fin.out" 2>"$TEST_TMP/ad-fin.err" )
assert_exit_code "$?" "0" "case ad: finalize with a relative dir exits 0"
assert_eq "$(cat "$TEST_TMP/ad-fin.out")" "$BASE_OUT" "case ad: finalize stdout unchanged"
assert_eq "$(wc -l < "$TEST_TMP/ad-fin.err" | tr -d ' ')" "1" "case ad: finalize prints one stderr line"
grep -q '^review-ledger-archive' "$TEST_TMP/ad-fin.err"
assert_exit_code "$?" "0" "case ad: finalize stderr starts with review-ledger-archive"
AD_FIN_COUNT=$(find "$AD_FIN_CWD" -mindepth 1 -print | wc -l | tr -d ' ')
assert_eq "$AD_FIN_COUNT" "0" "case ad: finalize relative dir created nothing under cwd"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
export HOME="$HOOK_HOME"
MUT_AD="$TEST_TMP/mut-ad/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AD")"
cp "$LIB" "$MUT_AD"
python3 - "$MUT_AD" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
start = t.find("function expandArchiveDir(")
if start < 0:
    sys.stderr.write("case ad: expandArchiveDir missing\n")
    sys.exit(2)
end = t.find("\nfunction ", start + 1)
if end < 0:
    sys.stderr.write("case ad: expandArchiveDir end missing\n")
    sys.exit(2)
broken = """function expandArchiveDir(value, homeDir) {
  return value;
}
"""
p.write_text(t[:start] + broken + t[end+1:])
PY
assert_exit_code "$?" "0" "case ad: tilde expansion removed on a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="~/x"
AD_NEG_CWD="$TEST_TMP/cwd-ad-neg"
AD_NEG_HOME="$TEST_TMP/home-ad-neg"
mkdir -p "$AD_NEG_CWD" "$AD_NEG_HOME"
export HOME="$AD_NEG_HOME"
( cd "$AD_NEG_CWD" && node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],home:process.argv[4]});' "$MUT_AD" "$LEDGER_AD" "$REPO" "$AD_NEG_HOME" >"$TEST_TMP/ad-neg.out" 2>"$TEST_TMP/ad-neg.err" ) || true
if [ -d "$AD_NEG_HOME/x" ]; then
  fail "case ad: lib without tilde expansion still wrote HOME/x (negative control is blind)"
elif [ -d "$AD_NEG_CWD/~" ]; then
  echo "case ad: red-on-broken (literal ~ under cwd)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "case ad: broken lib did not create $AD_NEG_CWD/~ (negative control is blind)"
fi
rm -rf "$AD_NEG_CWD/~"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT
export HOME="$HOOK_HOME"

# (ae) the holder refreshes the owner file after each phase. A shortened stale
# threshold cannot steal a live lock. A dead owner file older than the threshold
# is recovered. The lock directory mtime is fresh; only the owner file is old.
export AUTOPILOT_REVIEW_LEDGER_LOCK_STALE_MS=1500
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ae"
LEDGER_AE="$TEST_TMP/ledger-ae"
make_ledger "$LEDGER_AE" p0 "2026-08-03T00:00:00.000Z"
make_ledger "$LEDGER_AE" p1 "2026-08-03T00:00:01.000Z"
make_ledger "$LEDGER_AE" p2 "2026-08-03T00:00:02.000Z"
AE_A_DONE="$TEST_TMP/ae-a.done"
AE_B_DONE="$TEST_TMP/ae-b.done"
rm -f "$AE_A_DONE" "$AE_B_DONE"
AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1 AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=800 node -e '
  const fs = require("fs");
  const lib = require(process.argv[1]);
  lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3], phases: ["p0", "p1", "p2"] });
  fs.writeFileSync(process.argv[4], String(Date.now()));
' "$LIB" "$LEDGER_AE" "$REPO" "$AE_A_DONE" &
AE_A=$!
AE_LOCK=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  AE_LOCK=$(find "$TEST_TMP/archive-ae" -type d -name '*.lock' ! -name '.ledger-id.lock' 2>/dev/null | head -1 || true)
  if [ -n "$AE_LOCK" ]; then break; fi
  sleep 0.05
done
if [ -z "$AE_LOCK" ]; then
  fail "case ae: holder did not create the ledger lock"
else
  node -e 'const lib=require(process.argv[1]); const fs=require("fs"); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["p0"]}); fs.writeFileSync(process.argv[4], String(Date.now()));' "$LIB" "$LEDGER_AE" "$REPO" "$AE_B_DONE" &
  AE_B=$!
  wait "$AE_A"; AE_A_RC=$?
  wait "$AE_B"; AE_B_RC=$?
  assert_exit_code "$AE_A_RC" "0" "case ae: refreshing holder exits 0"
  assert_exit_code "$AE_B_RC" "0" "case ae: waiter exits 0"
  AE_A_TS=$(cat "$AE_A_DONE" 2>/dev/null || echo 0)
  AE_B_TS=$(cat "$AE_B_DONE" 2>/dev/null || echo 0)
  if [ "$AE_B_TS" -lt "$AE_A_TS" ]; then
    fail "case ae: waiter finished before the holder (lock was taken over)"
  else
    echo "case ae: waiter finished after the holder"
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
fi
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
# Dead holder: owner file is old, lock directory mtime is new.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ae-dead"
AE_BUCKET=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.repoBucket(process.argv[2]));' "$LIB" "$REPO")
mkdir -p "$TEST_TMP/archive-ae-dead/$AE_BUCKET/.ledger-id.lock"
printf '%s\n' 'dead-token' > "$TEST_TMP/archive-ae-dead/$AE_BUCKET/.ledger-id.lock/owner"
touch -d '5 seconds ago' "$TEST_TMP/archive-ae-dead/$AE_BUCKET/.ledger-id.lock/owner"
timeout 8 node -e 'const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]});' "$LIB" "$LEDGER_AE" "$REPO" >"$TEST_TMP/ae-dead.out" 2>"$TEST_TMP/ae-dead.err"
assert_exit_code "$?" "0" "case ae: stale owner file is recovered within 8s"
AE_DEAD_IDS=$(count_ledger_ids "$TEST_TMP/archive-ae-dead")
assert_eq "$AE_DEAD_IDS" "1" "case ae: recovered lock archived one ledger"
MUT_AE="$TEST_TMP/mut-ae/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AE")"
cp "$LIB" "$MUT_AE"
python3 - "$MUT_AE" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "refreshLockOwner(ownerFile);"
if old not in t:
    sys.stderr.write("case ae: refreshLockOwner call missing\n")
    sys.exit(2)
p.write_text(t.replace(old, "/* refresh removed */;", 1))
PY
assert_exit_code "$?" "0" "case ae: refresh removed on a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ae-neg"
AE_NA="$TEST_TMP/ae-na.done"
AE_NB="$TEST_TMP/ae-nb.done"
rm -f "$AE_NA" "$AE_NB"
AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1 AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=800 node -e '
  const fs = require("fs");
  const lib = require(process.argv[1]);
  lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3], phases: ["p0", "p1", "p2"] });
  fs.writeFileSync(process.argv[4], String(Date.now()));
' "$MUT_AE" "$LEDGER_AE" "$REPO" "$AE_NA" &
AE_NA_PID=$!
AE_NLOCK=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  AE_NLOCK=$(find "$TEST_TMP/archive-ae-neg" -type d -name '*.lock' ! -name '.ledger-id.lock' 2>/dev/null | head -1 || true)
  if [ -n "$AE_NLOCK" ]; then break; fi
  sleep 0.05
done
node -e 'const lib=require(process.argv[1]); const fs=require("fs"); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3],phases:["p0"]}); fs.writeFileSync(process.argv[4], String(Date.now()));' "$MUT_AE" "$LEDGER_AE" "$REPO" "$AE_NB" &
AE_NB_PID=$!
wait "$AE_NA_PID" || true
wait "$AE_NB_PID" || true
AE_NA_TS=$(cat "$AE_NA" 2>/dev/null || echo 0)
AE_NB_TS=$(cat "$AE_NB" 2>/dev/null || echo 0)
if [ "$AE_NB_TS" = 0 ] || [ "$AE_NA_TS" = 0 ] || [ "$AE_NB_TS" -ge "$AE_NA_TS" ]; then
  fail "case ae: lib without refresh did not lose the live lock (negative control is blind) A=$AE_NA_TS B=$AE_NB_TS"
else
  echo "case ae: red-on-broken (waiter finished at $AE_NB_TS before holder $AE_NA_TS)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_LOCK_STALE_MS
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# Round 8 phrase. Working tree only: no git history. Surviving fragments and
# the stale clauses (held here as constants) share one check function.
AF_KEEP_A='Finalize is wired in'
AF_KEEP_B='only when a dir is configured'
AF_STALE_A='Finalize is not wired in this change'
AF_STALE_B='the finalize hook is a later change'
AF_WORD_FILES=(
  "$REPO_ROOT/CHANGELOG.md"
  "$REPO_ROOT/docs/scripts-inventory.md"
  "$REPO_ROOT/scripts/lib/review-ledger-copy.js"
  "$REPO_ROOT/docs/settings-reference.md"
)

# Prints how many wording checks fail. Zero means both surviving fragments
# are present and neither stale constant is.
af_wording_hits() {
  local f="$1"
  local hits=0
  grep -F "$AF_STALE_A" "$f" >/dev/null && hits=$((hits + 1))
  grep -F "$AF_STALE_B" "$f" >/dev/null && hits=$((hits + 1))
  grep -F "$AF_KEEP_A" "$f" >/dev/null || hits=$((hits + 1))
  grep -F "$AF_KEEP_B" "$f" >/dev/null || hits=$((hits + 1))
  printf '%s\n' "$hits"
}

# (af) wording on the real files, then the same function on mutated copies.
for f in "${AF_WORD_FILES[@]}"; do
  AF_HITS=$(af_wording_hits "$f")
  if [ "$AF_HITS" != 0 ]; then
    fail "case af: $f wording hits $AF_HITS"
  else
    echo "case af: $f wording ok"
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
done
AF_MUT=$(mktemp -d)
AF_RED=0
for f in "${AF_WORD_FILES[@]}"; do
  af_base=$(basename "$f")
  cp "$f" "$AF_MUT/$af_base"
  sed -i \
    -e "s/${AF_KEEP_A}/${AF_STALE_A}/g" \
    -e "s/${AF_KEEP_B}/${AF_STALE_B}/g" \
    "$AF_MUT/$af_base"
  af_one=$(af_wording_hits "$AF_MUT/$af_base")
  AF_RED=$((AF_RED + af_one))
done
if [ "$AF_RED" = 0 ]; then
  fail "case af: mutated copies still pass (negative control is blind)"
else
  echo "case af: red-on-broken (hit count $AF_RED)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
rm -rf "$AF_MUT"

# (ag) chain.json without generation 1 is skipped. Other phases are archived.
LEDGER_AG="$TEST_TMP/ledger-ag"
make_real_ledger "$LEDGER_AG" good "2026-01-02T00:00:00Z" '{"base":"ag","head":"good"}'
mkdir -p "$LEDGER_AG/review-nogen1/g1"
printf '%s\n' '[{"generation":2,"base":"aaa","head":"bbb","status":"pending"}]' > "$LEDGER_AG/review-nogen1/chain.json"
printf '%s\n' '{"base":"ag","head":"nogen"}' > "$LEDGER_AG/review-nogen1/g1/range.json"
printf '%s\n' '{"findings":[]}' > "$LEDGER_AG/review-nogen1/g1/findings.json"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ag"
node "$CLI" import --ledger "$LEDGER_AG" --repo "$REPO" >"$TEST_TMP/ag.out" 2>"$TEST_TMP/ag.err"
assert_exit_code "$?" "0" "case ag: import exits 0"
DEST_AG=$(cat "$TEST_TMP/ag.out")
assert_file_exists "$DEST_AG/review-good/chain.json" "case ag: good phase archived"
assert_file_absent "$DEST_AG/review-nogen1" "case ag: phase without generation 1 not copied"
grep -F 'review-ledger-archive: skipped review-nogen1' "$TEST_TMP/ag.err" >/dev/null
assert_exit_code "$?" "0" "case ag: stderr names the phase with no generation 1"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (ah) negative control: phaseCopyable that ignores generation 1 throws as before.
MUT_AH="$TEST_TMP/mut-ah/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AH")"
cp "$LIB" "$MUT_AH"
python3 - "$MUT_AH" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "if (!Array.isArray(chain) || !chain.some((e) => e && e.generation === 1)) return false;\n"
if old not in t:
    sys.stderr.write("case ah: generation 1 guard missing\n")
    sys.exit(2)
p.write_text(t.replace(old, "", 1))
PY
assert_exit_code "$?" "0" "case ah: generation guard removed on a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ah"
node -e '
  const fs = require("fs");
  const lib = require(process.argv[1]);
  try {
    const r = lib.copyLedger({
      ledgerDir: process.argv[2],
      repoDir: process.argv[3],
      importedFrom: fs.realpathSync(process.argv[2]),
    });
    if (r && r.skipped) {
      for (const name of r.skipped) console.error("review-ledger-archive: skipped " + name);
    }
    if (r && r.dest) console.log(r.dest);
    process.exit(0);
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
' "$MUT_AH" "$LEDGER_AG" "$REPO" >"$TEST_TMP/ah.out" 2>"$TEST_TMP/ah.err"
AH_RC=$?
if [ "$AH_RC" = 0 ] && grep -F 'review-ledger-archive: skipped review-nogen1' "$TEST_TMP/ah.err" >/dev/null && [ -f "$(cat "$TEST_TMP/ah.out")/review-good/chain.json" ]; then
  fail "case ah: lib that ignores a missing generation 1 still skipped the phase (negative control is blind)"
else
  echo "case ah: red-on-broken (exit $AH_RC)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# (ai) read-only archive root: one message, non-zero, mode stays 0555.
# Status on the same root exits 0. Skip as root (0555 is not a barrier).
if [ "$(id -u)" = 0 ]; then
  echo "case ai skipped: running as root, chmod 0555 is not a write barrier"
else
  LEDGER_AI="$TEST_TMP/ledger-ai"
  make_real_ledger "$LEDGER_AI" good "2026-01-03T00:00:00Z" '{"base":"ai","head":"good"}'
  export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ai"
  mkdir -p "$TEST_TMP/archive-ai"
  chmod 0555 "$TEST_TMP/archive-ai"
  AI_RC=0
  node "$CLI" import --ledger "$LEDGER_AI" --repo "$REPO" >"$TEST_TMP/ai.out" 2>"$TEST_TMP/ai.err" || AI_RC=$?
  AI_MODE=$(stat -c '%a' "$TEST_TMP/archive-ai")
  assert_eq "$AI_MODE" "555" "case ai: archive root stays 0555"
  if [ "$AI_RC" = 0 ]; then
    fail "case ai: import of a read-only root exited 0"
  fi
  grep -F 'review-ledger-archive: archive root is not writable' "$TEST_TMP/ai.err" >/dev/null
  assert_exit_code "$?" "0" "case ai: one not-writable message"
  AI_LINES=$(grep -c . "$TEST_TMP/ai.err" || true)
  assert_eq "$AI_LINES" "1" "case ai: stderr is one line"
  node "$CLI" status >"$TEST_TMP/ai-status.out" 2>"$TEST_TMP/ai-status.err"
  assert_exit_code "$?" "0" "case ai: status on a read-only root exits 0"
  AI_MODE2=$(stat -c '%a' "$TEST_TMP/archive-ai")
  assert_eq "$AI_MODE2" "555" "case ai: status leaves the root 0555"
  chmod 0755 "$TEST_TMP/archive-ai" || true

  # (aj) negative control: CLI without the W_OK check does not print that message.
  MUT_AJ_DIR="$TEST_TMP/mut-aj"
  mkdir -p "$MUT_AJ_DIR/lib"
  cp "$CLI" "$MUT_AJ_DIR/review-ledger-archive.js"
  cp "$LIB" "$MUT_AJ_DIR/lib/review-ledger-copy.js"
  python3 - "$MUT_AJ_DIR/review-ledger-archive.js" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = """    if (cfg.dir && !archiveRootWritable(cfg.dir)) {
      console.error('review-ledger-archive: archive root is not writable');
      return 1;
    }
"""
if old not in t:
    sys.stderr.write("case aj: W_OK check missing\n")
    sys.exit(2)
p.write_text(t.replace(old, "", 1))
PY
  assert_exit_code "$?" "0" "case aj: W_OK check removed on a temp CLI"
  chmod 0555 "$TEST_TMP/archive-ai"
  AJ_RC=0
  node "$MUT_AJ_DIR/review-ledger-archive.js" import --ledger "$LEDGER_AI" --repo "$REPO" >"$TEST_TMP/aj.out" 2>"$TEST_TMP/aj.err" || AJ_RC=$?
  AJ_MODE=$(stat -c '%a' "$TEST_TMP/archive-ai")
  if grep -F 'review-ledger-archive: archive root is not writable' "$TEST_TMP/aj.err" >/dev/null && [ "$AJ_MODE" = "555" ] && [ "$AJ_RC" != 0 ]; then
    fail "case aj: CLI without W_OK still reported the not-writable line (negative control is blind)"
  else
    echo "case aj: red-on-broken (exit $AJ_RC mode $AJ_MODE)"
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  chmod 0755 "$TEST_TMP/archive-ai" || true
  unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
fi

# (ak) unsafe --phase is rejected before any read or write.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-ak"
AK_GHOST="$TEST_TMP/archive-ak-ghost"
rm -rf "$AK_GHOST"
for ak_phase in '../x' 'a/b' ''; do
  rm -rf "$TEST_TMP/archive-ak"
  AK_RC=0
  node "$CLI" import --ledger "$TEST_TMP/no-such-ledger-ak" --repo "$REPO" --phase "$ak_phase" >"$TEST_TMP/ak.out" 2>"$TEST_TMP/ak.err" || AK_RC=$?
  if [ "$AK_RC" = 0 ]; then
    fail "case ak: --phase $(printf '%q' "$ak_phase") exited 0"
  fi
  grep -F 'review-ledger-archive: unsafe phase name' "$TEST_TMP/ak.err" >/dev/null
  assert_exit_code "$?" "0" "case ak: unsafe phase message for $(printf '%q' "$ak_phase")"
  AK_LINES=$(grep -c . "$TEST_TMP/ak.err" || true)
  assert_eq "$AK_LINES" "1" "case ak: stderr is one line"
  if [ -e "$TEST_TMP/archive-ak" ] || [ -e "$AK_GHOST" ]; then
    fail "case ak: unsafe --phase wrote an archive directory"
  fi
done
# A missing ledger is not touched: the error is the phase, not "ledger not found".
grep -F 'ledger not found' "$TEST_TMP/ak.err" >/dev/null && fail "case ak: ledger was read before the phase check"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (al) a review-* symlink to a directory outside the ledger is not followed.
LEDGER_AL="$TEST_TMP/ledger-al"
OUTSIDE_AL="$TEST_TMP/outside-al"
make_real_ledger "$LEDGER_AL" good "2026-01-04T00:00:00Z" '{"base":"al","head":"good"}'
mkdir -p "$OUTSIDE_AL/g1"
printf '%s\n' '[{"generation":1,"base":"aaa","head":"bbb","status":"pending"}]' > "$OUTSIDE_AL/chain.json"
printf '%s\n' 'SENTINEL_OUTSIDE' > "$OUTSIDE_AL/g1/range.json"
ln -s "$OUTSIDE_AL" "$LEDGER_AL/review-evil"
OUTSIDE_BEFORE=$(find "$OUTSIDE_AL" -printf '%p\n' | sort)
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-al"
node "$CLI" import --ledger "$LEDGER_AL" --repo "$REPO" >"$TEST_TMP/al.out" 2>"$TEST_TMP/al.err"
assert_exit_code "$?" "0" "case al: import exits 0"
DEST_AL=$(cat "$TEST_TMP/al.out")
assert_file_exists "$DEST_AL/review-good/chain.json" "case al: good phase archived"
assert_file_absent "$DEST_AL/review-evil" "case al: symlinked phase not copied"
grep -F 'review-ledger-archive: skipped review-evil' "$TEST_TMP/al.err" >/dev/null
assert_exit_code "$?" "0" "case al: stderr names the symlinked phase"
if grep -R -F 'SENTINEL_OUTSIDE' "$TEST_TMP/archive-al" >/dev/null; then
  fail "case al: sentinel from outside the ledger was copied into the archive"
fi
OUTSIDE_AFTER=$(find "$OUTSIDE_AL" -printf '%p\n' | sort)
assert_eq "$OUTSIDE_AFTER" "$OUTSIDE_BEFORE" "case al: nothing appeared outside the archive root"
# No archive path is a symlink that leaves the root.
if find "$TEST_TMP/archive-al" -type l | grep -q .; then
  fail "case al: archive contains a symlink"
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (am) negative control: stat instead of lstat follows the symlinked phase.
MUT_AM="$TEST_TMP/mut-am/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AM")"
cp "$LIB" "$MUT_AM"
python3 - "$MUT_AM" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
if "fs.lstatSync" not in t:
    sys.stderr.write("case am: lstatSync missing\n")
    sys.exit(2)
p.write_text(t.replace("fs.lstatSync", "fs.statSync"))
PY
assert_exit_code "$?" "0" "case am: lstat replaced with stat on a temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$TEST_TMP/archive-am"
node -e '
  const fs = require("fs");
  const lib = require(process.argv[1]);
  const r = lib.copyLedger({
    ledgerDir: process.argv[2],
    repoDir: process.argv[3],
    importedFrom: fs.realpathSync(process.argv[2]),
  });
  if (r && r.skipped) {
    for (const name of r.skipped) console.error("review-ledger-archive: skipped " + name);
  }
  if (r && r.dest) console.log(r.dest);
' "$MUT_AM" "$LEDGER_AL" "$REPO" >"$TEST_TMP/am.out" 2>"$TEST_TMP/am.err"
AM_RC=$?
AM_HIT=0
if grep -R -F 'SENTINEL_OUTSIDE' "$TEST_TMP/archive-am" >/dev/null 2>&1; then AM_HIT=1; fi
if [ "$AM_RC" = 0 ] && [ "$AM_HIT" = 0 ] && grep -F 'review-ledger-archive: skipped review-evil' "$TEST_TMP/am.err" >/dev/null; then
  fail "case am: stat-based lib still skipped the symlink (negative control is blind)"
else
  echo "case am: red-on-broken (exit $AM_RC sentinel $AM_HIT)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# (an) the delay seam is ignored unless ALLOW is exactly the string 1.
# A temp copy that still sleeps on the delay alone must miss the fast bound.
LEDGER_AN="$TEST_TMP/ledger-an"
make_ledger "$LEDGER_AN" one "2026-10-22T00:00:00.000Z"
an_elapsed() {
  local lib="$1" mode="$2" dest="$3"
  mkdir -p "$dest"
  if [ "$mode" = unset ]; then
    env -u AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY \
      AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=3000 \
      AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$dest" \
      node -e 'const t=Date.now(); const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}); process.stdout.write(String(Date.now()-t));' \
      "$lib" "$LEDGER_AN" "$REPO"
  else
    AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY="$mode" \
      AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=3000 \
      AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$dest" \
      node -e 'const t=Date.now(); const lib=require(process.argv[1]); lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}); process.stdout.write(String(Date.now()-t));' \
      "$lib" "$LEDGER_AN" "$REPO"
  fi
}
AN_UNSET=$(an_elapsed "$LIB" unset "$TEST_TMP/archive-an-unset")
AN_TWO=$(an_elapsed "$LIB" 2 "$TEST_TMP/archive-an-two")
AN_TRUE=$(an_elapsed "$LIB" true "$TEST_TMP/archive-an-true")
if [ "$AN_UNSET" -ge 1500 ]; then
  fail "case an: delay honoured with ALLOW unset (${AN_UNSET} ms)"
else
  echo "case an: ALLOW unset finished in ${AN_UNSET} ms"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
if [ "$AN_TWO" -ge 1500 ]; then
  fail "case an: delay honoured with ALLOW=2 (${AN_TWO} ms)"
else
  echo "case an: ALLOW=2 finished in ${AN_TWO} ms"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
if [ "$AN_TRUE" -ge 1500 ]; then
  fail "case an: delay honoured with ALLOW=true (${AN_TRUE} ms)"
else
  echo "case an: ALLOW=true finished in ${AN_TRUE} ms"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
MUT_AN="$TEST_TMP/mut-an/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AN")"
cp "$LIB" "$MUT_AN"
python3 - "$MUT_AN" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "if (process.env.AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY !== '1') return 0;\n  "
if old not in t:
    sys.stderr.write("case an: ALLOW gate missing; file already reads the delay unconditionally\n")
    sys.exit(0)
p.write_text(t.replace(old, "", 1))
PY
assert_exit_code "$?" "0" "case an: ungated temp copy"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
AN_BROKEN=$(an_elapsed "$MUT_AN" unset "$TEST_TMP/archive-an-broken")
if [ "$AN_BROKEN" -lt 1500 ]; then
  fail "case an: lib that reads the delay without the ALLOW gate still finished in ${AN_BROKEN} ms (negative control is blind)"
else
  echo "case an: red-on-broken (${AN_BROKEN} ms)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY

# (ao) bucket is the main repository name, shared by a worktree.
AO_MAIN="$TEST_TMP/mainrepo"
AO_LANE="$TEST_TMP/lane-x"
mkdir -p "$AO_MAIN"
git -C "$AO_MAIN" init -q
git -C "$AO_MAIN" -c user.name='Ledger Test' -c user.email='ledger-test@example.com' commit --allow-empty -q -m init
git -C "$AO_MAIN" worktree add -q "$AO_LANE" HEAD
LEDGER_AO="$TEST_TMP/ledger-ao"
make_ledger "$LEDGER_AO" alpha "2026-04-05T01:02:03.000Z"
ARCH_AO="$TEST_TMP/archive-ao"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AO"
DEST_AO_MAIN=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_AO" "$AO_MAIN")
assert_exit_code "$?" "0" "case ao: copy from main checkout"
DEST_AO_LANE=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_AO" "$AO_LANE")
assert_exit_code "$?" "0" "case ao: copy from worktree"
AO_BUCKETS=$(find "$ARCH_AO" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\n' | sort)
AO_BUCKET_N=$(printf '%s\n' "$AO_BUCKETS" | grep -c . || true)
assert_eq "$AO_BUCKET_N" "1" "case ao: one bucket directory"
AO_BUCKET=$(printf '%s\n' "$AO_BUCKETS" | head -1)
case "$AO_BUCKET" in
  mainrepo-*) echo "case ao: bucket starts with mainrepo- ($AO_BUCKET)"; __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "case ao: bucket does not start with mainrepo- ($AO_BUCKET)" ;;
esac
case "$AO_BUCKET" in
  lane-*) fail "case ao: bucket starts with lane- ($AO_BUCKET)" ;;
  *) echo "case ao: bucket does not start with lane-"; __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
esac
assert_eq "$DEST_AO_LANE" "$DEST_AO_MAIN" "case ao: worktree reused the main ledger-id"
AO_IDS=$(find "$ARCH_AO" -mindepth 3 -maxdepth 3 -type d -printf '%f\n' | sort -u | grep -c . || true)
assert_eq "$AO_IDS" "1" "case ao: one ledger-id directory"

# (ap) bare repository: something.git -> something-<hash>
AP_BARE="$TEST_TMP/bare-parent/something.git"
mkdir -p "$(dirname "$AP_BARE")"
git init --bare -q "$AP_BARE"
LEDGER_AP="$TEST_TMP/ledger-ap"
make_ledger "$LEDGER_AP" alpha "2026-04-06T01:02:03.000Z"
ARCH_AP="$TEST_TMP/archive-ap"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AP"
DEST_AP=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$LIB" "$LEDGER_AP" "$AP_BARE")
assert_exit_code "$?" "0" "case ap: copy from bare repo"
AP_REL=${DEST_AP#"$ARCH_AP/"}
AP_BUCKET=$(printf '%s' "$AP_REL" | cut -d/ -f1)
case "$AP_BUCKET" in
  something-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
    echo "case ap: bucket is something-<hash> ($AP_BUCKET)"
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
    ;;
  *) fail "case ap: bucket is not something-<hash> ($AP_BUCKET)" ;;
esac

# (aq) negative control: basename(repoDir) naming fails case ao.
MUT_AQ="$TEST_TMP/mut-aq/review-ledger-copy.js"
mkdir -p "$(dirname "$MUT_AQ")"
cp "$LIB" "$MUT_AQ"
python3 - "$MUT_AQ" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = """function bucketNameFromIdentity(id, repoDir) {
  if (typeof id === 'string' && id.startsWith('git-common-dir:')) {
    const common = id.slice('git-common-dir:'.length);
    const base = path.basename(common);
    if (base === '.git') return path.basename(path.dirname(common));
    return base.endsWith('.git') ? base.slice(0, -4) : base;
  }
  return path.basename(path.resolve(repoDir));
}"""
new = """function bucketNameFromIdentity(id, repoDir) {
  return path.basename(path.resolve(repoDir));
}"""
if old not in t:
    sys.stderr.write("case aq: bucketNameFromIdentity missing; cannot force basename(repoDir)\n")
    sys.exit(0)
p.write_text(t.replace(old, new, 1))
PY
assert_exit_code "$?" "0" "case aq: basename(repoDir) temp copy"
if ! grep -q 'return path.basename(path.resolve(repoDir));' "$MUT_AQ"; then
  fail "case aq: mutant did not switch to basename(repoDir)"
fi
ARCH_AQ="$TEST_TMP/archive-aq"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AQ"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
DEST_AQ_MAIN=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$MUT_AQ" "$LEDGER_AO" "$AO_MAIN")
DEST_AQ_LANE=$(node -e 'const lib=require(process.argv[1]); process.stdout.write(lib.copyLedger({ledgerDir:process.argv[2],repoDir:process.argv[3]}).dest);' "$MUT_AQ" "$LEDGER_AO" "$AO_LANE")
AQ_BUCKETS=$(find "$ARCH_AQ" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\n' | sort)
AQ_BUCKET_N=$(printf '%s\n' "$AQ_BUCKETS" | grep -c . || true)
AQ_LANE=0
printf '%s\n' "$AQ_BUCKETS" | grep -q '^lane-' && AQ_LANE=1
if [ "$AQ_BUCKET_N" -ge 2 ] || [ "$AQ_LANE" = 1 ]; then
  echo "case aq: red-on-broken (buckets=$AQ_BUCKET_N lane_prefix=$AQ_LANE)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "case aq: basename(repoDir) lib still produced one non-lane bucket ($AQ_BUCKETS) (negative control is blind)"
fi
if [ "$DEST_AQ_MAIN" = "$DEST_AQ_LANE" ] && [ "$AQ_BUCKET_N" = 1 ] && [ "$AQ_LANE" = 0 ]; then
  fail "case aq: broken lib reused one ledger-id in one mainrepo bucket"
fi
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

# (ar) rotate. Fixtures come from import (layout A), then the month directory
# is renamed. Clock is 2026-10-22, so 2026-07 is strictly older than 2 months
# and 2026-09 is not. Default keeps the source directory.
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW=1
export AUTOPILOT_TEST_NOW=2026-10-22
LEDGER_AR="$TEST_TMP/ledger-ar"
make_ledger "$LEDGER_AR" alpha "2026-10-22T03:04:05.000Z"
ARCH_AR="$TEST_TMP/archive-ar"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AR"
node "$CLI" import --ledger "$LEDGER_AR" --repo "$REPO" >/dev/null
AR_MONTH=$(find "$ARCH_AR" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
test -n "$AR_MONTH"
AR_BUCKET=$(basename "$(dirname "$AR_MONTH")")
cp -a "$AR_MONTH" "$(dirname "$AR_MONTH")/2026-07"
cp -a "$AR_MONTH" "$(dirname "$AR_MONTH")/2026-09"
AR_SRC_N=$(find "$(dirname "$AR_MONTH")/2026-07" -type f | wc -l | tr -d ' ')
AR_OUT=$(node "$CLI" rotate 2>"$TEST_TMP/ar.err")
assert_exit_code "$?" "0" "case ar: rotate exits 0"
assert_contains "$AR_OUT" "rotated ${AR_BUCKET}/2026-07" "case ar: stdout names the rotated month"
assert_contains "$AR_OUT" "summary:" "case ar: stdout has a summary line"
test -d "$(dirname "$AR_MONTH")/2026-07"
assert_exit_code "$?" "0" "case ar: source month kept by default"
test -f "$(dirname "$AR_MONTH")/2026-07.tar.gz"
assert_exit_code "$?" "0" "case ar: 2026-07.tar.gz exists"
test ! -e "$(dirname "$AR_MONTH")/2026-09.tar.gz"
assert_exit_code "$?" "0" "case ar: 2026-09 is inside the window"
test ! -e "$(dirname "$AR_MONTH")/2026-10.tar.gz"
assert_exit_code "$?" "0" "case ar: current month is not compressed"
test -d "$(dirname "$AR_MONTH")/2026-09"
assert_exit_code "$?" "0" "case ar: 2026-09 directory remains"
test -d "$(dirname "$AR_MONTH")/2026-10"
assert_exit_code "$?" "0" "case ar: current month directory remains"
AR_TAR_N=$(tar -tzf "$(dirname "$AR_MONTH")/2026-07.tar.gz" | grep -c -v '/$' || true)
assert_eq "$AR_TAR_N" "$AR_SRC_N" "case ar: tar regular-file count matches the source"
AR_TMP_N=$(find "$ARCH_AR" -name '*.tar.gz.tmp-*' | wc -l | tr -d ' ')
assert_eq "$AR_TMP_N" "0" "case ar: no temporary tar left"

# (as) second rotate is a skip: same bytes, same mtime, output says skipped.
AR_SUM1=$(sha256sum "$(dirname "$AR_MONTH")/2026-07.tar.gz" | awk '{print $1}')
AR_MT1=$(stat -c %Y "$(dirname "$AR_MONTH")/2026-07.tar.gz")
AR_OUT2=$(node "$CLI" rotate 2>"$TEST_TMP/as.err")
assert_exit_code "$?" "0" "case as: second rotate exits 0"
assert_contains "$AR_OUT2" "skipped ${AR_BUCKET}/2026-07" "case as: second run says skipped"
AR_SUM2=$(sha256sum "$(dirname "$AR_MONTH")/2026-07.tar.gz" | awk '{print $1}')
AR_MT2=$(stat -c %Y "$(dirname "$AR_MONTH")/2026-07.tar.gz")
assert_eq "$AR_SUM2" "$AR_SUM1" "case as: tar checksum unchanged"
assert_eq "$AR_MT2" "$AR_MT1" "case as: tar mtime unchanged"
test -d "$(dirname "$AR_MONTH")/2026-07"
assert_exit_code "$?" "0" "case as: source still present"

# (at) rotate_remove_source true deletes the month only after a matched listing.
LEDGER_AT="$TEST_TMP/ledger-at"
make_ledger "$LEDGER_AT" alpha "2026-10-22T03:04:05.000Z"
ARCH_AT="$TEST_TMP/archive-at"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AT"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE=true
node "$CLI" import --ledger "$LEDGER_AT" --repo "$REPO" >/dev/null
AT_MONTH=$(find "$ARCH_AT" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
cp -a "$AT_MONTH" "$(dirname "$AT_MONTH")/2026-07"
node "$CLI" rotate >/dev/null
assert_exit_code "$?" "0" "case at: rotate with remove exits 0"
test ! -d "$(dirname "$AT_MONTH")/2026-07"
assert_exit_code "$?" "0" "case at: source month removed"
test -f "$(dirname "$AT_MONTH")/2026-07.tar.gz"
assert_exit_code "$?" "0" "case at: tar remains after removal"
test -d "$(dirname "$AT_MONTH")/2026-10"
assert_exit_code "$?" "0" "case at: current month kept"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE

# (au) no tar on PATH: rc 0, one warning, no archive, source intact. node is a symlink.
LEDGER_AU="$TEST_TMP/ledger-au"
make_ledger "$LEDGER_AU" alpha "2026-10-22T03:04:05.000Z"
ARCH_AU="$TEST_TMP/archive-au"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AU"
node "$CLI" import --ledger "$LEDGER_AU" --repo "$REPO" >/dev/null
AU_MONTH=$(find "$ARCH_AU" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
cp -a "$AU_MONTH" "$(dirname "$AU_MONTH")/2026-07"
AU_PATH="$TEST_TMP/path-au"
mkdir -p "$AU_PATH"
ln -s "$(command -v node)" "$AU_PATH/node"
PATH="$AU_PATH" node "$CLI" rotate >"$TEST_TMP/au.out" 2>"$TEST_TMP/au.err"
assert_exit_code "$?" "0" "case au: missing tar exits 0"
AU_WARN=$(grep -c . "$TEST_TMP/au.err" || true)
assert_eq "$AU_WARN" "1" "case au: one warning line"
grep -q 'tar' "$TEST_TMP/au.err"
assert_exit_code "$?" "0" "case au: warning mentions tar"
test ! -e "$(dirname "$AU_MONTH")/2026-07.tar.gz"
assert_exit_code "$?" "0" "case au: no tar.gz"
test -d "$(dirname "$AU_MONTH")/2026-07"
assert_exit_code "$?" "0" "case au: source intact"

# (av) listing returns one fewer regular file: source kept, no tar.gz, no tmp, rc 0.
LEDGER_AV="$TEST_TMP/ledger-av"
make_ledger "$LEDGER_AV" alpha "2026-10-22T03:04:05.000Z"
ARCH_AV="$TEST_TMP/archive-av"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AV"
node "$CLI" import --ledger "$LEDGER_AV" --repo "$REPO" >/dev/null
AV_MONTH=$(find "$ARCH_AV" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
cp -a "$AV_MONTH" "$(dirname "$AV_MONTH")/2026-07"
AV_PATH="$TEST_TMP/path-av"
mkdir -p "$AV_PATH"
ln -s "$(command -v node)" "$AV_PATH/node"
cat > "$AV_PATH/tar" <<'EOF'
#!/bin/bash
real=/usr/bin/tar
if [ "$1" = "-tzf" ]; then
  "$real" "$@" | awk '{ if ($0 ~ /\/$/) print; else if (n++) print }'
  exit 0
fi
exec "$real" "$@"
EOF
chmod +x "$AV_PATH/tar"
PATH="$AV_PATH:$PATH" node "$CLI" rotate >"$TEST_TMP/av.out" 2>"$TEST_TMP/av.err"
assert_exit_code "$?" "0" "case av: count mismatch exits 0"
test -d "$(dirname "$AV_MONTH")/2026-07"
assert_exit_code "$?" "0" "case av: source kept"
test ! -e "$(dirname "$AV_MONTH")/2026-07.tar.gz"
assert_exit_code "$?" "0" "case av: no tar.gz left"
AV_TMP=$(find "$ARCH_AV" -name '*.tar.gz.tmp-*' | wc -l | tr -d ' ')
assert_eq "$AV_TMP" "0" "case av: no temporary tar left"
grep -q . "$TEST_TMP/av.err"
assert_exit_code "$?" "0" "case av: warning printed"

# (aw) negative control: without the count comparison the shim case keeps a tar.gz.
# RED with the comparison removed (if (false && listed !== sourceCount)): the
# mismatch shim still exits 0 and leaves <bucket>/2026-07.tar.gz, so case av's
# "no tar.gz left" assertion fails. Restoring the comparison deletes the temp
# tar and keeps the source. Suite line: case aw: red-on-broken (tar kept without the count check).
TAR_LIB="$REPO_ROOT/scripts/lib/review-ledger-tar.js"
MUT_AW="$TEST_TMP/mut-aw"
mkdir -p "$MUT_AW/scripts/lib" "$MUT_AW/bin"
cp "$CLI" "$MUT_AW/scripts/review-ledger-archive.js"
cp "$LIB" "$MUT_AW/scripts/lib/review-ledger-copy.js"
cp "$TAR_LIB" "$MUT_AW/scripts/lib/review-ledger-tar.js"
python3 - "$MUT_AW/scripts/lib/review-ledger-tar.js" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "if (listed !== sourceCount)"
new = "if (false && listed !== sourceCount)"
if old not in t:
    sys.stderr.write("case aw: count comparison missing\\n")
    sys.exit(2)
p.write_text(t.replace(old, new, 1))
PY
assert_exit_code "$?" "0" "case aw: mutant applied"
ln -s "$(command -v node)" "$MUT_AW/bin/node"
cp "$AV_PATH/tar" "$MUT_AW/bin/tar"
chmod +x "$MUT_AW/bin/tar"
ARCH_AW="$TEST_TMP/archive-aw"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AW"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
node "$CLI" import --ledger "$LEDGER_AV" --repo "$REPO" >/dev/null
AW_MONTH=$(find "$ARCH_AW" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
cp -a "$AW_MONTH" "$(dirname "$AW_MONTH")/2026-07"
PATH="$MUT_AW/bin:$PATH" node "$MUT_AW/scripts/review-ledger-archive.js" rotate >"$TEST_TMP/aw.out" 2>"$TEST_TMP/aw.err"
AW_RC=$?
if [ "$AW_RC" = 0 ] && [ -f "$(dirname "$AW_MONTH")/2026-07.tar.gz" ]; then
  echo "case aw: red-on-broken (tar kept without the count check)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "case aw: broken lib did not keep a tar.gz (negative control is blind) rc=$AW_RC"
fi

# (ax) rotate_after_months from the config file, then the env override.
LEDGER_AX="$TEST_TMP/ledger-ax"
make_ledger "$LEDGER_AX" alpha "2026-10-22T03:04:05.000Z"
ARCH_AX="$TEST_TMP/archive-ax"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AX"
node "$CLI" import --ledger "$LEDGER_AX" --repo "$REPO" >/dev/null
AX_MONTH=$(find "$ARCH_AX" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
AX_PARENT=$(dirname "$AX_MONTH")
cp -a "$AX_MONTH" "$AX_PARENT/2026-06"
cp -a "$AX_MONTH" "$AX_PARENT/2026-07"
mkdir -p "$HOME/.autopilot"
python3 - "$HOME/.autopilot/config.json" <<'PY'
import json, sys
p = sys.argv[1]
try:
    cfg = json.load(open(p))
except FileNotFoundError:
    cfg = {}
block = cfg.get("review_ledger_archive") or {}
block["rotate_after_months"] = 3
cfg["review_ledger_archive"] = block
json.dump(cfg, open(p, "w"))
PY
node "$CLI" rotate >/dev/null
assert_exit_code "$?" "0" "case ax: config rotate exits 0"
test -f "$AX_PARENT/2026-06.tar.gz"
assert_exit_code "$?" "0" "case ax: 2026-06 rotated when N is 3"
test ! -e "$AX_PARENT/2026-07.tar.gz"
assert_exit_code "$?" "0" "case ax: 2026-07 is not older than 3 months"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS=2
node "$CLI" rotate >/dev/null
assert_exit_code "$?" "0" "case ax: env override rotate exits 0"
test -f "$AX_PARENT/2026-07.tar.gz"
assert_exit_code "$?" "0" "case ax: env N=2 rotates 2026-07"
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS
python3 - "$HOME/.autopilot/config.json" <<'PY'
import json, sys
p = sys.argv[1]
cfg = json.load(open(p))
block = cfg.get("review_ledger_archive") or {}
block.pop("rotate_after_months", None)
cfg["review_ledger_archive"] = block
json.dump(cfg, open(p, "w"))
PY

# (ay) status prints the rotatable count and the hint, and exits 0.
LEDGER_AY="$TEST_TMP/ledger-ay"
make_ledger "$LEDGER_AY" alpha "2026-10-22T03:04:05.000Z"
ARCH_AY="$TEST_TMP/archive-ay"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_AY"
node "$CLI" import --ledger "$LEDGER_AY" --repo "$REPO" >/dev/null
AY_MONTH=$(find "$ARCH_AY" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
cp -a "$AY_MONTH" "$(dirname "$AY_MONTH")/2026-07"
AY_OUT=$(node "$CLI" status 2>"$TEST_TMP/ay.err")
assert_exit_code "$?" "0" "case ay: status exits 0"
assert_contains "$AY_OUT" "rotatable months: 1" "case ay: rotatable count"
assert_contains "$AY_OUT" "run: review-ledger-archive.js rotate" "case ay: rotate hint"
node "$CLI" rotate >/dev/null
AY_OUT2=$(node "$CLI" status)
assert_exit_code "$?" "0" "case ay: status after rotate exits 0"
assert_contains "$AY_OUT2" "rotatable months: 0" "case ay: count is zero after rotate"
case "$AY_OUT2" in
  *"run: review-ledger-archive.js rotate"*) fail "case ay: hint printed when count is zero" ;;
  *) echo "case ay: no hint when nothing is rotatable"; __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
esac

# (az) no hook and no finalize path invokes this CLI's rotate.
AZ_HITS=$(grep -R -n --exclude-dir=tests -E 'review-ledger-archive\.js[[:space:]]+rotate|review-ledger-tar' \
  "$REPO_ROOT/hooks" "$REPO_ROOT/scripts/hetero-review-loop.js" 2>/dev/null || true)
assert_eq "$AZ_HITS" "" "case az: hooks and finalize do not reference rotate"
unset AUTOPILOT_REVIEW_LEDGER_REPO_ROOT

# (ba) archive off: rotate exits 1 with the off line.
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
BA_OUT=$(node "$CLI" rotate 2>&1); BA_RC=$?
assert_exit_code "$BA_RC" "1" "case ba: rotate with archive off exits 1"
assert_contains "$BA_OUT" "review-ledger-archive: archive is off" "case ba: off line"

unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW
unset AUTOPILOT_TEST_NOW
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE

# (bb) prune dry-run lists the old month directory and the old tar, and deletes nothing.
# (bc) the same invocation has no --execute, so the files are still there afterwards.
LEDGER_BB="$TEST_TMP/ledger-bb"
make_ledger "$LEDGER_BB" alpha "2026-10-22T03:04:05.000Z"
ARCH_BB="$TEST_TMP/archive-bb"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BB"
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW=1
export AUTOPILOT_TEST_NOW=2026-10-22
node "$CLI" import --ledger "$LEDGER_BB" --repo "$REPO" >/dev/null
BB_MONTH=$(find "$ARCH_BB" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
BB_BUCKET=$(dirname "$BB_MONTH")
cp -a "$BB_MONTH" "$BB_BUCKET/2026-09"
cp -a "$BB_MONTH" "$BB_BUCKET/2026-07"
cp -a "$BB_MONTH" "$BB_BUCKET/2026-06"
tar -czf "$BB_BUCKET/2026-06.tar.gz" -C "$BB_BUCKET" 2026-06
BB_OUT=$(node "$CLI" prune --older-than 2m 2>"$TEST_TMP/bb.err")
assert_exit_code "$?" "0" "case bb: dry-run prune exits 0"
printf '%s\n' "$BB_OUT" | grep -F -x "$BB_BUCKET/2026-07" >/dev/null
assert_exit_code "$?" "0" "case bb: dry-run lists the old month dir"
printf '%s\n' "$BB_OUT" | grep -F -x "$BB_BUCKET/2026-06.tar.gz" >/dev/null
assert_exit_code "$?" "0" "case bb: dry-run lists the old tar"
printf '%s\n' "$BB_OUT" | grep -F -x "$BB_BUCKET/2026-06" >/dev/null
assert_exit_code "$?" "0" "case bb: dry-run lists the 2026-06 month dir"
case "$BB_OUT" in
  *"$BB_BUCKET/2026-09"*) fail "case bb: dry-run listed a month that is not older than 2" ;;
  *"$BB_BUCKET/2026-10"*) fail "case bb: dry-run listed the current month" ;;
  *) echo "case bb: newer months omitted"; __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
esac
test -d "$BB_BUCKET/2026-07"
assert_exit_code "$?" "0" "case bc: month dir remains without --execute"
test -f "$BB_BUCKET/2026-06.tar.gz"
assert_exit_code "$?" "0" "case bc: tar remains without --execute"
test -d "$BB_BUCKET/2026-06"
assert_exit_code "$?" "0" "case bc: 2026-06 dir remains without --execute"
test -d "$BB_BUCKET/2026-09"
assert_exit_code "$?" "0" "case bc: newer month remains without --execute"

# (bd) --execute deletes only the old targets.
node "$CLI" prune --older-than 2m --execute >"$TEST_TMP/bd.out" 2>"$TEST_TMP/bd.err"
assert_exit_code "$?" "0" "case bd: execute exits 0"
test ! -d "$BB_BUCKET/2026-07"
assert_exit_code "$?" "0" "case bd: old month dir deleted"
test ! -d "$BB_BUCKET/2026-06"
assert_exit_code "$?" "0" "case bd: old month dir 2026-06 deleted"
test ! -e "$BB_BUCKET/2026-06.tar.gz"
assert_exit_code "$?" "0" "case bd: old tar deleted"
test -d "$BB_BUCKET/2026-09"
assert_exit_code "$?" "0" "case bd: 2026-09 kept"
test -d "$BB_BUCKET/2026-10"
assert_exit_code "$?" "0" "case bd: current month kept"

# (be) --execute with a sibling of the archive root: refuse, delete nothing.
LEDGER_BE="$TEST_TMP/ledger-be"
make_ledger "$LEDGER_BE" alpha "2026-10-22T03:04:05.000Z"
ARCH_BE="$TEST_TMP/archive-be"
SIB_BE="${ARCH_BE}-evil"
mkdir -p "$SIB_BE"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BE"
node "$CLI" import --ledger "$LEDGER_BE" --repo "$REPO" >/dev/null
BE_MONTH=$(find "$ARCH_BE" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
BE_BUCKET=$(dirname "$BE_MONTH")
cp -a "$BE_MONTH" "$BE_BUCKET/2026-07"
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_PRUNE_TARGET=1
node "$CLI" prune --older-than 2m --execute --target "$SIB_BE" >"$TEST_TMP/be.out" 2>"$TEST_TMP/be.err"
assert_exit_code "$?" "1" "case be: sibling target exits 1"
grep -F 'refused' "$TEST_TMP/be.err" >/dev/null
assert_exit_code "$?" "0" "case be: stderr is a refusal"
test -d "$BE_BUCKET/2026-07"
assert_exit_code "$?" "0" "case be: nothing deleted inside the archive"
test -d "$SIB_BE"
assert_exit_code "$?" "0" "case be: sibling survives"

# (bf) target == archive root: refuse, delete nothing.
node "$CLI" prune --older-than 2m --execute --target "$ARCH_BE" >"$TEST_TMP/bf.out" 2>"$TEST_TMP/bf.err"
assert_exit_code "$?" "1" "case bf: archive root target exits 1"
grep -F 'refused' "$TEST_TMP/bf.err" >/dev/null
assert_exit_code "$?" "0" "case bf: stderr is a refusal"
test -d "$BE_BUCKET/2026-07"
assert_exit_code "$?" "0" "case bf: old month still present"
test -d "$ARCH_BE"
assert_exit_code "$?" "0" "case bf: archive root survives"

# (bg) a symlink inside the archive pointing outside is refused; the outside dir survives.
OUT_BG="$TEST_TMP/outside-bg"
mkdir -p "$OUT_BG/keep"
printf '%s\n' 'OUTSIDE_SURVIVES' > "$OUT_BG/keep/file"
ln -s "$OUT_BG" "$ARCH_BE/link-out"
node "$CLI" prune --older-than 2m --execute --target "$ARCH_BE/link-out" >"$TEST_TMP/bg.out" 2>"$TEST_TMP/bg.err"
assert_exit_code "$?" "1" "case bg: symlink target exits 1"
grep -F 'refused' "$TEST_TMP/bg.err" >/dev/null
assert_exit_code "$?" "0" "case bg: stderr is a refusal"
test -d "$BE_BUCKET/2026-07"
assert_exit_code "$?" "0" "case bg: old month still present"
test -d "$OUT_BG/keep"
assert_exit_code "$?" "0" "case bg: outside directory survives"
grep -F 'OUTSIDE_SURVIVES' "$OUT_BG/keep/file" >/dev/null
assert_exit_code "$?" "0" "case bg: outside file bytes survive"
test -L "$ARCH_BE/link-out"
assert_exit_code "$?" "0" "case bg: symlink itself was not removed"
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_PRUNE_TARGET

# (bh) negative control: drop the realpath prefix check. Sibling, root, and
# symlink refusals go red (exit 0, and the sibling is removed). Restoring the
# check is the production file; be/bf/bg above stay green.
# RED with pruneTargetAllowed reduced to "return true" (prefix check gone):
#   case bh: red-on-broken (sibling rc=0 root rc=0 symlink rc=0)
# The three refusal cases exit 0 instead of 1. rm of a symlink unlinks the
# link; the outside directory is still on disk.
MUT_BH="$TEST_TMP/mut-bh"
mkdir -p "$MUT_BH/scripts/lib"
cp "$CLI" "$MUT_BH/scripts/review-ledger-archive.js"
cp "$LIB" "$MUT_BH/scripts/lib/review-ledger-copy.js"
cp "$REPO_ROOT/scripts/lib/review-ledger-tar.js" "$MUT_BH/scripts/lib/review-ledger-tar.js"
python3 - "$MUT_BH/scripts/lib/review-ledger-tar.js" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "function pruneTargetAllowed(archiveDir, targetPath) {\n  return pruneTargetAllowedChecked(archiveDir, targetPath);\n}"
new = "function pruneTargetAllowed(archiveDir, targetPath) {\n  return true;\n}"
if old not in t:
    sys.stderr.write("case bh: pruneTargetAllowed wrapper missing\n")
    sys.exit(2)
p.write_text(t.replace(old, new, 1))
PY
assert_exit_code "$?" "0" "case bh: mutant applied"
export AUTOPILOT_REVIEW_LEDGER_REPO_ROOT="$REPO_ROOT"
ARCH_BH="$TEST_TMP/archive-bh"
SIB_BH="${ARCH_BH}-evil"
mkdir -p "$SIB_BH" "$ARCH_BH"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BH"
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_PRUNE_TARGET=1
node "$CLI" import --ledger "$LEDGER_BE" --repo "$REPO" >/dev/null
BH_MONTH=$(find "$ARCH_BH" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
cp -a "$BH_MONTH" "$(dirname "$BH_MONTH")/2026-07"
OUT_BH="$TEST_TMP/outside-bh"
mkdir -p "$OUT_BH"
ln -s "$OUT_BH" "$ARCH_BH/link-out"
node "$MUT_BH/scripts/review-ledger-archive.js" prune --older-than 2m --execute --target "$SIB_BH" >"$TEST_TMP/bh-sib.out" 2>"$TEST_TMP/bh-sib.err"
BH_SIB_RC=$?
# Rebuild a fresh archive for the root target. The sibling mutant may have
# deleted the old month because the check no longer refuses.
ARCH_BH_ROOT="$TEST_TMP/archive-bh-root"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BH_ROOT"
node "$CLI" import --ledger "$LEDGER_BE" --repo "$REPO" >/dev/null
node "$MUT_BH/scripts/review-ledger-archive.js" prune --older-than 2m --execute --target "$ARCH_BH_ROOT" >"$TEST_TMP/bh-root.out" 2>"$TEST_TMP/bh-root.err"
BH_ROOT_RC=$?
ARCH_BH_LINK="$TEST_TMP/archive-bh-link"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BH_LINK"
node "$CLI" import --ledger "$LEDGER_BE" --repo "$REPO" >/dev/null
ln -s "$OUT_BH" "$ARCH_BH_LINK/link-out"
node "$MUT_BH/scripts/review-ledger-archive.js" prune --older-than 2m --execute --target "$ARCH_BH_LINK/link-out" >"$TEST_TMP/bh-link.out" 2>"$TEST_TMP/bh-link.err"
BH_LINK_RC=$?
if [ "$BH_SIB_RC" = 1 ] && [ "$BH_ROOT_RC" = 1 ] && [ "$BH_LINK_RC" = 1 ]; then
  fail "case bh: broken prefix check still refused (negative control is blind) sib=$BH_SIB_RC root=$BH_ROOT_RC link=$BH_LINK_RC"
else
  echo "case bh: red-on-broken (sibling rc=$BH_SIB_RC root rc=$BH_ROOT_RC symlink rc=$BH_LINK_RC)"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
test -d "$OUT_BH"
assert_exit_code "$?" "0" "case bh: outside dir still exists after the mutant"
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_PRUNE_TARGET

# (bi) --older-than missing or malformed is usage, exit 2.
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BB"
BI_OUT=$(node "$CLI" prune 2>&1); BI_RC=$?
assert_exit_code "$BI_RC" "2" "case bi: prune with no --older-than exits 2"
BI_BAD=$(node "$CLI" prune --older-than 2 2>&1); BI_BAD_RC=$?
assert_exit_code "$BI_BAD_RC" "2" "case bi: --older-than without m exits 2"
BI_ZERO=$(node "$CLI" prune --older-than 0m 2>&1); BI_ZERO_RC=$?
assert_exit_code "$BI_ZERO_RC" "2" "case bi: --older-than 0m exits 2"

# (bj) status --phase is a usage error.
BJ_OUT=$(node "$CLI" status --phase x 2>&1); BJ_RC=$?
assert_exit_code "$BJ_RC" "2" "case bj: status --phase x exits 2"

# (bk) an explicit symlink phase is skipped, and readChain does not merge it.
LEDGER_BK="$TEST_TMP/ledger-bk"
OUTSIDE_BK="$TEST_TMP/outside-bk"
make_ledger "$LEDGER_BK" good "2026-10-22T03:04:05.000Z"
mkdir -p "$OUTSIDE_BK/g1"
printf '%s\n' '[{"generation":1,"base":"OUTSIDE_BK","head":"zzz","status":"pending","collected_at":"2026-10-22T03:04:05.000Z"}]' > "$OUTSIDE_BK/chain.json"
printf '%s\n' '{"base":"OUTSIDE_BK","head":"zzz"}' > "$OUTSIDE_BK/g1/range.json"
ln -s "$OUTSIDE_BK" "$LEDGER_BK/review-evil"
ARCH_BK="$TEST_TMP/archive-bk"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BK"
node "$CLI" import --ledger "$LEDGER_BK" --repo "$REPO" --phase good --phase evil >"$TEST_TMP/bk.out" 2>"$TEST_TMP/bk.err"
assert_exit_code "$?" "0" "case bk: explicit symlink phase import exits 0"
grep -F 'review-ledger-archive: skipped review-evil' "$TEST_TMP/bk.err" >/dev/null
assert_exit_code "$?" "0" "case bk: stderr names the symlinked phase"
DEST_BK=$(cat "$TEST_TMP/bk.out")
assert_file_exists "$DEST_BK/review-good/chain.json" "case bk: named real phase copied"
assert_file_absent "$DEST_BK/review-evil" "case bk: symlink phase not copied"
if grep -R -F 'OUTSIDE_BK' "$ARCH_BK" >/dev/null; then
  fail "case bk: symlink phase was read and merged"
else
  echo "case bk: no read and no merge of the symlink phase"; __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
test -d "$OUTSIDE_BK"
assert_exit_code "$?" "0" "case bk: outside directory survives"

# (bl) no hook and no finalize path invokes prune.
BL_HITS=$(grep -R -n --exclude-dir=tests -E 'review-ledger-archive\.js[[:space:]]+prune|pruneArchive\(' \
  "$REPO_ROOT/hooks" "$REPO_ROOT/scripts/hetero-review-loop.js" 2>/dev/null || true)
assert_eq "$BL_HITS" "" "case bl: hooks and finalize do not reference prune"

unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW
unset AUTOPILOT_TEST_NOW
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_PRUNE_TARGET

# (bm) rotate waits on every per-ledger lock in the month. A copy adds
# review-beta to an old month (the ledger keeps the month of its first collect)
# while that lock is held. The tar contains the new phase file.
# RED at 71eb5b4ffb1bd6d1c5522e920efc59b66cdbb464: case bm: red-on-broken (tar missing review-beta) when rotate
# does not acquire <ledgerId>.lock; with the locks, the same race includes it.
LEDGER_BM="$TEST_TMP/ledger-bm"
make_ledger "$LEDGER_BM" alpha "2026-10-22T03:04:05.000Z"
ARCH_BM="$TEST_TMP/archive-bm"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BM"
export AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW=1
export AUTOPILOT_TEST_NOW=2026-10-22
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE=true
node "$CLI" import --ledger "$LEDGER_BM" --repo "$REPO" >/dev/null
BM_MONTH=$(find "$ARCH_BM" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
test -n "$BM_MONTH"
BM_BUCKET=$(dirname "$BM_MONTH")
mv "$BM_MONTH" "$BM_BUCKET/2026-07"
make_ledger "$LEDGER_BM" beta "2026-10-22T04:05:06.000Z"
BM_COPY_DONE="$TEST_TMP/bm-copy.done"
rm -f "$BM_COPY_DONE"
AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1 \
  AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=1500 \
  node -e '
    const fs = require("fs");
    const lib = require(process.argv[1]);
    lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3], phases: ["alpha", "beta"] });
    fs.writeFileSync(process.argv[4], "done");
  ' "$LIB" "$LEDGER_BM" "$REPO" "$BM_COPY_DONE" &
BM_COPY_PID=$!
BM_LOCK=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
  BM_LOCK=$(find "$BM_BUCKET/2026-07" -mindepth 1 -maxdepth 1 -type d -name '*.lock' ! -name '.ledger-id.lock' 2>/dev/null | head -1 || true)
  if [ -n "$BM_LOCK" ]; then break; fi
  sleep 0.05
done
if [ -z "$BM_LOCK" ]; then
  wait "$BM_COPY_PID" || true
  fail "case bm: copy did not take the per-ledger lock"
else
  if [ -e "$BM_BUCKET/2026-07"/*/review-beta ]; then
    wait "$BM_COPY_PID" || true
    fail "case bm: review-beta existed before rotate started (race window missed)"
  fi
  node "$CLI" rotate >"$TEST_TMP/bm.out" 2>"$TEST_TMP/bm.err"
  BM_ROT_RC=$?
  wait "$BM_COPY_PID"
  BM_COPY_RC=$?
  assert_exit_code "$BM_ROT_RC" "0" "case bm: rotate exits 0"
  assert_exit_code "$BM_COPY_RC" "0" "case bm: delayed copy exits 0"
  test -f "$BM_BUCKET/2026-07.tar.gz"
  assert_exit_code "$?" "0" "case bm: old month tar exists"
  tar -tzf "$BM_BUCKET/2026-07.tar.gz" | grep -F 'review-beta/g1/findings.json' >/dev/null
  assert_exit_code "$?" "0" "case bm: tar contains the phase the copy wrote"
fi
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY

# Negative control: rotate that skips per-ledger locks tars during the delay,
# before review-beta exists, then removes the month. The phase is not in the tar.
TAR_LIB="$REPO_ROOT/scripts/lib/review-ledger-tar.js"
MUT_BM="$TEST_TMP/mut-bm"
mkdir -p "$MUT_BM/scripts/lib"
cp "$CLI" "$MUT_BM/scripts/review-ledger-archive.js"
cp "$LIB" "$MUT_BM/scripts/lib/review-ledger-copy.js"
cp "$TAR_LIB" "$MUT_BM/scripts/lib/review-ledger-tar.js"
python3 - "$MUT_BM/scripts/lib/review-ledger-tar.js" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "function withLedgerLocks(lockDirs, fn) {\n  const sorted = lockDirs.slice().sort();"
new = "function withLedgerLocks(lockDirs, fn) {\n  return fn();\n  const sorted = lockDirs.slice().sort();"
if old not in t:
    sys.stderr.write("case bm: withLedgerLocks missing\n")
    sys.exit(2)
p.write_text(t.replace(old, new, 1))
PY
assert_exit_code "$?" "0" "case bm: lock-skip mutant applied"
LEDGER_BM2="$TEST_TMP/ledger-bm-neg"
make_ledger "$LEDGER_BM2" alpha "2026-10-22T03:04:05.000Z"
ARCH_BM2="$TEST_TMP/archive-bm-neg"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BM2"
node "$CLI" import --ledger "$LEDGER_BM2" --repo "$REPO" >/dev/null
BM2_MONTH=$(find "$ARCH_BM2" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
BM2_BUCKET=$(dirname "$BM2_MONTH")
mv "$BM2_MONTH" "$BM2_BUCKET/2026-07"
make_ledger "$LEDGER_BM2" beta "2026-10-22T04:05:06.000Z"
BM2_DONE="$TEST_TMP/bm2-copy.done"
rm -f "$BM2_DONE"
AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY=1 \
  AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS=1500 \
  node -e '
    const fs = require("fs");
    const lib = require(process.argv[1]);
    lib.copyLedger({ ledgerDir: process.argv[2], repoDir: process.argv[3], phases: ["alpha", "beta"] });
    fs.writeFileSync(process.argv[4], "done");
  ' "$LIB" "$LEDGER_BM2" "$REPO" "$BM2_DONE" &
BM2_PID=$!
BM2_LOCK=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
  BM2_LOCK=$(find "$BM2_BUCKET/2026-07" -mindepth 1 -maxdepth 1 -type d -name '*.lock' ! -name '.ledger-id.lock' 2>/dev/null | head -1 || true)
  if [ -n "$BM2_LOCK" ]; then break; fi
  sleep 0.05
done
if [ -z "$BM2_LOCK" ]; then
  wait "$BM2_PID" || true
  fail "case bm: negative control copy did not take the per-ledger lock"
else
  node "$MUT_BM/scripts/review-ledger-archive.js" rotate >"$TEST_TMP/bm-neg.out" 2>"$TEST_TMP/bm-neg.err"
  BM2_ROT_RC=$?
  wait "$BM2_PID" || true
  BM2_HIT=0
  if [ -f "$BM2_BUCKET/2026-07.tar.gz" ] && tar -tzf "$BM2_BUCKET/2026-07.tar.gz" | grep -F 'review-beta/g1/findings.json' >/dev/null; then
    BM2_HIT=1
  fi
  if [ "$BM2_ROT_RC" = 0 ] && [ "$BM2_HIT" = 1 ]; then
    fail "case bm: rotate without per-ledger locks still archived review-beta (negative control is blind)"
  else
    echo "case bm: red-on-broken (tar missing review-beta, rotate rc=$BM2_ROT_RC)"
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
fi
unset AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS
unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE

# (bn) a leftover <month>.tar.gz.tmp-* is removed. A *.lock directory is not in
# the tar and does not break the list-back count.
LEDGER_BN="$TEST_TMP/ledger-bn"
make_ledger "$LEDGER_BN" alpha "2026-10-22T03:04:05.000Z"
ARCH_BN="$TEST_TMP/archive-bn"
export AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR="$ARCH_BN"
node "$CLI" import --ledger "$LEDGER_BN" --repo "$REPO" >/dev/null
BN_MONTH=$(find "$ARCH_BN" -mindepth 2 -maxdepth 2 -type d -name '2026-10' | head -1)
BN_BUCKET=$(dirname "$BN_MONTH")
mv "$BN_MONTH" "$BN_BUCKET/2026-07"
BN_LEDGER=$(find "$BN_BUCKET/2026-07" -mindepth 1 -maxdepth 1 -type d ! -name '*.lock' | head -1)
mkdir -p "$BN_LEDGER.lock"
printf '%s\n' 'lock-body' > "$BN_LEDGER.lock/owner"
# Stale so rotate can take the lock instead of waiting out a live holder.
touch -d '40 seconds ago' "$BN_LEDGER.lock" "$BN_LEDGER.lock/owner"
printf '%s\n' 'stale' > "$BN_BUCKET/2026-07.tar.gz.tmp-123"
printf '%s\n' 'other' > "$BN_BUCKET/2026-08.tar.gz.tmp-123"
node "$CLI" rotate >"$TEST_TMP/bn.out" 2>"$TEST_TMP/bn.err"
assert_exit_code "$?" "0" "case bn: rotate exits 0"
assert_contains "$(cat "$TEST_TMP/bn.out")" "rotated " "case bn: month rotated"
test ! -e "$BN_BUCKET/2026-07.tar.gz.tmp-123"
assert_exit_code "$?" "0" "case bn: stale tmp tar of that month is gone"
test -f "$BN_BUCKET/2026-08.tar.gz.tmp-123"
assert_exit_code "$?" "0" "case bn: another month tmp tar is left"
test -f "$BN_BUCKET/2026-07.tar.gz"
assert_exit_code "$?" "0" "case bn: tar.gz exists (count matched)"
if tar -tzf "$BN_BUCKET/2026-07.tar.gz" | grep -F '.lock' >/dev/null; then
  fail "case bn: tar listing contains a .lock path"
else
  echo "case bn: tar listing has no .lock path"
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# (bo) in-place prune check refuses a symlink and a sibling path. The execute
# path calls that check before rmSync.
BO_ARCH="$TEST_TMP/archive-bo"
BO_SIB="${BO_ARCH}-evil"
mkdir -p "$BO_ARCH/bucket" "$BO_SIB"
ln -s "$BO_SIB" "$BO_ARCH/link-out"
node -e '
  const lib = require(process.argv[1]);
  const arch = process.argv[2];
  const sib = process.argv[3];
  const link = process.argv[4];
  if (typeof lib.pruneTargetAllowedChecked !== "function") process.exit(2);
  if (lib.pruneTargetAllowedChecked(arch, link) !== false) process.exit(3);
  if (lib.pruneTargetAllowedChecked(arch, sib) !== false) process.exit(4);
  if (lib.pruneTargetAllowedChecked(arch, arch + "/bucket") !== true) process.exit(5);
' "$TAR_LIB" "$BO_ARCH" "$BO_SIB" "$BO_ARCH/link-out"
assert_exit_code "$?" "0" "case bo: in-place check refuses symlink and sibling"
python3 - "$TAR_LIB" <<'PY'
import pathlib, sys
t = pathlib.Path(sys.argv[1]).read_text()
start = t.find("function pruneArchive")
body = t[start:]
call = body.find("pruneTargetAllowed(")
rm = body.find("fs.rmSync")
if call < 0 or rm < 0 or call > rm:
    sys.stderr.write("case bo: pruneTargetAllowed is not called before rmSync\n")
    sys.exit(2)
PY
assert_exit_code "$?" "0" "case bo: execute path checks the target before rmSync"

unset AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW
unset AUTOPILOT_TEST_NOW
unset AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR

finalize_test
