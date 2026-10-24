#!/usr/bin/env bash
# tmp-residue-prune.test.sh — KR4 of docs/plans/_archive/2026/10/2026-10-12-tmp-residue-containment.md: the daily
# temp-root prune that rides on `repo-residue-sweep.js reap --auto` actually fires, and only on
# what the registry allows.
#   case 1: the sweep's receipt lists exactly the aged scratch entry; fresh scratch, an aged
#           live-kind dir, an aged dir holding .autopilot-live.lock, an aged dir whose
#           .autopilot-owner pid is alive, an aged symlink, an aged test-lockgated dir and an
#           aged unregistered dir are all kept
#   case 2: a second call inside 24 h reports tmp_prune.skipped = "throttled"
#   case 3: both opt-outs (env, config) report "disabled" and leave the host stamp unclaimed
#   case 4: CLI rules — evidence keeps 14 days, dead / reused-pid owners are pruned, retention 0
#           disables, --days never prunes earlier than the entry's own retention
#   case 5: negative controls on a mutated copy of the CLI: ignoring .autopilot-owner deletes the
#           live-owner dir, accepting `live` deletes the live dir (each must be caught)
. "$(dirname "$0")/lib.sh"

SWEEP="$REPO_ROOT/scripts/repo-residue-sweep.js"
CLI="$REPO_ROOT/scripts/lib/tmp-residue.js"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.autopilot"
unset AUTOPILOT_RESIDUE_TMP_PRUNE AUTOPILOT_RESIDUE_AUTO_REAP AUTOPILOT_TMP_LOG_RETENTION_DAYS

REPO="$TEST_TMP/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q -b develop
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

FX="$TEST_TMP/fx-tmp"; XDG="$TEST_TMP/xdg"; mkdir -p "$FX" "$XDG"
OLD='10 days ago'
age() { touch -h -d "$2" "$1"; }

# Sleeper = the owner whose pid must count as alive. start_time derived independently of the code under test.
sleep 600 & SLEEPER=$!
trap 'kill "$SLEEPER" 2>/dev/null; true' EXIT
START="$(sed 's/.*) //' "/proc/$SLEEPER/stat" | cut -d' ' -f20)"
assert_neq "$START" "" "setup: sleeper start_time read from /proc/<pid>/stat field 22"

mkdir -p "$FX/dispatch-review-log-OLD" ; : > "$FX/dispatch-review-log-OLD/log"; age "$FX/dispatch-review-log-OLD" "$OLD"
mkdir -p "$FX/dispatch-review-log-FRESH"
mkdir -p "$FX/autopilot-dispatch-runs"; age "$FX/autopilot-dispatch-runs" "$OLD"
mkdir -p "$FX/dispatch-author-LOCKED"; : > "$FX/dispatch-author-LOCKED/.autopilot-live.lock"; age "$FX/dispatch-author-LOCKED" "$OLD"
mkdir -p "$FX/autopilot-review-loop-LIVEOWNER"
printf '{"pid":%s,"start_time":%s}\n' "$SLEEPER" "$START" > "$FX/autopilot-review-loop-LIVEOWNER/.autopilot-owner"
age "$FX/autopilot-review-loop-LIVEOWNER" "$OLD"
mkdir -p "$TEST_TMP/elsewhere"; ln -s "$TEST_TMP/elsewhere" "$FX/dispatch-explore-LINK"; age "$FX/dispatch-explore-LINK" "$OLD"
mkdir -p "$FX/apl1.AGED"; age "$FX/apl1.AGED" "$OLD"
mkdir -p "$FX/sessions"; age "$FX/sessions" "$OLD"
mkdir -p "$FX/never-heard-of-it.Qq"; age "$FX/never-heard-of-it.Qq" "$OLD"

jget() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=eval(process.argv[1]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v));})' "$2"; }
sweep() { # sweep <xdg> [env assignments...] — one auto sweep against the fixture repo + fixture temp root
  local xdg="$1"; shift
  env -u AUTOPILOT_RESIDUE_TMP_PRUNE XDG_RUNTIME_DIR="$xdg" "$@" node "$SWEEP" reap --auto --yes --repo "$REPO" --tmpdir "$FX" --json
}

# ── Case 1: the first call fires and deletes exactly the aged scratch entry ──
OUT="$(sweep "$XDG")"
assert_eq "$(jget "$OUT" 'j.tmp_prune.deleted')" '["dispatch-review-log-OLD"]' "case1: tmp_prune.deleted lists exactly the aged scratch entry"
assert_file_absent "$FX/dispatch-review-log-OLD" "case1: aged scratch entry is gone"
assert_file_exists "$FX/dispatch-review-log-FRESH" "case1: fresh scratch entry kept"
assert_file_exists "$FX/autopilot-dispatch-runs" "case1: aged live-kind dir kept"
assert_file_exists "$FX/dispatch-author-LOCKED" "case1: aged dir holding .autopilot-live.lock kept"
assert_file_exists "$FX/autopilot-review-loop-LIVEOWNER" "case1: aged scratch dir whose .autopilot-owner pid is alive kept"
assert_file_exists "$FX/dispatch-explore-LINK" "case1: aged symlink kept"
assert_file_exists "$TEST_TMP/elsewhere" "case1: symlink target untouched"
assert_file_exists "$FX/apl1.AGED" "case1: aged test-lockgated dir kept (age-only deletion never acts on it)"
assert_file_exists "$FX/sessions" "case1: aged external sessions dir kept"
assert_file_exists "$FX/never-heard-of-it.Qq" "case1: aged unregistered dir kept"
assert_eq "$(jget "$OUT" 'j.tmp_prune.kept.filter(k=>k.name==="autopilot-review-loop-LIVEOWNER").map(k=>k.why)')" '["owner_alive"]' "case1: receipt says why the live-owner dir was kept"
assert_file_exists "$XDG/autopilot-tmp-prune.stamp" "case1: host stamp written under XDG_RUNTIME_DIR"
assert_file_exists "$(dirname "$REPO/.git")/.git/autopilot-residue-auto.json" "case1: result file written"
assert_eq "$(jget "$(cat "$REPO/.git/autopilot-residue-auto.json")" 'j.tmp_prune.deleted')" '["dispatch-review-log-OLD"]' "case1: the receipt is also in the result file the hook reads"

# ── Case 2: second call inside 24 h is throttled ──
mkdir -p "$FX/dispatch-review-log-OLD2"; age "$FX/dispatch-review-log-OLD2" "$OLD"
OUT="$(sweep "$XDG")"
assert_eq "$(jget "$OUT" 'j.tmp_prune.skipped')" "throttled" "case2: second call within 24 h is throttled"
assert_file_exists "$FX/dispatch-review-log-OLD2" "case2: throttled call deletes nothing"
touch -d '25 hours ago' "$XDG/autopilot-tmp-prune.stamp"
OUT="$(sweep "$XDG")"
assert_eq "$(jget "$OUT" 'j.tmp_prune.deleted')" '["dispatch-review-log-OLD2"]' "case2: a 25 h-old stamp runs again"

# ── Case 3: opt-outs ──
XDG2="$TEST_TMP/xdg2"; mkdir -p "$XDG2"
mkdir -p "$FX/dispatch-review-log-OLD3"; age "$FX/dispatch-review-log-OLD3" "$OLD"
OUT="$(sweep "$XDG2" AUTOPILOT_RESIDUE_TMP_PRUNE=0)"
assert_eq "$(jget "$OUT" 'j.tmp_prune.skipped')" "disabled" "case3: AUTOPILOT_RESIDUE_TMP_PRUNE=0 gives skipped=disabled"
assert_file_exists "$FX/dispatch-review-log-OLD3" "case3: env opt-out deletes nothing"
assert_file_absent "$XDG2/autopilot-tmp-prune.stamp" "case3: env opt-out does not claim the stamp"
HOME2="$TEST_TMP/home2"; mkdir -p "$HOME2/.autopilot"
printf '{"residue":{"tmp_prune":false}}\n' > "$HOME2/.autopilot/config.json"
OUT="$(sweep "$XDG2" HOME="$HOME2" AUTOPILOT_CONFIG_FILE="$HOME2/.autopilot/config.json")"
assert_eq "$(jget "$OUT" 'j.tmp_prune.skipped')" "disabled" "case3: residue.tmp_prune=false gives skipped=disabled"
assert_file_exists "$FX/dispatch-review-log-OLD3" "case3: config opt-out deletes nothing"
assert_file_absent "$XDG2/autopilot-tmp-prune.stamp" "case3: config opt-out does not claim the stamp"

# ── Case 4: CLI rules ──
C4="$TEST_TMP/c4"; mkdir -p "$C4"
mkdir -p "$C4/autopilot-kimi-raw-5d" "$C4/autopilot-kimi-raw-20d"
age "$C4/autopilot-kimi-raw-5d" '5 days ago'; age "$C4/autopilot-kimi-raw-20d" '20 days ago'
mkdir -p "$C4/autopilot-repair-prompt-DEADOWN"
printf '{"pid":2147483000,"start_time":1}\n' > "$C4/autopilot-repair-prompt-DEADOWN/.autopilot-owner"; age "$C4/autopilot-repair-prompt-DEADOWN" "$OLD"
mkdir -p "$C4/autopilot-repair-prompt-REUSED"
printf '{"pid":%s,"start_time":%s}\n' "$SLEEPER" "$((START + 1))" > "$C4/autopilot-repair-prompt-REUSED/.autopilot-owner"; age "$C4/autopilot-repair-prompt-REUSED" "$OLD"
mkdir -p "$C4/dispatch-consult-2d"; age "$C4/dispatch-consult-2d" '2 days ago'
mkdir -p "$C4/dispatch-consult-12h"; age "$C4/dispatch-consult-12h" '12 hours ago'
: > "$C4/claude-edited-sess"; age "$C4/claude-edited-sess" '5 days ago'
OUT="$(node "$CLI" prune --tmpdir "$C4")"
assert_eq "$(jget "$OUT" 'j.deleted.sort()')" '["autopilot-kimi-raw-20d","autopilot-repair-prompt-DEADOWN","autopilot-repair-prompt-REUSED","claude-edited-sess","dispatch-consult-2d"]' "case4: per-entry retention (14 d evidence, 1 d consult, 3 d counters), dead and reused-pid owners pruned"
assert_file_exists "$C4/autopilot-kimi-raw-5d" "case4: evidence younger than 14 days kept"
assert_file_exists "$C4/dispatch-consult-12h" "case4: consult scratch younger than 1 day kept"
OUT="$(AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 node "$CLI" prune --tmpdir "$C4")"
assert_eq "$(jget "$OUT" 'j.skipped')" "retention_disabled" "case4: AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 disables the prune"
C4B="$TEST_TMP/c4b"; mkdir -p "$C4B/dispatch-consult-2d" "$C4B/dispatch-review-log-4d"
age "$C4B/dispatch-consult-2d" '2 days ago'; age "$C4B/dispatch-review-log-4d" '4 days ago'
OUT="$(node "$CLI" prune --tmpdir "$C4B" --days 3)"
assert_eq "$(jget "$OUT" 'j.deleted')" '["dispatch-review-log-4d"]' "case4: --days 3 never prunes earlier than the caller asked (2-day consult dir kept)"

# ── Case 5: negative controls — a mutated copy of the CLI must be caught by the same fixture ──
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp "$CLI" "$MUT/tmp-residue.js"; cp "$REPO_ROOT/scripts/lib/tmp-residue-registry.json" "$MUT/"
mutant_deleted() { # <sed expr> → names the mutated CLI deletes from a fresh fixture
  local m="$TEST_TMP/mutfx"; rm -rf "$m"; mkdir -p "$m/autopilot-dispatch-runs" "$m/autopilot-review-loop-LIVEOWNER"
  printf '{"pid":%s,"start_time":%s}\n' "$SLEEPER" "$START" > "$m/autopilot-review-loop-LIVEOWNER/.autopilot-owner"
  age "$m/autopilot-dispatch-runs" "$OLD"; age "$m/autopilot-review-loop-LIVEOWNER" "$OLD"
  cp "$CLI" "$MUT/tmp-residue.js"
  if [ "$1" = 's/@@NO-SUCH-TEXT@@//' ]; then
    sed -i "$1" "$MUT/tmp-residue.js"   # mutation-anchor: intentional-miss (baseline: the unmutated copy must keep both)
  else
    sed_mutate "$MUT/tmp-residue.js" "$1"
  fi
  node "$MUT/tmp-residue.js" prune --tmpdir "$m" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).deleted.join(",")))'
}
assert_eq "$(mutant_deleted 's/@@NO-SUCH-TEXT@@//')" "" "case5: control baseline (unmutated copy) keeps both"
assert_eq "$(mutant_deleted "s/if (ownerAlive(full)) {/if (false) {/")" "autopilot-review-loop-LIVEOWNER" "case5: ignoring .autopilot-owner deletes the live-owner dir (the keep rule is what protects it)"
assert_eq "$(mutant_deleted "s/^const AGE_DELETABLE = Object.freeze(\['scratch', 'evidence'\]);/const AGE_DELETABLE = Object.freeze(['scratch', 'evidence', 'live']);/")" "autopilot-dispatch-runs" "case5: accepting the live kind deletes the live dir (the kind filter is what protects it)"

finalize_test "tmp-residue-prune"
