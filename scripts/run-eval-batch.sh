#!/usr/bin/env bash
# Run eval-only for every autopilot skill that has an eval set (no improve loop).
# The runnable list is DERIVED from which skills have a *-evals.json — skills
# without one are reported as uncovered rather than silently omitted.
# Uses run_eval.py from skill-creator directly.
#
# WHAT THIS MEASURES (and what it doesn't)
# -----------------------------------------
# run_eval.py spawns `claude -p <query>` with ONLY the skill description
# placed in `.claude/commands/<skill>-skill-<random>.md`. No body, no other
# autopilot skills, no project context. It listens to stream events to see
# whether Claude invokes the `Skill` tool against that one command for each
# query.
#
# This is an **isolation test** of description attractiveness:
#   - HIGH pass on should_trigger=False cases → description is not overly broad
#   - LOW recall on should_trigger=True cases → description is too weak to
#     attract its own query when alone in the catalog
#
# This is NOT a measure of:
#   - Real-world routing precision (production has 20+ competing skills)
#   - Skill body quality, methodology fidelity, or workflow correctness
#   - Whether quality-pipeline / ceo-agent / etc. correctly chain
#
# The "2.5% trigger rate baseline" observed at v2.7.0 (cookys-dogfood log
# 2026-05-14_122359) is the description-in-isolation FLOOR — not a routing
# regression metric. Stochasticity is ±1-2 cases / 10 with runs-per-query=1.
# Use RUNS_PER_QUERY=5 + MODEL=claude-opus-4-8 for a high-fidelity baseline
# (~5-10x cost, far less noisy).
#
# For real routing fidelity check, augment with manual scenario walks
# (e.g. dogfood-routing-log.md D-1/D-2 9-query pattern). For a future
# automated alternative, see docs/plans/2026-05-14-eval-router-judge.md.
#
# Configurable via env vars:
#   RUNS_PER_QUERY  (default: 1)   — runs per case; 5+ stabilises stochasticity
#   MODEL           (default: claude-sonnet-5) — claude-opus-4-8 for less noise
#   NUM_WORKERS     (default: 10)  — parallelism per skill
#   TIMEOUT         (default: 30)  — seconds per query
#
# Example high-fidelity baseline run:
#   RUNS_PER_QUERY=5 MODEL=claude-opus-4-8 bash scripts/run-eval-batch.sh
set -euo pipefail

# Single-instance lock: two concurrent eval batches would each create
# `<skill>-skill-*.md` in the shared ~/.claude/commands and race each other's
# cleanup. flock makes batches serialize, so the only command files appearing in a
# run_eval window are our own. (Residual: a human manually dropping a matching file
# in that exact window is out of scope — run_eval owns the random suffix.) flock is
# coreutils-standard on the Linux dev/CI path this harness runs on.
if command -v flock >/dev/null 2>&1; then
  LOCK_FILE="${TMPDIR:-/tmp}/autopilot-run-eval-batch.lock"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "another run-eval-batch is already running (lock: $LOCK_FILE) — exiting to avoid command-file races" >&2
    exit 1
  fi
fi

RUNS_PER_QUERY="${RUNS_PER_QUERY:-1}"
MODEL="${MODEL:-claude-sonnet-5}"
NUM_WORKERS="${NUM_WORKERS:-10}"
TIMEOUT="${TIMEOUT:-30}"
RUN_EVAL_CMD="${RUN_EVAL_CMD:-python3 -m scripts.run_eval}"

SELFTEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --selftest)
      SELFTEST=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

extract_loaded_plugins() {
  local log_file="$1"
  local loaded=""
  if [[ -f "$log_file" ]]; then
    # 1. Check for wrapper log output
    loaded=$(grep -oE "\[runner\] Loaded plugins: \[[^]]*\]" "$log_file" 2>/dev/null | head -n 1 | sed -E 's/.*\[runner\] Loaded plugins: \[(.*)\]/\1/' || true)
    if [[ -z "$loaded" ]]; then
      # 2. Check if any hook ran by scanning for hook files
      local hooks_found
      hooks_found=$(grep -oE "[a-zA-Z0-9_-]+\.js" "$log_file" 2>/dev/null | grep -E "session-start|accumulator|audit-log|batch-format|branch-protection|capture-payload|check-console|commit-secret-scan|config-protection|cost-tracker|design-quality|failure-escalation|intent-capture|large-file-warner|log-error|mcp-health|reload-watch|session-handoff|session-summary|state-checkpoint|suggest-compact|test-runner|version-drift-check" | sort -u | tr '\n' ',' | sed 's/,$//' || true)
      if [[ -n "$hooks_found" ]]; then
        loaded="contaminated-hooks($hooks_found)"
      fi
    fi
  fi
  echo "$loaded"
}

# Set up wrapper directory for per-arm isolation
WRAPPER_DIR="${TMPDIR:-/tmp}/autopilot-eval-wrapper-$$"
cleanup_all() {
  rm -rf "$WRAPPER_DIR"
}
trap cleanup_all EXIT

mkdir -p "$WRAPPER_DIR"
EMPTY_PLUGIN_DIR="$WRAPPER_DIR/empty-plugin"
mkdir -p "$EMPTY_PLUGIN_DIR"

# Write the wrapper script
cat << 'EOF' > "$WRAPPER_DIR/claude"
#!/usr/bin/env bash
WRAPPER_DIR=$(cd "$(dirname "$0")" && pwd)
REAL_CLAUDE=""
IFS=':' read -ra ADDR <<< "$PATH"
for dir in "${ADDR[@]}"; do
  if [[ "$dir" != "$WRAPPER_DIR" && -x "$dir/claude" ]]; then
    REAL_CLAUDE="$dir/claude"
    break
  fi
done

if [[ -z "$REAL_CLAUDE" ]]; then
  # Fallback if no other claude is on PATH (e.g. stub testing environment)
  echo "[wrapper] claude not found on PATH (excluding wrapper)" >&2
  exit 0
fi

# Print manifest info for selftest/verification
if [[ -n "${ARM_PLUGIN_DIR:-}" ]]; then
  echo "[runner] Loaded plugins: [$(basename "$ARM_PLUGIN_DIR")]" >&2
  exec "$REAL_CLAUDE" "$@" --setting-sources project,local --plugin-dir "$ARM_PLUGIN_DIR"
else
  echo "[runner] Loaded plugins: []" >&2
  exec "$REAL_CLAUDE" "$@" --setting-sources project,local --plugin-dir "$EMPTY_PLUGIN_DIR"
fi
EOF
chmod +x "$WRAPPER_DIR/claude"

# Prepend WRAPPER_DIR to PATH
export PATH="$WRAPPER_DIR:$PATH"
export EMPTY_PLUGIN_DIR

AUTOPILOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$SELFTEST" -eq 1 ]]; then
  echo "=== Running Eval Isolation Selftest ==="
  SELFTEST_TMP=$(mktemp -d -t "eval-selftest-XXXXXX")
  
  # Ensure the fixtures exist
  SELFTEST_FIXTURE_DIR=$(mktemp -d -t "autopilot-selftest-fixtures-XXXXXX")
trap 'rm -rf "$SELFTEST_FIXTURE_DIR"' RETURN 2>/dev/null || true
  mkdir -p "$SELFTEST_FIXTURE_DIR/selftest-skill"
  
  cat << 'EOF' > "$SELFTEST_FIXTURE_DIR/selftest-skill/SKILL.md"
---
name: selftest
description: Dummy skill for isolation selftest.
---
# selftest
EOF

  cat << 'EOF' > "$SELFTEST_FIXTURE_DIR/selftest-evals.json"
{
  "summary": {
    "passed": 1,
    "total": 1
  },
  "results": []
}
EOF

  # Run Plugin Arm
  echo "Running Plugin Arm..."
  export ARM_PLUGIN_DIR="$SELFTEST_FIXTURE_DIR/selftest-skill"
  $RUN_EVAL_CMD \
    --eval-set "$SELFTEST_FIXTURE_DIR/selftest-evals.json" \
    --skill-path "$SELFTEST_FIXTURE_DIR/selftest-skill" \
    --num-workers 1 \
    --timeout 10 \
    --runs-per-query 1 \
    --model "$MODEL" \
    > "$SELFTEST_TMP/plugin-output.json" \
    2> "$SELFTEST_TMP/plugin-log.txt" || true
  
  # Run Baseline Arm
  echo "Running Baseline Arm..."
  export ARM_PLUGIN_DIR=""
  $RUN_EVAL_CMD \
    --eval-set "$SELFTEST_FIXTURE_DIR/selftest-evals.json" \
    --skill-path "$SELFTEST_FIXTURE_DIR/selftest-skill" \
    --num-workers 1 \
    --timeout 10 \
    --runs-per-query 1 \
    --model "$MODEL" \
    > "$SELFTEST_TMP/baseline-output.json" \
    2> "$SELFTEST_TMP/baseline-log.txt" || true
    
  # Extract manifests
  PLUGIN_PLUGINS=$(extract_loaded_plugins "$SELFTEST_TMP/plugin-log.txt")
  BASELINE_PLUGINS=$(extract_loaded_plugins "$SELFTEST_TMP/baseline-log.txt")
  
  echo "--- Selftest Manifests ---"
  if [[ -n "$PLUGIN_PLUGINS" ]]; then
    echo "  Plugin Arm:   [$PLUGIN_PLUGINS]"
  else
    echo "  Plugin Arm:   [none]"
  fi
  if [[ -n "$BASELINE_PLUGINS" ]]; then
    echo "  Baseline Arm: [$BASELINE_PLUGINS]"
  else
    echo "  Baseline Arm: [none]"
  fi
  echo "--------------------------"
  
  IS_STUB=0
  if [[ "$RUN_EVAL_CMD" =~ stub || "$RUN_EVAL_CMD" =~ mock ]]; then
    IS_STUB=1
  fi
  
  LIVE_RUN_FAILED=0
  if [[ "$IS_STUB" -eq 0 ]]; then
    # If live runner failed to write outputs (e.g. no auth, network), print UNVERIFIED
    if [[ ! -s "$SELFTEST_TMP/plugin-output.json" && ! -s "$SELFTEST_TMP/baseline-output.json" ]]; then
      LIVE_RUN_FAILED=1
    fi
  fi
  
  # Clean up fixtures and temp files
  rm -rf "$SELFTEST_TMP"
  rm -rf "$SELFTEST_FIXTURE_DIR"
  
  if [[ "$LIVE_RUN_FAILED" -eq 1 ]]; then
    echo "Plugin loading: UNVERIFIED-in-this-environment (live runner failed to execute or credentials missing)"
    exit 0
  fi
  
  # Verify isolation
  if [[ -n "$BASELINE_PLUGINS" ]]; then
    echo "ERROR: Baseline arm loaded plugins: $BASELINE_PLUGINS" >&2
    exit 1
  fi
  
  echo "Selftest passed: baseline arm is clean."
  exit 0
fi
SKILL_CREATOR_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
RESULTS_BASE="$AUTOPILOT_DIR/skill-creator-workspace/results"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)

# Derive the runnable set from which skills actually have an eval set, and track
# the rest so coverage gaps are reported, not silently dropped (no-silent-caps).
EVALS_DIR="$AUTOPILOT_DIR/skill-creator-workspace/evals"
SKILLS=()
UNCOVERED=()
for skill_dir in "$AUTOPILOT_DIR"/skills/*/; do
  skill="$(basename "$skill_dir")"
  if [[ -f "$EVALS_DIR/${skill}-evals.json" ]]; then
    SKILLS+=("$skill")
  else
    UNCOVERED+=("$skill")
  fi
done

TOTAL_SKILLS=$(( ${#SKILLS[@]} + ${#UNCOVERED[@]} ))

echo "=== Batch Eval — $TIMESTAMP ==="
echo "Running ${#SKILLS[@]}/${TOTAL_SKILLS} skills with eval sets"
if [[ ${#UNCOVERED[@]} -gt 0 ]]; then
  echo "  UNCOVERED (no *-evals.json): ${UNCOVERED[*]}"
fi
echo "  runs/query=$RUNS_PER_QUERY model=$MODEL workers=$NUM_WORKERS timeout=${TIMEOUT}s"
echo ""

# Track the EXACT command files our own run_eval invocations create, by diffing the
# per-skill listing immediately before and after each run_eval call. Cleanup then
# deletes only those tracked files — never a blanket `rm ~/.claude/commands/*-skill-*.md`
# (which nuked a user's or a concurrent run's matching files). With the flock above
# serializing batches, the only files appearing in a run_eval window are ours; the
# sole residual is a human manually creating a `<skill>-skill-*.md` in that exact
# window (out of scope — run_eval owns the random suffix).
CMD_DIR="$HOME/.claude/commands"
CREATED_CMDS=()

declare -A SCORES

for skill in "${SKILLS[@]}"; do
  EVAL_FILE="$AUTOPILOT_DIR/skill-creator-workspace/evals/${skill}-evals.json"
  SKILL_PATH="$AUTOPILOT_DIR/skills/$skill"
  RESULT_DIR="$RESULTS_BASE/$skill/$TIMESTAMP"
  mkdir -p "$RESULT_DIR"

  echo "--- $skill ---"

  cd "$SKILL_CREATOR_DIR"
  # Snapshot this skill's command files right before run_eval so we can delete
  # exactly what it creates (and nothing a concurrent run/user owns).
  before_cmds="$(ls "$CMD_DIR/${skill}-skill-"*.md 2>/dev/null | sort || true)"
  export ARM_PLUGIN_DIR="$SKILL_PATH"
  $RUN_EVAL_CMD \
    --eval-set "$EVAL_FILE" \
    --skill-path "$SKILL_PATH" \
    --num-workers "$NUM_WORKERS" \
    --timeout "$TIMEOUT" \
    --runs-per-query "$RUNS_PER_QUERY" \
    --model "$MODEL" \
    --verbose \
    > "$RESULT_DIR/eval-output.json" \
    2> "$RESULT_DIR/eval-log.txt" || true
  after_cmds="$(ls "$CMD_DIR/${skill}-skill-"*.md 2>/dev/null | sort || true)"
  while IFS= read -r nf; do
    [[ -n "$nf" ]] && CREATED_CMDS+=("$nf")
  done < <(comm -13 <(printf '%s\n' "$before_cmds") <(printf '%s\n' "$after_cmds"))

  # verbose output goes to stderr (captured in eval-log.txt)
  # JSON results go to stdout (captured in eval-output.json)
  cat "$RESULT_DIR/eval-log.txt"

  SCORE=$(python3 -c "
import json
data = json.load(open('$RESULT_DIR/eval-output.json'))
s = data['summary']
print(f\"{s['passed']}/{s['total']}\")
" 2>/dev/null || echo "parse-error")

  SCORES[$skill]=$SCORE
  echo "  => Score: $SCORE"
  echo ""
done

echo "=== Summary ==="
for skill in "${SKILLS[@]}"; do
  printf "  %-20s %s\n" "$skill" "${SCORES[$skill]}"
done
if [[ ${#UNCOVERED[@]} -gt 0 ]]; then
  echo ""
  echo "  Coverage: ${#SKILLS[@]}/${TOTAL_SKILLS} skills have eval sets."
  for skill in "${UNCOVERED[@]}"; do
    printf "  %-20s %s\n" "$skill" "(no eval set)"
  done
fi
echo ""
echo "Results in: $RESULTS_BASE/*/$TIMESTAMP/"

# Clean up EXACTLY the command files our own run_eval calls created (tracked above).
# Never a blanket wildcard — only files we observed appear during our invocations.
cleaned=0
if [[ ${#CREATED_CMDS[@]} -gt 0 ]]; then
  for f in "${CREATED_CMDS[@]}"; do
    [[ -e "$f" ]] && rm -f "$f" && cleaned=$((cleaned + 1))
  done
fi
if [[ "$cleaned" -gt 0 ]]; then
  echo "Cleaned $cleaned eval artifact(s) created by this run from $CMD_DIR/"
fi
