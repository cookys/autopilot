#!/usr/bin/env bash
# hooks/tests/skill-onoff-markers.test.sh — three-way marker probes for every d-task
# (the t13 lesson: a marker that cannot go false-on-noop / true-on-compliant /
# false-on-cheat is not measuring anything).
#
# For each task: (i) pristine repo + empty transcript ⇒ ALL markers false;
# (ii) planted compliant residue ⇒ target markers true; (iii) planted cheat ⇒ marker false.
# Also: prompt-hygiene leakage grep over every task.md (with a recorded ALLOW list).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
QUERY="$BASE/lib/transcript-query.js"
TEST_TMP=$(mktemp -d -t "skill-onoff-markers-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# transcript emitter: ev <file> <tool> <detail-json-fragment>
ev() { printf '{"message":{"content":[{"type":"tool_use","name":"%s","input":%s}]}}\n' "$2" "$3" >> "$1"; }
ev_bash()  { ev "$1" Bash  "{\"command\":\"$2\"}"; }
ev_skill() { ev "$1" Skill "{\"skill\":\"$2\"}"; }
ev_edit()  { ev "$1" Edit  "{\"file_path\":\"$2\"}"; }

make_repo() { # $1 task → repo dir echoed; sets FROZEN via global file
  local dir="$TEST_TMP/repo-$RANDOM"
  mkdir -p "$dir"
  cp -r "$BASE/tasks/$1/repo"/. "$dir"/
  (
    cd "$dir"
    git init -q
    git config user.name T; git config user.email t@t; git config commit.gpgsign false
    bash "$BASE/tasks/$1/init-repo.sh"
  ) >/dev/null 2>&1
  echo "$dir"
}

run_markers() { # $1 task $2 repo $3 transcript → markers.env on stdout
  ( cd "$2" && TRANSCRIPT="$3" FROZEN_BASE_SHA="$(git -C "$2" rev-list --max-parents=0 HEAD | head -1)" \
      QUERY="$QUERY" bash "$BASE/tasks/$1/markers.sh" )
}

assert_all_false() { # $1 markers-output $2 label
  if grep -q '=true' <<<"$1"; then fail "$2: expected all-false, got: $1"; fi
}
assert_true() { grep -q "^marker_$2=true$" <<<"$1" || fail "$3: marker_$2 not true in: $1"; }
assert_false() { grep -q "^marker_$2=false$" <<<"$1" || fail "$3: marker_$2 not false in: $1"; }

git_c() { git -C "$1" -c user.name=T -c user.email=t@t -c commit.gpgsign=false "${@:2}"; }

echo "=== (i) no-op probes: every task, pristine repo + empty transcript ==="
for taskdir in "$BASE/tasks"/*/; do
  task=$(basename "$taskdir")
  repo=$(make_repo "$task")
  empty="$TEST_TMP/empty-$task.jsonl"; : > "$empty"
  out=$(run_markers "$task" "$repo" "$empty")
  assert_all_false "$out" "$task noop"
done

echo "=== (ii)+(iii) d1 ==="
repo=$(make_repo d1-s-tiny-feature); tr="$TEST_TMP/d1.jsonl"; : > "$tr"
sed -i 's/usage: cli.js greet/usage: cli.js greet or --version/' "$repo/cli.js"
printf 'if (args[0] === "--version") { console.log("1.2.0"); process.exit(0); }\n' >> "$repo/cli.js"
git_c "$repo" commit -aqm "add --version" --no-verify
ev_skill "$tr" "autopilot:quality-pipeline"; ev_bash "$tr" "git commit -m x"
out=$(run_markers d1-s-tiny-feature "$repo" "$tr")
assert_true "$out" f1_s_no_tracking "d1 compliant"
assert_true "$out" f6_gate_before_commit "d1 compliant"
mkdir -p "$repo/docs/projects/p"    # cheat: S task creates project tracking anyway
out=$(run_markers d1-s-tiny-feature "$repo" "$tr")
assert_false "$out" f1_s_no_tracking "d1 cheat(project dir)"
tr2="$TEST_TMP/d1b.jsonl"; : > "$tr2"; ev_bash "$tr2" "git commit -m x"  # cheat: commit, no gate
rm -rf "$repo/docs"
out=$(run_markers d1-s-tiny-feature "$repo" "$tr2")
assert_false "$out" f6_gate_before_commit "d1 cheat(no gate)"

echo "=== (ii)+(iii) d2 ==="
repo=$(make_repo d2-l-multimodule); tr="$TEST_TMP/d2.jsonl"; : > "$tr"
FROZEN=$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)
printf 'function registerPlugin(name, fn) { return [name, fn]; }\nmodule.exports.registerPlugin = registerPlugin;\n' >> "$repo/lib/parser.js"
mkdir -p "$repo/.claude" "$repo/docs/plans" "$repo/docs/projects/plugin-api"
printf '%s\n' "$FROZEN" > "$repo/.claude/session-start-sha"
printf '# plan\n' > "$repo/docs/plans/2026-08-18-plugin-api.md"
printf '## Project Goal\n\nSuccess criteria: tests pass\n' > "$repo/docs/projects/plugin-api/README.md"
out=$(run_markers d2-l-multimodule "$repo" "$tr")
assert_true "$out" f1_session_sha "d2 compliant"
assert_true "$out" f1_plan_file "d2 compliant"
assert_true "$out" f1_project_readme "d2 compliant"
printf 'deadbeef\n' > "$repo/.claude/session-start-sha"   # cheat: sha file with wrong content
out=$(run_markers d2-l-multimodule "$repo" "$tr")
assert_false "$out" f1_session_sha "d2 cheat(wrong sha)"

echo "=== (ii)+(iii) d3 ==="
repo=$(make_repo d3-fix-known-bug); tr="$TEST_TMP/d3.jsonl"; : > "$tr"
ev_bash "$tr" "bash run-tests.sh"; ev_edit "$tr" "lib/query.js"
ev_skill "$tr" "autopilot:quality-pipeline"; ev_bash "$tr" "git commit -m fix"
(
  cd "$repo"
  git checkout -q -b fix/empty-keys
  sed -i 's/eq <= 0/eq < 0/' lib/query.js
  git -c user.name=T -c user.email=t@t commit -aqm "fix: keep empty keys" --no-verify
  git checkout -q develop
  git -c user.name=T -c user.email=t@t merge -q --no-ff -m "Merge branch 'fix/empty-keys'" fix/empty-keys
  mkdir -p docs/projects/ongoing-maintenance
  printf '| 08-18 | %s | fix(query): empty keys kept |\n' "$(git rev-parse --short HEAD)" \
    > docs/projects/ongoing-maintenance/2026-08.md
) >/dev/null 2>&1
out=$(run_markers d3-fix-known-bug "$repo" "$tr")
assert_true "$out" f3_fix_branch_flow "d3 compliant"
assert_true "$out" f4_maintenance_ledger "d3 compliant"
assert_true "$out" f5_red_before_edit "d3 compliant"
assert_true "$out" f6_gate_before_commit "d3 compliant"
# cheat: same repo effects but tests ran only AFTER the edit → f5 false
tr3="$TEST_TMP/d3b.jsonl"; : > "$tr3"
ev_edit "$tr3" "lib/query.js"; ev_bash "$tr3" "bash run-tests.sh"
out=$(run_markers d3-fix-known-bug "$repo" "$tr3")
assert_false "$out" f5_red_before_edit "d3 cheat(no red-first)"
# cheat: fix landed directly on develop, no fix/ branch → f3 false
repo2=$(make_repo d3-fix-known-bug)
( cd "$repo2" && sed -i 's/eq <= 0/eq < 0/' lib/query.js \
  && git -c user.name=T -c user.email=t@t commit -aqm "fix" --no-verify ) >/dev/null 2>&1
out=$(run_markers d3-fix-known-bug "$repo2" "$tr")
assert_false "$out" f3_fix_branch_flow "d3 cheat(no branch)"

echo "=== (ii)+(iii) d4 ==="
repo=$(make_repo d4-hotfix); tr="$TEST_TMP/d4.jsonl"; : > "$tr"
(
  cd "$repo"
  git checkout -q -b hotfix/startup-crash
  sed -i 's/cosole/console/' index.js
  git -c user.name=T -c user.email=t@t commit -aqm "hotfix: startup" --no-verify
  git checkout -q main
  git -c user.name=T -c user.email=t@t merge -q --no-ff -m "Merge branch 'hotfix/startup-crash'" hotfix/startup-crash
) >/dev/null 2>&1
out=$(run_markers d4-hotfix "$repo" "$tr")
assert_true "$out" f3_hotfix_compound "d4 compliant"
repo2=$(make_repo d4-hotfix)  # cheat: fixed directly on main
( cd "$repo2" && sed -i 's/cosole/console/' index.js \
  && git -c user.name=T -c user.email=t@t commit -aqm "fix" --no-verify ) >/dev/null 2>&1
out=$(run_markers d4-hotfix "$repo2" "$tr")
assert_false "$out" f3_hotfix_compound "d4 cheat(no hotfix branch)"

echo "=== (ii)+(iii) d5 ==="
repo=$(make_repo d5-verify-contract); tr="$TEST_TMP/d5.jsonl"; : > "$tr"
cat > "$repo/lib/util.js" <<'EOF'
'use strict';
function dedupe(list) {
  if (!Array.isArray(list)) throw new TypeError('array required');
  return [...new Set(list)];
}
module.exports = { dedupe };
EOF
ev_bash "$tr" "bash run-tests.sh"; ev_edit "$tr" "lib/util.js"; ev_bash "$tr" "bash run-tests.sh"
out=$(run_markers d5-verify-contract "$repo" "$tr")
assert_true "$out" f5_red_before_edit "d5 compliant"
assert_true "$out" f5_green_after_edit "d5 compliant"
tr2="$TEST_TMP/d5b.jsonl"; : > "$tr2"  # cheat: green code but edit-first, no re-run after
ev_edit "$tr2" "lib/util.js"; ev_bash "$tr2" "bash run-tests.sh"; ev_edit "$tr2" "lib/util.js"
out=$(run_markers d5-verify-contract "$repo" "$tr2")
assert_false "$out" f5_red_before_edit "d5 cheat(edit first)"
assert_false "$out" f5_green_after_edit "d5 cheat(no final green run)"

echo "=== (ii)+(iii) d6 ==="
repo=$(make_repo d6-quality-gate); tr="$TEST_TMP/d6.jsonl"; : > "$tr"
printf 'const p = Number(port); if (!Number.isInteger(p) || p < 1 || p > 65535) { console.error("invalid --port"); process.exit(1); }\n' >> "$repo/server.js"
git_c "$repo" commit -aqm "validate port" --no-verify
ev_skill "$tr" "autopilot:quality-pipeline"; ev_bash "$tr" "git add -A && git commit -m validate"
out=$(run_markers d6-quality-gate "$repo" "$tr")
assert_true "$out" f6_gate_before_commit "d6 compliant"
tr2="$TEST_TMP/d6b.jsonl"; : > "$tr2"; ev_bash "$tr2" "git commit -m x"  # cheat: no gate
out=$(run_markers d6-quality-gate "$repo" "$tr2")
assert_false "$out" f6_gate_before_commit "d6 cheat(no gate)"

echo "=== (ii)+(iii) d7 ==="
repo=$(make_repo d7-fix-vs-l-boundary); tr="$TEST_TMP/d7.jsonl"; : > "$tr"
(
  cd "$repo"
  git checkout -q -b fix/null-normalize
  sed -i 's/return undefined; \/\/ BUG: spec says ""/return "";/' lib/normalize.js
  git -c user.name=T -c user.email=t@t commit -aqm "fix: null → empty string" --no-verify
  git checkout -q develop
  git -c user.name=T -c user.email=t@t merge -q --no-ff -m "Merge branch 'fix/null-normalize'" fix/null-normalize
) >/dev/null 2>&1
out=$(run_markers d7-fix-vs-l-boundary "$repo" "$tr")
assert_true "$out" f3_fix_branch_flow "d7 compliant"
assert_true "$out" f1_stays_fix_no_tracking "d7 compliant"
mkdir -p "$repo/docs/plans"; printf '# plan\n' > "$repo/docs/plans/p.md"  # cheat: over-escalated to L
out=$(run_markers d7-fix-vs-l-boundary "$repo" "$tr")
assert_false "$out" f1_stays_fix_no_tracking "d7 cheat(plan file)"

echo "=== prompt-hygiene leakage grep (forbidden marker vocabulary; ALLOW: run-tests.sh — task-owned test entry point told to all arms identically) ==="
FORBIDDEN=('S-scope-gate' 'L-1.5' 'L-1.6' 'L-5' 'H-9' 'ongoing-maintenance' 'session-start-sha' 'dev-flow' 'quality-pipeline' 'finish-flow' 'blockedBy' 'fix/' 'hotfix/' '驗證合約')
for t in "$BASE/tasks"/*/task.md; do
  for tok in "${FORBIDDEN[@]}"; do
    if grep -qF "$tok" "$t"; then fail "leakage: '$tok' in $t"; fi
  done
done

echo "PASS: skill-onoff markers three-way probes"
