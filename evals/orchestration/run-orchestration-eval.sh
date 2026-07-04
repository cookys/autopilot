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

# Set output directory if not provided
if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$REPO_ROOT/evals/orchestration/runs/run-${TASK_ID}-${ARM}-${RUNNER}-$(date +%s)"
fi
mkdir -p "$OUT_DIR"

# Create a fresh temp directory for the repository copy
TEMP_REPO=$(mktemp -d -p "$REPO_ROOT" -t "eval-repo-${TASK_ID}-XXXXXX")

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
cat "$TASK_DIR/task.md" > "$PROMPT_FILE"
printf "\n\n" >> "$PROMPT_FILE"

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
SCRATCH_HOME=$(mktemp -d -p "$REPO_ROOT" -t "scratch-home-XXXXXX")
clean_scratch_home() {
  rm -rf "$SCRATCH_HOME"
}
trap 'clean_scratch_home; cleanup' EXIT

set +e
if [ "$RUNNER" = "cc" ]; then
  # cc -> claude -p with --setting-sources project, --strict-mcp-config, scratch HOME (no plugins)
  (
    cd "$TEMP_REPO"
    export HOME="$SCRATCH_HOME"
    timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config < "$PROMPT_FILE"
  ) > "$RAW_LOG" 2>&1
  RUN_EXIT=$?
elif [ "$RUNNER" = "agy" ]; then
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

  RUN_SH=$(mktemp -p "$REPO_ROOT" -t agy-run-XXXXXX.sh)
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
  (
    cd "$TEMP_REPO"
    timeout "$TIMEOUT_LIMIT" "$ORCH_STUB_BIN" "$PROMPT_FILE" < "$PROMPT_FILE"
  ) > "$RAW_LOG" 2>&1
  RUN_EXIT=$?
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

# Copy adjudicate-findings.js to temp repo scripts directory so that the test or agent can run it if needed,
# or we can run it.
mkdir -p "$TEMP_REPO/scripts"
cp "$REPO_ROOT/scripts/adjudicate-findings.js" "$TEMP_REPO/scripts/adjudicate-findings.js"

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
printf '{"task_id":"%s","arm":"%s","runner":"%s","model":"%s","runner_version":"%s","duration":%s,"oracle_pass":%s,"decoy_respected":%s,"fidelity_ok":%s,"adjudication_valid":%s,"patterns_named":%s,"probe_evidence_present":%s}\n' \
  "$TASK_ID" "$ARM" "$RUNNER" "$MODEL" "$runner_version_clean" "$DURATION" \
  "$oracle_pass" "$decoy_respected" "$fidelity_ok" "$adjudication_valid" \
  "$patterns_named" "$probe_evidence_present" > "$RESULT_JSON"

# Output to stdout
cat "$RESULT_JSON"
clean_scratch_home
