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
# Use RUNS_PER_QUERY=5 + MODEL=claude-opus-4-7 for a high-fidelity baseline
# (~5-10x cost, far less noisy).
#
# For real routing fidelity check, augment with manual scenario walks
# (e.g. dogfood-routing-log.md D-1/D-2 9-query pattern). For a future
# automated alternative, see docs/plans/2026-05-14-eval-router-judge.md.
#
# Configurable via env vars:
#   RUNS_PER_QUERY  (default: 1)   — runs per case; 5+ stabilises stochasticity
#   MODEL           (default: claude-sonnet-4-6) — claude-opus-4-7 for less noise
#   NUM_WORKERS     (default: 10)  — parallelism per skill
#   TIMEOUT         (default: 30)  — seconds per query
#
# Example high-fidelity baseline run:
#   RUNS_PER_QUERY=5 MODEL=claude-opus-4-7 bash scripts/run-eval-batch.sh
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
MODEL="${MODEL:-claude-sonnet-4-6}"
NUM_WORKERS="${NUM_WORKERS:-10}"
TIMEOUT="${TIMEOUT:-30}"

AUTOPILOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
  python3 -m scripts.run_eval \
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
