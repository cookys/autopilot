#!/usr/bin/env bash
# check-phase-review-receipt-chain.test.sh — BL-0373: --chain A,B[,C...] (several review sets, one contiguous base..tip)
# Real git repo + real ledger fixtures (receipt, chain.json, range.json, findings, dispositions, seat artifact).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-phase-review-receipt.js"
R="$TEST_TMP/repo"
L="$TEST_TMP/ledger"
mkdir -p "$R" "$L"
g() { git -C "$R" "$@"; }
g init -q; g config user.email t@example.com; g config user.name t
g config diff.renames true   # a user config that makes a plain git diff detect renames (the scripts must not depend on it)
echo base > "$R/a.txt"
mkdir -p "$R/.claude"; printf -- '- exclude_allowlist: vendor/dist/**\n' > "$R/.claude/review-loop-config.md"   # consumer allowlist, committed
g add a.txt .claude/review-loop-config.md; g commit -q -m b0; B0=$(g rev-parse HEAD)
g checkout -q -b work
echo x > "$R/a.txt"; g commit -qam c1; X=$(g rev-parse HEAD)
echo gap > "$R/a.txt"; g commit -qam c2; GAP=$(g rev-parse HEAD)
echo final > "$R/a.txt"; echo new > "$R/n.txt"; g add n.txt; g commit -qam c3; TIP=$(g rev-parse HEAD)

# mk <phase> <base> <head> [verdict] [open_finding_id]  — writes a one-generation ledger for <phase>
cat > "$TEST_TMP/mk.js" <<'JS'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const [ledger, repo, phase, base, head, verdict = 'SHIP-AS-IS', openId = ''] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gd = path.join(ledger, `review-${phase}`, 'g1');
fs.mkdirSync(gd, { recursive: true });
const diff = cp.spawnSync('git', ['diff', `${base}..${head}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
fs.writeFileSync(path.join(gd, 'range.json'), JSON.stringify({ base, head, diff_sha256: sha(diff) }));
const finding = openId ? [{ id: openId, severity: 'Critical', seat: 's0', text: 'x' }] : [];
const disp = openId ? [{ id: openId, disposition: 'verified', rationale: 'confirmed against the diff' }] : [];
fs.writeFileSync(path.join(gd, 'findings.json'), JSON.stringify({ findings: finding }));
fs.writeFileSync(path.join(gd, 'dispositions.json'), JSON.stringify({ findings: disp }));
fs.writeFileSync(path.join(gd, 'seat-s0.json'), JSON.stringify({ status: 'reviewed', verdict: 'SHIP-AS-IS', findings: '', no_finding_proof: 'checked=all; evidence=clean diff; conclusion=safe' }));
const h = (f) => sha(fs.readFileSync(path.join(gd, f)));
const entry = { generation: 1, base, head, status: 'finalized', implementer_engine: 'claude-sonnet-5', seats: [{ id: 's0', status: 'reviewed', engine: 'gpt-5' }],
  dispositions_sha256: h('dispositions.json'), findings_sha256: h('findings.json'), seat_artifact_sha256: { s0: h('seat-s0.json') } };
fs.writeFileSync(path.join(ledger, `review-${phase}`, 'chain.json'), JSON.stringify([entry]));
fs.writeFileSync(path.join(ledger, `receipt-${phase}.json`), JSON.stringify({ kind: 'review', phase, branch: 'work', phase_base_sha: base,
  chain: [entry], verdict, open_findings: [],
  resolved_from: 'test', written_at: '2026-11-04T00:00:00Z' }));
JS
mk() { node "$TEST_TMP/mk.js" "$L" "$R" "$@"; }
chain() { node "${SCRIPT_UNDER:-$SCRIPT}" --chain "$1" --ledger "$L" --branch work --phase-base "${2:-$B0}" --repo-root "$R" 2>&1; }

mk A "$B0" "$X"; mk B "$X" "$TIP"
mk Bgap "$GAP" "$TIP"        # starts after A's head: x..gap reviewed by no set, but a.txt is also in Bgap's range
mk Bov "$B0" "$TIP"          # starts before A's head
mk Afix "$B0" "$X" FIX-THEN-SHIP F1
mk Aforge "$B0" "$X" SHIP-AS-IS F1
mk Bbad "$X" "$TIP"; node -e "const f='$L/review-Bbad/g1/range.json',o=JSON.parse(require('fs').readFileSync(f));o.diff_sha256='0'.repeat(64);require('fs').writeFileSync(f,JSON.stringify(o))"

# the BL-0373 situation: A alone is stale against the tip, the chain A,B passes
OUT=$(node "$SCRIPT" --ledger "$L" --phase A --branch work --phase-base "$B0" --repo-root "$R" 2>&1); assert_exit_code "$?" "1" "A alone against the tip fails (head moved)"
OUT=$(chain A,B); assert_exit_code "$?" "0" "G1: A (base..x) + B (x..tip, adds n.txt) passes"; assert_contains "$OUT" "Review chain A,B ok" "G1: ok line"

OUT=$(chain A,Bgap); RC=$?; assert_exit_code "$RC" "1" "R1: gap between ranges fails"; assert_contains "$OUT" "gap: commits $X..$GAP" "R1: gap message"
OUT=$(chain A,Bov); RC=$?; assert_exit_code "$RC" "1" "R2a: overlapping ranges fail"; assert_contains "$OUT" "overlap or out of order" "R2a: overlap message"
OUT=$(chain B,A); RC=$?; assert_exit_code "$RC" "1" "R2b: sets listed in reverse order fail"; assert_contains "$OUT" "chain contiguity" "R2b: contiguity message"
OUT=$(chain Afix,B); RC=$?; assert_exit_code "$RC" "1" "R3: a non-SHIP-AS-IS member fails"; assert_contains "$OUT" "chain member 'Afix' did not pass" "R3: filed under member"
OUT=$(chain Aforge,B); RC=$?; assert_exit_code "$RC" "1" "R4a: forged SHIP-AS-IS over an open verified Critical finding fails"; assert_contains "$OUT" "chain member 'Aforge'" "R4a: filed under member"
OUT=$(chain A,Bbad); RC=$?; assert_exit_code "$RC" "1" "R4b: tampered range diff_sha256 fails"; assert_contains "$OUT" "chain member 'Bbad'" "R4b: filed under member"
OUT=$(chain A); RC=$?; assert_exit_code "$RC" "1" "R5: one set fails"; assert_contains "$OUT" "at least two" "R5: message"
OUT=$(chain A,Nope); RC=$?; assert_exit_code "$RC" "1" "R6: unknown set fails"; assert_contains "$OUT" "chain member 'Nope'" "R6: names the member"
OUT=$(chain A,A); RC=$?; assert_exit_code "$RC" "1" "R7: duplicate set fails"; assert_contains "$OUT" "names a review set twice" "R7: message"
OUT=$(node "$SCRIPT" --chain A,B --phase A --ledger "$L" --branch work --phase-base "$B0" --repo-root "$R" 2>&1); assert_exit_code "$?" "1" "R8: --chain with --phase fails"; assert_contains "$OUT" "--chain cannot be combined" "R8: message"
echo '{}' > "$TEST_TMP/pa.json"
OUT=$(node "$SCRIPT" --chain A,B --plan-artifact "$TEST_TMP/pa.json" --dispositions "$TEST_TMP/pa.json" --ledger "$L" --branch work --phase-base "$B0" --repo-root "$R" 2>&1); assert_exit_code "$?" "1" "R8b: --chain with --plan-artifact/--dispositions fails (not silently ignored)"; assert_contains "$OUT" "--chain cannot be combined" "R8b: message"
OUT=$(chain A,B "$X"); RC=$?; assert_exit_code "$RC" "1" "R9: --phase-base not equal to the first set's base fails"; assert_contains "$OUT" "chain contiguity: set 'A' base $B0 is not --phase-base $X" "R9: message"
OUT=$(chain 'A,../B'); assert_exit_code "$?" "1" "R9b: path-like set name refused"; assert_contains "$OUT" "--chain names must be phase ids" "R9b: message"

# Tail: whatever lies past B's head must be tolerated exactly as Mode A tolerates it past its own head.
tailcase() { # tailcase <label> <path> <content> <expect-rc> <message-fragment>
  g reset -q --hard "$TIP"
  mkdir -p "$(dirname "$R/$2")"; printf '%s\n' "$3" > "$R/$2"; g add "$2"; g commit -qm "tail $1"
  OUT=$(chain A,B); RC=$?
  assert_exit_code "$RC" "$4" "tail $1: exit"
  [ -n "$5" ] && assert_contains "$OUT" "$5" "tail $1: message"
}
tailcase new-file late.txt late 1 "chain tail: 'late.txt' changed after set 'B'"
tailcase edit-A-file a.txt again 1 "chain tail: 'a.txt' changed after set 'B'"
tailcase edit-B-file n.txt again 1 "chain tail: 'n.txt' changed after set 'B'"
tailcase revert-to-base a.txt base 1 "chain tail: 'a.txt' changed after set 'B'"
tailcase changelog CHANGELOG.md log 0 ""

# Parity with Mode A, with the expected verdict pinned for each path (so both modes degrading together is caught).
# The consumer allowlist (vendor/dist/**) is committed at b0, so it is part of the repo under test.
parity() { # parity <path> <expected-rc> [mv-from]
  g reset -q --hard "$TIP"
  mkdir -p "$(dirname "$R/$1")"
  if [ -n "${3:-}" ]; then g mv "$3" "$1"; else { [ -e "$R/$1" ] && printf 'edit\n' >> "$R/$1" || printf 'edit\n' > "$R/$1"; }; g add -f "$1"; fi
  g commit -qm "parity $1"
  OUT_A=$(node "$SCRIPT" --ledger "$L" --phase B --branch work --phase-base "$X" --repo-root "$R" 2>&1); MA=$?
  OUT_C=$(chain A,B); MC=$?
  assert_eq "$MA" "$2" "parity: '$1'${3:+ (git mv ${3:-})}: Mode A exit is $2"
  assert_eq "$MC" "$2" "parity: '$1'${3:+ (git mv ${3:-})}: --chain exit is $2"
}
parity CHANGELOG.md 0
parity package-lock.json 0
parity platforms/x/y.js 0
parity vendor/dist/z.txt 0
parity late.txt 1
parity a.txt 1
parity n.txt 1
parity .claude/review-loop-config.md 1
# the consumer row is what lets vendor/dist through: drop it from the working tree and the same move is refused by both
g reset -q --hard "$TIP"; mkdir -p "$R/vendor/dist"; echo z > "$R/vendor/dist/z.txt"; g add vendor; g commit -qm vend
mv "$R/.claude/review-loop-config.md" "$TEST_TMP/cfg.bak"
node "$SCRIPT" --ledger "$L" --phase B --branch work --phase-base "$X" --repo-root "$R" >/dev/null 2>&1; assert_eq "$?" "1" "parity: vendor/dist/z.txt without the consumer row: Mode A exit is 1"
chain A,B >/dev/null; assert_eq "$?" "1" "parity: vendor/dist/z.txt without the consumer row: --chain exit is 1"
mv "$TEST_TMP/cfg.bak" "$R/.claude/review-loop-config.md"
# renames (diff.renames=true in this repo): a reviewed product file moved onto a tolerated path is NOT tolerated
parity CHANGELOG.md 1 a.txt
parity vendor/dist/a.txt 1 a.txt
parity platforms/x.js 1 n.txt
g reset -q --hard "$TIP"; OUT=$(chain A,B); assert_exit_code "$?" "0" "parity: back at the tip the chain passes"
OUT_R=$(g mv a.txt CHANGELOG.md; g commit -qm mvchg; chain A,B); assert_contains "$OUT_R" "chain tail: 'a.txt' changed after set 'B'" "rename: the deleted source path is the one reported"
g reset -q --hard "$TIP"

# Negative controls: a copy of the scripts with ONE check removed must pass the red case (proving the red case
# is caught by that check and not by something else); the real script rejects it (asserted above).
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp -r "$REPO_ROOT/scripts" "$MUT/scripts"
mutate() { # mutate <label> <from> <to>
  node -e "
    const fs=require('fs'),f='$MUT/scripts/check-phase-review-receipt.js';let s=fs.readFileSync('$REPO_ROOT/scripts/check-phase-review-receipt.js','utf8');
    const i=s.indexOf(process.argv[1]); if(i<0||s.indexOf(process.argv[1],i+1)>=0){console.error('mutation anchor not unique: '+process.argv[1]);process.exit(3);}
    fs.writeFileSync(f,s.replace(process.argv[1],process.argv[2]));" "$2" "$3"
  assert_exit_code "$?" "0" "mutation applied: $1"
}
SCRIPT_UNDER="$MUT/scripts/check-phase-review-receipt.js"
mutate "contiguity off" "if (cur.base !== want) {" "if (false) {"
OUT=$(chain A,Bgap); assert_exit_code "$?" "0" "NC1: without the contiguity check the gap case passes (so the check is what rejects it)"
OUT=$(chain A,Bov); assert_exit_code "$?" "0" "NC1: without the contiguity check the overlap case passes"
OUT=$(chain B,A); assert_exit_code "$?" "1" "NC1: reversed order is still rejected without the contiguity check (the tail check also sees it: two layers)"
mutate "tail check off" "if (finalSet.head !== tip) {" "if (false) {"
OUT=$(chain A,B); assert_exit_code "$?" "0" "NC2 setup: tail-check-off script still passes the good chain"
for spec in "late.txt late" "a.txt again" "n.txt again" "a.txt base"; do
  set -- $spec; g reset -q --hard "$TIP"; printf '%s\n' "$2" > "$R/$1"; g add "$1"; g commit -qm "nc2 $1"
  OUT=$(chain A,B); assert_exit_code "$?" "0" "NC2: without the tail check '$1' (content '$2') changed past B's head passes (so the tail check is what rejects it)"
done
g reset -q --hard "$TIP"
mutate "no-renames dropped" "['diff', '--no-renames', '--name-only', range]" "['diff', '--name-only', range]"
for spec in "CHANGELOG.md a.txt" "vendor/dist/a.txt a.txt" "platforms/x.js n.txt"; do
  set -- $spec; g reset -q --hard "$TIP"; mkdir -p "$(dirname "$R/$1")"; g mv "$2" "$1"; g commit -qm "nc rename $1"
  OUT=$(chain A,B); assert_exit_code "$?" "0" "NC4: without --no-renames the move $2 -> $1 passes --chain"
  OUT=$(node "$MUT/scripts/check-phase-review-receipt.js" --ledger "$L" --phase B --branch work --phase-base "$X" --repo-root "$R" 2>&1); assert_exit_code "$?" "0" "NC4: without --no-renames the move $2 -> $1 passes Mode A"
done
g reset -q --hard "$TIP"
mutate "verdict relaxed" "receipt.verdict !== 'SHIP-AS-IS' || derivedState.verdict !== 'SHIP-AS-IS'" "receipt.verdict !== derivedState.verdict"
OUT=$(chain Afix,B); assert_exit_code "$?" "0" "NC3: with the verdict check relaxed a FIX-THEN-SHIP member passes"
OUT=$(chain Aforge,B); assert_exit_code "$?" "1" "NC3: a forged verdict is still rejected (receipt claims SHIP-AS-IS, re-derived is FIX-THEN-SHIP)"

finalize_test
