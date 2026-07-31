#!/usr/bin/env bash
# calibrate-m3-band.sh — small-sample calibration batch for the M3/flash-band
# orchestration tasks (t15/t16/t17). Wrapper over run-orchestration-eval.sh.
#
# WHY THIS EXISTS: t1–t13 all ceiling on MiniMax-M3, so pack/procedure lift is
# unmeasurable. t15/t16/t17 add a SECOND, independently-scored axis (fidelity_ok
# + decoy_respected) that a capable-but-hasty orchestrator is likely to trade
# away, giving the escape/discrimination gradient headroom the report asked for.
# This runner drives M3 (or any Anthropic-compatible endpoint) through the
# cc-shim arm (ORCH_CC_SHIM=1) so the env token is the sole auth source.
#
# DESIGN (matches the 2026-07-06/07 eval-instruments lessons):
#   * PARAMETERIZED — tasks / arms / n / model / endpoint / out all flags.
#   * RESUMABLE — a cell whose result.json already carries a parsed oracle_pass
#     is skipped; empty/auth-dead results are re-run (resume-skip-existing).
#   * PER-ROUND AUTH CIRCUIT-BREAKER — re-resolves the endpoint before EVERY
#     run; a lost/blank token STOPS the batch instead of silently filling the
#     rest with empty results (the "auth drops silently" lesson).
#   * SERIAL — one MiniMax endpoint cannot serve concurrent calls without
#     rate-limiting, so cells run strictly one at a time (+ inter-run sleep).
#
# Run this at DEPTH-0 (not inside a sub-orchestrator's context) — a full batch
# is long-running and quota-sensitive.
#
# Exit: 0 batch complete / 2 usage or endpoint-not-ready / 3 auth lost mid-batch.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
EVAL_RUNNER="$REPO_ROOT/evals/orchestration/run-orchestration-eval.sh"
SCORE="$REPO_ROOT/evals/orchestration/score.js"

TASKS="t15-cache-invalidation t16-findings-triage t17-purity-invariant"
ARMS="on off"
N=3
MODEL="MiniMax-M3"
ENDPOINT="minimax"
OUT_DIR="$REPO_ROOT/docs/projects/_archive/2026-07-09-m3-band-tasks/runs"
RESULTS=""
TIMEOUT="10m"
SLEEP=2
DRY_RUN=0
LIVE_PROBE=0

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<EOF

Usage: $0 [options]
  --tasks "<id> ..."   tasks to run          (default: $TASKS)
  --arms  "on off"     arms to run           (default: $ARMS)
  --n N                iterations per cell    (default: $N)
  --model M            orchestrator model     (default: $MODEL)
  --endpoint NAME      autopilot endpoint     (default: $ENDPOINT)
  --out DIR            per-run output dir     (default: <project>/runs)
  --results FILE       append JSONL here      (default: <out>/results.jsonl)
  --timeout T          per-run timeout        (default: $TIMEOUT)
  --sleep S            inter-run seconds      (default: $SLEEP)
  --live-probe         send a tiny real auth ping before each run (spends a few tokens)
  --dry-run            print the plan and the resolved wiring, run nothing
  -h, --help           this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tasks) TASKS="$2"; shift 2 ;;
    --arms) ARMS="$2"; shift 2 ;;
    --n) N="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --results) RESULTS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --sleep) SLEEP="$2"; shift 2 ;;
    --live-probe) LIVE_PROBE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$RESULTS" ] || RESULTS="$OUT_DIR/results.jsonl"
mkdir -p "$OUT_DIR"

# --- Load endpoint credentials into the process env (persistence layer) -------
if [ -f "$REPO_ROOT/scripts/load-endpoints-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/load-endpoints-env.sh" && autopilot_load_endpoints_env >/dev/null 2>&1 || true
fi

# --- Resolve the endpoint → ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN ----------
# resolve-endpoint.sh emits NON-SECRET metadata only; we read the token VALUE
# ourselves via the reported token_env name (indirect expansion, never printed).
resolve_endpoint_json() { "$REPO_ROOT/scripts/resolve-endpoint.sh" "$ENDPOINT" 2>/dev/null; }

endpoint_ready() {
  local j; j="$(resolve_endpoint_json)" || return 1
  printf '%s' "$j" | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("ready") else 1)' 2>/dev/null
}

export_endpoint_env() {
  local j; j="$(resolve_endpoint_json)" || return 1
  local base te
  base="$(printf '%s' "$j" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("base_url",""))')"
  te="$(printf '%s' "$j" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token_env",""))')"
  [ -n "$base" ] && [ -n "$te" ] || return 1
  local tok="${!te:-}"
  [ -n "$tok" ] || return 1
  export ANTHROPIC_BASE_URL="$base"
  export ANTHROPIC_AUTH_TOKEN="$tok"
  return 0
}

if ! endpoint_ready || ! export_endpoint_env; then
  echo "ERROR: endpoint '$ENDPOINT' is not ready (missing url/token). Run: autopilot endpoints doctor" >&2
  exit 2
fi

export ORCH_CC_SHIM=1
export ORCH_TIMEOUT="$TIMEOUT"

# --- Optional live auth ping (spends a few tokens) ----------------------------
live_auth_ok() {
  [ "$LIVE_PROBE" = "1" ] || return 0
  local scratch; scratch="$(mktemp -d)"
  local out rc
  out="$( HOME="$scratch" timeout 60 claude -p --model "$MODEL" \
            --setting-sources project --strict-mcp-config \
            <<<'Reply with the single word: alive' 2>/dev/null )"
  rc=$?
  rm -rf "$scratch"
  [ $rc -eq 0 ] && printf '%s' "$out" | grep -qi alive
}

cell_done() {
  # a cell is "done" only if its result.json parses AND carries oracle_pass
  local rj="$1"
  [ -f "$rj" ] && grep -q '"oracle_pass"' "$rj" 2>/dev/null
}

# --- Plan --------------------------------------------------------------------
echo "=== M3-band calibration plan ==="
echo "endpoint=$ENDPOINT base=$ANTHROPIC_BASE_URL model=$MODEL arm(s)=[$ARMS] n=$N timeout=$TIMEOUT"
echo "tasks: $TASKS"
echo "out=$OUT_DIR results=$RESULTS  (ORCH_CC_SHIM=1, serial, resume-skip-existing)"
if [ "$DRY_RUN" = "1" ]; then
  echo "(dry-run: nothing executed)"
  for t in $TASKS; do for a in $ARMS; do for i in $(seq 1 "$N"); do
    rj="$OUT_DIR/$t-$a-$i/result.json"
    if cell_done "$rj"; then echo "  SKIP  $t $a #$i (already done)"; else echo "  RUN   $t $a #$i"; fi
  done; done; done
  exit 0
fi

touch "$RESULTS"
RAN=0; SKIPPED=0
for t in $TASKS; do
  for a in $ARMS; do
    for i in $(seq 1 "$N"); do
      cell_out="$OUT_DIR/$t-$a-$i"
      rj="$cell_out/result.json"
      if cell_done "$rj"; then
        SKIPPED=$((SKIPPED+1)); echo "SKIP  $t $a #$i"; continue
      fi
      # per-round auth circuit-breaker
      if ! endpoint_ready || ! export_endpoint_env || ! live_auth_ok; then
        echo "AUTH LOST before $t $a #$i — STOPPING (done=$RAN skipped=$SKIPPED). Fix creds and re-run to resume." >&2
        exit 3
      fi
      echo "RUN   $t $a #$i -> $cell_out"
      line="$( bash "$EVAL_RUNNER" --task "$t" --arm "$a" --runner cc --model "$MODEL" --out "$cell_out" 2>>"$cell_out.stderr" )"
      if [ -n "$line" ]; then printf '%s\n' "$line" >> "$RESULTS"; fi
      RAN=$((RAN+1))
      sleep "$SLEEP"
    done
  done
done

echo "=== done: ran=$RAN skipped=$SKIPPED ==="
echo "=== score ==="
node "$SCORE" "$RESULTS" || true
