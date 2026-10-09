#!/usr/bin/env bash
# hooks/tests/skill-onoff-g67.test.sh — spend-free proof of the stage-graph-g67 eval instrument
# (evals/skill-onoff/prereg/stage-graph-g67.{md,json}). No live model cell is run: every transcript is SYNTHETIC
# (stream-json tool_use / tool_result events, the claude -p shape) and goes through the REAL tasks/g6-*|g7-close/markers.sh
# -> lib/g67-cell.js, the REAL score-g67.js and the REAL run-g67-campaign.js (stub runner, synthetic packs).
#
# Asserts:
#   1. g6_size markers: pass cases (l4/l5/l6, --solo entry-level form, line continuation) and fail cases (no --size, size
#      only on a later call, wrong level, unreadable --size "$VAR", invalid value, script merely read)
#   2. g7_close markers: pass cases (shell-expanded sid, literal sid, dry run then --yes run, --session=) and fail cases
#      (no --yes, empty/missing --session, dry run only, script merely read or grepped, prose only)
#   3. fixtures: briefs carry no answer vocabulary; g7-close fixture is clean, merged and has no dispatch branch
#   4. score-g67.js verdicts: SHIP / NOT-SHIP (ON low, OFF high) / STOP (missing, infra_fail only; rerun clears) /
#      INSTRUMENT-INVALID (mixed runner, unpinned runner, V1, identical arm shas, registered-sha mismatch)
#   5. harness timeout knob: exit 124 is infra_fail by default (regression) and a complete cell with ONOFF_TIMEOUT_IS_COMPLETE
#   6. run-g67-campaign.js: --dry-run cell count; --check-arms (pass + planted-red fail cases); stub e2e SHIP, STOP, resume
set -euo pipefail
AUTOPILOT_TEST_LIB_HELPERS_ONLY=1 . "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
PREREG_REAL="$BASE/prereg/stage-graph-g67.json"
QUERY="$BASE/lib/transcript-query.js"
TEST_TMP=$(mktemp -d -t "skill-onoff-g67-test-XXXXXX")
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const a of ["off","on"])j.arm_manifests[a].sha256=null;fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG_REAL" "$TEST_TMP/prereg-unpinned.json"
PREREG="$TEST_TMP/prereg-unpinned.json"
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

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

# run the REAL task markers.sh for <task> over a transcript; echoes the marker value
marker_of() { # $1 task  $2 transcript
  local t="$1" tr="$2" key
  key=$([ "$t" = g7-close ] && echo g7_close || echo g6_size)
  local out
  out=$(cd "$TEST_TMP" && TRANSCRIPT="$tr" FROZEN_BASE_SHA=none QUERY="$QUERY" ONOFF_LIB="$BASE/lib" bash "$BASE/tasks/$t/markers.sh") || fail "markers.sh failed for $t"
  grep -q "^marker_${key}=" <<<"$out" || fail "no marker_${key} line for $t: $out"
  sed -n "s/^marker_${key}=//p" <<<"$out"
}
expect() { # $1 label  $2 want  $3 task  $4 skill  rest cmds
  local label="$1" want="$2" task="$3" skill="$4"; shift 4
  node "$TEST_TMP/mk.js" "$TEST_TMP/tr.jsonl" "$skill" "$@"
  local got; got=$(marker_of "$task" "$TEST_TMP/tr.jsonl")
  [ "$got" = "$want" ] || fail "$label: $task expected $want got $got"
}
SM='node scripts/session-mode.js'
SW='node "$autopilot_root/scripts/repo-residue-sweep.js"'

echo "=== 1. g6_size markers ==="
expect "l4 pass"            true  g6-l4 autopilot:l4 "$SM set --level l4 --size XS --repo-root ."
expect "l5 pass"            true  g6-l5 autopilot:l5 "$SM set --level l5 --size S --urgent --repo-root \"\$(git rev-parse --show-toplevel)\""
expect "l6 pass"            true  g6-l6 autopilot:l6 "$SM set --level l6 --size M --bug --repo-root ."
expect "quoted script path" true  g6-l4 autopilot:l4 "node \"\$plugin/scripts/session-mode.js\" set --level l4 --size XL --repo-root ."
expect "solo entry form"    true  g6-l4 autopilot:l4 "$SM set --level l3 --entry-level l4 --fallback solo --size S --repo-root ."
expect "line continuation"  true  g6-l4 autopilot:l4 "$SM set --level l4 \\
  --size XS \\
  --repo-root ."
expect "after other calls"  true  g6-l4 autopilot:l4 "ls" "git status" "$SM set --level l4 --size XS --repo-root ."
expect "refused still judged on the command text" true g6-l4 autopilot:l4 "ERR:$SM set --level l4 --size XS --repo-root ."
expect "no --size (old text)"          false g6-l4 autopilot:l4 "$SM set --level l4 --repo-root ."
expect "size only on a later call"     false g6-l4 autopilot:l4 "$SM set --level l4 --repo-root ." "$SM set --level l4 --size XS --repo-root ."
expect "other level's call"            false g6-l4 autopilot:l4 "$SM set --level l5 --size XS --repo-root ."
expect "size is a shell variable"      false g6-l4 autopilot:l4 "$SM set --level l4 --size \"\$SZ\" --repo-root ."
expect "invalid size value"            false g6-l4 autopilot:l4 "$SM set --level l4 --size XXL --repo-root ."
expect "lowercase size"                false g6-l4 autopilot:l4 "$SM set --level l4 --size xs --repo-root ."
expect "set without level (dev-flow)"  false g6-l4 autopilot:l4 "$SM set --size S --repo-root ."
expect "script merely read"            false g6-l4 autopilot:l4 "cat scripts/session-mode.js" "grep -n 'set --level l4 --size XS' scripts/session-mode.js" "echo session-mode.js set --level l4 --size XS"
expect "no session-mode call at all"   false g6-l4 -            "ls"
expect "empty transcript"              false g6-l4 -

echo "=== 2. g7_close markers ==="
expect "expanded sid + --yes"   true  g7-close autopilot:finish-flow "$SW close-session --session \"\$CLAUDE_CODE_SESSION_ID\" --repo \"\$(git rev-parse --show-toplevel)\" --integration-ref develop --yes"
expect "unquoted \$sid"         true  g7-close autopilot:finish-flow "$SW close-session --session \$CLAUDE_CODE_SESSION_ID --yes"
expect "braced sid"             true  g7-close autopilot:finish-flow "$SW close-session --session \"\${CLAUDE_CODE_SESSION_ID}\" --yes"
expect "literal sid"            true  g7-close autopilot:finish-flow "node scripts/repo-residue-sweep.js close-session --session 0a1b2c-d3 --repo . --yes"
expect "--session=sid"          true  g7-close autopilot:finish-flow "node scripts/repo-residue-sweep.js close-session --session=abc --yes"
expect "flags in any order"     true  g7-close autopilot:finish-flow "node scripts/repo-residue-sweep.js close-session --yes --repo . --session abc"
expect "dry run then --yes run" true  g7-close autopilot:finish-flow "node scripts/repo-residue-sweep.js close-session --session abc --repo ." "node scripts/repo-residue-sweep.js close-session --session abc --repo . --yes"
expect "sweep refused still judged on the command" true g7-close autopilot:finish-flow "ERR:node scripts/repo-residue-sweep.js close-session --session abc --yes"
expect "no --yes (dry run only)" false g7-close autopilot:finish-flow "$SW close-session --session \"\$CLAUDE_CODE_SESSION_ID\" --repo ."
expect "empty --session"        false g7-close autopilot:finish-flow "$SW close-session --session \"\" --yes"
expect "missing --session"      false g7-close autopilot:finish-flow "$SW close-session --repo . --yes"
expect "--session then a flag"  false g7-close autopilot:finish-flow "$SW close-session --session --yes"
expect "other subcommand"       false g7-close autopilot:finish-flow "node scripts/repo-residue-sweep.js reap --session abc --yes"
expect "script merely read"     false g7-close autopilot:finish-flow "cat scripts/repo-residue-sweep.js" "grep -n close-session scripts/repo-residue-sweep.js" "echo 'repo-residue-sweep.js close-session --session abc --yes'"
expect "wrong script"           false g7-close autopilot:finish-flow "bash scripts/reap-dispatch-branches.sh check --repo . --into develop"
expect "nothing run"            false g7-close autopilot:finish-flow "git status"
# a truncated final line (timeout kill mid-write) is skipped, earlier calls still count
node "$TEST_TMP/mk.js" "$TEST_TMP/tr.jsonl" autopilot:l4 "$SM set --level l4 --size XS --repo-root ."
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_9","name":"Bash","input":{"command":"node scr' >> "$TEST_TMP/tr.jsonl"
[ "$(marker_of g6-l4 "$TEST_TMP/tr.jsonl")" = true ] || fail "truncated final line must not hide the entry call"

echo "=== 3. fixtures ==="
TASKS=$(node -e 'process.stdout.write(Object.keys(require(process.argv[1]).tasks).join(" "))' "$PREREG")
[ "$TASKS" = "g6-l4 g6-l5 g6-l6 g7-close" ] || fail "prereg tasks: $TASKS"
for t in $TASKS; do
  for f in task.md init-repo.sh markers.sh; do [ -f "$BASE/tasks/$t/$f" ] || fail "$t/$f missing"; done
  [ -d "$BASE/tasks/$t/repo" ] || fail "$t/repo missing"
  for tok in 'session-mode' 'close-session' 'residue' 'repo-residue' 'dispatch' '--size' 'XS' '/l4' '/l5' '/l6' 'finish-flow' 'tidy' 'clean up' 'branch cleanup'; do
    if grep -qF -- "$tok" "$BASE/tasks/$t/task.md"; then fail "leakage: '$tok' in $t/task.md"; fi
  done
done
# g7-close: built through the real harness init order (files, git init, init-repo.sh)
F="$TEST_TMP/g7repo"; mkdir -p "$F"; cp -r "$BASE/tasks/g7-close/repo"/. "$F"/
( cd "$F" && git init -q && git config user.name t && git config user.email t@t && git config commit.gpgsign false && bash "$BASE/tasks/g7-close/init-repo.sh" )
[ -z "$(git -C "$F" status --porcelain)" ] || fail "g7-close fixture tree must be clean"
[ "$(git -C "$F" rev-parse --abbrev-ref HEAD)" = develop ] || fail "g7-close HEAD must be develop"
[ "$(git -C "$F" branch --format='%(refname:short)')" = develop ] || fail "g7-close must hold no branch but develop"
[ "$(git -C "$F" rev-list --parents -n1 HEAD | wc -w)" -eq 3 ] || fail "g7-close HEAD must be a merge commit"
( cd "$F" && bash run-tests.sh >/dev/null ) || fail "g7-close run-tests.sh must be green"

echo "=== 4. score-g67.js verdicts ==="
cat > "$TEST_TMP/rows.js" <<'NODE'
// rows.js <out> <spec-json>: spec = {off:{task:[passes]}, on:{...}, ver, extra:{...}} builds one clean row per cell
const fs = require('fs');
const [out, specJson] = process.argv.slice(2);
const s = JSON.parse(specJson);
const prereg = JSON.parse(fs.readFileSync(process.env.PREREG, 'utf8'));
const rows = [];
for (const [task, T] of Object.entries(prereg.tasks)) for (const arm of ['off', 'on']) for (let rep = 1; rep <= 3; rep++) {
  const pass = ((s[arm] || {})[task] || [])[rep - 1] === 1;
  const r = { task_id: task, arm, model: 'sonnet', runner: 'cc', runner_version: s.ver || '2.1.292 (Claude Code)', rep, duration_s: 60, frozen_base_sha: 'x',
    markers: { [T.marker]: pass }, skill_invoked: s.noskill ? false : true, check_skill: T.skill, failure_class: null, failure_cause: null, arm_manifest_sha256: arm === 'on' ? (s.onsha || 'b'.repeat(64)) : (s.offsha || 'a'.repeat(64)) };
  if (s.drop && s.drop.includes(`${task}|${arm}|${rep}`)) continue;
  if (s.infra && s.infra.includes(`${task}|${arm}|${rep}`)) { r.failure_class = 'infra_fail'; r.failure_cause = 'runner_timeout'; }
  rows.push(r);
}
if (s.rerun) for (const k of s.rerun) { const [task, arm, rep] = k.split('|'); rows.push({ ...rows.find((r) => r.task_id === task && r.arm === arm), rep: Number(rep), failure_class: null, failure_cause: null }); }
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
NODE
export PREREG
ALL_ON='{"g6-l4":[1,1,1],"g6-l5":[1,1,1],"g6-l6":[1,1,1],"g7-close":[1,1,1]}'
score() { # $1 spec json -> echoes "<exit> <verdict>"
  node "$TEST_TMP/rows.js" "$TEST_TMP/rows.jsonl" "$1"
  local o rc=0
  o=$(node "$BASE/score-g67.js" --prereg "$PREREG" --results "$TEST_TMP/rows.jsonl") || rc=$?
  echo "$rc $(node -e 'process.stdout.write(JSON.parse(process.argv[1]).verdict)' "$o")"
}
sexp() { local got; got=$(score "$2"); [ "$got" = "$3" ] || fail "$1: want '$3' got '$got'"; }
sexp "SHIP all 3/3 vs 0/3"              "{\"on\":$ALL_ON,\"off\":{}}" "0 SHIP"
sexp "SHIP at the boundary 2/3 vs 1/3"  '{"on":{"g6-l4":[1,1,0],"g6-l5":[1,0,1],"g6-l6":[0,1,1],"g7-close":[1,1,0]},"off":{"g6-l4":[1,0,0],"g6-l5":[0,1,0],"g6-l6":[0,0,1],"g7-close":[1,0,0]}}' "0 SHIP"
sexp "NOT-SHIP one ON at 1/3"           '{"on":{"g6-l4":[1,1,1],"g6-l5":[1,1,1],"g6-l6":[1,0,0],"g7-close":[1,1,1]},"off":{}}' "3 NOT-SHIP"
sexp "NOT-SHIP one OFF at 2/3"          "{\"on\":$ALL_ON,\"off\":{\"g7-close\":[1,1,0]}}" "3 NOT-SHIP"
sexp "NOT-SHIP G7 dead, G6 fine"        '{"on":{"g6-l4":[1,1,1],"g6-l5":[1,1,1],"g6-l6":[1,1,1],"g7-close":[0,0,0]},"off":{}}' "3 NOT-SHIP"
sexp "STOP missing cell"                "{\"on\":$ALL_ON,\"off\":{},\"drop\":[\"g7-close|on|2\"]}" "4 STOP"
sexp "STOP infra_fail only"             "{\"on\":$ALL_ON,\"off\":{},\"infra\":[\"g6-l5|off|1\"]}" "4 STOP"
sexp "rerun clears the STOP"            "{\"on\":$ALL_ON,\"off\":{},\"infra\":[\"g6-l5|off|1\"],\"rerun\":[\"g6-l5|off|1\"]}" "0 SHIP"
sexp "INVALID unpinned runner"          "{\"on\":$ALL_ON,\"off\":{},\"ver\":\"2.1.295 (Claude Code)\"}" "5 INSTRUMENT-INVALID"
sexp "INVALID V1 skill not invoked"     "{\"on\":$ALL_ON,\"off\":{},\"noskill\":true}" "5 INSTRUMENT-INVALID"
sexp "INVALID identical arm shas"       "{\"on\":$ALL_ON,\"off\":{},\"onsha\":\"$(printf 'a%.0s' $(seq 64))\"}" "5 INSTRUMENT-INVALID"
# mixed runner versions inside one results file
node "$TEST_TMP/rows.js" "$TEST_TMP/rows.jsonl" "{\"on\":$ALL_ON,\"off\":{}}"
node -e 'const fs=require("fs");const p=process.argv[1];const L=fs.readFileSync(p,"utf8").trim().split("\n");const j=JSON.parse(L[3]);j.runner_version="2.1.295 (Claude Code)";L[3]=JSON.stringify(j);fs.writeFileSync(p,L.join("\n")+"\n")' "$TEST_TMP/rows.jsonl"
rc=0; o=$(node "$BASE/score-g67.js" --prereg "$PREREG" --results "$TEST_TMP/rows.jsonl") || rc=$?
[ "$rc" = 5 ] && grep -q '"INSTRUMENT-INVALID"' <<<"$o" && grep -q 'mixed runner versions' <<<"$o" || fail "mixed runner versions must be INSTRUMENT-INVALID (rc=$rc $o)"
# a registered (pinned) arm sha that the rows do not match
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.arm_manifests.on.sha256="c".repeat(64);fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG" "$TEST_TMP/prereg-pinned.json"
node "$TEST_TMP/rows.js" "$TEST_TMP/rows.jsonl" "{\"on\":$ALL_ON,\"off\":{}}"
rc=0; o=$(node "$BASE/score-g67.js" --prereg "$TEST_TMP/prereg-pinned.json" --results "$TEST_TMP/rows.jsonl") || rc=$?
[ "$rc" = 5 ] || fail "registered arm sha mismatch must be INSTRUMENT-INVALID (rc=$rc $o)"
# the shipped scorer reads unreadable input as usage error
rc=0; node "$BASE/score-g67.js" --prereg "$PREREG" --results "$TEST_TMP/nope.jsonl" >/dev/null 2>&1 || rc=$?
[ "$rc" = 2 ] || fail "unreadable results must exit 2 (got $rc)"

echo "=== 5. harness timeout knob ==="
STUB_TO="$TEST_TMP/stub-timeout.sh"
cat > "$STUB_TO" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"node scripts/session-mode.js set --level l4 --size XS --repo-root ."}}]}}'
exit 124
STUB
chmod +x "$STUB_TO"
run_cell() { # env prefix passed via env; $1 out dir
  ONOFF_STUB_BIN="$STUB_TO" bash "$BASE/run-skill-onoff-eval.sh" --task g6-l4 --arm off --model sonnet --runner stub --out "$1" >/dev/null
}
run_cell "$TEST_TMP/to-default"
grep -q '"failure_class":"infra_fail","failure_cause":"runner_timeout"' "$TEST_TMP/to-default/result.json" || fail "default: exit 124 must stay infra_fail/runner_timeout"
grep -q stopped_by_timeout "$TEST_TMP/to-default/result.json" && fail "default row must not carry stopped_by_timeout"
ONOFF_TIMEOUT_IS_COMPLETE=1 run_cell "$TEST_TMP/to-complete"
grep -q '"failure_class":null' "$TEST_TMP/to-complete/result.json" || fail "knob: timeout stop must be a complete cell"
grep -q '"stopped_by_timeout":true' "$TEST_TMP/to-complete/result.json" || fail "knob: row must say stopped_by_timeout"
grep -q '"g6_size":true' "$TEST_TMP/to-complete/result.json" || fail "knob: the entry call issued before the stop must be scored"
# knob with an EMPTY transcript is still a failure
printf '#!/usr/bin/env bash\nexit 124\n' > "$TEST_TMP/stub-empty.sh"; chmod +x "$TEST_TMP/stub-empty.sh"
ONOFF_TIMEOUT_IS_COMPLETE=1 ONOFF_STUB_BIN="$TEST_TMP/stub-empty.sh" bash "$BASE/run-skill-onoff-eval.sh" --task g6-l4 --arm off --model sonnet --runner stub --out "$TEST_TMP/to-empty" >/dev/null
grep -q '"failure_class":"infra_fail"' "$TEST_TMP/to-empty/result.json" || fail "knob: an empty transcript after a timeout must stay infra_fail"
# the g67 markers wrote their extraction next to the transcript
[ -s "$TEST_TMP/to-complete/g67-extracted.json" ] || fail "g67-extracted.json not retained"

echo "=== 6. run-g67-campaign.js ==="
out=$(node "$BASE/run-g67-campaign.js" --results "$TEST_TMP/dry.jsonl" --dry-run)
[ "$(grep -c '^todo' <<<"$out")" -eq 24 ] || fail "dry run must list 24 todo cells"
node -e 'const j=JSON.parse(process.argv[1].trim().split("\n").pop());if(j.cells_total!==24||j.cells_todo!==24||!(j.estimated_cost_usd.high>j.estimated_cost_usd.typical&&j.estimated_cost_usd.typical>j.estimated_cost_usd.low))process.exit(1)' "$out" || fail "dry-run summary shape"
# synthetic packs: 4 skills x {off,on}, one guidance-files pack, one fixture pack (also installed in the plugin root, carrying session-mode.js), one companion
PK="$TEST_TMP/packs"; AR="$TEST_TMP/arms"; mkdir -p "$PK" "$AR"
node - "$PK" "$AR" <<'NODE'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [pk, ar] = process.argv.slice(2);
const man = { schema_version: 1, packs: {} };
const put = (id, rel, body, mode = 0o644) => {
  const p = path.join(pk, id, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body, { mode });
  (man.packs[id] = man.packs[id] || {})[`${id}/${rel}`] = crypto.createHash('sha256').update(body).digest('hex');
};
put('companions', 'learn/SKILL.md', 'learn\n');
const skills = ['l4', 'l5', 'l6', 'finish-flow'];
for (const s of skills) { put(`${s}-off`, 'SKILL.md', `${s} OFF\n`); put(`${s}-on`, 'SKILL.md', `${s} ON\n`); }
put('l5-off', 'references/hetero-impl-loop.md', 'loop OFF\n'); put('l5-on', 'references/hetero-impl-loop.md', 'loop ON\n');
put('l5-off', 'references/other.md', 'o\n'); put('l5-on', 'references/other.md', 'o\n');
put('files-x', 'references/x.md', 'x\n');
put('fx', 'scripts/x.js', '// x\n');
put('fx', 'scripts/session-mode.js', 'module.exports = {};\n'); // amendment 1: the plugin must carry it
put('fx-broken', 'scripts/session-mode.js', 'require("./lib/not-shipped");\n');
put('same', 'SKILL.md', 'same\n');
fs.writeFileSync(path.join(pk, 'manifest.json'), JSON.stringify(man));
for (const arm of ['off', 'on']) fs.writeFileSync(path.join(ar, `${arm}.json`), JSON.stringify({ schema_version: 1, arm, skills: { ...Object.fromEntries(skills.map((s) => [s, `${s}-${arm}`])), learn: 'same' }, files: ['files-x', 'fx'], fixture_scripts: ['fx'] }));
NODE
rc=0; o=$(ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --check-arms --arms-dir "$AR") || rc=$?
[ "$rc" = 0 ] && grep -q '"ok":true' <<<"$o" || fail "check-arms should pass on a clean pair (rc=$rc $o)"
# planted red 1: an unregistered skill differs
cp -r "$AR" "$TEST_TMP/arms-red1"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.skills.learn="l4-on";fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red1"
rc=0; ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --check-arms --arms-dir "$TEST_TMP/arms-red1" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject an unregistered differing skill (rc=$rc)"
# planted red 2: a registered skill is identical in both arms (the ON arm carries no change)
cp -r "$AR" "$TEST_TMP/arms-red2"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.skills["finish-flow"]="finish-flow-off";fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red2"
rc=0; ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --check-arms --arms-dir "$TEST_TMP/arms-red2" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject a vacuous ON arm (rc=$rc)"
# planted red 2b/2c: l5 packs built from a js helper (fifth registered file unchanged / unregistered file changed)
mkl5() { # $1 pack id  $2 hetero-impl-loop body  $3 other.md body
  node - "$PK" "$1" "$2" "$3" <<'NODE'
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const [pk,id,loop,other]=process.argv.slice(2);const man=JSON.parse(fs.readFileSync(path.join(pk,"manifest.json")));
const h=(b)=>crypto.createHash("sha256").update(b).digest("hex");
const files={"SKILL.md":"l5 ON\n","references/hetero-impl-loop.md":loop+"\n","references/other.md":other+"\n"};
man.packs[id]={};
for(const [rel,b] of Object.entries(files)){const f=path.join(pk,id,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);man.packs[id][`${id}/${rel}`]=h(b);}
fs.writeFileSync(path.join(pk,"manifest.json"),JSON.stringify(man));
NODE
}
mkl5 l5-same "loop OFF" "o"
cp -r "$AR" "$TEST_TMP/arms-red2b"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.skills.l5="l5-same";fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red2b"
rc=0; ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --check-arms --arms-dir "$TEST_TMP/arms-red2b" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject an unchanged registered l5 reference (rc=$rc)"
mkl5 l5-x "loop ON" "CHANGED"
cp -r "$AR" "$TEST_TMP/arms-red2c"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.skills.l5="l5-x";fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red2c"
rc=0; ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --check-arms --arms-dir "$TEST_TMP/arms-red2c" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject an unregistered differing file inside l5 (rc=$rc)"
# planted red 3: fixture scripts differ between the arms
cp -r "$AR" "$TEST_TMP/arms-red3"; node -e 'const fs=require("fs");const p=process.argv[1]+"/on.json";const j=JSON.parse(fs.readFileSync(p));j.fixture_scripts=[];fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arms-red3"
rc=0; ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --check-arms --arms-dir "$TEST_TMP/arms-red3" >/dev/null || rc=$?
[ "$rc" = 2 ] || fail "check-arms must reject differing fixture scripts (rc=$rc)"

# stub e2e: ON arm complies, OFF arm does not => SHIP; a failing runner => STOP; resume clears it
STUB_E2E="$TEST_TMP/stub-e2e.sh"
cat > "$STUB_E2E" <<'STUB'
#!/usr/bin/env bash
set -eu
[ "${G67_STUB_FAIL:-0}" = 1 ] && { echo "boom" >&2; exit 1; }
tool() { printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"%s","name":"%s","input":%s}]}}\n' "$1" "$2" "$3"; }
skill=l4; case "$ONOFF_TASK" in g6-l5) skill=l5 ;; g6-l6) skill=l6 ;; g7-close) skill=finish-flow ;; esac
tool s1 Skill "{\"skill\":\"autopilot:$skill\"}"
if [ "$ONOFF_ARM" = on ]; then
  case "$ONOFF_TASK" in
    g7-close) tool b1 Bash '{"command":"node scripts/repo-residue-sweep.js close-session --session \"$CLAUDE_CODE_SESSION_ID\" --yes"}' ;;
    *) tool b1 Bash "{\"command\":\"node scripts/session-mode.js set --level $skill --size XS --repo-root .\"}" ;;
  esac
else
  case "$ONOFF_TASK" in
    g7-close) tool b1 Bash '{"command":"git status"}' ;;
    *) tool b1 Bash "{\"command\":\"node scripts/session-mode.js set --level $skill --repo-root .\"}" ;;
  esac
fi
STUB
chmod +x "$STUB_E2E"
RES="$TEST_TMP/e2e/stage-graph-g67.v1.jsonl"; mkdir -p "$TEST_TMP/e2e"
rc=0; o=$(G67_STUB_FAIL=1 ONOFF_STUB_BIN="$STUB_E2E" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$RES" --runner stub --arms-dir "$AR" --prereg "$PREREG" 2>/dev/null | tail -1) || rc=$?
[ "$rc" = 4 ] && grep -q '"STOP"' <<<"$o" || fail "a failing runner must STOP (rc=$rc $o)"
[ "$(grep -c '"failure_class":"infra_fail"' "$RES")" -eq 24 ] || fail "expected 24 infra_fail rows after the failing pass"
rc=0; o=$(ONOFF_STUB_BIN="$STUB_E2E" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$RES" --runner stub --arms-dir "$AR" --prereg "$PREREG" 2>/dev/null | tail -1) || rc=$?
[ "$rc" = 0 ] && grep -q '"SHIP"' <<<"$o" || fail "resume with a good runner must SHIP (rc=$rc $o)"
grep -q '"G6":"holds"' <<<"$o" && grep -q '"G7":"holds"' <<<"$o" || fail "per-change verdicts missing: $o"
[ "$(grep -c '"arm_manifest_sha256"' "$RES")" -eq 48 ] || fail "every row must carry arm_manifest_sha256"
[ "$(grep -c '"failure_class":null' "$RES")" -eq 24 ] || fail "expected 24 clean rows"
[ "$(grep '"arm":"on"' "$RES" | grep -o '"arm_manifest_sha256":"[0-9a-f]*"' | sort -u | wc -l)" -eq 1 ] || fail "ON rows must share one manifest sha"
[ -s "$TEST_TMP/e2e/g67-cells/g7-close/on/1/g67-extracted.json" ] || fail "cell artifacts not retained"
# idempotent: a third run spends nothing and scores the same
before=$(wc -l < "$RES")
ONOFF_STUB_BIN="$STUB_E2E" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$RES" --runner stub --arms-dir "$AR" --prereg "$PREREG" >/dev/null 2>&1 || fail "third run"
[ "$(wc -l < "$RES")" -eq "$before" ] || fail "a complete campaign must not add rows"
# the live runner refuses an unpinned PATH claude (no spend): a fake claude on PATH reporting another version
mkdir -p "$TEST_TMP/fakebin"; printf '#!/usr/bin/env bash\necho "9.9.9 (Claude Code)"\n' > "$TEST_TMP/fakebin/claude"; chmod +x "$TEST_TMP/fakebin/claude"
rc=0; o=$(PATH="$TEST_TMP/fakebin:$PATH" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$TEST_TMP/live.jsonl" --arms-dir "$AR" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'registered pin' <<<"$o" || fail "live run must refuse an unpinned claude (rc=$rc $o)"
[ ! -e "$TEST_TMP/live.jsonl" ] || fail "an unpinned refusal must not create a results file"



echo "=== 7. amendment 1: plugin-script self-check (v1: session-mode.js was absent from the plugin) ==="
# the real prereg registers the script, and the campaign hands it to the harness
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(JSON.stringify(j.plugin_required_scripts)!==JSON.stringify(["scripts/session-mode.js"]))process.exit(1)' "$PREREG_REAL" || fail "prereg must register scripts/session-mode.js in plugin_required_scripts"
# a stub that records that the agent was started
SENT="$TEST_TMP/agent-started"
cat > "$TEST_TMP/stub-sentinel.sh" <<STUB
#!/usr/bin/env bash
: > "$SENT"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}'
STUB
chmod +x "$TEST_TMP/stub-sentinel.sh"
# bad arm A: session-mode.js only in the fixture repo (fixture_scripts), NOT in the plugin root (the exact v1 shape)
cp "$AR/on.json" "$TEST_TMP/arm-noplugin.json"
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.files=["files-x"];fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arm-noplugin.json"
# bad arm B: present but its require graph does not resolve
cp "$AR/on.json" "$TEST_TMP/arm-broken.json"
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.files=["files-x","fx-broken"];fs.writeFileSync(p,JSON.stringify(j))' "$TEST_TMP/arm-broken.json"
cell7() { # $1 out dir  $2 arm manifest  (env ONOFF_REQUIRE_PLUGIN_SCRIPTS from the caller)
  rm -f "$SENT"
  ONOFF_STUB_BIN="$TEST_TMP/stub-sentinel.sh" ONOFF_PACKS_DIR="$PK" bash "$BASE/run-skill-onoff-eval.sh" --task g6-l4 --arm-manifest "$2" --model sonnet --runner stub --check-skill l4 --out "$1" >/dev/null
}
ONOFF_REQUIRE_PLUGIN_SCRIPTS=scripts/session-mode.js cell7 "$TEST_TMP/s7-ok" "$AR/on.json"
grep -q '"failure_class":null' "$TEST_TMP/s7-ok/result.json" || fail "plugin carries session-mode.js: the cell must proceed ($(cat "$TEST_TMP/s7-ok/result.json"))"
[ -e "$SENT" ] || fail "plugin carries session-mode.js: the agent must be started"
ONOFF_REQUIRE_PLUGIN_SCRIPTS=scripts/session-mode.js cell7 "$TEST_TMP/s7-absent" "$TEST_TMP/arm-noplugin.json"
grep -q '"failure_class":"infra_fail","failure_cause":"plugin_script_unresolvable"' "$TEST_TMP/s7-absent/result.json" || fail "session-mode.js absent from the plugin must be infra_fail/plugin_script_unresolvable ($(cat "$TEST_TMP/s7-absent/result.json"))"
[ ! -e "$SENT" ] || fail "absent script: the agent must NOT be started"
grep -q 'session-mode.js' "$TEST_TMP/s7-absent/preflight.log" || fail "preflight.log must name the script"
ONOFF_REQUIRE_PLUGIN_SCRIPTS=scripts/session-mode.js cell7 "$TEST_TMP/s7-broken" "$TEST_TMP/arm-broken.json"
grep -q '"failure_cause":"plugin_script_unresolvable"' "$TEST_TMP/s7-broken/result.json" || fail "a script whose require graph is missing must be plugin_script_unresolvable"
[ ! -e "$SENT" ] || fail "broken require graph: the agent must NOT be started"
# a path escaping the plugin root: plant a LOADABLE escape.js beside the scratch plugin (TMPDIR is private to this test), so only the guard can fail it
mkdir -p "$TEST_TMP/s7tmp"; echo "module.exports = {};" > "$TEST_TMP/s7tmp/escape.js"
TMPDIR="$TEST_TMP/s7tmp" ONOFF_REQUIRE_PLUGIN_SCRIPTS=../escape.js cell7 "$TEST_TMP/s7-escape" "$AR/on.json"
grep -q '"failure_cause":"plugin_script_unresolvable"' "$TEST_TMP/s7-escape/result.json" || fail "a path escaping the plugin root must fail the check ($(cat "$TEST_TMP/s7-escape/result.json"))"
grep -q "bad required script path" "$TEST_TMP/s7-escape/preflight.log" || fail "the escape must be refused by the path guard, not by a failed load"
[ ! -e "$SENT" ] || fail "escape: the agent must NOT be started"
# default (env unset): no check, rows of every other eval are unchanged
( unset ONOFF_REQUIRE_PLUGIN_SCRIPTS; cell7 "$TEST_TMP/s7-default" "$TEST_TMP/arm-noplugin.json" )
grep -q '"failure_class":null' "$TEST_TMP/s7-default/result.json" && [ -e "$SENT" ] || fail "without the env the check must be off"
# campaign level: a plugin that lacks the script STOPs the whole campaign (24 infra_fail rows), nothing is scored
mkdir -p "$TEST_TMP/arms-noplugin"
for a in off on; do node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1]));j.files=["files-x"];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$AR/$a.json" "$TEST_TMP/arms-noplugin/$a.json"; done
RES7="$TEST_TMP/e2e7/stage-graph-g67.v2.jsonl"; mkdir -p "$TEST_TMP/e2e7"
rc=0; o=$(ONOFF_STUB_BIN="$STUB_E2E" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$RES7" --runner stub --arms-dir "$TEST_TMP/arms-noplugin" --prereg "$PREREG" 2>/dev/null | tail -1) || rc=$?
[ "$rc" = 4 ] && grep -q '"STOP"' <<<"$o" || fail "a plugin without session-mode.js must STOP the campaign (rc=$rc $o)"
[ "$(grep -c '"failure_cause":"plugin_script_unresolvable"' "$RES7")" -eq 24 ] || fail "expected 24 plugin_script_unresolvable rows"
# a live (cc) run on the pinned claude refuses null or mismatching arm shas (the real prereg is unstamped until the post-merge stamp)
mkdir -p "$TEST_TMP/pinbin"; printf '#!/usr/bin/env bash\necho "2.1.292 (Claude Code)"\n' > "$TEST_TMP/pinbin/claude"; chmod +x "$TEST_TMP/pinbin/claude"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.runner_pin_path=process.argv[3];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG" "$TEST_TMP/prereg-pinbin.json" "$TEST_TMP/pinbin/"
rc=0; o=$(PATH="$TEST_TMP/pinbin:$PATH" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$TEST_TMP/live2.jsonl" --arms-dir "$AR" --prereg "$TEST_TMP/prereg-pinbin.json" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q "not stamped" <<<"$o" || fail "live run must refuse null arm shas (rc=$rc $o)"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.arm_manifests.off.sha256="d".repeat(64);j.arm_manifests.on.sha256="e".repeat(64);fs.writeFileSync(process.argv[1],JSON.stringify(j))' "$TEST_TMP/prereg-pinbin.json"
rc=0; o=$(PATH="$TEST_TMP/pinbin:$PATH" ONOFF_PACKS_DIR="$PK" node "$BASE/run-g67-campaign.js" --results "$TEST_TMP/live2.jsonl" --arms-dir "$AR" --prereg "$TEST_TMP/prereg-pinbin.json" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q "does not match" <<<"$o" || fail "live run must refuse mismatching arm shas (rc=$rc $o)"
[ ! -e "$TEST_TMP/live2.jsonl" ] || fail "a refusal must not create a results file"

# the prereg must register plugin_required_scripts: absent or empty is a loud refusal, not a silently disabled check
for v in delete empty; do
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(process.argv[3]==="delete")delete j.plugin_required_scripts;else j.plugin_required_scripts=[];fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$PREREG" "$TEST_TMP/prereg-nopsr.json" "$v"
  rc=0; o=$(node "$BASE/run-g67-campaign.js" --results "$TEST_TMP/nopsr.jsonl" --dry-run --prereg "$TEST_TMP/prereg-nopsr.json" 2>&1) || rc=$?
  [ "$rc" = 2 ] && grep -q plugin_required_scripts <<<"$o" || fail "prereg with plugin_required_scripts $v must be refused (rc=$rc $o)"
done

echo "PASS: skill-onoff-g67 (markers, fixtures, scorer, timeout knob, campaign, plugin-script self-check)"
