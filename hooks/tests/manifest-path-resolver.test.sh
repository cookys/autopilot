#!/usr/bin/env bash
# manifest-path-resolver.test.sh - the one plan_path/rubric_path resolver in scripts/lib/repo-layout.js (3.0.0 relayout, D9.2)
# and the five readers that must go through it. Every red case has a green twin; two in-test mutants prove the
# traversal guard and the F5 inventory gate can fail. Registries are temp files (REPO_LAYOUT_REGISTRY), never the real one.
. "$(dirname "$0")/lib.sh"

LAYOUT="$REPO_ROOT/scripts/lib/repo-layout.js"
# "Bootstrap" cases below mean a repo that keeps its work records under docs/: they run on that registry, not the live one
# (which is docs/ at stage bootstrap and project/ from P1). P1 cases pass their own explicit registry.
BOOT="$(docs_layout_registry)"; export REPO_LAYOUT_REGISTRY="$BOOT"
export GIT_AUTHOR_NAME=mp GIT_AUTHOR_EMAIL=mp@example.com GIT_COMMITTER_NAME=mp GIT_COMMITTER_EMAIL=mp@example.com
GT="git -c user.name=t -c user.email=t@t -c commit.gpgsign=false"

# mkreg <out> <js over d>: the default registry at stage P1 (manifests in project/missions, plans relative to project/).
mkreg() {
  node -e '
    const { DEFAULT_REGISTRY } = require(process.argv[1]);
    const d = JSON.parse(JSON.stringify(DEFAULT_REGISTRY));
    d.stage = "P1";
    Object.assign(d.paths, { missions_dir: "project/missions", manifest_plan_base: "project", plans_dir: "project/plans",
      plans_archive_dir: "project/plans/_archive", projects_index: "project/projects/INDEX.md" });
    eval(process.argv[3]);
    require("fs").writeFileSync(process.argv[2], JSON.stringify(d, null, 2));
  ' "$LAYOUT" "$1" "$2"
}
P1="$TEST_TMP/p1.json"; mkreg "$P1" ''
P1_EXC="$TEST_TMP/p1-exc.json"
mkreg "$P1_EXC" 'd.exceptions.push({ path: "project/missions/mission-old-sources.json", rule: 6, reason: "fixture: manifest keeps its plans under docs/", plan_base: "docs" })'

R="$TEST_TMP/repo"; mkdir -p "$R/docs" "$R/project"
resolve() { node "$LAYOUT" manifest-path "$@" --repo-root "$R"; }

# ---- 1. resolver: bootstrap base is docs/, P1 base is project/ ----
OUT="$(resolve docs/mission-x-sources.json plans/p.md 2>&1)"; RC=$?
assert_eq "0" "$RC" "bootstrap resolves"
assert_eq "$(cd "$R" && pwd -P)/docs/plans/p.md" "$OUT" "bootstrap base is docs/"
OUT="$(REPO_LAYOUT_REGISTRY="$P1" resolve project/missions/mission-x-sources.json plans/p.md 2>&1)"; RC=$?
assert_eq "0" "$RC" "P1 resolves"
assert_eq "$(cd "$R" && pwd -P)/project/plans/p.md" "$OUT" "P1 base is project/"

# ---- 2. resolver: a path escape is red, its in-base twin is green ----
for bad in '../../etc/x' '/etc/passwd' 'plans/../../x' '..' 'a\b'; do
  REPO_LAYOUT_REGISTRY="$P1" resolve project/missions/mission-x-sources.json "$bad" >/dev/null 2>&1
  assert_eq "2" "$?" "escape $bad is red"
done
REPO_LAYOUT_REGISTRY="$P1" resolve project/missions/mission-x-sources.json 'plans/../plans/p.md' >/dev/null 2>&1
assert_eq "2" "$?" "round 2: any .. segment is refused by the one literal rule (was green when it stayed inside)"
REPO_LAYOUT_REGISTRY="$P1" resolve project/missions/mission-x-sources.json 'C:/x.md' >/dev/null 2>&1
assert_eq "2" "$?" "drive-letter plan_path is red"
REPO_LAYOUT_REGISTRY="$P1" resolve project/missions/mission-x-sources.json '//srv/share/x.md' >/dev/null 2>&1
assert_eq "2" "$?" "UNC-style plan_path is red"

# ---- 3. per-file exception: its own base is green, dropping it falls back to the global base ----
OUT="$(REPO_LAYOUT_REGISTRY="$P1_EXC" resolve project/missions/mission-old-sources.json plans/p.md 2>&1)"
assert_eq "$(cd "$R" && pwd -P)/docs/plans/p.md" "$OUT" "exception manifest uses its own base docs/"
OUT="$(REPO_LAYOUT_REGISTRY="$P1" resolve project/missions/mission-old-sources.json plans/p.md 2>&1)"
assert_eq "$(cd "$R" && pwd -P)/project/plans/p.md" "$OUT" "without the exception the global base applies"
OUT="$(REPO_LAYOUT_REGISTRY="$P1_EXC" resolve project/missions/mission-other-sources.json plans/p.md 2>&1)"
assert_eq "$(cd "$R" && pwd -P)/project/plans/p.md" "$OUT" "other manifests keep the global base"
# exception schema: plan_base must be plain and repo-relative
mkreg "$TEST_TMP/bad.json" 'd.exceptions.push({ path: "x.json", rule: 6, reason: "r", plan_base: "../up" })'
REPO_LAYOUT_REGISTRY="$TEST_TMP/bad.json" node "$LAYOUT" stage >/dev/null 2>&1
assert_eq "2" "$?" "plan_base with .. is rejected by validate"
# a manifest outside the repo keeps the historical base (its own directory)
mkdir -p "$TEST_TMP/loose"
OUT="$(node "$LAYOUT" manifest-path "$TEST_TMP/loose/m.json" plans/p.md --repo-root "$R" 2>&1)"; RC=$?
assert_eq "2" "$RC" "round 4: a manifest outside the repo root is refused (was: resolved against its own dir)"
assert_contains "$OUT" "is not inside the repo root" "the outside-repo refusal is named"

# ---- 4. in-test mutant: without the traversal guard the escape goes through (so the test above can fail) ----
MUT="$TEST_TMP/mut/repo-layout.js"; mkdir -p "$TEST_TMP/mut"
sed 's#^function containedPath(base, rel) {#function containedPath(base, rel) { return path.resolve(base, rel); /* guard removed */#' "$LAYOUT" > "$MUT"
if cmp -s "$LAYOUT" "$MUT"; then fail "mutant did not apply: traversal guard text moved"; fi
REPO_LAYOUT_REGISTRY="$P1" node "$MUT" manifest-path project/missions/mission-x-sources.json '../../etc/x' --repo-root "$R" >/dev/null 2>&1
assert_eq "0" "$?" "mutant (no guard) lets the escape through, so the red assertion above is load-bearing"

# ---- fixture repo for the readers, laid out at P1 ----
sha() { sha256sum "$1" | cut -d' ' -f1; }
mkdir -p "$R/project/plans" "$R/project/missions" "$R/docs/plans" "$R/.claude"
printf '# Plan P1\n' > "$R/project/plans/2026-08-03-p.md"
printf 'R1: first\n' > "$R/project/plans/2026-08-03-p.rubric.md"
# a decoy under docs/ with different bytes: a reader that still reads docs/ sees a digest mismatch or the wrong stem
printf '# Plan decoy\n' > "$R/docs/plans/2026-08-03-p.md"
printf 'R1: decoy\n' > "$R/docs/plans/2026-08-03-p.rubric.md"
write_manifest() { # <file>
  printf '{"schema_version":1,"sources":[{"plan_path":"plans/2026-08-03-p.md","rubric_path":"plans/2026-08-03-p.rubric.md","plan_sha256":"%s","rubric_sha256":"%s"}]}\n' \
    "$(sha "$R/project/plans/2026-08-03-p.md")" "$(sha "$R/project/plans/2026-08-03-p.rubric.md")" > "$1"
}
write_manifest "$R/project/missions/mission-p-sources.json"
git -C "$R" init -q; $GT -C "$R" add -A; $GT -C "$R" commit -q -m fixture

# ---- 5a. reader: mission-execution-graph-check (loadSourceCoverageManifest) ----
loader() { REPO_LAYOUT_REGISTRY="$1" node -e '
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  try { const c = g.loadSourceCoverageManifest(process.argv[2], { repoRoot: process.argv[3] }); console.log("OK " + c.planIds.length); }
  catch (e) { console.log("ERR " + e.message); }' "$REPO_ROOT" "$2" "${3:-$R}"; }
assert_eq "OK 1" "$(loader "$P1" "$R/project/missions/mission-p-sources.json")" "graph-check reads the plan under project/ at P1"
# bootstrap registry + the same manifest: the global base is docs/, which holds the decoy -> digest drift, not a pass
assert_contains "$(loader "$BOOT" "$R/project/missions/mission-p-sources.json")" "ERR source manifest.sources[0] content digest drifted" "bootstrap base (docs/) sees the decoy, not project/"
# escape in the manifest: red with the historical message
cp "$R/project/missions/mission-p-sources.json" "$R/project/missions/mission-esc-sources.json"
sed -i 's#"plans/2026-08-03-p.md"#"../../outside.md"#' "$R/project/missions/mission-esc-sources.json"
assert_contains "$(loader "$P1" "$R/project/missions/mission-esc-sources.json")" "must stay under the manifest root" "graph-check: escaping plan_path is red"
# exception manifest with its own base docs/
write_manifest "$R/project/missions/mission-old-sources.json"
sed -i "s#$(sha "$R/project/plans/2026-08-03-p.md")#$(sha "$R/docs/plans/2026-08-03-p.md")#; s#$(sha "$R/project/plans/2026-08-03-p.rubric.md")#$(sha "$R/docs/plans/2026-08-03-p.rubric.md")#" "$R/project/missions/mission-old-sources.json"
assert_eq "OK 1" "$(loader "$P1_EXC" "$R/project/missions/mission-old-sources.json")" "graph-check: exception manifest green with its own base"
assert_contains "$(loader "$P1" "$R/project/missions/mission-old-sources.json")" "content digest drifted" "graph-check: same manifest red under the global base"

# ---- 5b. reader: check-plan-graduation (loadActiveLineageStems) ----
cat > "$R/.claude/mission-routing-config.json" <<'JSON'
{"schema_version":1,"graph_path":"project/missions/mission-p-execution-graph.json","sources_path":"project/missions/mission-p-sources.json"}
JSON
stems() { REPO_LAYOUT_REGISTRY="$P1" node -e '
  const g = require(process.argv[1] + "/scripts/check-plan-graduation.js");
  console.log(JSON.stringify([...g.loadActiveLineageStems(process.argv[2])].sort()));' "$REPO_ROOT" "$R"; }
assert_eq '["2026-08-03-p"]' "$(stems)" "plan-graduation: lineage stem from the project/ manifest"
cp "$R/.claude/mission-routing-config.json" "$TEST_TMP/routing.bak"
sed -i 's#mission-p-sources#mission-esc-sources#' "$R/.claude/mission-routing-config.json"
sed -i 's#"rubric_path":"plans/2026-08-03-p.rubric.md"#"rubric_path":"../../outside.rubric.md"#' "$R/project/missions/mission-esc-sources.json"
assert_contains "$(stems 2>&1)" "MANIFEST_PATH_ESCAPE" "plan-graduation: an escaping plan_path fails loudly (round 3: was 'adds no stem')"
cp "$TEST_TMP/routing.bak" "$R/.claude/mission-routing-config.json"
# sealed-docs fails closed on the same escaping manifest, then the manifest is parked so the later cases see a clean set
sealed_err() { REPO_LAYOUT_REGISTRY="$1" node -e '
  const s = require(process.argv[1] + "/scripts/lib/sealed-docs.js");
  try { s.sealedDocFiles(process.argv[2]); console.log("NO-THROW"); } catch (e) { console.log("THROW " + e.code); }' "$REPO_ROOT" "$R"; }
assert_eq "THROW MANIFEST_PATH_ESCAPE" "$(sealed_err "$P1")" "sealed-docs: an escaping sealed path throws instead of dropping out of the set"
mv "$R/project/missions/mission-esc-sources.json" "$TEST_TMP/esc-sources.parked"

# ---- 5c. reader: sealed-docs ----
sealed() { REPO_LAYOUT_REGISTRY="$1" node -e '
  const s = require(process.argv[1] + "/scripts/lib/sealed-docs.js");
  console.log(JSON.stringify([...s.sealedDocFiles(process.argv[2])].sort()));' "$REPO_ROOT" "$R"; }
assert_eq '["project/plans/2026-08-03-p.md","project/plans/2026-08-03-p.rubric.md"]' "$(sealed "$P1")" "sealed-docs: seals the project/ plan and rubric at P1"
assert_contains "$(sealed "$P1_EXC")" '"docs/plans/2026-08-03-p.md"' "sealed-docs: exception manifest seals its docs/ plan"

# ---- 5d. reader: next-touch-validation (sourceDigests) ----
NT="$TEST_TMP/nt"; mkdir -p "$NT/project/plans" "$NT/project/missions" "$NT/docs/plans"
NT_PLAN=2026-08-03-next-touch-debt-retirement
printf 'plan at project\n' > "$NT/project/plans/$NT_PLAN.md"; printf 'R1: x\n' > "$NT/project/plans/$NT_PLAN.rubric.md"
printf 'decoy at docs\n' > "$NT/docs/plans/$NT_PLAN.md"; printf 'R1: decoy\n' > "$NT/docs/plans/$NT_PLAN.rubric.md"
printf '{"schema_version":1,"sources":[{"plan_path":"plans/%s.md","rubric_path":"plans/%s.rubric.md","plan_sha256":"%s","rubric_sha256":"%s"}]}\n' \
  "$NT_PLAN" "$NT_PLAN" "$(sha "$NT/project/plans/$NT_PLAN.md")" "$(sha "$NT/project/plans/$NT_PLAN.rubric.md")" \
  > "$NT/project/missions/mission-next-touch-debt-retirement-sources.json"
nt() { REPO_LAYOUT_REGISTRY="$1" node -e '
  const n = require(process.argv[1] + "/scripts/next-touch-validation.js");
  try { n.sourceDigests(process.argv[2]); console.log("OK"); } catch (e) { console.log("ERR " + (e.code || "") + " " + e.message); }' "$REPO_ROOT" "$NT"; }
assert_eq "OK" "$(nt "$P1")" "next-touch: reads the project/ plan at P1"
assert_eq "plan at project" "$(REPO_LAYOUT_REGISTRY="$P1" node -e 'console.log(require(process.argv[1] + "/scripts/next-touch-validation.js").sourceDigests(process.argv[2]).planText.trim())' "$REPO_ROOT" "$NT")" "next-touch: planText is the resolved project/ plan, not the docs/ decoy"
assert_contains "$(nt "$BOOT")" "ERR" "next-touch: bootstrap layout does not find the project/ manifest"

# ---- 5e. reader: scaffold-mission (writes the manifest where the registry says, plan_path relative to the base) ----
FIX="$REPO_ROOT/hooks/tests/fixtures/plan-rubric-scaffold-fixture.md"
S="$TEST_TMP/scaf"; STEM=2026-10-13-demo
mkdir -p "$S/.claude" "$S/project/plans" "$S/project/projects" "$S/project/missions" "$S/scripts" "$S/src" "$S/platforms/codex/plugin/src"
git -C "$S" init -q -b main; git -C "$S" config user.email t@example.com; git -C "$S" config user.name t; git -C "$S" config commit.gpgsign false
cp "$REPO_ROOT/.claude/owner-kernel-governance.json" "$S/.claude/"; cp "$REPO_ROOT/scripts/sync-codex-plugin-skills.sh" "$S/scripts/"
{ cat "$FIX"; printf '\n## Deliverable contract\n- change src/thing.js and add scripts/new-tool.js\n'; } > "$S/project/plans/$STEM.md"
printf '# Projects Index\n\n| Date | Name | Version | Commit | Links |\n|---|---|---|---|---|\n' > "$S/project/projects/INDEX.md"
echo 'module.exports = 1;' | tee "$S/src/thing.js" > "$S/platforms/codex/plugin/src/thing.js"
$GT -C "$S" add -A; $GT -C "$S" commit -q -m seed
REPO_LAYOUT_REGISTRY="$P1" node "$REPO_ROOT/scripts/check-plan-graduation.js" --register-template "$STEM" --repo-root "$S" >> "$S/project/projects/INDEX.md"
$GT -C "$S" add -A; $GT -C "$S" commit -q -m reg
scaf() { REPO_LAYOUT_REGISTRY="$P1" node "$REPO_ROOT/scripts/scaffold-mission.js" --repo-root "$S" --plan "project/plans/$STEM.md" \
  --output-path src/thing.js --create scripts/new-tool.js --verify-cmd "node --check src/thing.js" "$@"; }
OUT="$(scaf --check 2>&1)"; RC=$?
assert_eq "0" "$RC" "scaffold --check at P1 ($OUT)"
OUT="$(scaf 2>&1)"; RC=$?
assert_eq "0" "$RC" "scaffold at P1 ($OUT)"
assert_file_exists "$S/project/missions/mission-$STEM-sources.json" "scaffold writes the manifest into the registry missions dir"
assert_eq "plans/$STEM.md" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sources[0].plan_path)' "$S/project/missions/mission-$STEM-sources.json")" "scaffold plan_path is relative to the registry plan base"
assert_eq "OK 1" "$(loader "$P1" "$S/project/missions/mission-$STEM-sources.json" "$S" | sed 's/^OK .*/OK 1/')" "the scaffolded manifest loads through the resolver"

# ---- 5f. round 2: one containment function (literal + realpath), linked worktrees, loud failures ----
G="$REPO_ROOT/scripts/lib/repo-layout.js"
contained() { node -e 'try { console.log("OK " + require(process.argv[1]).containedPath(process.argv[2], process.argv[3])); } catch (e) { console.log("ERR " + e.code + " " + (e.kind || "")); }' "$G" "$1" "$2"; }
CB="$TEST_TMP/cbase"; mkdir -p "$CB/plans" "$TEST_TMP/coutside"; echo x > "$TEST_TMP/coutside/s.md"; echo y > "$CB/plans/ok.md"
assert_contains "$(contained "$CB" 'plans/ok.md')" "OK " "containedPath: plain file green"
for bad in 'a\b' 'C:/x' 'C:x' '//srv/x' '/etc/x' 'plans/../x' '..'; do
  assert_contains "$(contained "$CB" "$bad")" "ERR MANIFEST_PATH_ESCAPE literal" "containedPath: $bad refused literally"
done
# plan_base goes through the same literal rule (registry validate) ...
for badbase in 'a\b' 'C:/x' '//srv/x' '../up' '/tmp'; do
  mkreg "$TEST_TMP/badb.json" "d.exceptions.push({ path: 'x.json', rule: 6, reason: 'r', plan_base: $(node -e 'console.log(JSON.stringify(process.argv[1]))' "$badbase") })"
  REPO_LAYOUT_REGISTRY="$TEST_TMP/badb.json" node "$LAYOUT" stage >/dev/null 2>&1
  assert_eq "2" "$?" "plan_base $badbase is rejected by validate"
done
# ... and a plan_base that names no directory turns red instead of falling back to the global base
mkreg "$TEST_TMP/nobase.json" 'd.exceptions.push({ path: "project/missions/mission-nb-sources.json", rule: 6, reason: "fixture", plan_base: "no-such-dir" })'
OUT="$(REPO_LAYOUT_REGISTRY="$TEST_TMP/nobase.json" resolve project/missions/mission-nb-sources.json plans/p.md 2>&1)"; RC=$?
assert_eq "2" "$RC" "missing plan_base directory is red"
assert_contains "$OUT" "not an existing directory" "missing plan_base is named"
# symlink inside the base that points outside: red; a link that stays inside: green
ln -s "$TEST_TMP/coutside" "$CB/plans/escape"; ln -s "$CB/plans" "$CB/inner"
assert_contains "$(contained "$CB" 'plans/escape/s.md')" "ERR MANIFEST_PATH_ESCAPE symlink" "symlink out of the base is red"
assert_contains "$(contained "$CB" 'inner/ok.md')" "OK " "symlink that stays inside the base is green"
ln -s "$TEST_TMP/nowhere" "$CB/plans/dangling"
assert_contains "$(contained "$CB" 'plans/dangling')" "ERR MANIFEST_PATH_ESCAPE symlink" "dangling symlink is red"
# graph-check surfaces the escape code instead of repairing it
ln -s "$TEST_TMP/coutside" "$R/project/plans/leak"
cp "$R/project/missions/mission-p-sources.json" "$R/project/missions/mission-esc-sources.json"
sed -i 's#"plans/2026-08-03-p.md"#"../../outside.md"#' "$R/project/missions/mission-esc-sources.json"
cp "$R/project/missions/mission-p-sources.json" "$R/project/missions/mission-sym-sources.json"
sed -i 's#"plans/2026-08-03-p.md"#"plans/leak/s.md"#' "$R/project/missions/mission-sym-sources.json"
code_of() { REPO_LAYOUT_REGISTRY="$P1" node -e '
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  try { g.loadSourceCoverageManifest(process.argv[2], { repoRoot: process.argv[3] }); console.log("OK"); }
  catch (e) { console.log("CODE " + e.code + " " + e.message); }' "$REPO_ROOT" "$1" "$R"; }
assert_contains "$(code_of "$R/project/missions/mission-esc-sources.json")" "CODE MANIFEST_PATH_ESCAPE" "graph-check throws MANIFEST_PATH_ESCAPE for a literal escape"
assert_contains "$(code_of "$R/project/missions/mission-sym-sources.json")" "CODE MANIFEST_PATH_ESCAPE source manifest.sources[0].plan_path escapes the source manifest root" "graph-check throws MANIFEST_PATH_ESCAPE for a symlink escape"
# graduation: an escape adds no stem, but a broken registry is not swallowed
BROKEN="$TEST_TMP/broken-registry.json"; echo '{ not json' > "$BROKEN"
assert_contains "$(node -e '
  const g = require(process.argv[1] + "/scripts/check-plan-graduation.js");
  process.env.REPO_LAYOUT_REGISTRY = process.argv[3];
  try { g.loadActiveLineageStems(process.argv[2]); console.log("NO-THROW"); } catch (e) { console.log("THROW " + e.message.slice(0, 60)); }' "$REPO_ROOT" "$R" "$BROKEN")" "THROW" "graduation: a broken registry fails loudly instead of yielding no stems"
# linked worktrees: a manifest in a sibling worktree is governed by THAT worktree's root, in both directions
W1="$TEST_TMP/w1"; mkdir -p "$W1/project/missions" "$W1/project/plans"
git -C "$W1" init -q
echo '{}' > "$W1/project/missions/mission-w-sources.json"; echo p > "$W1/project/plans/p.md"
$GT -C "$W1" add -A; $GT -C "$W1" commit -q -m w; $GT -C "$W1" worktree add -q "$TEST_TMP/w2" -b w2 || fail "worktree add failed"
W1R="$(cd "$W1" && pwd -P)"; W2R="$(cd "$TEST_TMP/w2" && pwd -P)"
# round 4: the repo root is the caller's; a manifest in a sibling worktree is outside it, in both directions
for pair in "$W1R:$W2R" "$W2R:$W1R"; do
  OUT="$(REPO_LAYOUT_REGISTRY="$P1" node "$LAYOUT" manifest-path "${pair%%:*}/project/missions/mission-w-sources.json" plans/p.md --repo-root "${pair##*:}" 2>&1)"; RC=$?
  assert_eq "2" "$RC" "sibling worktree manifest is refused (repo root ${pair##*:})"
  assert_contains "$OUT" "is not inside the repo root" "sibling worktree refusal is named"
done
OUT="$(REPO_LAYOUT_REGISTRY="$P1" node "$LAYOUT" manifest-path "$W2R/project/missions/mission-w-sources.json" plans/p.md --repo-root "$W2R" 2>&1)"
assert_eq "$W2R/project/plans/p.md" "$OUT" "a linked worktree used as its own repo root resolves under itself"
OUT="$(cd "$W2R" && REPO_LAYOUT_REGISTRY="$P1" node "$LAYOUT" manifest-path project/missions/mission-w-sources.json plans/p.md 2>&1)"
assert_eq "$W2R/project/plans/p.md" "$OUT" "CLI without --repo-root takes the cwd as the repo root"
(cd "$W1R" && REPO_LAYOUT_REGISTRY="$P1" node "$LAYOUT" manifest-path "$W2R/project/missions/mission-w-sources.json" plans/p.md >/dev/null 2>&1)
assert_eq "2" "$?" "CLI without --repo-root: a manifest outside the cwd repo is refused"

# ---- 5g. round 3: unrelated repos, env-proof repo detection, scaffold containment, named missing base ----
# an unrelated repo never borrows the caller's per-file exceptions
U="$TEST_TMP/unrel"; mkdir -p "$U/docs" "$U/private"; git -C "$U" init -q; echo '{}' > "$U/docs/mission-x-sources.json"; echo SECRET > "$U/private/secret.md"
mkreg "$TEST_TMP/p1-borrow.json" 'd.exceptions.push({ path: "docs/mission-x-sources.json", rule: 6, reason: "belongs to the caller repo", plan_base: "private" })'
OUT="$(REPO_LAYOUT_REGISTRY="$TEST_TMP/p1-borrow.json" node "$LAYOUT" manifest-base "$U/docs/mission-x-sources.json" --repo-root "$R" 2>&1)"; RC=$?
assert_eq "2" "$RC" "unrelated repo: the manifest is refused, so the caller's exception cannot reach it"
assert_contains "$OUT" "is not inside the repo root" "unrelated repo refusal is named"
# the caller's own repo still honours the exception
mkdir -p "$R/private"
OUT="$(REPO_LAYOUT_REGISTRY="$TEST_TMP/p1-borrow.json" node "$LAYOUT" manifest-base "$R/docs/mission-x-sources.json" --repo-root "$R" 2>&1)"
assert_contains "$OUT" '"source": "exception"' "caller's own repo: the exception applies"
# repo detection is a file-system walk: GIT_DIR / GIT_CEILING_DIRECTORIES change nothing
base_of() { REPO_LAYOUT_REGISTRY="$P1_EXC" node -e '
  const L = require(process.argv[1]); console.log(JSON.stringify(L.manifestBase(process.argv[2], process.argv[3])));' "$LAYOUT" "$R" "$R/project/missions/mission-old-sources.json"; }
PLAIN="$(base_of)"
assert_eq "$(GIT_DIR="$TEST_TMP/absent" base_of)" "$PLAIN" "GIT_DIR set: same manifest base as without it"
assert_eq "$(GIT_CEILING_DIRECTORIES="$TEST_TMP" base_of)" "$PLAIN" "GIT_CEILING_DIRECTORIES set: same manifest base as without it"
envload() { REPO_LAYOUT_REGISTRY="$P1_EXC" node -e '
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  try { g.loadSourceCoverageManifest(process.argv[2], { repoRoot: process.argv[3] }); console.log("OK"); } catch (e) { console.log("CODE " + e.code); }' "$REPO_ROOT" "$1" "$R"; }
assert_eq "$(GIT_DIR="$TEST_TMP/absent" envload "$R/project/missions/mission-old-sources.json")" "$(envload "$R/project/missions/mission-old-sources.json")" "graph-check: GIT_DIR does not change the result"
assert_eq "$(GIT_CEILING_DIRECTORIES="$TEST_TMP" envload "$R/project/missions/mission-esc-sources.json")" "CODE MANIFEST_PATH_ESCAPE" "graph-check, GIT_CEILING_DIRECTORIES set: an escape is still refused"
# a registry base that is itself a symlink out of the repo is refused
X="$TEST_TMP/xbase"; mkdir -p "$X/repo" "$X/elsewhere"; git -C "$X/repo" init -q; ln -s "$X/elsewhere" "$X/repo/docs"; echo '{}' > "$X/repo/m.json"
OUT="$(node "$LAYOUT" manifest-path "$X/repo/m.json" p.md --repo-root "$X/repo" 2>&1)"; RC=$?
assert_eq "2" "$RC" "a global base that links outside the repo is red"
assert_contains "$OUT" "resolves outside the repo" "the outside-the-repo base is named"
# a missing base is a named error, not a bare ENOENT
assert_contains "$(node -e 'try { require(process.argv[1]).containedPath(process.argv[2], "plans/p.md"); } catch (e) { console.log(e.code); }' "$LAYOUT" "$TEST_TMP/no-base-here")" "MANIFEST_BASE_INVALID" "containedPath: a missing base directory is a named error"
N="$TEST_TMP/nobase"; mkdir -p "$N/other"; git -C "$N" init -q; echo '{"schema_version":1,"sources":[{"plan_path":"a.md","rubric_path":"b.md","plan_sha256":"x","rubric_sha256":"y"}]}' > "$N/other/m.json"
assert_contains "$(node -e '
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  try { g.loadSourceCoverageManifest(process.argv[2], { repoRoot: process.argv[3] }); } catch (e) { console.log("CODE " + e.code + " " + e.message); }' "$REPO_ROOT" "$N/other/m.json" "$N")" "CODE MANIFEST_BASE_INVALID" "graph-check: a missing manifest base is a named error"
# scaffold refuses a plan that is a symlink leading out of the plan base
mkdir -p "$TEST_TMP/scaf-out"; mv "$S/project/plans/$STEM.md" "$TEST_TMP/scaf-out/plan.md"; ln -s "$TEST_TMP/scaf-out/plan.md" "$S/project/plans/$STEM.md"
$GT -C "$S" add -A; $GT -C "$S" commit -q -m symlinked-plan
rm -f "$S/project/missions/mission-$STEM-"*
OUT="$(scaf --check 2>&1)"; RC=$?
assert_neq "0" "$RC" "scaffold: a symlinked-out plan is refused"
assert_contains "$OUT" "cannot be a manifest source" "scaffold: the refusal names the plan base containment"

# ---- 5h. round 4: the repo root is never inferred from the manifest (forged .git cannot re-home a manifest) ----
FG="$TEST_TMP/forged"; mkdir -p "$FG/repo/docs/nest/docs" "$FG/other"; git -C "$FG/repo" init -q
echo '{}' > "$FG/repo/docs/nest/m.json"; echo '{}' > "$FG/other/m.json"
node -e '
  const L = require(process.argv[1]); const d = JSON.parse(JSON.stringify(L.load()));
  d.exceptions.push({ path: "m.json", rule: 6, reason: "caller only", plan_base: "docs" });
  require("fs").writeFileSync(process.argv[2], JSON.stringify(d));' "$LAYOUT" "$FG/reg.json"
FGR="$(cd "$FG/repo" && pwd -P)"
fbase() { REPO_LAYOUT_REGISTRY="$FG/reg.json" node "$LAYOUT" manifest-base "$1" --repo-root "$FGR" 2>&1; }
assert_contains "$(fbase "$FGR/docs/nest/m.json")" "\"base\": \"$FGR/docs\"" "nested manifest without a .git: caller's repo base"
mkdir "$FG/repo/docs/nest/.git"
assert_contains "$(fbase "$FGR/docs/nest/m.json")" "\"base\": \"$FGR/docs\"" "forged empty .git directory does not re-home the manifest"
rmdir "$FG/repo/docs/nest/.git"; echo 'not a repo' > "$FG/repo/docs/nest/.git"
assert_contains "$(fbase "$FGR/docs/nest/m.json")" "\"base\": \"$FGR/docs\"" "forged text .git file does not re-home the manifest"
echo "gitdir: $FGR/.git" > "$FG/other/.git"
OUT="$(fbase "$FG/other/m.json")"; RC=0; REPO_LAYOUT_REGISTRY="$FG/reg.json" node "$LAYOUT" manifest-base "$FG/other/m.json" --repo-root "$FGR" >/dev/null 2>&1 || RC=$?
assert_eq "2" "$RC" "a forged gitdir pointing at the caller's repo is refused"
assert_contains "$OUT" "is not inside the repo root" "forged gitdir refusal is named"
ln -s "$FGR/docs/nest" "$FG/alias"
OUT="$(fbase "$FG/alias/m.json")"
assert_contains "$OUT" "is not inside the repo root" "an outside symlink alias into the repo is refused"
assert_contains "$(node -e 'try { require(process.argv[1]).manifestBase(undefined, "m.json"); } catch (e) { console.log(e.code); }' "$LAYOUT")" "MANIFEST_REPO_ROOT_REQUIRED" "manifestBase: repoRoot is required"
assert_contains "$(node -e '
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  try { g.loadSourceCoverageManifest(process.argv[2]); } catch (e) { console.log(e.code); }' "$REPO_ROOT" "$R/project/missions/mission-p-sources.json")" "MANIFEST_REPO_ROOT_REQUIRED" "graph-check: repoRoot is required"
# frozenAssetFiles must not return a smaller set when a sealed path cannot be resolved
FZ="$TEST_TMP/frozen"; mkdir -p "$FZ/docs/plans"; git -C "$FZ" init -q
echo '{"schema_version":1,"sources":[{"plan_path":"../external.md","rubric_path":"plans/r.md","plan_sha256":"'$(printf 'a%.0s' $(seq 64))'","rubric_sha256":"'$(printf 'b%.0s' $(seq 64))'"}]}' > "$FZ/docs/mission-x-sources.json"
assert_contains "$(node -e '
  const g = require(process.argv[1] + "/scripts/check-plan-graduation.js");
  try { g.frozenAssetFiles(process.argv[2]); console.log("RETURNED"); } catch (e) { console.log("THREW " + e.code); }' "$REPO_ROOT" "$FZ" 2>/dev/null)" "THREW MANIFEST_PATH_ESCAPE" "frozenAssetFiles: a resolution error propagates instead of shrinking the frozen set"

# ---- 5i. round 5: the manifest's LITERAL path must be inside the repo root too (outside alias of an inside manifest) ----
AL="$TEST_TMP/alias"; mkdir -p "$AL/repo/docs" "$AL/repo/sub/docs"; git -C "$AL/repo" init -q
echo P > "$AL/repo/docs/p.md"; echo 'R1: yes' > "$AL/repo/docs/r.md"
printf '{"schema_version":1,"sources":[{"plan_path":"p.md","rubric_path":"r.md","plan_sha256":"%s","rubric_sha256":"%s"}]}\n' "$(sha "$AL/repo/docs/p.md")" "$(sha "$AL/repo/docs/r.md")" > "$AL/repo/docs/m.json"
ALR="$(cd "$AL/repo" && pwd -P)"
ln -s "$ALR/docs/m.json" "$AL/outside.json"; ln -s "$ALR" "$AL/root-alias"
aload() { node -e '
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  try { console.log("OK " + g.loadSourceCoverageManifest(process.argv[2], { repoRoot: process.argv[3] }).planIds.length); } catch (e) { console.log("CODE " + e.code); }' "$REPO_ROOT" "$1" "$2"; }
assert_eq "OK 1" "$(aload "$ALR/docs/m.json" "$ALR")" "alias contract: the real manifest in the real repo root is accepted"
assert_eq "CODE MANIFEST_OUTSIDE_REPO" "$(aload "$AL/outside.json" "$ALR")" "graph-check API: an outside symlink alias of an inside manifest is refused"
assert_contains "$(node -e 'try { require(process.argv[1]).manifestBase(process.argv[3], process.argv[2]); } catch (e) { console.log(e.code); }' "$LAYOUT" "$AL/outside.json" "$ALR")" "MANIFEST_OUTSIDE_REPO" "manifestBase API: an outside symlink alias is refused"
node "$LAYOUT" manifest-path "$AL/outside.json" p.md --repo-root "$ALR" >/dev/null 2>&1
assert_eq "2" "$?" "CLI: an outside symlink alias is rc=2"
# the formal graph-check CLI on a real, green mission: the real sources pass, an outside alias of them does not
GC="$REPO_ROOT/scripts/mission-execution-graph-check.js"; MS=containment-gates
MDIR="$(layout_path missions_dir)"   # the real mission files sit wherever the LIVE registry says
(cd "$REPO_ROOT" && env -u REPO_LAYOUT_REGISTRY node "$GC" --graph $MDIR/mission-$MS-execution-graph.json --governance .claude/owner-kernel-governance.json --sources $MDIR/mission-$MS-sources.json --repo-root . >/dev/null 2>&1)
assert_eq "0" "$?" "graph-check CLI control: the real sources manifest passes"
ln -s "$REPO_ROOT/$MDIR/mission-$MS-sources.json" "$AL/real-alias.json"
OUT="$(cd "$REPO_ROOT" && env -u REPO_LAYOUT_REGISTRY node "$GC" --graph $MDIR/mission-$MS-execution-graph.json --governance .claude/owner-kernel-governance.json --sources "$AL/real-alias.json" --repo-root . 2>&1)"; RC=$?
assert_eq "2" "$RC" "graph-check CLI: --sources <outside alias> --repo-root . is rc=2"
assert_contains "$OUT" "is not inside the repo root" "graph-check CLI: the alias refusal is named"
# a repoRoot that is itself a symlink: alias path and real path both accepted
assert_eq "OK 1" "$(aload "$AL/root-alias/docs/m.json" "$AL/root-alias")" "symlinked repo root: manifest given through the alias is accepted"
assert_eq "OK 1" "$(aload "$ALR/docs/m.json" "$AL/root-alias")" "symlinked repo root: manifest given through the real path is accepted"
# a subdirectory as repoRoot keeps refusing a manifest above it
assert_eq "CODE MANIFEST_OUTSIDE_REPO" "$(aload "$ALR/docs/m.json" "$ALR/sub")" "a repoRoot subdirectory still refuses a manifest outside it"

# ---- 5j. round 6: the repo check comes BEFORE any read of the manifest ----
mkdir -p "$TEST_TMP/rbc"; cp "$AL/repo/docs/m.json" "$TEST_TMP/rbc/outside.json"; printf '{ not json' > "$TEST_TMP/rbc/broken.json"
reads_of() { node -e '
  const fs = require("fs");
  const g = require(process.argv[1] + "/scripts/mission-execution-graph-check.js");
  const target = process.argv[2]; let reads = 0; const old = fs.readFileSync;
  fs.readFileSync = function (f, ...a) { if (String(f) === target) reads++; return old.call(this, f, ...a); };
  let code = "none";
  try { g.loadSourceCoverageManifest(target, { repoRoot: process.argv[3] }); } catch (e) { code = e.code || e.message.slice(0, 40); }
  fs.readFileSync = old; console.log("reads=" + reads + " code=" + code);' "$REPO_ROOT" "$1" "$ALR"; }
assert_eq "reads=0 code=MANIFEST_OUTSIDE_REPO" "$(reads_of "$TEST_TMP/rbc/outside.json")" "an outside manifest is refused with zero reads of its bytes"
assert_eq "reads=0 code=MANIFEST_OUTSIDE_REPO" "$(reads_of "$TEST_TMP/rbc/broken.json")" "an outside manifest with broken JSON is MANIFEST_OUTSIDE_REPO, not a JSON error"
assert_eq "reads=0 code=MANIFEST_OUTSIDE_REPO" "$(reads_of "$AL/outside.json")" "an outside alias is refused with zero reads"
assert_contains "$(reads_of "$ALR/docs/m.json")" "reads=1" "control: an inside manifest is read (so the counter can see reads)"

# ---- 6. F5: check-claude-md-inventory is red when docs/scripts-inventory.md is missing ----
SBX="$TEST_TMP/inv"; mkdir -p "$SBX/scripts/lib" "$SBX/docs"
cp "$REPO_ROOT/scripts/check-claude-md-inventory.js" "$SBX/scripts/"
cp "$LAYOUT" "$SBX/scripts/lib/"   # the checker asks the registry where the inventory doc is
printf '# f\n' > "$SBX/CLAUDE.md"; printf '# f\n' > "$SBX/AGENTS.md"   # BL-0383: entry docs, size-capped only
printf '# f\ncheck-claude-md-inventory.js repo-layout.js\n' > "$SBX/scripts/CLAUDE.md"   # the name list lives here
printf 'check-claude-md-inventory.js repo-layout.js\n' > "$SBX/docs/scripts-inventory.md"
node "$SBX/scripts/check-claude-md-inventory.js" >/dev/null 2>&1
assert_eq "0" "$?" "inventory present: green"
mv "$SBX/docs/scripts-inventory.md" "$SBX/inv.away"
OUT="$(node "$SBX/scripts/check-claude-md-inventory.js" 2>&1)"; RC=$?
assert_eq "1" "$RC" "inventory missing: red"
assert_contains "$OUT" "scripts-inventory.md is MISSING" "names the missing file"
assert_contains "$(node "$SBX/scripts/check-claude-md-inventory.js" --json 2>&1)" '"ok":false' "json ok:false when missing"
mv "$SBX/inv.away" "$SBX/docs/scripts-inventory.md"
node "$SBX/scripts/check-claude-md-inventory.js" >/dev/null 2>&1
assert_eq "0" "$?" "inventory restored: green again"
# in-test mutant: the old 'absent is fine' behaviour lets the missing file through
mkdir -p "$TEST_TMP/inv2/scripts/lib" "$TEST_TMP/inv2/docs"
cp "$LAYOUT" "$TEST_TMP/inv2/scripts/lib/"
sed 's/ && !inventoryMissing//' "$SBX/scripts/check-claude-md-inventory.js" > "$TEST_TMP/inv2/scripts/check-claude-md-inventory.js"
cp "$SBX/CLAUDE.md" "$SBX/AGENTS.md" "$TEST_TMP/inv2/"; cp "$SBX/scripts/CLAUDE.md" "$TEST_TMP/inv2/scripts/CLAUDE.md"
if cmp -s "$SBX/scripts/check-claude-md-inventory.js" "$TEST_TMP/inv2/scripts/check-claude-md-inventory.js"; then fail "mutant did not apply: gate text moved"; fi
node "$TEST_TMP/inv2/scripts/check-claude-md-inventory.js" >/dev/null 2>&1
assert_eq "0" "$?" "mutant (absent passes) is green with the file missing, so the red assertion above is load-bearing"

finalize_test
