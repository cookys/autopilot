#!/usr/bin/env bash
# bench-engine-capability.sh — Capability bench runner for skill transport.

set -uo pipefail

TEMP_STORE_DIR=""
cleanup() {
  if [ -n "$TEMP_STORE_DIR" ]; then
    rm -rf "$TEMP_STORE_DIR"
  fi
}
trap cleanup EXIT

RUNNER=""
MODEL=""
SKILL_MODE=""
DRY_RUN=0
LIVE_SPEND=0
STORE_DIR=""
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(dirname "$SELF_DIR")"

usage() {
  cat <<EOF
Usage:
  scripts/bench-engine-capability.sh --runner <r> --model <m> --skill-mode <native|prompt> [--dry-run] [--live-spend] [--store <path>]

Options:
  --runner <r>              Runner name (e.g. codex, agy, grok, cc-shim)
  --model <m>               Model name
  --skill-mode <mode>       Skill transport mode to bench (native or prompt)
  --dry-run                 Print the planned bench without running it
  --live-spend              Allow live model spending
  --store <path>            Override capability store directory
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --runner) RUNNER="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --skill-mode) SKILL_MODE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --live-spend) LIVE_SPEND=1; shift ;;
    --store) STORE_DIR="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Error: unknown argument $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$RUNNER" ] || [ -z "$MODEL" ] || [ -z "$SKILL_MODE" ]; then
  echo "Error: --runner, --model, and --skill-mode are required." >&2
  usage
  exit 2
fi

# Resolve store directory and thread it to subprocesses/state-calls
if [ -z "$STORE_DIR" ] && [ -n "${ENGINE_CAPABILITY_DIR:-}" ]; then
  STORE_DIR="$ENGINE_CAPABILITY_DIR"
fi

if [ -n "$STORE_DIR" ]; then
  export ENGINE_CAPABILITY_DIR="$STORE_DIR"
fi

if [[ "$SKILL_MODE" != "native" && "$SKILL_MODE" != "prompt" ]]; then
  echo "Error: --skill-mode must be one of native|prompt (got: $SKILL_MODE)" >&2
  exit 2
fi

# Define case list
cases=("brainstorm-gate" "quality-review-findings-first" "dev-flow-branch-check")
if [[ "$SKILL_MODE" == "prompt" ]]; then
  cases+=("no-skill-claim")
fi

# Dry run mode just prints the planned bench
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Bench plan for runner: $RUNNER, model: $MODEL, skill-mode: $SKILL_MODE"
  if [ -n "$STORE_DIR" ]; then
    echo "Store: $STORE_DIR"
  fi
  echo "Cases:"
  idx=1
  for c in "${cases[@]}"; do
    echo "$idx. $c (evals/engine-capabilities/$c.prompt.txt)"
    idx=$((idx+1))
  done
  exit 0
fi

# Live execution requires --live-spend
if [ "$LIVE_SPEND" -eq 0 ]; then
  echo "ERROR: --live-spend is required to run live capability bench because it may spend paid model quota" >&2
  exit 1
fi

# Create local bench artifacts directory. SANITIZE the runner/model/skill-mode before
# using them as a path segment — an unsanitized value containing '/' or '..' could write
# bench logs outside the intended bench dir (gpt-5.5 batch2 R2 M2). Any char outside
# [A-Za-z0-9._-] becomes '_'; leading dots are stripped so a value can't start with '..'.
# Exclude '.' from the allowed set too, so no segment can be '.'/'..' (path traversal).
sanitize_seg() { local s; s="$(printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_')"; printf '%s' "${s:-x}"; }
BENCH_DIR="$HOME/.autopilot/engine-capabilities/bench/$(sanitize_seg "$RUNNER")_$(sanitize_seg "$MODEL")_$(sanitize_seg "$SKILL_MODE")"
mkdir -p "$BENCH_DIR"

store_args=()
if [ -n "$STORE_DIR" ]; then
  store_args+=(--store "$STORE_DIR")
fi

# Pre-record temporary native supported state so dispatch-hetero.sh allows native skill mode
if [[ "$SKILL_MODE" == "native" ]]; then
  TEMP_STORE_DIR="$(mktemp -d)"
  observed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  temp_json="$(OBSERVED_AT="$observed_at" RUNNER="$RUNNER" MODEL="$MODEL" node -e '
    const p = process.env;
    console.log(JSON.stringify({
      schema_version: 1,
      observed_at: p.OBSERVED_AT,
      runner: p.RUNNER,
      model: p.MODEL,
      role: "implementer",
      runner_version: "v1.0.0-temp",
      capability: {
        quota: { status: "available", confidence: "high", ttl_seconds: 3600 },
        skill_transport: { native: "supported", prompt_pack: "unknown" }
      }
    }));
  ')"
  echo "$temp_json" | node "$SELF_DIR/engine-capability-state.js" record --store "$TEMP_STORE_DIR" >/dev/null
fi

all_passed=1

verify_expected() {
  local log_file="$1"
  local expected_file="$2"
  local pass=1
  
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^# ]] && continue
    [[ -z "$line" ]] && continue
    
    if [[ "$line" =~ ^CONTAINS:(.*) ]]; then
      local term="${BASH_REMATCH[1]}"
      if ! grep -qF "$term" "$log_file"; then
        pass=0
      fi
    elif [[ "$line" =~ ^CONTAINS_REGEX:(.*) ]]; then
      local pattern="${BASH_REMATCH[1]}"
      if ! grep -qiE "$pattern" "$log_file"; then
        pass=0
      fi
    elif [[ "$line" =~ ^NOT_CONTAINS:(.*) ]]; then
      local term="${BASH_REMATCH[1]}"
      if grep -qF "$term" "$log_file"; then
        pass=0
      fi
    elif [[ "$line" =~ ^TOP_LINES_MATCH:([0-9]+):(.*) ]]; then
      local n="${BASH_REMATCH[1]}"
      local pattern="${BASH_REMATCH[2]}"
      if ! head -n "$n" "$log_file" | grep -qiE "$pattern"; then
        pass=0
      fi
    fi
  done < "$expected_file"
  echo "$pass"
}

for c in "${cases[@]}"; do
  echo "Running bench case: $c..."
  
  skills_args=()
  if [[ "$c" == "brainstorm-gate" ]]; then
    skills_args+=(--skill autopilot:brainstorm)
  elif [[ "$c" == "quality-review-findings-first" ]]; then
    skills_args+=(--skill autopilot:quality-pipeline)
  elif [[ "$c" == "dev-flow-branch-check" ]]; then
    skills_args+=(--skill autopilot:dev-flow)
  fi

  branch_name="bench-${c}-${RANDOM}"
  
  dispatch_args=(
    --branch "$branch_name"
    --prompt-file "$REPO_ROOT/evals/engine-capabilities/${c}.prompt.txt"
    --runner "$RUNNER"
    --model "$MODEL"
    --skill-mode "$SKILL_MODE"
  )
  if [ -n "$TEMP_STORE_DIR" ]; then
    dispatch_args+=(--store "$TEMP_STORE_DIR")
  fi
  dispatch_args+=("${skills_args[@]}")

  run_output="$("$SELF_DIR/dispatch-hetero.sh" "${dispatch_args[@]}" 2>&1)"
  
  # Clean up worktree and branch
  wt_path="$(echo "$run_output" | node -e '
    try {
      console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).worktree || "");
    } catch(e) {}
  ')"
  if [ -n "$wt_path" ]; then
    git worktree remove --force "$wt_path" >/dev/null 2>&1 || true
  fi
  git branch -D "$branch_name" >/dev/null 2>&1 || true

  # Extract log path and fields
  log_path="$(echo "$run_output" | node -e '
    try {
      console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).agent_log || "");
    } catch(e) {}
  ')"
  files_changed="$(echo "$run_output" | node -e '
    try {
      console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).files_changed || 0);
    } catch(e) {}
  ')"

  # Copy log to bench dir for persistent history
  if [ -f "$log_path" ]; then
    cp "$log_path" "$BENCH_DIR/${c}.log"
  fi

  case_passed=1
  # Mutation check (bench is read-only)
  if [ "$files_changed" -ne 0 ]; then
    echo "  [FAIL] Repo mutated during read-only bench case: $c"
    case_passed=0
  fi

  # Expected behavior check
  if [ -f "$log_path" ]; then
    exp_verify="$(verify_expected "$log_path" "$REPO_ROOT/evals/engine-capabilities/${c}.expected.txt")"
    if [ "$exp_verify" -ne 1 ]; then
      echo "  [FAIL] Output verification failed for case: $c"
      case_passed=0
    fi
  else
    echo "  [FAIL] Log file not found for case: $c"
    case_passed=0
  fi

  if [ "$case_passed" -eq 1 ]; then
    echo "  [PASS] Case: $c"
  else
    all_passed=0
  fi
done

result_status="unsupported"
if [ "$all_passed" -eq 1 ]; then
  result_status="supported"
fi

# Record ONLY the dimension this bench actually tested; the untested field is written
# as "unknown". Cross-bench preservation (a native bench must not clobber a prior
# prompt_pack result and vice versa) is handled authoritatively by engine-capability-state.js
# `current`, which merges skill_transport PER FIELD (latest non-unknown wins) — so we do NOT
# read/carry the other field here (that read-modify-write was dead + racy). (gpt-5.5 batch2 R4 O1)
observed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
payload="$(OBSERVED_AT="$observed_at" RUNNER="$RUNNER" MODEL="$MODEL" MODE="$SKILL_MODE" STATUS="$result_status" node -e '
  const p = process.env;
  const isNative = p.MODE === "native";
  const nativeVal = isNative ? p.STATUS : "unknown";
  const promptVal = isNative ? "unknown" : p.STATUS;
  const payload = {
    schema_version: 1,
    observed_at: p.OBSERVED_AT,
    runner: p.RUNNER,
    model: p.MODEL,
    role: "implementer",
    runner_version: "v1.0.0-bench",
    capability: {
      quota: {
        status: "available",
        reset_at: null,
        confidence: "high",
        evidence: "Capability bench run for " + p.MODE,
        ttl_seconds: 86400 * 30
      },
      skill_transport: {
        native: nativeVal,
        prompt_pack: promptVal,
        last_bench_id: "bench-" + Math.floor(Math.random() * 1000000)
      }
    }
  };
  console.log(JSON.stringify(payload));
')"

echo "$payload" | node "$SELF_DIR/engine-capability-state.js" record "${store_args[@]}"

if [ "$all_passed" -eq 1 ]; then
  echo "Capability bench successfully benched $SKILL_MODE mode as supported."
  exit 0
else
  echo "Capability bench failed. Benched $SKILL_MODE mode as unsupported."
  exit 1
fi
