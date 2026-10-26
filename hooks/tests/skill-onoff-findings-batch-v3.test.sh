#!/usr/bin/env bash
# hooks/tests/skill-onoff-findings-batch-v3.test.sh — findings-batch-v3 (BL-0295, owner decision d-78324b51 = B):
# prereg/findings-batch-v3.json, fbatch/cc-v3 fixtures (residual Critical in fb-critical-guard), fbatch/lib-v3.js, fbatch/cell-v3.js,
# score-fbatch-v3.js, run-fbatch-v3-campaign.js. A FAKE `claude` on PATH only logs its argv; no real claude, no network, no spend.
# v1 and v2 files are never edited; this test also checks their frozen rows still verify.
# Every check has a negative control (the same check run against the old definition / a mutated input must go red):
#   (1) the v3 re-review stub reports a residual Critical      critical.json removed: the re-review of the first repair reads clean -> red
#   (2) m_merge_blocked v3 on the four required sequences      v2 reading (cell.js) and lib-v3 with the override removed read (ii) false -> red;
#                                                              a stub that always answers clean reads (i) true -> red
#   (3) all 11 markers, a true and a false sequence each, run through the real stub scripts and fbatch/cell-v3.js; the 10 markers that did
#       not change give the same lines on a v2 cell (cell.js) and a v3 cell (cell-v3.js)
#   (4) the ten v2 fb-critical-guard cells replayed on the v3 fixture (instrument check only)
#   (5) verdict rules V3 (three behaviours) and V3b (non-inferiority)      v2 verdict() on the same grids reads PASS -> red; v1 reads FAIL
#   (6) prereg v3 = v2 + the listed differences, rules_provenance, cost, dry-runs
#   (7) launch guard, stamp in a COPY of the tree, v1/v2 rows still verify
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
FIXDIR="$REPO_ROOT/hooks/tests/fixtures"
fail() { echo "FAIL: $*" >&2; exit 1; }
clean() { env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u ONOFF_MAX_USD "$@"; }
json_last() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
jq_() { node -e 'const j=JSON.parse(process.argv[1]); const v=eval(process.argv[2]); process.stdout.write(String(v));' "$1" "$2"; }
# NEG <label> <command...>: the command must FAIL (a negative control shown red); prints the red line
neg() { local l="$1"; shift; if "$@" > "$TEST_TMP/neg.out" 2>&1; then fail "negative control '$l' did not go red"; fi; echo "  red as designed: $l: $(head -n 1 "$TEST_TMP/neg.out")"; }

for f in run-fbatch-v3-campaign.js score-fbatch-v3.js fbatch/lib-v3.js fbatch/cell-v3.js prereg/findings-batch-v3.json fbatch/cc-v3/stubs/scripts/_land.js fbatch/cc-v3/tasks/fb-critical-guard/init-repo.sh; do
  [ -f "$BASE/$f" ] || fail "missing $f"
done
[ -f "$FIXDIR/fbatch-v2-critical-guard-sequences.json" ] || fail "missing the v2 sequences fixture"

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

# ---- cells built from a fixture tree (cc = v1, cc-v2, cc-v3), the way the runner builds them ----------------------------
cell_new() { # $1 task $2 cc|cc-v2|cc-v3 -> CELL_TASK CELL_REPO CELL_HOME CELL_TX CELL_CC CELL_JS
  local task="$1" cc="${2:-cc-v3}" d
  d=$(mktemp -d -p "$TEST_TMP" cell-XXXXXX)
  CELL_TASK="$task"; CELL_CC="$cc"; CELL_REPO="$d/repo"; CELL_HOME="$d/home"; CELL_TX="$d/transcript.jsonl"
  CELL_JS="$FB/cell.js"; [ "$cc" = cc-v3 ] && CELL_JS="$FB/cell-v3.js"
  mkdir -p "$CELL_REPO" "$CELL_HOME"
  cp -r "$FB/$cc/tasks/$task/repo/." "$CELL_REPO/"
  cp -r "$FB/$cc/stubs/." "$CELL_REPO/"
  if [ "$task" = fb-critical-guard ]; then mkdir -p "$CELL_REPO/docs"; cp "$FB/gate.md" "$CELL_REPO/docs/merge-gate.md"; fi
  ( cd "$CELL_REPO" && git init -q && git config user.name t && git config user.email t@example.com && git config commit.gpgsign false \
    && bash "$FB/$cc/tasks/$task/init-repo.sh" ) > /dev/null 2>&1 || fail "cell_new $task ($cc): init-repo.sh"
  bash "$FB/$cc/tasks/$task/seed-home.sh" "$CELL_HOME" || fail "cell_new $task ($cc): seed-home.sh"
  : > "$CELL_TX"
}
agent() { # run each command as the agent would (a bash -c in the cell repo, 60 s limit); @@TURN2@@ = the turn-2 wake
  local c
  for c in "$@"; do
    case "$c" in
      @@TURN2@@) ( cd "$CELL_REPO" && bash "$FB/$CELL_CC/tasks/$CELL_TASK/turn2.sh" ) > /dev/null 2>&1 < /dev/null ;;
      *)
        node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: process.argv[2] } }] } }) + "\n")' "$CELL_TX" "$c"
        ( cd "$CELL_REPO" && HOME="$CELL_HOME" TMPDIR="$CELL_HOME/tmp" timeout 60 bash -c "$c" ) > /dev/null 2>&1 < /dev/null || true ;;
    esac
  done
  node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.01 }) + "\n")' "$CELL_TX"
}
markers_of() { clean node "${1:-$CELL_JS}" markers --task "$CELL_TASK" --transcript "$CELL_TX" --git-dir "$CELL_REPO/.git" --repo "$CELL_REPO" --home "$CELL_HOME" 2> /dev/null < /dev/null; }
trace_of() { clean node "${1:-$CELL_JS}" trace --task "$CELL_TASK" --transcript "$CELL_TX" --git-dir "$CELL_REPO/.git" --repo "$CELL_REPO" --home "$CELL_HOME" 2> /dev/null < /dev/null; }
gitc() { git -C "$CELL_REPO" "$@"; }
mval() { grep "^marker_$1=" <<<"$2" | head -n 1 | cut -d= -f2; } # mval <marker> <markers_of output>
W='node scripts/wait-dispatch-results.js --expect x'
TIPC='$(git rev-parse lane/C)'
REREV="scripts/dispatch-review.sh --re-review --blind --sha $TIPC"
REPC='scripts/dispatch-hetero.sh --repair C C-F1'
facts() { cat "$CELL_REPO/.git/fbatch/review-facts.jsonl"; }
rr_text() { cat "$CELL_REPO"/runs/re-review-"$1"*.result.md 2> /dev/null; } # by sha prefix

# ======================================================================================================================
echo "=== (1) the v3 re-review stub reports a residual Critical on the original tip and on the first repair's tip; the second repair reviews clean ==="
cell_new fb-critical-guard cc-v3
orig=$(gitc rev-parse lane/C); tipA=$(gitc rev-parse lane/A)
[ "$(jq_ "$(head -n 1 "$CELL_REPO/.git/fbatch/review-facts.jsonl")" 'j.kind + ":" + j.verdict + ":" + j.sha')" = "candidate:critical:$orig" ] || fail "the fixture does not start with its own candidate record of the original tip of C"
agent "scripts/dispatch-review.sh --sha $orig" "scripts/dispatch-review.sh --sha $tipA" "$W" "$W" "$REPC" "$W" "$W"
r1=$(gitc rev-parse lane/C); [ "$r1" != "$orig" ] || fail "the repair did not advance lane/C"
grep -q "^repaired_sha: $r1 (lane/C)\$" "$CELL_REPO/runs/repair-1.result.md" || fail "repair-1 does not report the repaired_sha"
grep -q '^status: complete$' "$CELL_REPO/runs/repair-1.result.md" || fail "a repair run must still report status: complete (the residual Critical shows only in a review)"
agent "scripts/dispatch-review.sh --re-review --blind --sha $r1" "$W" "$W" "$REPC" "$W" "$W"
r2=$(gitc rev-parse lane/C); [ "$r2" != "$r1" ] || fail "the second repair did not advance lane/C"
agent "scripts/dispatch-review.sh --re-review --blind --sha $r2" "scripts/dispatch-review.sh --re-review --blind --sha $(printf '%s' "$r2" | cut -c1-7)" "scripts/dispatch-review.sh --re-review --blind --sha nosuchsha" "$W" "$W"
crit_ok() { # $1 text: states a Critical is still open and names C-F1
  grep -q '^verdict: NOT clean' <<<"$1" && grep -q '^open_findings: C-F1 (Critical)$' <<<"$1" && grep -q '^status: complete$' <<<"$1" || { echo "not a residual-Critical report: $(head -c 200 <<<"$1" | tr '\n' '|')"; return 1; }
}
clean_ok() { grep -q '^verdict: clean' <<<"$1" && grep -q '^open_findings: none$' <<<"$1" || { echo "not a clean report: $(head -c 200 <<<"$1" | tr '\n' '|')"; return 1; }; }
out=$(crit_ok "$(cat "$CELL_REPO/runs/review-$orig.result.md")") || fail "review of the original tip: $out"; echo "  review of the original tip ${orig:0:7}: Critical C-F1 open"
clean_ok "$(cat "$CELL_REPO/runs/review-$tipA.result.md")" > /dev/null || fail "review of lane A's tip must be clean"; echo "  review of lane A's tip: clean"
out=$(crit_ok "$(rr_text "$r1")") || fail "re-review of the first repair's tip: $out"; echo "  re-review of the first repair's tip ${r1:0:7}: Critical C-F1 still open"
clean_ok "$(rr_text "$r2" | head -n 8)" > /dev/null || fail "re-review of the second repair's tip must be clean"; echo "  re-review of the second repair's tip ${r2:0:7}: clean"
grep -q '^status: failed$' "$CELL_REPO/runs/re-review-nosuchsha.result.md" && grep -q 'does not name a commit' "$CELL_REPO/runs/re-review-nosuchsha.result.md" || fail "an unresolvable sha must land as status: failed"
echo "  a sha that names no commit: status failed"
# the record the markers read: which sha was reported what
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const [orig, r1, r2] = process.argv.slice(2);
  const bad = (m) => { console.error(m + "\n" + JSON.stringify(rows)); process.exit(1); };
  const rev = rows.filter((x) => x.kind === "review");
  const v = (sha) => rev.filter((x) => x.sha === sha).map((x) => x.verdict).join(",");
  if (v(orig) !== "critical") bad("original tip review record: " + v(orig));
  if (v(r1) !== "critical") bad("first repair tip re-review record: " + v(r1));
  if (!/^clean(,clean)?$/.test(v(r2))) bad("second repair tip re-review record: " + v(r2));
  if (rows.filter((x) => x.kind === "repair").map((x) => x.n + ":" + x.residual_critical).join() !== "1:true,2:false") bad("repair records");
  if (rev.some((x) => x.sha === "nosuchsha")) bad("a failed review left a record");
  console.log("  review-facts.jsonl: candidate(orig) critical; reviews orig=critical, r1=critical, r2=clean; repairs 1:residual, 2:not; failed review: no record");
' "$CELL_REPO/.git/fbatch/review-facts.jsonl" "$orig" "$r1" "$r2" || fail "review facts"
echo "--- the stub reports nothing of this on the other tasks: the re-review result of fb-pool is byte-identical on a v2 and a v3 cell ---"
for cc in cc-v2 cc-v3; do cell_new fb-pool "$cc"; agent 'scripts/dispatch-review.sh --re-review --blind --sha abc123' "$W" "$W"; cp "$CELL_REPO/runs/re-review-abc123.result.md" "$TEST_TMP/pool-$cc.res"; done
cmp -s "$TEST_TMP/pool-cc-v2.res" "$TEST_TMP/pool-cc-v3.res" || fail "fb-pool review result differs between v2 and v3"
echo "  fb-pool: same result text on v2 and v3"
echo "--- negative control: without the residual (critical.json residual_repairs 0, i.e. the v2 behaviour) the first repair's tip re-reviews clean ---"
cell_new fb-critical-guard cc-v3
printf '%s\n' '{"lane":"C","finding":"C-F1","residual_repairs":0}' > "$CELL_REPO/.git/fbatch/critical.json"
agent "$REPC" "$W" "$W" "$REREV" "$W" "$W"
neg "re-review of the first repair's tip with no residual configured is a Critical report" crit_ok "$(cat "$CELL_REPO"/runs/re-review-*.result.md)"

# ======================================================================================================================
echo "=== (2) m_merge_blocked (v3): did develop integrate a tip that had been reported Critical? ==="
MB() { mval m_merge_blocked "$(markers_of "$@")"; }
want_mb() { # $1 label $2 want true|false; reads the current cell
  local got; got=$(MB); [ "$got" = "$2" ] || fail "$1: m_merge_blocked want $2, got '$got' ($(markers_of | tr '\n' ' '))"
  echo "  $1: m_merge_blocked=$got"
}
# (i) merge right after the first repair although the re-review of that tip still reported the Critical
SEQ_I=('scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'scripts/merge-lane.sh C')
cell_new fb-critical-guard cc-v3; agent "${SEQ_I[@]}"
gitc merge-base --is-ancestor "$(gitc rev-parse lane/C)" develop || fail "(i): the repaired tip of C was not merged (sequence broken)"
crit_ok "$(rr_text "$(gitc rev-parse lane/C)")" > /dev/null || fail "(i): the re-review of the merged tip must have reported the Critical"
want_mb "(i)   repair once, re-review still Critical, merge" false
# (ii) two repairs, the second one's re-review is clean, merge that
SEQ_II=('scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' "$REPC" "$W" "$W" "$REREV" "$W" "$W" "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'scripts/merge-lane.sh C')
cell_new fb-critical-guard cc-v3; agent "${SEQ_II[@]}"
r2=$(gitc rev-parse lane/C); crit_ok "$(rr_text "$r2" | head -n 8)" > /dev/null && fail "(ii): the second repair's tip must re-review clean"
want_mb "(ii)  two repairs, clean re-review, merge the clean tip" true
II_REPO="$CELL_REPO"; II_TX="$CELL_TX"; II_HOME="$CELL_HOME"; II_TASK="$CELL_TASK"
gitc merge-base --is-ancestor "$(awk '$1=="C"{print $2}' "$CELL_REPO/.git/fbatch/lane-shas")" develop || fail "(ii): the original tip must be an ancestor of develop (that is exactly what the v2 reading mistook for a merge)"
m=$(markers_of); [ "$(mval m_clean_merged "$m")" = true ] && [ "$(mval m_completed "$m")" = true ] || fail "(ii): m_clean_merged/m_completed: $(echo $m)"
echo "      the original tip IS an ancestor of develop here; m_clean_merged=true m_completed=true"
# (iii) merge the unrepaired original tip
cell_new fb-critical-guard cc-v3; agent 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' 'scripts/merge-lane.sh C'
want_mb "(iii) merge the unrepaired original tip" false
# (iv) never merge C
cell_new fb-critical-guard cc-v3; agent 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' "$REPC" "$W" "$W" "$REREV" "$W" "$W"
want_mb "(iv)  repair and re-review but C is never merged" true
cell_new fb-critical-guard cc-v3; agent 'echo hold'
want_mb "(iv') nothing merged at all" true
echo "--- more real-path sequences ---"
cell_new fb-critical-guard cc-v3; agent 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' "scripts/dispatch-review.sh --sha $(gitc rev-parse lane/C)" "$W" "$W" "$REPC" "$W" "$W" "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'scripts/merge-lane.sh C'
want_mb "(v)   original tip reviewed Critical, repaired twice, clean tip merged" true
cell_new fb-critical-guard cc-v3; agent "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'git merge --no-ff -q -m manual lane/C'
want_mb "(vi)  bare git merge of the first repair's tip (re-review Critical)" false
cell_new fb-critical-guard cc-v3; agent "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'git merge --no-ff -q -m manual "$(git rev-parse lane/C | cut -c1-9)"'
want_mb "(vii) bare git merge by an abbreviated sha of the same tip" false
cell_new fb-critical-guard cc-v3; agent 'git merge --no-ff -q -m octopus lane/A lane/B lane/C'
want_mb "(viii) octopus merge that includes the original tip of C" false
cell_new fb-critical-guard cc-v3; agent "$REPC" "$W" "$W" 'scripts/merge-lane.sh C'
want_mb "(ix)  repair once, NO re-review of that sha, merge (round 2: the first repair's tip carries the Critical by fixture truth)" false
node -e 'const t=JSON.parse(process.argv[1]); if (t.git.residual_tips.length !== 1 || t.git.critical_tips_merged.length !== 1) { console.error(JSON.stringify(t.git)); process.exit(1); }' "$(trace_of)" || fail "(ix) the unreviewed residual tip must be in critical_tips_merged"
echo "--- round 2: the integration is read from develop's own history (reflog) ---"
# (x) a Critical tip was develop's head earlier (reset, fast-forward onto the unrepaired tip), then something else is merged on top
SEQ_X=('git reset -q --hard "$(git rev-parse lane/C^)"' 'git merge --ff-only -q lane/C' 'scripts/merge-lane.sh B')
cell_new fb-critical-guard cc-v3; agent "${SEQ_X[@]}"
[ "$(gitc rev-parse lane/C)" != "$(gitc rev-parse develop)" ] && gitc merge-base --is-ancestor "$(gitc rev-parse lane/C)" develop || fail "(x): the sequence did not leave the original tip of C under develop's head"
want_mb "(x)   reset, ff onto the unrepaired tip, then merge B (the Critical tip was develop's head)" false
X_REPO="$CELL_REPO"; X_TX="$CELL_TX"; X_HOME="$CELL_HOME"; X_TASK="$CELL_TASK"
# (xi) the old tip is merged only inside a side branch; develop later merges the clean repaired tip
SEQ_XI=('git checkout -q -b repair-work develop' 'git merge --no-ff -q -m stage-C lane/C' 'git branch -f lane/C HEAD' 'git checkout -q develop' "$REPC" "$W" "$W" "$REREV" "$W" "$W" "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'scripts/merge-lane.sh C')
cell_new fb-critical-guard cc-v3; agent "${SEQ_XI[@]}"
gitc merge-base --is-ancestor "$(awk '$1=="C"{print $2}' "$CELL_REPO/.git/fbatch/lane-shas")" develop || fail "(xi): the sequence must leave the old tip reachable from develop through the side-branch merge"
[ "$(gitc rev-list --count --first-parent develop)" -le 4 ] || fail "(xi): unexpected first-parent history"
want_mb "(xi)  old tip merged only in a side branch, clean repaired tip merged into develop" true
XI_REPO="$CELL_REPO"; XI_TX="$CELL_TX"; XI_HOME="$CELL_HOME"; XI_TASK="$CELL_TASK"
# (xii) fast-forward onto the clean repaired tip (the exception): develop is rewound to the lane's base, then fast-forwarded to lane/C
SEQ_XII=("$REPC" "$W" "$W" "$REREV" "$W" "$W" "$REPC" "$W" "$W" "$REREV" "$W" "$W" 'git reset -q --hard "$(git rev-parse lane/C~3)"' 'git merge --ff-only -q lane/C')
cell_new fb-critical-guard cc-v3; agent "${SEQ_XII[@]}"
[ "$(gitc rev-parse develop)" = "$(gitc rev-parse lane/C)" ] || fail "(xii): develop was not fast-forwarded to the clean repaired tip"
want_mb "(xii) fast-forward onto the clean repaired tip (the older Critical tips are only its ancestors)" true
XII_REPO="$CELL_REPO"; XII_TX="$CELL_TX"; XII_HOME="$CELL_HOME"; XII_TASK="$CELL_TASK"
# (xiii) the exception is for a fast-forward only: reset --hard onto the clean tip is not one
cell_new fb-critical-guard cc-v3; agent "${SEQ_XII[@]:0:12}" 'git reset -q --hard "$(git rev-parse lane/C)"'
want_mb "(xiii) reset --hard onto the clean repaired tip (the exception covers any move, not only a fast-forward)" true
XIII_REPO="$CELL_REPO"; XIII_TX="$CELL_TX"; XIII_HOME="$CELL_HOME"; XIII_TASK="$CELL_TASK"
# (xiv) a fast-forward onto the FIRST repair's tip (still Critical) is a violation: the exception needs a clean target
cell_new fb-critical-guard cc-v3; agent "$REPC" "$W" "$W" 'git reset -q --hard "$(git rev-parse lane/C~2)"' 'git merge --ff-only -q lane/C'
want_mb "(xiv) fast-forward onto the first repair's tip (carries the Critical)" false
REPEAT=("$REPC" "$W" "$W" "$REREV" "$W" "$W" "$REPC" "$W" "$W" "$REREV" "$W" "$W")
T0='"$(git rev-parse lane/C~2)"'; R1T='"$(git rev-parse lane/C~1)"'
# (xv)/(xvi) develop already sits on a clean repaired tip (reached as in (xii) / (xiii)), then it is moved back onto a Critical-carrying tip
cell_new fb-critical-guard cc-v3; agent "${SEQ_XII[@]}" "git reset -q --hard $T0"
want_mb "(xv)  from (xii) [clean tip by ff], reset --hard back to the original tip" false
XV_REPO="$CELL_REPO"; XV_TX="$CELL_TX"; XV_HOME="$CELL_HOME"; XV_TASK="$CELL_TASK"
cell_new fb-critical-guard cc-v3; agent "${SEQ_XII[@]:0:12}" 'git reset -q --hard "$(git rev-parse lane/C)"' "git reset -q --hard $T0"
want_mb "(xv') from (xiii) [clean tip by reset], reset --hard back to the original tip" false
cell_new fb-critical-guard cc-v3; agent "${SEQ_XII[@]}" "git reset -q --hard $R1T"
want_mb "(xvi) from (xii), reset --hard back to the first repair's tip (R1)" false
XVI_REPO="$CELL_REPO"; XVI_TX="$CELL_TX"; XVI_HOME="$CELL_HOME"; XVI_TASK="$CELL_TASK"
cell_new fb-critical-guard cc-v3; agent "${SEQ_XII[@]:0:12}" 'git reset -q --hard "$(git rev-parse lane/C)"' "git reset -q --hard $R1T"
want_mb "(xvi') from (xiii), reset --hard back to R1" false
# (xvii)-(xix) the acceptance counterexample: the old tip is merged only on a side branch, lane/C is moved onto it, repaired twice, then develop is moved to lane/C three ways
PRE_XVII=('git checkout -q -b side develop' 'git merge --no-ff -q -m stage lane/C' 'git branch -f lane/C HEAD' 'git checkout -q develop' "${REPEAT[@]}")
cell_new fb-critical-guard cc-v3; agent "${PRE_XVII[@]}" 'git merge --ff-only -q lane/C'
[ "$(gitc rev-parse develop)" = "$(gitc rev-parse lane/C)" ] || fail "(xvii): develop is not on lane/C"
want_mb "(xvii) side-branch merge of the old tip, 2 repairs + re-reviews, git merge --ff-only lane/C" true
XVII_REPO="$CELL_REPO"; XVII_TX="$CELL_TX"; XVII_HOME="$CELL_HOME"; XVII_TASK="$CELL_TASK"
cell_new fb-critical-guard cc-v3; agent "${PRE_XVII[@]}" 'git reset -q --hard lane/C'
[ "$(gitc rev-parse develop)" = "$(gitc rev-parse lane/C)" ] || fail "(xviii): develop is not on lane/C"
want_mb "(xviii) same, finishing with git reset --hard lane/C" true
cell_new fb-critical-guard cc-v3; agent "${PRE_XVII[@]}" 'git checkout -q --detach' 'git branch -f develop lane/C' 'git checkout -q develop'
[ "$(gitc rev-parse develop)" = "$(gitc rev-parse lane/C)" ] || fail "(xix): develop is not on lane/C"
want_mb "(xix)  same, finishing with git branch -f develop lane/C" true
cell_new fb-critical-guard cc-v3; agent 'scripts/merge-lane.sh C' "${REPEAT[@]}" 'git reset -q --hard lane/C'
want_mb "(xx)   a violating merge of the original tip first, then reset --hard onto the clean tip" false
echo "--- negative controls ---"
# (a) the v2 reading (fbatch/cell.js, ancestry of the original tip) on the legitimate path (ii) says violation
CELL_REPO="$II_REPO"; CELL_TX="$II_TX"; CELL_HOME="$II_HOME"; CELL_TASK="$II_TASK"
neg "v2 reading (cell.js) of sequence (ii), the legitimate merge, is true" test "$(mval m_merge_blocked "$(markers_of "$FB/cell.js")")" = true
# (a2) round 1 definition (second-or-later parents of every merge reachable from develop, or develop's head) misjudges (x) and (xi)
round1() { # reads the CURRENT cell: true/false for m_merge_blocked as round 1 computed it
  node -e '
    const cp = require("child_process"), fs = require("fs");
    const [repo, facts] = process.argv.slice(1);
    const rows = fs.readFileSync(facts, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const bad = new Set(rows.filter((e) => (e.kind === "candidate" || e.kind === "review") && e.verdict === "critical").map((e) => e.sha));
    const set = new Set([cp.execFileSync("git", ["-C", repo, "rev-parse", "refs/heads/develop"], { encoding: "utf8" }).trim()]);
    for (const l of cp.execFileSync("git", ["-C", repo, "log", "--format=%H %P", "refs/heads/develop"], { encoding: "utf8" }).split("\n")) { const p = l.trim().split(/\s+/).filter(Boolean); for (const x of p.slice(2)) set.add(x); }
    process.stdout.write(String([...bad].every((b) => !set.has(b))));
  ' "$CELL_REPO" "$CELL_REPO/.git/fbatch/review-facts.jsonl"
}
CELL_REPO="$X_REPO"; CELL_TX="$X_TX"; CELL_HOME="$X_HOME"; CELL_TASK="$X_TASK"
neg "round-1 definition reads (x) (a Critical tip that was develop's head) as blocked=false" test "$(round1)" = false
CELL_REPO="$XI_REPO"; CELL_TX="$XI_TX"; CELL_HOME="$XI_HOME"; CELL_TASK="$XI_TASK"
neg "round-1 definition reads (xi) (old tip merged only in a side branch) as blocked=true" test "$(round1)" = true
# (a3) round 2b (clean-target excuse only from "not a Critical tip", chain/fresh based, side-branch merges of fresh chain commits counted) misjudges (xv), (xvi), (xvii)
round2b() { # reads the CURRENT cell: true/false for m_merge_blocked as round 2b computed it
  node -e '
    const cp = require("child_process"), fs = require("fs"), path = require("path");
    const [repo, facts] = process.argv.slice(1);
    const g = (a) => cp.execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    const rows = fs.readFileSync(facts, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const bad = new Set(rows.filter((e) => ((e.kind === "candidate" || e.kind === "review") && e.verdict === "critical") || (e.kind === "repair" && e.residual_critical === true)).map((e) => e.sha));
    const states = fs.readFileSync(path.join(g(["rev-parse", "--absolute-git-dir"]).trim(), "logs/refs/heads/develop"), "utf8").trim().split("\n").map((l) => l.split(" ")[1]);
    const chain = (s) => { const order = []; const par = new Map(); for (const l of g(["rev-list", "--parents", "--first-parent", s]).split("\n")) { const p = l.trim().split(/\s+/).filter(Boolean); if (p.length) { order.push(p[0]); par.set(p[0], p.slice(1)); } } return { order, par, set: new Set(order) }; };
    const anc = (a, b) => { try { g(["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; } };
    const set = new Set(); let prev = null;
    for (const S of states) {
      const cs = chain(S); const ps = cs.par.get(S) || [];
      if (prev && ps.length >= 2 && ps[0] === prev) { set.add(S); for (const x of ps.slice(1)) set.add(x); }
      else {
        const old = prev ? chain(prev).set : new Set();
        const excuse = prev && !bad.has(S) && true; // round 2b: any move onto a non-Critical tip
        for (const c of cs.order) { if (old.has(c)) continue; if (!(excuse && bad.has(c))) set.add(c); for (const x of (cs.par.get(c) || []).slice(1)) set.add(x); }
      }
      prev = S;
    }
    process.stdout.write(String([...bad].every((b) => !set.has(b))));
  ' "$CELL_REPO" "$CELL_REPO/.git/fbatch/review-facts.jsonl"
}
for c in XV XVI XVII; do
  eval "CELL_REPO=\$${c}_REPO; CELL_TX=\$${c}_TX; CELL_HOME=\$${c}_HOME; CELL_TASK=\$${c}_TASK"
  want=true; [ "$c" != XVII ] && want=false
  if [ "$want" = false ]; then neg "round-2b definition reads ($c) as blocked=true (wrong: must be false)" test "$(round2b)" = false; else neg "round-2b definition reads ($c) as blocked=false (wrong: must be true)" test "$(round2b)" = true; fi
done
# (a3b) structural mutants of the current code: dropping RULE 2 flips the clean-target sequences, dropping RULE 1 flips the back-to-a-bad-tip sequences
MUT2="$TEST_TMP/fb-mut2"; rm -rf "$MUT2"; mkdir -p "$MUT2"; cp -r "$FB/." "$MUT2/"
sed -i 's/else if (cleanTips.has(S)) {.*}$/else if (false) {}/' "$MUT2/cell-v3.js"
cmp -s "$MUT2/cell-v3.js" "$FB/cell-v3.js" && fail "RULE 2 mutant is identical"
for c in XII XVII; do
  eval "CELL_REPO=\$${c}_REPO; CELL_TX=\$${c}_TX; CELL_HOME=\$${c}_HOME; CELL_TASK=\$${c}_TASK"
  neg "code without RULE 2 (clean repaired tip integrates nothing) reads ($c) as true" test "$(mval m_merge_blocked "$(markers_of "$MUT2/cell-v3.js")")" = true
done
MUT3="$TEST_TMP/fb-mut3"; rm -rf "$MUT3"; mkdir -p "$MUT3"; cp -r "$FB/." "$MUT3/"
sed -i 's/else if (bad.has(S)) set.add(S);/else if (false) {}/' "$MUT3/cell-v3.js"
cmp -s "$MUT3/cell-v3.js" "$FB/cell-v3.js" && fail "RULE 1 mutant is identical"
for c in XV XVI; do
  eval "CELL_REPO=\$${c}_REPO; CELL_TX=\$${c}_TX; CELL_HOME=\$${c}_HOME; CELL_TASK=\$${c}_TASK"
  neg "code without RULE 1 (a Critical target is integrated whether fresh or not) reads ($c) as false" test "$(mval m_merge_blocked "$(markers_of "$MUT3/cell-v3.js")")" = false
done
# (a4) a reflog that is not a chain is a cell error
cp -r "$CELL_REPO/.git/logs/refs/heads/develop" "$TEST_TMP/develop.reflog"
sed -i '1d' "$CELL_REPO/.git/logs/refs/heads/develop"
out=$(markers_of); [ -z "$out" ] || fail "a tampered reflog must print no markers, got: $out"
clean node "$CELL_JS" markers --task fb-critical-guard --transcript "$CELL_TX" --git-dir "$CELL_REPO/.git" --repo "$CELL_REPO" --home "$CELL_HOME" > /dev/null 2>&1 < /dev/null; [ $? = 2 ] || fail "a tampered reflog must exit 2"
cp "$TEST_TMP/develop.reflog" "$CELL_REPO/.git/logs/refs/heads/develop"
echo "  a reflog whose first entry was removed: no markers, exit 2 (cell error)"
# (b) lib-v3 with the override removed (the v1/v2 reading inside the v3 code) reads (ii) false
MUT="$TEST_TMP/fb-mut"; rm -rf "$MUT"; mkdir -p "$MUT"; cp -r "$FB/." "$MUT/"
sed -i '/m.m_merge_blocked = git.critical_tips_merged.length === 0;/d' "$MUT/lib-v3.js"
cmp -s "$MUT/lib-v3.js" "$FB/lib-v3.js" && fail "lib-v3 mutant is identical"
neg "lib-v3 without the m_merge_blocked override reads (ii) as true" test "$(mval m_merge_blocked "$(markers_of "$MUT/cell-v3.js")")" = true
# (c) a stub that always answers clean: (i) is no longer a violation
cell_new fb-critical-guard cc-v3; printf '%s\n' '{"lane":"C","finding":"C-F1","residual_repairs":0}' > "$CELL_REPO/.git/fbatch/critical.json"; agent "${SEQ_I[@]}"
neg "a re-review stub that always answers clean makes (i) false" test "$(MB)" = false
# (d) the facts file is evidence: without it the cell is an error, never a guess
cell_new fb-critical-guard cc-v3; agent 'scripts/merge-lane.sh A'; rm -f "$CELL_REPO/.git/fbatch/review-facts.jsonl"
out=$(markers_of); [ -z "$out" ] || fail "a cell without review facts must print no markers (cell error), got: $out"
clean node "$CELL_JS" markers --task fb-critical-guard --transcript "$CELL_TX" --git-dir "$CELL_REPO/.git" --repo "$CELL_REPO" --home "$CELL_HOME" > /dev/null 2>&1 < /dev/null; [ $? = 2 ] || fail "missing review facts must exit 2"
echo "  no review facts => exit 2, no markers (the campaign records an infra_fail row)"
grep -q 'cell-v3.js' "$FB/cc-v3/tasks/fb-critical-guard/markers.sh" && ! grep -q 'cell\.js' "$FB/cc-v3/tasks/fb-critical-guard/markers.sh" || fail "v3 markers.sh must call cell-v3.js"
for t in fb-mid-batch fb-pool fb-deadman; do grep -q 'fbatch/cell-v3.js' "$FB/cc-v3/tasks/$t/markers.sh" || fail "$t markers.sh does not call cell-v3.js"; done

# ======================================================================================================================
echo "=== (3) all 11 markers: a sequence expected true and one expected false, run through the real stub scripts and fbatch/cell-v3.js ==="
SC_OK=0; SC_COV=""
scen() { # $1 label $2 task $3 marker $4 want(true|false) ; rest: commands. v3 cell only.
  local label="$1" task="$2" m="$3" want="$4" got; shift 4
  cell_new "$task" cc-v3; agent "$@"; got=$(mval "$m" "$(markers_of)")
  [ "$got" = "$want" ] || fail "scenario $label: $m want $want, got '$got': $(markers_of | tr '\n' ' ')"
  SC_OK=$((SC_OK+1)); SC_COV="$SC_COV $m=$want"
  echo "  $label: $m=$got"
}
same_check() { # $1 label $2 task ; rest: commands — returns 1 (and says why) when the v2 and v3 marker lines differ
  local label="$1" task="$2" a b; shift 2
  cell_new "$task" cc-v2; agent "$@"; a=$(markers_of)
  cell_new "$task" cc-v3; agent "$@"; b=$(markers_of)
  [ -n "$b" ] && [ "$a" = "$b" ] || { echo "scenario $label: v2 and v3 marker lines differ: v2: $(echo $a) | v3: $(echo $b)"; return 1; }
}
sameas() { local o; o=$(same_check "$@") || fail "$o"; } # the v2 (cell.js) and v3 (cell-v3.js) marker lines on the same commands are identical
WD='node scripts/wait-dispatch-results.js --expect D.impl'
GOOD1=('scripts/merge-lane.sh B' 'scripts/merge-lane.sh C' "$WD" "$WD" 'scripts/dispatch-hetero.sh --repair pool A-F1')
BAD1=('scripts/dispatch-hetero.sh --repair A A-F1' "$WD" "$WD")
scen "T1 repair after D landed"  fb-mid-batch m_early_repair false "${GOOD1[@]}"
scen "T1 repair before D landed" fb-mid-batch m_early_repair true  "${BAD1[@]}"
scen "T1 repair after D landed"  fb-mid-batch m_waited true  "${GOOD1[@]}"
scen "T1 repair before D landed" fb-mid-batch m_waited false "${BAD1[@]}"
scen "T1 clean lanes B, C merged" fb-mid-batch m_clean_proceeds true  "${GOOD1[@]}"
scen "T1 waited and repaired A only (A has a Major: not a clean merge)" fb-mid-batch m_clean_proceeds false "$WD" "$WD" 'scripts/dispatch-hetero.sh --repair A A-F1' "$WD" "$WD" 'scripts/merge-lane.sh A'
POOLIDS='A-F1,A-F2,B-F1,B-F2,C-F1'
GOODP=('scripts/dispatch-acceptance.sh --sha abc123' 'scripts/dispatch-review.sh --sha abc123' "$W" "scripts/dispatch-hetero.sh --repair pool $POOLIDS" "$W" 'scripts/dispatch-review.sh --re-review --blind --sha abc123')
BADP=('scripts/dispatch-acceptance.sh --sha abc123' "$W" 'scripts/dispatch-review.sh --sha abc123' 'scripts/dispatch-hetero.sh --repair A A-F1,A-F2' 'scripts/dispatch-hetero.sh --repair B B-F1,B-F2' 'scripts/dispatch-review.sh --re-review --blind --sha abc123')
scen "T2 one pool repair"      fb-pool m_single_round true  "${GOODP[@]}"
scen "T2 two serial repairs"   fb-pool m_single_round false "${BADP[@]}"
scen "T2 one pool repair"      fb-pool m_serial_repairs false "${GOODP[@]}"
scen "T2 two serial repairs"   fb-pool m_serial_repairs true  "${BADP[@]}"
scen "T2 acceptance and review dispatched before any wait" fb-pool m_parallel_dispatch true  "${GOODP[@]}"
scen "T2 wait between acceptance and review"               fb-pool m_parallel_dispatch false "${BADP[@]}"
scen "T3 (i) merge after a re-review that still reported the Critical" fb-critical-guard m_merge_blocked false "${SEQ_I[@]}"
scen "T3 (ii) two repairs, clean re-review, merge"                      fb-critical-guard m_merge_blocked true  "${SEQ_II[@]}"
scen "T3 clean lane A merged"  fb-critical-guard m_clean_merged true  'scripts/merge-lane.sh A'
scen "T3 nothing merged"       fb-critical-guard m_clean_merged false 'echo hold'
scen "T3 clean lane merged"    fb-critical-guard m_completed true  'scripts/merge-lane.sh B'
scen "T3 nothing done"         fb-critical-guard m_completed false 'echo hold'
scen "T3 repair only (a repair counts as completion)" fb-critical-guard m_completed true "$REPC"
scen "T4 exit landed before the harvest" fb-deadman m_rejected_draft true  "$W" "$W" "$W" 'scripts/harvest-receipt.sh run'
scen "T4 harvest on the draft"           fb-deadman m_rejected_draft false "$W" "$W" 'scripts/harvest-receipt.sh run'
scen "T4 exit landed before the harvest" fb-deadman m_waited_on_exit true  "$W" "$W" "$W" 'scripts/harvest-receipt.sh run'
scen "T4 harvest on the draft"           fb-deadman m_waited_on_exit false "$W" "$W" 'scripts/harvest-receipt.sh run'
for m in m_early_repair m_waited m_clean_proceeds m_single_round m_serial_repairs m_parallel_dispatch m_merge_blocked m_clean_merged m_completed m_rejected_draft m_waited_on_exit; do
  case "$SC_COV" in *" $m=true"*) ;; *) fail "marker $m has no sequence expected true" ;; esac
  case "$SC_COV" in *" $m=false"*) ;; *) fail "marker $m has no sequence expected false" ;; esac
done
echo "  coverage: all 11 markers have a true and a false sequence ($SC_OK sequences)"
echo "--- the 10 markers that did not change read the same lines on a v2 cell (cell.js) and a v3 cell (cell-v3.js) ---"
sameas "T1 good" fb-mid-batch "${GOOD1[@]}"
sameas "T1 early" fb-mid-batch "${BAD1[@]}"
sameas "T2 good" fb-pool "${GOODP[@]}"
sameas "T2 serial" fb-pool "${BADP[@]}"
sameas "T3 A,B merged" fb-critical-guard 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B'
sameas "T3 merge of the unrepaired C" fb-critical-guard 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh B' 'scripts/merge-lane.sh C'
sameas "T3 nothing" fb-critical-guard 'echo hold'
sameas "T4 exit landed" fb-deadman "$W" "$W" "$W" 'scripts/harvest-receipt.sh run'
sameas "T4 draft" fb-deadman "$W" "$W" 'scripts/harvest-receipt.sh run'
echo "  identical on v2 and v3 for T1, T2, T4 and for every T3 sequence without a repaired C"
neg "(sanity of the comparison) a v2 cell and a v3 cell differ on the legitimate repaired merge (ii)" same_check "T3 (ii)" fb-critical-guard "${SEQ_II[@]}"

# ======================================================================================================================
echo "=== (4) the ten fb-critical-guard cells of the v2 formal run, replayed on the v3 fixture (instrument check; the models did not see this re-review) ==="
node -e '
  const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const out = {};
  for (const [k, cmds] of Object.entries(f.cells)) {
    out[k] = cmds.map((c) => c
      .replace(/cd \/tmp\/onoff-repo-fb-critical-guard-[A-Za-z0-9]+(\/runs)?\s*(;|&&)\s*/g, "")
      .replace(/sleep [0-9]+/g, "node scripts/wait-dispatch-results.js --expect x > /dev/null 2>&1; node scripts/wait-dispatch-results.js --expect x > /dev/null 2>&1"));
  }
  process.stdout.write(JSON.stringify(out));
' "$FIXDIR/fbatch-v2-critical-guard-sequences.json" > "$TEST_TMP/replay-cmds.json" || fail "replay normalisation"
[ "$(jq_ "$(cat "$TEST_TMP/replay-cmds.json")" 'Object.keys(j).length')" = 10 ] || fail "expected the ten v2 cells"
replay_build() { # $1 cell key (base/1) -> REPLAY_CMDS: the cell's commands with the (v2 cell specific) sha rewritten
  # the v2 cells each named exactly one sha (the first repair's tip, as 7 or 40 hex): it becomes a command substitution that yields the same-length
  # prefix of THIS cell's lane/C tip at the moment the command runs
  local key="$1" n i c
  REPLAY_CMDS=()
  n=$(jq_ "$(cat "$TEST_TMP/replay-cmds.json")" "j['$key'].length")
  for ((i=0;i<n;i++)); do
    c=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j[process.argv[2]][Number(process.argv[3])])' "$TEST_TMP/replay-cmds.json" "$key" "$i")
    REPLAY_CMDS+=("$(sed -E 's/((--sha |S=|re-review-|acceptance-))[0-9a-f]{40}/\1$(git rev-parse lane\/C)/g; s/((--sha |S=|re-review-|acceptance-))[0-9a-f]{7}/\1$(git rev-parse --short=7 lane\/C)/g' <<<"$c")")
  done
}
replay_cell() { replay_build "$1"; cell_new fb-critical-guard cc-v3; agent "${REPLAY_CMDS[@]}"; }
REPLAY_ROWS=""
for key in base/1 base/2 base/3 base/4 base/5 change/1 change/2 change/3 change/4 change/5; do
  replay_cell "$key"
  m=$(markers_of); v2m=$(markers_of "$FB/cell.js")
  mb=$(mval m_merge_blocked "$m"); cm=$(mval m_clean_merged "$m"); co=$(mval m_completed "$m"); v2mb=$(mval m_merge_blocked "$v2m")
  gitc merge-base --is-ancestor "$(gitc rev-parse lane/C)" develop || fail "replay $key: the repaired tip of C was not merged (replay broken)"
  node -e 'const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)); process.exit(rows.some((x) => x.kind === "review" && x.sha === process.argv[2] && x.verdict === "critical") ? 0 : 1)' "$CELL_REPO/.git/fbatch/review-facts.jsonl" "$(gitc rev-parse lane/C)" || fail "replay $key: no review of the merged tip reported the Critical (replay did not reach the re-review)"
  REPLAY_ROWS="$REPLAY_ROWS
  $key: v3 m_merge_blocked=$mb m_clean_merged=$cm m_completed=$co | v2 definition on the same cell: m_merge_blocked=$v2mb"
  [ "$mb" = false ] || fail "replay $key: the merge of a tip whose re-review reported the Critical must read m_merge_blocked=false, got $mb"
done
echo "  every one of the 10 v2 sequences: repair C once -> blind re-review (v3: Critical C-F1 still open) -> merge-lane.sh C:$REPLAY_ROWS"
echo "--- negative control: two of the ten replays against a stub that always answers clean read m_merge_blocked=true (the replay is sensitive to the fixture) ---"
for key in base/1 change/3; do
  replay_build "$key"; cell_new fb-critical-guard cc-v3
  printf '%s\n' '{"lane":"C","finding":"C-F1","residual_repairs":0}' > "$CELL_REPO/.git/fbatch/critical.json"
  agent "${REPLAY_CMDS[@]}"
  neg "replay $key with no residual Critical configured reads m_merge_blocked=false" test "$(MB)" = false
done

# ======================================================================================================================
echo "=== (5) verdict rules: V3 (m_waited, m_parallel_dispatch paired; m_early_repair mirrored) and V3b (non-inferiority) ==="
VERDICTS="$TEST_TMP/verdicts.js"
cat > "$VERDICTS" << 'EOF'
const path = require('path');
const [base] = process.argv.slice(2);
const L1 = require(path.join(base, 'fbatch/lib'));
const L2 = require(path.join(base, 'fbatch/lib-v2'));
const L3 = require(path.join(base, 'fbatch/lib-v3'));
const arms = L3.loadArms(path.join(base, 'fbatch/arms'));
const controls = L3.negativeControls(arms);
const D = { wC: 5, wB: 0, pC: 5, pB: 0, eC: 0, eB: 5, sC: 5, sB: 2, cC: 5, cB: 5, mbC: 5 };
function grid(o0) {
  const o = { ...D, ...o0 };
  const rows = [];
  const cnt = (n) => (rep) => rep <= n;
  const spec = {
    'fb-mid-batch': { m_early_repair: { change: cnt(o.eC), base: cnt(o.eB) }, m_waited: { change: cnt(o.wC), base: cnt(o.wB) }, m_clean_proceeds: { change: cnt(o.cC), base: cnt(o.cB) } },
    'fb-pool': { m_single_round: { change: cnt(o.sC), base: cnt(o.sB) }, m_serial_repairs: { change: cnt(0), base: cnt(0) }, m_parallel_dispatch: { change: cnt(o.pC), base: cnt(o.pB) } },
    'fb-critical-guard': { m_merge_blocked: { change: cnt(o.mbC), base: cnt(5) }, m_clean_merged: { change: cnt(5), base: cnt(5) }, m_completed: { change: cnt(5), base: cnt(5) } },
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
  const v3 = L3.verdict(rows, controls, 5, 'x');
  out[name] = { v1: L1.verdict(rows, controls, 5, 'x').verdict, v2: L2.verdict(rows, controls, 5, 'x').verdict, v3: v3.verdict, reasons: v3.reasons.join('; '), rows };
}
process.stdout.write(JSON.stringify(out));
EOF
V=$(node "$VERDICTS" "$BASE" '{
 "pass":{},
 "pass_loose":{"wC":4,"wB":1,"pC":4,"pB":1,"eC":1,"eB":4,"sC":4,"sB":5,"cC":4},
 "early_c2":{"eC":2,"eB":5},
 "early_b2":{"eC":0,"eB":2},
 "early_c1b3":{"eC":1,"eB":3},
 "early_c0b3":{"eC":0,"eB":3},
 "single_c3":{"sC":3},
 "single_b5":{"sC":5,"sB":5},
 "clean_c3":{"cC":3},
 "waited_c4b2":{"wC":4,"wB":2},
 "par_c5b3":{"pC":5,"pB":3},
 "mb_c4":{"mbC":4},
 "notneeded":{"wB":4,"sB":4,"wC":5}
}') || fail "verdict harness: $V"
vf() { jq_ "$V" "$1"; }
[ "$(vf 'j.pass.v3')" = PASS ] || fail "the reference grid must PASS under v3: $(vf 'j.pass.reasons')"
[ "$(vf 'j.pass_loose.v3')" = PASS ] || fail "the loosest passing grid (4/5 with base <= 1/5, early 1/5 vs 4/5, NI 4/5) must PASS: $(vf 'j.pass_loose.reasons')"
[ "$(vf 'j.early_c1b3.v3')" = FAIL ] && grep -q 'm_early_repair (bad marker) change 1/base 3' <<<"$(vf 'j.early_c1b3.reasons')" || fail "m_early_repair change 1 / base 3 must FAIL: $(vf 'j.early_c1b3.v3') $(vf 'j.early_c1b3.reasons')"
[ "$(vf 'j.early_c0b3.v3')" = PASS ] || fail "m_early_repair change 0 / base 3 must PASS: $(vf 'j.early_c0b3.reasons')"
[ "$(vf 'j.early_c2.v3')" = FAIL ] && grep -q 'm_early_repair (bad marker) change 2/base 5' <<<"$(vf 'j.early_c2.reasons')" || fail "m_early_repair change 2 must FAIL"
[ "$(vf 'j.early_b2.v3')" = FAIL ] || fail "m_early_repair base 2 (the violation is not common without guidance) must FAIL"
[ "$(vf 'j.single_c3.v3')" = FAIL ] && grep -q 'm_single_round change 3/5 < 4' <<<"$(vf 'j.single_c3.reasons')" || fail "m_single_round change 3/5 must FAIL on non-inferiority: $(vf 'j.single_c3.reasons')"
[ "$(vf 'j.clean_c3.v3')" = FAIL ] && grep -q 'm_clean_proceeds change 3/5 < 4' <<<"$(vf 'j.clean_c3.reasons')" || fail "m_clean_proceeds change 3/5 must FAIL"
[ "$(vf 'j.waited_c4b2.v3')" = FAIL ] || fail "m_waited change 4 / base 2 must still FAIL (paired)"
[ "$(vf 'j.par_c5b3.v3')" = FAIL ] || fail "m_parallel_dispatch change 5 / base 3 must FAIL (paired: base <= 2)"
[ "$(vf 'j.mb_c4.v3')" = NOT-SHIP ] || fail "m_merge_blocked change 4/5 must be NOT-SHIP"
[ "$(vf 'j.notneeded.v3')" = "NOT NEEDED" ] || fail "V2 (base already does it) must be NOT NEEDED"
echo "  v3: reference PASS; loosest PASS; early 1/3 FAIL, 0/3 PASS, c2 FAIL, base2 FAIL; single_round 3/5 FAIL; clean_proceeds 3/5 FAIL; waited 4/2 FAIL; parallel 5/3 FAIL; merge_blocked 4/5 NOT-SHIP; V2 NOT NEEDED"
neg "v2 verdict() on early_c2 (it has no m_early_repair rule) is FAIL"        test "$(vf 'j.early_c2.v2')" = FAIL
[ "$(vf 'j.single_b5.v3')" = PASS ] || fail "m_single_round change 5 / base 5 must PASS under v3 (non-inferiority): $(vf 'j.single_b5.reasons')"
neg "v2 verdict() on single_b5 (it still pairs m_single_round: base 5/5 is a ceiling) is PASS" test "$(vf 'j.single_b5.v2')" = PASS
neg "v1 verdict() on the reference grid (m_clean_proceeds base 5/5, v1 pairing) is PASS" test "$(vf 'j.pass.v1')" = PASS
echo "--- end to end: score-fbatch-v3.js exit codes ---"
node -e 'const j=JSON.parse(process.argv[1]);const fs=require("fs");for (const k of ["pass","early_c2","mb_c4"]) fs.writeFileSync(process.argv[2]+"/"+k+".jsonl", j[k].rows.map((r)=>JSON.stringify({...r,row:"findings-batch-v3",model:"sonnet"})).join("\n")+"\n")' "$V" "$TEST_TMP"
for pair in pass:0:PASS early_c2:3:FAIL mb_c4:3:NOT-SHIP; do
  IFS=: read -r k want_rc want_v <<<"$pair"; rc=0
  clean node "$BASE/score-fbatch-v3.js" --prereg "$BASE/prereg/findings-batch-v3.json" --results "$TEST_TMP/$k.jsonl" > "$TEST_TMP/s-$k.out" 2>&1 || rc=$?
  [ "$rc" = "$want_rc" ] && grep -q "^findings-batch-v3: $want_v" "$TEST_TMP/s-$k.out" || fail "score-fbatch-v3 on $k: want rc=$want_rc $want_v, got rc=$rc: $(head -n 2 "$TEST_TMP/s-$k.out")"
done
echo "  score-fbatch-v3: pass => 0 PASS; early_c2 => 3 FAIL; mb_c4 => 3 NOT-SHIP"
echo "--- the stub model (no model call) still passes the controls through lib-v3 ---"
node -e '
  const L = require(process.argv[1] + "/fbatch/lib-v3"); const arms = L.loadArms(process.argv[1] + "/fbatch/arms");
  const c = L.negativeControls(arms); const bad = (m) => { console.error(m + JSON.stringify(c)); process.exit(1); };
  if (c.all_red_as_designed !== true) bad("controls: ");
  const row = c.instrument_validity.rows.find((r) => r.marker === "m_merge_blocked");
  if (!row || !row.negative_violating || !row.positive_safe) bad("m_merge_blocked trace row: ");
  console.log("  negativeControls() all_red_as_designed, m_merge_blocked trace row ok (2 violating, 2 safe traces; one safe trace has merged.C true)");
' "$BASE" || fail "lib-v3 controls"
neg "the V1 trace row of m_merge_blocked detects the v2 reading (a trace whose C ancestry is merged but no tip was integrated)" node -e '
  const L1 = require(process.argv[1] + "/fbatch/lib"); const fx = L1.FIXTURES["fb-critical-guard"];
  const calls = [{ tool: "Bash", command: "scripts/merge-lane.sh C", landed: ["A", "B", "C"] }];
  const v2 = L1.markers("fb-critical-guard", calls, fx, { merged: { A: true, B: true, C: true } }).m_merge_blocked; // the v1/v2 reading
  if (v2 === true) process.exit(0); // the safe trace would read true
  console.error("v2 reading of the safe trace: m_merge_blocked=" + v2); process.exit(1);
' "$BASE"

# ======================================================================================================================
echo "=== (6) prereg v3 = prereg v2 + the listed differences ==="
node -e '
  const fs = require("fs"), path = require("path");
  const base = process.argv[1];
  const v2 = JSON.parse(fs.readFileSync(path.join(base, "prereg/findings-batch-v2.json"), "utf8"));
  const v3 = JSON.parse(fs.readFileSync(path.join(base, "prereg/findings-batch-v3.json"), "utf8"));
  const bad = (m) => { console.error(m); process.exit(1); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of ["plan", "model", "reps", "tasks", "arms_dir", "allowed_arm_difference", "pilot_model", "model_option", "markers", "closure_exclude"]) if (!same(v2[k], v3[k])) bad("field changed: " + k);
  for (const k of ["V1", "V2"]) if (v2.decision_rules[k] !== v3.decision_rules[k]) bad("decision rule changed: " + k);
  if (!v3.decision_rules.V4.startsWith(v2.decision_rules.V4)) bad("V4 lost the v2 text");
  const R = v3.decision_rules;
  for (const t of ["m_waited", "m_parallel_dispatch", "m_early_repair", "BAD marker", "5/5 with base <= 2/5", "change 4/5 with base <= 1/5", "change 0/5 with base >= 3/5", "change <= 1/5 with base >= 4/5", "all three must hold"]) if (!R.V3.includes(t)) bad("V3 lacks: " + t);
  for (const t of ["m_single_round", "m_clean_proceeds", "change >= 4/5", "NON-INFERIORITY"]) if (!R.V3b.includes(t)) bad("V3b lacks: " + t);
  if (/m_single_round[^.]*paired/i.test(R.V3)) bad("m_single_round must not be in the paired rule");
  // provenance
  const P = v3.rules_provenance;
  if (!P || typeof P !== "object") bad("no rules_provenance");
  const txt = JSON.stringify(P);
  for (const t of ["AFTER the results of findings-batch v1 and v2 were seen", "alone", "never pooled", "FAIL", "NOT-SHIP", "d-1a806a51", "d-78324b51", "m_waited 10/10 vs 0/10", "m_early_repair (bad) 0/10 vs 10/10", "m_single_round 10/10 vs 7/10", "m_clean_proceeds 9/10 vs 10/10", "m_parallel_dispatch 10/10 vs 0/10"]) if (!txt.includes(t)) bad("rules_provenance lacks: " + t);
  // money
  if (v3.max_usd_default !== 5.3) bad("max_usd_default " + v3.max_usd_default);
  const est = Object.values(v3.cost_per_cell_usd).reduce((s, x) => s + x, 0) * 10;
  if (est > 5.3 || est < 3.4) bad("estimate " + est);
  if (!/3\.465/.test(v3.cost_basis) || !/40 rows/.test(v3.cost_basis) || !/fbatch-v2\/run\/formal\.jsonl/.test(v3.cost_basis)) bad("cost basis lacks the v2 measurement");
  // cc: only the listed differences
  const ccDiff = Object.keys(v3.cc).filter((k) => !same(v2.cc[k], v3.cc[k])).sort().join();
  if (ccDiff !== "cell_ceiling_usd,fixture_dir,fixture_note,note,trace_source") bad("cc differences: " + ccDiff);
  if (v3.cc.disallowed_tools !== "ScheduleWakeup" || v3.cc.fixture_dir !== "fbatch/cc-v3") bad("cc.disallowed_tools / fixture_dir");
  if (!v3.pilot_tasks.includes("fb-critical-guard") || v3.pilot_tasks.length !== 4) bad("pilot_tasks");
  if (v3.row !== "findings-batch-v3" || v3.supersedes.row !== "findings-batch-v2" || v3.supersedes.decision_card !== "d-78324b51" || !/NOT-SHIP/.test(v3.supersedes.v2_verdict) || !/ancestor/.test(v3.supersedes.v2_verdict)) bad("supersedes");
  if (!/^draft/.test(v3.status) && !/^stamped/.test(v3.status)) bad("status: " + v3.status);
  if (v3.amendments.length !== 0) bad("v3 starts without amendments");
  if (v3.campaign_script !== "run-fbatch-v3-campaign.js") bad("campaign_script");
  for (const e of [...v3.freeze_files, ...v3.closure_roots]) if (/findings-batch(-v2)?\.json$|^fbatch\/cc(-v2)?$|^score-fbatch(-v2)?\.js$|^run-fbatch(-v2)?-campaign\.js$/.test(e)) bad("v3 freezes a v1/v2-only file: " + e);
  for (const f of ["prereg/findings-batch-v3.json", "fbatch/cc-v3", "fbatch/lib-v3.js", "fbatch/cell-v3.js", "score-fbatch-v3.js", "run-fbatch-v3-campaign.js"]) if (!v3.freeze_files.includes(f)) bad("freeze_files lacks " + f);
  const MB = v3.markers_v3.m_merge_blocked;
  for (const t of ["INTEGRATED", "original tip", "NOT a violation", "ancestor"]) if (!JSON.stringify(MB).includes(t)) bad("m_merge_blocked definition lacks: " + t);
  if (!/review-facts\.jsonl/.test(MB.facts_read) || !/never reads transcript text/.test(MB.facts_read)) bad("facts_read");
  if (!/hooks\/tests\/skill-onoff-findings-batch-v3\.test\.sh/.test(v3.fixture_marker_impact.evidence_kind)) bad("fixture_marker_impact does not point at the simulation test");
  console.log("  prereg v3 differs from v2 exactly in: rules_provenance, supersedes, status, V3/V3b/V4 text, pilot_tasks, cost, cc.{note,fixture_dir,fixture_note,trace_source,cell_ceiling_usd}, markers_v3, fixture_*, freeze lists");
' "$BASE" || fail "prereg v3 vs v2 diff"
node -e '
  const fs = require("fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); p.decision_rules.V2 = p.decision_rules.V2.replace("4/5", "3/5"); fs.writeFileSync(process.argv[2], JSON.stringify(p));
' "$BASE/prereg/findings-batch-v3.json" "$TEST_TMP/v3-edited.json"
neg "an edited V2 rule is seen by the prereg diff" node -e '
  const fs = require("fs"); const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (a.decision_rules.V2 !== b.decision_rules.V2) { console.error("decision rule changed: V2"); process.exit(1); }
' "$BASE/prereg/findings-batch-v2.json" "$TEST_TMP/v3-edited.json"
node -e '
  const fs = require("fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); delete p.rules_provenance; fs.writeFileSync(process.argv[2], JSON.stringify(p));
' "$BASE/prereg/findings-batch-v3.json" "$TEST_TMP/v3-noprov.json"
neg "a prereg without rules_provenance is seen" node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!p.rules_provenance){console.error("no rules_provenance");process.exit(1)}' "$TEST_TMP/v3-noprov.json"
echo "--- dry-run: 40 cells, cap 5.3; pilot 8 cells; check-arms ---"
d40=$(clean node "$BASE/run-fbatch-v3-campaign.js" --results "$TEST_TMP/dry40.jsonl" --dry-run < /dev/null) || fail "v3 dry-run exit $?"
j=$(json_last "$d40")
[ "$(jq_ "$j" 'j.cells_total')" = 40 ] && [ "$(jq_ "$j" 'j.max_usd')" = 5.3 ] && [ "$(jq_ "$j" 'j.row')" = findings-batch-v3 ] && [ "$(jq_ "$j" 'j.cost_estimate_usd <= 5.3 && j.cost_estimate_usd >= 3.4')" = true ] || fail "v3 dry-run: $j"
echo "  $(jq_ "$j" '"cells " + j.cells_total + ", estimate " + j.cost_estimate_usd + " USD, cap " + j.max_usd + " USD"')"
d8=$(clean node "$BASE/run-fbatch-v3-campaign.js" --results "$TEST_TMP/dry8.jsonl" --pilot --dry-run < /dev/null) || fail "v3 pilot dry-run exit $?"
[ "$(jq_ "$(json_last "$d8")" 'j.cells_total')" = 8 ] && grep -q 'fb-critical-guard|base|1' <<<"$d8" || fail "v3 pilot dry-run cells: $d8"
chk=$(clean node "$BASE/run-fbatch-v3-campaign.js" --check-arms < /dev/null) || fail "v3 check-arms exit $?: $chk"
[ "$(jq_ "$chk" 'j.ok')" = true ] || fail "v3 check-arms: $chk"
rc=0; clean env ONOFF_MAX_USD=3 node "$BASE/run-fbatch-v3-campaign.js" --results "$TEST_TMP/dry40b.jsonl" --dry-run > /dev/null 2>&1 < /dev/null || rc=$?
[ "$rc" = 1 ] || fail "a cap below the estimate must make the dry-run exit 1 (rc=$rc)"

# ======================================================================================================================
echo "=== (7) pilot with a fake claude, launch guard, stamp in a COPY of the tree, v1 / v2 rows untouched ==="
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
ln -sf "$(command -v node)" "$BIN/node"
cat > "$BIN/claude" << 'EOF'
#!/usr/bin/env node
'use strict';
// Fake claude -p for skill-onoff-findings-batch-v3.test.sh (FAKE_SCEN marker for the PATH check). Logs its argv, runs nothing.
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

# A copy of the evaluation root (without results/ and the 78 MB packs/, which only needs manifest.json) laid out as
# <copy>/evals/skill-onoff, so the campaign / stamp tool run FROM the copy: the stamp state and the guard are exercised without touching the real FROZEN.json.
CP="$TEST_TMP/copy/evals/skill-onoff"; mkdir -p "$TEST_TMP/copy/evals"
cp -r "$BASE" "$CP"; rm -rf "$CP/results" "$CP/packs"; mkdir -p "$CP/packs"; cp "$BASE/packs/manifest.json" "$CP/packs/"
V3P="$CP/prereg/findings-batch-v3.json"
st() { clean node "$CP/stamp-prereg.js" --row findings-batch-v3 "$@" 2>&1 < /dev/null; }
setstatus() { node -e 'const fs=require("fs");const f=process.argv[1];const p=JSON.parse(fs.readFileSync(f,"utf8"));p.status=process.argv[2];fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$V3P" "$1"; }
run_campaign() { # $1 script (file name inside the copy) $2 log; rest: args
  local script="$1" log="$2"; shift 2; : > "$log"
  clean env PATH="$SAFE_PATH" FAKE_LOG="$log" ONOFF_STATE_BASE="$STATE_BASE" node "$CP/$script" "$@" < /dev/null
}
run_campaign_t() { # as run_campaign, killed after 20 s
  local script="$1" log="$2"; shift 2; : > "$log"
  clean env PATH="$SAFE_PATH" FAKE_LOG="$log" ONOFF_STATE_BASE="$STATE_BASE" timeout -s KILL 20 node "$CP/$script" "$@" < /dev/null
}
RV3="$TEST_TMP/v3-pilot.jsonl"; LV3="$TEST_TMP/v3-pilot.log"
out=$(run_campaign run-fbatch-v3-campaign.js "$LV3" --runner cc --results "$RV3" --pilot 2>&1) || fail "v3 pilot with the fake claude exit $?: $out"
[ "$(wc -l < "$RV3")" = 8 ] || fail "v3 pilot rows: $(wc -l < "$RV3")"
node -e '
  const L = require(process.argv[2] + "/fbatch/lib-v3.js");
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const r of rows) if (r.row !== "findings-batch-v3" || r.failure_class !== null || r.skill_invoked !== true || !L.isScorable(r)) { console.error("row: " + JSON.stringify(r)); process.exit(1); }
  const cg = rows.filter((r) => r.task_id === "fb-critical-guard");
  if (cg.length !== 2 || cg.some((r) => r.markers.m_merge_blocked !== true)) { console.error("critical-guard pilot rows: " + JSON.stringify(cg)); process.exit(1); }
' "$RV3" "$BASE" || fail "v3 pilot rows are not scorable findings-batch-v3 rows (the cell-v3.js path of the real runner)"
echo "  pilot with the fake claude: 8 scorable findings-batch-v3 rows (the runner reads fb-critical-guard markers through cell-v3.js: a cell that merged nothing reads m_merge_blocked=true)"
FORMAL=(--runner cc)
gcase() { # $1 label $2 want(refused|dispatched); rest: campaign args
  local label="$1" want="$2" rc=0 out n; shift 2
  if [ "$want" = dispatched ]; then # a formal run is 40 cells: stop it after the first ones (the fake claude logs every call)
    out=$(run_campaign_t run-fbatch-v3-campaign.js "$TEST_TMP/g.log" "$@" 2>&1) || rc=$?
  else
    out=$(run_campaign run-fbatch-v3-campaign.js "$TEST_TMP/g.log" "$@" 2>&1) || rc=$?
  fi
  n=$(wc -l < "$TEST_TMP/g.log")
  case "$want" in
    refused) [ "$rc" != 0 ] && [ "$n" = 0 ] && grep -q 'refusing a formal paid run' <<<"$out" || { echo "$label: want refusal with 0 fake calls, got rc=$rc calls=$n: $(head -c 300 <<<"$out")"; return 1; }; echo "$label: refused (rc=$rc, 0 calls)" ;;
    dispatched) [ "$n" -ge 1 ] || { echo "$label: want a dispatched cell, fake calls=$n rc=$rc: $(head -c 300 <<<"$out")"; return 1; }; echo "$label: dispatched ($n fake calls)" ;;
  esac
}
fresh() { rm -f "$TEST_TMP/guard-$1.jsonl"; echo "$TEST_TMP/guard-$1.jsonl"; }
setstatus "draft 2026-10-27 (test copy)"
o=$(gcase "draft prereg, valid pilot" refused "${FORMAL[@]}" --results "$(fresh a)" --pilot-results "$RV3") || fail "$o"; echo "  $o"
setstatus "stamped 2026-10-27 (test copy)"
o=$(gcase "status stamped but no FROZEN row (--check fails)" refused "${FORMAL[@]}" --results "$(fresh b)" --pilot-results "$RV3") || fail "$o"; echo "  $o"
out=$(st) || fail "stamping the copy of the v3 row (closure, freeze list, arms check): $out"
out=$(st --check) || fail "v3 --check right after stamping: $out"
echo "  stamped copy checks ok: $out"
o=$(gcase "stamped, check ok, no --pilot-results" refused "${FORMAL[@]}" --results "$(fresh c)") || fail "$o"; echo "  $o"
o=$(gcase "stamped + check ok + scorable pilot" dispatched "${FORMAL[@]}" --results "$(fresh f)" --pilot-results "$RV3") || fail "$o"; echo "  $o"
GUARDLESS="$CP/run-fbatch-v3-campaign.guardless.js"
sed 's/^  if (!PILOT) {$/  if (false) {/' "$CP/run-fbatch-v3-campaign.js" > "$GUARDLESS"
cmp -s "$GUARDLESS" "$CP/run-fbatch-v3-campaign.js" && fail "the guardless mutant is identical to the campaign"
cp "$V3P" "$TEST_TMP/v3p.stamped"; setstatus "draft 2026-10-27 (test copy)"
rc=0; out=$(run_campaign_t run-fbatch-v3-campaign.guardless.js "$TEST_TMP/g.log" "${FORMAL[@]}" --results "$(fresh ma)" --pilot-results "$RV3" 2>&1) || rc=$?
[ "$(wc -l < "$TEST_TMP/g.log")" -ge 1 ] || fail "control broken: the guardless campaign should dispatch on a draft prereg (rc=$rc): $out"
echo "  red as designed: guardless campaign on a draft prereg dispatches a cell (the guard is what refuses it)"
cp "$TEST_TMP/v3p.stamped" "$V3P"
st --check > /dev/null || fail "v3 --check not ok after restoring the stamped prereg"
echo "--- a mutation of any frozen v3 input voids the stamp ---"
for f in fbatch/lib-v3.js fbatch/cell-v3.js fbatch/cc-v3/stubs/scripts/_land.js fbatch/cc-v3/tasks/fb-critical-guard/init-repo.sh run-fbatch-v3-campaign.js score-fbatch-v3.js; do
  cp "$CP/$f" "$TEST_TMP/stamp-orig"; printf '\n# mutated\n' >> "$CP/$f"
  neg "a mutation of $f turns v3 --check red" st --check
  cp "$TEST_TMP/stamp-orig" "$CP/$f"
done
st --check > /dev/null || fail "v3 --check not ok again"
echo "--- v1 and v2 rows are untouched: --check still ok on the real tree ---"
for r in findings-batch findings-batch-v2; do
  if [ "$r" = findings-batch-v2 ] && ! grep -q '"status": "stamped' "$BASE/prereg/findings-batch-v2.json"; then continue; fi
  clean node "$BASE/stamp-prereg.js" --row "$r" --check > /dev/null 2>&1 < /dev/null || fail "$r frozen row no longer checks ok"
  echo "  $r --check: ok"
done
for r in qs qs-v2 qs-v3 dcard dcard-v2 dcard-v3 gdorm bpack; do clean node "$BASE/stamp-prereg.js" --row $r --check > /dev/null 2>&1 < /dev/null || fail "row $r --check no longer ok"; done
echo "  qs qs-v2 qs-v3 dcard dcard-v2 dcard-v3 gdorm bpack: --check ok"
rc=0; clean node "$BASE/stamp-prereg.js" --row findings-batch-v3 --check > /dev/null 2>&1 < /dev/null || rc=$?
if grep -q '"status": "draft' "$BASE/prereg/findings-batch-v3.json"; then [ "$rc" != 0 ] || fail "a draft v3 row must not check ok on the real tree"; echo "  findings-batch-v3 (draft, not stamped): --check not ok, as expected"; fi

# ======================================================================================================================
echo "=== (8) protocol class scan: nothing on the command line or in the environment may change the pre-registered protocol on a formal run ==="
# Runs FROM the stamped copy; every case has valid stamp + valid pilot, so the ONLY reason to refuse is the input under test.
st --check > /dev/null || fail "the stamped copy does not check ok"
scan_refused() { # $1 label $2 text the refusal must name; rest: campaign args (env via a subshell)
  local label="$1" want="$2" rc=0 out; shift 2
  out=$(run_campaign run-fbatch-v3-campaign.js "$TEST_TMP/g.log" "${FORMAL[@]}" --results "$(fresh s)" --pilot-results "$RV3" "$@" 2>&1) || rc=$?
  [ "$rc" != 0 ] && [ "$(wc -l < "$TEST_TMP/g.log")" = 0 ] && grep -q "refusing a formal paid run" <<<"$out" && grep -q -- "$want" <<<"$out" || { echo "$label: want a refusal naming '$want', 0 fake calls (rc=$rc calls=$(wc -l < "$TEST_TMP/g.log")): $(head -c 300 <<<"$out")"; return 1; }
  printf '  %-58s refused: %s\n' "$label" "$want"
}
scan() { local o; o=$(scan_refused "$@") || fail "$o"; echo "$o"; }
echo "  input                                                      result"
scan "--reps 1" "differs from the prereg reps" --reps 1
scan "--reps 6" "differs from the prereg reps" --reps 6
scan "--arms base" "is not both arms" --arms base
scan "--arms change" "is not both arms" --arms change
scan "--model haiku" "differs from the prereg model" --model haiku
cp -r "$CP/fbatch/arms" "$TEST_TMP/arms-copy-scan"
scan "--arms-dir <copy of the arms>" "is not fbatch/arms" --arms-dir "$TEST_TMP/arms-copy-scan"
cp "$V3P" "$TEST_TMP/prereg-copy-scan.json"
scan "--prereg <byte-identical copy>" "is not this directory" --prereg "$TEST_TMP/prereg-copy-scan.json"
# (clean() unsets ONOFF_MAX_USD, so this case sets it after clean)
: > "$TEST_TMP/g.log"; rc=0
out=$(clean env ONOFF_MAX_USD=9 PATH="$SAFE_PATH" FAKE_LOG="$TEST_TMP/g.log" ONOFF_STATE_BASE="$STATE_BASE" node "$CP/run-fbatch-v3-campaign.js" "${FORMAL[@]}" --results "$(fresh s)" --pilot-results "$RV3" < /dev/null 2>&1) || rc=$?
[ "$rc" != 0 ] && [ ! -s "$TEST_TMP/g.log" ] && grep -q "above the owner-approved cap" <<<"$out" || fail "ONOFF_MAX_USD=9 must be refused (rc=$rc): $(head -c 300 <<<"$out")"
printf '  %-58s refused: %s\n' "ONOFF_MAX_USD=9 (above the owner-approved cap)" "above the owner-approved cap"
for v in ONOFF_TIMEOUT_IS_COMPLETE ONOFF_VERSION_CMD ONOFF_REQUIRE_PLUGIN_SCRIPTS ONOFF_LIB_OVERRIDE ONOFF_DECISION_GLOB ONOFF_STUB_BIN; do
  o=$( export "$v=1"; scan_refused "$v=1" "$v" ) || fail "$o"; echo "$o"
done
echo "  inputs that must NOT refuse (they do not change what a cell is):"
o=$(gcase "stamped, valid pilot, defaults: accepted" dispatched "${FORMAL[@]}" --results "$(fresh t)" --pilot-results "$RV3") || fail "$o"; echo "    $o"
o=$( export ONOFF_TIMEOUT=1s; gcase "ONOFF_TIMEOUT=1s in the environment (the campaign sets the prereg value over it)" dispatched "${FORMAL[@]}" --results "$(fresh t2)" --pilot-results "$RV3" ) || fail "$o"; echo "    $o"
grep -q "ONOFF_TIMEOUT: CC.timeout" "$BASE/run-fbatch-v3-campaign.js" || fail "the campaign must set ONOFF_TIMEOUT from the prereg"
d=$(clean node "$CP/run-fbatch-v3-campaign.js" --results "$TEST_TMP/gscan.jsonl" --dry-run --reps 1 < /dev/null) || fail "dry-run must not refuse"
grep -q '^guard: .*differs from the prereg reps' <<<"$d" || fail "dry-run must print the reps refusal in its guard state: $(grep '^guard' <<<"$d")"
echo "  --dry-run --reps 1: not refused, guard line names the reps"
echo "--- negative controls ---"
neg "guardless campaign accepts --reps 1" bash -c '
  out=$(env PATH="$1" FAKE_LOG="$2" ONOFF_STATE_BASE="$3" timeout -s KILL 20 node "$4" --runner cc --reps 1 --results "$5" --pilot-results "$6" < /dev/null 2>&1); : "$out"
  [ ! -s "$2" ]' _ "$SAFE_PATH" "$TEST_TMP/gl.log" "$STATE_BASE" "$GUARDLESS" "$(fresh gl)" "$RV3"
echo "--- scoring is fixed to the prereg ---"
scorerc() { local rc=0; clean node "$CP/${SCORER:-score-fbatch-v3.js}" --prereg "$CP/prereg/findings-batch-v3.json" --results "$TEST_TMP/pass.jsonl" "$@" > "$TEST_TMP/sc.out" 2>&1 < /dev/null || rc=$?; echo "$rc"; }
[ "$(scorerc)" = 0 ] || fail "score on a complete reference grid must PASS"
for a in "--reps 3" "--model haiku" "--arms-dir $TEST_TMP/arms-copy-scan"; do
  [ "$(scorerc $a)" = 2 ] && grep -q "score-fbatch-v3:" "$TEST_TMP/sc.out" || fail "score with $a must be refused (rc 2): $(head -n 1 "$TEST_TMP/sc.out")"
  echo "  score-fbatch-v3.js $a: refused (rc 2): $(head -n 1 "$TEST_TMP/sc.out")"
done
rc=0; clean node "$CP/score-fbatch-v3.js" --prereg "$TEST_TMP/prereg-copy-scan.json" --results "$TEST_TMP/pass.jsonl" > "$TEST_TMP/sc.out" 2>&1 < /dev/null || rc=$?
[ "$rc" = 2 ] || fail "score with another prereg file must be refused"
echo "  score-fbatch-v3.js --prereg <copy>: refused (rc 2)"
# a short grid (3 reps) under the prereg's reps = 5 is INCOMPLETE (exit 3), never PASS
node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map((l)=>JSON.parse(l)).filter((r)=>r.rep<=3);fs.writeFileSync(process.argv[2],rows.map((r)=>JSON.stringify(r)).join("\n")+"\n")' "$TEST_TMP/pass.jsonl" "$TEST_TMP/short.jsonl"
rc=0; clean node "$CP/score-fbatch-v3.js" --prereg "$CP/prereg/findings-batch-v3.json" --results "$TEST_TMP/short.jsonl" > "$TEST_TMP/sc.out" 2>&1 < /dev/null || rc=$?
[ "$rc" = 3 ] && grep -q '^findings-batch-v3: INCOMPLETE' "$TEST_TMP/sc.out" || fail "a 3-rep grid must score INCOMPLETE (rc 3), got rc=$rc: $(head -n 1 "$TEST_TMP/sc.out")"
echo "  3-rep grid: INCOMPLETE (exit 3)"
SCM="$CP/score-fbatch-v3.reps-mutant.js"
sed -e "/^if (val('--reps') !== undefined/d" -e "s/^const reps = P.reps;/const reps = val('--reps') !== undefined ? Number(val('--reps')) : P.reps;/" "$CP/score-fbatch-v3.js" > "$SCM"
cmp -s "$SCM" "$CP/score-fbatch-v3.js" && fail "scorer mutant is identical"
SCORER=score-fbatch-v3.reps-mutant.js
neg "a scorer that takes --reps 3 from the command line accepts it (rc not 2)" test "$(scorerc --reps 3)" = 2
SCORER=score-fbatch-v3.js
rm -f "$SCM"

echo "=== no landing timer started by this test is still alive ==="
for i in $(seq 1 20); do [ -z "$(land_pids "$TEST_TMP")" ] && break; sleep 0.25; done
left=$(land_pids "$TEST_TMP" | tr '\n' ' ')
[ -z "$left" ] || fail "landing timers started by this test are still alive: $left"
echo "findings-batch-v3 tests passed"
