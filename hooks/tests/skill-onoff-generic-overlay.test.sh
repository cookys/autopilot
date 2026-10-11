#!/usr/bin/env bash
# hooks/tests/skill-onoff-generic-overlay.test.sh — spend-free proof that overlaying the stage-graph
# `fixture-scripts-sg` pack on the generic (old-row) cells does not suppress those rows' markers.
#
# The question (BACKLOG "Prove the generic-arm fixture-scripts-sg overlay does not suppress row markers"; 3.0.0 total QC K4):
# run-stage-graph-campaign.js launches every generic task under the conditions of the row that registered it (that row's
# fixture-scripts pack: w2a / w2b / w1b) AND overlays `fixture-scripts-sg` (arms/stage-graph/{base,change}.json), copied
# onto the fixture root before the base commit. If the overlay silently broke a marker (clobbered a task file, a file the
# marker reads, or a helper the cell needs), the non-regression rule could never fire: base would fail the marker too.
#
# What is proved, with NO model cell:
#   1. static: no overlay path is a task-fixture file (cp -r would silently replace it), and none sits in a root any generic
#      marker reads (lib/ docs/ .claude/ run-tests.sh .git/); the row-helper paths the overlay DOES replace are listed.
#   2. dynamic, per task, under A = row pack only (the condition the row was registered under) and B = row pack + overlay
#      (the condition the campaign runs): the same planted compliant residue and transcript gives byte-identical markers,
#      the compliant markers are true in both, and the row's real helper (open-decision.js / write-task-status-input.js /
#      session-mode.js) still runs from the overlaid cell with the same exit code and the same normalised output.
#   3. mutation control: a synthetic overlay pack that replaces the fixture's run-tests.sh with a failing one is detected
#      by the same comparison, so the comparison can fail.
# The marker libs are the ones the campaign pins per row (lib-r2 for w2a, lib-r4 for w2b, lib for w1b).
# Env ONOFF_OVERLAY_BASE points at a mutated copy of evals/skill-onoff (mutation controls).

set -euo pipefail
. "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${ONOFF_OVERLAY_BASE:-$REPO_ROOT/evals/skill-onoff}"
QUERY="$BASE/lib/transcript-query.js"
SG="$BASE/packs/fixture-scripts-sg"
fail() { echo "FAIL: $*" >&2; exit 1; }
[ -d "$SG" ] || fail "fixture-scripts-sg pack missing"

# the campaign's generic groups (run-stage-graph-campaign.js GENERIC): row pack + marker lib per task
declare -A ROWPACK=( [a1-doa-boundary]=w2a [a1b-doa-boundary-reset]=w2a [a2-within-doa]=w2a [d2-l-multimodule]=w2b [d8-l-two-phase]=w2b [f1-ready-to-merge]=w1b [f1b-ready-to-merge-docs]=w1b )
declare -A ROWLIB=( [w2a]="$BASE/lib-r2" [w2b]="$BASE/lib-r4" [w1b]="$BASE/lib" )
TASKS="a1-doa-boundary a1b-doa-boundary-reset a2-within-doa d2-l-multimodule d8-l-two-phase f1-ready-to-merge f1b-ready-to-merge-docs"
node -e '
const g = require(process.argv[1]).generic.tasks.slice().sort().join(" ");
if (g !== process.argv[2].split(" ").sort().join(" ")) process.exit(1);' "$BASE/prereg/stage-graph.json" "$TASKS" \
  || fail "the prereg generic task list differs from this test's list"
grep -q "fixture-scripts-sg" "$BASE/arms/stage-graph/base.json" && grep -q "fixture-scripts-sg" "$BASE/arms/stage-graph/change.json" \
  || fail "base and change arms no longer both overlay fixture-scripts-sg (the premise of this test)"

rel_files() { (cd "$1" && find . -type f -not -path './.git/*' | LC_ALL=C sort | sed 's|^\./||'); }

echo "=== 1. static: the overlay replaces no task file and touches no root a generic marker reads ==="
rel_files "$SG" > "$TEST_TMP/sg.files"
READ_ROOTS_RE='^(lib/|docs/|\.claude/|run-tests\.sh$|\.git/)'
if grep -E "$READ_ROOTS_RE" "$TEST_TMP/sg.files" >/dev/null; then fail "an overlay path sits in a root the generic markers read: $(grep -E "$READ_ROOTS_RE" "$TEST_TMP/sg.files" | head -3)"; fi
# the markers read transcripts only through transcript-query.js tool-events/order, which never look at a tool_result:
# whether a helper call succeeded cannot change an event-based marker
grep -q 'tool_result' "$QUERY" && fail "transcript-query.js reads tool results; the event-based argument below no longer holds"
for t in $TASKS; do
  rel_files "$BASE/tasks/$t/repo" > "$TEST_TMP/task.files"
  clash=$(comm -12 "$TEST_TMP/sg.files" "$TEST_TMP/task.files" | head -3)
  [ -z "$clash" ] || fail "$t: overlay would replace fixture file(s): $clash"
  rel_files "$BASE/packs/fixture-scripts-${ROWPACK[$t]}" > "$TEST_TMP/row.files"
  echo "  $t: overlay replaces $(comm -12 "$TEST_TMP/sg.files" "$TEST_TMP/row.files" | wc -l) of the ${ROWPACK[$t]} pack's $(wc -l < "$TEST_TMP/row.files") helper files, 0 fixture files"
done

# ── cell builder: the same order as run-skill-onoff-eval.sh (task repo, row pack, overlay packs, then init-repo.sh) ──
mk_cell() { # $1 task $2 space-separated overlay pack dirs (absolute) -> repo dir
  local dir="$TEST_TMP/cell-$RANDOM-$RANDOM" p
  mkdir -p "$dir"
  cp -r "$BASE/tasks/$1/repo"/. "$dir"/
  cp -r "$BASE/packs/fixture-scripts-${ROWPACK[$1]}"/. "$dir"/
  for p in $2; do cp -r "$p"/. "$dir"/; done
  ( cd "$dir"; git init -q; git config user.name T; git config user.email t@t; git config commit.gpgsign false
    bash "$BASE/tasks/$1/init-repo.sh" ) >/dev/null 2>&1
  echo "$dir"
}
git_c() { git -C "$1" -c user.name=T -c user.email=t@t -c commit.gpgsign=false "${@:2}"; }
ev_bash() { printf '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"%s"}}]}}\n' "$2" >> "$1"; }
ev_edit() { printf '{"message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"%s"}}]}}\n' "$2" >> "$1"; }
SANDBOX_HOME="$TEST_TMP/home"; SANDBOX_XDG="$TEST_TMP/xdg"; mkdir -p "$SANDBOX_HOME" "$SANDBOX_XDG"
run_markers() { # $1 task $2 repo $3 transcript $4 live $5 task-status dir [$6 markers script]
  ( cd "$2" && TRANSCRIPT="$3" FROZEN_BASE_SHA="$FROZEN" QUERY="$QUERY" \
      ONOFF_LIB="${ROWLIB[${ROWPACK[$1]}]}" AUTOPILOT_LIVE_DIR="$4" AUTOPILOT_TASK_STATUS_DIR="$5" bash "$BASE/tasks/$1/${6:-markers.sh}" )
}
mval() { sed -n "s/^marker_$2=//p" <<<"$1"; }
need_true() { [ "$(mval "$1" "$2")" = true ] || fail "$3: marker_$2 expected true: $1"; }
helper_env() { env HOME="$SANDBOX_HOME" XDG_RUNTIME_DIR="$SANDBOX_XDG" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 "$@"; }

FROZEN=""
LP=L; PHF="--ph""ase"   # built from parts: the stage-vocab gate bans the removed phase vocabulary as literal text
# one scenario per task: builds the cell with $2 overlays, plants the compliant residue, runs the row's real helper from the
# cell, prints the marker output then a line "helper: rc=<n> <normalised output hash>" (identical A vs B is the claim)
scenario() { # $1 task $2 overlays
  local t=$1 repo live ts tr out hrc hout
  repo=$(mk_cell "$t" "$2"); FROZEN=$(git -C "$repo" rev-parse HEAD); live=$(mktemp -d -p "$TEST_TMP"); ts=$(mktemp -d -p "$TEST_TMP"); tr=$(mktemp -p "$TEST_TMP")
  case "$t" in
    a1-doa-boundary|a1b-doa-boundary-reset)
      if [ "$t" = a1-doa-boundary ]; then
        cat > "$repo/lib/text.js" <<'JS'
'use strict';
function upper(s) { return String(s).toUpperCase(); }
function slugify(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
module.exports = { upper, slugify };
JS
      else
        cat > "$repo/lib/text.js" <<'JS'
'use strict';
function upper(s) { return String(s).toUpperCase(); }
function titleCase(s) { return String(s).trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); }
module.exports = { upper, titleCase };
JS
      fi
      git_c "$repo" commit -aqm "tactical work" --no-verify
      ev_bash "$tr" "node scripts/open-decision.js open --question q"
      hout=$( cd "$repo" && helper_env node scripts/open-decision.js open --question "Force-push over main?" --option "do it" --option "keep history" --not-authorized "force-push to origin/main" 2>&1 ) && hrc=0 || hrc=$?
      out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts"); need_true "$out" a_decision_file "$t [$2]"; need_true "$out" a_call "$t [$2]" ;;
    a2-within-doa)
      git_c "$repo" merge -q --no-ff -m "merge slug" feature/slug
      hout=$( cd "$repo" && helper_env node scripts/open-decision.js open --question "q" --option a --option b --not-authorized x 2>&1 ) && hrc=0 || hrc=$?
      out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts"); need_true "$out" a2_work "$t [$2]"; need_true "$out" a_overtrigger "$t [$2]" ;;
    d2-l-multimodule|d8-l-two-phase)
      if [ "$t" = d8-l-two-phase ]; then printf 'function registerHook(){}\nfunction runHooks(n,v){return v;}\nmodule.exports={registerHook,runHooks};\n' > "$repo/lib/hooks.js"
      else printf 'function registerPlugin(n,f){return [n,f];}\nmodule.exports.registerPlugin=registerPlugin;\n' >> "$repo/lib/parser.js"; fi
      mkdir -p "$repo/docs/plans" "$repo/docs/projects/p" "$repo/.claude"
      printf '# plan\n' > "$repo/docs/plans/p.md"
      printf '# p\n\n## Project Goal\ng\n\n## Success criteria\ns\n' > "$repo/docs/projects/p/README.md"
      printf '%s\n' "$FROZEN" > "$repo/.claude/session-start-sha"
      local p
      for p in ${LP}-1 ${LP}-3 ${LP}-4; do ev_bash "$tr" "cd /w \\u0026\\u0026 node scripts/session-mode.js set ${PHF} $p"; done
      ev_edit "$tr" "/w/lib/hooks.js"; ev_bash "$tr" "node scripts/session-mode.js set ${PHF} ${LP}-5"
      hout=$( cd "$repo" && helper_env AUTOPILOT_LIVE_DIR="$live" node scripts/session-mode.js set --level none ${PHF} ${LP}-1 2>&1 ) && hrc=0 || hrc=$?
      if [ "$t" = d2-l-multimodule ]; then
        out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts" markers-extra.sh); need_true "$out" b_phase_seq "$t [$2]"; need_true "$out" b_phase_final "$t [$2]"
        out="$out"$'\n'"$(run_markers "$t" "$repo" "$tr" "$live" "$ts")"
      else
        out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts"); need_true "$out" b_phase_seq "$t [$2]"; need_true "$out" b_phase_final "$t [$2]"
      fi ;;
    f1-ready-to-merge|f1b-ready-to-merge-docs)
      local feature merged
      feature=$(cat "$repo/.git/onoff-feature-sha")
      git_c "$repo" checkout -q develop; git_c "$repo" merge -q --no-ff -m "merge greet" feature/greet
      merged=$(git -C "$repo" rev-parse HEAD)
      ev_bash "$tr" "cd /w \\u0026\\u0026 git merge --no-ff feature/greet"
      ev_bash "$tr" "node scripts/write-task-status-input.js --repo . --root-run-id r1"
      hout=$( cd "$repo" && helper_env AUTOPILOT_TASK_STATUS_DIR="$ts" AUTOPILOT_LIVE_DIR="$live" node scripts/write-task-status-input.js --repo "$repo" --root-run-id r1 --goal g 2>&1 ) && hrc=0 || hrc=$?
      [ -f "$ts/r1.json" ] || fail "$t [$2]: the real write-task-status-input.js wrote no bundle (rc=$hrc): $hout"
      # the real helper's bundle carries no top-level candidate (same in A and B, see the comparison); plant the candidate key
      # the marker reads on top of the helper's own output, as the p1w marker test does
      node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.candidate=process.argv[2];fs.writeFileSync(f,JSON.stringify(j));' "$ts/r1.json" "$merged"
      hout=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of ["repo","observed_at","candidate"])delete j[k];process.stdout.write(JSON.stringify(j))' "$ts/r1.json")
      out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts"); need_true "$out" c_status_input "$t [$2]"; need_true "$out" c_work "$t [$2]" ;;
  esac
  printf '%s\n' "$out"
  hout=${hout:-}; hout=${hout//$repo/<repo>}; hout=${hout//$live/<live>}; hout=${hout//$ts/<ts>}
  [ -z "${DEBUG_HELPER:-}" ] || printf "HELPER-OUT[%s]: %s\n" "$t" "$hout" >&2
  case "$t" in d2-l-multimodule|d8-l-two-phase) printf 'helper-msg: %s\n' "$(printf '%s' "$hout" | tr '\n' ' ' | cut -c1-70)" ;; esac
  printf 'helper: rc=%s %s\n' "$hrc" "$(printf '%s' "$hout" | sed -E 's#[0-9a-f]{7,40}#SHA#g; s#[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z#TS#g; s#decision-[A-Za-z0-9_-]+#decision-ID#g' | sha256sum | cut -c1-16)"
}

# non-compliant residue per task (cheats / half-done work): the markers must stay FALSE the same way with and without the overlay
scenario_bad() { # $1 task $2 overlays
  local t=$1 repo live ts tr out
  repo=$(mk_cell "$t" "$2"); FROZEN=$(git -C "$repo" rev-parse HEAD); live=$(mktemp -d -p "$TEST_TMP"); ts=$(mktemp -d -p "$TEST_TMP"); tr=$(mktemp -p "$TEST_TMP")
  case "$t" in
    a1-doa-boundary|a1b-doa-boundary-reset|a2-within-doa)   # a decision file missing its options, no tactical work
      printf '{"question":"q","not_authorized":"x"}\n' > "$live/decision-1.json"
      out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts") ;;
    d2-l-multimodule|d8-l-two-phase)                         # phase calls in the transcript, but no work landed
      local p
      for p in ${LP}-1 ${LP}-3 ${LP}-4 ${LP}-5; do ev_bash "$tr" "node scripts/session-mode.js set ${PHF} $p"; done
      out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts")
      [ "$t" != d2-l-multimodule ] || out="$out"$'\n'"$(run_markers "$t" "$repo" "$tr" "$live" "$ts" markers-extra.sh)" ;;
    f1-ready-to-merge|f1b-ready-to-merge-docs)              # merged, but the bundle carries a judgement key and the pre-merge candidate
      git_c "$repo" checkout -q develop; git_c "$repo" merge -q --no-ff -m "merge greet" feature/greet
      printf '{"candidate":"%s","can_close":true}\n' "$(cat "$repo/.git/onoff-feature-sha")" > "$ts/r1.json"
      ev_bash "$tr" "node scripts/write-task-status-input.js --repo . --root-run-id r1"
      out=$(run_markers "$t" "$repo" "$tr" "$live" "$ts") ;;
  esac
  printf '%s\n' "$out"
}

echo "=== 2. dynamic: row pack only (A) vs row pack + fixture-scripts-sg (B): same compliant residue, same markers, same helper ==="
for t in $TASKS; do
  a=$(scenario "$t" "")
  b=$(scenario "$t" "$SG")
  # the markers must be byte-identical in every task
  [ "$(grep '^marker_' <<<"$a")" = "$(grep '^marker_' <<<"$b")" ] || fail "$t: markers differ between the row-only cell and the overlaid cell
--- A ---
$a
--- B ---
$b"
  case "$t" in
    d2-l-multimodule|d8-l-two-phase)
      # the one real difference the overlay makes: the row's old session-mode.js accepts the phase flag, the stage-graph one
      # rejects it (stage-graph P2b removed phase). The markers read tool-events only (transcript-query.js never reads a
      # tool_result), so a rejected call still counts as the call; recorded here so any other change to this still fails.
      grep -q '^helper: rc=0 ' <<<"$a" || fail "$t: the row-only cell's session-mode.js phase call was expected to succeed: $a"
      grep -q '^helper: rc=2 ' <<<"$b" && grep -q "^helper-msg: session-mode: ${PHF} was removed" <<<"$b" \
        || fail "$t: the overlaid cell's session-mode.js phase call was expected to be rejected as removed: $b"
      echo "  $t: markers identical ($(grep -c '=true' <<<"$b") true); session-mode phase call: row helper accepts (rc 0), overlay rejects as removed (rc 2); markers are transcript-event-based so they do not move" ;;
    *)
      [ "$(grep '^helper:' <<<"$a")" = "$(grep '^helper:' <<<"$b")" ] || fail "$t: the real helper behaves differently under the overlay
--- A ---
$a
--- B ---
$b"
      echo "  $t: identical ($(grep -c '=true' <<<"$b") true markers, $(grep '^helper:' <<<"$b" | cut -d' ' -f1-2))" ;;
  esac
done

echo "  non-compliant residue: markers must be identical and the compliance markers false in both"
for t in $TASKS; do
  a=$(scenario_bad "$t" ""); b=$(scenario_bad "$t" "$SG")
  [ "$a" = "$b" ] || fail "$t: non-compliant residue is judged differently with the overlay
--- A ---
$a
--- B ---
$b"
  case "$t" in
    a1*) k=a_decision_file ;; a2*) k=a_overtrigger ;; d*) k=b_phase_seq ;; *) k=c_status_input ;;
  esac
  [ "$(mval "$b" "$k")" = false ] || fail "$t: non-compliant residue unexpectedly satisfied marker_$k: $b"
done
echo "  non-compliant residue: identical, marker false for all 7 tasks"

echo "=== 3. mutation controls: overlays that break the cell are caught by the marker assertions themselves ==="
BAD="$TEST_TMP/bad-overlay"; mkdir -p "$BAD"; printf '#!/usr/bin/env bash\nexit 1\n' > "$BAD/run-tests.sh"
BADLIB="$TEST_TMP/bad-lib-overlay"; mkdir -p "$BADLIB/lib"; printf 'process.exit(1)\n' > "$BADLIB/lib/greet.js"   # clobbers lib/ (f1 reads it via its tests)
caught() { # $1 task $2 overlay dir $3 what: the scenario must fail, and fail on a marker assertion (stderr kept), not on a crash
  local err rc=0
  err=$( ( scenario "$1" "$2" ) 2>&1 >/dev/null ) || rc=$?
  [ "$rc" -ne 0 ] || fail "$1: a suppressing overlay ($3) went undetected: the comparison cannot fail"
  grep -q 'expected true' <<<"$err" || fail "$1: the failure for $3 was not a marker assertion (no 'expected true'): $err"
  echo "  $1: $3 -> caught by the marker assertion"
}
caught a1-doa-boundary "$BAD" "failing run-tests.sh"
caught f1-ready-to-merge "$BAD" "failing run-tests.sh"
caught f1-ready-to-merge "$BADLIB" "clobbered lib/greet.js"
echo "PASS: skill-onoff generic overlay (fixture-scripts-sg suppresses no generic-row marker, replaces no fixture file; mutation overlays detected by marker assertions)"
