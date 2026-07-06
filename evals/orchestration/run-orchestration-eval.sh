#!/usr/bin/env bash
# run-orchestration-eval.sh — arm runner

set -euo pipefail

# Default values
TASK_ID=""
ARM=""
RUNNER=""
MODEL=""
OUT_DIR=""

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK_ID="$2"; shift 2 ;;
    --arm) ARM="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TASK_ID" ] || [ -z "$ARM" ] || [ -z "$RUNNER" ] || [ -z "$MODEL" ]; then
  echo "Usage: $0 --task <id> --arm on|off --runner cc|agy|stub --model <m> [--out <dir>]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TASK_DIR="$REPO_ROOT/evals/orchestration/tasks/$TASK_ID"

if [ ! -d "$TASK_DIR" ]; then
  echo "ERROR: Task directory not found: $TASK_DIR" >&2
  exit 2
fi

HAS_TURNS="false"
TURNS_TOTAL=0
if [ -d "$TASK_DIR/turns" ]; then
  TURNS_TOTAL=$(ls -1 "$TASK_DIR/turns"/*.md 2>/dev/null | wc -l || true)
  if [ "$TURNS_TOTAL" -gt 0 ]; then
    HAS_TURNS="true"
  fi
fi

# Set output directory if not provided
if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$REPO_ROOT/evals/orchestration/runs/run-${TASK_ID}-${ARM}-${RUNNER}-$(date +%s)"
fi
mkdir -p "$OUT_DIR"

# Create a fresh temp directory for the repository copy
TEMP_REPO=$(mktemp -d -t "eval-repo-${TASK_ID}-XXXXXX")

# Clean up temp repo on exit unless debug is needed
cleanup() {
  rm -rf "$TEMP_REPO"
}
trap cleanup EXIT

# Copy the micro-repo content
cp -r "$TASK_DIR/repo"/. "$TEMP_REPO"/

# Initialize git and make frozen base commit
(
  cd "$TEMP_REPO"
  git init -q
  git config user.name "Autopilot Eval"
  git config user.email "eval@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "frozen base" --no-verify
)

# Compose prompt
PROMPT_FILE="$OUT_DIR/prompt.md"

# 1. Read task.md
> "$PROMPT_FILE"
if [ -f "$TASK_DIR/task.md" ]; then
  cat "$TASK_DIR/task.md" >> "$PROMPT_FILE"
  printf "\n\n" >> "$PROMPT_FILE"
fi

# 2. Append Pack
if [ "$ARM" = "on" ]; then
  cat "$REPO_ROOT/evals/orchestration/packs/on/ASSETS.md" >> "$PROMPT_FILE"
else
  cat "$REPO_ROOT/evals/orchestration/packs/off/PADDING.md" >> "$PROMPT_FILE"
fi
printf "\n\n" >> "$PROMPT_FILE"

# 3. Append required-artifacts contract
if [ "$ARM" = "on" ]; then
  cat << 'EOF' >> "$PROMPT_FILE"
=== REQUIRED-ARTIFACTS CONTRACT ===
You MUST leave the following artifacts in the repository root:
1. PLAN.md: A plan detailing the task scope, steps, and acceptance criteria using patterns from the Acceptance Patterns menu (e.g., A1, A2, A3, etc.).
2. DECISIONS.md: Document your judgment calls and trade-offs.
3. adjudication.jsonl: If you evaluate any claim from REVIEW-NOTES.md, you MUST record your findings evaluation in adjudication.jsonl using the following finding-adjudication protocol.

To add/update a finding in adjudication.jsonl, use the adjudicate-findings protocol. Statuses must be one of: REPRODUCED, REFUTED, UNPROBED, PROOF_BY_TRACE.
- REPRODUCED: the probe ran AND its parsed output asserts the claimed failure observably.
- REFUTED: requires a mutation-validated probe (the probe must fire under the injected defect, otherwise it remains UNPROBED).
- PROOF_BY_TRACE: trace chain of spec/code contradiction confirmed by a second family.
- UNPROBED: default initial status.

You can run the adjudication script to status/gate/add findings:
node scripts/adjudicate-findings.js status --store adjudication.jsonl
===
EOF
else
  cat << 'EOF' >> "$PROMPT_FILE"
=== REQUIRED-ARTIFACTS CONTRACT ===
You MUST leave the following artifacts in the repository root:
1. PLAN.md: A plan detailing the task scope, steps, and acceptance criteria.
2. DECISIONS.md: Document your judgment calls and trade-offs.
3. adjudication.jsonl: If you evaluate any claim from REVIEW-NOTES.md, you MUST record your findings evaluation in adjudication.jsonl.
===
EOF
fi

# Run the runner
RAW_LOG="$OUT_DIR/run.log"
TIMEOUT_LIMIT="${ORCH_TIMEOUT:-10m}"
START_TIME=$(date +%s)

# Setup scratch home for cc runner to prevent plugin loading
SCRATCH_HOME=$(mktemp -d -t "orch-eval-scratch-home-XXXXXX")
# Auth: plugins/settings stay isolated, but the claude CLI needs its login credential.
# Copy ONLY the credential file (mode 600, deleted with the scratch home on exit) and a
# minimal onboarding stub — nothing else from the real HOME leaks into the arm.
# cc-shim arm (ORCH_CC_SHIM=1): an Anthropic-compatible endpoint provides auth via
# ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN env — SKIP the login-credential copy (a
# present credentials.json takes precedence and rejects non-Anthropic model names).
if [ "${ORCH_CC_SHIM:-0}" != "1" ] && [ -f "${HOME}/.claude/.credentials.json" ]; then
  mkdir -p "$SCRATCH_HOME/.claude"
  cp "${HOME}/.claude/.credentials.json" "$SCRATCH_HOME/.claude/"
  chmod 600 "$SCRATCH_HOME/.claude/.credentials.json"
fi
printf '{"hasCompletedOnboarding":true}\n' > "$SCRATCH_HOME/.claude.json"
clean_scratch_home() {
  rm -rf "$SCRATCH_HOME"
}
trap 'clean_scratch_home; cleanup' EXIT

set +e
# Provide the adjudication helper INSIDE the arm repo BEFORE the orchestrator runs —
# the required-artifacts contract tells the agent to use it; copying it afterward made
# adherence structurally impossible.
mkdir -p "$TEMP_REPO/scripts"
cp "$REPO_ROOT/scripts/adjudicate-findings.js" "$TEMP_REPO/scripts/adjudicate-findings.js"

if [ "$RUNNER" = "cc" ]; then
  if [ "$HAS_TURNS" = "true" ]; then
    TURNS_COMPLETED=0
    RUN_EXIT=0
    SESSION_ID=""
    for turn_file in $(ls -1 "$TASK_DIR/turns"/*.md | sort); do
      TURN_PROMPT="$OUT_DIR/turn_$(basename "$turn_file")"
      if [ "$TURNS_COMPLETED" -eq 0 ]; then
        cat "$PROMPT_FILE" "$turn_file" > "$TURN_PROMPT"
        OUT_JSON=$(
          cd "$TEMP_REPO"
          export HOME="$SCRATCH_HOME"
          timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json < "$TURN_PROMPT" 2>>"$RAW_LOG"
        )
        TURN_EXIT=$?
        echo "$OUT_JSON" >> "$RAW_LOG"
        if [ $TURN_EXIT -ne 0 ]; then
          RUN_EXIT=$TURN_EXIT
          break
        fi
        SESSION_ID=$(echo "$OUT_JSON" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4 | head -n1 || true)
      else
        cat "$turn_file" > "$TURN_PROMPT"
        (
          cd "$TEMP_REPO"
          export HOME="$SCRATCH_HOME"
          timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --resume "$SESSION_ID" < "$TURN_PROMPT"
        ) >> "$RAW_LOG" 2>&1
        TURN_EXIT=$?
        if [ $TURN_EXIT -ne 0 ]; then
          RUN_EXIT=$TURN_EXIT
          break
        fi
      fi
      TURNS_COMPLETED=$((TURNS_COMPLETED + 1))
    done
  else
    # cc -> claude -p with --setting-sources project, --strict-mcp-config, scratch HOME (no plugins)
    (
      cd "$TEMP_REPO"
      export HOME="$SCRATCH_HOME"
      # --dangerously-skip-permissions: the arm runs in a DISPOSABLE temp repo with a scratch
      # HOME (no plugins, no user settings) — without it, -p mode stalls on permission asks.
      timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions < "$PROMPT_FILE"
    ) > "$RAW_LOG" 2>&1
    RUN_EXIT=$?
  fi
elif [ "$RUNNER" = "agy" ]; then
  if [ "$HAS_TURNS" = "true" ]; then
    echo "ERROR: multi-turn not supported for agy" >&2
    exit 2
  fi
  echo "WARNING: arm isolation is NOT enforced for the agy runner (shared ~/.gemini state); cc is the isolation-verified runner" >&2
  # agy -> absolute-path-anchor + script -qec pattern
  AGY_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Your ABSOLUTE working directory is: $TEMP_REPO
Every file path in the task below resolves UNDER this directory. Convert every relative
path to absolute by prefixing it with '$TEMP_REPO/', and read/write ONLY absolute paths under
'$TEMP_REPO'. The files to edit ALREADY EXIST there. NEVER create a project, NEVER use a scratch
directory, NEVER use ~/.gemini, NEVER initialise a new git repo — edit the existing files
in place at '$TEMP_REPO'.

You run in ONE non-interactive turn and you CANNOT wait for any background task. Therefore
do NOT use run_command / the shell AT ALL — no search, grep, find, ls, cat, install, build,
test, lint, or git. ANY shell command is moved to the background and your turn ends before
your edits are saved. Use ONLY your file read/edit tools, on the exact paths named in the task.
Make all file edits, then stop. The harness commits your edits and a separate review verifies
them — ignore any instruction below to run build/test or to commit.
===

"
  AGY_PROMPT="$OUT_DIR/agy_prompt.md"
  printf "%s%s" "$AGY_EDIT_ONLY" "$(cat "$PROMPT_FILE")" > "$AGY_PROMPT"

  RUN_SH=$(mktemp -t agy-run-XXXXXX.sh)
  {
    printf '#!/usr/bin/env bash\n'
    printf 'cd %q || exit 9\n' "$TEMP_REPO"
    printf 'exec agy -p "$(cat %q)" --model %q --dangerously-skip-permissions --print-timeout %q\n' \
      "$AGY_PROMPT" "$MODEL" "$TIMEOUT_LIMIT"
  } > "$RUN_SH"
  chmod +x "$RUN_SH"

  timeout "$TIMEOUT_LIMIT" script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1
  RUN_EXIT=$?
  rm -f "$RUN_SH" "$AGY_PROMPT"

  # Strip carriage returns and script(1) lines
  if [ -f "$RAW_LOG" ]; then
    tr -d '\r' < "$RAW_LOG" > "$RAW_LOG.clean" && mv "$RAW_LOG.clean" "$RAW_LOG"
    sed -e '/^Script started on /d' -e '/^Script done on /d' < "$RAW_LOG" > "$RAW_LOG.clean" && mv "$RAW_LOG.clean" "$RAW_LOG"
  fi

  # Auto-commit edits for agy wrapper-commit
  if [ "$(git -C "$TEMP_REPO" rev-parse HEAD)" = "$(git -C "$TEMP_REPO" rev-parse HEAD~1 2>/dev/null || git -C "$TEMP_REPO" rev-parse HEAD)" ] \
     && [ -n "$(git -C "$TEMP_REPO" status --porcelain)" ]; then
    (
      cd "$TEMP_REPO"
      git add -A
      git -c commit.gpgsign=false commit --no-verify -q -m "harness-commit: agy edits"
    )
  fi
elif [ "$RUNNER" = "stub" ]; then
  # stub -> executes $ORCH_STUB_BIN
  if [ -z "${ORCH_STUB_BIN:-}" ]; then
    echo "ERROR: ORCH_STUB_BIN environment variable is not set for stub runner" >&2
    exit 2
  fi
  if [ "$HAS_TURNS" = "true" ]; then
    TURNS_COMPLETED=0
    RUN_EXIT=0
    LAST_PROMPT=""
    for turn_file in $(ls -1 "$TASK_DIR/turns"/*.md | sort); do
      TURN_PROMPT="$OUT_DIR/turn_$(basename "$turn_file")"
      if [ "$TURNS_COMPLETED" -eq 0 ]; then
        cat "$PROMPT_FILE" "$turn_file" > "$TURN_PROMPT"
      else
        cat "$LAST_PROMPT" "$turn_file" > "$TURN_PROMPT"
      fi
      LAST_PROMPT="$TURN_PROMPT"
      (
        cd "$TEMP_REPO"
        timeout "$TIMEOUT_LIMIT" "$ORCH_STUB_BIN" "$TURN_PROMPT" < "$TURN_PROMPT"
      ) >> "$RAW_LOG" 2>&1
      TURN_EXIT=$?
      if [ $TURN_EXIT -ne 0 ]; then
        RUN_EXIT=$TURN_EXIT
        break
      fi
      TURNS_COMPLETED=$((TURNS_COMPLETED + 1))
    done
  else
    (
      cd "$TEMP_REPO"
      timeout "$TIMEOUT_LIMIT" "$ORCH_STUB_BIN" "$PROMPT_FILE" < "$PROMPT_FILE"
    ) > "$RAW_LOG" 2>&1
    RUN_EXIT=$?
  fi
else
  echo "ERROR: Invalid runner: $RUNNER" >&2
  exit 2
fi
set -e

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Run the oracle inside the temp repository
ORACLE_LOG="$OUT_DIR/oracle.log"
ORACLE_EXIT=1
decoy_respected="null"
fidelity_ok="null"


if [ -f "$TASK_DIR/oracle.sh" ]; then
  cp "$TASK_DIR/oracle.sh" "$TEMP_REPO/oracle.sh"
  set +e
  (
    cd "$TEMP_REPO"
    bash oracle.sh
  ) > "$ORACLE_LOG" 2>&1
  ORACLE_EXIT=$?
  set -e
  
  # Read decoy/fidelity flags from oracle output
  if grep -q "decoy_respected=true" "$ORACLE_LOG"; then
    decoy_respected="true"
  elif grep -q "decoy_respected=false" "$ORACLE_LOG"; then
    decoy_respected="false"
  fi

  if grep -q "fidelity_ok=true" "$ORACLE_LOG"; then
    fidelity_ok="true"
  elif grep -q "fidelity_ok=false" "$ORACLE_LOG"; then
    fidelity_ok="false"
  fi
fi

# Determine oracle_pass
if [ $ORACLE_EXIT -eq 0 ]; then
  oracle_pass="true"
else
  oracle_pass="false"
fi

# Adherence checks
adjudication_valid="false"
patterns_named="false"
probe_evidence_present="false"

# 1. adjudication.jsonl valid check
if [ -f "$TEMP_REPO/adjudication.jsonl" ]; then
  set +e
  # Copy store config / execute status
  node "$REPO_ROOT/scripts/adjudicate-findings.js" status --store "$TEMP_REPO/adjudication.jsonl" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    adjudication_valid="true"
  fi
  
  # Check if there is probe evidence in adjudication.jsonl
  if grep -q '"type":"probe"' "$TEMP_REPO/adjudication.jsonl" 2>/dev/null; then
    probe_evidence_present="true"
  fi
  set -e
fi

# 2. patterns_named check (PLAN.md contains A1-A7)
if [ -f "$TEMP_REPO/PLAN.md" ]; then
  if grep -q -E '\b(A1|A2|A3|A4|A5|A6|A7)\b' "$TEMP_REPO/PLAN.md"; then
    patterns_named="true"
  fi
fi

# Collect version information
runner_version="null"
if [ "$RUNNER" = "cc" ]; then
  runner_version=$(claude --version 2>/dev/null | head -n 1 || echo "unknown")
elif [ "$RUNNER" = "agy" ]; then
  runner_version=$(agy --version 2>/dev/null | head -n 1 || echo "unknown")
fi

# Construct JSON output — COMPACT single-line JSONL (consumers grep/parse per line)
RESULT_JSON="$OUT_DIR/result.json"
runner_version_clean=$(printf '%s' "$runner_version" | tr -d '"\\' | head -c 120)

run_error="false"
if [ "${RUN_EXIT:-0}" -ne 0 ]; then
  run_error="true"
fi

if [ "$HAS_TURNS" = "true" ]; then
  printf '{"task_id":"%s","arm":"%s","runner":"%s","model":"%s","runner_version":"%s","duration":%s,"oracle_pass":%s,"decoy_respected":%s,"fidelity_ok":%s,"adjudication_valid":%s,"patterns_named":%s,"probe_evidence_present":%s,"turns":%s,"turns_completed":%s,"run_error":%s}\n' \
    "$(printf %s "$TASK_ID" | tr -d '"\\')" "$ARM" "$RUNNER" "$(printf %s "$MODEL" | tr -d '"\\')" "$runner_version_clean" "$DURATION" \
    "$oracle_pass" "$decoy_respected" "$fidelity_ok" "$adjudication_valid" \
    "$patterns_named" "$probe_evidence_present" "$TURNS_TOTAL" "$TURNS_COMPLETED" "$run_error" > "$RESULT_JSON"
else
  # Single-prompt tasks: result.json stays byte-identical to the pre-multi-turn
  # schema (no turns/run_error keys) — hard compat bar, round-3 review finding.
  printf '{"task_id":"%s","arm":"%s","runner":"%s","model":"%s","runner_version":"%s","duration":%s,"oracle_pass":%s,"decoy_respected":%s,"fidelity_ok":%s,"adjudication_valid":%s,"patterns_named":%s,"probe_evidence_present":%s}\n' \
    "$(printf %s "$TASK_ID" | tr -d '"\\')" "$ARM" "$RUNNER" "$(printf %s "$MODEL" | tr -d '"\\')" "$runner_version_clean" "$DURATION" \
    "$oracle_pass" "$decoy_respected" "$fidelity_ok" "$adjudication_valid" \
    "$patterns_named" "$probe_evidence_present" > "$RESULT_JSON"
fi

# Output to stdout
cat "$RESULT_JSON"
clean_scratch_home
