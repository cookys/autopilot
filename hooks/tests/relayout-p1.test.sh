#!/usr/bin/env bash
# relayout-p1.test.sh -- tools/migrate/relayout-p1.js, the P1 docs-split generator, dry run only (3.0.0 relayout, section 3 P1, F2).
# `plan` is read-only, so the real-repo scenarios run against this checkout; every scenario that needs a changed registry, a mutated
# copy of the tool or a different tree uses a throwaway copy under TEST_TMP. Negative controls are shown red first, green after.
# RELAYOUT_P1_JS may point at a mutated copy of the tool (the scenarios below do exactly that).
. "$(dirname "$0")/lib.sh"
RP="${RELAYOUT_P1_JS:-$REPO_ROOT/tools/migrate/relayout-p1.js}"
T="$TEST_TMP"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
rcis() { local want="$1" label="$2"; shift 2; "$@" >"$T/out" 2>"$T/err" </dev/null; local rc=$?; if [ "$rc" = "$want" ]; then ok; else bad "$label (rc=$rc want=$want)"; sed 's/^/    /' "$T/out" "$T/err" | head -6; fi; }
has() { if grep -q -- "$2" "$T/out"; then ok; else bad "$1 (no '$2' in output)"; sed 's/^/    /' "$T/out" | head -6; fi; }
js() { node -e "$1" "${@:2}" && ok || bad "$3"; }

# ---- the real repo: plan writes four files, a one-to-one map, no internal problems
# The dry run and apply are about the PRE-move tree, so the real-repo scenarios run on a clone of the pre-move commit (the repo itself
# is at stage P1 once apply has landed). No such commit in this checkout (e.g. a shallow clone): the scenarios are skipped, not passed.
BASE_SHA=20eb8296f
BR="$T/base"
if git -C "$REPO_ROOT" cat-file -e "$BASE_SHA^{commit}" 2>/dev/null; then
  git clone -q --shared --no-checkout "$REPO_ROOT" "$BR" 2>/dev/null && git -C "$BR" checkout -q --detach "$BASE_SHA" || { echo "FAIL: cannot build the pre-move clone"; exit 1; }
else
  echo "SKIP: pre-move commit $BASE_SHA is not in this checkout; only the fixture scenarios run"; BR=""
fi
if [ -n "$BR" ]; then
O="$T/o"
rcis 0 "plan on the real repo" node "$RP" plan --root "$BR" --out-dir "$O"
for f in layout-map.json plan.json summary.md by-target.txt; do [ -s "$O/$f" ] && ok || bad "plan wrote $f"; done
node -e '
const fs=require("fs"),cp=require("child_process");const O=process.argv[1],R=process.argv[2];
const map=JSON.parse(fs.readFileSync(O+"/layout-map.json","utf8"));const plan=JSON.parse(fs.readFileSync(O+"/plan.json","utf8"));
const tracked=new Set(cp.execFileSync("git",["-C",R,"ls-files","-z"],{encoding:"utf8",maxBuffer:256<<20}).split("\0").filter(Boolean));
const e=(c,m)=>{if(!c){console.log("BAD "+m);process.exit(1)}};
const vals=Object.values(map);
e(vals.length===new Set(vals).size,"layout-map is injective");
e(Object.keys(map).every((k)=>tracked.has(k)),"every layout-map key is a tracked file");
e(vals.every((v)=>!tracked.has(v)),"no destination is already tracked");
e(plan.problems.length===0,"no internal problems");
e(plan.renames===vals.length,"renames count equals map size");
e(!Object.keys(map).some((k)=>k.startsWith("docs/plans/evidence/")),"P1 does not move docs/plans/evidence (P2)");
e(!("docs/scripts-inventory.md" in map),"F5: scripts-inventory.md stays");
e(!Object.keys(map).some((k)=>/blind-review-2d-(snapshot|overlap)/.test(k)),"D9.5: the six blind-review-2d files stay while the mission is routed");
e(plan.registry_changes.exceptions_add.length===8&&plan.registry_changes.exceptions_add.every((x)=>x.rule>=6&&x.reason),"D9.5 six + D10 two exceptions, each with a reason");
e(plan.registry_changes.exceptions_add.some((x)=>/surface-lines/.test(x.path))&&plan.registry_changes.exceptions_add.some((x)=>/platform-capabilities\.json$/.test(x.path)),"D10: surface-lines.json and the D9.7 receipt stay by exception");
e(plan.registry_changes.exceptions_add.filter((x)=>x.plan_base==="docs").length===1,"plan_base docs only on the sources manifest");
e(map["docs/plans/2026-08-04-platform-capability-trigger-activation.md"]==="project/plans/2026-08-04-platform-capability-trigger-activation.md","D9.4: the capability plan lands in project/plans (not archived)");
e(plan.no_rewrite.d94.listed,"D9.4 plan is on the no-rewrite list");
e(plan.registry_changes.tools_allowlist.value.join()==="migrate","F2: tools/ allows migrate/ only");
e(plan.registry_changes.paths.every((p)=>p.check==="ok"),"registry path keys agree with the layout-map");
e(plan.registry_changes.paths.some((p)=>p.key==="manifest_plan_base"&&p.to==="project")&&plan.registry_changes.paths.some((p)=>p.key==="missions_dir"&&p.to==="project/missions"),"manifest_plan_base and missions_dir");
e(plan.residual_lint.destinations_flagged_by_an_active_rule.length===0,"no destination is claimed by an active rule");
e(plan.pending.files.length===0,"D10 settled the four unclassified files");
e(map["docs/review-candidate.md"]==="docs/guide/review-candidate.md"&&map["docs/COEXISTENCE-fable5.md"]==="project/handoff/COEXISTENCE-fable5.md"&&!("docs/training/README.md" in map),"D10.1: review-candidate to guide, COEXISTENCE to handoff, training/README.md deleted not moved");
e(!Object.keys(map).some((k)=>/\/_archive\/.+\/evidence\//.test(k)),"D10.3: archived evidence is left for P2");
e(map["docs/HANDOFF.md"]==="project/handoff/HANDOFF.md"&&map["docs/projects/ongoing-maintenance/HANDOFF.md"]==="project/handoff/HANDOFF-ongoing-maintenance.md","HANDOFF: two plain renames, merged later in the content phase");
e(Object.values(map).every((v)=>/^(project|docs\/(guide|dev))\//.test(v)),"every destination is project/ or docs/guide|dev/");
' "$O" "$BR" && ok || bad "plan output invariants"

# ---- the dry run changed nothing
[ -z "$(git -C "$BR" status --porcelain -- docs project 2>/dev/null)" ] && ok || bad "plan left docs/ or project/ untouched"

# ---- F2: one plan md and one handoff md must both classify to project/
rcis 0 "check-f2 on the real registry" node "$RP" check-f2 --root "$BR"
has "plan md goes to project/" "plans/2026-10.*-> project/plans/.* ok"
has "handoff md goes to project/" "HANDOFF.md -> project/handoff/HANDOFF.md ok"

# negative control 1: the registry with rules #6 and #7 swapped (reader docs first, the pre-F2 order)
node "$BR/scripts/lib/repo-layout.js" --json > "$T/reg.json" </dev/null
node -e '
const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const i=r.rules.findIndex((x)=>x.name==="work-records"),j=r.rules.findIndex((x)=>x.name==="reader-docs");
if(i<0||j<0||i>j){console.log("unexpected registry order");process.exit(1)}
[r.rules[i],r.rules[j]]=[r.rules[j],r.rules[i]];fs.writeFileSync(process.argv[2],JSON.stringify(r));' "$T/reg.json" "$T/reg-swapped.json" && ok || bad "built the swapped registry"
rcis 1 "check-f2 with rules 6 and 7 swapped is RED" node "$RP" check-f2 --root "$BR" --registry "$T/reg-swapped.json"
has "swapped registry: plan md no longer in project/" "plan md.*FAIL"
rcis 0 "check-f2 with the registry restored is green again" node "$RP" check-f2 --root "$BR" --registry "$T/reg.json"

# negative control 2: the classifier itself broken (a mutated copy of the tool)
sed 's#`project/plans/${name}`#`docs/dev/plans/${name}`#g' "$RP" > "$T/rp-mut-plan.js"
cmp -s "$RP" "$T/rp-mut-plan.js" && bad "plan mutation did not change the tool"
rcis 1 "check-f2 with plans routed to docs/dev is RED" node "$T/rp-mut-plan.js" check-f2 --root "$BR"
sed "s#'project/handoff/HANDOFF.md'#'docs/dev/HANDOFF.md'#" "$RP" > "$T/rp-mut-handoff.js"
cmp -s "$RP" "$T/rp-mut-handoff.js" && bad "handoff mutation did not change the tool"
rcis 1 "check-f2 with handoff routed to docs/dev is RED" node "$T/rp-mut-handoff.js" check-f2 --root "$BR"

# ---- classification of single files (never guesses)
node "$RP" classify --root "$BR" docs/COEXISTENCE-fable5.md docs/metrics/surface-lines.json docs/review-candidate.md docs/training/README.md docs/HANDOFF.md docs/installation.md docs/adr/0001-verification-over-attestation.md docs/BACKLOG.md > "$T/out" 2>"$T/err" </dev/null
has "COEXISTENCE goes to handoff" "COEXISTENCE-fable5.md.handoff-other.project/handoff/COEXISTENCE-fable5.md"
has "surface-lines.json stays by exception" "surface-lines.json.exception-stay"
has "review-candidate is a guide doc" "review-candidate.md.guide.docs/guide/review-candidate.md"
has "training tombstone is deleted" "training/README.md.delete"
has "guide doc" "installation.md.guide.docs/guide/installation.md"
has "adr goes to docs/dev/adr" "adr/0001.*docs/dev/adr/0001"
has "backlog goes under project/backlog" "BACKLOG.md.backlog-main.project/backlog/BACKLOG.md"

# ---- apply is only an interface stub this round
rcis 2 "apply without a phase" node "$RP" apply --root "$BR"
rcis 2 "no subcommand" node "$RP"
rcis 2 "bad --archived-evidence" node "$RP" plan --root "$BR" --archived-evidence maybe

# ---- the move, simulated in a throwaway clone: renames only, every no-rewrite file keeps its bytes
rcis 0 "plan --simulate" node "$RP" plan --root "$BR" --simulate --out-dir "$T/o2"
js 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=p.simulation;if(!s||s.length!==2||s.some((x)=>x.rc!==0)){console.log(JSON.stringify(s));process.exit(1)}' "$T/o2/plan.json" "simulated renames keep every no-rewrite file byte-identical (rc 0 twice)"


# ---- apply on a throwaway clone of the pre-move tree
AP="$T/ap"; git clone -q --shared "$BR" "$AP" 2>/dev/null
G() { git -C "$AP" -c user.email=t@t -c user.name=t "$@"; }
node "$RP" apply --phase rename --root "$AP" --log "$T/ap-rename.json" >"$T/out" 2>"$T/err" </dev/null; rc=$?
[ "$rc" = 0 ] && ok || { bad "apply --phase rename (rc=$rc)"; sed 's/^/    /' "$T/err" | head -5; }
[ "$(node "$AP/scripts/lib/repo-layout.js" stage)" = "P1" ] && ok || bad "rename patches the registry to stage P1"
G diff --cached -M --name-status > "$T/ns.txt"
node -e '
const L=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map((l)=>l.split("\t"));
const bad=L.filter((x)=>!(x[0]==="R100")&&!(x[0]==="M"&&x[1]==="scripts/lib/repo-layout.js"));
if(bad.length){console.log(bad.slice(0,5).join("|"));process.exit(1)}' "$T/ns.txt" && ok || bad "the rename commit content is 100% renames plus the registry"
node "$RP" apply --phase rename --root "$AP" </dev/null >/dev/null 2>"$T/err"; [ "$?" = 2 ] && ok || bad "a second rename on a P1 tree is refused (exit 2)"
# the registry the rename produced is sound and knows the project/ top dir
node -e 'const l=require(process.argv[1]);const r=l.load();const e=l.validate(r);if(e.length||!r.allowlists.top_dirs.some((d)=>d.name==="project")||r.paths.manifest_plan_base!=="project"||r.paths.missions_dir!=="project/missions"){console.log(e.join(";"));process.exit(1)}' "$AP/scripts/lib/repo-layout.js" && ok || bad "patched registry validates, has project/, manifest_plan_base=project, missions_dir=project/missions"
# docs-side rewrite: sealed files keep their bytes; an exact key in an unsealed doc is rewritten
G commit -q -m renames
node "$RP" apply --phase refs-docs --root "$AP" --layout-map "$O/layout-map.json" --log "$T/ap-docs.json" >"$T/out" 2>"$T/err" </dev/null && ok || bad "apply --phase refs-docs"
if [ -n "$(G diff --name-only -- 'project/missions' 'docs/mission-blind-review-2d-snapshot-2026-09-19-sources.json' '.claude/mission-routing-config.json')" ]; then bad "sealed mission json, the D9.5 files and the routing config keep their bytes"; else ok; fi
node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!(l.token_replacements>0&&l.skipped_sealed>0))process.exit(1)' "$T/ap-docs.json" && ok || bad "refs-docs rewrote tokens and skipped sealed files"
# negative control: a rewriter that no longer honours the sealed list DOES change sealed bytes
sed 's#if (sealedOld.has(old)) {#if (false) {#' "$RP" > "$T/rp-mut-sealed.js"
cmp -s "$RP" "$T/rp-mut-sealed.js" && bad "sealed-skip mutation did not change the tool"
G checkout -q -- . ; G clean -qfd
node "$T/rp-mut-sealed.js" apply --phase refs-docs --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>&1
if [ -n "$(G diff --name-only -- 'project/missions')" ]; then ok; else bad "negative control: without the sealed skip, sealed mission json must change"; fi
G checkout -q -- . ; G clean -qfd
# content phase
node "$RP" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>"$T/err" && ok || bad "apply --phase content"
[ -s "$AP/docs/README.md" ] && [ ! -e "$AP/docs/training/README.md" ] && [ ! -e "$AP/project/handoff/HANDOFF-ongoing-maintenance.md" ] && grep -q "Ongoing maintenance" "$AP/project/handoff/HANDOFF.md" && ok || bad "content phase: docs/README.md created, tombstone deleted, HANDOFF merged"
fi

# ---- archive decision on a tiny fixture: shipped -> archive; in-flight, unregistered and manifest-pinned -> stay active
F="$T/fx"; mkdir -p "$F/scripts/lib" "$F/docs/plans" "$F/docs/projects/ongoing-maintenance" "$F/docs/backlog" "$F/tools/migrate"
cp "$REPO_ROOT/scripts/lib/repo-layout.js" "$F/scripts/lib/"
for s in 2026-07-01-shipped 2026-07-02-inflight 2026-07-03-pinned 2026-07-04-norow 2026-10-05-current; do echo "# $s" > "$F/docs/plans/$s.md"; done
echo "# shipped rubric" > "$F/docs/plans/2026-07-01-shipped.rubric.md"
echo '{"schema_version":1,"sources":[{"plan_path":"plans/2026-07-03-pinned.md","rubric_path":"plans/2026-07-03-pinned.md"}]}' > "$F/docs/mission-pinned-sources.json"
echo "# HANDOFF a" > "$F/docs/HANDOFF.md"; echo "# HANDOFF b" > "$F/docs/projects/ongoing-maintenance/HANDOFF.md"
echo "x" > "$F/docs/backlog/note.md"; echo "# i" > "$F/docs/installation.md"; echo "# r" > "$F/docs/unknown-reader-doc.md"
cat > "$F/docs/projects/INDEX.md" <<'IDX'
# Index

## 進行中 (In Progress)

| Date | Project |
|---|---|
| 2026-10-05 | [current](../plans/2026-10-05-current.md) |

## 已完成 (Completed)

| Date | Project |
|---|---|
| 2026-07-01 | [shipped](../plans/2026-07-01-shipped.md) |
| 2026-07-03 | [pinned](../plans/2026-07-03-pinned.md) |

## 規劃中 (Drafted)

| Plan | Status |
|---|---|
| [inflight](../plans/2026-07-02-inflight.md) | R0 |
IDX
echo '{"entries":[]}' > "$F/tools/migrate/no-rewrite.json"
git -C "$F" init -q && git -C "$F" add -A && git -C "$F" -c user.email=t@t -c user.name=t commit -q -m fx
node "$RP" classify --root "$F" docs/plans/2026-07-01-shipped.md docs/plans/2026-07-01-shipped.rubric.md docs/plans/2026-07-02-inflight.md docs/plans/2026-07-03-pinned.md docs/plans/2026-07-04-norow.md docs/plans/2026-10-05-current.md docs/unknown-reader-doc.md docs/HANDOFF.md docs/projects/ongoing-maintenance/HANDOFF.md > "$T/out" 2>"$T/err" </dev/null
has "shipped pre-September plan is archived" "2026-07-01-shipped.md.plan-archived-now.project/plans/_archive/2026/07/2026-07-01-shipped.md"
has "its sidecar follows it" "shipped.rubric.md.plan-archived-now.project/plans/_archive/2026/07/"
has "in-flight plan is not archived" "2026-07-02-inflight.md.plan-pre-sept-not-archived.project/plans/2026-07-02-inflight.md"
has "manifest-pinned plan is not archived" "2026-07-03-pinned.md.plan-pre-sept-not-archived.project/plans/2026-07-03-pinned.md"
has "plan without an INDEX row is not archived" "2026-07-04-norow.md.plan-pre-sept-not-archived"
has "current plan stays active" "2026-10-05-current.md.plan-active.project/plans/2026-10-05-current.md"
has "unknown reader doc is pending, not guessed" "unknown-reader-doc.md.pending"
has "both HANDOFF.md merge into one target" "HANDOFF.md.handoff.project/handoff/HANDOFF.md"
# negative control: delete the INDEX row of the shipped plan -> it must no longer be archived
sed -i '/shipped\](/d' "$F/docs/projects/INDEX.md"
node "$RP" classify --root "$F" docs/plans/2026-07-01-shipped.md > "$T/out" 2>"$T/err" </dev/null
if grep -q "plan-archived-now" "$T/out"; then bad "a plan with no INDEX row must not be archived"; else ok; fi
has "without its row it stays active" "plan-pre-sept-not-archived"

echo "relayout-p1: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
