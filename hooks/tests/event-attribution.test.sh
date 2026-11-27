#!/usr/bin/env bash
# Event attribution (D12): dispatch manifests and cost.turn rows carry run_id / fleet_task / pool / commit / lane so
# capacity can attribute tokens to an accepted merge. Seams, end to end: a stub grok worker through the hetero rail
# (manifest -> src/status/events dispatch reader), the cost-tracker hook with the child env the rails export
# (costs.jsonl -> cost reader), and a regex scan of every written jsonl/manifest for token- or email-like strings.
# RED on the base: manifests had no fleet_task/pool/commit, cost rows no run_id/fleet_task/lane, readers dropped them.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-evattr-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_GROK_EFFORT_PROBE=0 DISPATCH_QUIET=1
unset AUTOPILOT_LANE AUTOPILOT_FLEET_TASK AUTOPILOT_UPSTREAM_TASK_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_ACCOUNT 2>/dev/null || true

RAIL="$REPO_ROOT/scripts/dispatch-hetero.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base

# stub grok worker: commits one file in its cwd (the dispatch worktree) and dumps the attribution env it was handed
STUB="$TEST_TMP/grok-stub"; ENVDUMP="$TEST_TMP/child-env.txt"
cat > "$STUB" <<EOS
#!/usr/bin/env bash
if [ "\${1:-}" = "--list-models" ]; then printf 'Available models\n\ngrok-4.5 - Grok 4.5\n'; exit 0; fi
case " \$* " in *" __autopilot_probe__ "*)
  echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2; exit 1 ;;
esac
env | grep -E '^AUTOPILOT_(LANE|FLEET_TASK|PARENT_RUN_ID)=' | sort > "$ENVDUMP"
echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m "stub work"
exit 0
EOS
chmod +x "$STUB"
FLEET_STUB="$TEST_TMP/fleet-stub"; printf '#!/bin/sh\necho %s\n' "'{\"status\":\"open\"}'" > "$FLEET_STUB"; chmod +x "$FLEET_STUB"
export FLEET_BIN="$FLEET_STUB"

ULID="01M7DH5TSZKH5GKB795HGQHAPV"
brief() { printf '%b' "$2" > "$TEST_TMP/$1"; echo "$TEST_TMP/$1"; }
GOOD="$(brief good.txt "Engine: sonnet | Role: implementer | Lane: x | Size: S\n\nFleet-Task: $ULID\n\ncreate ok.txt\n")"
BADT="$(brief badt.txt "Engine: sonnet | Size: S\n\nFleet-Task: 01M7DH5TSZKH5GKB795HGQHAPI\n\ncreate ok.txt\n")"
mf_get() { node -e '
  const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const k = process.argv[2];
  process.stdout.write(!(k in o) ? "<absent>" : o[k] === null ? "<null>" : String(o[k]));' "$1" "$2"; }
run() { # <brief> <runsdir> [env...] -> prints the manifest path
  local pf="$1" runs="$2"; shift 2; mkdir -p "$runs"; rm -f "$ENVDUMP"
  ( cd "$SBX" && timeout 90 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" AUTOPILOT_ACCOUNT=pool-test "$@" "$RAIL" --no-verify-tip --runner grok --model grok-4.5 --effort high \
      --grok-bin "$STUB" --branch "feat/attr-$RANDOM" --prompt-file "$pf" >/dev/null 2>/dev/null ) || true
  find "$runs" -name '*.manifest.json' | head -1
}

# 1. header Fleet-Task + AUTOPILOT_LANE=x: manifest carries all five
MF="$(run "$GOOD" "$TEST_TMP/runs1" AUTOPILOT_LANE=x)"
[ -n "$MF" ] || fail "no manifest written"
RID="$(mf_get "$MF" run_id)"
eq "$ULID" "$(mf_get "$MF" fleet_task)" "manifest fleet_task from the Fleet-Task: header"
eq "x" "$(mf_get "$MF" lane)" "manifest lane"
eq "grok" "$(mf_get "$MF" pool)" "manifest pool: noncq pool key for the grok runner"
COMMIT="$(mf_get "$MF" commit)"
if [[ "$COMMIT" =~ ^[0-9a-f]{7,64}$ ]]; then echo "ok  manifest commit is a sha"; else fail "manifest commit not a sha: $COMMIT"; fi
eq "$ULID" "$(grep '^AUTOPILOT_FLEET_TASK=' "$ENVDUMP" | cut -d= -f2)" "child env carries AUTOPILOT_FLEET_TASK"
eq "x" "$(grep '^AUTOPILOT_LANE=' "$ENVDUMP" | cut -d= -f2)" "child env carries AUTOPILOT_LANE"
eq "$RID" "$(grep '^AUTOPILOT_PARENT_RUN_ID=' "$ENVDUMP" | cut -d= -f2)" "child env carries its own run id as AUTOPILOT_PARENT_RUN_ID"

# 2. the dispatch event reader exposes them on dispatch.started and dispatch.ended
EVOUT="$(RUNS="$TEST_TMP/runs1" node -e '
  const { read } = require(process.argv[1] + "/src/status/events/sources/dispatch.js");
  const fs = require("fs"); const mf = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const r = read({ project: { project_key: "0000000000000001", repo_identity: mf.repo_identity }, env: { AUTOPILOT_DISPATCH_RUNS_DIR: process.env.RUNS } }, {});
  for (const e of r.events) console.log(JSON.stringify({ kind: e.kind, run_id: e.data.run_id, fleet_task: e.data.fleet_task, pool: e.data.pool, commit: e.data.commit, lane: e.data.lane }));
' "$REPO_ROOT" "$MF")"
assert_contains "$EVOUT" "{\"kind\":\"dispatch.started\",\"run_id\":\"$RID\",\"fleet_task\":\"$ULID\",\"pool\":\"grok\",\"commit\":null,\"lane\":\"x\"}" "dispatch.started: run_id fleet_task pool lane, commit null"
assert_contains "$EVOUT" "{\"kind\":\"dispatch.ended\",\"run_id\":\"$RID\",\"fleet_task\":\"$ULID\",\"pool\":\"grok\",\"commit\":\"$COMMIT\",\"lane\":\"x\"}" "dispatch.ended: run_id fleet_task pool commit lane"

# 3. the rail now REFUSES a non-ULID / "none" / missing Fleet-Task (fleet-task-ref.js): no manifest is written. A valid
# ULID with no lane anywhere -> lane null. Precedence is --fleet-task > env AUTOPILOT_FLEET_TASK > UPSTREAM id > brief header.
MF2="$(run "$BADT" "$TEST_TMP/runs2")"
eq "" "$MF2" "bad ULID in the brief -> the rail refuses (no manifest)"
NOLANE="$(brief nolane.txt "Engine: sonnet | Size: S\n\nFleet-Task: $ULID\n\ncreate ok.txt\n")"
MF2B="$(run "$NOLANE" "$TEST_TMP/runs2b")"
eq "<null>" "$(mf_get "$MF2B" lane)" "no lane anywhere -> null"
MF3="$(run "$GOOD" "$TEST_TMP/runs3" AUTOPILOT_UPSTREAM_TASK_ID=nonsense)"
eq "$ULID" "$(mf_get "$MF3" fleet_task)" "the brief header beats a bad env value"

# 3b. brief `Fleet-Task: none` and no valid env id -> refused; a valid inherited env ULID wins over the brief and the child's
# cost.turn attribution (fromEnv on the exported env) agrees with the manifest.
INH="01M7DH5TSZKH5GKB795""HGQHAQ1"
from_env() { node -e 'const a=require(process.argv[1]+"/scripts/lib/event-attribution.js"); process.stdout.write(String(a.fromEnv({AUTOPILOT_FLEET_TASK:process.argv[2]||undefined,AUTOPILOT_UPSTREAM_TASK_ID:process.argv[3]||undefined}).fleet_task))' "$REPO_ROOT" "$1" "$2"; }
NONE="$(brief none.txt "Engine: sonnet | Role: implementer | Lane: x | Size: S\n\nFleet-Task: none\n\ncreate ok.txt\n")"
MF4="$(run "$NONE" "$TEST_TMP/runs4")"
eq "" "$MF4" "brief none and no env id -> the rail refuses (no manifest)"
MF5="$(run "$NONE" "$TEST_TMP/runs5" AUTOPILOT_UPSTREAM_TASK_ID="$INH")"
eq "<null>" "$(mf_get "$MF5" fleet_task)" "brief none + inherited upstream id -> manifest fleet_task null (the brief's explicit none)"
# Since 517d70c68 (task binding) dispatch-hetero.sh re-exports the RESOLVED parent task (env/upstream before brief) to the child,
# so the child's fromEnv follows that binding and no longer mirrors the manifest in these two env-over-brief cases.
eq "$INH" "$(from_env "$(grep '^AUTOPILOT_FLEET_TASK=' "$ENVDUMP" | cut -d= -f2)" "$INH")" "...child env carries the bound parent task"
MF6="$(run "$GOOD" "$TEST_TMP/runs6" AUTOPILOT_FLEET_TASK="$INH")"
eq "$ULID" "$(mf_get "$MF6" fleet_task)" "brief ULID is what the manifest records over an inherited env ULID"
eq "$INH" "$(from_env "$(grep '^AUTOPILOT_FLEET_TASK=' "$ENVDUMP" | cut -d= -f2)" "")" "...child env carries the bound parent task (env first)"

# 4. cost-tracker with the env the rails export: costs.jsonl row -> cost.turn event
TR="$TEST_TMP/transcript.jsonl"; CFG="$TEST_TMP/cfg"; mkdir -p "$CFG"; LEDGER="$CFG/metrics/costs.jsonl"
turn() { printf '{"type":"assistant","requestId":"%s","message":{"id":"%s","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":7,"cache_read_input_tokens":100,"cache_creation_input_tokens":5}}}\n' "$1" "$1"; }
payload() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$1" "$TR" "$SBX"; }
turn a1 > "$TR"
CLAUDE_CONFIG_DIR="$CFG" AUTOPILOT_ACCOUNT=pool-test AUTOPILOT_PARENT_RUN_ID=run-abc-1 AUTOPILOT_FLEET_TASK="$ULID" AUTOPILOT_LANE=x \
  run_hook cost-tracker.js "$(payload ct-attr-1)"
turn a2 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG" AUTOPILOT_ACCOUNT=pool-test AUTOPILOT_PARENT_RUN_ID=run-abc-1 AUTOPILOT_FLEET_TASK=not-a-ulid AUTOPILOT_LANE='Bad Lane' \
  run_hook cost-tracker.js "$(payload ct-attr-1)"
turn a3 >> "$TR"
CLAUDE_CONFIG_DIR="$CFG" AUTOPILOT_ACCOUNT=pool-test run_hook cost-tracker.js "$(payload ct-attr-2)"   # top-level session: no env
COST="$(COSTS="$LEDGER" node -e '
  const { read } = require(process.argv[1] + "/src/status/events/sources/cost.js");
  const repo = "git-common-dir:" + require("fs").realpathSync(process.argv[2] + "/.git");
  const r = read({ project: { project_key: "0000000000000001", repo_identity: repo }, env: { AUTOPILOT_COSTS_FILE: process.env.COSTS } }, {});
  for (const e of r.events) console.log(JSON.stringify([e.run_id, e.data.run_id, e.data.fleet_task, e.data.pool, e.data.commit, e.data.lane]));
' "$REPO_ROOT" "$SBX")"
eq "3" "$(printf '%s\n' "$COST" | grep -c .)" "three cost.turn events read back"
eq "[\"run-abc-1\",\"run-abc-1\",\"$ULID\",\"pool-test\",null,\"x\"]" "$(echo "$COST" | sed -n 1p)" "cost.turn in a dispatched child: run_id fleet_task pool lane"
eq "[\"run-abc-1\",\"run-abc-1\",null,\"pool-test\",null,null]" "$(echo "$COST" | sed -n 2p)" "cost.turn bad ULID and bad lane -> null"
eq "[null,null,null,\"pool-test\",null,null]" "$(echo "$COST" | sed -n 3p)" "cost.turn of a top-level session: run_id null"

# 5. no token / email / credential-like string anywhere in what was written
ALL="$(cat "$LEDGER" "$TEST_TMP"/runs*/*.manifest.json)"
SECRET_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._-]{16,}|ghp_[A-Za-z0-9]{20,}|\.credentials\.json'
if printf '%s' "$ALL" | grep -qE "$SECRET_RE"; then fail "token/email/credential-like string in written events: $(printf '%s' "$ALL" | grep -oE "$SECRET_RE" | head -2)"; else echo "ok  no token/email-like string in manifests or costs.jsonl"; fi
# negative control: the scan fires on a planted secret
if printf '%s' "$ALL s""k-abcdefghijklmnopqrstuv" | grep -qE "$SECRET_RE"; then echo "ok  control: the scan sees a planted token"; else fail "scan is blind"; fi

finalize_test
