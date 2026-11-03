#!/usr/bin/env bash
# relayout-p1.test.sh -- tools/migrate/relayout-p1.js, the P1 docs-split generator: the dry run, and apply on throwaway clones (3.0.0 relayout, section 3 P1, F2).
# `plan` is read-only; every scenario that needs a changed registry, a mutated
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

# ---- which tree is this? The tool itself decides: `apply --phase rename` expects a bootstrap registry and refuses (rc 2, "registry stage is X; rename
# expects bootstrap") on anything else. The probe runs it in a throwaway shared clone of HEAD, so a bootstrap tree is migrated THERE and nowhere else.
# 0 = migrated (the tool refused), 1 = not migrated (the tool applied), 2 = the probe itself failed.
tree_migrated() {
  local d rc; d="$(mktemp -d "$T/probe.XXXXXX")" || return 2
  git clone -q --shared --no-checkout "$1" "$d/c" 2>/dev/null && git -C "$d/c" checkout -q --detach HEAD 2>/dev/null || return 2
  node "$REPO_ROOT/tools/migrate/relayout-p1.js" apply --phase rename --root "$d/c" </dev/null >"$d/out" 2>"$d/err"; rc=$?
  PROBE_CLONE="$d/c"
  [ "$rc" = 0 ] && return 1
  [ "$rc" = 2 ] && grep -q "registry stage is .*; rename expects bootstrap" "$d/err" && return 0
  sed 's/^/    /' "$d/err" | head -5; return 2
}
if [ "${RELAYOUT_P1_MODE_PROBE:-1}" = 1 ]; then
  tree_migrated "$REPO_ROOT"; MODE_RC=$?
  [ "$MODE_RC" = 2 ] && { echo "FAIL: cannot tell whether this tree is migrated"; exit 1; }
  if [ "$MODE_RC" = 0 ]; then
    # migrated tree (P1 landed): the full pre-move scenarios below only make sense on a bootstrap tree. Here: the tool recognises the state, and the layout is lint-clean.
    echo "relayout-p1: this tree is already migrated (registry stage is not bootstrap); the full pre-move test runs only on an unmigrated tree, so only the migrated-tree checks run here"
    M="$PROBE_CLONE"
    node "$RP" apply --phase rename --root "$M" >"$T/out" 2>"$T/err" </dev/null; rc=$?
    if [ "$rc" = 2 ] && grep -q "rename expects bootstrap" "$T/err"; then ok; else bad "apply --phase rename on a migrated tree is refused with a clear message (rc=$rc)"; fi
    if [ -z "$(git -C "$M" status --porcelain)" ]; then ok; else bad "the refused apply left the tree untouched"; fi
    node "$REPO_ROOT/scripts/layout-lint.js" --repo-root "$M" >"$T/out" 2>"$T/err" </dev/null; rc=$?
    if [ "$rc" = 0 ]; then ok; else bad "layout-lint is clean on the migrated tree (rc=$rc)"; sed 's/^/    /' "$T/out" | head -5; fi
    # negative control: a work record left in docs/ must turn the lint red
    mkdir -p "$M/docs/plans"; echo x > "$M/docs/plans/2099-01-01-zz-stray.md"; git -C "$M" add -f docs/plans/2099-01-01-zz-stray.md
    node "$REPO_ROOT/scripts/layout-lint.js" --repo-root "$M" >"$T/out" 2>"$T/err" </dev/null; rc=$?
    if [ "$rc" = 1 ]; then ok; else bad "negative control: a stray tracked work record in docs/plans must fail the lint (rc=$rc)"; fi
    # negative control: a bootstrap tree must NOT be taken for migrated (the full test would be skipped on the tree it is for)
    if git -C "$REPO_ROOT" cat-file -e "e89d36e1a^{commit}" 2>/dev/null; then
      B0="$T/bootstrap-src"; git clone -q --shared --no-checkout "$REPO_ROOT" "$B0" 2>/dev/null && git -C "$B0" checkout -q --detach e89d36e1a
      tree_migrated "$B0"; if [ "$?" = 1 ]; then ok; else bad "negative control: a bootstrap tree is recognised as not migrated"; fi
    else echo "SKIP: pre-move commit e89d36e1a not in this checkout; the bootstrap-not-migrated control did not run"; fi
    echo "relayout-p1: $PASS passed, $FAIL failed"
    [ "$FAIL" = 0 ]; exit $?
  fi
fi

# ---- the real repo: plan writes four files, a one-to-one map, no internal problems
# The dry run and apply are about the PRE-move tree, so the real-repo scenarios run on a clone of the pre-move commit (the repo itself
# is at stage P1 once apply has landed). No such commit in this checkout (e.g. a shallow clone): the scenarios are skipped, not passed.
BASE_SHA=e89d36e1a
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
e(!Object.keys(map).some((k)=>/routing-successor/.test(k)),"D9.5: the four routing-successor files stay while the mission is routed to them")&&e(Object.keys(map).filter((k)=>/blind-review-2d-(snapshot|overlap)/.test(k)).length===6,"D9.5: the old 2-D snapshot graph is no longer routed, so its six files move by the ordinary rule");
e(plan.registry_changes.exceptions_add.length===6&&plan.registry_changes.exceptions_add.every((x)=>x.rule>=6&&x.reason),"D9.5 four routing-successor + D10 two exceptions, each with a reason");
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

# ---- apply: bad input is refused (exit 2)
rcis 2 "apply without a phase" node "$RP" apply --root "$BR"
rcis 2 "apply with an unknown phase" node "$RP" apply --phase nonsense --root "$BR"
rcis 2 "no subcommand" node "$RP"
rcis 2 "bad --archived-evidence" node "$RP" plan --root "$BR" --archived-evidence maybe

# ---- the move, simulated in a throwaway clone: renames only, every no-rewrite file keeps its bytes
rcis 0 "plan --simulate" node "$RP" plan --root "$BR" --simulate --out-dir "$T/o2"
js 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=p.simulation;if(!s||s.length!==2||s.some((x)=>x.rc!==0)){console.log(JSON.stringify(s));process.exit(1)}' "$T/o2/plan.json" "simulated renames keep every no-rewrite file byte-identical (rc 0 twice)"


# ---- rename checks every precondition before its first write: a missing source or a registry patch that does not apply leaves the tree exactly as it was.
# Each case is shown red with the check removed (the tree is half moved) and green with it restored.
rename_case() {  # <name> <tool> <missing|drift> -> 0 when the run was refused (rc 2) and nothing in the tree changed
  local d="$T/rn-$1"; rm -rf "$d"; git clone -q --shared "$BR" "$d" 2>/dev/null
  case "$3" in
    missing) rm "$d/docs/BACKLOG.md" ;;
    drift) sed -i "s#^  stage: 'bootstrap',#  stage:  'bootstrap',#" "$d/scripts/lib/repo-layout.js" ;;
  esac
  git -C "$d" status --porcelain > "$T/rn-before.txt"; sha256sum "$d/scripts/lib/repo-layout.js" > "$T/rn-before.sha"
  node "$2" apply --phase rename --root "$d" >/dev/null 2>"$T/err" </dev/null; local rc=$?
  git -C "$d" status --porcelain > "$T/rn-after.txt"; sha256sum "$d/scripts/lib/repo-layout.js" > "$T/rn-after.sha"
  [ "$rc" = 2 ] && cmp -s "$T/rn-before.txt" "$T/rn-after.txt" && cmp -s "$T/rn-before.sha" "$T/rn-after.sha" && [ ! -e "$d/project" ]
}
# the cases dirty the clone on purpose (a deleted file, a drifted registry), which the driver's clean-tree rule would refuse first and its rollback would
# undo afterwards: run them with both off, so what is measured is the phase's own precondition check
sed -e 's#if (dirty.length) throw#if (false) throw#' -e 's#if (!done) guard.restore();#if (false) guard.restore();#' "$RP" > "$T/rp-nodirty.js"
cmp -s "$RP" "$T/rp-nodirty.js" && bad "clean-tree and rollback mutation did not change the tool"
rename_case miss-real "$T/rp-nodirty.js" missing && ok || bad "rename with a missing source is refused and the tree is unchanged"
rename_case drift-real "$T/rp-nodirty.js" drift && ok || bad "rename with a registry patch that does not apply is refused and the tree is unchanged"
sed 's#if (missing.length) throw#if (false) throw#' "$T/rp-nodirty.js" > "$T/rp-mut-missing.js"
cmp -s "$T/rp-nodirty.js" "$T/rp-mut-missing.js" && bad "missing-source mutation did not change the tool"
rename_case miss-mut "$T/rp-mut-missing.js" missing && bad "negative control: without the missing-source check the tree must end up half moved" || ok
sed 's#if (n !== 1) throw new InputError(`registry patch#if (false) throw new InputError(`registry patch#' "$T/rp-nodirty.js" > "$T/rp-mut-drift.js"
cmp -s "$T/rp-nodirty.js" "$T/rp-mut-drift.js" && bad "registry-patch mutation did not change the tool"
rename_case drift-mut "$T/rp-mut-drift.js" drift && bad "negative control: without the registry preflight the tree must end up half moved" || ok

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
# ---- refs-code skip rules, each with a negative control: the invariants hold with the real tool and break with the rule removed
mkdir -p "$AP/hooks/tests"
cat > "$AP/hooks/tests/zz-relayout-fixture.test.sh" <<'FX'
a1='docs/BACKLOG.md'
a2="$REPO_ROOT/docs/BACKLOG.md"
a3="$d/docs/installation.md"
a4='docs/installation.md'
a5="${REPO_ROOT}/docs/installation.md"
FX
# one carrier file per hash-pinned class (O8, O8-ext, O9, O12), listed as excluded in no-rewrite.json and holding a rewritable key
for c in O8 O8-ext O9 O12; do printf '// see docs/installation.md\n' > "$AP/scripts/zz-pin-$c.js"; done
node -e '
const fs=require("fs");const f=process.argv[1]+"/tools/migrate/no-rewrite.json";const j=JSON.parse(fs.readFileSync(f,"utf8"));
for(const c of ["O8","O8-ext","O9","O12"])j.excluded.push({path:"scripts/zz-pin-"+c+".js",class:c,reason:"test carrier"});
fs.writeFileSync(f,JSON.stringify(j,null,1)+"\n");' "$AP"
mkdir -p "$AP/references"
printf '%s\n' 'branch: https://github.com/cookys/autopilot/blob/develop/docs/installation.md' 'pinned: https://github.com/cookys/autopilot/blob/0123abcd/docs/installation.md' > "$AP/references/zz-url.md"
printf '%s\n' 'see docs/plans/_archive/2026/08/evidence/zz/e.md' > "$AP/references/zz-ev.md"
mkdir -p "$AP/project/plans/_archive/2026/08/evidence/zz"; echo e > "$AP/project/plans/_archive/2026/08/evidence/zz/e.md"
printf '%s\n' 'see docs/zz-gone.md' > "$AP/references/zz-miss.md"
printf '%s\n' 'see docs/plans/_archive/2026/08/evidence/zz/e.md' > "$AP/project/zz-ev-docs.md"
node -e '
const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1]+"/layout-map.json","utf8"));
m["docs/plans/_archive/2026/08/evidence/zz/e.md"]="project/plans/_archive/2026/08/evidence/zz/e.md";fs.writeFileSync(process.argv[1]+"/layout-map-ev.json",JSON.stringify(m));
delete m["docs/plans/_archive/2026/08/evidence/zz/e.md"];m["docs/zz-gone.md"]="project/zz-no-such-target.md";fs.writeFileSync(process.argv[1]+"/layout-map-miss.json",JSON.stringify(m));' "$O"
G add hooks/tests/zz-relayout-fixture.test.sh scripts tools references project; G commit -q -m fixture
SKILLF=references/knowledge-routing.md   # a consumer-convention sentence naming docs/BACKLOG.md (what the generic skip protects)
[ -n "$SKILLF" ] && ok || bad "a skills file naming docs/BACKLOG.md exists in the clone"
refs_code_state() {  # <tool> -> 0 when every skip rule held; prints what broke
  G checkout -q -- . ; G clean -qfd
  node "$1" apply --phase refs-code --root "$AP" --layout-map "$O/layout-map-ev.json" --log "$T/rc.json" >/dev/null 2>"$T/err" </dev/null || { echo "tool failed"; return 2; }
  local f="$AP/hooks/tests/zz-relayout-fixture.test.sh" b=0
  grep -q "^a1='docs/BACKLOG.md'" "$f" && grep -q '^a3="$d/docs/installation.md"' "$f" && grep -q "^a4='docs/installation.md'" "$f" || { echo "fixture path rewritten in a test file"; b=1; }
  grep -q '^a2="$REPO_ROOT/project/backlog/BACKLOG.md"' "$f" && grep -q '^a5="${REPO_ROOT}/docs/guide/installation.md"' "$f" || { echo "repo-root path not rewritten in a test file"; b=1; }
  grep -q 'docs/BACKLOG.md' "$AP/$SKILLF" || { echo "generic convention in a skill rewritten"; b=1; }
  grep -q 'blob/develop/docs/guide/installation.md' "$AP/references/zz-url.md" || { echo "github branch link not followed"; b=1; }
  grep -q 'blob/0123abcd/docs/installation.md' "$AP/references/zz-url.md" || { echo "github pinned link rewritten"; b=1; }
  grep -q '(../project/backlog/BACKLOG.md)' "$AP/references/hetero-dispatch.md" || { echo "this-repo generic line not rewritten"; b=1; }
  grep -q 'docs/BACKLOG.md' "$AP/references/knowledge-routing.md" || { echo "consumer generic line in a reference rewritten"; b=1; }
  grep -q 'docs/HANDOFF.md' "$AP/hooks/README.md" || { echo "kept-docs line rewritten"; b=1; }
  grep -q 'docs/plans/_archive/2026/08/evidence/zz/e.md' "$AP/references/zz-ev.md" || { echo "evidence path rewritten"; b=1; }
  grep -q 'docs/BACKLOG.md' "$AP/scripts/next-pick.js" || { echo "generic convention in a consumer script rewritten"; b=1; }
  grep -q 'project/backlog/BACKLOG.md' "$AP/skills/l5/references/hetero-impl-loop.md" || { echo "reviewed this-repo line dropped from the list"; b=1; }
  grep -q 'project/backlog/BACKLOG.md' "$AP/scripts/sync-manifest.json" || { echo "this-repo file class not rewritten"; b=1; }
  grep -q 'docs/projects/INDEX.md' "$AP/scripts/dispatch-plan-review.js" || { echo "generic convention in a consumer-facing script rewritten"; b=1; }
  node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).skipped_generic_convention>0?0:1)' "$T/rc.json" || { echo "no generic key skipped"; b=1; }
  for c in O8 O8-ext O9 O12; do G diff --quiet -- "scripts/zz-pin-$c.js" || { echo "pinned class $c rewritten"; b=1; }; done
  node -e 'const j=require(process.argv[1]+"/tools/migrate/no-rewrite.json");console.log(j.excluded.filter((e)=>/^(O8|O8-ext|O9|O12)$/.test(e.class)).map((e)=>e.path).join("\n"))' "$AP" > "$T/pinned.txt"
  while read -r pf; do [ -z "$pf" ] || [ ! -e "$AP/$pf" ] || G diff --quiet -- "$pf" || { echo "pinned file $pf rewritten"; b=1; }; done < "$T/pinned.txt"
  grep -q "'docs/plans/2026-06-22-ceo-fleet-autonomy.md'" "$AP/hooks/tests/codex-plugin-package.test.sh" && { echo "reviewed this-repo test file not rewritten"; b=1; }
  return $b
}
refs_code_state "$RP" > "$T/rcs.out"; [ "$?" = 0 ] && ok || { bad "refs-code skip rules hold with the real tool"; sed 's/^/    /' "$T/rcs.out" "$T/err" | head -6; }
rc_mut() {  # <name> <sed expression> <what must break>
  sed "$2" "$RP" > "$T/rp-mut-$1.js"
  cmp -s "$RP" "$T/rp-mut-$1.js" && { bad "refs-code mutation $1 did not change the tool"; return; }
  refs_code_state "$T/rp-mut-$1.js" > "$T/rcs.out"; local rc=$?
  if [ "$rc" = 1 ] && grep -q "$3" "$T/rcs.out"; then ok; else bad "negative control $1: without the rule, '$3' must break (rc=$rc)"; sed 's/^/    /' "$T/rcs.out" | head -4; fi
}
rc_mut generic 's#GENERIC_KEYS.has(t) \&\& !thisRepoGeneric#false \&\& !thisRepoGeneric#' "generic convention in a skill rewritten"
rc_mut default-keep 's#GENERIC_KEYS.has(t) \&\& !thisRepoGeneric(f, whole, idx)#GENERIC_KEYS.has(t) \&\& !true#' "generic convention in a consumer script rewritten"
rc_mut list-line 's#BL-0285 in `docs/BACKLOG.md`#NO-MATCH#' "reviewed this-repo line dropped from the list"
rc_mut file-class "s#THIS_REPO_GENERIC_PATHS.some((q) => (q.endsWith('/') ? f.startsWith(q) : f === q))#false#" "this-repo file class not rewritten"
rc_mut repo-root-generic 's#|| repoRootedRef(whole, idx);#;#' "repo-root path not rewritten in a test file"
rc_mut evidence 's#^const EVIDENCE_RE = .*#const EVIDENCE_RE = /^$a/;#' "evidence path rewritten"
rc_mut url-branch 's#^const BLOB_RE = .*#const BLOB_RE = /^$a/;#' "github branch link not followed"
rc_mut url-pinned 's#if (!/^(develop|main|master)$/.test(blob\[1\])) {#if (false) {#' "github pinned link rewritten"
rc_mut this-repo-line 's#|| lineListed(THIS_REPO_GENERIC_LINES, f, lineOf(whole, idx))#|| false#' "this-repo generic line not rewritten"
rc_mut keep-line 's#if (lineListed(KEEP_DOCS_LINES, f, lineOf(whole, idx)))#if (false)#' "kept-docs line rewritten"
rc_mut pinned-O8 's#O8|O8-ext|O9|O12#O8-ext|O9|O12#' "pinned class O8 rewritten"
rc_mut pinned-O8ext 's#O8|O8-ext|O9|O12#O8|O9|O12#' "pinned class O8-ext rewritten"
rc_mut pinned-O9 's#O8|O8-ext|O9|O12#O8|O8-ext|O12#' "pinned class O9 rewritten"
rc_mut pinned-O12 's#O8|O8-ext|O9|O12#O8|O8-ext|O9#' "pinned class O12 rewritten"
rc_mut fixture 's#isTestFile(f) && !THIS_REPO_TEST_FILES.has(f)#false#' "fixture path rewritten in a test file"
rc_mut allowlist 's#!THIS_REPO_TEST_FILES.has(f)#true#' "reviewed this-repo test file not rewritten"
G checkout -q -- . ; G clean -qfd
# the evidence rule on the docs side: refs-docs is the phase that reaches project/ and docs/ files; the real tool leaves the evidence path, the tool without
# the rule rewrites it
ev_docs_case() {  # <tool> -> 0 when the carrier still names the evidence path
  G checkout -q -- . ; G clean -qfd
  node "$1" apply --phase refs-docs --root "$AP" --layout-map "$O/layout-map-ev.json" </dev/null >/dev/null 2>"$T/err" || return 2
  grep -q 'docs/plans/_archive/2026/08/evidence/zz/e.md' "$AP/project/zz-ev-docs.md"
}
ev_docs_case "$RP"; [ "$?" = 0 ] && ok || bad "refs-docs leaves an evidence path alone"
sed 's#^const EVIDENCE_RE = .*#const EVIDENCE_RE = /^$a/;#' "$RP" > "$T/rp-mut-evdocs.js"
cmp -s "$RP" "$T/rp-mut-evdocs.js" && bad "evidence mutation did not change the tool"
ev_docs_case "$T/rp-mut-evdocs.js"; [ "$?" = 1 ] && ok || bad "negative control: without the evidence rule refs-docs must rewrite the evidence path"
G checkout -q -- . ; G clean -qfd
# total check: a rewritten path whose file is not in the tree fails the phase (exit 2) and the tree is clean; with the check removed the broken path lands
miss_case() {  # <tool> -> 0 when the phase failed (exit 2) and the tree is clean
  G checkout -q -- . ; G clean -qfd
  node "$1" apply --phase refs-code --root "$AP" --layout-map "$O/layout-map-miss.json" </dev/null >/dev/null 2>"$T/err"; local rc=$?
  [ "$rc" = 2 ] && [ -z "$(G status --porcelain)" ] && grep -q 'not in the tree' "$T/err"
}
miss_case "$RP" && ok || bad "a rewrite to a file that is not in the tree fails refs-code (exit 2) and leaves the tree clean"
sed 's#if (broken.length) throw#if (false) throw#' "$RP" > "$T/rp-mut-broken.js"
cmp -s "$RP" "$T/rp-mut-broken.js" && bad "total-check mutation did not change the tool"
if miss_case "$T/rp-mut-broken.js"; then bad "negative control: without the total check a rewrite to a missing file must land"; else ok; fi
G checkout -q -- . ; G clean -qfd
# a second refs-code run changes nothing
node "$RP" apply --phase refs-code --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>&1; G add -A; G commit -q -m refs-code
node "$RP" apply --phase refs-code --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>&1 && [ -z "$(G status --porcelain)" ] && ok || bad "a second refs-code run changes nothing"
node "$RP" apply --phase refs-docs --root "$AP" --layout-map "$O/layout-map.json" --log "$T/ap-docs.json" >"$T/out" 2>"$T/err" </dev/null && ok || bad "apply --phase refs-docs"
if [ -n "$(G diff --name-only -- 'project/missions' 'docs/mission-blind-review-2d-snapshot-2026-09-19-sources.json' '.claude/mission-routing-config.json')" ]; then bad "sealed mission json, the D9.5 files and the routing config keep their bytes"; else ok; fi
node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!(l.token_replacements>0&&l.skipped_sealed>0))process.exit(1)' "$T/ap-docs.json" && ok || bad "refs-docs rewrote tokens and skipped sealed files"
# negative control: a rewriter that no longer honours the sealed list DOES change sealed bytes
sed 's#if (sealedOld.has(old) || sealedOld.has(f)) {#if (false) {#' "$RP" > "$T/rp-mut-sealed.js"
cmp -s "$RP" "$T/rp-mut-sealed.js" && bad "sealed-skip mutation did not change the tool"
G checkout -q -- . ; G clean -qfd
node "$T/rp-mut-sealed.js" apply --phase refs-docs --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>&1
if [ -n "$(G diff --name-only -- 'project/missions')" ]; then ok; else bad "negative control: without the sealed skip, sealed mission json must change"; fi
G checkout -q -- . ; G clean -qfd
# content phase: the project config files take their new directories from the registry; with the plans mapping pointed at the evidence directory the check turns red
sed "s#\['plans/', at('plans_dir')\]#['plans/', at('plans_evidence_dir')]#" "$RP" > "$T/rp-mut-cfg.js"
cmp -s "$RP" "$T/rp-mut-cfg.js" && bad "config mapping mutation did not change the tool"
node "$T/rp-mut-cfg.js" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>"$T/err"; mrc=$?
[ "$mrc" = 0 ] || bad "the config mutant run itself failed (rc=$mrc), so a red below would prove nothing"
if grep -q '`project/plans/YYYY-MM-DD-<name>.md`' "$AP/.claude/dev-flow-config.md"; then bad "negative control: with the plans mapping pointed elsewhere the config check must turn red"; else ok; fi
G checkout -q -- . ; G clean -qfd
sed 's#^function followLiterals(io) {#function followLiterals(io) { return;#' "$RP" > "$T/rp-mut-lit.js"
cmp -s "$RP" "$T/rp-mut-lit.js" && bad "literal follow-up mutation did not change the tool"
node "$T/rp-mut-lit.js" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>"$T/err"; mrc=$?
[ "$mrc" = 0 ] || bad "the literal follow-up mutant run itself failed (rc=$mrc), so a red below would prove nothing"
if grep -q 'repo-layout.js" path projects_dir' "$AP/hooks/tests/check-escalation-coverage.test.sh"; then bad "negative control: without the literal follow-ups the escalation test must still build its fixture under docs/"; else ok; fi
G checkout -q -- . ; G clean -qfd
sed 's#^function seedHermeticCopies(io, root) {#function seedHermeticCopies(io, root) { return;#' "$RP" > "$T/rp-mut-seed.js"
cmp -s "$RP" "$T/rp-mut-seed.js" && bad "hermetic seed mutation did not change the tool"
node "$T/rp-mut-seed.js" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>"$T/err"; mrc=$?
[ "$mrc" = 0 ] || bad "the hermetic seed mutant run itself failed (rc=$mrc), so a red below would prove nothing"
if grep -q 'D10.27: the sealed active mission graph' "$AP/hooks/tests/session-mode.test.sh"; then bad "negative control: without the seed rule the hermetic copy of session-mode must not carry the old backlog name"; else ok; fi
G checkout -q -- . ; G clean -qfd
node "$RP" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>"$T/err" && ok || bad "apply --phase content"
grep -q 'repo-layout.js" path projects_dir' "$AP/hooks/tests/check-escalation-coverage.test.sh" && grep -q 'repo-layout.js" path projects_archive_dir' "$AP/hooks/tests/check-escalation-coverage.test.sh" && ok || bad "the escalation-coverage test builds its fixture where the layout registry says"
! grep -q 'docs/projects/_archive' "$AP/hooks/tests/qualification-scorecard-tools.test.sh" && grep -q '"$sandbox/project/projects/_archive/2026/07"' "$AP/hooks/tests/qualification-scorecard-tools.test.sh" && ok || bad "the scorecard sandbox mimics this repo: the baseline sits where the registry says"
grep -q 'defaultDenyList(process.argv\[3\])' "$AP/hooks/tests/review-packet.test.sh" && grep -q "defaultDenyList(require('fs').mkdtempSync" "$AP/hooks/tests/review-packet.test.sh" && grep -q 'defaultDenyList(repo)' "$AP/hooks/tests/review-runner.test.sh" && ok || bad "the review-packet test asks the default deny list of the repo it reviews"
n=0; for hf in context-window dispatch-author-claude-native dispatch-author-session-mode mission-routing-admission session-mode status-finish-followup; do grep -q 'D10.27: the sealed active mission graph' "$AP/hooks/tests/$hf.test.sh" && n=$((n+1)); done; { grep -q 'cp "$dest/project/backlog/BACKLOG.md" "$dest/docs/BACKLOG.md"' "$AP/hooks/tests/autopilot-cli.test.sh" && [ "$n" = 6 ]; } && ok || bad "the hermetic copies seed the old backlog name the sealed mission graph still names"
grep -q '`project/plans/YYYY-MM-DD-<name>.md`' "$AP/.claude/dev-flow-config.md" && ! grep -q 'docs/plans/YYYY' "$AP/.claude/dev-flow-config.md" && grep -q 'docs/plans/evidence/{{DATE}}-{{SLUG}}/landing/' "$AP/.claude/skills/foreman-landing-pipeline/templates/closeout-brief.md" && ok || bad "config placeholders follow the registry (plans move, evidence stays)"
grep -q 'docs/dev/adr/0002-...' "$AP/hooks/tests/uncalled-script-labels.test.sh" && ok || bad "the literal follow-up (ADR comment) is applied"
# a second content run changes nothing; without the exact-fence merge check it fails on the already deleted absorbed file
G add -A; G commit -q -m content
node "$RP" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>"$T/err" && [ -z "$(G status --porcelain)" ] && ok || bad "a second content run succeeds and changes nothing"
sed 's#if (!first.includes(MERGE_FENCE_A)) {#if (true) {#' "$RP" > "$T/rp-mut-content.js"
cmp -s "$RP" "$T/rp-mut-content.js" && bad "content mutation did not change the tool"
if node "$T/rp-mut-content.js" apply --phase content --root "$AP" --layout-map "$O/layout-map.json" </dev/null >/dev/null 2>&1 && [ -z "$(G status --porcelain)" ]; then bad "negative control: without the merge-fence check a second content run must fail or change the tree"; else ok; fi
G checkout -q -- . ; G clean -qfd
grep -q 'stay in docs/ in P1 and move in P2' "$AP/docs/README.md" && ok || bad "docs/README.md says the evidence directories stay in docs/ until P2"
grep -q '<id>+<user>@users.noreply.github.com' "$AP/project/handoff/HANDOFF.md" && ! grep -q 'git log -1' "$AP/project/handoff/HANDOFF.md" && node "$AP/scripts/redact-personal.js" --check "$AP/project/handoff/HANDOFF.md" >/dev/null && ok || bad "the merged HANDOFF says where the author address comes from and carries no address"
[ -s "$AP/docs/README.md" ] && [ ! -e "$AP/docs/training/README.md" ] && [ ! -e "$AP/project/handoff/HANDOFF-ongoing-maintenance.md" ] && grep -q "Ongoing maintenance" "$AP/project/handoff/HANDOFF.md" && ok || bad "content phase: docs/README.md created, tombstone deleted, HANDOFF merged"
fi

# ---- the frozen stage-graph pre-registration (D10.22): both files and the archaeology scanner header are on the no-rewrite list with their base bytes
frozen_listed() {  # <no-rewrite.json> -> 0 when the three files are listed with the sha256 of their bytes in the base tree
  node -e '
const fs=require("fs"),cp=require("child_process"),crypto=require("crypto");
const nr=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const L=new Map(nr.entries.map((e)=>[e.path,e.sha256]));
for(const f of ["evals/skill-onoff/prereg/stage-graph.md","evals/skill-onoff/prereg/stage-graph-card.json","evals/skill-onoff/archaeology-scan.js","evals/orchestration/run-p2-batch.js"]){
  const h=crypto.createHash("sha256").update(cp.execFileSync("git",["-C",process.argv[2],"show","HEAD:"+f],{maxBuffer:64<<20})).digest("hex");
  if(L.get(f)!==h){console.log("not sealed: "+f);process.exit(1)}
}' "$1" "$BR"
}
# ---- the whole chain on a clone, one commit per phase: a second profiles and mirrors run changes nothing; a failure injected after each phase's writes
# leaves the tree exactly as the phase found it; with the restore taken out the same injection leaves the tree dirty
AC="$T/ac"; git clone -q --shared "$BR" "$AC" 2>/dev/null
GC() { git -C "$AC" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@"; }
step() { node "${3:-$RP}" apply --phase "$1" --root "$AC" --layout-map "$O/layout-map.json" </dev/null >"$T/out" 2>"$T/err"; }
PHASES="rename refs-code refs-docs content no-rewrite profiles mirrors"
chain_ok=1
for ph in $PHASES; do
  GC rev-parse HEAD > "$T/pre-$ph"
  step "$ph"; prc=$?
  if [ "$prc" = 0 ]; then GC add -A; GC commit -q -m "$ph"; else chain_ok=0; bad "chain phase $ph (rc=$prc)"; sed 's/^/    /' "$T/err" | head -6; break; fi
done
[ "$chain_ok" = 1 ] && ok
if [ "$chain_ok" = 1 ]; then
  # the three frozen stage-graph files: written into no-rewrite.json by the no-rewrite phase (base bytes, in path order), not rewritten by any refs phase
  FINALC="$(GC rev-parse HEAD)"
  frozen_listed "$AC/tools/migrate/no-rewrite.json" >"$T/out" && ok || { bad "the no-rewrite phase seals the frozen prereg files with their base bytes"; head -3 "$T/out"; }
  node -e '
const j=require(process.argv[1]);const p=j.entries.map((e)=>e.path);
for(const f of ["evals/orchestration/run-p2-batch.js","evals/skill-onoff/archaeology-scan.js","evals/skill-onoff/prereg/stage-graph-card.json","evals/skill-onoff/prereg/stage-graph.md"]){
  const i=p.indexOf(f);if(i<0||(i>0&&p[i-1]>f)||(i<p.length-1&&p[i+1]<f)){console.log("out of order: "+f);process.exit(1)}
}' "$AC/tools/migrate/no-rewrite.json" && ok || bad "the frozen prereg entries sit in path order"
  GC diff --quiet "$BASE_SHA" HEAD -- evals/orchestration/run-p2-batch.js evals/skill-onoff/archaeology-scan.js evals/skill-onoff/prereg/stage-graph-card.json evals/skill-onoff/prereg/stage-graph.md && ok || bad "the frozen prereg files keep their base bytes through the chain"
  sed 's#^const FROZEN_PREREG = \[.*\];#const FROZEN_PREREG = [];#' "$RP" > "$T/rp-mut-frozen.js"
  cmp -s "$RP" "$T/rp-mut-frozen.js" && bad "frozen-prereg mutation did not change the tool"
  GC checkout -q --detach "$(cat "$T/pre-no-rewrite")"; GC clean -qfd
  step no-rewrite "" "$T/rp-mut-frozen.js"
  if frozen_listed "$AC/tools/migrate/no-rewrite.json" >/dev/null 2>&1; then bad "negative control: without the generator entries the frozen-prereg check must turn red"; else ok; fi
  GC checkout -q --detach "$(cat "$T/pre-no-rewrite")"; GC clean -qfd
  printf '{"schema":1}\n' > "$AC/tools/migrate/no-rewrite.json"; GC add -A; GC commit -q -m malformed-nr
  step no-rewrite; mrc=$?
  [ "$mrc" = 2 ] && [ -z "$(GC status --porcelain)" ] && grep -q 'neither the one-entry-per-line shape' "$T/err" && ok || bad "a no-rewrite.json of neither shape fails the phase with an InputError (exit 2) and the tree is clean (rc=$mrc)"
  sed "s#if (!j || !Array.isArray(j.entries)) throw new InputError(#if (false) throw new InputError(#" "$RP" > "$T/rp-mut-nrshape.js"
  cmp -s "$RP" "$T/rp-mut-nrshape.js" && bad "no-rewrite shape mutation did not change the tool"
  step no-rewrite "" "$T/rp-mut-nrshape.js"; mrc=$?
  if [ "$mrc" = 2 ]; then bad "negative control: without the shape guard a malformed no-rewrite.json must not end in an InputError"; else ok; fi
  GC checkout -q -f --detach "$FINALC"; GC clean -qfd
  for ph in profiles mirrors; do
    step "$ph" && [ -z "$(GC status --porcelain)" ] && ok || bad "a second $ph run succeeds and changes nothing"
  done
  echo dirty > "$AC/zz-dirty.txt"
  step content; [ "$?" = 2 ] && [ -e "$AC/zz-dirty.txt" ] && ok || bad "a phase refuses to start on a dirty tree (exit 2) and touches nothing"
  rm -f "$AC/zz-dirty.txt"
  # an ignored file counts too: the phase refuses to start in anything but a fresh clone, and writes nothing; shown red with the --ignored flag removed
  echo x > "$AC/zz-ignored.txt"; echo zz-ignored.txt >> "$AC/.git/info/exclude"
  step content; [ "$?" = 2 ] && [ -e "$AC/zz-ignored.txt" ] && [ -z "$(GC status --porcelain)" ] && ok || bad "a phase refuses to start when an ignored file is present (exit 2) and touches nothing"
  sed "s#'status', '--porcelain', '--ignored'#'status', '--porcelain'#" "$RP" > "$T/rp-mut-ignored.js"
  cmp -s "$RP" "$T/rp-mut-ignored.js" && bad "ignored-file mutation did not change the tool"
  step content "" "$T/rp-mut-ignored.js"; [ "$?" = 2 ] && bad "negative control: without --ignored a stray ignored file must no longer stop the phase" || ok
  rm -f "$AC/zz-ignored.txt"; sed -i '/^zz-ignored.txt$/d' "$AC/.git/info/exclude"
  # a --log that cannot be written fails the phase and the tree goes back; with the log written after the guard the phase stays half landed
  log_case() {  # <tool> -> 0 when the phase failed (exit 2) and the tree is clean
    GC checkout -q --detach "$(cat "$T/pre-refs-code")"; GC clean -qfd
    node "$1" apply --phase refs-code --root "$AC" --layout-map "$O/layout-map.json" --log "$T/no-such-dir/log.json" </dev/null >/dev/null 2>"$T/err"; local rc=$?
    [ "$rc" = 2 ] && [ -z "$(GC status --porcelain)" ]
  }
  log_case "$RP" && ok || bad "an unwritable --log fails the phase (exit 2) and the tree has no half-landed phase"
  node -e '
const fs=require("fs");let s=fs.readFileSync(process.argv[1],"utf8");
const a="    writeLog(o, log);\n    done = true;";const b="  process.stdout.write(`relayout-p1 apply ${phase}:";
if(!s.includes(a)||!s.includes(b))process.exit(3);
s=s.replace(a,"    done = true;").replace(b,"  try { writeLog(o, log); } catch (_e) { process.exitCode = 2; }\n"+b);fs.writeFileSync(process.argv[2],s);' "$RP" "$T/rp-mut-log.js" && ok || bad "log mutation could not be built"
  if log_case "$T/rp-mut-log.js"; then bad "negative control: with the log written after the guard an unwritable --log must leave the phase half landed"; else ok; fi
  GC checkout -q -f --detach "$(cat "$T/pre-refs-code")"; GC clean -qfd
  inject() {  # <phase> <tool> -> 0 when the injected failure left no trace
    GC checkout -q --detach "$(cat "$T/pre-$1")"; GC clean -qfd
    local t0 o0; t0="$(GC rev-parse 'HEAD^{tree}')"; o0="$(GC ls-files -o -i --exclude-standard | wc -l)"
    RELAYOUT_P1_FAIL_AFTER="$1" step "$1" "" "$2"; local rc=$?
    [ "$rc" = 2 ] && [ -z "$(GC status --porcelain)" ] && [ "$(GC ls-files -o -i --exclude-standard | wc -l)" = "$o0" ] && [ "$(GC rev-parse 'HEAD^{tree}')" = "$t0" ]
  }
  for ph in $PHASES; do inject "$ph" "$RP" && ok || bad "an injected failure after $ph leaves the tree as the phase found it"; done
  sed 's#if (!done) guard.restore();#if (false) guard.restore();#' "$RP" > "$T/rp-mut-restore.js"
  cmp -s "$RP" "$T/rp-mut-restore.js" && bad "restore mutation did not change the tool"
  if inject refs-code "$T/rp-mut-restore.js"; then bad "negative control: without the restore an injected failure must leave the tree dirty"; else ok; fi
  GC checkout -q -f --detach "$(cat "$T/pre-refs-code")"; GC clean -qfd
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
