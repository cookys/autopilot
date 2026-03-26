#!/usr/bin/env bash
# Run eval-only for all 10 autopilot skills (no improve loop).
# Uses run_eval.py from skill-creator directly.
set -euo pipefail

AUTOPILOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_CREATOR_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
RESULTS_BASE="$AUTOPILOT_DIR/skill-creator-workspace/results"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)

SKILLS=(audit ceo-agent dev-flow learn next project-lifecycle quality-pipeline retro survey think-tank)

echo "=== Batch Eval — $TIMESTAMP ==="
echo "Running ${#SKILLS[@]} skills"
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
    --num-workers 10 \
    --timeout 30 \
    --runs-per-query 1 \
    --model claude-sonnet-4-6 \
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
