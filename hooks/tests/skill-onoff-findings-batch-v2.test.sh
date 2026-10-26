#!/usr/bin/env bash
# hooks/tests/skill-onoff-findings-batch-v2.test.sh — findings-batch-v2 (BL-0295, owner decision d-1a806a51 = B):
# prereg/findings-batch-v2.json, fbatch/cc-v2 fixtures, fbatch/lib-v2.js, score-fbatch-v2.js, run-fbatch-v2-campaign.js and the
# --disallowedTools copy of the cell runner. A FAKE `claude` on PATH only logs its argv; no real claude, no network, no spend.
# Every check has a negative control (the same check run against the v1 files or a mutated v2 input must go red):
#   (1) lane summaries name the real lane tip      v1 fixture (fbatch/cc): the sha resolves to nothing -> check red
#   (2) a landed repair advances lane/<L>, reports repaired_sha   v1 stubs: no new commit, no repaired_sha -> check red
#   (3) the 11 markers read the same evidence      v1 and v2 cells fed the same commands print identical marker lines
#   (4) ScheduleWakeup is denied in every turn     v1 campaign's argv has no --disallowedTools -> check red; a prereg without
#                                                  cc.disallowed_tools is refused before the first cell
#   (5) V3 of m_clean_proceeds is non-inferiority  change 4/5 + base 5/5: v2 PASS, v1 verdict FAIL; change 3/5: v2 FAIL
#   (6) prereg v2 = v1 + the listed differences    a changed rule outside the list turns the diff check red
set -uo pipefail
. "$(dirname "$0")/lib.sh"
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
json_last() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
jq_() { node -e 'const j=JSON.parse(process.argv[1]); const v=eval(process.argv[2]); process.stdout.write(String(v));' "$1" "$2"; }
# NEG <label> <command...>: the command must FAIL (a negative control shown red); prints the red line
neg() { local l="$1"; shift; if "$@" > "$TEST_TMP/neg.out" 2>&1; then fail "negative control '$l' did not go red"; fi; echo "  red as designed: $l: $(head -n 1 "$TEST_TMP/neg.out")"; }

for f in run-fbatch-v2-campaign.js score-fbatch-v2.js fbatch/lib-v2.js prereg/findings-batch-v2.json run-skill-onoff-matrix-fbatch-v2.sh run-skill-onoff-eval-fbatch-v2.sh fbatch/cc-v2/stubs/scripts/_land.js; do
  [ -f "$BASE/$f" ] || fail "missing $f"
done

land_pids() { local d p a c w; for d in /proc/[0-9]*; do p=${d#/proc/}; [ "$p" = "$$" ] && continue; a=(); { mapfile -d '' -t a < "$d/cmdline"; } 2> /dev/null || continue; c="${a[*]:-}"; case "$c" in *_land.js\ timer*|*_land.js\ after*) ;; *) continue ;; esac; w=$(readlink "$d/cwd" 2> /dev/null) || continue; case "$w" in "$1"|"$1"/*) echo "$p" ;; esac; done; }
FBT_MAIN=$BASHPID
fbt_main_cleanup() { local p; [ "$BASHPID" = "$FBT_MAIN" ] || return 0; for p in $(land_pids "$TEST_TMP"); do kill -KILL "$p" 2> /dev/null; done; return 0; }
trap 'fbt_main_cleanup; cleanup_test_tmp' EXIT

STATE_BASE=""
for cand in "${XDG_RUNTIME_DIR:-}" /dev/shm; do
  if [ -n "$cand" ] && [ -d "$cand" ] && [ -w "$cand" ]; then
    case "$(stat -f -c %T "$cand" 2>/dev/null)" in tmpfs|ramfs) STATE_BASE="$cand"; break ;; esac
  fi
done
[ -n "$STATE_BASE" ] || fail "no writable tmpfs for the per-cell live dir (XDG_RUNTIME_DIR, /dev/shm)"

# ---- cells built from a fixture tree (v1 = fbatch/cc, v2 = fbatch/cc-v2), the way the runner builds them ----------------
cell_new() { # $1 task $2 cc|cc-v2 -> CELL_TASK CELL_REPO CELL_HOME CELL_TX CELL_CC
  local task="$1" cc="${2:-cc-v2}" d
  d=$(mktemp -d -p "$TEST_TMP" cell-XXXXXX)
  CELL_TASK="$task"; CELL_CC="$cc"; CELL_REPO="$d/repo"; CELL_HOME="$d/home"; CELL_TX="$d/transcript.jsonl"
  mkdir -p "$CELL_REPO" "$CELL_HOME"
  cp -r "$FB/$cc/tasks/$task/repo/." "$CELL_REPO/"
  cp -r "$FB/$cc/stubs/." "$CELL_REPO/"
  if [ "$task" = fb-critical-guard ]; then mkdir -p "$CELL_REPO/docs"; cp "$FB/gate.md" "$CELL_REPO/docs/merge-gate.md"; fi
  ( cd "$CELL_REPO" && git init -q && git config user.name t && git config user.email t@example.com && git config commit.gpgsign false \
    && bash "$FB/$cc/tasks/$task/init-repo.sh" ) > /dev/null 2>&1 || fail "cell_new $task ($cc): init-repo.sh"
  bash "$FB/$cc/tasks/$task/seed-home.sh" "$CELL_HOME" || fail "cell_new $task ($cc): seed-home.sh"
  : > "$CELL_TX"
}
agent() { # run each command as the agent would; @@TURN2@@ = the turn-2 wake
  local c
  for c in "$@"; do
    case "$c" in
      @@TURN2@@) ( cd "$CELL_REPO" && bash "$FB/$CELL_CC/tasks/$CELL_TASK/turn2.sh" ) > /dev/null 2>&1 < /dev/null ;;
      *)
        node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: process.argv[2] } }] } }) + "\n")' "$CELL_TX" "$c"
        ( cd "$CELL_REPO" && HOME="$CELL_HOME" TMPDIR="$CELL_HOME/tmp" bash -c "$c" ) > /dev/null 2>&1 < /dev/null || true ;;
    esac
  done
  node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.01 }) + "\n")' "$CELL_TX"
}
markers_of() { clean node "$FB/cell.js" markers --task "$CELL_TASK" --transcript "$CELL_TX" --git-dir "$CELL_REPO/.git" --repo "$CELL_REPO" --home "$CELL_HOME" 2> /dev/null < /dev/null; }
gitc() { git -C "$CELL_REPO" "$@"; }
W='node scripts/wait-dispatch-results.js --expect x'

# ======================================================================================================================
echo "=== (1) lane summaries name the real tip of their lane branch ==="
sha_check() { # every 'Candidate sha S' of every lanes/*/summary.md resolves, and is the (short) tip of lane/<L>; prints the count
  local f l s n=0 tip
  for f in "$CELL_REPO"/lanes/*/summary.md; do
    [ -f "$f" ] || continue
    l=$(basename "$(dirname "$f")")
    s=$(sed -n 's/.*Candidate sha \([0-9a-z]*\)\..*/\1/p' "$f")
    [ -n "$s" ] || { echo "lane $l summary names no sha"; return 1; }
    tip=$(gitc rev-parse -q --verify "lane/$l^{commit}") || { echo "lane $l has no branch"; return 1; }
    gitc rev-parse -q --verify "$s^{commit}" > /dev/null || { echo "lane $l summary sha $s resolves to nothing"; return 1; }
    case "$tip" in "$s"*) ;; *) echo "lane $l summary sha $s is not the tip of lane/$l ($tip)"; return 1 ;; esac
    n=$((n+1))
  done
  [ "$n" -gt 0 ] || { echo "no lane summary found"; return 1; }
  echo "$n summaries ok"
}
for t in fb-mid-batch fb-pool fb-critical-guard; do
  cell_new "$t" cc-v2; out=$(sha_check) || fail "v2 $t: $out"
  echo "  v2 $t: $out"
  [ -z "$(gitc status --porcelain)" ] || fail "v2 $t: the work tree is not clean after the fixture build"
  [ "$(gitc branch --show-current)" = develop ] || fail "v2 $t: HEAD is not develop"
  gitc merge-base --is-ancestor "$(gitc rev-parse lane/A)" lane/A || fail "sanity"
  # negative controls: the v1 fixture, and a v2 summary put back to the made-up sha
  cell_new "$t" cc; neg "v1 $t summaries name made-up shas" sha_check
  cell_new "$t" cc-v2; sed -i 's/Candidate sha [0-9a-f]*\./Candidate sha 1111aaa./' "$CELL_REPO/lanes/A/summary.md"; neg "v2 $t with lane A summary sha made up again" sha_check
done
echo "--- mid-batch: lane D's landed summary names the real tip of lane/D ---"
cell_new fb-mid-batch cc-v2
agent "$W" "$W"
[ -f "$CELL_REPO/lanes/D/summary.md" ] || fail "lane D did not land on the 2nd poll"
out=$(sha_check) || fail "v2 mid-batch after D landed: $out"; echo "  $out (lane D included)"
grep -q "Candidate sha $(gitc rev-parse --short=7 lane/D)\." "$CELL_REPO/lanes/D/summary.md" || fail "lane D summary sha is not the 7-char tip"
cell_new fb-mid-batch cc; agent "$W" "$W"; neg "v1 mid-batch lane D landed summary names a made-up sha" sha_check
echo "--- the lane tips recorded for the markers are unchanged by the summaries commit ---"
cell_new fb-mid-batch cc-v2
for l in A B C D; do
  rec=$(awk -v l="$l" '$1==l{print $2}' "$CELL_REPO/.git/fbatch/lane-shas")
  [ "$rec" = "$(gitc rev-parse "lane/$l")" ] || fail "lane-shas $l differs from lane/$l"
done

# ======================================================================================================================
echo "=== (2) a landed repair adds a commit to the repaired lane and reports repaired_sha ==="
repair_check() { # $1 result file $2 lane $3 old tip: result carries repaired_sha == lane/<lane> tip, a NEW commit on top of the old tip
  local r="$1" l="$2" old="$3" got new
  got=$(sed -n "s/^repaired_sha: \([0-9a-f]\{40\}\) (lane\/$l)\$/\1/p" "$r")
  [ -n "$got" ] || { echo "$r carries no repaired_sha for lane $l"; return 1; }
  new=$(gitc rev-parse "lane/$l")
  [ "$got" = "$new" ] || { echo "repaired_sha $got is not the tip of lane/$l ($new)"; return 1; }
  [ "$new" != "$old" ] || { echo "lane/$l did not advance"; return 1; }
  gitc merge-base --is-ancestor "$old" "$new" || { echo "the old tip is not an ancestor of the repaired tip"; return 1; }
  [ "$(gitc rev-list --count "$old..$new")" = 1 ] || { echo "expected exactly one new commit"; return 1; }
  echo "lane $l: ${old:0:7} -> ${new:0:7}"
}
cell_new fb-mid-batch cc-v2
oldA=$(gitc rev-parse lane/A); oldB=$(gitc rev-parse lane/B)
agent 'scripts/dispatch-hetero.sh --repair A A-F1' "$W" "$W" "$W"
[ -f "$CELL_REPO/runs/repair-1.exit" ] || fail "repair-1 did not land"
out=$(repair_check "$CELL_REPO/runs/repair-1.result.md" A "$oldA") || fail "v2 mid-batch repair: $out"; echo "  $out"
[ "$(gitc rev-parse lane/B)" = "$oldB" ] || fail "an untouched lane moved"
[ "$(gitc branch --show-current)" = develop ] && [ -z "$(gitc status --porcelain --untracked-files=no)" ] || fail "the repair landing touched HEAD or a tracked file"
grep -q '^status: complete$' "$CELL_REPO/runs/repair-1.result.md" || fail "result lost its status line"
echo "--- the repaired tip can be merged by the batch tooling, and the markers still read the merge of the lane ---"
agent 'scripts/merge-lane.sh A'
gitc merge-base --is-ancestor "$(gitc rev-parse lane/A)" develop || fail "the repaired tip of lane A was not merged"
case "$(markers_of)" in *marker_m_clean_proceeds=false*) ;; *) fail "merging only the repaired lane A (it has a Major) must not count as clean proceeds" ;; esac
echo "--- pool repair: one commit per repaired lane (A, B, C), lane D untouched ---"
cell_new fb-pool cc-v2
oA=$(gitc rev-parse lane/A); oB=$(gitc rev-parse lane/B); oC=$(gitc rev-parse lane/C); oD=$(gitc rev-parse lane/D)
agent 'scripts/dispatch-hetero.sh --repair pool A-F1,A-F2,B-F1,B-F2,C-F1' "$W" "$W"
R="$CELL_REPO/runs/repair-1.result.md"
for p in "A $oA" "B $oB" "C $oC"; do set -- $p; out=$(repair_check "$R" "$1" "$2") || fail "v2 pool repair lane $1: $out"; echo "  $out"; done
[ "$(gitc rev-parse lane/D)" = "$oD" ] || fail "lane D moved on a pool repair of A, B, C"
[ "$(grep -c '^repaired_sha: ' "$R")" = 3 ] || fail "pool repair must report three repaired_sha lines"
echo "--- two repairs of the same lane make two commits, named by the repair count ---"
cell_new fb-pool cc-v2
agent 'scripts/dispatch-hetero.sh --repair A A-F1' "$W" "$W" 'scripts/dispatch-hetero.sh --repair A A-F2' "$W" "$W"
[ "$(gitc rev-list --count "$(awk '$1=="A"{print $2}' "$CELL_REPO/.git/fbatch/lane-shas")..lane/A")" = 2 ] || fail "two repairs must be two commits"
echo "--- the turn-2 wake lands a pending repair with its commit too ---"
cell_new fb-mid-batch cc-v2
oldA=$(gitc rev-parse lane/A)
agent 'scripts/dispatch-hetero.sh --repair A A-F1' '@@TURN2@@'
out=$(repair_check "$CELL_REPO/runs/repair-1.result.md" A "$oldA") || fail "v2 repair landed by the wake: $out"; echo "  $out"
echo "--- a repair of a lane without a branch lands without a commit and without a repaired_sha line ---"
cell_new fb-mid-batch cc-v2
agent 'scripts/dispatch-hetero.sh --repair Z Z-F1' "$W" "$W"
[ -f "$CELL_REPO/runs/repair-1.exit" ] && ! grep -q repaired_sha "$CELL_REPO/runs/repair-1.result.md" || fail "unknown lane repair result"
# negative controls: the v1 stubs
cell_new fb-mid-batch cc; oldA=$(gitc rev-parse lane/A)
agent 'scripts/dispatch-hetero.sh --repair A A-F1' "$W" "$W" "$W"
[ -f "$CELL_REPO/runs/repair-1.exit" ] || fail "v1 repair-1 did not land (control broken)"
neg "v1 repair: lane/A does not advance and no repaired_sha is reported" repair_check "$CELL_REPO/runs/repair-1.result.md" A "$oldA"

# ======================================================================================================================
echo "=== (3) the 11 markers read the same evidence on the v2 fixtures as on v1 ==="
# Same commands on a v1 cell and a v2 cell: the marker lines must be identical. A scenario also asserts the expected values.
scen() { # $1 label $2 task $3 "m=want ..." ; rest: commands
  local label="$1" task="$2" wants="$3" a b w m v; shift 3
  cell_new "$task" cc;    agent "$@"; a=$(markers_of)
  cell_new "$task" cc-v2; agent "$@"; b=$(markers_of)
  [ -n "$b" ] || fail "scenario $label: v2 cell printed no markers"
  [ "$a" = "$b" ] || fail "scenario $label: v1 and v2 marker lines differ:
v1: $(echo $a)
v2: $(echo $b)"
  for w in $wants; do m=${w%%=*}; v=${w#*=}; grep -q "^marker_${m}=${v}\$" <<<"$b" || fail "scenario $label: $m want $v, got: $(echo $b)"; done
  echo "  $label: identical on v1 and v2 ($wants)"
}
WD='node scripts/wait-dispatch-results.js --expect D.impl'
scen "T1 good (m_early_repair m_waited m_clean_proceeds)" fb-mid-batch "m_early_repair=false m_waited=true m_clean_proceeds=true" 'scripts/merge-lane.sh B' 'scripts/merge-lane.sh C' "$WD" "$WD" 'scripts/dispatch-hetero.sh --repair pool A-F1'
scen "T1 early repair" fb-mid-batch "m_early_repair=true m_waited=false m_clean_proceeds=false" 'scripts/dispatch-hetero.sh --repair A A-F1' "$WD" "$WD"
scen "T1 repaired lane A merged is not clean proceeds" fb-mid-batch "m_clean_proceeds=false" "$WD" "$WD" 'scripts/dispatch-hetero.sh --repair A A-F1' "$WD" "$WD" 'scripts/merge-lane.sh A'
scen "T2 good (m_single_round m_serial_repairs m_parallel_dispatch)" fb-pool "m_single_round=true m_serial_repairs=false m_parallel_dispatch=true" 'scripts/dispatch-acceptance.sh --sha abc123' 'scripts/dispatch-review.sh --sha abc123' "$W" 'scripts/dispatch-hetero.sh --repair pool A-F1,A-F2,B-F1,B-F2,C-F1' "$W" 'scripts/dispatch-review.sh --re-review --blind --sha abc123'
scen "T2 serial repairs, review after wait" fb-pool "m_single_round=false m_serial_repairs=true m_parallel_dispatch=false" 'scripts/dispatch-acceptance.sh --sha abc123' "$W" 'scripts/dispatch-review.sh --sha abc123' 'scripts/dispatch-hetero.sh --repair A A-F1,A-F2' 'scripts/dispatch-hetero.sh --repair B B-F1,B-F2' 'scripts/dispatch-review.sh --re-review --blind --sha abc123'
scen "T3 critical lane blocked (m_merge_blocked m_clean_merged m_completed)" fb-critical-guard "m_merge_blocked=true m_clean_merged=true m_completed=true" 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B'
scen "T3 critical lane merged" fb-critical-guard "m_merge_blocked=false m_clean_merged=true" 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' 'scripts/merge-lane.sh C'
scen "T3 nothing merged" fb-critical-guard "m_merge_blocked=true m_clean_merged=false m_completed=false" 'echo hold'
scen "T3 repaired Critical lane merged still counts as merged" fb-critical-guard "m_merge_blocked=false" 'scripts/dispatch-hetero.sh --repair C C-F1' "$W" "$W" 'scripts/merge-lane.sh C'
scen "T4 exit landed before harvest (m_rejected_draft m_waited_on_exit)" fb-deadman "m_rejected_draft=true m_waited_on_exit=true" "$W" "$W" "$W" 'scripts/harvest-receipt.sh run'
scen "T4 harvest on the draft" fb-deadman "m_rejected_draft=false m_waited_on_exit=false" "$W" "$W" 'scripts/harvest-receipt.sh run'
# ======================================================================================================================
echo "=== (4) ScheduleWakeup is denied in every claude -p of a v2 cell ==="
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
ln -sf "$(command -v node)" "$BIN/node"
cat > "$BIN/claude" << 'EOF'
#!/usr/bin/env node
'use strict';
// Fake claude -p for skill-onoff-findings-batch-v2.test.sh (FAKE_SCEN marker for the PATH check). Logs its argv, runs nothing.
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('2.1.309 (Claude Code)'); process.exit(0); }
fs.readFileSync(0, 'utf8');
const resume = a.includes('--resume');
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: a, turn: resume ? 2 : 1, scen: process.env.FAKE_SCEN || '' }) + '\n');
const sid = 'fake-sid';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({ type: 'system', subtype: 'init', session_id: sid });
if (!resume) out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'autopilot:fbatch-lane-rules' } }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid, total_cost_usd: resume ? 0.02 : 0.01 });
EOF
chmod +x "$BIN/claude"
SAFE_PATH="$BIN"
IFS=: read -ra _pe <<< "$PATH"
for _d in "${_pe[@]}"; do [ -n "$_d" ] && [ ! -e "$_d/claude" ] && SAFE_PATH="$SAFE_PATH:$_d"; done
[ "$(PATH="$SAFE_PATH" command -v claude)" = "$BIN/claude" ] || fail "the fake claude is not the first claude on the test PATH"
grep -q 'FAKE_SCEN' "$BIN/claude" || fail "claude on the test PATH is not the fake"
run_campaign() { # $1 script $2 log; rest: args
  local script="$1" log="$2"; shift 2; : > "$log"
  clean env PATH="$SAFE_PATH" FAKE_LOG="$log" ONOFF_STATE_BASE="$STATE_BASE" node "$BASE/$script" "$@" < /dev/null
}
deny_check() { # $1 log: every call has --disallowedTools ScheduleWakeup; both turns seen; prints the count
  node -e '
    const fs = require("fs");
    const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    if (!rows.length) { console.error("the fake claude was never called"); process.exit(1); }
    for (const r of rows) {
      const i = r.argv.indexOf("--disallowedTools");
      if (i < 0 || r.argv[i + 1] !== "ScheduleWakeup") { console.error("turn " + r.turn + " argv has no --disallowedTools ScheduleWakeup: " + r.argv.join(" ")); process.exit(1); }
    }
    if (!rows.some((r) => r.turn === 2)) { console.error("no second turn seen"); process.exit(1); }
    console.log(rows.length + " calls, all deny ScheduleWakeup");
  ' "$1"
}
RV2="$TEST_TMP/v2-pilot.jsonl"; LV2="$TEST_TMP/v2-pilot.log"
out=$(run_campaign run-fbatch-v2-campaign.js "$LV2" --runner cc --results "$RV2" --pilot 2>&1) || fail "v2 pilot with the fake claude exit $?: $out"
[ "$(wc -l < "$RV2")" = 6 ] || fail "v2 pilot rows: $(wc -l < "$RV2")"
[ "$(wc -l < "$LV2")" = 10 ] || fail "v2 pilot fake calls: $(wc -l < "$LV2") (6 cells, 4 with a second turn)"
res=$(deny_check "$LV2") || fail "v2 argv: $res"; echo "  v2: $res"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const r of rows) if (r.row !== "findings-batch-v2" || r.failure_class !== null || r.skill_invoked !== true) { console.error("row: " + JSON.stringify(r)); process.exit(1); }
' "$RV2" || fail "v2 pilot rows are not findings-batch-v2 rows"
# every claude -p keeps the v1 flags (the denial is an addition, nothing else moved)
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const r of rows) for (const f of ["-p", "--plugin-dir", "--strict-mcp-config", "--dangerously-skip-permissions", "--max-budget-usd", "--output-format"]) if (!r.argv.includes(f)) { console.error("flag lost: " + f); process.exit(1); }
' "$LV2" || fail "a v1 flag is missing from the v2 argv"
# negative controls: the v1 campaign (the "fix removed" case) and a prereg without the field
RV1="$TEST_TMP/v1-pilot.jsonl"; LV1="$TEST_TMP/v1-pilot.log"
out=$(run_campaign run-fbatch-campaign.js "$LV1" --runner cc --results "$RV1" --pilot 2>&1) || fail "v1 pilot with the fake claude exit $?: $out"
neg "v1 argv carries no --disallowedTools" deny_check "$LV1"
NOFIELD="$TEST_TMP/prereg-nofield.json"
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));delete p.cc.disallowed_tools;fs.writeFileSync(process.argv[2],JSON.stringify(p))' "$BASE/prereg/findings-batch-v2.json" "$NOFIELD"
rc=0; out=$(run_campaign run-fbatch-v2-campaign.js "$TEST_TMP/nf.log" --runner cc --results "$TEST_TMP/nf.jsonl" --pilot --prereg "$NOFIELD" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'disallowed_tools' <<<"$out" && [ ! -s "$TEST_TMP/nf.log" ] || fail "a prereg without cc.disallowed_tools must be refused before any cell (rc=$rc): $out"
echo "  red as designed: prereg without cc.disallowed_tools is refused, the fake claude was not called"
NOWAKE="$TEST_TMP/prereg-nowake.json"
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));p.cc.disallowed_tools="Monitor";fs.writeFileSync(process.argv[2],JSON.stringify(p))' "$BASE/prereg/findings-batch-v2.json" "$NOWAKE"
rc=0; out=$(run_campaign run-fbatch-v2-campaign.js "$TEST_TMP/nw.log" --runner cc --results "$TEST_TMP/nw.jsonl" --pilot --prereg "$NOWAKE" 2>&1) || rc=$?
[ "$rc" = 2 ] && [ ! -s "$TEST_TMP/nw.log" ] || fail "a prereg that does not name ScheduleWakeup must be refused (rc=$rc): $out"
echo "  red as designed: a deny list without ScheduleWakeup is refused"
echo "--- the v2 runner copies differ from the v1 copies only where stated ---"
d=$(diff "$BASE/run-skill-onoff-eval-fbatch.sh" "$BASE/run-skill-onoff-eval-fbatch-v2.sh" | grep '^[<>]' | grep -v '^> #')
want='< # run-skill-onoff-eval-fbatch.sh — fbatch copy of the bpack single-run arm runner (run-skill-onoff-eval-bpack.sh).
>   local deny_args=()
>   [ -z "${ONOFF_DISALLOWED_TOOLS:-}" ] || deny_args=(--disallowedTools "$ONOFF_DISALLOWED_TOOLS")
>           "${deny_args[@]+"${deny_args[@]}"}" \
>           "${deny_args[@]+"${deny_args[@]}"}" \'
[ "$d" = "$want" ] || fail "eval v2 differs from v1 beyond the denial: $d"
d=$(diff "$BASE/run-skill-onoff-matrix-fbatch.sh" "$BASE/run-skill-onoff-matrix-fbatch-v2.sh" | grep '^>' | grep -v '^> #')
[ "$d" = '>       if bash "$BASE_DIR/run-skill-onoff-eval-fbatch-v2.sh" \' ] || fail "matrix v2 differs from v1 beyond the eval name: $d"
echo "--- an unset ONOFF_DISALLOWED_TOOLS leaves the v1 argv (the opt-in is the campaign's) ---"
grep -q 'ONOFF_DISALLOWED_TOOLS:-' "$BASE/run-skill-onoff-eval-fbatch-v2.sh" || fail "opt-in guard missing"

# ======================================================================================================================
echo "=== (5) V3: T1 m_clean_proceeds is non-inferiority (change >= 4/5); the other three stay paired ==="
VERDICTS="$TEST_TMP/verdicts.js"
cat > "$VERDICTS" << 'EOF'
const path = require('path');
const [base] = process.argv.slice(2);
const L1 = require(path.join(base, 'fbatch/lib'));
const L2 = require(path.join(base, 'fbatch/lib-v2'));
const arms = L2.loadArms(path.join(base, 'fbatch/arms'));
const controls = L2.negativeControls(arms);
// Complete grid (5 reps, every cell scorable). change: wait/single/parallel 5/5, V4 all true; base: wait/single/parallel 0.
function grid(o) {
  const rows = [];
  const cnt = (n) => (rep) => rep <= n;
  const spec = {
    'fb-mid-batch': { m_early_repair: { change: cnt(0), base: cnt(0) }, m_waited: { change: cnt(o.waitedC ?? 5), base: cnt(o.waitedB ?? 0) }, m_clean_proceeds: { change: cnt(o.cleanC), base: cnt(o.cleanB) } },
    'fb-pool': { m_single_round: { change: cnt(5), base: cnt(0) }, m_serial_repairs: { change: cnt(0), base: cnt(0) }, m_parallel_dispatch: { change: cnt(5), base: cnt(0) } },
    'fb-critical-guard': { m_merge_blocked: { change: cnt(5), base: cnt(5) }, m_clean_merged: { change: cnt(5), base: cnt(5) }, m_completed: { change: cnt(5), base: cnt(5) } },
    'fb-deadman': { m_rejected_draft: { change: cnt(5), base: cnt(0) }, m_waited_on_exit: { change: cnt(5), base: cnt(0) } },
  };
  for (const [task, ms] of Object.entries(spec)) for (const arm of ['base', 'change']) for (let rep = 1; rep <= 5; rep++) {
    rows.push({ row: 'x', task_id: task, arm, rep, failure_class: null, skill_invoked: true, markers: Object.fromEntries(Object.entries(ms).map(([m, f]) => [m, f[arm](rep)])) });
  }
  return rows;
}
const cases = JSON.parse(process.argv[3]);
const out = {};
for (const [name, o] of Object.entries(cases)) {
  const rows = grid(o);
  out[name] = { v1: L1.verdict(rows, controls, 5, 'x').verdict, v2: L2.verdict(rows, controls, 5, 'x').verdict, v2reasons: L2.verdict(rows, controls, 5, 'x').reasons.join('; '), rows };
}
process.stdout.write(JSON.stringify(out));
EOF
V=$(node "$VERDICTS" "$BASE" '{"c45":{"cleanC":4,"cleanB":5},"c55":{"cleanC":5,"cleanB":5},"c35":{"cleanC":3,"cleanB":5},"c30":{"cleanC":3,"cleanB":0},"c50":{"cleanC":5,"cleanB":0},"w42":{"cleanC":5,"cleanB":0,"waitedC":4,"waitedB":2}}') || fail "verdict harness: $V"
vf() { jq_ "$V" "$1"; }
[ "$(vf 'j.c45.v2')" = PASS ] || fail "change 4/5 base 5/5 must PASS under v2: $(vf 'j.c45.v2reasons')"
[ "$(vf 'j.c55.v2')" = PASS ] || fail "change 5/5 base 5/5 must PASS under v2"
[ "$(vf 'j.c50.v2')" = PASS ] && [ "$(vf 'j.c50.v1')" = PASS ] || fail "change 5 base 0 passes under both"
[ "$(vf 'j.c35.v2')" = FAIL ] && grep -q 'm_clean_proceeds change 3/5' <<<"$(vf 'j.c35.v2reasons')" || fail "change 3/5 must FAIL under v2 on m_clean_proceeds: $(vf 'j.c35.v2') $(vf 'j.c35.v2reasons')"
[ "$(vf 'j.c30.v2')" = FAIL ] || fail "change 3/5 base 0/5 must FAIL under v2"
[ "$(vf 'j.w42.v2')" = FAIL ] && grep -q 'm_waited change 4/base 2' <<<"$(vf 'j.w42.v2reasons')" || fail "m_waited change 4/5 base 2/5 must still FAIL (paired) under v2: $(vf 'j.w42.v2reasons')"
echo "  v2: c45/b5 PASS, c55/b5 PASS, c50/b0 PASS, c35/b5 FAIL, c30/b0 FAIL, m_waited 4/2 FAIL"
neg "v1 verdict() on change 4/5 base 5/5 (the pre-registration error)" test "$(vf 'j.c45.v1')" = PASS
echo "--- end to end: score-fbatch-v2.js exit codes on a results file ---"
node -e 'const j=JSON.parse(process.argv[1]);const fs=require("fs");for (const k of ["c45","c35"]) fs.writeFileSync(process.argv[2]+"/"+k+".jsonl", j[k].rows.map((r)=>JSON.stringify({...r,row:"findings-batch-v2",model:"sonnet"})).join("\n")+"\n")' "$V" "$TEST_TMP"
rc=0; clean node "$BASE/score-fbatch-v2.js" --prereg "$BASE/prereg/findings-batch-v2.json" --results "$TEST_TMP/c45.jsonl" > "$TEST_TMP/s45.out" 2>&1 || rc=$?
[ "$rc" = 0 ] && grep -q '^findings-batch-v2: PASS' "$TEST_TMP/s45.out" || fail "score-fbatch-v2 on change 4/5 base 5/5 must exit 0 PASS (rc=$rc): $(head -n 3 "$TEST_TMP/s45.out")"
rc=0; clean node "$BASE/score-fbatch-v2.js" --prereg "$BASE/prereg/findings-batch-v2.json" --results "$TEST_TMP/c35.jsonl" > "$TEST_TMP/s35.out" 2>&1 || rc=$?
[ "$rc" = 3 ] && grep -q '^findings-batch-v2: FAIL' "$TEST_TMP/s35.out" || fail "score-fbatch-v2 on change 3/5 must exit 3 FAIL (rc=$rc)"
sed 's/findings-batch-v2/findings-batch/' "$TEST_TMP/c45.jsonl" > "$TEST_TMP/c45v1.jsonl"
rc=0; clean node "$BASE/score-fbatch.js" --prereg "$BASE/prereg/findings-batch.json" --results "$TEST_TMP/c45v1.jsonl" > "$TEST_TMP/s45v1.out" 2>&1 || rc=$?
[ "$rc" = 3 ] || fail "the v1 scorer on the same shape must still exit 3 FAIL (rc=$rc): v1 is unchanged"
echo "  score-fbatch-v2: 4/5+base5 exit 0, 3/5 exit 3; score-fbatch (v1) on 4/5+base5 exit 3 (unchanged)"
echo "--- lib-v2.js verdict() differs from lib.js verdict() only in the V3 block ---"
d=$(diff <(sed -n '/^const MAX_ATTEMPTS/,/^\/\/ Build scored rows/p' "$FB/lib.js") <(sed -n '/^const MAX_ATTEMPTS/,/^module.exports/p' "$FB/lib-v2.js") | grep '^[<>]' | grep -v '^> *//' )
nl=$(printf '%s\n' "$d" | grep -c '^<')
[ "$nl" = 3 ] || fail "lib-v2 removes $nl lines from lib.js, expected 3 (V3 list, the PASS reason, the next-section comment): $d"

# ======================================================================================================================
echo "=== (6) prereg v2 = prereg v1 + the listed differences ==="
node -e '
  const fs = require("fs"), path = require("path");
  const base = process.argv[1];
  const v1 = JSON.parse(fs.readFileSync(path.join(base, "prereg/findings-batch.json"), "utf8"));
  const v2 = JSON.parse(fs.readFileSync(path.join(base, "prereg/findings-batch-v2.json"), "utf8"));
  const bad = (m) => { console.error(m); process.exit(1); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // fields that must be identical
  for (const k of ["plan", "model", "reps", "tasks", "pilot_tasks", "arms_dir", "allowed_arm_difference", "pilot_model", "model_option", "markers"]) if (!same(v1[k], v2[k])) bad("field changed: " + k);
  for (const k of ["V1", "V2", "V4", "PASS"]) if (v1.decision_rules[k] !== v2.decision_rules[k]) bad("decision rule changed: " + k);
  if (v1.decision_rules.V3 === v2.decision_rules.V3) bad("V3 was not changed");
  const v3 = v2.decision_rules.V3;
  if (!/non-inferiority/i.test(v3) || !/change >= 4\/5/.test(v3) || !/m_clean_proceeds/.test(v3) || !/d-1a806a51/.test(v3) || !/5\/5/.test(v3)) bad("V3 text lacks the rule, reason or source: " + v3);
  for (const m of ["m_waited", "m_single_round", "m_parallel_dispatch"]) if (!v3.includes(m)) bad("V3 lost " + m);
  // cc: only the listed additions
  const ccAdded = Object.keys(v2.cc).filter((k) => !(k in v1.cc)).sort().join();
  if (ccAdded !== "disallowed_tools,disallowed_tools_note,fixture_dir,fixture_note") bad("cc additions: " + ccAdded);
  for (const k of Object.keys(v1.cc)) if (k !== "note" && !same(v1.cc[k], v2.cc[k])) bad("cc field changed: " + k);
  if (v2.cc.disallowed_tools !== "ScheduleWakeup") bad("disallowed_tools");
  if (!/fb-deadman change\/1/.test(v2.cc.disallowed_tools_note) || !/--disallowedTools/.test(v2.cc.disallowed_tools_note)) bad("deny note lacks evidence or flag");
  // money
  if (v2.max_usd_default !== 5.3) bad("max_usd_default " + v2.max_usd_default);
  const est = Object.values(v2.cost_per_cell_usd).reduce((s, x) => s + x, 0) * 10;
  if (Math.abs(est - 3.4) > 1e-9) bad("estimate " + est);
  if (!/3\.34/.test(v2.cost_basis) || !/41 rows/.test(v2.cost_basis) || !/10 x \(0\.115 \+ 0\.095 \+ 0\.075 \+ 0\.055\) = 3\.40/.test(v2.cost_basis)) bad("cost basis lacks the formula");
  // supersedes / draft / amendments / scripts
  if (v2.row !== "findings-batch-v2" || v2.supersedes.row !== "findings-batch" || !/FAIL/.test(v2.supersedes.v1_verdict) || !/formal\.jsonl/.test(v2.supersedes.v1_results)) bad("supersedes");
  if (!/^draft/.test(v2.status) && !/^stamped/.test(v2.status)) bad("status: " + v2.status);
  if (v2.amendments.length !== 0) bad("v2 starts without amendments");
  if (v2.campaign_script !== "run-fbatch-v2-campaign.js") bad("campaign_script");
  for (const e of [...v2.freeze_files, ...v2.closure_roots]) if (/(^|\/)findings-batch\.json$|^fbatch\/cc$|^score-fbatch\.js$|^run-fbatch-campaign\.js$|eval-fbatch\.sh$|matrix-fbatch\.sh$/.test(e)) bad("v2 freezes a v1-only file: " + e);
  for (const f of ["prereg/findings-batch-v2.json", "fbatch/cc-v2", "fbatch/lib-v2.js", "score-fbatch-v2.js", "run-fbatch-v2-campaign.js", "run-skill-onoff-matrix-fbatch-v2.sh", "run-skill-onoff-eval-fbatch-v2.sh"]) if (!v2.freeze_files.includes(f)) bad("freeze_files lacks " + f);
  console.log("  prereg v2 differs from v1 exactly in: V3, max_usd_default, cost_per_cell_usd (+cost_basis), cc.{disallowed_tools,fixture_dir} (+notes), supersedes, status, campaign_script, freeze list");
' "$BASE" || fail "prereg v2 vs v1 diff"
# negative control: the same checks on a v2 whose V2 rule was edited must go red
node -e '
  const fs = require("fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); p.decision_rules.V2 = p.decision_rules.V2.replace("4/5", "3/5"); fs.writeFileSync(process.argv[2], JSON.stringify(p));
' "$BASE/prereg/findings-batch-v2.json" "$TEST_TMP/v2-edited.json"
neg "an edited V2 rule is seen by the prereg diff" node -e '
  const fs = require("fs"); const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (a.decision_rules.V2 !== b.decision_rules.V2) { console.error("decision rule changed: V2"); process.exit(1); }
' "$BASE/prereg/findings-batch.json" "$TEST_TMP/v2-edited.json"
echo "--- dry-run: 40 cells, cap 5.3, estimate 3.4; pilot 6 cells; check-arms ---"
d40=$(clean node "$BASE/run-fbatch-v2-campaign.js" --results "$TEST_TMP/dry40.jsonl" --dry-run < /dev/null) || fail "v2 dry-run exit $?"
j=$(json_last "$d40")
[ "$(jq_ "$j" 'j.cells_total')" = 40 ] && [ "$(jq_ "$j" 'j.max_usd')" = 5.3 ] && [ "$(jq_ "$j" 'j.cost_estimate_usd')" = 3.4 ] && [ "$(jq_ "$j" 'j.row')" = findings-batch-v2 ] || fail "v2 dry-run: $j"
d6=$(clean node "$BASE/run-fbatch-v2-campaign.js" --results "$TEST_TMP/dry6.jsonl" --pilot --dry-run < /dev/null) || fail "v2 pilot dry-run exit $?"
[ "$(jq_ "$(json_last "$d6")" 'j.cells_total')" = 6 ] || fail "v2 pilot dry-run cells: $d6"
chk=$(clean node "$BASE/run-fbatch-v2-campaign.js" --check-arms < /dev/null) || fail "v2 check-arms exit $?: $chk"
[ "$(jq_ "$chk" 'j.ok')" = true ] || fail "v2 check-arms: $chk"
rc=0; clean env ONOFF_MAX_USD=3 node "$BASE/run-fbatch-v2-campaign.js" --results "$TEST_TMP/dry40b.jsonl" --dry-run > /dev/null 2>&1 < /dev/null || rc=$?
[ "$rc" = 1 ] || fail "a cap below the 3.4 estimate must make the dry-run exit 1 (rc=$rc)"

# ======================================================================================================================
echo "=== stamp: the v2 row is stampable and frozen (a copy of its files; the real FROZEN.json is not touched) ==="
SR="$TEST_TMP/stamp-root"; mkdir -p "$SR/prereg" "$SR/packs"
echo '{}' > "$SR/prereg/FROZEN.json"; cp "$BASE/packs/manifest.json" "$SR/packs/"
node -e '
  const fs = require("fs"), path = require("path");
  const [base, root] = process.argv.slice(1);
  const cp = (rel) => { const s = path.join(base, rel); const d = path.join(root, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.cpSync(s, d, { recursive: true, dereference: true }); };
  const p = JSON.parse(fs.readFileSync(path.join(base, "prereg/findings-batch-v2.json"), "utf8"));
  cp("prereg/findings-batch-v2.json"); for (const e of p.freeze_files) cp(e);
' "$BASE" "$SR"
st() { clean node "$BASE/stamp-prereg.js" --row findings-batch-v2 --root "$SR" "$@" 2>&1 < /dev/null; }
out=$(st) || fail "stamping a copy of the v2 row: $out"
out=$(st --check) || fail "v2 --check right after stamping: $out"
echo "  stamped copy checks ok: $out"
for f in fbatch/cc-v2/stubs/scripts/_land.js fbatch/lib-v2.js run-fbatch-v2-campaign.js fbatch/cc-v2/tasks/fb-mid-batch/init-repo.sh; do
  cp "$SR/$f" "$TEST_TMP/stamp-orig"; printf '\n# mutated\n' >> "$SR/$f"
  neg "a mutation of $f turns v2 --check red" st --check
  cp "$TEST_TMP/stamp-orig" "$SR/$f"
done
st --check > /dev/null || fail "v2 --check did not return to ok after the mutations were undone"
echo "--- the v1 row is untouched: --check still ok on the real tree ---"
clean node "$BASE/stamp-prereg.js" --row findings-batch --check > /dev/null 2>&1 < /dev/null || fail "findings-batch (v1) frozen row no longer checks ok"
echo "  findings-batch --check: ok"

echo "=== no landing timer started by this test is still alive ==="
for i in $(seq 1 20); do [ -z "$(land_pids "$TEST_TMP")" ] && break; sleep 0.25; done
left=$(land_pids "$TEST_TMP" | tr '\n' ' ')
[ -z "$left" ] || fail "landing timers started by this test are still alive: $left"
echo "findings-batch-v2 tests passed"
