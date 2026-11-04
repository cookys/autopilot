#!/usr/bin/env bash
# check-phase-review-receipt-post-head.test.sh — BL-0377: --post-head-ledger <file> (Mode A past the generation cap)
# Real git repo + real ledger fixtures. The ledger is a declaration; the checker re-derives commits and paths with git.
. "$(dirname "$0")/lib.sh"

SCRIPT="${POSTHEAD_SCRIPT_UNDER_TEST:-$REPO_ROOT/scripts/check-phase-review-receipt.js}"   # override only to show the cases red against an older checker
R="$TEST_TMP/repo"
L="$TEST_TMP/ledger"
mkdir -p "$R" "$L"
g() { git -C "$R" "$@"; }
g init -q; g config user.email t@example.com; g config user.name t
g config diff.renames true   # a user config that makes a plain git diff detect renames (the checker must not depend on it)
echo base > "$R/a.txt"; echo base > "$R/n.txt"
g add a.txt n.txt; g commit -q -m b0; B0=$(g rev-parse HEAD)
g checkout -q -b work
echo x > "$R/a.txt"; g commit -qam c1; HEADR=$(g rev-parse HEAD)          # the last reviewed head
echo p1 >> "$R/a.txt"; g commit -qam p1; P1=$(g rev-parse HEAD)           # post-head: edits a.txt
echo m > "$R/m.txt"; echo p2 >> "$R/n.txt"; g add m.txt; g commit -qam p2; P2=$(g rev-parse HEAD)   # adds m.txt, edits n.txt
TIP=$P2

cat > "$TEST_TMP/mk.js" <<'JS'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const [ledger, repo, phase, base, head] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gd = path.join(ledger, `review-${phase}`, 'g1');
fs.mkdirSync(gd, { recursive: true });
const diff = cp.spawnSync('git', ['diff', `${base}..${head}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
fs.writeFileSync(path.join(gd, 'range.json'), JSON.stringify({ base, head, diff_sha256: sha(diff) }));
fs.writeFileSync(path.join(gd, 'findings.json'), JSON.stringify({ findings: [] }));
fs.writeFileSync(path.join(gd, 'dispositions.json'), JSON.stringify({ findings: [] }));
fs.writeFileSync(path.join(gd, 'seat-s0.json'), JSON.stringify({ status: 'reviewed', verdict: 'SHIP-AS-IS', findings: '', no_finding_proof: 'checked=all; evidence=clean diff; conclusion=safe' }));
const h = (f) => sha(fs.readFileSync(path.join(gd, f)));
const entry = { generation: 1, base, head, status: 'finalized', seats: [{ id: 's0', status: 'reviewed' }],
  dispositions_sha256: h('dispositions.json'), findings_sha256: h('findings.json'), seat_artifact_sha256: { s0: h('seat-s0.json') } };
fs.writeFileSync(path.join(ledger, `review-${phase}`, 'chain.json'), JSON.stringify([entry]));
fs.writeFileSync(path.join(ledger, `receipt-${phase}.json`), JSON.stringify({ kind: 'review', phase, branch: 'work', phase_base_sha: base,
  chain: [entry], verdict: 'SHIP-AS-IS', open_findings: [], resolved_from: 'test', written_at: '2026-11-04T00:00:00Z' }));
JS
node "$TEST_TMP/mk.js" "$L" "$R" P "$B0" "$HEADR"

# led <name> <phase> <reviewed_head> <commits-json>  -> $TEST_TMP/<name>.json
led() { printf '{"schema":"post-head-ledger/1","phase":"%s","reviewed_head":"%s","ruling":"PM ruling d-test","commits":%s}\n' "$2" "$3" "$4" > "$TEST_TMP/$1.json"; }
V='"verification":"depth-0 red/green, evidence /tmp/x"'
GOOD="[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
run() { # run <ledger-file> [branch] [extra args...]
  local f="$1" br="${2:-work}" tg="${TGT-$B0}"
  if [ "$tg" = NONE ]; then node "${SCRIPT_UNDER:-$SCRIPT}" --ledger "$L" --phase P --branch "$br" --phase-base "$B0" --repo-root "$R" --post-head-ledger "$f" 2>&1
  else node "${SCRIPT_UNDER:-$SCRIPT}" --ledger "$L" --phase P --branch "$br" --phase-base "$B0" --repo-root "$R" --post-head-ledger "$f" --post-head-target "$tg" 2>&1; fi
}

# baseline: no ledger, the head has moved -> fails exactly as before
OUT=$(node "$SCRIPT" --ledger "$L" --phase P --branch work --phase-base "$B0" --repo-root "$R" 2>&1); RC=$?
assert_exit_code "$RC" "1" "N0: without a ledger a moved head still fails"; assert_contains "$OUT" "head has moved" "N0: old message"

# positive
led good P "$HEADR" "$GOOD"
OUT=$(run "$TEST_TMP/good.json" work); assert_exit_code "$?" "0" "G1: every post-head commit declared with its paths passes"; assert_contains "$OUT" "Post-head ledger ok" "G1: ok line"
led super P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\",\"extra.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/super.json" work); assert_exit_code "$?" "0" "G2: listed paths may be a superset of the real paths"

# red cases
# R1a: P1 is not listed at all
led r1a P "$HEADR" "[{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r1a.json" work); assert_exit_code "$?" "1" "R1a: an unlisted post-head commit fails"; assert_contains "$OUT" "commit $P1 is in $HEADR..$TIP ^$B0 but not in the post-head ledger" "R1a: names the commit"
# R1b: same, but P2 lists a.txt so the net diff is covered; only the every-commit check can catch it
led r1b P "$HEADR" "[{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\",\"a.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r1b.json" work); assert_exit_code "$?" "1" "R1b: an unlisted commit fails even when its path is declared on another commit"; assert_contains "$OUT" "not in the post-head ledger" "R1b: message"
# R2: P2 touched n.txt but lists only m.txt (P1 lists n.txt so the net diff is covered)
led r2 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\",\"n.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r2.json" work); assert_exit_code "$?" "1" "R2: listed paths narrower than the real paths fail"; assert_contains "$OUT" "commit $P2 touched 'n.txt' which its ledger paths do not list" "R2: names the path"
# R2b: the net diff catches a path no commit lists
led r2b P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r2b.json" work); assert_exit_code "$?" "1" "R2b: a path listed nowhere fails"
# R3: extra sha (the reviewed head itself, a pre-head commit, an abbreviated sha)
led r3 P "$HEADR" "[{\"sha\":\"$HEADR\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r3.json" work); assert_exit_code "$?" "1" "R3: an extra sha outside head..tip fails"; assert_contains "$OUT" "sha $HEADR is not an own commit in" "R3: message"
SHORT=$(printf %s "$P1" | cut -c1-12)
led r3b P "$HEADR" "[{\"sha\":\"$SHORT\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r3b.json" work); assert_exit_code "$?" "1" "R3b: an abbreviated sha is not accepted"
# R4: duplicate
led r4 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r4.json" work); assert_exit_code "$?" "1" "R4: a duplicated sha fails"; assert_contains "$OUT" "is listed twice" "R4: message"
# R5: empty / blank / missing verification
led r5 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],\"verification\":\"\"},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r5.json" work); assert_exit_code "$?" "1" "R5a: empty verification fails"; assert_contains "$OUT" "verification is empty" "R5a: message"
led r5b P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],\"verification\":\"   \"},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r5b.json" work); assert_exit_code "$?" "1" "R5b: blank verification fails"
led r5c P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"]},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r5c.json" work); assert_exit_code "$?" "1" "R5c: missing verification fails"
# R6: reviewed_head mismatch
led r6 P "$B0" "$GOOD"
OUT=$(run "$TEST_TMP/r6.json" work); assert_exit_code "$?" "1" "R6: reviewed_head not the last finalized head fails"; assert_contains "$OUT" "is not the last finalized head" "R6: message"
# R7: phase mismatch
led r7 Q "$HEADR" "$GOOD"
OUT=$(run "$TEST_TMP/r7.json" work); assert_exit_code "$?" "1" "R7: ledger phase different from --phase fails"; assert_contains "$OUT" "does not match --phase" "R7: message"
# R7b: wrong schema, empty ruling, unreadable file
sed 's#post-head-ledger/1#post-head-ledger/9#' "$TEST_TMP/good.json" > "$TEST_TMP/r7b.json"
OUT=$(run "$TEST_TMP/r7b.json" work); assert_exit_code "$?" "1" "R7b: wrong schema fails"
sed 's#"ruling":"PM ruling d-test"#"ruling":" "#' "$TEST_TMP/good.json" > "$TEST_TMP/r7c.json"
OUT=$(run "$TEST_TMP/r7c.json" work); assert_exit_code "$?" "1" "R7c: empty ruling fails"; assert_contains "$OUT" "ruling is missing or empty" "R7c: message"
OUT=$(run "$TEST_TMP/does-not-exist.json" work); assert_exit_code "$?" "1" "R7d: missing ledger file fails"
# R8: head is not an ancestor of the tip
g checkout -q -b alt "$B0"; echo alt > "$R/alt.txt"; g add alt.txt; g commit -qm alt; ALT=$(g rev-parse HEAD); g checkout -q work
led r8 P "$HEADR" "[{\"sha\":\"$ALT\",\"paths\":[\"alt.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r8.json" alt); assert_exit_code "$?" "1" "R8: reviewed head that is not an ancestor of the tip fails"; assert_contains "$OUT" "is not an ancestor of 'alt'" "R8: message"
# R9: a rename lists BOTH sides (--no-renames); declaring only the destination fails
g checkout -q -b ren "$TIP"; g mv n.txt q.txt; g commit -qm p3; P3=$(g rev-parse HEAD); g checkout -q work
led r9 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$P3\",\"paths\":[\"q.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r9.json" ren); assert_exit_code "$?" "1" "R9: rename declared by destination only fails"; assert_contains "$OUT" "commit $P3 touched 'n.txt'" "R9: the source side is reported"
led r9ok P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$P3\",\"paths\":[\"n.txt\",\"q.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r9ok.json" ren); assert_exit_code "$?" "0" "R9ok: rename declared with both sides passes"

# Target merged into the branch mid-way (--post-head-target): the target's own commits are not listed; a merge commit
# is listed only when it carries content of its own (git diff-tree --cc), and then its paths must cover that content.
g checkout -q -b develop "$B0"; echo devline > "$R/a.txt"; g commit -qam d1; echo d > "$R/d.txt"; g add d.txt; g commit -qm d2; DEV=$(g rev-parse HEAD)
g checkout -q -b mc "$TIP"
g merge -q --no-ff -m "merge develop" develop >/dev/null 2>&1   # conflicts on a.txt (both sides changed it)
echo resolved > "$R/a.txt"; g add a.txt; g commit -q -m "merge develop (resolved a.txt)"; M=$(g rev-parse HEAD)
assert_eq "$(g rev-list --parents -n1 "$M" | wc -w)" "3" "fixture: M is a merge commit"
assert_contains "$(g diff-tree --cc --no-commit-id --name-only -r "$M")" "a.txt" "fixture: git sees the conflict resolution as the merge's own content"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc); assert_exit_code "$?" "1" "C1: merge with a conflict resolution on a product file, merge commit not listed, fails"; assert_contains "$OUT" "merge commit $M carries content of its own" "C1: names the merge"
led c2 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$M\",\"paths\":[\"a.txt\"],$V}]"
OUT=$(TGT=develop run "$TEST_TMP/c2.json" mc); assert_exit_code "$?" "0" "C2: the same merge listed with its paths passes (the target's d1, d2 are not listed)"
led c2b P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$M\",\"paths\":[\"m.txt\"],$V}]"
OUT=$(TGT=develop run "$TEST_TMP/c2b.json" mc); assert_exit_code "$?" "1" "C2b: the merge listed with paths not covering its own content fails"; assert_contains "$OUT" "merge commit $M changed 'a.txt' on its own" "C2b: message"
OUT=$(TGT=$B0 run "$TEST_TMP/c2.json" mc); assert_exit_code "$?" "1" "C2c: with a target that lacks develop, the merged-in commits are own commits and unlisted fail"
OUT=$(TGT=NONE run "$TEST_TMP/good.json" work); assert_exit_code "$?" "1" "C2d: --post-head-ledger without --post-head-target fails"; assert_contains "$OUT" "--post-head-target <ref> is required" "C2d: message"
OUT=$(TGT=no-such-ref run "$TEST_TMP/good.json" work); assert_exit_code "$?" "1" "C2e: an unresolvable target fails"
# C3: a clean merge of the target: the target's commits need no entry and the merge needs none
g checkout -q -b develop2 "$B0"; echo e > "$R/e.txt"; g add e.txt; g commit -qm e1; g checkout -q -b mc3 "$TIP"; g merge -q --no-ff -m "merge develop2" develop2
assert_eq "$(g diff-tree --cc --no-commit-id --name-only -r HEAD | wc -l | tr -d ' ')" "0" "fixture: the clean merge has no content of its own"
OUT=$(TGT=develop2 run "$TEST_TMP/good.json" mc3); assert_exit_code "$?" "0" "C3: clean merge of the target, only own commits listed, passes"
# C4: an evil merge (a file no parent has) is the merge's own content
echo evil > "$R/z.txt"; g add z.txt; g commit -q --amend --no-edit
OUT=$(TGT=develop2 run "$TEST_TMP/good.json" mc3); assert_exit_code "$?" "1" "C4: content added by the merge commit itself, merge not listed, fails"; assert_contains "$OUT" "z.txt" "C4: names the path"
g checkout -q work

# tip == head with an empty list passes; a non-empty list for it fails (extra entry)
g checkout -q -b same "$HEADR"
led e1 P "$HEADR" "[]"
OUT=$(run "$TEST_TMP/e1.json" same); assert_exit_code "$?" "0" "E1: tip equals the reviewed head, empty ledger passes"
OUT=$(run "$TEST_TMP/good.json" same); assert_exit_code "$?" "1" "E2: entries for commits outside head..tip fail"
g checkout -q work

# Refusals outside Mode A
OUT=$(node "$SCRIPT" --chain P,Q --post-head-ledger "$TEST_TMP/good.json" --ledger "$L" --branch work --phase-base "$B0" --repo-root "$R" 2>&1); assert_exit_code "$?" "1" "X1: --chain with --post-head-ledger refused"; assert_contains "$OUT" "Mode A only" "X1: message"
OUT=$(node "$SCRIPT" --packets "$TEST_TMP/good.json" --post-head-ledger "$TEST_TMP/good.json" --ledger "$L" --branch work --phase-base "$B0" --repo-root "$R" 2>&1); assert_exit_code "$?" "1" "X2: --packets with --post-head-ledger refused"

# Negative controls: a copy of the checker with ONE check removed must pass the matching red case.
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp -r "$REPO_ROOT/scripts" "$MUT/scripts"
mutate() { # mutate <label> <from> <to>
  node -e "
    const fs=require('fs'),f='$MUT/scripts/check-phase-review-receipt.js';let s=fs.readFileSync('$REPO_ROOT/scripts/check-phase-review-receipt.js','utf8');
    const i=s.indexOf(process.argv[1]); if(i<0||s.indexOf(process.argv[1],i+1)>=0){console.error('mutation anchor not unique: '+process.argv[1]);process.exit(3);}
    fs.writeFileSync(f,s.replace(process.argv[1],()=>process.argv[2]));" "$2" "$3"
  assert_exit_code "$?" "0" "mutation applied: $1"
}
SCRIPT_UNDER="$MUT/scripts/check-phase-review-receipt.js"
mutate "every-commit-listed check off" "if (!entry) { problems.push(\`commit \${sha} is in" "if (!entry) { continue; } if (false) { problems.push(\`commit \${sha} is in"
OUT=$(run "$TEST_TMP/good.json" work); assert_exit_code "$?" "0" "NC1 setup: the good ledger still passes"
OUT=$(run "$TEST_TMP/r1b.json" work); assert_exit_code "$?" "0" "NC1: without the every-commit check R1b (unlisted commit, path declared elsewhere) passes"
OUT=$(run "$TEST_TMP/r1a.json" work); assert_exit_code "$?" "0" "NC1: R1a (unlisted commit) passes too: there is no second layer left"
mutate "subset check off" "if (!declared.has(p)) problems.push(\`commit \${sha} touched" "if (false) problems.push(\`commit \${sha} touched"
OUT=$(run "$TEST_TMP/r2.json" work); assert_exit_code "$?" "0" "NC2: without the subset check R2 (commit touched a path it did not list, declared elsewhere) passes"
OUT=$(run "$TEST_TMP/r2b.json" work); assert_exit_code "$?" "0" "NC2: R2b (narrow paths) passes too without the subset check"
mutate "no-renames dropped in diff-tree" "'diff-tree', '--no-commit-id', '-r', '--no-renames', '--name-only'" "'diff-tree', '--no-commit-id', '-r', '-M', '--name-only'"
OUT=$(run "$TEST_TMP/r9.json" ren); assert_exit_code "$?" "0" "NC3: with rename detection on, R9 (source side undeclared) passes"

mutate "merge own-content check off" "if (ps.length) mergeOwn.set(m, ps);" "if (false) mergeOwn.set(m, ps);"
OUT=$(TGT=develop run "$TEST_TMP/c2.json" mc); assert_exit_code "$?" "1" "NC4 setup: a listed merge entry is now an extra entry and fails"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc); assert_exit_code "$?" "0" "NC4: without the merge own-content check C1 (unlisted conflict-resolving merge) passes"

finalize_test
