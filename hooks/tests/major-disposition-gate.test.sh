#!/usr/bin/env bash
# major-disposition-gate.test.sh — gate rule A as a machine check (G14): a Critical/Major finding is
# verified (and resolved later), refuted as false (refutation_kind + evidence) or downgraded
# (to + evidence_kind + evidence). finalize refuses the rest; the receipt fails the rest for chains
# finalized by the new finalize (disposition_schema 2). FAKE ledgers only.
. "$(dirname "$0")/lib.sh"

LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
CHECK="$REPO_ROOT/scripts/check-phase-review-receipt.js"

SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt; git add file.txt; git commit -q -m "c1"
  echo "base content" > file.txt; git add file.txt; git commit -q -m "c2"
)
PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(
  cd "$SCRATCH_REPO"
  git checkout -q -b work
  echo "work changes" >> file.txt; git add file.txt; git commit -q -m "c3"
)
GEN1_HEAD=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(
  cd "$SCRATCH_REPO"
  echo "fix" >> file.txt; git add file.txt; git commit -q -m "c4 fix"
)
GEN2_HEAD=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
git -C "$SCRATCH_REPO" reset -q --hard "$GEN1_HEAD"
LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"
sha_of() { node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$1"; }

# ─── finalize (hetero-review-loop.js) ───
fin_case() { # <phase> <severity> <disposition-entry-json-fields> -> runs finalize, sets FIN_OUT FIN_RC
  local p="$1" sev="$2" fields="$3"
  mkdir -p "$LEDGER/review-$p/g1"
  cat > "$LEDGER/review-$p/chain.json" <<EOF
[ { "generation": 1, "base": "base_$p", "head": "head_$p", "seats": ["s0"], "status": "pending" } ]
EOF
  echo "{ \"base\": \"base_$p\", \"head\": \"head_$p\" }" > "$LEDGER/review-$p/g1/range.json"
  echo "{ \"findings\": [ { \"id\": \"fm\", \"severity\": \"$sev\", \"seat\": \"s0\", \"text\": \"Unchecked return in write.js\" } ] }" > "$LEDGER/review-$p/g1/findings.json"
  cat > "$TEST_TMP/disp_$p.json" <<EOF
{ "schema_version": 1, "phase": "$p", "generation": 1,
  "findings": [ { "id": "fm", $fields } ] }
EOF
  FIN_OUT=$(node "$LOOP" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase "$p" --generation 1 --dispositions "$TEST_TMP/disp_$p.json" 2>&1); FIN_RC=$?
}

# F1 (negative control): a Major refuted with only "not blocking" and no refutation_kind is refused, names the id
fin_case f1 Major '"disposition": "refuted", "rationale": "true but not blocking"'
assert_exit_code "$FIN_RC" "1" "F1: Major refuted without refutation_kind is refused"
assert_contains "$FIN_OUT" "finding fm is refuted without refutation_kind" "F1: message names the finding id and the missing kind"
assert_file_absent "$LEDGER/receipt-f1.json" "F1: refusal writes no receipt"

# F2: refuted false_claim without evidence is refused
fin_case f2 Major '"disposition": "refuted", "rationale": "wrong", "refutation_kind": "false_claim"'
assert_exit_code "$FIN_RC" "1" "F2: refuted without evidence is refused"
assert_contains "$FIN_OUT" "without non-empty evidence" "F2: message asks for evidence"

# F3: "low_impact" is not a kind
fin_case f3 Major '"disposition": "refuted", "rationale": "x", "refutation_kind": "low_impact", "evidence": "n/a"'
assert_exit_code "$FIN_RC" "1" "F3: refutation_kind low_impact is refused"

# F4: refuted unreachable with evidence is accepted, SHIP-AS-IS
fin_case f4 Major '"disposition": "refuted", "rationale": "x", "refutation_kind": "unreachable", "evidence": "scripts/x.js:10 guards the only caller; test t.sh case 2 shows it"'
assert_exit_code "$FIN_RC" "0" "F4: refuted unreachable + evidence is accepted"
assert_contains "$(cat "$LEDGER/receipt-f4.json")" '"verdict": "SHIP-AS-IS"' "F4: verdict SHIP-AS-IS"

# F5: downgrade missing evidence is refused
fin_case f5 Major '"disposition": "downgraded", "rationale": "x", "to": "Minor", "evidence_kind": "impact_bounded"'
assert_exit_code "$FIN_RC" "1" "F5: downgrade without evidence is refused"
assert_contains "$FIN_OUT" "downgraded without non-empty evidence" "F5: message names the missing evidence"

# F6: downgrade to Major / missing evidence_kind refused
fin_case f6 Major '"disposition": "downgraded", "rationale": "x", "to": "Major", "evidence_kind": "impact_bounded", "evidence": "e"'
assert_exit_code "$FIN_RC" "1" "F6: downgrade to Major is refused"
fin_case f6b Major '"disposition": "downgraded", "rationale": "x", "to": "Minor", "evidence": "e"'
assert_exit_code "$FIN_RC" "1" "F6b: downgrade without evidence_kind is refused"

# F7: complete downgrade is accepted
fin_case f7 Critical '"disposition": "downgraded", "rationale": "x", "to": "Suggestion", "evidence_kind": "unreachable", "evidence": "no caller passes the empty list: grep -n callers scripts/ shows 1 hit at a.js:4"'
assert_exit_code "$FIN_RC" "0" "F7: complete downgrade is accepted"
assert_contains "$(cat "$LEDGER/receipt-f7.json")" '"verdict": "SHIP-AS-IS"' "F7: verdict SHIP-AS-IS"

# F8: verified Major still gives FIX-THEN-SHIP (the gate demand for verified is unchanged)
fin_case f8 Major '"disposition": "verified", "rationale": "confirmed"'
assert_exit_code "$FIN_RC" "0" "F8: verified Major finalizes"
assert_contains "$(cat "$LEDGER/receipt-f8.json")" '"verdict": "FIX-THEN-SHIP"' "F8: verified Major is FIX-THEN-SHIP"

# F9: Minor keeps the old rule (plain refuted accepted)
fin_case f9 Minor '"disposition": "refuted", "rationale": "not a bug"'
assert_exit_code "$FIN_RC" "0" "F9: Minor refuted without kind keeps the old rule"

# F10: downgraded on a Minor finding is misuse
fin_case f10 Minor '"disposition": "downgraded", "rationale": "x", "to": "Suggestion", "evidence_kind": "unreachable", "evidence": "e"'
assert_exit_code "$FIN_RC" "1" "F10: downgraded on a non-Major finding is refused"

# ─── receipt (check-phase-review-receipt.js) ───
AT="2026-11-07T00:00:00.000Z"  # every entry is finalized "after" the old cutover time; only the marker decides
DIFF1=$(git -C "$SCRATCH_REPO" diff "$PHASE_BASE" "$GEN1_HEAD" | sha256sum | awk '{print $1}')
DIFF2=$(git -C "$SCRATCH_REPO" diff "$GEN1_HEAD" "$GEN2_HEAD" | sha256sum | awk '{print $1}')

rc_gen() { # <phase> <gen> <base> <head> <diffsha> <findings-json-array> <disp-json-array> <resolutions-json-array> -> echoes chain entry json
  local p="$1" g="$2" b="$3" h="$4" ds="$5" fj="$6" dj="$7" rj="$8" mk="$9"
  mkdir -p "$LEDGER/review-$p/g$g"
  echo "{ \"base\": \"$b\", \"head\": \"$h\", \"diff_sha256\": \"$ds\" }" > "$LEDGER/review-$p/g$g/range.json"
  echo "{ \"findings\": $fj }" > "$LEDGER/review-$p/g$g/findings.json"
  echo "{ \"findings\": $dj, \"resolutions\": $rj }" > "$LEDGER/review-$p/g$g/dispositions.json"
  echo '{ "status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe" }' > "$LEDGER/review-$p/g$g/seat-s0.json"
  local dsha fsha ssha
  ssha=$(sha_of "$LEDGER/review-$p/g$g/seat-s0.json")
  dsha=$(sha_of "$LEDGER/review-$p/g$g/dispositions.json"); fsha=$(sha_of "$LEDGER/review-$p/g$g/findings.json")
  echo "{ \"generation\": $g, \"base\": \"$b\", \"head\": \"$h\", \"status\": \"finalized\", \"seats\": [{ \"id\": \"s0\", \"status\": \"reviewed\" }], \"seat_artifact_sha256\": { \"s0\": \"$ssha\" }, \"finalized_at\": \"$AT\"${mk:+, \"disposition_schema\": $mk}, \"dispositions_sha256\": \"$dsha\", \"findings_sha256\": \"$fsha\" }"
}
rc_write() { # <phase> <verdict> <open-json> <chain-entries comma-joined>
  local p="$1" v="$2" o="$3" ch="$4"
  echo "[ $ch ]" > "$LEDGER/review-$p/chain.json"
  echo "{ \"kind\": \"review\", \"phase\": \"$p\", \"branch\": \"work\", \"phase_base_sha\": \"$PHASE_BASE\", \"chain\": [ $ch ], \"verdict\": \"$v\", \"open_findings\": $o, \"resolved_from\": \"test\", \"written_at\": \"2026-11-07T00:00:00Z\" }" > "$LEDGER/receipt-$p.json"
}
rc_run() { # <phase> -> RC_OUT RC_RC
  RC_OUT=$(node "$CHECK" --ledger "$LEDGER" --phase "$1" --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); RC_RC=$?
}
FJ='[ { "id": "fm", "severity": "Major", "seat": "s0", "text": "bug" } ]'
mkdir -p "$LEDGER/review-r1" "$LEDGER/review-r2" "$LEDGER/review-r3" "$LEDGER/review-r4" "$LEDGER/review-r5" "$LEDGER/review-r6" "$LEDGER/review-r7"

# R1 (negative control): verified Major left open -> the receipt does not pass (FIX-THEN-SHIP is refused; a forged SHIP-AS-IS mismatches the re-derived state)
E=$(rc_gen r1 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "verified", "rationale": "ok" } ]' '[]' 2)
rc_write r1 "SHIP-AS-IS" '[]' "$E"; rc_run r1
assert_exit_code "$RC_RC" "1" "R1: unhandled verified Major (forged SHIP-AS-IS) fails the receipt"
E=$(rc_gen r1 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "verified", "rationale": "ok" } ]' '[]' 2)
rc_write r1 "FIX-THEN-SHIP" '[ { "id": "fm", "severity": "Major", "disposition": "verified" } ]' "$E"; rc_run r1
assert_exit_code "$RC_RC" "1" "R1b: honest FIX-THEN-SHIP receipt fails the merge gate"

# R2: refuted Major without refutation_kind in an entry carrying disposition_schema 2 fails, naming the rule
E=$(rc_gen r2 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "refuted", "rationale": "not blocking" } ]' '[]' 2)
rc_write r2 "SHIP-AS-IS" '[]' "$E"; rc_run r2
assert_exit_code "$RC_RC" "1" "R2: marked refuted Major without refutation_kind fails"
assert_contains "$RC_OUT" "refuted without refutation_kind" "R2: message names the missing kind"

# R3: the SAME ledger without the marker (old finalize), finalized_at after 02:30Z, is not re-judged
E=$(rc_gen r3 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "refuted", "rationale": "not blocking" } ]' '[]' "")
rc_write r3 "SHIP-AS-IS" '[]' "$E"; rc_run r3
assert_exit_code "$RC_RC" "0" "R3: marker-less chain with old-style refuted Major is not re-failed"

# R4: refuted with kind + evidence passes
E=$(rc_gen r4 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "refuted", "rationale": "r", "refutation_kind": "false_claim", "evidence": "file.txt:1 does not do that" } ]' '[]' 2)
rc_write r4 "SHIP-AS-IS" '[]' "$E"; rc_run r4
assert_exit_code "$RC_RC" "0" "R4: refuted with kind + evidence passes"

# R5: downgraded with fields passes
E=$(rc_gen r5 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "downgraded", "rationale": "r", "to": "Minor", "evidence_kind": "impact_bounded", "evidence": "only the debug path reads it: a.js:9" } ]' '[]' 2)
rc_write r5 "SHIP-AS-IS" '[]' "$E"; rc_run r5
assert_exit_code "$RC_RC" "0" "R5: downgraded with fields passes"

# R6: downgraded missing evidence fails
E=$(rc_gen r6 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "downgraded", "rationale": "r", "to": "Minor", "evidence_kind": "impact_bounded" } ]' '[]' 2)
rc_write r6 "SHIP-AS-IS" '[]' "$E"; rc_run r6
assert_exit_code "$RC_RC" "1" "R6: downgraded without evidence fails the receipt"

# R7: verified in gen 1, resolved by gen 2's resolution entry -> passes
E1=$(rc_gen r7 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "verified", "rationale": "ok" } ]' '[]' 2)
E2=$(rc_gen r7 2 "$GEN1_HEAD" "$GEN2_HEAD" "$DIFF2" '[]' '[]' '[ { "id": "fm", "rationale": "fixed in c4, re-checked" } ]' 2)
rc_write r7 "SHIP-AS-IS" '[]' "$E1, $E2"
git -C "$SCRATCH_REPO" reset -q --hard "$GEN2_HEAD"; rc_run r7
assert_exit_code "$RC_RC" "0" "R7: verified Major resolved by a later generation passes (output: $RC_OUT)"

# ─── rule A lives in the shared derive (one place): every consumer agrees ───
BARE='[ { "id": "fm", "disposition": "refuted", "rationale": "not blocking" } ]'
OKD='[ { "id": "fm", "disposition": "refuted", "rationale": "r", "refutation_kind": "false_claim", "evidence": "file.txt:1 does not do that" } ]'

# D1: derive alone keeps a marker-carrying bare-refuted Major open; without the marker it stays closed (history)
D1=$(node -e '
const d=require(process.argv[1]);
const f=[{id:"fm",severity:"Major",seat:"s0",text:"bug"}];
const run=(m,disp)=>{const e={generation:1,status:"finalized"}; if(m) e.disposition_schema=2;
  const r=d([e],new Map([[1,f]]),new Map([[1,{findings:disp,resolutions:[]}]])); return r.verdict+":"+(r.open_findings||[]).map(x=>x.id).join(",");};
console.log([run(true,[{id:"fm",disposition:"refuted"}]),run(false,[{id:"fm",disposition:"refuted"}]),run(true,[{id:"fm",disposition:"deferred"}]),run(true,[{id:"fm",disposition:"refuted",refutation_kind:"false_claim",evidence:"x"}])].join("|"));
' "$REPO_ROOT/scripts/lib/review-chain-derive.js")
assert_eq "$D1" "FIX-THEN-SHIP:fm|SHIP-AS-IS:|FIX-THEN-SHIP:fm|SHIP-AS-IS:" "D1: derive alone keeps a schema-2 bare refuted/deferred Major active; unmarked and valid ones close"

# D2: finalize of generation 2 re-derives generation 1 (schema 2, bare refuted Major) as still open -> FIX-THEN-SHIP, never SHIP-AS-IS
d2_case() { # <phase> <gen1-dispositions-json-array> -> D2_OUT D2_RC; receipt verdict in $D2_VERDICT
  local p="$1" dj="$2" L2="$TEST_TMP/ledger-$1"
  mkdir -p "$L2/review-$p/g1" "$L2/review-$p/g2"
  echo "{ \"base\": \"$PHASE_BASE\", \"head\": \"$GEN1_HEAD\", \"diff_sha256\": \"$DIFF1\" }" > "$L2/review-$p/g1/range.json"
  echo "{ \"findings\": $FJ }" > "$L2/review-$p/g1/findings.json"
  echo "{ \"findings\": $dj, \"resolutions\": [] }" > "$L2/review-$p/g1/dispositions.json"
  echo "{ \"base\": \"$GEN1_HEAD\", \"head\": \"$GEN2_HEAD\" }" > "$L2/review-$p/g2/range.json"
  echo '{ "findings": [] }' > "$L2/review-$p/g2/findings.json"
  echo "{ \"schema_version\": 1, \"phase\": \"$p\", \"generation\": 2, \"findings\": [] }" > "$TEST_TMP/disp_$p.json"
  cat > "$L2/review-$p/chain.json" <<EOF
[ { "generation": 1, "base": "$PHASE_BASE", "head": "$GEN1_HEAD", "seats": ["s0"], "status": "finalized", "finalized_at": "$AT", "disposition_schema": 2, "dispositions_path": "review-$p/g1/dispositions.json" },
  { "generation": 2, "base": "$GEN1_HEAD", "head": "$GEN2_HEAD", "seats": ["s0"], "status": "pending" } ]
EOF
  D2_OUT=$(node "$LOOP" finalize --repo-root "$SCRATCH_REPO" --ledger "$L2" --phase "$p" --generation 2 --dispositions "$TEST_TMP/disp_$p.json" 2>&1); D2_RC=$?
  D2_VERDICT=$(cat "$L2/receipt-$p.json" 2>/dev/null)
}
d2_case d2 "$BARE"
assert_contains "$D2_VERDICT" '"verdict": "FIX-THEN-SHIP"' "D2: a later generation does not close a schema-2 bare refuted Major (output: $D2_OUT)"
d2_case d2ok "$OKD"
assert_contains "$D2_VERDICT" '"verdict": "SHIP-AS-IS"' "D2 control: the same chain with a valid refutation closes (output: $D2_OUT)"

# D3 / D4 share a builder: one Mode A phase (optionally a packet) whose single Major carries a bare or a valid refutation
cat > "$TEST_TMP/mkphase.js" <<'JS'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const [ledger, repo, phase, base, head, variant, packetsFile, packetId] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gd = path.join(ledger, `review-${phase}`, 'g1');
fs.mkdirSync(gd, { recursive: true });
let packet;
const diffArgs = ['diff', `${base}..${head}`];
if (packetsFile) {
  const text = fs.readFileSync(packetsFile, 'utf8');
  const obj = JSON.parse(text);
  const paths = obj.packets[packetId].slice().sort();
  packet = { set: obj.set, id: packetId, packets_sha256: sha(text), paths };
  diffArgs.splice(1, 0, '--no-renames'); diffArgs.push('--', ...paths);
}
const diff = cp.spawnSync('git', ['--literal-pathspecs', ...diffArgs], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
const full = packet ? sha(cp.spawnSync('git', ['diff', `${base}..${head}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout) : undefined;
fs.writeFileSync(path.join(gd, 'range.json'), JSON.stringify({ base, head, diff_sha256: sha(diff), ...(packet ? { packet, full_range_sha256: full, excluded: [] } : {}) }));
const findings = variant === 'none' ? [] : [{ id: 'fm', severity: 'Major', seat: 's0', text: 'bug' }];
const disp = variant === 'bare' ? [{ id: 'fm', disposition: 'refuted', rationale: 'not blocking' }]
  : variant === 'ok' ? [{ id: 'fm', disposition: 'refuted', rationale: 'r', refutation_kind: 'false_claim', evidence: 'a.txt:1 does not do that' }] : [];
fs.writeFileSync(path.join(gd, 'findings.json'), JSON.stringify({ findings }));
fs.writeFileSync(path.join(gd, 'dispositions.json'), JSON.stringify({ findings: disp, resolutions: [] }));
fs.writeFileSync(path.join(gd, 'seat-s0.json'), JSON.stringify({ status: 'reviewed', verdict: 'SHIP-AS-IS', findings: '', no_finding_proof: 'checked=all; evidence=clean diff; conclusion=safe' }));
const h = (f) => sha(fs.readFileSync(path.join(gd, f)));
const entry = { generation: 1, base, head, status: 'finalized', seats: [{ id: 's0', status: 'reviewed' }], finalized_at: '2026-11-07T00:00:00.000Z', disposition_schema: 2,
  dispositions_sha256: h('dispositions.json'), findings_sha256: h('findings.json'), seat_artifact_sha256: { s0: h('seat-s0.json') }, ...(packet ? { packet } : {}) };
fs.writeFileSync(path.join(ledger, `review-${phase}`, 'chain.json'), JSON.stringify([entry]));
fs.writeFileSync(path.join(ledger, `receipt-${phase}.json`), JSON.stringify({ kind: 'review', phase, branch: 'work', phase_base_sha: base,
  chain: [entry], verdict: 'SHIP-AS-IS', open_findings: [], resolved_from: 'test', written_at: '2026-11-07T00:00:00Z', ...(packet ? { packet } : {}) }));
JS

# D3: --packets path. Packet a is clean, packet b carries a schema-2 bare refuted Major: the set fails naming packet b; a valid refutation passes
PR="$TEST_TMP/prepo"; mkdir -p "$PR"
pg() { git -C "$PR" "$@"; }
pg init -q; pg config user.email t@example.com; pg config user.name t
echo base > "$PR/a.txt"; echo base > "$PR/b.txt"; pg add a.txt b.txt; pg commit -q -m b0; PB0=$(pg rev-parse HEAD)
pg checkout -q -b work; echo x > "$PR/a.txt"; echo y > "$PR/b.txt"; pg commit -qam c1; PH=$(pg rev-parse HEAD)
echo '{ "schema": "autopilot.review-packets/1", "set": "ps", "packets": { "a": ["a.txt"], "b": ["b.txt"] } }' > "$TEST_TMP/packets.json"
d3_run() { # <variant-of-b>
  local L3="$TEST_TMP/ledger-d3-$1"; mkdir -p "$L3"
  node "$TEST_TMP/mkphase.js" "$L3" "$PR" ps-a "$PB0" "$PH" none "$TEST_TMP/packets.json" a
  node "$TEST_TMP/mkphase.js" "$L3" "$PR" ps-b "$PB0" "$PH" "$1" "$TEST_TMP/packets.json" b
  D3_OUT=$(node "$CHECK" --packets "$TEST_TMP/packets.json" --ledger "$L3" --branch work --phase-base "$PB0" --repo-root "$PR" 2>&1); D3_RC=$?
}
d3_run bare
assert_exit_code "$D3_RC" "1" "D3b: packet set with a schema-2 bare refuted Major in packet b fails"
assert_contains "$D3_OUT" "refuted without refutation_kind" "D3b: message names the rule (output: $D3_OUT)"
d3_run ok
assert_exit_code "$D3_RC" "0" "D3a: the same set with a valid refutation passes (output: $D3_OUT)"

# D4: --post-head-ledger path. Past the cap the head moved; the same schema-2 bare refuted Major still fails
HR=$(pg rev-parse HEAD); echo p >> "$PR/a.txt"; pg commit -qam p1; P1=$(pg rev-parse HEAD)
pg update-ref refs/remotes/origin/develop "$PB0"
echo "{\"schema\":\"post-head-ledger/1\",\"phase\":\"P\",\"reviewed_head\":\"$HR\",\"ruling\":\"PM ruling d-test\",\"commits\":[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],\"verification\":\"depth-0 red/green\"}]}" > "$TEST_TMP/phl.json"
d4_run() { # <variant>
  local L4="$TEST_TMP/ledger-d4-$1"; mkdir -p "$L4"
  node "$TEST_TMP/mkphase.js" "$L4" "$PR" P "$PB0" "$HR" "$1"
  D4_OUT=$(node "$CHECK" --ledger "$L4" --phase P --branch work --phase-base "$PB0" --repo-root "$PR" --post-head-ledger "$TEST_TMP/phl.json" --post-head-target "$PB0" 2>&1); D4_RC=$?
}
d4_run bare
assert_exit_code "$D4_RC" "1" "D4b: post-head path with a schema-2 bare refuted Major fails"
assert_contains "$D4_OUT" "refuted without refutation_kind" "D4b: message names the rule (output: $D4_OUT)"
d4_run ok
assert_exit_code "$D4_RC" "0" "D4a: the same chain with a valid refutation passes the post-head path (output: $D4_OUT)"

finalize_test
