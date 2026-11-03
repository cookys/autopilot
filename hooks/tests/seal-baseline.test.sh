#!/usr/bin/env bash
# seal-baseline.test.sh -- tools/migrate/seal-baseline.js and tools/migrate/no-rewrite.json (3.0.0 relayout, D9.1 / D9.6).
# Every scenario that changes a file does it in a throwaway clone (never this repo). Each negative control is shown red
# first (rc=1) and green again after the clone is reset. SEAL_BASELINE_JS may point at a mutated copy of the tool.
. "$(dirname "$0")/lib.sh"
SB="${SEAL_BASELINE_JS:-$REPO_ROOT/tools/migrate/seal-baseline.js}"
T="$TEST_TMP"
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
e(cat("mission-graph")===38&&cat("mission-graph","red")===8,"8 of 38 graphs red");
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
const need=["scripts/dispatch-hetero.sh","scripts/per-turn-gate-arm.js","scripts/gate-verify.js","hooks/per-turn-gate.js","scripts/lib/seed-claude-config.js","hooks/tests/skill-onoff-g67.test.sh","hooks/tests/skill-onoff-g8.test.sh","skills/dev-flow/SKILL.md","skills/ceo-agent/SKILL.md","hooks/fixtures/supersession-anchors.json","scripts/check-guidance-eval.js"];
for(const p of need) e(j.excluded.some(x=>x.path===p),"excluded "+p);
for(const p of ["project/missions/mission-qualification-verdict-stability-task-authority.json","project/missions/mission-hook-test-harness-determinism-execution-graph.json","evals/skill-onoff/prereg/FROZEN.json","evals/skill-onoff/packs/manifest.json","evals/consult-eval-rubric.seal.json","hooks/tests/fixtures/mission-terminal-rollover/.frozen-evidence"]) e(set.has(p),"listed "+p);
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

# D9 ruling: check-guidance-eval.js is excluded (amend-7 row is archive-only), other listed files stay protected
printf '\n// P4\n' >> "$C/scripts/check-guidance-eval.js"; G commit -qam "cge"
rcis 0 "check-guidance-eval.js edited by one character -> check-rewrite green (excluded, O8-ext)" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
printf 'x' >> "$C/$TARGET"; G commit -qam "cge+listed"
rcis 1 "same range plus a listed file edited -> still red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
has "names the listed file" "$TARGET: bytes changed"
hasnt "does not name the excluded file" "check-guidance-eval"
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

# ---- round 2: symlink reference chains, copy-not-move, stale declarations, cv1 probes
node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=new Set(j.entries.map(x=>x.path));
process.exit(["evals/skill-onoff/tasks/g8-flow/repo","evals/skill-onoff/tasks/g8-l4/repo","evals/skill-onoff/tasks/g6-l4/repo/cli.js"].every(p=>s.has(p))?0:1)' "$NR" && ok || bad "the g8 repo symlinks and their resolved target are listed"
LINK=evals/skill-onoff/tasks/g8-flow/repo
rm "$C/$LINK"; ln -s ../stage-graph-s-feature/repo "$C/$LINK"; G add -A; G commit -qm "redirect"
rcis 1 "g8-flow/repo symlink redirected to a different directory -> check-rewrite --range red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
has "names the symlink" "$LINK: bytes changed"
printf '%s\n' "$LINK" > "$T/w-link.txt"
rcis 1 "--files naming the symlink -> red" node "$SB" check-rewrite --root "$C" --files "$T/w-link.txt"
printf '%s/cli.js\n' "$LINK" > "$T/w-thru.txt"
rcis 1 "--files naming a file reached through the symlink -> red" node "$SB" check-rewrite --root "$C" --files "$T/w-thru.txt"
G reset -q --hard "$BASE"
rcis 0 "symlink restored -> green" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"

# copy, not move: the original stays (edited), the destination holds the original bytes
mkdir -p "$C/evals/moved"; cp "$C/$TARGET" "$C/evals/moved/consult-eval-rubric.md"; printf 'x' >> "$C/$TARGET"; G add -A; G commit -qm "copy"
rcis 1 "copy instead of move (original edited, destination = original bytes) with layout-map -> check-rewrite red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/rw-map.json"
has "says it is a copy" "a copy, not a move"
G reset -q --hard "$BASE"
# the same copy where the original is left untouched is still not a move
mkdir -p "$C/evals/moved"; cp "$C/$TARGET" "$C/evals/moved/consult-eval-rubric.md"; G add -A; G commit -qm "copy2"
rcis 1 "pure copy (original untouched) with layout-map -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/rw-map.json"
G reset -q --hard "$BASE"

# compare: copy of a green object to a mapped place while the original stays
mkdir -p "$C/evidence/copied"; cp "$C/$GREEN" "$C/evidence/copied/platform-capabilities.json"; printf ' ' >> "$C/$GREEN"; G add -A
rec "$T/cur.json"
printf '{"%s":"evidence/copied/platform-capabilities.json"}\n' "$GREEN" > "$T/map2.json"
rcis 1 "compare: object copied, original still present, with layout-map -> red" cmpr --layout-map "$T/map2.json"
has "reports the old path" "still present at its old path"
reset

# stale declaration: states only a status, the object did not change
rec "$T/cur.json"
printf '[{"object":"%s","reason":"stale","status":"red"}]\n' "$RED" > "$T/decl-stale2.json"
rcis 1 "compare: status-only declaration for an unchanged object -> red" cmpr --declared-changes "$T/decl-stale2.json"
has "lists the stale declaration" "stale declaration"
rcis 0 "compare: no declaration for the same unchanged state -> green" cmpr

# cv1 probes (wrong map, delete, same-bytes symlink, declaration for another object)
P=project/plans/2026-08-04-platform-capability-trigger-activation.md
printf '{"%s":"README.md"}\n' "$P" > "$T/map-wrong.json"
rcis 1 "probe: layout-map onto a different existing file -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/map-wrong.json"
G rm -q "$P"; G commit -qm delete
rcis 1 "probe: protected plan deleted -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
G reset -q --hard "$BASE"
cp "$C/$P" "$T/same-bytes"; rm "$C/$P"; ln -s "$T/same-bytes" "$C/$P"; G add "$P"; G commit -qm symlink
rcis 1 "probe: protected plan replaced by a symlink to identical bytes -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD"
G reset -q --hard "$BASE"
printf 'x' >> "$C/evals/skill-onoff/run-g67-campaign.js"; rec "$T/cur.json"
printf '[{"object":"%s","reason":"other object"}]\n' "$RED" > "$T/decl-other.json"
rcis 1 "probe: change declared for another object -> red" cmpr --declared-changes "$T/decl-other.json"
reset

# ---- round 3: long / "." / cyclic symlink chains, swap and shift layout-maps
synth() { printf '{"schema":1,"tool":"seal-baseline","objects":{"x":{"category":"t","status":"green","diagnostics":{},"files":{"%s":null}}}}\n' "$1" > "$2"; }
mkdir -p "$C/sbchain/real" "$C/sbdotfinal"; echo final > "$C/sbchain/real/final.txt"; echo dotfinal > "$C/sbdotfinal/final.txt"
ln -s real/final.txt "$C/sbchain/l1"
for n in $(seq 2 41); do ln -s "l$((n-1))" "$C/sbchain/l$n"; done
ln -s . "$C/sbdot"
G add -A; G commit -qm "synthetic chains"; B2="$(G rev-parse HEAD)"
# a chain longer than the kernel's 40 follows is refused loudly (git checkouts cannot resolve it either); 40 follows still work
synth "sbchain/l41" "$T/synth41.json"
rcis 2 "41-link symlink chain: generator refuses (rc=2)" node "$SB" build-no-rewrite --root "$C" --baseline "$T/synth41.json" --out "$T/nr41.json"
grep -q "chain longer than 40" "$T/err" && ok || bad "41-link chain: message names the 40-follow limit (stderr: $(head -2 "$T/err"))"
synth "sbchain/l40" "$T/synth40.json"
rcis 0 "40-link symlink chain: generator runs" node "$SB" build-no-rewrite --root "$C" --baseline "$T/synth40.json" --out "$T/nr41.json"
node -e 'const s=new Set(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).entries.map(e=>e.path));process.exit(s.has("sbchain/real/final.txt")&&s.has("sbchain/l40")&&s.has("sbchain/l1")?0:1)' "$T/nr41.json" && ok || bad "40-link chain: every link and the final file are listed"
rcis 0 "40-link chain untouched -> check-rewrite green" node "$SB" check-rewrite --root "$C" --range "$B2..$B2" --no-rewrite "$T/nr41.json"
printf 'x' >> "$C/sbchain/real/final.txt"; G commit -qam "edit final"
rcis 1 "40-link chain: the final file edited -> check-rewrite red" node "$SB" check-rewrite --root "$C" --range "$B2..HEAD" --no-rewrite "$T/nr41.json"
has "names the final file" "sbchain/real/final.txt: bytes changed"
G reset -q --hard "$B2"
synth "sbdot/sbdotfinal/final.txt" "$T/synthdot.json"
rcis 0 "symlink to '.': generator runs" node "$SB" build-no-rewrite --root "$C" --baseline "$T/synthdot.json" --out "$T/nrdot.json"
node -e 'const s=new Set(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).entries.map(e=>e.path));process.exit(s.has("sbdotfinal/final.txt")&&s.has("sbdot")?0:1)' "$T/nrdot.json" && ok || bad "'.' link: the final file (reached as ./sbdotfinal/final.txt) is listed"
printf 'x' >> "$C/sbdotfinal/final.txt"; G commit -qam "edit dot final"
rcis 1 "'.' link: the final file edited -> check-rewrite red" node "$SB" check-rewrite --root "$C" --range "$B2..HEAD" --no-rewrite "$T/nrdot.json"
G reset -q --hard "$B2"
# negative control: without the normalize step the '.' case loses the final file
sed 's/const next = path.posix.normalize(/const next = String(/' "$SB" > "$T/mut-norm.js"
if cmp -s "$SB" "$T/mut-norm.js"; then bad "normalize mutation did not hit"; else
  node "$T/mut-norm.js" build-no-rewrite --root "$C" --baseline "$T/synthdot.json" --out "$T/nrdot-mut.json" >/dev/null 2>&1 </dev/null
  node -e 'const s=new Set(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).entries.map(e=>e.path));process.exit(s.has("sbdotfinal/final.txt")?1:0)' "$T/nrdot-mut.json" && ok || bad "negative control: without normalize the '.' final file is still listed"
fi
ln -s cyc-b "$C/sbchain/cyc-a"; ln -s cyc-a "$C/sbchain/cyc-b"; G add -A
synth "sbchain/cyc-a/x" "$T/synthcyc.json"
rcis 2 "symlink cycle: generator fails" node "$SB" build-no-rewrite --root "$C" --baseline "$T/synthcyc.json" --out "$T/nrcyc.json"
grep -q "symlink cycle" "$T/err" && ok || bad "says it is a cycle (stderr: $(head -2 "$T/err"))"
G reset -q --hard "$B2"; G clean -qfd
# cycles whose remainder keeps growing must still end (and fast)
ln -s dd/x "$C/sbchain/dd"; ln -s bb/x "$C/sbchain/aa"; ln -s aa/y "$C/sbchain/bb"; G add -A
synth "sbchain/dd" "$T/synthdd.json"
rcis 2 "growing cycle d -> d/x: generator ends with rc=2 (not a hang)" timeout 30 node "$SB" build-no-rewrite --root "$C" --baseline "$T/synthdd.json" --out "$T/nrdd.json"
grep -q "chain longer than 40" "$T/err" && ok || bad "d -> d/x names the limit (stderr: $(head -2 "$T/err"))"
synth "sbchain/aa" "$T/synthaa.json"
rcis 2 "growing cycle a -> b/x, b -> a/y: generator ends with rc=2" timeout 30 node "$SB" build-no-rewrite --root "$C" --baseline "$T/synthaa.json" --out "$T/nraa.json"
# cv3 link probes: up / absolute / outside links are not followed out of the repo; a cycle fails
mkdir -p "$C/linktest"; echo data > "$C/linktest/final"; ln -s .. "$C/linktest/up"; ln -s /tmp/outside "$C/linktest/absolute"; ln -s ../../outside "$C/linktest/outside"; ln -s cb "$C/linktest/ca"; ln -s ca "$C/linktest/cb"; G add -A
for pair in 'up/linktest/final:0' absolute:0 outside:0 ca:2; do
  synth "linktest/${pair%%:*}" "$T/lk.json"
  rcis "${pair##*:}" "link probe linktest/${pair%%:*}" timeout 30 node "$SB" build-no-rewrite --root "$C" --baseline "$T/lk.json" --out "$T/lk-out.json"
done
G reset -q --hard "$B2"; G clean -qfd
G reset -q --hard "$BASE"

# swap (A->B, B->A) and shift (A->B, C->A) layout-maps over listed files
A=evals/consult-eval-rubric.md; B=evals/discuss-eval-rubric.md
G mv "$A" evals/swap.tmp; G mv "$B" "$A"; G mv evals/swap.tmp "$B"; G commit -qm swap
printf '{"%s":"%s","%s":"%s"}\n' "$A" "$B" "$B" "$A" > "$T/swap.json"
rcis 0 "swap of two listed files, with the swap layout-map -> green" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/swap.json"
printf 'x' >> "$C/$B"; G commit -qam "swap+edit"
rcis 1 "swap, then one of the two edited -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/swap.json"
G reset -q --hard "$BASE"
mkdir -p "$C/evals/shifted"; G mv "$A" evals/shifted/a.md; G mv "$B" "$A"; G commit -qm shift
printf '{"%s":"evals/shifted/a.md","%s":"%s"}\n' "$A" "$B" "$A" > "$T/shift.json"
rcis 0 "shift (A->B, C->A) with the shift layout-map -> green" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/shift.json"
rcis 1 "the same shift with only the first map entry -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/rw-map.json"
printf 'x' >> "$C/evals/shifted/a.md"; G commit -qam "shift+edit"
rcis 1 "shift, then the moved file edited -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/shift.json"
G reset -q --hard "$BASE"

# ---- round 4: the swap/shift exemption only covers verified moves (cv3 attacks)
DD=evals/consult-eval-rubric.seal.json
cp "$C/$A" "$C/evals/copy-new.md"; printf x >> "$C/$A"; G add -A; G commit -qm fake-shift
printf '{"%s":"evals/copy-new.md","evals/nonexistent.md":"%s"}\n' "$A" "$A" > "$T/fake.json"
rcis 1 "fake shift (nonexistent C -> A, A edited after copying it away) -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/fake.json"
G reset -q --hard "$BASE"; G clean -qfd
# C exists but is not a listed file: the exemption does not apply
mkdir -p "$C/evals/x"; echo unlisted > "$C/evals/x/unlisted.md"; G add -A; G commit -qm unlisted; BU="$(G rev-parse HEAD)"
cp "$C/$A" "$C/evals/copy-new.md"; cp "$C/evals/x/unlisted.md" "$C/$A"; G add -A; G commit -qm "shift from unlisted"
printf '{"%s":"evals/copy-new.md","evals/x/unlisted.md":"%s"}\n' "$A" "$A" > "$T/shift-unlisted.json"
rcis 1 "shift whose source C exists but is not listed -> red" node "$SB" check-rewrite --root "$C" --range "$BU..HEAD" --layout-map "$T/shift-unlisted.json"
G reset -q --hard "$BASE"; G clean -qfd
# C is listed but the bytes now at A are not C's
cp "$C/$A" "$C/evals/copy-new.md"; printf 'not C' > "$C/$A"; G add -A; G commit -qm "shift wrong bytes"
printf '{"%s":"evals/copy-new.md","%s":"%s"}\n' "$A" "$B" "$A" > "$T/shift-wrong.json"
rcis 1 "shift whose source C is listed but A holds other bytes -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/shift-wrong.json"
G reset -q --hard "$BASE"; G clean -qfd
# half swap, self map, three-cycle with an edit, collision (cv3 / cv2 probes)
cp "$C/$A" "$C/$B"; G commit -qam half-swap
rcis 1 "half swap (B overwritten with A, A unchanged) -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/swap.json"
G reset -q --hard "$BASE"
printf x >> "$C/$A"; G commit -qam identity-edit
printf '{"%s":"%s"}\n' "$A" "$A" > "$T/self.json"
rcis 1 "self map with an edit -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/self.json"
G reset -q --hard "$BASE"
cp "$C/$A" "$T/a0"; cp "$C/$B" "$C/$A"; cp "$C/$DD" "$C/$B"; cp "$T/a0" "$C/$DD"; printf x >> "$C/$DD"; G commit -qam cycle-edit
printf '{"%s":"%s","%s":"%s","%s":"%s"}\n' "$A" "$DD" "$DD" "$B" "$B" "$A" > "$T/three.json"
rcis 1 "three-cycle then an edit -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/three.json"
G reset -q --hard "$BASE"
mkdir -p "$C/evals/moved"; cp "$C/$A" "$C/evals/moved/common"; printf x >> "$C/$A"; G add -A; G commit -qm collision
printf '{"%s":"evals/moved/common","%s":"evals/moved/common"}\n' "$A" "$DD" > "$T/collision.json"
rcis 1 "two sources onto one destination -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/collision.json"
G reset -q --hard "$BASE"; G clean -qfd
G mv "$A" evals/moved-a.md; printf x >> "$C/$DD"; G commit -qam partial
printf '{"evals/":"evals/moved/"}\n' > "$T/prefix.json"
rcis 1 "directory-prefix map that does not match what moved -> red" node "$SB" check-rewrite --root "$C" --range "$BASE..HEAD" --layout-map "$T/prefix.json"
G reset -q --hard "$BASE"; G clean -qfd
# compare: the fake shift on objects
RB=docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json
mkdir -p "$C/evidence/q"; cp "$C/$RB" "$C/evidence/q/platform-capabilities.json"; printf ' ' >> "$C/$RB"; G add -A
rec "$T/cur.json"
printf '{"%s":"evidence/q/platform-capabilities.json","docs/plans/evidence/nonexistent/platform-capabilities.json":"%s"}\n' "$RB" "$RB" > "$T/cfake.json"
rcis 1 "compare: fake shift of an object (nonexistent source, original edited) -> red" cmpr --layout-map "$T/cfake.json"
reset

# compare: a shift of whole objects is verified as a group (status, diagnostics, every file fingerprint after the map)
H1=1111111111111111111111111111111111111111111111111111111111111111; H2=2222222222222222222222222222222222222222222222222222222222222222
H3=3333333333333333333333333333333333333333333333333333333333333333; H4=4444444444444444444444444444444444444444444444444444444444444444
objs() { printf '{"schema":1,"tool":"seal-baseline","objects":{%s}}\n' "$1"; }
ob() { printf '"%s":{"category":"t","status":"green","diagnostics":{},"files":{%s}}' "$1" "$2"; }
objs "$(ob a/obj "\"a/obj\":\"$H1\"")","$(ob b/obj "\"b/obj\":\"$H3\",\"b/ref\":\"$H4\"")" > "$T/gb.json"
printf '{"a/obj":"c/obj","b/obj":"a/obj","b/ref":"a/ref"}\n' > "$T/gmap.json"
gcmp() { node "$SB" compare --baseline "$T/gb.json" --current "$T/gc.json" --layout-map "$T/gmap.json"; }
objs "$(ob c/obj "\"c/obj\":\"$H1\"")","$(ob a/obj "\"a/obj\":\"$H3\",\"a/ref\":\"$H4\"")" > "$T/gc.json"
rcis 0 "compare: legit shift of whole objects (main file and reference both moved) -> green" gcmp
objs "$(ob c/obj "\"c/obj\":\"$H1\"")","$(ob a/obj "\"a/obj\":\"$H3\",\"b/ref\":\"$H4\"")" > "$T/gc.json"
rcis 1 "compare: shift moves only the main file, the reference stays at the old path -> red" gcmp
objs "$(ob c/obj "\"c/obj\":\"$H1\"")","$(ob a/obj "\"a/obj\":\"$H3\",\"a/ref\":\"$H2\"")" > "$T/gc.json"
rcis 1 "compare: shift where one reference file's bytes changed -> red" gcmp
objs "$(ob c/obj "\"c/obj\":\"$H1\"")","$(ob a/obj "\"a/obj\":\"$H2\",\"a/ref\":\"$H4\"")" > "$T/gc.json"
rcis 1 "compare: shift where the main file's bytes changed -> red" gcmp

# ---- recorder: a sources manifest's plan_path / rubric_path are relative to the REGISTRY's base for that manifest, not to the
# manifest's own directory (D9.2; after P1 the manifests sit in project/missions/ while their base is project/)
node "$C/scripts/lib/repo-layout.js" --json > "$T/reg0.json" </dev/null
node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));r.paths.manifest_plan_base="docs/plans";fs.writeFileSync(process.argv[2],JSON.stringify(r));' "$T/reg0.json" "$T/reg-base.json"
recbase() { REPO_LAYOUT_REGISTRY="$T/reg-base.json" node "${1:-$SB}" record --root "$C" --out "$T/rb.json" </dev/null >"$T/rec.out" 2>"$T/rec.err"; }
refsbased() { node -e '
const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).objects;
const g=o["project/missions/mission-backlog-bc-execution-graph.json"];const f=Object.keys(g.files);
const want="docs/plans/plans/2026-07-31-correctness-gates.md";   // base docs/plans + plan_path plans/<stem>.md
process.exit(f.includes(want)&&!f.includes("project/plans/2026-07-31-correctness-gates.md")?0:1)' "$T/rb.json"; }
recbase && refsbased && ok || bad "recorder hashes plan_path under the registry base (graph and plan in different directories)"
# negative control: the old recorder (plan_path joined to the manifest's directory) must fail the same assertion
sed 's#path.posix.join(base, s\[k\])#path.posix.join(dir, s[k])#' "$SB" > "$T/sb-old.js"
cmp -s "$SB" "$T/sb-old.js" && bad "negative control: the mutation did not change the tool"
recbase "$T/sb-old.js"; if refsbased; then bad "negative control: old join(dir, plan_path) recorder must NOT satisfy the registry-base assertion"; else ok; fi
recbase && refsbased && ok || bad "after restoring the recorder the registry-base assertion is green again"

# ---- input errors
rcis 2 "no subcommand" node "$SB"
rcis 2 "compare without --baseline" node "$SB" compare --current "$T/cur.json"
rcis 2 "check-rewrite without --range or --files" node "$SB" check-rewrite --root "$C"
rcis 2 "check-rewrite with an unknown commit" node "$SB" check-rewrite --root "$C" --range "deadbeefdeadbeef..HEAD"
echo '{' > "$T/broken.json"
rcis 2 "compare with a broken baseline" node "$SB" compare --baseline "$T/broken.json" --current "$T/cur.json"

echo "seal-baseline: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || fail "$FAIL seal-baseline assertion(s) failed"
finalize_test
