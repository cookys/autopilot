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
const entry = { generation: 1, base, head, status: 'finalized', implementer_engine: 'claude-sonnet-5', seats: [{ id: 's0', status: 'reviewed', engine: 'gpt-5' }],
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
  # The mainline is the fixed ref refs/remotes/origin/develop; each case builds it with update-ref. MAINLINE is the commit it
  # points at: by default the target itself (the mainline ends at the target), T7 points it somewhere the target is not on.
  local ml="${MAINLINE-$tg}"; [ "$ml" = NONE ] && ml="$B0"
  g rev-parse --verify -q "$ml^{commit}" >/dev/null && g update-ref refs/remotes/origin/develop "$(g rev-parse "$ml")"
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

# T: the target is the caller's choice and must not hide the branch's own commits (it must not contain the reviewed head,
# and must descend from the phase base). Each of these would pass with an empty or partial ledger if the target were trusted.
g checkout -q -b dm "$B0"; g merge -q --no-ff -m "develop took the branch" work; DM=$(g rev-parse HEAD); g checkout -q work
led t0 P "$HEADR" "[]"
led t3 P "$HEADR" "[{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V}]"
OUT=$(TGT=$TIP run "$TEST_TMP/t0.json" work); assert_exit_code "$?" "1" "T1: target = the tip, empty ledger, fails"; assert_contains "$OUT" "already contains the last reviewed head" "T1: message"
OUT=$(TGT=work run "$TEST_TMP/t0.json" work); assert_exit_code "$?" "1" "T2: target = the branch name, empty ledger, fails"; assert_contains "$OUT" "already contains the last reviewed head" "T2: message"
OUT=$(TGT=$P1 run "$TEST_TMP/t3.json" work); assert_exit_code "$?" "1" "T3: target = a commit after the head, partial ledger, fails"
OUT=$(TGT=$DM run "$TEST_TMP/t0.json" work); assert_exit_code "$?" "1" "T4: target = a develop that already merged the branch, empty ledger, fails"
OUT=$(TGT=$HEADR run "$TEST_TMP/good.json" work); assert_exit_code "$?" "1" "T5: target = the reviewed head itself fails"
ROOT=$(g commit-tree "$(g mktree </dev/null)" -m unrelated-root)
OUT=$(TGT=$ROOT run "$TEST_TMP/good.json" work); assert_exit_code "$?" "1" "T6: target not descending from --phase-base fails"; assert_contains "$OUT" "does not descend from --phase-base" "T6: message"

# T7: a side branch cut from the phase base passes the ancestry rules; only the mainline rule stops it hiding an unreviewed commit
g checkout -q -b side "$B0"; echo s7 > "$R/s7.txt"; g add s7.txt; g commit -qm "unreviewed S"; S7=$(g rev-parse HEAD)
g checkout -q -b mc10 "$TIP"; g merge -q --no-ff -m "merge side (clean)" side >/dev/null 2>&1; M10=$(g rev-parse HEAD)
assert_eq "$(g diff-tree --remerge-diff --no-commit-id --name-only -r "$M10" | wc -l | tr -d ' ')" "0" "fixture T7: the merge of side is clean (empty re-merge diff)"
OUT=$(TGT=side MAINLINE=develop run "$TEST_TMP/good.json" mc10); assert_exit_code "$?" "1" "T7: target = a side branch off the phase base fails"; assert_contains "$OUT" "is not on the first-parent history of refs/remotes/origin/develop" "T7: message"
OUT=$(TGT=$B0 MAINLINE=develop run "$TEST_TMP/good.json" mc10); assert_exit_code "$?" "1" "T7b: a mainline target makes S an own commit, unlisted, fails"; assert_contains "$OUT" "commit $S7 is in" "T7b: names S"
led t7ok P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$S7\",\"paths\":[\"s7.txt\"],$V}]"
OUT=$(TGT=$B0 MAINLINE=develop run "$TEST_TMP/t7ok.json" mc10); assert_exit_code "$?" "0" "T7ok: a mainline target with S listed passes"
OUT=$(TGT=side MAINLINE=develop MAINLINE_REF=side run "$TEST_TMP/good.json" mc10); assert_exit_code "$?" "1" "T7d: target = side with the environment trying to name the mainline still fails (the mainline is fixed)"
g update-ref -d refs/remotes/origin/develop
OUT=$(node "$SCRIPT" --ledger "$L" --phase P --branch mc10 --phase-base "$B0" --repo-root "$R" --post-head-ledger "$TEST_TMP/t7ok.json" --post-head-target "$B0" 2>&1); assert_exit_code "$?" "1" "T7c: without refs/remotes/origin/develop it fails closed"; assert_contains "$OUT" "run git fetch origin first" "T7c: tells to fetch"
g checkout -q work

# U: merges that take one side whole or drop a side: git diff-tree --cc lists nothing for them, the re-merge does
g checkout -q -b mc5 "$TIP"; g merge -q --no-ff -m "merge develop" develop >/dev/null 2>&1; g checkout -q --theirs a.txt; g add a.txt; g commit -q -m "merge develop (took develop's a.txt whole)"; M5=$(g rev-parse HEAD)
assert_eq "$(g diff-tree --cc --no-commit-id --name-only -r "$M5" | wc -l | tr -d ' ')" "0" "fixture U1: --cc sees nothing for a whole-side resolution"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc5); assert_exit_code "$?" "1" "U1: conflict resolved by taking develop's whole file, merge not listed, fails"; assert_contains "$OUT" "merge commit $M5 carries content of its own" "U1: names the merge"
led u1ok P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$M5\",\"paths\":[\"a.txt\"],$V}]"
OUT=$(TGT=develop run "$TEST_TMP/u1ok.json" mc5); assert_exit_code "$?" "0" "U1ok: the same merge listed with a.txt passes"
g checkout -q -b mc6 "$TIP"; g merge -q -s ours --no-ff -m "merge develop2 -s ours" develop2 >/dev/null 2>&1; M6=$(g rev-parse HEAD)
assert_eq "$(g diff-tree --cc --no-commit-id --name-only -r "$M6" | wc -l | tr -d ' ')" "0" "fixture U2: --cc sees nothing for -s ours"
OUT=$(TGT=develop2 run "$TEST_TMP/good.json" mc6); assert_exit_code "$?" "1" "U2: merge -s ours (drops develop2's e.txt), not listed, fails"; assert_contains "$OUT" "merge commit $M6 carries content of its own" "U2: names the merge"
led u2ok P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$M6\",\"paths\":[\"e.txt\"],$V}]"
OUT=$(TGT=develop2 run "$TEST_TMP/u2ok.json" mc6); assert_exit_code "$?" "0" "U2ok: listed with e.txt passes"
g checkout -q -b mc7 "$TIP"; g merge -q -X theirs --no-ff -m "merge develop -X theirs" develop >/dev/null 2>&1; M7=$(g rev-parse HEAD)
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc7); assert_exit_code "$?" "1" "U3: merge -X theirs (auto-resolved conflict), not listed, fails"; assert_contains "$OUT" "merge commit $M7 carries content of its own" "U3: names the merge"
# a merge with more than two parents fails closed
g checkout -q -b o3 "$B0"; echo o3 > "$R/o3.txt"; g add o3.txt; g commit -qm o3
g checkout -q -b mc8 "$TIP"; g merge -q --no-ff -m octopus develop2 o3 >/dev/null 2>&1
OUT=$(run "$TEST_TMP/good.json" mc8); assert_exit_code "$?" "1" "U4: an octopus merge fails closed"; assert_contains "$OUT" "has 3 parents" "U4: message"
# unrelated histories: the root commit has no parent, diff-tree needs --root to list its paths
g checkout -q --orphan orph; g rm -rfq . >/dev/null 2>&1; echo o > "$R/o.txt"; g add o.txt; g commit -q -m "orphan root"; ORPH=$(g rev-parse HEAD)
g checkout -q -b mc9 "$TIP"; g merge -q --allow-unrelated-histories --no-ff -m "merge unrelated" orph >/dev/null 2>&1
led r10 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$ORPH\",\"paths\":[],$V}]"
OUT=$(run "$TEST_TMP/r10.json" mc9); assert_exit_code "$?" "1" "R10: a root commit (unrelated history) listed with no paths fails"; assert_contains "$OUT" "commit $ORPH touched 'o.txt'" "R10: its path is reported"
led r10ok P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$ORPH\",\"paths\":[\"o.txt\"],$V}]"
OUT=$(run "$TEST_TMP/r10ok.json" mc9); assert_exit_code "$?" "0" "R10ok: the root commit listed with o.txt passes (the clean unrelated merge needs no entry)"
# unusual path names are read with -z (git would C-quote them otherwise)
g checkout -q -b uni "$TIP"; echo u > "$R/naïve file.txt"; g add . ; g commit -q -m uni; UNI=$(g rev-parse HEAD)
led g3 P "$HEADR" "[{\"sha\":\"$P1\",\"paths\":[\"a.txt\"],$V},{\"sha\":\"$P2\",\"paths\":[\"m.txt\",\"n.txt\"],$V},{\"sha\":\"$UNI\",\"paths\":[\"naïve file.txt\"],$V}]"
OUT=$(run "$TEST_TMP/g3.json" uni); assert_exit_code "$?" "0" "G3: a non-ASCII path with a space is compared unquoted"
g checkout -q work

# tip == head with an empty list passes; a non-empty list for it fails (extra entry)
g checkout -q -b same "$HEADR"
led e1 P "$HEADR" "[]"
OUT=$(run "$TEST_TMP/e1.json" same); assert_exit_code "$?" "0" "E1: tip equals the reviewed head, empty ledger passes"
OUT=$(run "$TEST_TMP/good.json" same); assert_exit_code "$?" "1" "E2: entries for commits outside head..tip fail"
g checkout -q work

# --post-head-target alone is refused, not ignored
OUT=$(node "$SCRIPT" --ledger "$L" --phase P --branch work --phase-base "$B0" --repo-root "$R" --post-head-target "$B0" 2>&1); assert_exit_code "$?" "1" "X0: --post-head-target without --post-head-ledger fails"; assert_contains "$OUT" "only means something with --post-head-ledger" "X0: message"
OUT=$(node "$SCRIPT" --ledger "$L" --phase P --branch work --phase-base "$B0" --repo-root "$R" --post-head-ledger "$TEST_TMP/good.json" --post-head-target "$B0" --post-head-target-ref develop 2>&1); assert_exit_code "$?" "1" "X0b: the removed --post-head-target-ref is refused, not ignored"; assert_contains "$OUT" "was removed" "X0b: message"
echo '{}' > "$TEST_TMP/pa.json"
OUT=$(node "$SCRIPT" --plan-artifact "$TEST_TMP/pa.json" --dispositions "$TEST_TMP/pa.json" --post-head-ledger "$TEST_TMP/good.json" --post-head-target "$B0" 2>&1); assert_exit_code "$?" "1" "X3: Mode B with --post-head-ledger is refused"; assert_contains "$OUT" "Mode A only" "X3: message"
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
mutate "no-renames dropped in diff-tree" "'diff-tree', '--root', '-z', '--no-commit-id', '-r', '--no-renames', '--name-only'" "'diff-tree', '--root', '-z', '--no-commit-id', '-r', '-M', '--name-only'"
OUT=$(run "$TEST_TMP/r9.json" ren); assert_exit_code "$?" "0" "NC3: with rename detection on, R9 (source side undeclared) passes"

mutate "merge own-content check off" "if (ps.length) mergeOwn.set(m, ps);" "if (false) mergeOwn.set(m, ps);"
OUT=$(TGT=develop run "$TEST_TMP/c2.json" mc); assert_exit_code "$?" "1" "NC4 setup: a listed merge entry is now an extra entry and fails"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc); assert_exit_code "$?" "0" "NC4: without the merge own-content check C1 (unlisted conflict-resolving merge) passes"

mutate "target-contains-head rule off" "if (git(['merge-base', '--is-ancestor', '--end-of-options', head, targetSha]).status === 0) {" "if (false) {"
OUT=$(TGT=$TIP run "$TEST_TMP/t0.json" work); assert_exit_code "$?" "0" "NC5: without the head-not-in-target rule T1 (target = tip, empty ledger) passes"
OUT=$(TGT=work run "$TEST_TMP/t0.json" work); assert_exit_code "$?" "0" "NC5: T2 (target = branch name) passes"
OUT=$(TGT=$P1 run "$TEST_TMP/t3.json" work); assert_exit_code "$?" "0" "NC5: T3 (target after the head, partial ledger) passes"
OUT=$(TGT=$DM run "$TEST_TMP/t0.json" work); assert_exit_code "$?" "0" "NC5: T4 (develop already merged the branch) passes"
OUT=$(TGT=$ROOT run "$TEST_TMP/good.json" work); assert_exit_code "$?" "1" "NC5: T6 is still caught by the phase-base rule"
mutate "mainline rule off" "if (!nul(mainline).includes(targetSha)) {" "if (false) {"
OUT=$(TGT=side MAINLINE=develop run "$TEST_TMP/good.json" mc10); assert_exit_code "$?" "0" "NC12: without the first-parent rule T7 (target = side, S hidden) passes"
mutate "mainline ref overridable from the environment" "const MAINLINE_REF = 'refs/remotes/origin/develop';" "const MAINLINE_REF = process.env.MAINLINE_REF || 'refs/remotes/origin/develop';"
OUT=$(TGT=side MAINLINE=develop MAINLINE_REF=side run "$TEST_TMP/good.json" mc10); assert_exit_code "$?" "0" "NC13: with the mainline overridable (target = ref = side) T7d passes"
mutate "re-merge replaced by --cc" "['diff-tree', '--remerge-diff', '-z', '--no-renames', '--name-only', '--no-commit-id', '-r', m]" "['diff-tree', '--cc', '-z', '--name-only', '--no-commit-id', '-r', m]"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc5); assert_exit_code "$?" "0" "NC6: with --cc only, U1 (whole-side resolution) passes"
OUT=$(TGT=develop2 run "$TEST_TMP/good.json" mc6); assert_exit_code "$?" "0" "NC6: with --cc only, U2 (-s ours) passes"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc7); assert_exit_code "$?" "0" "NC6: with --cc only, U3 (-X theirs) passes"
OUT=$(TGT=develop run "$TEST_TMP/good.json" mc); assert_exit_code "$?" "1" "NC6: C1 (real conflict resolution) is still seen by --cc"
mutate "--root dropped" "'diff-tree', '--root', '-z'" "'diff-tree', '-z'"
OUT=$(run "$TEST_TMP/r10.json" mc9); assert_exit_code "$?" "0" "NC7: without --root a root commit's paths are never compared, R10 passes"
mutate "extra-sha check off" "if (!expected.has(c.sha)) problems.push(" "if (false) problems.push("
OUT=$(run "$TEST_TMP/r3.json" work); assert_exit_code "$?" "0" "NC8: without the extra-sha check R3 passes"
mutate "merge paths subset off" "if (!declared.has(p)) problems.push(\`merge commit" "if (false) problems.push(\`merge commit"
OUT=$(TGT=develop run "$TEST_TMP/c2b.json" mc); assert_exit_code "$?" "0" "NC9: without the merge paths subset C2b passes"
mutate "reviewed_head check off" "if (ledger.reviewed_head !== head) problems.push(" "if (false) problems.push("
OUT=$(run "$TEST_TMP/r6.json" work); assert_exit_code "$?" "0" "NC10: without the reviewed_head check R6 passes"
mutate "head-ancestor-of-tip off" "if (git(['merge-base', '--is-ancestor', '--end-of-options', head, tip]).status !== 0) {" "if (false) {"
OUT=$(run "$TEST_TMP/r8.json" alt); assert_exit_code "$?" "0" "NC11: without the head-is-ancestor-of-tip check R8 passes"

finalize_test
