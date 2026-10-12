#!/usr/bin/env bash
# scaffold-mission.test.sh — contract test for scripts/scaffold-mission.js.
# The generated scaffold must pass the rail's own validators with no hand edit:
# mission-execution-graph-check (with the codex mirror rule) and a real `mission prepare`.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/scaffold-mission.js"
FIXTURE="$REPO_ROOT/hooks/tests/fixtures/plan-rubric-scaffold-fixture.md"
GRAPH_CHECK="$REPO_ROOT/scripts/mission-execution-graph-check.js"
PLAN_STEM=2026-10-13-demo

HELP_OUT=$(node "$SCRIPT" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "--help exits 0"
assert_contains "$HELP_OUT" "Usage:" "--help prints usage"

# make_repo <dir>: a scratch repo with governance, a committed plan and the sync script.
make_repo() {
  local d="$1"
  mkdir -p "$d/.claude" "$d/docs/plans" "$d/docs/projects" "$d/scripts" "$d/src"
  git -C "$d" init -q -b main
  git -C "$d" config user.email t@example.invalid
  git -C "$d" config user.name t
  cp "$REPO_ROOT/.claude/owner-kernel-governance.json" "$d/.claude/"
  cp "$REPO_ROOT/scripts/sync-codex-plugin-skills.sh" "$d/scripts/"
  { cat "$FIXTURE"; printf '\n## Deliverable contract\n- change src/thing.js and add scripts/new-tool.js\n'; } > "$d/docs/plans/$PLAN_STEM.md"
  printf '# Projects Index\n\n| Date | Name | Version | Commit | Links |\n|---|---|---|---|---|\n' > "$d/docs/projects/INDEX.md"
  mkdir -p "$d/platforms/codex/plugin/src"
  echo 'module.exports = 1;' | tee "$d/src/thing.js" > "$d/platforms/codex/plugin/src/thing.js"
  git -C "$d" add -A
  git -C "$d" commit -q -m seed
}
register_plan() {
  local d="$1" row
  row=$(node "$REPO_ROOT/scripts/check-plan-graduation.js" --register-template "$PLAN_STEM" --repo-root "$d")
  printf '%s\n' "$row" >> "$d/docs/projects/INDEX.md"
  git -C "$d" add -A
  git -C "$d" commit -q -m "register plan"
}
gen() { # gen <repo> [extra args...]
  local d="$1"; shift
  node "$SCRIPT" --repo-root "$d" --plan "docs/plans/$PLAN_STEM.md" \
    --output-path src/thing.js --create scripts/new-tool.js \
    --verify-cmd "node --check src/thing.js" --verify-cmd "bash hooks/tests/demo.test.sh" "$@"
}
digest_of() { node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).graph_digest)' "$1"; }

R="$TEST_TMP/repo1"
make_repo "$R"
GRAPH_F="$R/docs/mission-$PLAN_STEM-execution-graph.json"
SRC_F="$R/docs/mission-$PLAN_STEM-sources.json"
RUBRIC_F="$R/docs/plans/$PLAN_STEM.rubric.md"

# 1. Unregistered plan: refused with the paste-ready row, nothing written.
OUT=$(gen "$R" 2>&1); RC=$?
assert_exit_code "$RC" "2" "unregistered plan exits 2"
assert_contains "$OUT" "spec_plan_unregistered" "unregistered plan is named"
assert_contains "$OUT" "docs/projects/INDEX.md" "paste target is named"
assert_file_absent "$SRC_F" "no sources written on refusal"
assert_file_absent "$RUBRIC_F" "no rubric written on refusal"
register_plan "$R"

# 2. Verify commands the campaign intake rejects (the l5c pipe/quote failure) are refused up front.
OUT=$(gen "$R" --verify-cmd "bash x.sh | tail -3" 2>&1); RC=$?
assert_exit_code "$RC" "2" "piped verify command exits 2"
assert_contains "$OUT" "verify_cmd rejected" "piped verify command is named"
OUT=$(gen "$R" --verify-cmd "echo 'a b'" 2>&1); RC=$?
assert_exit_code "$RC" "2" "quoted verify command exits 2"
assert_file_absent "$GRAPH_F" "no graph written on verify refusal"

# 3. Uncommitted plan edit is refused (its sha would not match the base).
echo "extra" >> "$R/docs/plans/$PLAN_STEM.md"
OUT=$(gen "$R" 2>&1); RC=$?
assert_exit_code "$RC" "2" "dirty plan exits 2"
assert_contains "$OUT" "uncommitted" "dirty plan is named"
git -C "$R" checkout -q -- "docs/plans/$PLAN_STEM.md"

# 4. --check validates without writing.
OUT=$(gen "$R" --check 2>&1); RC=$?
assert_exit_code "$RC" "0" "--check exits 0 ($OUT)"
assert_contains "$OUT" '"status": "CHECKED"' "--check reports CHECKED"
assert_file_absent "$SRC_F" "--check writes no sources"
assert_file_absent "$RUBRIC_F" "--check writes no rubric"

# 5. Generate; the artifacts pass the rail's own validators untouched.
AUTH="$TEST_TMP/authority.json"
OUT=$(gen "$R" --authority-out "$AUTH" 2>"$TEST_TMP/gen.err"); RC=$?
assert_exit_code "$RC" "0" "generation exits 0 ($(cat "$TEST_TMP/gen.err"))"
assert_contains "$OUT" '"status": "GENERATED"' "generation reports GENERATED"
assert_file_exists "$SRC_F" "sources generated"
assert_file_exists "$GRAPH_F" "graph generated"
assert_file_exists "$RUBRIC_F" "rubric generated"
assert_file_exists "$AUTH" "envelope written outside the repo tree"
MIRROR="$TEST_TMP/mirror.json"
bash "$R/scripts/sync-codex-plugin-skills.sh" --mirror-roots-json > "$MIRROR"
CHK=$(cd "$R" && node "$GRAPH_CHECK" --graph "docs/mission-$PLAN_STEM-execution-graph.json" \
  --governance .claude/owner-kernel-governance.json --sources "docs/mission-$PLAN_STEM-sources.json" \
  --mirror-roots "$MIRROR" --repo-root "$R" 2>&1); RC=$?
assert_exit_code "$RC" "0" "graph checker accepts the generated scaffold ($CHK)"
assert_contains "$CHK" '"status":"READY"' "graph checker reports READY"
assert_contains "$CHK" '"status":"satisfied"' "mirror rule satisfied"
GRAPH=$(cat "$GRAPH_F")
assert_contains "$GRAPH" '"platforms/codex/plugin/scripts/new-tool.js"' "created script carries its codex mirror"
assert_contains "$GRAPH" '"authorized_creates"' "created paths are authorized_creates"
SRCS=$(cat "$SRC_F")
assert_contains "$SRCS" "\"plan_path\": \"plans/$PLAN_STEM.md\"" "sources paths are manifest-relative"
RUBRIC=$(cat "$RUBRIC_F")
assert_contains "$RUBRIC" "R1: First key result" "rubric came from plan-rubric-scaffold"

# 6. A real `mission prepare` binds the envelope to the graph and repo (the P7 BLOCKED cause).
git -C "$R" add -A
git -C "$R" commit -q -m scaffold
PREP=$(cd "$R" && node "$REPO_ROOT/bin/autopilot.js" mission prepare --repo "$R" --authority "$AUTH" \
  --graph "docs/mission-$PLAN_STEM-execution-graph.json" --out "$TEST_TMP/prepared.json" 2>&1); RC=$?
assert_exit_code "$RC" "0" "mission prepare accepts the generated envelope ($PREP)"
assert_contains "$PREP" '"status": "prepared"' "mission prepare reports prepared"

# 7. Existing outputs are not overwritten without --force; regeneration is byte-identical.
OUT=$(gen "$R" --authority-out "$AUTH" 2>&1); RC=$?
assert_exit_code "$RC" "3" "second run refuses to overwrite"
assert_contains "$OUT" "--force" "refusal names --force"
OUT=$(gen "$R" --authority-out "$AUTH" --force 2>&1); RC=$?
assert_exit_code "$RC" "0" "--force regenerates"
git -C "$R" diff --quiet -- "docs/mission-$PLAN_STEM-execution-graph.json" "docs/mission-$PLAN_STEM-sources.json"
assert_exit_code "$?" "0" "regeneration is byte-identical (deterministic)"
G1=$(digest_of "$GRAPH_F")

# 8. Changing one plan byte changes the graph digest.
R2="$TEST_TMP/repo2"
make_repo "$R2"
printf '\nOne more line.\n' >> "$R2/docs/plans/$PLAN_STEM.md"
git -C "$R2" commit -qam "edit plan"
register_plan "$R2"
gen "$R2" --authority-out "$TEST_TMP/authority2.json" >/dev/null 2>&1
G2=$(digest_of "$R2/docs/mission-$PLAN_STEM-execution-graph.json")
assert_neq "$G1" "$G2" "a different plan byte yields a different graph digest"

# 9. A required path absent at HEAD is refused and named; nothing new is written.
rm -f "$R2/docs/mission-$PLAN_STEM-execution-graph.json" "$R2/docs/mission-$PLAN_STEM-sources.json"
OUT=$(gen "$R2" --authority-out "$TEST_TMP/authority3.json" --required-path src/missing-input.js 2>&1); RC=$?
assert_exit_code "$RC" "2" "required path absent at HEAD exits 2"
assert_contains "$OUT" "src/missing-input.js" "missing required path is named"
assert_file_absent "$R2/docs/mission-$PLAN_STEM-execution-graph.json" "no graph written on required-path refusal"

# 10. A mirrored output without codex-mirror closure would fail the checker: prove the rule is exercised.
node -e '
const fs = require("fs");
const f = process.argv[1];
const g = JSON.parse(fs.readFileSync(f, "utf8"));
g.nodes[0].campaign.output_paths = g.nodes[0].campaign.output_paths.filter((p) => !p.startsWith("platforms/"));
fs.writeFileSync(f, JSON.stringify(g));
' "$GRAPH_F"
MUT=$(cd "$R" && node "$GRAPH_CHECK" --graph "docs/mission-$PLAN_STEM-execution-graph.json" \
  --governance .claude/owner-kernel-governance.json --sources "docs/mission-$PLAN_STEM-sources.json" \
  --mirror-roots "$MIRROR" --repo-root "$R" 2>&1); RC=$?
assert_neq "$RC" "0" "mutation: dropping the mirror output paths makes the checker fail"
assert_contains "$MUT" "codex mirror" "mutation fails on the mirror rule itself"

finalize_test
