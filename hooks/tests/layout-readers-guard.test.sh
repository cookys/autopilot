#!/usr/bin/env bash
# layout-readers-guard.test.sh - guards for the consumers that read the layout registry (relayout regcons lane).
#   1. bootstrap sets: every list / allowlist / deny list / prefix set a consumer builds from the registry equals, at stage
#      bootstrap, the literal it replaced (hooks/tests/lib/layout-bootstrap-sets.js). Control: a consumer that adds a key the old
#      literal did not have is caught.
#   2. this project only: the registry describes THIS repo; a reader running on another repo gets the docs/ convention
#      (repo-layout.js isThisProject / pathFor). Control: a reader that applies the registry path to any repo is caught.
#   3. materialise_graph_named_paths never writes outside the clone. Control: without the guard it does.
#   4. backlog_dir derivation for a backlog file at the root and inside backlog/.
# The docs/ names are built from $D on purpose: a relayout rewrite of this repo's own docs/ paths must not reach fixtures that
# model a consuming project or the old literals.
. "$(dirname "$0")/lib.sh"

D=docs
HELP="$REPO_ROOT/hooks/tests/lib"
pass() { assert_eq "ok" "ok" "$*"; }
BS="$(docs_layout_registry)"

# ---- 1. bootstrap sets -------------------------------------------------------------------------------------------------
OUT="$(REPO_LAYOUT_REGISTRY="$BS" node "$HELP/layout-bootstrap-sets.js" "$REPO_ROOT" 2>&1)"; RC=$?
assert_eq "0" "$RC" "bootstrap: every registry-built set equals its old literal ($OUT)"
assert_contains "$OUT" "all sets equal" "bootstrap: helper reports all sets equal"

# control: the edit-gate list with backlog_dir added back (the review finding) must be caught
MUT="$TEST_TMP/mut-gate"; mkdir -p "$MUT/hooks" "$MUT/scripts/lib"
cp "$REPO_ROOT/hooks/orchestrator-edit-gate-lib.js" "$MUT/hooks/"; cp "$REPO_ROOT/scripts/lib/repo-layout.js" "$MUT/scripts/lib/"
sed -i "s/const keys = \['projects_dir', 'plans_dir'\];/const keys = ['projects_dir', 'plans_dir', 'backlog_dir'];/" "$MUT/hooks/orchestrator-edit-gate-lib.js"
if cmp -s "$REPO_ROOT/hooks/orchestrator-edit-gate-lib.js" "$MUT/hooks/orchestrator-edit-gate-lib.js"; then fail "control: backlog_dir mutation did not apply"; fi
OUT="$(REPO_LAYOUT_REGISTRY="$BS" node "$HELP/layout-bootstrap-sets.js" "$MUT" gate 2>&1)"; RC=$?
assert_eq "1" "$RC" "control: edit-gate list plus backlog_dir is caught"
assert_contains "$OUT" "MISMATCH orchestrator-edit-gate ALLOWLIST_PREFIXES" "control: the mismatch names the gate list"

# control: stage-vocab prefix list without the covered-prefix drop (plans evidence dir listed beside the plans dir) is caught
MUT2="$TEST_TMP/mut-stage"; mkdir -p "$MUT2/scripts/lib"
cp "$REPO_ROOT/scripts/check-stage-vocab.js" "$MUT2/scripts/"; cp "$REPO_ROOT/scripts/lib/repo-layout.js" "$MUT2/scripts/lib/"
sed -i "s/^const uniq = .*/const uniq = (a) => [...new Set(a)];/" "$MUT2/scripts/check-stage-vocab.js"
if cmp -s "$REPO_ROOT/scripts/check-stage-vocab.js" "$MUT2/scripts/check-stage-vocab.js"; then fail "control: uniq mutation did not apply"; fi
OUT="$(REPO_LAYOUT_REGISTRY="$BS" node "$HELP/layout-bootstrap-sets.js" "$MUT2" stage 2>&1)"; RC=$?
assert_eq "1" "$RC" "control: stage-vocab prefix list with a covered prefix is caught"

# ---- 2. the registry applies to this repo only -------------------------------------------------------------------------
P1REG="$TEST_TMP/p1-registry.json"
node -e '
const fs = require("fs"); const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
r.stage = "P1";
Object.assign(r.paths, { plans_dir: "project/plans", projects_dir: "project/projects", projects_index: "project/projects/INDEX.md",
  projects_archive_dir: "project/projects/_archive", backlog_file: "project/BACKLOG.md" });
fs.writeFileSync(process.argv[2], JSON.stringify(r));' "$BS" "$P1REG"
GITC=(-c user.email=t@t -c user.name=t -c commit.gpgsign=false -c core.hooksPath=/dev/null)
SELF="$TEST_TMP/self"; mkdir -p "$SELF/scripts/lib" "$SELF/hooks"
cp -r "$REPO_ROOT/scripts/lib/." "$SELF/scripts/lib/"; cp "$REPO_ROOT/hooks/orchestrator-edit-gate-lib.js" "$SELF/hooks/"
mkdir -p "$SELF/.claude-plugin"; cp "$REPO_ROOT/.claude-plugin/plugin.json" "$SELF/.claude-plugin/"
git -C "$SELF" init -q; git -C "$SELF" add -A; git -C "$SELF" "${GITC[@]}" commit -q -m seed
SELFWT="$TEST_TMP/self-wt"; git -C "$SELF" worktree add -q "$SELFWT" 2>/dev/null
OTHER="$TEST_TMP/other"; mkdir -p "$OTHER"; git -C "$OTHER" init -q
PLAIN="$TEST_TMP/plain"; mkdir -p "$PLAIN"
LED="ledger/decisions.jsonl"
for root in "$SELFWT" "$OTHER"; do
  for dir in "$D/projects" "project/projects"; do
    mkdir -p "$root/$dir/p/ledger"
    case "$dir" in project/*) tag=PROJECTCOPY ;; *) tag=DOCSCOPY ;; esac
    printf '{"kind":"decision","decision_id":"d1","rationale":"%s"}\n' "$tag" > "$root/$dir/p/$LED"
  done
done
RL="$SELF/scripts/lib/repo-layout.js"
IS() { REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(String(require(process.argv[1]).isThisProject(process.argv[2])))' "${ISLIB:-$RL}" "$1"; }
PF() { REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(require(process.argv[1]).pathFor(process.argv[2], process.argv[3]))' "$RL" "$1" "$2"; }
# identity is judged by content (plugin name + the registry lib), never by git
SELFCLONE="$TEST_TMP/self-clone"; git clone -q --no-hardlinks "$SELF" "$SELFCLONE" 2>/dev/null
NOGIT="$TEST_TMP/nogit-copy"; mkdir -p "$NOGIT/.claude-plugin" "$NOGIT/scripts/lib"
cp "$SELF/.claude-plugin/plugin.json" "$NOGIT/.claude-plugin/"; cp "$SELF/scripts/lib/repo-layout.js" "$NOGIT/scripts/lib/"
OTHERPLUG="$TEST_TMP/other-plugin"; mkdir -p "$OTHERPLUG/.claude-plugin" "$OTHERPLUG/scripts/lib"
printf '{"name":"some-other-plugin"}' > "$OTHERPLUG/.claude-plugin/plugin.json"; cp "$SELF/scripts/lib/repo-layout.js" "$OTHERPLUG/scripts/lib/"
NOLIB="$TEST_TMP/no-lib"; mkdir -p "$NOLIB/.claude-plugin"; cp "$SELF/.claude-plugin/plugin.json" "$NOLIB/.claude-plugin/"
BADJSON="$TEST_TMP/bad-json"; mkdir -p "$BADJSON/.claude-plugin" "$BADJSON/scripts/lib"; printf '{not json' > "$BADJSON/.claude-plugin/plugin.json"; cp "$SELF/scripts/lib/repo-layout.js" "$BADJSON/scripts/lib/"
assert_eq "true" "$(IS "$SELF")" "isThisProject: the project holding repo-layout.js"
assert_eq "true" "$(IS "$SELFWT")" "isThisProject: a worktree counts"
assert_eq "true" "$(IS "$SELFCLONE")" "isThisProject: an independent git clone counts"
assert_eq "true" "$(IS "$NOGIT")" "isThisProject: a non-git copy with the two identity files counts"
assert_eq "false" "$(IS "$OTHER")" "isThisProject: an ordinary repo is not"
assert_eq "false" "$(IS "$OTHERPLUG")" "isThisProject: another plugin's repo (different plugin.json name) is not"
assert_eq "false" "$(IS "$NOLIB")" "isThisProject: plugin.json alone, without scripts/lib/repo-layout.js, is not"
assert_eq "false" "$(IS "$BADJSON")" "isThisProject: an unparsable plugin.json is not"
assert_eq "false" "$(IS "$PLAIN")" "isThisProject: a plain directory is not"
assert_eq "false" "$(IS "$TEST_TMP/no-such-dir")" "isThisProject: a missing directory is not"
assert_eq "false" "$(IS "")" "isThisProject: an empty root is not"
# a registry lib with no plugin.json next to it (a bare sandbox copy) knows no identity: nothing is this project
BARE="$TEST_TMP/bare"; mkdir -p "$BARE/scripts/lib"; cp "$SELF/scripts/lib/repo-layout.js" "$BARE/scripts/lib/"
assert_eq "false" "$(ISLIB="$BARE/scripts/lib/repo-layout.js" IS "$SELF")" "isThisProject: a lib without its own plugin.json treats every root as another project"
# control: the old test (same git common dir) fails the clone and the non-git copy
MUTID="$TEST_TMP/mut-identity"; mkdir -p "$MUTID/scripts/lib" "$MUTID/.claude-plugin"; cp "$SELF/.claude-plugin/plugin.json" "$MUTID/.claude-plugin/"; cp "$SELF/scripts/lib/repo-layout.js" "$MUTID/scripts/lib/"
git -C "$MUTID" init -q; git -C "$MUTID" add -A; git -C "$MUTID" "${GITC[@]}" commit -q -m seed
MUTWT="$TEST_TMP/mut-identity-wt"; git -C "$MUTID" worktree add -q "$MUTWT" 2>/dev/null
node -e '
const fs = require("fs"); const f = process.argv[1]; let s = fs.readFileSync(f, "utf8");
const a = "function isThisProject(repoRoot) {";
if (!s.includes(a)) process.exit(3);
s = s.replace(a, "function __identity(repoRoot) {") + "\nconst __cp = require(\"child_process\");\nconst __common = (d) => { const r = __cp.spawnSync(\"git\", [\"-C\", d, \"rev-parse\", \"--git-common-dir\"], { encoding: \"utf8\" }); return r.status === 0 ? fs.realpathSync(path.resolve(d, r.stdout.trim())) : null; };\nfunction isThisProject(repoRoot) { const m = __common(SELF_ROOT); const t = repoRoot ? __common(repoRoot) : null; return !!(m && t && m === t); }\nmodule.exports.isThisProject = isThisProject;\n";
fs.writeFileSync(f, s);' "$MUTID/scripts/lib/repo-layout.js"
assert_eq "0" "$?" "control: the git-common-dir variant is applied"
MIS() { REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(String(require(process.argv[1]).isThisProject(process.argv[2])))' "$MUTID/scripts/lib/repo-layout.js" "$1"; }
assert_eq "true" "$(MIS "$MUTWT")" "control: the git variant still accepts a worktree"
assert_eq "false" "$(MIS "$SELFCLONE")" "control: the git variant rejects an independent clone (the old defect)"
assert_eq "false" "$(MIS "$NOGIT")" "control: the git variant rejects a non-git copy (the old defect)"
# the review packet deny list for a non-git copy, under a P1 registry, carries the project/plans patterns
OUT="$(REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).defaultDenyList(process.argv[2])))' "$REPO_ROOT/src/runners/review-packet.js" "$NOGIT")"
assert_contains "$OUT" "project/plans/**/*.review.md" "defaultDenyList(non-git copy) at P1 denies project/plans review artifacts"
OUT="$(REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).defaultDenyList(process.argv[2])))' "$REPO_ROOT/src/runners/review-packet.js" "$OTHER")"
assert_not_contains "$OUT" "project/plans" "defaultDenyList(ordinary repo) at P1 keeps the docs/ patterns"
assert_eq "project/plans" "$(PF "$SELFWT" plans_dir)" "pathFor: this repo's worktree gets the registry path"
assert_eq "$D/plans" "$(PF "$OTHER" plans_dir)" "pathFor: another repo gets the docs/ convention"
assert_eq "$D/BACKLOG.md" "$(PF "$PLAIN" backlog_file)" "pathFor: a non-git directory gets the docs/ convention"

DRV() { REPO_LAYOUT_REGISTRY="$P1REG" node "$HELP/layout-readers-driver.js" "$@"; }
# reader 1: the decision ledger a snapshot falls back to (docs and project copy side by side in both repos)
OUT="$(DRV ledger "$SELF" "$SELFWT")"
assert_contains "$OUT" "PROJECTCOPY" "ledger reader: this repo's worktree reads the registry (project/) copy"
assert_not_contains "$OUT" "DOCSCOPY" "ledger reader: ... not the docs/ one"
OUT="$(DRV ledger "$SELF" "$OTHER")"
assert_contains "$OUT" "DOCSCOPY" "ledger reader: another repo reads the docs/ copy"
assert_not_contains "$OUT" "PROJECTCOPY" "ledger reader: ... not the project/ one"
# reader 2: the depth-0 edit allowlist
assert_eq "true" "$(DRV gate "$SELF" "$OTHER" "$D/projects/p/R.md")" "edit gate: another repo may edit docs/projects"
assert_eq "false" "$(DRV gate "$SELF" "$OTHER" "project/projects/p/R.md")" "edit gate: another repo gets no project/ allowance"
assert_eq "true" "$(DRV gate "$SELF" "$SELFWT" "project/projects/p/R.md")" "edit gate: this repo may edit its registry projects dir"
# reader 3: denied context dirs
assert_eq "true" "$(DRV denied "$SELF" "$OTHER" "$D/backlog/n.md")" "context deny: another repo's docs/backlog is denied"
assert_eq "false" "$(DRV denied "$SELF" "$OTHER" "project/backlog/n.md")" "context deny: another repo's project/backlog is not special"
assert_eq "true" "$(DRV denied "$SELF" "$SELFWT" "project/BACKLOG.md")" "context deny: this repo's registry backlog file is denied"

# control: readers that apply the registry path to any repo are caught
for spec in "scripts/lib/workflow-snapshot.js|pathFor(ctx.cwd, 'projects_dir')|path('projects_dir')" \
            "hooks/orchestrator-edit-gate-lib.js|layout.pathFor(repoRoot, k)|layout.path(k)" \
            "scripts/lib/plan-review-context.js|LAYOUT.pathFor(repoRoot, k)|LAYOUT.path(k)"; do
  f="${spec%%|*}"; rest="${spec#*|}"; from="${rest%%|*}"; to="${rest#*|}"
  cp -r "$SELF" "$TEST_TMP/selfmut-$(basename "$f")"; M="$TEST_TMP/selfmut-$(basename "$f")"
  node -e 'const fs=require("fs");const [f,a,b]=process.argv.slice(1);const s=fs.readFileSync(f,"utf8");if(!s.includes(a)){process.exit(3)}fs.writeFileSync(f,s.split(a).join(b));' "$M/$f" "$from" "$to"
  assert_eq "0" "$?" "control: mutation applies to $f"
  case "$f" in
    scripts/lib/workflow-snapshot.js) OUT="$(DRV ledger "$M" "$OTHER")"; assert_contains "$OUT" "PROJECTCOPY" "control: ledger reader without the repo test reads project/ in another repo" ;;
    hooks/orchestrator-edit-gate-lib.js) assert_eq "false" "$(DRV gate "$M" "$OTHER" "$D/projects/p/R.md")" "control: edit gate without the repo test refuses docs/projects in another repo" ;;
    *) assert_eq "false" "$(DRV denied "$M" "$OTHER" "$D/backlog/n.md")" "control: context deny without the repo test misses docs/backlog in another repo" ;;
  esac
done

# ---- 3. materialise_graph_named_paths stays inside the clone -----------------------------------------------------------------
mkclone() {
  local c="$1" graph="$2"; mkdir -p "$c/.claude"
  printf '{"graph_path":"g.json"}' > "$c/.claude/mission-routing-config.json"; printf '%s' "$graph" > "$c/g.json"
}
C1="$TEST_TMP/clone1"; mkclone "$C1" "{\"a\":\"$D/x/y.md\",\"b\":\"scripts/z.js\"}"
materialise_graph_named_paths "$C1" 2>"$TEST_TMP/m1.err"; assert_eq "0" "$?" "materialise: ordinary graph-named paths are created"
[ -f "$C1/$D/x/y.md" ] && [ -f "$C1/scripts/z.js" ] && pass "materialise: both files exist" || fail "materialise: both files exist"
C2="$TEST_TMP/clone2"; mkclone "$C2" "{\"a\":\"$D/../../outside.md\",\"b\":\"scripts/inside.js\"}"
materialise_graph_named_paths "$C2" 2>"$TEST_TMP/m2.err"; RC=$?
assert_eq "2" "$RC" "materialise: a path with .. is refused"
[ ! -e "$TEST_TMP/outside.md" ] && pass "materialise: no file was written outside the clone" || fail "materialise: outside.md was created"
[ ! -e "$C2/scripts/inside.js" ] && pass "materialise: nothing at all is written when one path is refused" || fail "materialise: inside.js was written"
assert_contains "$(cat "$TEST_TMP/m2.err")" "refusing a graph-named path outside the clone" "materialise: the error says why"
# control: the same function without the guard writes outside the clone
sed -n '/^materialise_graph_named_paths()/,/^}/p' "$REPO_ROOT/hooks/tests/lib.sh" | sed 's/process.exit(2);//' > "$TEST_TMP/unguarded.sh"
C3="$TEST_TMP/clone3"; mkclone "$C3" "{\"a\":\"$D/../../outside3.md\"}"
( . "$TEST_TMP/unguarded.sh"; materialise_graph_named_paths "$C3" 2>/dev/null )
[ -e "$TEST_TMP/outside3.md" ] && pass "control: without the guard the file lands outside the clone" || fail "control: unguarded variant did not write outside (the test cannot tell)"

# symlinks inside the clone must not carry a write out of it
OUTSIDE="$TEST_TMP/outside-dir"; mkdir -p "$OUTSIDE"
C4="$TEST_TMP/clone4"; mkclone "$C4" "{\"a\":\"$D/x.md\"}"; ln -s "$OUTSIDE" "$C4/$D"
materialise_graph_named_paths "$C4" 2>"$TEST_TMP/m4.err"; assert_eq "2" "$?" "materialise: a path below a symlinked directory that leaves the clone is refused"
[ ! -e "$OUTSIDE/x.md" ] && pass "materialise: nothing written through the directory symlink" || fail "materialise: wrote through the directory symlink"
C5="$TEST_TMP/clone5"; mkclone "$C5" "{\"a\":\"scripts/z.js\"}"; mkdir -p "$C5/scripts"; ln -s "$TEST_TMP/outside5.md" "$C5/scripts/z.js"
materialise_graph_named_paths "$C5" 2>/dev/null; assert_eq "2" "$?" "materialise: a dangling symlink as the target itself is refused"
[ ! -e "$TEST_TMP/outside5.md" ] && pass "materialise: nothing written through the dangling symlink" || fail "materialise: wrote through the dangling symlink"
# control: without the realpath check the same write lands outside
sed -n '/^materialise_graph_named_paths()/,/^}/p' "$REPO_ROOT/hooks/tests/lib.sh" | sed 's/const real = nearestReal(abs);/const real = realRoot;/' > "$TEST_TMP/norealpath.sh"
C6="$TEST_TMP/clone6"; mkclone "$C6" "{\"a\":\"$D/x6.md\"}"; ln -s "$OUTSIDE" "$C6/$D"
( . "$TEST_TMP/norealpath.sh"; materialise_graph_named_paths "$C6" 2>/dev/null )
[ -e "$OUTSIDE/x6.md" ] && pass "control: without the realpath check the write lands outside" || fail "control: no-realpath variant did not write outside (the test cannot tell)"

# ---- 4. backlog_dir derivation ------------------------------------------------------------------------------------------------
bd() { # <backlog_file value> -> backlog_dir
  local reg="$TEST_TMP/bd-$RANDOM.json"
  node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));r.paths.backlog_file=process.argv[3];fs.writeFileSync(process.argv[2],JSON.stringify(r));' "$BS" "$reg" "$1"
  REPO_LAYOUT_REGISTRY="$reg" node "$REPO_ROOT/scripts/lib/repo-layout.js" path backlog_dir
}
assert_eq "backlog" "$(bd BACKLOG.md)" "backlog_dir: a backlog file at the repo root"
assert_eq "backlog" "$(bd backlog/BACKLOG.md)" "backlog_dir: a backlog file inside backlog/"
assert_eq "$D/backlog" "$(bd "$D/BACKLOG.md")" "backlog_dir: docs/BACKLOG.md -> docs/backlog"
assert_eq "project/backlog" "$(bd project/backlog/BACKLOG.md)" "backlog_dir: project/backlog/BACKLOG.md -> project/backlog"

finalize_test
