#!/usr/bin/env bash
# run-pipeline-bench.sh — pipeline vs bare bench harness

set -euo pipefail

TASK_ID=""
ARM=""
MODEL=""
OUT_DIR=""
REVIEWER_MODEL="gpt-5.5"
REVIEWER_RUNNER="codex"
MAX_ROUNDS=3
SHIM=0

while [ $# -gt 0 ]; do
  case "$1" in
    --task)
      if [[ "$2" == /* ]]; then
        echo "ERROR: --task must not be an absolute path" >&2
        exit 2
      fi
      if [ -d "$2" ]; then
        TASK_ID="$(cd "$2" && pwd)"
      elif [[ "$2" == ./* ]] || [[ "$2" == ../* ]]; then
        TASK_ID="$(pwd)/$2"
      else
        TASK_ID="$2"
      fi
      shift 2
      ;;
    --arm) ARM="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --out)
      mkdir -p "$2"
      OUT_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --reviewer-model) REVIEWER_MODEL="$2"; shift 2 ;;
    --reviewer-runner) REVIEWER_RUNNER="$2"; shift 2 ;;
    --max-rounds)
      if ! [[ "$2" =~ ^[1-9][0-9]*$ ]]; then
        echo "ERROR: --max-rounds must be a positive integer" >&2
        exit 2
      fi
      MAX_ROUNDS="$2"
      shift 2
      ;;
    --shim) SHIM=1; shift 1 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TASK_ID" ] || [ -z "$ARM" ] || [ -z "$MODEL" ] || [ -z "$OUT_DIR" ]; then
  echo "Usage: $0 --task <task-id> --arm bare|pipeline --model <m> --out <dir> [--reviewer-model <m>] [--reviewer-runner <r>] [--max-rounds <n>] [--shim]" >&2
  exit 2
fi

if [ "$ARM" != "bare" ] && [ "$ARM" != "pipeline" ]; then
  echo "ERROR: --arm must be bare or pipeline" >&2
  exit 2
fi

if [ "$SHIM" -eq 1 ]; then
  export ORCH_CC_SHIM=1
  if [ -z "${ANTHROPIC_BASE_URL:-}" ] || [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
    echo "ERROR: --shim requires ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN" >&2
    exit 2
  fi
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$TASK_ID" == /* ]]; then
  TASK_DIR="$TASK_ID"
else
  TASK_DIR="$REPO_ROOT/evals/orchestration/tasks/$TASK_ID"
fi

if [ ! -d "$TASK_DIR" ]; then
  echo "ERROR: Task directory not found: $TASK_DIR" >&2
  exit 2
fi

if [ -z "${PIPELINE_BENCH_REVIEW_CMD:-}" ] && [ ! -f "$REPO_ROOT/scripts/dispatch-review.sh" ]; then
  echo "ERROR: Missing required scripts" >&2
  exit 2
fi
if [ ! -f "$REPO_ROOT/scripts/error-path-scan.sh" ] || [ ! -f "$REPO_ROOT/scripts/secret-scan-diff.js" ]; then
  echo "ERROR: Missing required scripts" >&2
  exit 2
fi

TEMP_REPO=$(mktemp -d -t "pipeline-eval-repo-$(basename "$TASK_ID")-XXXXXX")
SCRATCH_HOME=$(mktemp -d -t "orch-eval-scratch-home-XXXXXX")

cleanup() {
  rm -rf "$TEMP_REPO"
  rm -rf "$SCRATCH_HOME"
}
trap cleanup EXIT

cp -r "$TASK_DIR/repo"/. "$TEMP_REPO"/

(
  cd "$TEMP_REPO"
  git init -q
  git config user.name "Autopilot Eval"
  git config user.email "eval@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "frozen base" --no-verify --allow-empty
)
BASE_SHA=$(git -C "$TEMP_REPO" rev-parse HEAD)

if [ "${ORCH_CC_SHIM:-0}" != "1" ] && [ -f "${HOME}/.claude/.credentials.json" ]; then
  mkdir -p "$SCRATCH_HOME/.claude"
  cp "${HOME}/.claude/.credentials.json" "$SCRATCH_HOME/.claude/"
  chmod 600 "$SCRATCH_HOME/.claude/.credentials.json"
fi
printf '{"hasCompletedOnboarding":true}\n' > "$SCRATCH_HOME/.claude.json"

RAW_LOG="$OUT_DIR/run.log"
TIMEOUT_LIMIT="${ORCH_TIMEOUT:-10m}"
START_TIME=$(date +%s)

# Round 1
PROMPT_FILE="$OUT_DIR/prompt_1.md"
cp "$TASK_DIR/task.md" "$PROMPT_FILE"

RUN_EXIT=0
OUT_JSON=$(
  cd "$TEMP_REPO"
  export HOME="$SCRATCH_HOME"
  timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json < "$PROMPT_FILE" 2>>"$RAW_LOG"
) || RUN_EXIT=$?
echo "$OUT_JSON" >> "$RAW_LOG"
echo "$OUT_JSON" >> "$OUT_DIR/all_outs.jsonl"

(
  cd "$TEMP_REPO"
  git add -A
  git commit -q -m "round-1" --no-verify --allow-empty
)

ROUNDS=1
CONVERGED="null"
REVIEW_VERDICTS="[]"
GATE_BLOCKED="false"
ADVISORY_FINDINGS=0
REPS_NOTE="null"

if [ "$ARM" = "pipeline" ]; then
  while true; do
    diff_file="$OUT_DIR/diff_${ROUNDS}.diff"
    git -C "$TEMP_REPO" diff $BASE_SHA..HEAD > "$diff_file"
    
    if [ ! -s "$diff_file" ]; then
      REPS_NOTE="\"no_op\""
      break
    fi
    
    # L0 gates
    set +e
    ( cd "$TEMP_REPO" && node "$REPO_ROOT/scripts/secret-scan-diff.js" --range $BASE_SHA..HEAD > /dev/null 2>&1 )
    SECRET_RC=$?
    
    ( cd "$TEMP_REPO" && bash "$REPO_ROOT/scripts/error-path-scan.sh" --range $BASE_SHA..HEAD > "$OUT_DIR/error_scan_${ROUNDS}.json" 2>/dev/null )
    set -e
    
    if [ "$SECRET_RC" -eq 1 ]; then
      GATE_BLOCKED="true"
    fi
    
    adv_count=$(python3 -c 'import sys, json; print(len(json.load(sys.stdin).get("findings", [])))' < "$OUT_DIR/error_scan_${ROUNDS}.json" 2>/dev/null || echo 0)
    ADVISORY_FINDINGS=$(( ADVISORY_FINDINGS + adv_count ))
    
    if [ -n "${PIPELINE_BENCH_REVIEW_CMD:-}" ]; then
      verdict_json=$($PIPELINE_BENCH_REVIEW_CMD --runner "$REVIEWER_RUNNER" --model "$REVIEWER_MODEL" --diff-file "$diff_file" --spec-file "$TASK_DIR/task.md" 2>>"$RAW_LOG") || true
    else
      verdict_json=$(bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner "$REVIEWER_RUNNER" --model "$REVIEWER_MODEL" --diff-file "$diff_file" --spec-file "$TASK_DIR/task.md" 2>>"$RAW_LOG") || true
    fi
    echo "$verdict_json" > "$OUT_DIR/review_${ROUNDS}.json"
    VERDICT=$(echo "$verdict_json" | python3 -c 'import sys, json; print(json.loads(sys.stdin.read()).get("verdict", "null"))' 2>/dev/null || echo "null")
    FINDINGS=$(echo "$verdict_json" | python3 -c 'import sys, json; print(json.loads(sys.stdin.read()).get("findings", ""))' 2>/dev/null || echo "")
    
    if [ "$REVIEW_VERDICTS" = "[]" ]; then
      REVIEW_VERDICTS="[\"$VERDICT\"]"
    else
      REVIEW_VERDICTS="${REVIEW_VERDICTS%]},\"$VERDICT\"]"
    fi
    
    # Secret gate block implies a failed round, overriding SHIP-AS-IS for the loop exit
    if [ "$VERDICT" = "SHIP-AS-IS" ] && [ "$SECRET_RC" -ne 1 ]; then
      CONVERGED="true"
      break
    fi
    
    if [ "$SECRET_RC" -eq 1 ]; then
      FINDINGS="[L0 GATE BLOCKED] Secret scan found exposed credentials. Please remove them.\n\n$FINDINGS"
    fi
    
    if [ "$ROUNDS" -ge "$MAX_ROUNDS" ]; then
      CONVERGED="false"
      break
    fi
    
    ROUNDS=$(( ROUNDS + 1 ))
    NEXT_PROMPT_FILE="$OUT_DIR/prompt_${ROUNDS}.md"
    
    cat "$TASK_DIR/task.md" > "$NEXT_PROMPT_FILE"
    echo -e "\n\nA reviewer found these issues in your previous attempt (diff below). Fix them; keep everything else.\n" >> "$NEXT_PROMPT_FILE"
    echo "$FINDINGS" >> "$NEXT_PROMPT_FILE"
    echo -e "\n\`\`\`diff" >> "$NEXT_PROMPT_FILE"
    cat "$diff_file" >> "$NEXT_PROMPT_FILE"
    echo "\`\`\`" >> "$NEXT_PROMPT_FILE"
    
    OUT_JSON=$(
      cd "$TEMP_REPO"
      export HOME="$SCRATCH_HOME"
      timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json < "$NEXT_PROMPT_FILE" 2>>"$RAW_LOG"
    ) || RUN_EXIT=$?
    echo "$OUT_JSON" >> "$RAW_LOG"
    echo "$OUT_JSON" >> "$OUT_DIR/all_outs.jsonl"
    
    (
      cd "$TEMP_REPO"
      git add -A
      git commit -q -m "round-${ROUNDS}" --no-verify --allow-empty
    )
  done
fi

changed_files=$(git -C "$TEMP_REPO" diff --name-only $BASE_SHA..HEAD | grep -v '^$' | wc -l | tr -d ' ')

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

ORACLE_LOG="$OUT_DIR/oracle.log"
ORACLE_EXIT=1

if [ -f "$TASK_DIR/oracle.sh" ]; then
  set +e
  (
    cd "$TEMP_REPO"
    bash "$TASK_DIR/oracle.sh" "$TEMP_REPO"
  ) > "$ORACLE_LOG" 2>&1
  ORACLE_EXIT=$?
  set -e
fi

if [ $ORACLE_EXIT -eq 0 ]; then
  oracle_pass="true"
else
  oracle_pass="false"
fi

run_error="false"
if [ "$RUN_EXIT" -ne 0 ]; then
  run_error="true"
fi

cat > "$OUT_DIR/extract_tokens.py" << 'EOF'
import sys, json
rounds = []
try:
    with open(sys.argv[1], 'r') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                j = json.loads(line)
                u = j.get("usage") or j.get("tokens")
                if isinstance(u, dict):
                    rounds.append(u)
            except Exception:
                pass
except Exception:
    pass
if len(rounds) == 1:
    print(json.dumps(rounds[0]))
elif len(rounds) > 1:
    print(json.dumps({"rounds": rounds}))
EOF

TOKENS_JSON=$(python3 "$OUT_DIR/extract_tokens.py" "$OUT_DIR/all_outs.jsonl" 2>/dev/null || echo "")
if [ -z "$TOKENS_JSON" ]; then
  TOKENS_JSON="null"
fi

RESULT_JSON="$OUT_DIR/result.json"

TASK_ID="$TASK_ID" ARM="$ARM" MODEL="$MODEL" REPS_NOTE="$REPS_NOTE" ORACLE_PASS="$oracle_pass" DURATION="$DURATION" ROUNDS="$ROUNDS" CONVERGED="$CONVERGED" REVIEW_VERDICTS="$REVIEW_VERDICTS" GATE_BLOCKED="$GATE_BLOCKED" ADVISORY_FINDINGS="$ADVISORY_FINDINGS" CHANGED_FILES="$changed_files" TOKENS_JSON="$TOKENS_JSON" RUN_ERROR="$run_error" python3 -c 'import os, json; print(json.dumps({"task_id": os.environ["TASK_ID"], "arm": os.environ["ARM"], "model": os.environ["MODEL"], "reps_note": json.loads(os.environ["REPS_NOTE"]), "oracle_pass": json.loads(os.environ["ORACLE_PASS"]), "duration_total_s": int(os.environ["DURATION"]), "rounds": int(os.environ["ROUNDS"]), "converged": json.loads(os.environ["CONVERGED"]), "review_verdicts": json.loads(os.environ["REVIEW_VERDICTS"]), "gate_blocked": json.loads(os.environ["GATE_BLOCKED"]), "advisory_findings": int(os.environ["ADVISORY_FINDINGS"]), "changed_files": int(os.environ["CHANGED_FILES"]), "tokens": json.loads(os.environ["TOKENS_JSON"]), "run_error": json.loads(os.environ["RUN_ERROR"])}, separators=(",",":")))' > "$RESULT_JSON"

cat "$RESULT_JSON"

exit 0
