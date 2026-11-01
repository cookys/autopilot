#!/usr/bin/env bash
# seal-baseline.test.sh -- tools/migrate/seal-baseline.js and tools/migrate/no-rewrite.json (3.0.0 relayout, D9.1 / D9.6).
# Every scenario that changes a file does it in a throwaway clone (never this repo). Each negative control is shown red
# first (rc=1) and green again after the clone is reset. SEAL_BASELINE_JS may point at a mutated copy of the tool.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SB="${SEAL_BASELINE_JS:-$REPO_ROOT/tools/migrate/seal-baseline.js}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
rcis() { local want="$1" label="$2"; shift 2; "$@" >"$T/out" 2>"$T/err" </dev/null; local rc=$?; if [ "$rc" = "$want" ]; then ok; else bad "$label (rc=$rc want=$want)"; sed 's/^/    /' "$T/out" "$T/err" | head -6; fi; }
has() { if grep -q -- "$2" "$T/out"; then ok; else bad "$1 (no '$2' in output)"; sed 's/^/    /' "$T/out" | head -6; fi; }
hasnt() { if grep -q -- "$2" "$T/out"; then bad "$1 ('$2' present)"; else ok; fi; }

C="$T/c"
git clone -q "$REPO_ROOT" "$C" 2>/dev/null || { echo "FAIL: cannot clone $REPO_ROOT"; exit 1; }
G() { git -C "$C" -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t "$@"; }
BASE="$(G rev-parse HEAD)"
reset() { G reset -q --hard "$BASE"; G clean -qfd; }
rec() { node "$SB" record --root "$C" --out "$1" </dev/null >"$T/rec.out" 2>"$T/rec.err" || { bad "record failed: $(head -3 "$T/rec.err")"; return 1; }; }
cmpr() { node "$SB" compare --baseline "$T/base.json" --current "$T/cur.json" "$@"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

# ---- record: shape and determinism
rec "$T/base.json" || exit 1
rec "$T/base2.json"
cmp -s "$T/base.json" "$T/base2.json" && ok || bad "recording one tree twice gives identical bytes"
cp "$T/base.json" "$T/cur.json"
rcis 0 "compare of a record with itself" cmpr
node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const o=j.objects;const ids=Object.keys(o);
const e=(c,m)=>{if(!c){console.log("BAD "+m);process.exit(1)}};
const cat=(c,s)=>ids.filter(i=>o[i].category===c&&(!s||o[i].status===s)).length;
e(cat("mission-graph")===37&&cat("mission-graph","red")===8,"8 of 37 graphs red");
e(cat("task-authority")===23&&cat("task-authority","red")===13,"13 of 23 authorities red");
e(cat("stamp-row")===13&&cat("stamp-row","red")===1&&o["evals/skill-onoff/prereg/stage-graph-g8.json"].status==="red","g8 is the one red stamp row");
e(o["evals/skill-onoff/prereg/stage-graph-g67.json#amend-1-plugin-scripts"].status==="red","g67 amendment generator red");
e(o["evals/skill-onoff/prereg/d0gate.json#runner_pin"].status==="red","rail pin red");
e(o["docs/plans/evidence/2026-08-14-strict-l5-policy-refresh/platform-capabilities.json"].status==="red"&&o["docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json"].status==="green","platform capability receipts");
e(cat("phase-review")===2&&cat("phase-review","red")===2,"two phase-review artifacts red");
const red=(k)=>o["evals/skill-onoff/prereg/FROZEN.json#"+k];
e(red("stage-graph-g67.files").diagnostics.mismatch.length===5,"g67 body 5 files");
e(red("stage-graph-g67.amendments.amend-1-plugin-scripts.files").diagnostics.mismatch.length===3,"g67 amend-1 walk 3 files");
e(o["evals/skill-onoff/prereg/stage-graph-g67.json#amend-1-plugin-scripts"].diagnostics.mismatch.length===2,"g67 amend-1 generator 2 files");
e(red("amendments.stage-graph.amend-5-same-command-order.files").status==="red"&&red("amendments.stage-graph.amend-7-v11.files").status==="red","amend-5 and amend-7");
e(!/"\/(home|tmp)\//.test(require("fs").readFileSync(process.argv[1],"utf8")),"no absolute path in the record");
' "$T/base.json" && ok || bad "baseline contents match the D9.1 red list"

# ---- negative control: one character planted in a file a baseline-red object hashes
printf 'x' >> "$C/evals/skill-onoff/run-g67-campaign.js"
rec "$T/cur.json"; rcis 1 "planted character in a red object's referenced file -> compare red" cmpr
has "names the changed file" "fingerprint changed"
reset; rec "$T/cur.json"; rcis 0 "after reset compare is green again" cmpr

# ---- negative control: a green object turns red
printf 'x' >> "$C/evals/skill-onoff/prereg/qs.json"
rec "$T/cur.json"; rcis 1 "a green stamp row made red -> compare red" cmpr
has "reports new red" "green object turned red"
reset; rec "$T/cur.json"; rcis 0 "green object restored -> green" cmpr

# ---- negative control: a new red object (a copy of the red receipt added under a new name)
mkdir -p "$C/docs/plans/evidence/zz-new"
cp "$C/docs/plans/evidence/2026-08-14-strict-l5-policy-refresh/platform-capabilities.json" "$C/docs/plans/evidence/zz-new/platform-capabilities.json"
G add -A
rec "$T/cur.json"; rcis 1 "a new red object appears -> compare red" cmpr
has "reports new red object" "new red object: docs/plans/evidence/zz-new"
reset; rec "$T/cur.json"; rcis 0 "new red object removed -> green" cmpr

# ---- negative control: an object disappears
G rm -q docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json
rec "$T/cur.json"; rcis 1 "a baseline object gone -> compare red" cmpr
has "reports object gone" "object gone"
reset

# ---- red -> green: undeclared is red, declared is green
RED=docs/plans/evidence/2026-08-14-strict-l5-policy-refresh/platform-capabilities.json
cp "$C/docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json" "$C/$RED"
rec "$T/cur.json"; rcis 1 "red object turned green, undeclared -> red" cmpr
has "reports undeclared green" "turned green without a declared reason"
NEW="$(sha "$C/$RED")"
printf '[{"object":"%s","reason":"test: receipt replaced","status":"green","files":{"%s":"%s"}}]\n' "$RED" "$RED" "$NEW" > "$T/decl-ok.json"
rcis 0 "red -> green with a declaration (status, file sha, reason) -> green" cmpr --declared-changes "$T/decl-ok.json"
printf '[{"object":"%s","reason":"test","status":"green"}]\n' "$RED" > "$T/decl-nofiles.json"
rcis 1 "declaration that omits the changed file -> red" cmpr --declared-changes "$T/decl-nofiles.json"
printf '[{"object":"%s","reason":"test","status":"green","files":{"%s":"%s"}}]\n' "$RED" "$RED" "0000000000000000000000000000000000000000000000000000000000000000" > "$T/decl-wrong.json"
rcis 1 "declaration with the wrong sha -> red" cmpr --declared-changes "$T/decl-wrong.json"
printf '[{"object":"%s","reason":"","status":"green"}]\n' "$RED" > "$T/decl-noreason.json"
rcis 2 "declaration without a reason is bad input" cmpr --declared-changes "$T/decl-noreason.json"
reset
printf '[{"object":"docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json","reason":"stale","files":{"x":"%s"}}]\n' "$NEW" > "$T/decl-stale.json"
rec "$T/cur.json"; rcis 1 "stale declaration (nothing changed) -> red" cmpr --declared-changes "$T/decl-stale.json"

# ---- D9.1 second exit: a rail file edited by plan; the rail object is baseline red with new fingerprints
RAIL=scripts/gate-verify.js
printf '\n// edit\n' >> "$C/$RAIL"
rec "$T/cur.json"; rcis 1 "rail file edited, undeclared -> red" cmpr
NEWRAIL="$(sha "$C/$RAIL")"
DIAG="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).objects["evals/skill-onoff/prereg/d0gate.json#runner_pin"];console.log(JSON.stringify(j.diagnostics))' "$T/cur.json")"
printf '[{"object":"evals/skill-onoff/prereg/d0gate.json#runner_pin","reason":"test: P4 edits the rail","status":"red","files":{"%s":"%s"},"diagnostics":%s}]\n' "$RAIL" "$NEWRAIL" "$DIAG" > "$T/decl-rail.json"
rcis 0 "rail edit declared with new sha and expected diagnostics -> green" cmpr --declared-changes "$T/decl-rail.json"
printf '\n// second\n' >> "$C/$RAIL"
rec "$T/cur.json"; rcis 1 "the declaration does not cover a later further edit -> red" cmpr --declared-changes "$T/decl-rail.json"
reset

# ---- layout-map: a pure move of a green object
GREEN=docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json
mkdir -p "$C/evidence/moved"; G mv "$GREEN" evidence/moved/platform-capabilities.json
rec "$T/cur.json"; rcis 1 "moved object without a layout-map -> red" cmpr
printf '{"%s":"evidence/moved/platform-capabilities.json"}\n' "$GREEN" > "$T/map.json"
rcis 0 "same move with the layout-map -> green" cmpr --layout-map "$T/map.json"
reset

# ---- no-rewrite.json
NR="$C/tools/migrate/no-rewrite.json"
node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const e=(c,m)=>{if(!c){console.log("BAD "+m);process.exit(1)}};
const set=new Set(j.entries.map(x=>x.path));
e(j.entries.length>4000,"entries");
e(j.entries.every(x=>/^[0-9a-f]{64}$/.test(x.sha256)),"every entry has a sha256");
e(new Set(j.entries.map(x=>x.path)).size===j.entries.length,"no duplicate path");
const cls=new Set(j.excluded.map(x=>x.class));
for(const k of ["O8","O9","O10","O12","O14"]) e(cls.has(k),"exclusion class "+k);
e(j.excluded.every(x=>x.reason&&x.reason.length>20),"every exclusion has a reason");
e(j.excluded.every(x=>!set.has(x.path)),"no excluded path is also listed");
const need=["scripts/dispatch-hetero.sh","scripts/per-turn-gate-arm.js","scripts/gate-verify.js","hooks/per-turn-gate.js","scripts/lib/seed-claude-config.js","hooks/tests/skill-onoff-g67.test.sh","hooks/tests/skill-onoff-g8.test.sh","skills/dev-flow/SKILL.md","skills/ceo-agent/SKILL.md","hooks/fixtures/supersession-anchors.json"];
for(const p of need) e(j.excluded.some(x=>x.path===p),"excluded "+p);
for(const p of ["docs/mission-qualification-verdict-stability-task-authority.json","docs/mission-hook-test-harness-determinism-execution-graph.json","evals/skill-onoff/prereg/FROZEN.json","evals/skill-onoff/packs/manifest.json","evals/consult-eval-rubric.seal.json","scripts/check-guidance-eval.js","hooks/tests/fixtures/mission-terminal-rollover/.frozen-evidence"]) e(set.has(p),"listed "+p);
' "$NR" && ok || bad "no-rewrite.json shape, exclusions and members"
rcis 0 "unchanged clone: range HEAD..HEAD is green" node "$SB" check-rewrite --root "$C" --range "$BASE..$BASE"

TARGET=evals/consult-eval-rubric.md      # listed (seal spec)
printf 'x' >> "$C/$TARGET"; G commit -qam "plant"
rcis 1 "one character planted in a listed file -> check-rewrite red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
has "names the file" "$TARGET: bytes changed"
G reset -q --hard "$BASE"
rcis 0 "planted character removed -> green" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"

mkdir -p "$C/evals/moved"; G mv "$TARGET" evals/moved/consult-eval-rubric.md; G commit -qm "mv"
printf '{"%s":"evals/moved/consult-eval-rubric.md"}\n' "$TARGET" > "$T/rw-map.json"
rcis 0 "git mv of a listed file, with layout-map -> green" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/rw-map.json"
rcis 1 "same git mv without layout-map -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
has "says renamed without a layout-map entry" "renamed without a layout-map entry"
# a mapped rename that also changes a byte is still red
printf 'x' >> "$C/evals/moved/consult-eval-rubric.md"; G commit -qam "mv+edit"
rcis 1 "renamed AND edited, with layout-map -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/rw-map.json"
G reset -q --hard "$BASE"

# an excluded (plan-allowed) file may change
printf '\n// P4\n' >> "$C/scripts/gate-verify.js"; G commit -qam "rail"
rcis 0 "an excluded rail file edited -> green (D9.6 exclusion)" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
G reset -q --hard "$BASE"

# --files: what a rewriter is about to write
printf 'docs/README.md\nscripts/gate-verify.js\n' > "$T/w-ok.txt"
printf 'docs/README.md\n./%s\n' "$TARGET" > "$T/w-bad.txt"
rcis 0 "--files with only unlisted files -> green" node "$SB" check-rewrite --root "$C" --files "$T/w-ok.txt"
rcis 1 "--files naming a listed file -> red" node "$SB" check-rewrite --root "$C" --files "$T/w-bad.txt"
has "names the file" "$TARGET"
rcis 1 "--files naming the mapped name of a listed file -> red" node "$SB" check-rewrite --root "$C" --files "$T/w-bad.txt" --layout-map "$T/rw-map.json"
printf 'evals/moved/consult-eval-rubric.md\n' > "$T/w-mapped.txt"
rcis 1 "--files naming the post-move name, with layout-map -> red" node "$SB" check-rewrite --root "$C" --files "$T/w-mapped.txt" --layout-map "$T/rw-map.json"

# ---- input errors
rcis 2 "no subcommand" node "$SB"
rcis 2 "compare without --baseline" node "$SB" compare --current "$T/cur.json"
rcis 2 "check-rewrite without --range or --files" node "$SB" check-rewrite --root "$C"
rcis 2 "check-rewrite with an unknown commit" node "$SB" check-rewrite --root "$C" --range "deadbeefdeadbeef..HEAD"
echo '{' > "$T/broken.json"
rcis 2 "compare with a broken baseline" node "$SB" compare --baseline "$T/broken.json" --current "$T/cur.json"

echo "seal-baseline: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
