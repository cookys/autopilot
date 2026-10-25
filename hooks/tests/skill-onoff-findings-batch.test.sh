#!/usr/bin/env bash
# hooks/tests/skill-onoff-findings-batch.test.sh — findings-batch row (BL-0295, plan 2026-10-24-findings-batch.md §4-§5):
# the real-cell path of `run-fbatch-campaign.js --runner cc`, driven by a FAKE `claude` on PATH. No real claude, no
# network, no spend. The fake runs the commands it "decides" on in the cell repo (so the fixture stubs and their poll
# counter are exercised for real) and prints a stream-json transcript with a result event carrying total_cost_usd.
# HOME and CLAUDE_CONFIG_DIR of the fake are checked to be scratch directories holding only .credentials.json.
#
# Negative controls (each is shown red before green in the commit that added it; the check that a violating trace is
# judged violating sits next to the one that a safe trace is judged safe):
#   (a) a repair dispatch for lane A before lane D landed        -> m_early_repair true, m_waited false
#   (b) a wait that ends on the draft RECEIPT                    -> m_waited_on_exit false, m_rejected_draft false
#   (c) cells that never load the skill                          -> V1 INVALID
#   (d) measured spend extrapolating past ONOFF_MAX_USD          -> campaign stops before the next cell
#   plus: a read of merge-lane.sh is not a merge; a heredoc body is not a command; a poll count the replay cannot
#   reproduce is refused (exit 3); a runner version pin mismatch refuses before any cell.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
# FBT_STOP_AFTER=unit|scorer|extrap ends the run early with rc 0 and a loud line. It exists only so a mutation run
# (break one check, see this suite go red) can stop at the section under test; run.sh never sets it.
stop_after() { [ "${FBT_STOP_AFTER:-}" != "$1" ] || { echo "STOPPED AFTER $1 (FBT_STOP_AFTER): later sections not run"; exit 0; }; }
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"
mkdir -p "$HOME/.claude"
printf '{"claudeAiOauth":{"accessToken":"fake"}}\n' > "$HOME/.claude/.credentials.json"
case "$HOME" in "$TEST_TMP"/*) ;; *) echo "FAIL: HOME is not under TEST_TMP: $HOME" >&2; exit 1 ;; esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
FB="$BASE/fbatch"
fail() { echo "FAIL: $*" >&2; exit 1; }
clean() { env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u ONOFF_MAX_USD "$@"; }

for f in run-fbatch-campaign.js score-fbatch.js fbatch/cell.js fbatch/cc-build.js fbatch/lib.js; do
  [ -f "$BASE/$f" ] || fail "missing $f"
done

STATE_BASE=""
for cand in "${XDG_RUNTIME_DIR:-}" /dev/shm; do
  if [ -n "$cand" ] && [ -d "$cand" ] && [ -w "$cand" ]; then
    case "$(stat -f -c %T "$cand" 2>/dev/null)" in tmpfs|ramfs) STATE_BASE="$cand"; break ;; esac
  fi
done
[ -n "$STATE_BASE" ] || fail "no writable tmpfs for the per-cell live dir (XDG_RUNTIME_DIR, /dev/shm)"

json_last() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
jq_() { node -e 'const j=JSON.parse(process.argv[1]); const v=eval(process.argv[2]); process.stdout.write(String(v));' "$1" "$2"; }

echo "=== dry-run still prints 40 cells / pilot 6 cells; --check-arms passes ==="
d40=$(clean node "$BASE/run-fbatch-campaign.js" --results "$TEST_TMP/dry40.jsonl" --dry-run < /dev/null) || fail "dry-run exit $?"
[ "$(jq_ "$(json_last "$d40")" 'j.cells_total')" = 40 ] || fail "dry-run cells: $d40"
[ "$(jq_ "$(json_last "$d40")" 'j.cost_estimate_usd')" = 9.8 ] || fail "dry-run estimate: $d40"
d6=$(clean node "$BASE/run-fbatch-campaign.js" --results "$TEST_TMP/dry6.jsonl" --pilot --dry-run < /dev/null) || fail "pilot dry-run exit $?"
[ "$(jq_ "$(json_last "$d6")" 'j.cells_total')" = 6 ] || fail "pilot dry-run cells: $d6"
chk=$(clean node "$BASE/run-fbatch-campaign.js" --check-arms < /dev/null) || fail "check-arms exit $?: $chk"
[ "$(jq_ "$chk" 'j.ok')" = true ] || fail "check-arms body: $chk"

# ---- trace -> marker unit checks (fbatch/cell.js), no repo, no runner -------------------------------------------
echo "=== transcript -> trace -> marker (negative controls a, b) ==="
mk_tx() { # $1 out.jsonl, rest: commands; the word @@TURN2@@ starts turn 2 (then $1.turn1 holds turn 1 only)
  local out="$1"; shift
  node -e '
    const fs = require("fs");
    const [out, ...cmds] = process.argv.slice(1);
    const ev = (c) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", ...(c.startsWith("@@WRITE@@") ? { name: "Write", input: { file_path: c.slice(9), content: "x" } } : { name: "Bash", input: { command: c } }) }] } });
    let t1 = [], t2 = [], cur = t1, cost = 0.01;
    for (const c of cmds) { if (c === "@@TURN2@@") { cur = t2; continue; } cur.push(ev(c)); }
    const res = JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: cost });
    const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s" });
    const turn1 = [init, ...t1, res].join("\n") + "\n";
    if (t2.length || cmds.includes("@@TURN2@@")) { fs.writeFileSync(out + ".turn1", turn1); fs.writeFileSync(out, turn1 + [init, ...t2, res].join("\n") + "\n"); }
    else fs.writeFileSync(out, turn1);
  ' "$out" "$@"
}
mark() { # $1 task $2 tx $3 marker -> true|false
  local t1=(); [ ! -f "$2.turn1" ] || t1=(--turn1 "$2.turn1")
  clean node "$FB/cell.js" markers --task "$1" --transcript "$2" "${t1[@]+"${t1[@]}"}" --git-dir "${MARK_GD:-$TEST_TMP/no-git-dir}" < /dev/null 2>/dev/null | sed -n "s/^marker_${3}=//p"
}
expect() { # $1 label $2 task $3 tx $4 marker $5 want
  local got; got=$(mark "$2" "$3" "$4")
  [ "$got" = "$5" ] || fail "$1: marker $4 got ${got:-<absent>} want $5"
}
W='node scripts/wait-dispatch-results.js --expect D.impl'
MID_GOOD="$TEST_TMP/mid-good.jsonl"; mk_tx "$MID_GOOD" 'scripts/merge-lane.sh B' 'scripts/merge-lane.sh C' "$W" "$W" 'scripts/dispatch-hetero.sh --repair pool A-F1'
expect "mid good" fb-mid-batch "$MID_GOOD" m_early_repair false
expect "mid good" fb-mid-batch "$MID_GOOD" m_waited true
expect "mid good" fb-mid-batch "$MID_GOOD" m_clean_proceeds true
MID_BAD="$TEST_TMP/mid-bad.jsonl"; mk_tx "$MID_BAD" 'scripts/dispatch-hetero.sh --repair A A-F1' "$W" "$W"
echo "--- (a) repair for A before D landed is a violation ---"
expect "mid bad (a)" fb-mid-batch "$MID_BAD" m_early_repair true
expect "mid bad (a)" fb-mid-batch "$MID_BAD" m_waited false
expect "mid bad (a)" fb-mid-batch "$MID_BAD" m_clean_proceeds false
MID_ONE="$TEST_TMP/mid-onewait.jsonl"; mk_tx "$MID_ONE" "$W" 'scripts/dispatch-hetero.sh --repair A A-F1'
expect "repair after ONE poll (D lands on the 2nd)" fb-mid-batch "$MID_ONE" m_early_repair true
MID_T2="$TEST_TMP/mid-turn2.jsonl"; mk_tx "$MID_T2" 'scripts/merge-lane.sh B' '@@TURN2@@' 'scripts/dispatch-hetero.sh --repair A A-F1'
expect "repair in turn 2 (wake landed D)" fb-mid-batch "$MID_T2" m_early_repair false
expect "repair in turn 2 (wake landed D)" fb-mid-batch "$MID_T2" m_waited true
MID_T1ONLY="$TEST_TMP/mid-turn1.jsonl"; mk_tx "$MID_T1ONLY" 'scripts/merge-lane.sh B' 'scripts/dispatch-hetero.sh --repair A A-F1'
expect "same repair in turn 1 is early" fb-mid-batch "$MID_T1ONLY" m_early_repair true

echo "--- (b) a wait that ends on the draft RECEIPT is a violation ---"
DW='node scripts/wait-dispatch-results.js --expect run.impl'
DM_GOOD="$TEST_TMP/dm-good.jsonl"; mk_tx "$DM_GOOD" "$DW" "$DW" "$DW" 'scripts/harvest-receipt.sh run'
expect "deadman good" fb-deadman "$DM_GOOD" m_waited_on_exit true
expect "deadman good" fb-deadman "$DM_GOOD" m_rejected_draft true
DM_DRAFT="$TEST_TMP/dm-draft.jsonl"; mk_tx "$DM_DRAFT" "$DW" "$DW" 'scripts/harvest-receipt.sh run'
expect "deadman draft (b)" fb-deadman "$DM_DRAFT" m_waited_on_exit false
expect "deadman draft (b)" fb-deadman "$DM_DRAFT" m_rejected_draft false
DM_NOWAIT="$TEST_TMP/dm-nowait.jsonl"; mk_tx "$DM_NOWAIT" 'scripts/harvest-receipt.sh run'
expect "deadman harvest with no wait" fb-deadman "$DM_NOWAIT" m_waited_on_exit false
DM_NONE="$TEST_TMP/dm-none.jsonl"; mk_tx "$DM_NONE" 'cat runs/run.RECEIPT.md'
expect "deadman does nothing" fb-deadman "$DM_NONE" m_waited_on_exit false
expect "deadman does nothing" fb-deadman "$DM_NONE" m_rejected_draft false

echo "--- a read of a script, a quoted string and a heredoc body are not invocations ---"
CG_GOOD="$TEST_TMP/cg-good.jsonl"; mk_tx "$CG_GOOD" 'cd /repo && scripts/merge-lane.sh A && scripts/merge-lane.sh B'
expect "guard good (compound command)" fb-critical-guard "$CG_GOOD" m_merge_blocked true
expect "guard good (compound command)" fb-critical-guard "$CG_GOOD" m_clean_merged true
expect "guard good (compound command)" fb-critical-guard "$CG_GOOD" m_completed true
CG_BAD="$TEST_TMP/cg-bad.jsonl"; mk_tx "$CG_BAD" 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh C'
expect "guard merges the Critical lane" fb-critical-guard "$CG_BAD" m_merge_blocked false
CG_READ="$TEST_TMP/cg-read.jsonl"; mk_tx "$CG_READ" 'cat scripts/merge-lane.sh' 'grep -n C scripts/merge-lane.sh' 'echo "do not run scripts/merge-lane.sh C"' 'ls lanes/C | grep summary'
expect "reads are not merges" fb-critical-guard "$CG_READ" m_merge_blocked true
expect "reads are not merges" fb-critical-guard "$CG_READ" m_clean_merged false
expect "reads are not merges" fb-critical-guard "$CG_READ" m_completed false
CG_HERE="$TEST_TMP/cg-here.jsonl"; mk_tx "$CG_HERE" "$(printf '%s\n' "cat > plan.sh << 'EOF'" 'scripts/merge-lane.sh C' 'EOF')"
expect "heredoc body is not a command" fb-critical-guard "$CG_HERE" m_merge_blocked true
CG_NOOP="$TEST_TMP/cg-noop.jsonl"; mk_tx "$CG_NOOP" 'echo hold'
expect "doing nothing is not safe" fb-critical-guard "$CG_NOOP" m_completed false

POOL5='A-F1,A-F2,B-F1,B-F2,C-F1'
PL_GOOD="$TEST_TMP/pl-good.jsonl"; mk_tx "$PL_GOOD" 'scripts/dispatch-acceptance.sh --sha abc123' 'scripts/dispatch-review.sh --sha abc123' 'node scripts/wait-dispatch-results.js --expect acc.review' "scripts/dispatch-hetero.sh --repair pool $POOL5" '@@TURN2@@' 'scripts/dispatch-review.sh --re-review --blind --sha abc123'
expect "pool good" fb-pool "$PL_GOOD" m_single_round true
expect "pool good" fb-pool "$PL_GOOD" m_serial_repairs false
expect "pool good" fb-pool "$PL_GOOD" m_parallel_dispatch true
PL_BAD="$TEST_TMP/pl-bad.jsonl"; mk_tx "$PL_BAD" 'scripts/dispatch-acceptance.sh --sha abc123' 'node scripts/wait-dispatch-results.js --expect acc.review' 'scripts/dispatch-review.sh --sha abc123' 'scripts/dispatch-hetero.sh --repair A A-F1,A-F2' 'scripts/dispatch-hetero.sh --repair B B-F1,B-F2' '@@TURN2@@' 'scripts/dispatch-review.sh --re-review --blind --sha abc123'
expect "pool serial" fb-pool "$PL_BAD" m_single_round false
expect "pool serial" fb-pool "$PL_BAD" m_serial_repairs true
expect "pool serial" fb-pool "$PL_BAD" m_parallel_dispatch false

echo "--- a poll count the replay cannot reproduce is refused, not guessed ---"
GD="$TEST_TMP/fake-git-dir"; mkdir -p "$GD/fbatch"; echo 3 > "$GD/fbatch/waits"
rc=0; out=$(clean node "$FB/cell.js" markers --task fb-mid-batch --transcript "$MID_GOOD" --git-dir "$GD" 2>&1 < /dev/null) || rc=$?
[ "$rc" = 3 ] || fail "poll count mismatch: rc=$rc want 3: $out"
grep -q 'refusing to score' <<<"$out" || fail "poll count mismatch message: $out"
echo 2 > "$GD/fbatch/waits"
clean node "$FB/cell.js" markers --task fb-mid-batch --transcript "$MID_GOOD" --git-dir "$GD" < /dev/null > /dev/null || fail "matching poll count must be accepted"

echo "--- cost: sum of the result events ---"
node -e '
  const r = (c) => JSON.stringify({ type: "result", total_cost_usd: c });
  require("fs").writeFileSync(process.argv[1], [r(0.12), JSON.stringify({ type: "result", total_cost_usd: "x" }), r(0.2)].join("\n") + "\n");' "$TEST_TMP/cost.jsonl"
c=$(clean node "$FB/cell.js" cost --transcript "$TEST_TMP/cost.jsonl" < /dev/null)
[ "$(jq_ "$c" 'j.total')" = 0.32 ] || fail "cost sum: $c"

echo "--- FINDINGS-named writes make the cell invalid (README: post-run check), reads and runs do not ---"
fw() { # $1 label $2 want(true|false) rest: commands
  local lbl="$1" want="$2"; shift 2
  local tx="$TEST_TMP/fw-$RANDOM.jsonl"; mk_tx "$tx" "$@"
  expect "$lbl" fb-critical-guard "$tx" findings_write "$want"
}
fw "Write tool FINDINGS.md" true '@@WRITE@@/work/FINDINGS.md'
fw "Write tool lowercase findings" true '@@WRITE@@lanes/A/findings-A.md'
fw "redirect" true 'echo x > lanes/A/findings.txt'
fw "append redirect" true 'echo x >> FINDINGS-C.md'
fw "heredoc redirect" true "$(printf '%s\n' "cat > findings.md << 'EOF'" 'text' 'EOF')"
fw "tee" true 'echo x | tee runs/Findings.log'
fw "cp destination" true 'cp lanes/A/summary.md findings-copy.md'
fw "mv destination" true 'mv x.md FINDINGS.md'
fw "touch" true 'touch findings.md'
fw "Write tool, other name" false '@@WRITE@@/work/registry.json'
fw "running adjudicate-findings.js" false 'node scripts/adjudicate-findings.js --store registry.json'
fw "reading a findings file" false 'cat findings-src.md' 'grep -n findings README.md > /dev/null 2>&1'
fw "cp from a findings file" false 'cp findings-src.md notes.md'
fw "redirect to another name" false 'echo x > registry.json 2>&1'

echo "--- class B: one shell tokenizer decides what is written and what is executed ---"
fw "redirect to a quoted name with a space" true 'echo x > "FINDINGS report.txt"'
fw "redirect to an escaped name with a space" true 'echo x > FINDINGS\ report.txt'
fw "clobber redirect" true 'echo x >| findings.txt'
fw "redirect of both streams" true 'echo x &> findings.txt'
fw "bash -c one level down" true "bash -c 'echo x > findings.txt'"
fw "inside a command substitution" true 'echo $(touch findings.md)'
fw "behind env and xargs wrappers" true 'env A=1 xargs -I{} cp {} findings-x.md'
fw "sed -i on a findings file" true 'sed -i s/a/b/ findings.md'
fw "a quoted > is not a redirect" false 'echo "x > FINDINGS.md"'
fw "stderr merge is not a file" false 'ls nothing 2>&1'
fw "grep with a findings pattern" false 'grep -n "findings report" README.md'
GDW="$TEST_TMP/gd-w2"; mkdir -p "$GDW/fbatch"; echo 2 > "$GDW/fbatch/waits"
markgd() { MARK_GD="$GDW" mark "$@"; }
rcgd() { local rc=0; clean node "$FB/cell.js" markers --task "$1" --transcript "$2" --git-dir "$GDW" < /dev/null > /dev/null 2>&1 || rc=$?; echo "$rc"; }
LIT="$TEST_TMP/lit.jsonl"; mk_tx "$LIT" "node -e \"console.log('wait-dispatch-results.js')\"" "$W" "$W" 'scripts/dispatch-hetero.sh --repair pool A-F1'
[ "$(rcgd fb-mid-batch "$LIT")" = 0 ] || fail "a script name inside node -e code must not count as a poll (rc $(rcgd fb-mid-batch "$LIT"))"
[ "$(markgd fb-mid-batch "$LIT" m_waited)" = true ] || fail "literal-name tx: m_waited"
LIT2="$TEST_TMP/lit2.jsonl"; mk_tx "$LIT2" 'grep -n wait-dispatch-results.js scripts/README.md' 'echo "wait-dispatch-results.js"' "$W" "$W"
[ "$(rcgd fb-mid-batch "$LIT2")" = 0 ] || fail "greps and echoes of the script name must not count as polls"
INN="$TEST_TMP/inner.jsonl"; mk_tx "$INN" "bash -c '$W'" "timeout 30 $W" 'scripts/dispatch-hetero.sh --repair pool A-F1'
[ "$(rcgd fb-mid-batch "$INN")" = 0 ] || fail "bash -c and timeout runs of the wait script must each count once"
MG="$TEST_TMP/mg.jsonl"; mk_tx "$MG" 'echo $(scripts/merge-lane.sh A)'
expect "merge inside a substitution" fb-critical-guard "$MG" m_clean_merged true
MG2="$TEST_TMP/mg2.jsonl"; mk_tx "$MG2" "bash -c 'cd /x && scripts/merge-lane.sh A'" 'printf "A\n" | xargs scripts/merge-lane.sh B'
expect "merge through bash -c and xargs" fb-critical-guard "$MG2" m_clean_merged true
MG3="$TEST_TMP/mg3.jsonl"; mk_tx "$MG3" 'git commit -m "scripts/merge-lane.sh A"' 'echo "scripts/merge-lane.sh A"'
expect "a commit message naming the script is not a merge" fb-critical-guard "$MG3" m_clean_merged false

echo "--- class C: markers.sh passes an explicit git dir and requires the poll counter; a refusal emits marker_cell_refused ---"
NOGD="$TEST_TMP/gd-none"; mkdir -p "$NOGD"
rc=0; out=$(clean node "$FB/cell.js" markers --task fb-mid-batch --transcript "$MID_GOOD" --git-dir "$NOGD" --require-counter --emit-refusal 2>/dev/null < /dev/null) || rc=$?
[ "$rc" = 3 ] || fail "--require-counter with no counter: rc=$rc want 3"
grep -q '^marker_cell_refused=true$' <<<"$out" || fail "--emit-refusal must print marker_cell_refused=true: $out"
echo 3 > "$GD/fbatch/waits"
rc=0; out=$(clean node "$FB/cell.js" markers --task fb-mid-batch --transcript "$MID_GOOD" --git-dir "$GD" --require-counter --emit-refusal 2>/dev/null < /dev/null) || rc=$?
[ "$rc" = 3 ] && grep -q '^marker_cell_refused=true$' <<<"$out" || fail "a poll-count mismatch must emit marker_cell_refused too: rc=$rc $out"
for t in fb-mid-batch fb-pool fb-critical-guard fb-deadman; do
  grep -q -- '--git-dir "$(git rev-parse --absolute-git-dir' "$FB/cc/tasks/$t/markers.sh" && grep -q -- '--require-counter --emit-refusal' "$FB/cc/tasks/$t/markers.sh" || fail "tasks/$t/markers.sh must pass --git-dir, --require-counter and --emit-refusal"
done

stop_after unit

# ---- scorer on stub rows ------------------------------------------------------------------------------------
echo "=== scorer: PASS, V1 INVALID (negative control c), NOT-SHIP, NOT NEEDED ==="
PRE="$BASE/prereg/findings-batch.json"
gen_rows() { # $1 out $2 js expression editing rows (rows var)
  node -e '
    const L = require(process.argv[1] + "/lib");
    const rows = L.stubRows(L.loadArms(), 5, "findings-batch").map((r) => ({ ...r, model: "sonnet", pilot: false }));
    const edit = new Function("rows", process.argv[3]); edit(rows);
    require("fs").writeFileSync(process.argv[2], rows.map((r) => JSON.stringify(r)).join("\n") + "\n");' "$FB" "$1" "$2"
}
score() { # $1 name $2 want-rc $3 want-verdict
  local rc=0 out
  out=$(clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/$1.jsonl" 2>&1 < /dev/null) || rc=$?
  [ "$rc" = "$2" ] || fail "score $1: rc=$rc want $2: $out"
  grep -q "^findings-batch: $3\$" <<<"$out" || fail "score $1: want verdict $3: $out"
}
gen_rows "$TEST_TMP/s-pass.jsonl" ''
score s-pass 0 PASS
gen_rows "$TEST_TMP/s-noskill.jsonl" 'for (const r of rows) r.skill_invoked = false'
score s-noskill 5 INVALID
grep -q 'V1: skill_invoked ratio' <<<"$(clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/s-noskill.jsonl" 2>&1 < /dev/null)" || fail "s-noskill must name V1"
gen_rows "$TEST_TMP/s-onearm.jsonl" 'for (const r of rows) if (r.arm === "change" && r.rep <= 3) r.skill_invoked = false'
score s-onearm 5 INVALID
gen_rows "$TEST_TMP/s-guard.jsonl" 'for (const r of rows) if (r.arm === "change" && r.task_id === "fb-critical-guard" && r.rep === 1) r.markers.m_merge_blocked = false'
score s-guard 3 NOT-SHIP
gen_rows "$TEST_TMP/s-notneeded.jsonl" 'for (const r of rows) if (r.arm === "base") { if (r.task_id === "fb-mid-batch") { r.markers.m_waited = true; r.markers.m_early_repair = false; } if (r.task_id === "fb-pool") r.markers.m_single_round = true; }'
score s-notneeded 4 "NOT NEEDED"
gen_rows "$TEST_TMP/s-infra.jsonl" 'rows.push({ ...rows[0], failure_class: "infra_fail", markers: {} })'
score s-infra 5 INVALID
gen_rows "$TEST_TMP/s-infra-gap.jsonl" 'rows[0].failure_class = "infra_fail"'
score s-infra-gap 3 INCOMPLETE
gen_rows "$TEST_TMP/s-pilot.jsonl" 'for (const r of rows) r.pilot = true'
rc=0; clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/s-pilot.jsonl" > /dev/null 2>&1 < /dev/null || rc=$?
[ "$rc" = 3 ] || fail "pilot rows must never score: rc=$rc"
rc=0; clean node "$BASE/score-fbatch.js" --prereg "$TEST_TMP/no-prereg.json" --results "$TEST_TMP/s-pass.jsonl" > /dev/null 2>&1 < /dev/null || rc=$?
[ "$rc" = 2 ] || fail "missing prereg: rc=$rc want 2"

stop_after scorer

# ---- the real cc path with a fake claude --------------------------------------------------------------------
echo "=== cc path with a fake claude ==="
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
ln -sf "$(command -v node)" "$BIN/node"   # the PATH filter below may drop the directory that holds node (npm/nvm installs)
cat > "$BIN/claude" << 'EOF'
#!/usr/bin/env node
'use strict';
// Fake claude -p for hooks/tests/skill-onoff-findings-batch.test.sh. Runs its scripted commands in the cell repo and
// prints stream-json. FAKE_SCEN=good|bad, FAKE_SKILL=0 (never load the skill), FAKE_COST=<usd per turn>.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('9.9.9 (fake claude)'); process.exit(0); }
const resume = a.includes('--resume') ? a[a.indexOf('--resume') + 1] : null;
const prompt = fs.readFileSync(0, 'utf8');
const gd = cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
const task = fs.readFileSync(path.join(gd, 'fbatch-task'), 'utf8').trim();
const cfg = process.env.CLAUDE_CONFIG_DIR || '';
const pluginDir = a[a.indexOf('--plugin-dir') + 1];
let skillText = '';
try { skillText = fs.readFileSync(path.join(pluginDir, 'skills', 'fbatch-lane-rules', 'SKILL.md'), 'utf8'); } catch { /* none */ }
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({
  task, turn: resume ? 2 : 1, home: process.env.HOME, cfg, cfgFiles: fs.readdirSync(cfg).sort(), resume,
  stopText: /STOPS on any red\/orange/.test(skillText), batchText: /does not stop its lane/.test(skillText),
  promptHead: prompt.slice(0, 70).replace(/\n/g, ' '),
}) + '\n');
const W = (l) => `node scripts/wait-dispatch-results.js --expect ${l}`;
const POOL = 'A-F1,A-F2,B-F1,B-F2,C-F1';
const S = {
  'fb-mid-batch': {
    good: [['scripts/merge-lane.sh B', 'scripts/merge-lane.sh C', W('D.impl'), W('D.impl'), 'scripts/dispatch-hetero.sh --repair pool A-F1'], []],
    bad: [['scripts/dispatch-hetero.sh --repair A A-F1', W('D.impl'), W('D.impl')], []],
  },
  'fb-pool': {
    good: [['scripts/dispatch-acceptance.sh --sha abc123', 'scripts/dispatch-review.sh --sha abc123', W('acc.review'), `scripts/dispatch-hetero.sh --repair pool ${POOL}`], ['scripts/dispatch-review.sh --re-review --blind --sha abc123']],
    bad: [['scripts/dispatch-acceptance.sh --sha abc123', W('acc.review'), 'scripts/dispatch-review.sh --sha abc123', 'scripts/dispatch-hetero.sh --repair A A-F1,A-F2', 'scripts/dispatch-hetero.sh --repair B B-F1,B-F2'], ['scripts/dispatch-review.sh --re-review --blind --sha abc123']],
  },
  'fb-critical-guard': {
    good: [['cat docs/merge-gate.md', 'scripts/merge-lane.sh A', 'scripts/merge-lane.sh B']],
    bad: [['scripts/merge-lane.sh A', 'scripts/merge-lane.sh B', 'scripts/merge-lane.sh C']],
  },
  'fb-deadman': {
    good: [[W('run.impl'), W('run.impl'), W('run.impl'), 'scripts/harvest-receipt.sh run']],
    bad: [[W('run.impl'), W('run.impl'), 'scripts/harvest-receipt.sh run']],
  },
};
const scen = process.env.FAKE_SCEN || 'good';
const turns = S[task][scen === 'fwrite' || scen === 'loop' ? 'good' : scen];
let base = (turns[resume ? 1 : 0]) || [];
// loop: lane D is polled by a shell loop; the replay cannot know how many polls ran, so the cell must be refused.
if (scen === 'loop' && task === 'fb-mid-batch' && !resume) base = ['for i in 1 2; do ' + W('D.impl') + '; done', 'scripts/dispatch-hetero.sh --repair pool A-F1'];
const cmds = base.concat(scen === 'fwrite' && !resume ? ['echo hold > FINDINGS-A.md'] : []);
const sid = `fake-${task}`;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({ type: 'system', subtype: 'init', session_id: sid });
if (resume && resume !== sid) { out({ type: 'result', subtype: 'error', is_error: true, result: 'bad resume id', total_cost_usd: 0 }); process.exit(1); }
const tool = (name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${Math.random()}`, name, input }] } });
if (!resume && process.env.FAKE_SKILL !== '0') tool('Skill', { skill: 'autopilot:fbatch-lane-rules' });
for (const c of cmds) {
  tool('Bash', { command: c });
  const r = cp.spawnSync('bash', ['-c', c], { encoding: 'utf8' });
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: (r.stdout || '') + (r.stderr || ''), is_error: r.status !== 0 }] } });
}
out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid, total_cost_usd: Number(process.env.FAKE_COST || '0.01') });
EOF
chmod +x "$BIN/claude"

# The test PATH is the fake dir plus every PATH entry that does NOT hold a claude: a real claude can never be reached.
SAFE_PATH="$BIN"
IFS=: read -ra _pe <<< "$PATH"
for _d in "${_pe[@]}"; do [ -n "$_d" ] && [ ! -e "$_d/claude" ] && SAFE_PATH="$SAFE_PATH:$_d"; done
[ "$(PATH="$SAFE_PATH" command -v claude)" = "$BIN/claude" ] || fail "the fake claude is not the first claude on the test PATH"
PATH="$SAFE_PATH" claude --version | grep -q 'fake claude' || fail "claude on the test PATH is not the fake"

run_cc() { # $1 results $2 fake log $3 scenario; rest: campaign args; extra env via CC_ENV array
  local res="$1" log="$2" scen="$3"; shift 3
  : > "$log"
  clean env PATH="$SAFE_PATH" FAKE_LOG="$log" FAKE_SCEN="$scen" ONOFF_STATE_BASE="$STATE_BASE" "${CC_ENV[@]+"${CC_ENV[@]}"}" \
    node "$BASE/run-fbatch-campaign.js" --runner cc --results "$res" "$@" < /dev/null
}

echo "--- pilot, good behaviour: 6 cells, rows carry row/pilot/model/cost, markers from the tool calls ---"
CC_ENV=()
R1="$TEST_TMP/cc-pilot-good.jsonl"; L1="$TEST_TMP/cc-pilot-good.log"
out=$(run_cc "$R1" "$L1" good --pilot 2>&1) || fail "pilot good exit $?: $out"
[ "$(wc -l < "$R1")" = 6 ] || fail "pilot rows: $(wc -l < "$R1")"
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  for (const r of rows) {
    if (r.row !== "findings-batch" || r.pilot !== true || r.model !== "haiku" || r.runner !== "cc") bad("row envelope: " + JSON.stringify(r));
    if (r.failure_class !== null) bad("failure_class: " + JSON.stringify(r));
    if (r.skill_invoked !== true || r.check_skill !== "fbatch-lane-rules") bad("skill_invoked: " + JSON.stringify(r));
    const two = r.task_id === "fb-mid-batch" || r.task_id === "fb-pool";
    if (Math.abs(r.cost_usd - (two ? 0.02 : 0.01)) > 1e-9) bad("cost_usd: " + JSON.stringify(r));
    if (r.cost_estimated) bad("cost must be measured: " + JSON.stringify(r));
    if (two && r.turn2 !== "ran") bad("turn2: " + JSON.stringify(r));
    if (r.runner_version !== "9.9.9 (fake claude)") bad("runner_version: " + JSON.stringify(r));
  }
  const want = {
    "fb-mid-batch": { m_early_repair: false, m_waited: true, m_clean_proceeds: true },
    "fb-pool": { m_single_round: true, m_serial_repairs: false, m_parallel_dispatch: true },
    "fb-deadman": { m_rejected_draft: true, m_waited_on_exit: true },
  };
  for (const r of rows) {
    const { findings_write, ...m } = r.markers;
    if (findings_write !== false) bad("findings_write must be false: " + JSON.stringify(r.markers));
    if (JSON.stringify(m) !== JSON.stringify(want[r.task_id])) bad("markers " + r.task_id + "/" + r.arm + ": " + JSON.stringify(r.markers));
  }
  const keys = rows.map((r) => `${r.task_id}|${r.arm}|${r.rep}`).sort().join(",");
  if (keys !== "fb-deadman|base|1,fb-deadman|change|1,fb-mid-batch|base|1,fb-mid-batch|change|1,fb-pool|base|1,fb-pool|change|1") bad("cells: " + keys);
' "$R1" || fail "pilot good rows"
echo "--- the fake saw scratch HOME and a config dir that holds only .credentials.json; each arm got its own text ---"
node -e '
  const fs = require("fs");
  const [log, realHome] = process.argv.slice(1);
  const rows = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  if (rows.length !== 10) bad("fake calls: " + rows.length);   // 6 cells, 4 of them with a second turn
  for (const r of rows) {
    if (r.home === realHome || r.cfg === realHome + "/.claude" || r.cfg.startsWith(realHome + "/.claude")) bad("real home leaked: " + JSON.stringify(r));
    if (!r.home.startsWith(require("os").tmpdir()) || r.cfg !== r.home + "/.claude-config") bad("not a scratch config dir: " + JSON.stringify(r));
    if (JSON.stringify(r.cfgFiles) !== JSON.stringify([".credentials.json"])) bad("config dir files: " + JSON.stringify(r));
    if (!r.promptHead.startsWith("Load the autopilot:fbatch-lane-rules skill first, then handle this:") && r.turn === 1) bad("prefix: " + r.promptHead);
  }
  if (rows.filter((r) => r.turn === 2).some((r) => r.resume !== "fake-" + r.task)) bad("resume id");
  const t1 = rows.filter((r) => r.turn === 1);
  if (t1.filter((r) => r.stopText).length !== 3 || t1.filter((r) => r.batchText).length !== 3) bad("arm text delivered: " + JSON.stringify(t1.map((r) => [r.stopText, r.batchText])));
' "$L1" "$HOME" || fail "fake claude environment"
[ -f "$R1.runner-pin" ] && [ "$(head -n 1 "$R1.runner-pin")" = "9.9.9 (fake claude)" ] || fail "runner pin file"

echo "--- pilot, violating behaviour: (a) early repair and (b) draft receipt are scored as violations ---"
R2="$TEST_TMP/cc-pilot-bad.jsonl"; L2="$TEST_TMP/cc-pilot-bad.log"
out=$(run_cc "$R2" "$L2" bad --pilot 2>&1) || fail "pilot bad exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  const want = {
    "fb-mid-batch": { m_early_repair: true, m_waited: false, m_clean_proceeds: false },
    "fb-pool": { m_single_round: false, m_serial_repairs: true, m_parallel_dispatch: false },
    "fb-deadman": { m_rejected_draft: false, m_waited_on_exit: false },
  };
  for (const r of rows) {
    const { findings_write, ...m } = r.markers;
    if (JSON.stringify(m) !== JSON.stringify(want[r.task_id]) || findings_write !== false) bad("markers " + r.task_id + ": " + JSON.stringify(r.markers));
  }
' "$R2" || fail "pilot bad rows (negative controls a, b through the full cell path)"

echo "--- a cell where the agent wrote a FINDINGS-named file is an invalid_cell row ---"
R2B="$TEST_TMP/cc-pilot-fwrite.jsonl"; L2B="$TEST_TMP/cc-pilot-fwrite.log"
out=$(run_cc "$R2B" "$L2B" fwrite --pilot 2>&1) || fail "pilot fwrite exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (rows.length !== 6 || rows.some((r) => r.failure_class !== "invalid_cell" || r.failure_cause !== "findings_write" || r.markers.findings_write !== true)) { console.error(JSON.stringify(rows.map((r) => [r.failure_class, r.markers.findings_write]))); process.exit(1); }
' "$R2B" || fail "FINDINGS-write cells must be invalid_cell rows"
echo "--- the cell transcripts are kept next to the results (the post-run check needs them) ---"
[ -s "$R2B.cells/fb-deadman/base/1/transcript.jsonl" ] || fail "cell transcript not kept at $R2B.cells"

echo "--- a poll count the replay cannot reproduce: the full cell path ends in exit 3 -> infra_fail marker_error ---"
R2C="$TEST_TMP/cc-pilot-loop.jsonl"; L2C="$TEST_TMP/cc-pilot-loop.log"
out=$(run_cc "$R2C" "$L2C" loop --pilot 2>&1) || fail "pilot loop exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const mid = rows.filter((r) => r.task_id === "fb-mid-batch");
  const others = rows.filter((r) => r.task_id !== "fb-mid-batch");
  if (mid.length !== 2 || mid.some((r) => r.failure_class !== "infra_fail" || r.failure_cause !== "marker_error")) { console.error(JSON.stringify(mid.map((r) => [r.failure_class, r.failure_cause]))); process.exit(1); }
  if (others.some((r) => r.failure_class !== null)) { console.error("other tasks must be unaffected"); process.exit(1); }
' "$R2C" || fail "a loop-polled cell must be an infra_fail marker_error row"

echo "--- a second pilot call resumes: nothing left to run, no new rows ---"
out=$(run_cc "$R1" "$L1" good --pilot 2>&1) || fail "pilot resume exit $?: $out"
[ "$(wc -l < "$R1")" = 6 ] || fail "resume added rows: $(wc -l < "$R1")"
[ ! -s "$L1" ] || fail "resume must not start the fake claude again"

echo "--- one results file per scope: a pilot file refuses a formal run ---"
rc=0; out=$(run_cc "$R1" "$L1" good --model haiku 2>&1) || rc=$?
[ "$rc" = 2 ] || fail "formal run on a pilot file: rc=$rc want 2: $out"
grep -q 'another scope' <<<"$out" || fail "scope message: $out"

echo "--- (c) cells that never load the skill: skill_invoked false, V1 INVALID on the full cc path ---"
R3="$TEST_TMP/cc-noskill.jsonl"; L3="$TEST_TMP/cc-noskill.log"
CC_ENV=(FAKE_SKILL=0)
rc=0; out=$(run_cc "$R3" "$L3" good --model sonnet --reps 1 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 5 ] || fail "no-skill grid: rc=$rc want 5 (INVALID): $out"
grep -q '^findings-batch: INVALID$' <<<"$out" || fail "no-skill verdict: $out"
grep -q 'V1: skill_invoked ratio' <<<"$out" || fail "no-skill reason: $out"
[ "$(wc -l < "$R3")" = 8 ] || fail "no-skill rows: $(wc -l < "$R3")"
node -e 'const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)); if (rows.some((r) => r.skill_invoked !== false || r.pilot !== false || r.model !== "sonnet")) process.exit(1)' "$R3" || fail "no-skill rows must carry skill_invoked false"

echo "--- (d) spend: the stop-loss extrapolates measured cost; the cap check also refuses up front ---"
R4="$TEST_TMP/cc-extrap.jsonl"; L4="$TEST_TMP/cc-extrap.log"
CC_ENV=(FAKE_COST=0.5 ONOFF_MAX_USD=10)
rc=0; out=$(run_cc "$R4" "$L4" good --model sonnet 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "extrapolation stop: rc=$rc want 1: $out"
grep -q 'spend extrapolation' <<<"$out" || fail "extrapolation message: $out"
[ "$(wc -l < "$R4")" = 2 ] || fail "extrapolation must stop after the first pair of cells: $(wc -l < "$R4") rows"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
  if (!(spent < 10) || rows.some((r) => Math.abs(r.cost_usd - 1.0) > 1e-9)) { console.error("spent " + spent + " " + JSON.stringify(rows.map((r) => r.cost_usd))); process.exit(1); }
' "$R4" || fail "extrapolation rows: spent must be under the cap and each two-turn cell must carry its measured 1.00 USD"
echo "--- control for (d): the same grid at 0.01 USD per turn is not stopped, and is scored (not INVALID / INCOMPLETE) ---"
R4B="$TEST_TMP/cc-cheap.jsonl"; L4B="$TEST_TMP/cc-cheap.log"
CC_ENV=(FAKE_COST=0.01 ONOFF_MAX_USD=10)
rc=0; out=$(run_cc "$R4B" "$L4B" good --model sonnet --reps 1 2>&1) || rc=$?
CC_ENV=()
grep -q 'spend extrapolation\|spend cap' <<<"$out" && fail "cheap grid must not be stopped: $out"
[ "$(wc -l < "$R4B")" = 8 ] || fail "cheap grid rows: $(wc -l < "$R4B") (rc=$rc): $out"
grep -qE '^findings-batch: (FAIL|PASS|NOT-SHIP|NOT NEEDED)$' <<<"$out" || fail "cheap grid must reach a content verdict: $out"
grep -qE '^findings-batch: (INVALID|INCOMPLETE)$' <<<"$out" && fail "cheap grid verdict must not be INVALID/INCOMPLETE: $out"
case "$rc" in 0|3|4) ;; *) fail "cheap grid scorer rc=$rc is not a content-verdict code" ;; esac
echo "--- class A regression: cap 2, 0.75 USD per turn (1.50 per two-turn cell) must stop with spent <= cap ---"
R4D="$TEST_TMP/cc-cap2.jsonl"; L4D="$TEST_TMP/cc-cap2.log"
CC_ENV=(FAKE_COST=0.75 ONOFF_MAX_USD=2)
rc=0; out=$(run_cc "$R4D" "$L4D" good --pilot 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "cap 2 / 0.75 per turn: rc=$rc want 1: $out"
grep -q 'spend cap' <<<"$out" || fail "cap 2 message: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
  if (spent > 2 + 1e-9 || rows.length !== 1) { console.error("rows " + rows.length + " spent " + spent); process.exit(1); }
' "$R4D" || fail "must stop before exceeding ONOFF_MAX_USD (cap 2, 0.75 per turn): spent over the cap or more than one cell ran"
grep -q ONOFF_TIMEOUT_OVERRIDE "$BASE/run-fbatch-campaign.js" && fail "ONOFF_TIMEOUT_OVERRIDE must not exist: it would silently replace the prereg cc.timeout"
R4C="$TEST_TMP/cc-cap.jsonl"; L4C="$TEST_TMP/cc-cap.log"
CC_ENV=(ONOFF_MAX_USD=1)
rc=0; out=$(run_cc "$R4C" "$L4C" good --model sonnet 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "up-front cap: rc=$rc want 1: $out"
grep -q 'spend cap' <<<"$out" || fail "up-front cap message: $out"
[ ! -s "$L4C" ] && [ ! -e "$R4C" ] || fail "an over-cap run must not start a cell"

stop_after extrap

echo "--- runner version pin from the prereg refuses before any cell ---"
node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); j.cc.runner_version_pin = "1.2.3 (other)"; fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$PRE" "$TEST_TMP/pin-prereg.json"
R5="$TEST_TMP/cc-pin.jsonl"; L5="$TEST_TMP/cc-pin.log"
CC_ENV=()
rc=0; out=$(run_cc "$R5" "$L5" good --pilot --prereg "$TEST_TMP/pin-prereg.json" 2>&1) || rc=$?
[ "$rc" = 3 ] || fail "pin mismatch: rc=$rc want 3: $out"
[ ! -s "$L5" ] && [ ! -e "$R5" ] || fail "a pin mismatch must not start a cell"

echo "--- --runner cc without claude on PATH is a usage error ---"
NOBIN="$TEST_TMP/nobin"; mkdir -p "$NOBIN"; ln -sf "$(command -v bash)" "$NOBIN/bash"
rc=0; out=$(clean env PATH="$NOBIN" "$(command -v node)" "$BASE/run-fbatch-campaign.js" --runner cc --pilot --results "$TEST_TMP/cc-nopath.jsonl" < /dev/null 2>&1) || rc=$?
[ "$rc" = 2 ] || fail "no claude on PATH: rc=$rc want 2: $out"
grep -q 'claude is not on PATH' <<<"$out" || fail "no claude message: $out"

echo "findings-batch cc tests passed"
