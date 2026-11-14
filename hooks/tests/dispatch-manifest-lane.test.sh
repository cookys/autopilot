#!/usr/bin/env bash
# The run manifest of every dispatch rail records `lane`: $AUTOPILOT_LANE, else the `Lane:` field in the first 8
# lines of the brief (header form `Engine: x | Role: y | Lane: slug | Size: S` or one field per line), else null.
# A slug outside ^[a-z0-9][a-z0-9._-]{0,63}$ is null. Seam: run the rails end to end with a stub grok runner.
# RED on the base (rails wrote no `lane` key): every mf_get below returned '<absent>'.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
# Live dir must be tmpfs and mode 0700 or live-state-dir.js ignores it (see manifest-repo-identity.test.sh).
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-mlane-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_GROK_EFFORT_PROBE=0 DISPATCH_QUIET=1
unset AUTOPILOT_LANE AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
LIB="$REPO_ROOT/scripts/lib/dispatch-lane.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base

GROK_STUB="$TEST_TMP/grok-stub"
cat > "$GROK_STUB" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then printf 'Available models\n\ngrok-4.5 - Grok 4.5\n'; exit 0; fi
case " $* " in *" __autopilot_probe__ "*)
  echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2; exit 1 ;;
esac
exit 0
EOS
chmod +x "$GROK_STUB"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"
mf_get() { node -e '
  const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const k = process.argv[2];
  if (!(k in o)) process.stdout.write("<absent>"); else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));' "$1" "$2"; }
one_manifest() { find "$1" -name '*.manifest.json' | head -1; }
brief() { printf '%b' "$2" > "$TEST_TMP/$1"; echo "$TEST_TMP/$1"; }

run_rail() { # <rail> <brief> <runsdir> [env assignments...] -> prints manifest lane
  local rail="$1" pf="$2" runs="$3"; shift 3
  mkdir -p "$runs"
  case "$rail" in
    hetero) ( cd "$SBX" && timeout 60 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" "$HETERO" --runner grok --model grok-4.5 --effort high \
              --grok-bin "$GROK_STUB" --branch "feat/lane-$RANDOM" --prompt-file "$pf" >/dev/null 2>&1 ) || true ;;
    author) ( cd "$SBX" && timeout 60 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" "$AUTHOR" --runner grok --model grok-4.5 \
              --prompt-file "$pf" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true ;;
    review) ( cd "$SBX" && timeout 60 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" "$REVIEW" --runner grok --model grok-4.5 \
              --diff-file "$DIFF" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true ;;
  esac
  local mf; mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { echo "<no-manifest>"; return; }
  mf_get "$mf" lane
}

HDR="$(brief hdr.txt 'Engine: sonnet | Role: implementer | Lane: autopilot-pool-shift | Size: S\n\ncreate ok.txt\n')"
LINES="$(brief lines.txt 'Engine: sonnet\nRole: implementer\nLane: game.lead-2\nSize: S\n\ncreate ok.txt\n')"
BAD="$(brief bad.txt 'Engine: sonnet | Lane: Bad Lane! | Size: S\n\ncreate ok.txt\n')"
NONE="$(brief none.txt 'create ok.txt\n')"
LATE="$(brief late.txt 'a\nb\nc\nd\ne\nf\ng\nh\nLane: too-late\n')"

for rail in hetero author; do
  eq "autopilot-pool-shift" "$(run_rail $rail "$HDR" "$TEST_TMP/r-$rail-hdr")" "$rail: header form"
  eq "game.lead-2" "$(run_rail $rail "$LINES" "$TEST_TMP/r-$rail-lines")" "$rail: one field per line"
  eq "envlane" "$(run_rail $rail "$HDR" "$TEST_TMP/r-$rail-env" AUTOPILOT_LANE=envlane)" "$rail: AUTOPILOT_LANE beats the brief"
  eq "<null>" "$(run_rail $rail "$BAD" "$TEST_TMP/r-$rail-bad")" "$rail: bad slug in brief -> null"
  eq "<null>" "$(run_rail $rail "$HDR" "$TEST_TMP/r-$rail-badenv" 'AUTOPILOT_LANE=Bad Env')" "$rail: bad slug in env -> null"
  eq "<null>" "$(run_rail $rail "$NONE" "$TEST_TMP/r-$rail-none")" "$rail: no lane anywhere -> null"
  eq "<null>" "$(run_rail $rail "$LATE" "$TEST_TMP/r-$rail-late")" "$rail: Lane: past line 8 is ignored"
done
eq "envlane" "$(run_rail review "$NONE" "$TEST_TMP/r-review-env" AUTOPILOT_LANE=envlane)" "review: AUTOPILOT_LANE recorded"
eq "<null>" "$(run_rail review "$NONE" "$TEST_TMP/r-review-none")" "review: unset -> null"
eq "<null>" "$(run_rail review "$NONE" "$TEST_TMP/r-review-bad" 'AUTOPILOT_LANE=-x')" "review: bad slug -> null"

# a header-only brief whose last line has no trailing newline still records its lane
NONL="$TEST_TMP/nonl.txt"; printf 'Engine: sonnet | Role: implementer | Lane: mylane | Size: S' > "$NONL"
eq "\"mylane\"" "$(. "$LIB"; dispatch_lane_json "$NONL")" "resolver: no trailing newline"
eq "mylane" "$(run_rail hetero "$NONL" "$TEST_TMP/r-hetero-nonl")" "hetero: no trailing newline"

# the resolver itself: a 65-char slug is too long, a 64-char one passes
LONG64="$(printf 'a%.0s' $(seq 1 64))"; LONG65="${LONG64}a"
eq "\"$LONG64\"" "$(. "$LIB"; AUTOPILOT_LANE="$LONG64" dispatch_lane_json)" "resolver: 64-char slug ok"
eq "null" "$(. "$LIB"; AUTOPILOT_LANE="$LONG65" dispatch_lane_json)" "resolver: 65-char slug -> null"
finalize_test
