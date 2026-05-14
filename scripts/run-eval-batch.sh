#!/usr/bin/env bash
# Run eval-only for all 16 autopilot skills (no improve loop).
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
#   - Real-world routing precision (production has 16+ competing skills)
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

RUNS_PER_QUERY="${RUNS_PER_QUERY:-1}"
MODEL="${MODEL:-claude-sonnet-4-6}"
NUM_WORKERS="${NUM_WORKERS:-10}"
TIMEOUT="${TIMEOUT:-30}"

AUTOPILOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_CREATOR_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
RESULTS_BASE="$AUTOPILOT_DIR/skill-creator-workspace/results"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)

SKILLS=(audit ceo-agent debug dev-flow finish-flow learn next profiling project-lifecycle quality-pipeline retro survey team test-strategy think-tank think-tank-dialectic)

echo "=== Batch Eval — $TIMESTAMP ==="
echo "Running ${#SKILLS[@]} skills"
echo "  runs/query=$RUNS_PER_QUERY model=$MODEL workers=$NUM_WORKERS timeout=${TIMEOUT}s"
echo ""

declare -A SCORES

for skill in "${SKILLS[@]}"; do
  EVAL_FILE="$AUTOPILOT_DIR/skill-creator-workspace/evals/${skill}-evals.json"
  SKILL_PATH="$AUTOPILOT_DIR/skills/$skill"
  RESULT_DIR="$RESULTS_BASE/$skill/$TIMESTAMP"
  mkdir -p "$RESULT_DIR"

  echo "--- $skill ---"

  cd "$SKILL_CREATOR_DIR"
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
echo ""
echo "Results in: $RESULTS_BASE/*/$TIMESTAMP/"

# Clean up eval artifacts that pollute the global skill list
ARTIFACTS=$(ls ~/.claude/commands/*-skill-*.md 2>/dev/null | wc -l)
if [[ "$ARTIFACTS" -gt 0 ]]; then
  rm ~/.claude/commands/*-skill-*.md
  echo "Cleaned $ARTIFACTS eval artifact(s) from ~/.claude/commands/"
fi
