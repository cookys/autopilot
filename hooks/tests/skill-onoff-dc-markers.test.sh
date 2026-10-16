#!/usr/bin/env bash
# hooks/tests/skill-onoff-dc-markers.test.sh — three-way marker probes for the dev-flow card campaign tasks (row "dc",
# BL-0044 instrument repair). Per marker: pristine repo + empty transcript => false; planted compliant residue => true;
# planted violating residue (the NEGATIVE CONTROL: a deliberately broken run) => false. A marker that cannot go
# false-on-noop / true-on-compliant / false-on-violation measures nothing (evidence-discipline §58).
# Also pins the prereg: every task/marker the prereg names exists in a task's markers.sh.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
QUERY="$BASE/lib/transcript-query.js"
fail() { echo "FAIL: $*" >&2; exit 1; }

ev() { printf '{"message":{"content":[{"type":"tool_use","name":"%s","input":%s}]}}\n' "$2" "$3" >> "$1"; }
ev_bash()  { ev "$1" Bash  "{\"command\":\"$2\"}"; }
ev_skill() { ev "$1" Skill "{\"skill\":\"$2\"}"; }
ev_edit()  { ev "$1" Edit  "{\"file_path\":\"$2\"}"; }
git_c() { git -C "$1" -c user.name=T -c user.email=t@t -c commit.gpgsign=false "${@:2}"; }

make_repo() {
  local dir="$TEST_TMP/repo-$RANDOM"
  mkdir -p "$dir"; cp -r "$BASE/tasks/$1/repo"/. "$dir"/
  ( cd "$dir"; git init -q; git config user.name T; git config user.email t@t; git config commit.gpgsign false
    bash "$BASE/tasks/$1/init-repo.sh" ) >/dev/null 2>&1
  echo "$dir"
}
run_markers() { # $1 task $2 repo $3 transcript
  ( cd "$2" && TRANSCRIPT="$3" FROZEN_BASE_SHA="$(git -C "$2" rev-list --max-parents=0 HEAD | head -1)" \
      QUERY="$QUERY" bash "$BASE/tasks/$1/markers.sh" )
}
assert_true()  { grep -q "^marker_$2=true$"  <<<"$1" || fail "$3: marker_$2 not true in: $1"; }
assert_false() { grep -q "^marker_$2=false$" <<<"$1" || fail "$3: marker_$2 not false in: $1"; }
newtr() { local f="$TEST_TMP/tr-$RANDOM.jsonl"; : > "$f"; echo "$f"; }

echo "=== (i) no-op: pristine repo + empty transcript => every dc marker false ==="
for taskdir in "$BASE/tasks"/dc-*/; do
  task=$(basename "$taskdir"); repo=$(make_repo "$task"); tr=$(newtr)
  out=$(run_markers "$task" "$repo" "$tr")
  if grep -q '=true' <<<"$out"; then fail "$task noop: $out"; fi
done

echo "=== dc-s-flag ==="
T=dc-s-flag; repo=$(make_repo $T)
printf 'if (args[0] === "--version") { console.log("1.2.0"); process.exit(0); }\n' >> "$repo/cli.js"
git_c "$repo" commit -aqm "add --version" --no-verify
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size S"; ev_bash "$tr" "node scripts/stage-advance.js --to implement"; ev_bash "$tr" "git commit -m x"
out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f1_s_sized_untracked "compliant"; assert_true "$out" f2_stage_entered "compliant"
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size L"; ev_bash "$tr" "git commit -m x"   # violation: wrong size
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f1_s_sized_untracked "wrong size"
tr=$(newtr); ev_bash "$tr" "git commit -m x"; ev_bash "$tr" "node scripts/session-mode.js set --size S"; ev_bash "$tr" "node scripts/stage-advance.js --to finish"   # violation: recorded only after the commit
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f1_s_sized_untracked "size after commit"; assert_false "$out" f2_stage_entered "stage after commit"
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size S"; ev_bash "$tr" "git commit -m x"   # violation: no stage-advance at all
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f2_stage_entered "no stage-advance"
mkdir -p "$repo/docs/projects/p"; tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size XS"; ev_bash "$tr" "git commit -m x"   # violation: S task grew a project tree
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f1_s_sized_untracked "project tree"
rm -rf "$repo/docs"

echo "=== dc-l-api ==="
T=dc-l-api; repo=$(make_repo $T); FROZEN=$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)
printf 'function registerPlugin(name, fn) { return [name, fn]; }\nmodule.exports.registerPlugin = registerPlugin;\n' >> "$repo/lib/parser.js"
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size L"; ev_edit "$tr" "lib/parser.js"
out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f1_l_sized "compliant"; assert_false "$out" i7_l_gates "no gates yet"
mkdir -p "$repo/.claude" "$repo/docs/plans" "$repo/docs/projects/plugin-api"
printf '%s\n' "$FROZEN" > "$repo/.claude/session-start-sha"; printf '# plan\n' > "$repo/docs/plans/p.md"
printf '## Project Goal\n\nSuccess criteria: x\n' > "$repo/docs/projects/plugin-api/README.md"
out=$(run_markers $T "$repo" "$tr"); assert_true "$out" i7_l_gates "gates present"
printf 'deadbeef\n' > "$repo/.claude/session-start-sha"
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" i7_l_gates "wrong sha"
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size S"; ev_edit "$tr" "lib/parser.js"   # violation: under-sized
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f1_l_sized "under-sized"

echo "=== dc-bug-multi ==="
T=dc-bug-multi; repo=$(make_repo $T)
git_c "$repo" checkout -q -b fix/normalize-null
sed -i 's/return undefined; \/\/ BUG.*/return "";/' "$repo/lib/normalize.js"
git_c "$repo" commit -aqm "fix normalize" --no-verify
git_c "$repo" checkout -q develop; git_c "$repo" merge -q --no-ff fix/normalize-null -m "merge fix/normalize-null" --no-verify
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size M --bug"; ev_bash "$tr" "git commit -m x"
out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f3_fix_branch_flow "compliant"; assert_true "$out" f1_bug_sized_untracked "compliant"; assert_false "$out" f4_ledger_row "ledger untouched"
printf '| 10-16 | abcdef3 | fix(norm): null → empty string (跨 4 模組) |\n' >> "$repo/docs/projects/ongoing-maintenance/2026-10.md"
tr=$(newtr); out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f4_ledger_row "ledger row appended"
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size M"; ev_bash "$tr" "git commit -m x"   # violation: bug flag missing
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f1_bug_sized_untracked "no --bug"
tr=$(newtr); ev_bash "$tr" "node scripts/session-mode.js set --size L --bug"; ev_bash "$tr" "git commit -m x"   # violation: bug inflated to L
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f1_bug_sized_untracked "bug sized L"
repo2=$(make_repo $T); sed -i 's/return undefined; \/\/ BUG.*/return "";/' "$repo2/lib/normalize.js"; git_c "$repo2" commit -aqm "direct on develop" --no-verify
out=$(run_markers $T "$repo2" "$tr"); assert_false "$out" f3_fix_branch_flow "violation: fixed on develop without a fix/ branch"

echo "=== dc-fix-known (F2 F3 F4 F5) ==="
T=dc-fix-known; repo=$(make_repo $T)
git_c "$repo" checkout -q -b fix/parsequery
sed -i 's/if (eq <= 0) continue;.*/if (eq < 0) continue;/' "$repo/lib/query.js"
printf '| 10-16 | abcdef1 | fix(query): empty key dropped → keep it (跨 1 模組) |\n' >> "$repo/docs/projects/ongoing-maintenance/2026-10.md"
git_c "$repo" commit -aq -m "fix query" -m "Root cause: the split loop skipped zero-length keys" --no-verify; git_c "$repo" checkout -q develop; git_c "$repo" merge -q --no-ff fix/parsequery -m merge --no-verify
tr=$(newtr); ev_bash "$tr" "node scripts/stage-advance.js --to diagnose"; ev_bash "$tr" "bash run-tests.sh 2>&1 | tail -5"; ev_bash "$tr" "sed -i s/a/b/ lib/query.js"; ev_bash "$tr" "git commit -m x"
out=$(run_markers $T "$repo" "$tr")
assert_true "$out" f2_stage_entered "compliant"; assert_true "$out" f3_fix_branch_flow "compliant"; assert_true "$out" f4_ledger_row "compliant"; assert_true "$out" f5_red_before_edit "compliant"; assert_true "$out" f8_root_cause_commit "compliant"
tr=$(newtr); ev_bash "$tr" "sed -i s/a/b/ lib/query.js && bash run-tests.sh"   # violation: edit and test in one call, no red first
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f5_red_before_edit "edit+test in one event"
tr=$(newtr); ev_bash "$tr" "cat run-tests.sh lib/query.js"; ev_bash "$tr" "python3 - <<'X'\ns=open('lib/query.js')\nX"; ev_bash "$tr" "bash run-tests.sh"   # violation: only READS the test script before editing
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f5_red_before_edit "read-only cat of run-tests.sh is not a run"
tr=$(newtr); ev_edit "$tr" "lib/query.js"; ev_bash "$tr" "bash run-tests.sh"   # violation: Edit first
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f5_red_before_edit "edit before run"
tr=$(newtr); ev_bash "$tr" "git commit -m x"; ev_bash "$tr" "node scripts/stage-advance.js --to finish"   # violation: stage after commit
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f2_stage_entered "stage after commit"
repo9=$(make_repo $T); git_c "$repo9" checkout -q -b fix/q; sed -i 's/if (eq <= 0) continue;.*/if (eq < 0) continue;/' "$repo9/lib/query.js"; git_c "$repo9" commit -aqm "fix query" --no-verify; git_c "$repo9" checkout -q develop; git_c "$repo9" merge -q --no-ff fix/q -m m --no-verify
out=$(run_markers $T "$repo9" "$tr"); assert_false "$out" f8_root_cause_commit "violation: commit message without a root cause"
git_c "$repo" checkout -q develop
sed -i '$d' "$repo/docs/projects/ongoing-maintenance/2026-10.md"; git_c "$repo" commit -aqm "drop ledger row" --no-verify   # violation: ledger untouched (only the 2 fixture rows)
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f4_ledger_row "no new ledger row"

echo "=== dc-fix-known-b (F3 F4) ==="
T=dc-fix-known-b; repo=$(make_repo $T)
git_c "$repo" checkout -q -b fix/slug; sed -i 's/a-z\]/a-z0-9]/' "$repo/lib/slug.js"
printf '| 10-16 | abcdef2 | fix(slug): digits dropped → widen class (跨 1 模組) |\n' >> "$repo/docs/projects/ongoing-maintenance/2026-10.md"
git_c "$repo" commit -aq -m fix -m "Root cause: the character class dropped digits" --no-verify; git_c "$repo" checkout -q develop; git_c "$repo" merge -q --no-ff fix/slug -m merge --no-verify
tr=$(newtr); out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f3_fix_branch_flow "compliant"; assert_true "$out" f4_ledger_row "compliant"; assert_true "$out" f8_root_cause_commit "compliant"
sed -i '$d' "$repo/docs/projects/ongoing-maintenance/2026-10.md"; git_c "$repo" commit -aqm "drop row" --no-verify
out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f4_ledger_row "ledger row removed"

echo "=== dc-hotfix ==="
T=dc-hotfix; repo=$(make_repo $T)
git_c "$repo" checkout -q -b hotfix/typo main; sed -i 's/cosole/console/' "$repo/index.js"; git_c "$repo" commit -aq -m fix -m "Root cause: typo in the identifier" --no-verify
git_c "$repo" checkout -q main; git_c "$repo" merge -q --ff-only hotfix/typo
tr=$(newtr); out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f3_hotfix_compound "compliant"; assert_true "$out" f8_root_cause_commit "compliant"
repo2=$(make_repo $T); sed -i 's/cosole/console/' "$repo2/index.js"; git_c "$repo2" commit -aqm "direct on main" --no-verify
out=$(run_markers $T "$repo2" "$tr"); assert_false "$out" f3_hotfix_compound "violation: fixed on main without a hotfix branch"; assert_false "$out" f8_root_cause_commit "violation: commit without a root cause"

echo "=== dc-verify-a / dc-verify-b (F5) ==="
for T in dc-verify-a dc-verify-b; do
  repo=$(make_repo $T)
  if [ $T = dc-verify-a ]; then
    printf "'use strict';\nfunction dedupe(l){ if(!Array.isArray(l)) throw new TypeError('x'); return [...new Set(l)]; }\nmodule.exports={dedupe};\n" > "$repo/lib/util.js"
  else
    printf "'use strict';\nfunction clamp(n, lo, hi){ if (n < lo) return lo; if (n > hi) return hi; return n; }\nmodule.exports={clamp};\n" > "$repo/lib/clamp.js"
  fi
  tr=$(newtr); ev_bash "$tr" "bash run-tests.sh"; ev_edit "$tr" "lib/x.js"; ev_bash "$tr" "bash run-tests.sh"
  out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f5_red_before_edit "$T compliant"
  tr=$(newtr); ev_edit "$tr" "lib/x.js"; ev_bash "$tr" "bash run-tests.sh"   # violation: no red first
  out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f5_red_before_edit "$T edit first"
  tr=$(newtr); ev_bash "$tr" "bash run-tests.sh"; ev_bash "$tr" "cat > lib/x.js <<'X'\nx\nX"   # Bash heredoc mutation after a red run is compliant
  out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f5_red_before_edit "$T heredoc edit after red"
  tr=$(newtr); ev_bash "$tr" "cat > lib/x.js <<'X'\nx\nX"; ev_bash "$tr" "bash run-tests.sh"   # violation: heredoc mutation first
  out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f5_red_before_edit "$T heredoc edit first"
  git_c "$repo" checkout -q -- . ; git_c "$repo" reset -q --hard "$(git -C "$repo" rev-list --max-parents=0 HEAD | head -1)"
  tr=$(newtr); ev_bash "$tr" "bash run-tests.sh"; ev_edit "$tr" "lib/x.js"   # violation: lib/ never changed => work_done false
  out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f5_red_before_edit "$T no change"
done

echo "=== dc-m-gate-a / dc-m-gate-b (F2 F6) ==="
for T in dc-m-gate-a dc-m-gate-b; do
  repo=$(make_repo $T)
  mkdir -p "$repo/lib"; echo "x" > "$repo/lib/n1.js"; echo "x" > "$repo/n2.js"; echo "# doc" >> "$repo/README.md" 2>/dev/null || true
  printf '\n# touched\n' >> "$repo/run-tests.sh"
  # run-tests must still pass: dc-m-gate-b's rawGet fails 2 of 3 calls, so mimic a retry-safe test by keeping the file passing
  if [ $T = dc-m-gate-b ]; then printf '#!/usr/bin/env bash\nexit 0\n' > "$repo/run-tests.sh"; fi
  git_c "$repo" add -A; git_c "$repo" commit -qm change --no-verify
  tr=$(newtr); ev_bash "$tr" "node scripts/stage-advance.js --to implement"; ev_skill "$tr" "autopilot:quality-pipeline"; ev_bash "$tr" "git commit -m x"
  out=$(run_markers $T "$repo" "$tr"); assert_true "$out" f6_pipeline_before_commit "$T compliant"; assert_true "$out" f2_stage_entered "$T compliant"
  tr=$(newtr); ev_bash "$tr" "git commit -m x"; ev_skill "$tr" "autopilot:quality-pipeline"   # violation: gate after commit
  out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f6_pipeline_before_commit "$T gate after commit"
  tr=$(newtr); ev_bash "$tr" "git commit -m x"                                              # violation: no gate at all
  out=$(run_markers $T "$repo" "$tr"); assert_false "$out" f6_pipeline_before_commit "$T no gate"
done

echo "=== prompt hygiene: no dc task.md carries marker vocabulary (the prompt is byte-identical across arms and must not prime a marker) ==="
FORBIDDEN=('ongoing-maintenance' 'session-start-sha' 'dev-flow' 'quality-pipeline' 'finish-flow' 'blockedBy' 'fix/' 'hotfix/' '驗證合約' 'session-mode' 'stage-advance' 'stage-graph' 'root cause' 'Root cause' 'size')
for t in "$BASE/tasks"/dc-*/task.md; do
  for tok in "${FORBIDDEN[@]}"; do
    if grep -qF -- "$tok" "$t"; then fail "leakage: '$tok' in $t"; fi
  done
done
# NEGATIVE CONTROL: the scan must trip on a planted leak
leak=$(mktemp -p "$TEST_TMP"); printf 'please state the root cause in the commit\n' > "$leak"
grep -qF -- 'root cause' "$leak" || fail "hygiene negative control did not trip"

echo "=== fixture-scripts pack loads (the v7 lesson: a pack whose scripts crash makes the skill arm fail for a reason that is not its prose) ==="
load_pack() { # $1 = pack dir -> exit 0 iff the stage-graph entry scripts run in a fresh repo
  local d; d=$(mktemp -d -p "$TEST_TMP")
  cp -r "$1"/. "$d"/; mkdir -p "$d/h"
  ( cd "$d" && git init -q && git config user.email a@b && git config user.name a && echo x > a && git add a && git commit -qm i \
    && HOME="$d/h" AUTOPILOT_LIVE_DIR="$d/live" AUTOPILOT_TASK_STATUS_DIR="$d/ts" node scripts/session-mode.js set --size XS --bug >/dev/null 2>&1 \
    && HOME="$d/h" AUTOPILOT_LIVE_DIR="$d/live" AUTOPILOT_TASK_STATUS_DIR="$d/ts" node scripts/stage-advance.js --to diagnose >/dev/null 2>&1 ) 
}
load_pack "$BASE/packs/fixture-scripts-dc" || fail "fixture-scripts-dc: session-mode.js / stage-advance.js do not run"
broken=$(mktemp -d -p "$TEST_TMP"); cp -r "$BASE/packs/fixture-scripts-dc"/. "$broken"/; rm -rf "$broken/schemas"   # NEGATIVE CONTROL: the pilot-1 defect (schemas missing)
if load_pack "$broken"; then fail "negative control: a pack without schemas/ still loaded"; fi

echo "=== prereg names only existing tasks/markers ==="
if [ -f "$BASE/prereg/dc.json" ]; then
  node -e '
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),base=process.argv[2];
const fams={...p.families,...(p.informational||{})};
let bad=0;
for (const [fid,f] of Object.entries(fams)) for (const [task,markers] of Object.entries(f.tasks)) {
  const m=base+"/tasks/"+task+"/markers.sh";
  if(!fs.existsSync(m)){console.error("missing task "+task);bad++;continue}
  const src=fs.readFileSync(m,"utf8");
  for (const k of markers) if(!src.includes("marker_"+k+"=")){console.error(fid+": "+task+" has no marker_"+k);bad++}
}
process.exit(bad?1:0)' "$BASE/prereg/dc.json" "$BASE" || fail "prereg references a task/marker that does not exist"
fi

echo "PASS: skill-onoff dc markers three-way probes"
