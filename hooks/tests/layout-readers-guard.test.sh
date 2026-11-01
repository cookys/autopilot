#!/usr/bin/env bash
# layout-readers-guard.test.sh - guards for the consumers that read the layout registry (relayout regcons lane).
#   1. bootstrap sets: every list / allowlist / deny list / prefix set a consumer builds from the registry equals, at stage
#      bootstrap, the literal it replaced (hooks/tests/lib/layout-bootstrap-sets.js). Control: a consumer that adds a key the old
#      literal did not have is caught.
#   2. self repo only: the registry describes THIS repo; a reader running on another repo gets the docs/ convention
#      (repo-layout.js isSelfRepo / pathFor). Control: a reader that applies the registry path to any repo is caught.
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
IS() { REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(String(require(process.argv[1]).isSelfRepo(process.argv[2])))' "$RL" "$1"; }
PF() { REPO_LAYOUT_REGISTRY="$P1REG" node -e 'process.stdout.write(require(process.argv[1]).pathFor(process.argv[2], process.argv[3]))' "$RL" "$1" "$2"; }
assert_eq "true" "$(IS "$SELF")" "isSelfRepo: the repo holding repo-layout.js"
assert_eq "true" "$(IS "$SELFWT")" "isSelfRepo: a worktree of that repo counts"
assert_eq "false" "$(IS "$OTHER")" "isSelfRepo: another git repo is not"
assert_eq "false" "$(IS "$PLAIN")" "isSelfRepo: a directory that is not a git repo is not"
assert_eq "false" "$(IS "$TEST_TMP/no-such-dir")" "isSelfRepo: a missing directory is not"
assert_eq "false" "$(IS "")" "isSelfRepo: an empty root is not"
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
