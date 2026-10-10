#!/usr/bin/env bash
# hooks/tests/skill-onoff-g8.test.sh — spend-free proof of the stage-graph-g8 eval instrument
# (evals/skill-onoff/prereg/stage-graph-g8.{md,json}). No live model cell is run: every transcript is SYNTHETIC
# (stream-json tool_use / tool_result events, the claude -p shape) and goes through the REAL tasks/g8-*/markers.sh
# -> lib/g8-cell.js (-> the frozen lib/g67-cell.js), the REAL score-g67.js and the REAL run-g8-campaign.js
# (-> run-g67-campaign.js, stub runner, synthetic packs).
#
# Asserts:
#   1. g8_new_task marker: pass cases (second set with --new-task + literal --size, level flag, first set itself new-task,
#      line continuation, refused call) and fail cases (no second set, plain second set, lone --new-task, no/invalid/variable
#      size, flag only in prose or a read of the script, --new-task=1, --new-task-x)
#   2. fixtures: tasks exist, share the g6 fixture, briefs carry no answer vocabulary; the fixture-scripts-g8-v2 overlay really
#      runs `set --size` then `set --new-task --size` (task_seq 2, stage cleared)
#   3. score-g67.js verdicts on the g8 prereg: SHIP / NOT-SHIP / STOP / INSTRUMENT-INVALID
#   4. run-g8-campaign.js: dry run, empty allowed list refused, --check-arms (clean + planted reds), stub e2e (STOP, resume, SHIP),
#      unpinned claude refused, unstamped shas refused
#   5. stamp-prereg.js on a synthetic root
set -euo pipefail
AUTOPILOT_TEST_LIB_HELPERS_ONLY=1 . "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
PREREG_REAL="$BASE/prereg/stage-graph-g8.json"
QUERY="$BASE/lib/transcript-query.js"
TEST_TMP=$(mktemp -d -t "skill-onoff-g8-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# a copy of the real prereg with the to-be-filled bits filled in synthetically (allowed list; shas stay null)
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.allowed_arm_difference.files=["l4/SKILL.md"];for(const a of ["off","on"])j.arm_manifests[a].sha256=null;fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG_REAL" "$TEST_TMP/prereg-filled.json"
PREREG="$TEST_TMP/prereg-filled.json"

# ---- synthetic transcript builder: mk <out> <skill|-> <cmd>... ; a cmd prefixed "ERR:" gets an is_error result ----
cat > "$TEST_TMP/mk.js" <<'NODE'
const fs = require('fs');
const [out, skill, ...cmds] = process.argv.slice(2);
const lines = [];
let n = 0;
if (skill !== '-') lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_skill', name: 'Skill', input: { skill } }] } }));
for (const c of cmds) {
  n += 1;
  const err = c.startsWith('ERR:');
  const cmd = err ? c.slice(4) : c;
  lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu_${n}`, name: 'Bash', input: { command: cmd } }] } }));
  lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `tu_${n}`, is_error: err, content: err ? 'refused' : '{"ok":true}' }] } }));
}
fs.writeFileSync(out, lines.join('\n') + '\n');
NODE

marker_of() { # $1 task  $2 transcript: runs the REAL task markers.sh, echoes the marker value
  local t="$1" tr="$2" out
  out=$(cd "$TEST_TMP" && TRANSCRIPT="$tr" FROZEN_BASE_SHA=none QUERY="$QUERY" ONOFF_LIB="$BASE/lib" bash "$BASE/tasks/$t/markers.sh") || fail "markers.sh failed for $t"
  grep -q '^marker_g8_new_task=' <<<"$out" || fail "no marker_g8_new_task line for $t: $out"
  sed -n 's/^marker_g8_new_task=//p' <<<"$out"
}
expect() { # $1 label  $2 want  $3 task  $4 skill  rest cmds
  local label="$1" want="$2" task="$3" skill="$4"; shift 4
  node "$TEST_TMP/mk.js" "$TEST_TMP/tr.jsonl" "$skill" "$@"
  local got; got=$(marker_of "$task" "$TEST_TMP/tr.jsonl")
  [ "$got" = "$want" ] || fail "$label: $task expected $want got $got"
}
SM='node scripts/session-mode.js'

echo "=== 1. g8_new_task marker ==="
expect "dev-flow: set then --new-task"   true  g8-flow autopilot:dev-flow "$SM set --size S" "git commit -am hi" "$SM set --new-task --size S"
expect "l4: level set then --new-task"   true  g8-l4   autopilot:l4 "$SM set --level l4 --size XS --repo-root ." "git commit -am hi" "$SM set --new-task --size M --level l4 --repo-root ."
expect "flags in any order"              true  g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --size L --new-task --urgent"
expect "--bug second task"               true  g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task --bug --size XS"
expect "quoted script path"              true  g8-flow autopilot:dev-flow "node \"\$plugin/scripts/session-mode.js\" set --size S" "node \"\$plugin/scripts/session-mode.js\" set --new-task --size XL"
expect "first set is itself --new-task"  true  g8-flow autopilot:dev-flow "$SM set --new-task --size S" "$SM set --new-task --size S"
expect "line continuation"               true  g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task \\
  --size S \\
  --repo-root ."
expect "two calls in one command"        true  g8-flow autopilot:dev-flow "$SM set --size S && git commit -am x && $SM set --new-task --size S"
expect "refused still judged on the command text" true g8-flow autopilot:dev-flow "$SM set --size S" "ERR:$SM set --new-task --size S"
expect "after unrelated calls"           true  g8-l4 autopilot:l4 "ls" "$SM set --level l4 --size S" "git status" "cat cli.js" "$SM set --new-task --size S"
expect "no second set (old text, one set)"       false g8-flow autopilot:dev-flow "$SM set --size S" "git commit -am hi"
expect "plain second set (old text)"             false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --size S"
expect "plain second set with level"             false g8-l4 autopilot:l4 "$SM set --level l4 --size S" "$SM set --level l4 --size M"
expect "lone --new-task is not 'after the first'" false g8-flow autopilot:dev-flow "$SM set --new-task --size S"
expect "--new-task without a size"               false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task"
expect "size is a shell variable"                false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task --size \"\$SZ\""
expect "invalid size"                            false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task --size XXL"
expect "lowercase size"                          false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task --size s"
expect "--new-task=1 is not the bare flag"       false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task=1 --size S"
expect "--new-task-x is not the flag"            false g8-flow autopilot:dev-flow "$SM set --size S" "$SM set --new-task-x --size S"
expect "other subcommand"                        false g8-flow autopilot:dev-flow "$SM set --size S" "$SM status --new-task --size S"
expect "flag only in prose / reads"              false g8-flow autopilot:dev-flow "$SM set --size S" "echo 'session-mode.js set --new-task --size S'" "cat scripts/session-mode.js" "grep -n 'set --new-task --size S' scripts/session-mode.js"
expect "no session-mode call at all"             false g8-flow -               "ls"
expect "empty transcript"                        false g8-flow -
# a truncated final line (timeout kill mid-write) is skipped, earlier calls still count
node "$TEST_TMP/mk.js" "$TEST_TMP/tr.jsonl" autopilot:dev-flow "$SM set --size S" "$SM set --new-task --size S"
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_9","name":"Bash","input":{"command":"node scr' >> "$TEST_TMP/tr.jsonl"
[ "$(marker_of g8-flow "$TEST_TMP/tr.jsonl")" = true ] || fail "truncated final line must not hide the second-task call"

echo "=== 2. fixtures ==="
TASKS=$(node -e 'process.stdout.write(Object.keys(require(process.argv[1]).tasks).join(" "))' "$PREREG_REAL")
[ "$TASKS" = "g8-flow g8-l4" ] || fail "prereg tasks: $TASKS"
for t in $TASKS; do
  for f in task.md init-repo.sh markers.sh; do [ -f "$BASE/tasks/$t/$f" ] || fail "$t/$f missing"; done
  [ -d "$BASE/tasks/$t/repo" ] || fail "$t/repo missing"
  [ "$(cd "$BASE/tasks/$t/repo" && pwd -P)" = "$(cd "$BASE/tasks/g6-l4/repo" && pwd -P)" ] || fail "$t/repo must be the g6 fixture (shared, not copied)"
  for tok in 'session-mode' 'new-task' 'new_task' '--size' 'XS' 'stage' 'dispatch' '/l4' '/l5' '/l6' 'dev-flow' 'finish-flow' 'hetero' 'foreman' 'level'; do
    if grep -qF -- "$tok" "$BASE/tasks/$t/task.md"; then fail "leakage: '$tok' in $t/task.md"; fi
  done
  grep -qF 'begin a new task' "$BASE/tasks/$t/task.md" || fail "$t/task.md must say outright that the second job is a new task"
  grep -qF -- '--shout' "$BASE/tasks/$t/task.md" || fail "$t/task.md must name the second job"
done
cmp -s "$BASE/tasks/g8-flow/task.md" "$BASE/tasks/g8-l4/task.md" || fail "the two g8 briefs must be byte-identical (only the prefix differs)"
node -e 'const p=require(process.argv[1]);if(p.tasks["g8-flow"].prefix!=="Use dev-flow:"||p.tasks["g8-l4"].prefix!=="Use l4:")process.exit(1);if(p.tasks["g8-flow"].skill!=="dev-flow"||p.tasks["g8-l4"].skill!=="l4")process.exit(1)' "$PREREG_REAL" || fail "prefixes / check-skills"
node -e 'const p=require(process.argv[1]);const t=(s)=>/m$/.test(s)?Number(s.slice(0,-1))*60:Number(s);for(const k of Object.keys(p.tasks)) if(!p.tasks[k].timeout||t(p.tasks[k].timeout)<600)process.exit(1)' "$PREREG_REAL" || fail "each cell needs >= 10m (two jobs)"
# the fixture builds through the real harness order (files, git init, init-repo.sh) and its tests pass at base
F="$TEST_TMP/g8repo"; mkdir -p "$F"; cp -r "$BASE/tasks/g8-flow/repo"/. "$F"/
( cd "$F" && git init -q && git config user.name t && git config user.email t@t && git config commit.gpgsign false && bash "$BASE/tasks/g8-flow/init-repo.sh" )
[ -z "$(git -C "$F" status --porcelain)" ] || fail "g8 fixture tree must be clean"
[ "$(git -C "$F" rev-parse --abbrev-ref HEAD)" = develop ] || fail "g8 fixture HEAD must be develop"
( cd "$F" && bash run-tests.sh >/dev/null ) || fail "g8 fixture run-tests.sh must be green at base"
# the scripts pack: frozen, from the registered ref, and the overlay (sg first, g8 on top) really does set --new-task
node -e '
const m=require(process.argv[1]);const meta=(m.pack_meta||{})["fixture-scripts-g8-v2"];
if(!meta||!/^ac3ccd07/.test(meta.ref))process.exit(1);
if(!m.packs["fixture-scripts-g8-v2"]["fixture-scripts-g8-v2/scripts/session-mode.js"])process.exit(2)' "$BASE/packs/manifest.json" || fail "fixture-scripts-g8-v2 must be frozen from ac3ccd07 and carry scripts/session-mode.js"
grep -q -- "--new-task" "$BASE/packs/fixture-scripts-g8-v2/scripts/session-mode.js" || fail "pack session-mode.js has no --new-task"
for a in off on; do
  node -e 'const m=require(process.argv[1]);if(JSON.stringify(m.fixture_scripts)!==JSON.stringify(["fixture-scripts-sg","fixture-scripts-g8-v2"])||!m.files.includes("fixture-scripts-g8-v2"))process.exit(1)' "$BASE/arms/g8/$a.json" || fail "arms/g8/$a.json must overlay fixture-scripts-g8-v2 in the repo root AND the plugin root"
done
OV="$TEST_TMP/overlay"; mkdir -p "$OV/home"
cp -r "$BASE/packs/fixture-scripts-sg"/. "$OV"/; cp -r "$BASE/packs/fixture-scripts-g8-v2"/. "$OV"/
( cd "$OV" && git init -q && git config user.name t && git config user.email t@t && git config commit.gpgsign false && git checkout -q -b develop && echo x > f && git add -A && git commit -q -m base )
ovrun() { ( cd "$OV" && HOME="$OV/home" CLAUDE_CODE_SESSION_ID=g8-test AUTOPILOT_SESSION_MODE_DIR="$OV/sm" AUTOPILOT_LIVE_DIR="$OV/live" node scripts/session-mode.js "$@" 2>/dev/null ); }
ovrun set --size M >/dev/null || fail "overlay: set --size M"
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.stage="build";j.unit="u1";fs.writeFileSync(p,JSON.stringify(j))' "$OV/sm/g8-test.json"
ovrun set --size S >/dev/null && fail "overlay: a plain lower --size must be refused (size only moves up)"
ovrun set --new-task --size S >/dev/null || fail "overlay: set --new-task --size S must be accepted"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));if(j.size!=="S"||j.task_seq!==2||"stage" in j||"unit" in j||!j.task_started_at)process.exit(1)' "$OV/sm/g8-test.json" || fail "overlay: --new-task must lower the size, bump task_seq to 2 and clear stage/unit"

echo "=== 3. score-g67.js verdicts on the g8 prereg ==="
cat > "$TEST_TMP/rows.js" <<'NODE'
// rows.js <out> <spec-json>: spec = {off:{task:[passes]}, on:{...}, ver, ...} builds one clean row per cell
const fs = require('fs');
const [out, specJson] = process.argv.slice(2);
const s = JSON.parse(specJson);
const prereg = JSON.parse(fs.readFileSync(process.env.PREREG, 'utf8'));
const rows = [];
for (const [task, T] of Object.entries(prereg.tasks)) for (const arm of ['off', 'on']) for (let rep = 1; rep <= 3; rep++) {
  const pass = ((s[arm] || {})[task] || [])[rep - 1] === 1;
  const r = { task_id: task, arm, model: 'sonnet', runner: 'cc', runner_version: s.ver || '2.1.296 (Claude Code)', rep, duration_s: 60, frozen_base_sha: 'x',
    markers: { [T.marker]: pass }, skill_invoked: s.noskill ? false : true, check_skill: T.skill, failure_class: null, failure_cause: null, arm_manifest_sha256: arm === 'on' ? (s.onsha || 'b'.repeat(64)) : (s.offsha || 'a'.repeat(64)) };
  if (s.drop && s.drop.includes(`${task}|${arm}|${rep}`)) continue;
  if (s.infra && s.infra.includes(`${task}|${arm}|${rep}`)) { r.failure_class = 'infra_fail'; r.failure_cause = 'runner_timeout'; }
  rows.push(r);
}
if (s.rerun) for (const k of s.rerun) { const [task, arm, rep] = k.split('|'); rows.push({ ...rows.find((r) => r.task_id === task && r.arm === arm), rep: Number(rep), failure_class: null, failure_cause: null }); }
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
NODE
export PREREG
ALL_ON='{"g8-flow":[1,1,1],"g8-l4":[1,1,1]}'
score() { # $1 spec json -> echoes "<exit> <verdict>"
  node "$TEST_TMP/rows.js" "$TEST_TMP/rows.jsonl" "$1"
  local o rc=0
  o=$(node "$BASE/score-g67.js" --prereg "$PREREG" --results "$TEST_TMP/rows.jsonl") || rc=$?
  echo "$rc $(node -e 'process.stdout.write(JSON.parse(process.argv[1]).verdict)' "$o")"
}
sexp() { local got; got=$(score "$2"); [ "$got" = "$3" ] || fail "$1: want '$3' got '$got'"; }
sexp "SHIP all 3/3 vs 0/3"              "{\"on\":$ALL_ON,\"off\":{}}" "0 SHIP"
sexp "SHIP at the boundary 2/3 vs 1/3"  '{"on":{"g8-flow":[1,1,0],"g8-l4":[0,1,1]},"off":{"g8-flow":[1,0,0],"g8-l4":[0,0,1]}}' "0 SHIP"
sexp "NOT-SHIP one ON at 1/3"           '{"on":{"g8-flow":[1,1,1],"g8-l4":[1,0,0]},"off":{}}' "3 NOT-SHIP"
sexp "NOT-SHIP one OFF at 2/3"          "{\"on\":$ALL_ON,\"off\":{\"g8-l4\":[1,1,0]}}" "3 NOT-SHIP"
sexp "STOP missing cell"                "{\"on\":$ALL_ON,\"off\":{},\"drop\":[\"g8-l4|on|2\"]}" "4 STOP"
sexp "STOP infra_fail only"             "{\"on\":$ALL_ON,\"off\":{},\"infra\":[\"g8-flow|off|1\"]}" "4 STOP"
sexp "rerun clears the STOP"            "{\"on\":$ALL_ON,\"off\":{},\"infra\":[\"g8-flow|off|1\"],\"rerun\":[\"g8-flow|off|1\"]}" "0 SHIP"
sexp "INVALID mixed-in other version"   "{\"on\":$ALL_ON,\"off\":{},\"ver\":\"2.1.295 (Claude Code)\"}" "5 INSTRUMENT-INVALID"
sexp "INVALID V1 skill not invoked"     "{\"on\":$ALL_ON,\"off\":{},\"noskill\":true}" "5 INSTRUMENT-INVALID"
sexp "INVALID identical arm shas"       "{\"on\":$ALL_ON,\"off\":{},\"onsha\":\"$(printf 'a%.0s' $(seq 64))\"}" "5 INSTRUMENT-INVALID"
# mixed Claude Code versions inside one results file => the test is void
node "$TEST_TMP/rows.js" "$TEST_TMP/rows.jsonl" "{\"on\":$ALL_ON,\"off\":{}}"
node -e 'const fs=require("fs");const p=process.argv[1];const L=fs.readFileSync(p,"utf8").trim().split("\n");const j=JSON.parse(L[3]);j.runner_version="2.1.295 (Claude Code)";L[3]=JSON.stringify(j);fs.writeFileSync(p,L.join("\n")+"\n")' "$TEST_TMP/rows.jsonl"
rc=0; o=$(node "$BASE/score-g67.js" --prereg "$PREREG" --results "$TEST_TMP/rows.jsonl") || rc=$?
[ "$rc" = 5 ] && grep -q 'mixed runner versions' <<<"$o" || fail "mixed runner versions must be INSTRUMENT-INVALID (rc=$rc $o)"
# a registered arm sha that the rows do not match
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.arm_manifests.on.sha256="c".repeat(64);fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG" "$TEST_TMP/prereg-pinned.json"
node "$TEST_TMP/rows.js" "$TEST_TMP/rows.jsonl" "{\"on\":$ALL_ON,\"off\":{}}"
rc=0; node "$BASE/score-g67.js" --prereg "$TEST_TMP/prereg-pinned.json" --results "$TEST_TMP/rows.jsonl" >/dev/null || rc=$?
[ "$rc" = 5 ] || fail "registered arm sha mismatch must be INSTRUMENT-INVALID (rc=$rc)"
# the registered rule itself
node -e 'const p=require(process.argv[1]);const T=p.thresholds;if(T.on_min_reps!==2||T.off_max_reps!==1||p.reps!==3||p.runner_version_pin!=="2.1.296 (Claude Code)"||p.model!=="sonnet")process.exit(1);if(JSON.stringify(p.changes)!==JSON.stringify({G8:["g8-flow","g8-l4"]}))process.exit(2)' "$PREREG_REAL" || fail "registered rule drifted from the pre-registration"

echo "=== 4. run-g8-campaign.js ==="
out=$(node "$BASE/run-g8-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run)
[ "$(grep -c '^todo' <<<"$out")" -eq 12 ] || fail "dry run must list 12 todo cells"
node -e 'const j=JSON.parse(process.argv[1].trim().split("\n").pop());if(j.row!=="stage-graph-g8"||j.cells_total!==12||j.per_task_timeout["g8-flow"]!=="10m"||j.per_task_timeout["g8-l4"]!=="15m"||!(j.estimated_cost_usd.high>j.estimated_cost_usd.typical&&j.estimated_cost_usd.typical>j.estimated_cost_usd.low))process.exit(1)' "$out" || fail "dry-run summary shape"
# an emptied copy of the prereg (the real one is filled since the post-merge freeze): both check-arms and a live run refuse it
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.allowed_arm_difference.files=[];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG_REAL" "$TEST_TMP/prereg-empty.json"
rc=0; o=$(node "$BASE/run-g8-campaign.js" --prereg "$TEST_TMP/prereg-empty.json" --check-arms 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'allowed_arm_difference.files is empty' <<<"$o" || fail "an empty allowed list must be refused by --check-arms (rc=$rc $o)"
rc=0; o=$(node "$BASE/run-g8-campaign.js" --prereg "$TEST_TMP/prereg-empty.json" --results "$TEST_TMP/refuse.jsonl" --runner stub 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'allowed_arm_difference.files is empty' <<<"$o" || fail "an empty allowed list must be refused by a run (rc=$rc $o)"
[ ! -e "$TEST_TMP/refuse.jsonl" ] || fail "a refusal must not create a results file"
# synthetic packs: skills dev-flow + l4 (the g8 tasks' check-skills) off/on, one companion, one scripts pack carrying session-mode.js
PK="$TEST_TMP/packs"; AR="$TEST_TMP/arms"; mkdir -p "$PK" "$AR"
node - "$PK" "$AR" <<'NODE'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [pk, ar] = process.argv.slice(2);
const man = { schema_version: 1, packs: {}, pack_meta: {} };
const put = (id, rel, body) => {
  const p = path.join(pk, id, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body);
  (man.packs[id] = man.packs[id] || {})[`${id}/${rel}`] = crypto.createHash('sha256').update(body).digest('hex');
};
put('companions', 'learn/SKILL.md', 'learn\n');
const skills = ['dev-flow', 'l4'];
for (const s of skills) { put(`${s}-off`, 'SKILL.md', `${s} OFF\n`); put(`${s}-on`, 'SKILL.md', `${s} ON\n`); }
put('files-x', 'references/x.md', 'x\n');
put('fx', 'scripts/session-mode.js', 'module.exports = {};\n');
put('same', 'SKILL.md', 'same\n');
man.pack_meta.fx = { kind: 'scripts', source: 'scripts/session-mode.js', ref: '73a59216aac00c92ed22e949771472e375693fd5' };
fs.writeFileSync(path.join(pk, 'manifest.json'), JSON.stringify(man));
for (const arm of ['off', 'on']) fs.writeFileSync(path.join(ar, `${arm}.json`), JSON.stringify({ schema_version: 1, arm, skills: { ...Object.fromEntries(skills.map((s) => [s, `${s}-${arm}`])), learn: 'same' }, files: ['files-x', 'fx'], fixture_scripts: ['fx'] }));
NODE
# the synthetic pair differs in dev-flow AND l4; the filled prereg registers only l4/SKILL.md, so register both for the clean case
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.allowed_arm_difference.files=["l4/SKILL.md","dev-flow/SKILL.md"];fs.writeFileSync(process.argv[1],JSON.stringify(j))' "$PREREG"
front() { ONOFF_PACKS_DIR="$PK" node "$BASE/run-g8-campaign.js" --prereg "$PREREG" "$@"; }
rc=0; o=$(front --check-arms --arms-dir "$AR") || rc=$?
[ "$rc" = 0 ] && grep -q '"ok":true' <<<"$o" || fail "check-arms should pass on a clean pair (rc=$rc $o)"
# planted red 1: a differing file that is not registered
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.allowed_arm_difference.files=["l4/SKILL.md"];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG" "$TEST_TMP/prereg-one.json"
rc=0; ONOFF_PACKS_DIR="$PK" node "$BASE/run-g8-campaign.js" --prereg "$TEST_TMP/prereg-one.json" --check-arms --arms-dir "$AR" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject an unregistered differing file (rc=$rc)"
# planted red 2: a vacuous ON arm (registered file identical in both arms)
cp -r "$AR" "$TEST_TMP/arms-red2"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.skills["dev-flow"]="dev-flow-off";fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red2"
rc=0; front --check-arms --arms-dir "$TEST_TMP/arms-red2" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject a registered-but-unchanged file (rc=$rc)"
# planted red 3: fixture scripts differ between the arms
cp -r "$AR" "$TEST_TMP/arms-red3"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.fixture_scripts=[];fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red3"
rc=0; front --check-arms --arms-dir "$TEST_TMP/arms-red3" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject differing fixture scripts (rc=$rc)"

# stub e2e: ON arm records the second task with --new-task, OFF arm repeats a plain set => SHIP; a failing runner => STOP; resume clears it
STUB_E2E="$TEST_TMP/stub-e2e.sh"
cat > "$STUB_E2E" <<'STUB'
#!/usr/bin/env bash
set -eu
[ "${G8_STUB_FAIL:-0}" = 1 ] && { echo "boom" >&2; exit 1; }
tool() { printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"%s","name":"%s","input":%s}]}}\n' "$1" "$2" "$3"; }
skill=dev-flow; [ "$ONOFF_TASK" = g8-l4 ] && skill=l4
tool s1 Skill "{\"skill\":\"autopilot:$skill\"}"
tool b1 Bash '{"command":"node scripts/session-mode.js set --size S"}'
if [ "$ONOFF_ARM" = on ]; then
  tool b2 Bash '{"command":"node scripts/session-mode.js set --new-task --size S"}'
else
  tool b2 Bash '{"command":"node scripts/session-mode.js set --size S"}'
fi
STUB
chmod +x "$STUB_E2E"
RES="$TEST_TMP/e2e/stage-graph-g8.v1.jsonl"; mkdir -p "$TEST_TMP/e2e"
rc=0; o=$(G8_STUB_FAIL=1 ONOFF_STUB_BIN="$STUB_E2E" front --results "$RES" --runner stub --arms-dir "$AR" 2>/dev/null | tail -1) || rc=$?
[ "$rc" = 4 ] && grep -q '"STOP"' <<<"$o" || fail "a failing runner must STOP (rc=$rc $o)"
[ "$(grep -c '"failure_class":"infra_fail"' "$RES")" -eq 12 ] || fail "expected 12 infra_fail rows after the failing pass"
rc=0; o=$(ONOFF_STUB_BIN="$STUB_E2E" front --results "$RES" --runner stub --arms-dir "$AR" 2>/dev/null | tail -1) || rc=$?
[ "$rc" = 0 ] && grep -q '"SHIP"' <<<"$o" || fail "resume with a good runner must SHIP (rc=$rc $o)"
grep -q '"G8":"holds"' <<<"$o" || fail "per-change verdict missing: $o"
[ "$(grep -c '"failure_class":null' "$RES")" -eq 12 ] || fail "expected 12 clean rows"
CLEAN=$(grep '"failure_class":null' "$RES")
[ "$(grep '"arm":"on"' <<<"$CLEAN" | grep -c '"g8_new_task":true')" -eq 6 ] && [ "$(grep '"arm":"off"' <<<"$CLEAN" | grep -c '"g8_new_task":false')" -eq 6 ] || fail "clean ON rows must be true, clean OFF rows false"
[ "$(grep -c '"arm_manifest_sha256"' "$RES")" -eq 24 ] || fail "every row must carry arm_manifest_sha256"
[ -s "$TEST_TMP/e2e/g67-cells/g8-l4/on/1/g8-extracted.json" ] || fail "cell artifacts (g8-extracted.json) not retained"
before=$(wc -l < "$RES")
ONOFF_STUB_BIN="$STUB_E2E" front --results "$RES" --runner stub --arms-dir "$AR" >/dev/null 2>&1 || fail "third run"
[ "$(wc -l < "$RES")" -eq "$before" ] || fail "a complete campaign must not add rows"
# plugin-script self-check: a plugin that lacks session-mode.js STOPs the campaign, nothing is scored
mkdir -p "$TEST_TMP/arms-noplugin"
for a in off on; do node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1]));j.files=["files-x"];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$AR/$a.json" "$TEST_TMP/arms-noplugin/$a.json"; done
RES2="$TEST_TMP/e2e2/stage-graph-g8.v1.jsonl"; mkdir -p "$TEST_TMP/e2e2"
rc=0; o=$(ONOFF_STUB_BIN="$STUB_E2E" front --results "$RES2" --runner stub --arms-dir "$TEST_TMP/arms-noplugin" 2>/dev/null | tail -1) || rc=$?
[ "$rc" = 4 ] && grep -q '"STOP"' <<<"$o" || fail "a plugin without session-mode.js must STOP (rc=$rc $o)"
[ "$(grep -c '"failure_cause":"plugin_script_unresolvable"' "$RES2")" -eq 12 ] || fail "expected 12 plugin_script_unresolvable rows"
# live (cc) guards: a PATH claude other than the pin is refused; the pin with null arm shas is refused; no results file is created
mkdir -p "$TEST_TMP/fakebin"; printf '#!/usr/bin/env bash\necho "9.9.9 (Claude Code)"\n' > "$TEST_TMP/fakebin/claude"; chmod +x "$TEST_TMP/fakebin/claude"
rc=0; o=$(PATH="$TEST_TMP/fakebin:$PATH" front --results "$TEST_TMP/live.jsonl" --arms-dir "$AR" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'registered pin' <<<"$o" || fail "live run must refuse an unpinned claude (rc=$rc $o)"
mkdir -p "$TEST_TMP/pinbin"; printf '#!/usr/bin/env bash\necho "2.1.296 (Claude Code)"\n' > "$TEST_TMP/pinbin/claude"; chmod +x "$TEST_TMP/pinbin/claude"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.runner_pin_path=process.argv[3];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG" "$TEST_TMP/prereg-pinbin.json" "$TEST_TMP/pinbin/"
rc=0; o=$(PATH="$TEST_TMP/pinbin:$PATH" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g8-campaign.js" --prereg "$TEST_TMP/prereg-pinbin.json" --results "$TEST_TMP/live2.jsonl" --arms-dir "$AR" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q "not stamped" <<<"$o" || fail "live run must refuse null arm shas (rc=$rc $o)"
[ ! -e "$TEST_TMP/live.jsonl" ] && [ ! -e "$TEST_TMP/live2.jsonl" ] || fail "a refusal must not create a results file"

echo "=== 5. stamp-prereg.js ==="
R="$TEST_TMP/stamproot"; mkdir -p "$R/prereg" "$R/arms/g8" "$R/packs" "$R/tasks/t/real" "$R/data"
cp "$AR/off.json" "$AR/on.json" "$R/arms/g8/"; cp "$PK/manifest.json" "$R/packs/manifest.json"
echo '{}' > "$R/prereg/FROZEN.json"; echo note > "$R/data/note.txt"; echo real > "$R/tasks/t/real/f.txt"; ln -s real/f.txt "$R/tasks/t/link.txt"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.freeze_files=["arms/g8","data/note.txt","tasks/t"];j.freeze_packs=["fx"];fs.writeFileSync(process.argv[2],JSON.stringify(j,null,2))' "$PREREG" "$R/prereg/stage-graph-g8.json"
stamp() { node "$BASE/stamp-prereg.js" --row stage-graph-g8 --root "$R" "$@"; }
rc=0; stamp --check >/dev/null 2>&1 || rc=$?
[ "$rc" = 2 ] || fail "--check on an unstamped row must fail (rc=$rc)"
# refuses: an arm names a pack that is not frozen
cp "$R/arms/g8/on.json" "$TEST_TMP/on.keep"; node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.skills.l4="l4-sg-change-v9";fs.writeFileSync(p,JSON.stringify(j))' "$R/arms/g8/on.json"
rc=0; o=$(stamp 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'packs not frozen yet' <<<"$o" || fail "an unfrozen pack must be refused (rc=$rc $o)"
cp "$TEST_TMP/on.keep" "$R/arms/g8/on.json"
# refuses: empty allowed list
cp "$R/prereg/stage-graph-g8.json" "$TEST_TMP/prereg.keep"; node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.allowed_arm_difference.files=[];fs.writeFileSync(p,JSON.stringify(j))' "$R/prereg/stage-graph-g8.json"
rc=0; o=$(stamp 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'allowed_arm_difference.files is empty' <<<"$o" || fail "an empty allowed list must be refused (rc=$rc $o)"
cp "$TEST_TMP/prereg.keep" "$R/prereg/stage-graph-g8.json"
# refuses: a pack without provenance
node -e 'const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p));delete m.pack_meta.fx;fs.writeFileSync(p,JSON.stringify(m))' "$R/packs/manifest.json"
rc=0; o=$(stamp 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'pack_meta.fx.ref' <<<"$o" || fail "a pack without pack_meta.ref must be refused (rc=$rc $o)"
cp "$PK/manifest.json" "$R/packs/manifest.json"
# stamps
o=$(stamp) || fail "stamp on a clean synthetic root"
node -e '
const fs=require("fs"),c=require("crypto");const R=process.argv[1];
const sha=(f)=>c.createHash("sha256").update(fs.readFileSync(R+"/"+f)).digest("hex");
const p=JSON.parse(fs.readFileSync(R+"/prereg/stage-graph-g8.json"));const z=JSON.parse(fs.readFileSync(R+"/prereg/FROZEN.json"))["stage-graph-g8"];
if(p.arm_manifests.off.sha256!==sha("arms/g8/off.json")||p.arm_manifests.on.sha256!==sha("arms/g8/on.json"))process.exit(1);
if(!z||!z.stamped||z.files["tasks/t/link.txt"]!==sha("tasks/t/real/f.txt")||!z.files["data/note.txt"]||!z.files["arms/g8/on.json"])process.exit(2);
if(!z.packs.fx||z.packs.fx.ref.slice(0,8)!=="73a59216")process.exit(3)' "$R" || fail "stamp must write the shas, the (symlink-following) digests and the pack provenance"
stamp --check >/dev/null || fail "--check right after a stamp must pass"
echo changed >> "$R/data/note.txt"
rc=0; o=$(stamp --check 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'data/note.txt' <<<"$o" || fail "--check must name an edited digested file (rc=$rc $o)"
echo note > "$R/data/note.txt"; stamp --check >/dev/null || fail "--check passes again once the edit is reverted"
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.edited=1;fs.writeFileSync(p,JSON.stringify(j))' "$R/arms/g8/off.json"
rc=0; o=$(stamp --check 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'arm off sha256' <<<"$o" || fail "--check must catch an edited arm manifest (rc=$rc $o)"

echo "PASS: skill-onoff-g8 (marker, fixtures, scorer, campaign front, stamp)"
