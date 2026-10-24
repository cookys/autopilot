#!/usr/bin/env bash
# run-orchestration-eval.sh — arm runner

set -euo pipefail

# Default values
TASK_ID=""
ARM=""
RUNNER=""
MODEL=""
OUT_DIR=""
REINJECT_FILE=""
# --pack / --contract exist so a SECOND experiment can reuse this harness without
# disturbing the original one. The ON/OFF arms answer "do the quality-floor assets
# help?", where the arms differ in BOTH the pack and the required-artifacts contract.
# A prose A/B (e.g. maximal vs proportional validation) needs the opposite: arms that
# differ in ONE thing only. Passing --pack for both arms and --contract on for both
# holds everything else equal. Unset ⇒ byte-identical behaviour to before.
PACK_FILE=""
CONTRACT_MODE=""
# --gate defaults to off (empty). observe records the per-turn verifier; enforce
# retries the same session. Neither path runs unless the flag is observe|enforce,
# so an unflagged run stays byte-identical.
GATE_MODE=""
GATE_MAX_RETRIES="2"
# violations reproduces the first-experiment retry (exit 1 only). violations+features
# also retries when the verifier exits 0 with a non-empty feature_gaps list.
GATE_RETRY_FEEDBACK="violations"
GATE_RETRY_FEEDBACK_SET=0
GATE_RETRIES=0
GATE_EXHAUSTED=false
GATE_ERROR=false
GATE_RETRIES_BY_TURN=""
GATE_VIOLATIONS_BY_TURN=""
GATE_TURN_FAILED=0
GATE_TURN_EXIT=0
# --hook-trace-dir DIR (cc runner): every claude call gets `--debug hooks --debug-file DIR/trace-turn<N>.log`.
# Independent of --gate, so a control arm can carry the very same flags as the hook arm (plan 3.1).
HOOK_TRACE_DIR=""
CC_TRACE=()

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK_ID="$2"; shift 2 ;;
    --arm) ARM="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --reinject) REINJECT_FILE="$2"; shift 2 ;;
    --gate) GATE_MODE="$2"; shift 2 ;;
    --hook-trace-dir) HOOK_TRACE_DIR="$2"; shift 2 ;;
    --gate-max-retries) GATE_MAX_RETRIES="$2"; shift 2 ;;
    --gate-retry-feedback) GATE_RETRY_FEEDBACK="$2"; GATE_RETRY_FEEDBACK_SET=1; shift 2 ;;
    --pack) PACK_FILE="$2"; shift 2 ;;
    --contract) CONTRACT_MODE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TASK_ID" ] || [ -z "$ARM" ] || [ -z "$RUNNER" ] || [ -z "$MODEL" ]; then
  echo "Usage: $0 --task <id> --arm on|off --runner cc|agy|stub --model <m> [--out <dir>] [--reinject <relpath>] [--gate off|observe|enforce|hook] [--gate-max-retries N] [--gate-retry-feedback violations|violations+features] [--pack <file>] [--contract on|off] [--hook-trace-dir <dir>]" >&2
  exit 2
fi
# Default the two overrides to the arm-derived values so an unflagged run is unchanged.
if [ -z "$CONTRACT_MODE" ]; then CONTRACT_MODE="$ARM"; fi
if [ -n "$PACK_FILE" ] && [ ! -r "$PACK_FILE" ]; then
  echo "ERROR: --pack file not readable: $PACK_FILE" >&2
  exit 2
fi
case "$CONTRACT_MODE" in on|off) ;; *) echo "ERROR: --contract must be on|off (got: $CONTRACT_MODE)" >&2; exit 2 ;; esac

# The claude calls run inside the temp repo, so a relative trace dir must be pinned now.
case "$HOOK_TRACE_DIR" in ""|/*) ;; *) HOOK_TRACE_DIR="$(pwd)/$HOOK_TRACE_DIR" ;; esac

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

REINJECT_SRC=""
if [ -n "$REINJECT_FILE" ]; then
  if [ "$HAS_TURNS" != "true" ]; then
    echo "ERROR: --reinject requires a multi-turn task" >&2
    exit 2
  fi
  REINJECT_SRC="$TASK_DIR/repo/$REINJECT_FILE"
  if [ ! -f "$REINJECT_SRC" ]; then
    echo "ERROR: Reinjection source not found: $REINJECT_SRC" >&2
    exit 2
  fi
fi

if ! [[ "$GATE_MAX_RETRIES" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --gate-max-retries must be a non-negative integer (got: $GATE_MAX_RETRIES)" >&2
  exit 2
fi
if [ -n "$GATE_MODE" ]; then
  case "$GATE_MODE" in
    off|observe|enforce|hook) ;;
    *) echo "ERROR: --gate must be off|observe|enforce|hook (got: $GATE_MODE)" >&2; exit 2 ;;
  esac
  if [ "$HAS_TURNS" != "true" ]; then
    echo "ERROR: --gate requires a multi-turn task" >&2
    exit 2
  fi
fi
case "$GATE_RETRY_FEEDBACK" in
  violations|violations+features) ;;
  *)
    echo "Usage: $0 --task <id> --arm on|off --runner cc|agy|stub --model <m> [--out <dir>] [--reinject <relpath>] [--gate off|observe|enforce|hook] [--gate-max-retries N] [--gate-retry-feedback violations|violations+features] [--pack <file>] [--contract on|off] [--hook-trace-dir <dir>]" >&2
    echo "ERROR: --gate-retry-feedback must be violations|violations+features (got: $GATE_RETRY_FEEDBACK)" >&2
    exit 2
    ;;
esac
if [ "$GATE_RETRY_FEEDBACK_SET" -eq 1 ] && [ -z "$GATE_MODE" ]; then
  echo "Usage: $0 --task <id> --arm on|off --runner cc|agy|stub --model <m> [--out <dir>] [--reinject <relpath>] [--gate off|observe|enforce|hook] [--gate-max-retries N] [--gate-retry-feedback violations|violations+features] [--pack <file>] [--contract on|off] [--hook-trace-dir <dir>]" >&2
  echo "ERROR: --gate-retry-feedback requires --gate" >&2
  exit 2
fi

# Verifier lives beside the task, derived from this script's repo root. It is
# never copied into TEMP_REPO.
GATE_VERIFIER="$TASK_DIR/gate/verify-turn.js"
if [ "$GATE_MODE" = "hook" ] && [ ! -f "$GATE_VERIFIER" ]; then
  echo "ERROR: --gate hook needs the task verifier: $GATE_VERIFIER" >&2
  exit 2
fi

# observe, enforce and hook all record the per-turn verifier verdict (gate.jsonl) and resume with
# --output-format json. Only enforce sends text back; hook leaves that to the installed Stop hook.
gate_records() {
  case "$GATE_MODE" in observe|enforce|hook) return 0 ;; esac
  return 1
}

# Fill CC_TRACE for claude call number $1 (empty when --hook-trace-dir is not given).
set_cc_trace() {
  CC_TRACE=()
  if [ -n "$HOOK_TRACE_DIR" ]; then
    mkdir -p "$HOOK_TRACE_DIR"
    CC_TRACE=(--debug hooks --debug-file "$HOOK_TRACE_DIR/trace-turn$1.log")
  fi
}

gate_gaps_nonempty() {
  GATE_JSON_PAYLOAD="$1" node -e 'const j=JSON.parse(process.env.GATE_JSON_PAYLOAD||"{}"); process.stdout.write(Array.isArray(j.feature_gaps)&&j.feature_gaps.length?"1":"0");'
}

# A turn is still reportable when this mode would have retried it. Observe never
# retries. The cap records gate_exhausted only when something reportable remains.
gate_turn_reportable() {
  local vexit="$1"
  local json="$2"
  if [ "$vexit" -eq 1 ]; then
    return 0
  fi
  if [ "$GATE_RETRY_FEEDBACK" = "violations+features" ] && [ "$vexit" -eq 0 ]; then
    [ "$(gate_gaps_nonempty "$json")" = "1" ]
    return $?
  fi
  return 1
}

gate_enforce_wants_retry() {
  local vexit="$1"
  local so_far="$2"
  local json="$3"
  [ "$GATE_MODE" = "enforce" ] || return 1
  [ "$so_far" -lt "$GATE_MAX_RETRIES" ] || return 1
  gate_turn_reportable "$vexit" "$json"
}

gate_write_retry() {
  local dest="$1"
  GATE_JSON_PAYLOAD="$2" GATE_RETRY_FEEDBACK="$GATE_RETRY_FEEDBACK" node -e '
const j = JSON.parse(process.env.GATE_JSON_PAYLOAD || "{}");
const real = Array.isArray(j.violations) ? j.violations : [];
const gaps = Array.isArray(j.feature_gaps) ? j.feature_gaps : [];
const withGaps = process.env.GATE_RETRY_FEEDBACK === "violations+features" && gaps.length > 0;
const violations = real.length
  ? real
  : (withGaps ? [] : [{ constraint: "?", rule: "unspecified", evidence: "verifier reported a violation" }]);
const lines = violations.map((v) =>
  "The change you just made breaks project rule " + v.constraint + ": `" + v.rule + "`. Observed: `" + v.evidence + "`. Fix this without removing any feature you were asked for, and keep every other rule."
);
let text = lines.length ? lines.join("\n\n") + "\n" : "";
if (withGaps) {
  const extra = gaps.map((gap) => "A feature you were asked for so far is not working yet: `" + gap + "`.");
  extra.push("Keep the parts that already work; do not delete or break any existing feature.");
  text += extra.join("\n") + "\n";
}
process.stdout.write(text);
' > "$dest"
}

# Copy TEMP_REPO before the retry prompt. The copy lives under OUT_DIR, so the
# model never sees it. A copy failure is logged and does not abort the run.
gate_take_snapshot() {
  local dest="$1"
  if cp -a "$TEMP_REPO" "$dest" >>"$RAW_LOG" 2>&1; then
    return 0
  fi
  echo "WARN: snapshot copy failed: $dest" >>"$RAW_LOG" || true
  return 0
}

gate_invoke_cc() {
  local prompt="$1"
  (
    cd "$TEMP_REPO"
    export HOME="$SCRATCH_HOME"
    timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json ${CC_TRACE[@]+"${CC_TRACE[@]}"} --resume "$SESSION_ID" < "$prompt"
  ) >> "$RAW_LOG" 2>&1
}

gate_invoke_stub() {
  local prompt="$1"
  (
    cd "$TEMP_REPO"
    timeout "$TIMEOUT_LIMIT" "$ORCH_STUB_BIN" "$prompt" < "$prompt"
  ) >> "$RAW_LOG" 2>&1
}

apply_gate() {
  local turn="$1"
  local runner_kind="$2"
  local retries=0
  local vexit=0
  local json=""
  local inv=0
  local vcount=0
  local retry_path=""
  GATE_TURN_FAILED=0
  while :; do
    vexit=0
    if [ ! -f "$GATE_VERIFIER" ]; then
      vexit=2
      json='{"turn":'"$turn"',"ok":false,"violations":[],"feature_gaps":[],"checked":[],"error":"verifier missing"}'
    else
      json=$(node "$GATE_VERIFIER" --turn "$turn" --repo "$TEMP_REPO" --json 2>>"$RAW_LOG") && vexit=0 || vexit=$?
    fi
    printf '%s\n' "$json" >> "$OUT_DIR/gate.jsonl"
    if [ "$vexit" -ne 0 ] && [ "$vexit" -ne 1 ]; then
      GATE_ERROR=true
      break
    fi
    if gate_enforce_wants_retry "$vexit" "$retries" "$json"; then
      retries=$((retries + 1))
      GATE_RETRIES=$((GATE_RETRIES + 1))
      retry_path="$OUT_DIR/retry_${turn}_${retries}.md"
      gate_write_retry "$retry_path" "$json"
      gate_take_snapshot "$OUT_DIR/snapshot_${turn}_${retries}"
      # GATE_RETRY_INVOCATION
      if [ "$runner_kind" = "cc" ]; then
        gate_invoke_cc "$retry_path"
      else
        gate_invoke_stub "$retry_path"
      fi
      inv=$?
      if [ "$inv" -ne 0 ]; then
        GATE_TURN_FAILED=1
        GATE_TURN_EXIT=$inv
        break
      fi
      continue
    fi
    if [ "$GATE_MODE" = "enforce" ] && gate_turn_reportable "$vexit" "$json"; then
      GATE_EXHAUSTED=true
    fi
    break
  done
  vcount=$(GATE_JSON_PAYLOAD="$json" node -e 'const j=JSON.parse(process.env.GATE_JSON_PAYLOAD||"{}"); process.stdout.write(String((j.violations||[]).length));' 2>/dev/null) || vcount=0
  GATE_RETRIES_BY_TURN="${GATE_RETRIES_BY_TURN:+$GATE_RETRIES_BY_TURN,}$retries"
  GATE_VIOLATIONS_BY_TURN="${GATE_VIOLATIONS_BY_TURN:+$GATE_VIOLATIONS_BY_TURN,}$vcount"
}

emit_reinject_block() {
  if [ -z "${REINJECT_SRC}" ]; then
    return 0
  fi
  printf '\n=== CONSTRAINTS REMINDER (harness re-injection — these invariants remain in force across all turns) ===\n' >> "$1"
  cat "$REINJECT_SRC" >> "$1"
  printf '\n===\n\n' >> "$1"
}

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
# GATE_REPO_COPY_ONLY
# The prompt tells the arm to use this helper, so it is part of the frozen harness
# base rather than an unexplained post-base repository effect.
mkdir -p "$TEMP_REPO/scripts"
cp "$REPO_ROOT/scripts/adjudicate-findings.js" "$TEMP_REPO/scripts/adjudicate-findings.js"

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
FROZEN_BASE_SHA="$(git -C "$TEMP_REPO" rev-parse HEAD)"

# --gate hook: install the opt-in per-turn-gate Stop hook into the temp repo's PROJECT settings (the
# task directory is never touched). It lands after the frozen base commit and is git-excluded, so the
# base and the run-effect check do not see it. The hook reads its knobs from a config file under OUT_DIR
# (enabled, cap 2, mode violations+features, verifier = the task's verify-turn.js) and logs to a live
# directory under OUT_DIR. --gate off / observe / enforce install nothing.
if [ "$GATE_MODE" = "hook" ]; then
  HOOK_STATE="$(cd "$OUT_DIR" && pwd)/hook"
  mkdir -p "$HOOK_STATE/live" "$TEMP_REPO/.claude"
  chmod 700 "$HOOK_STATE/live"
  GATE_VERIFIER="$GATE_VERIFIER" HOOK_CFG="$HOOK_STATE/config.json" node -e '
const fs = require("fs");
fs.writeFileSync(process.env.HOOK_CFG, JSON.stringify({
  hooks: { "per-turn-gate": true },
  per_turn_gate: { verifier: "node " + process.env.GATE_VERIFIER, mode: "violations+features", max_blocks: 2 },
}) + "\n");
'
  HOOK_CMD="AUTOPILOT_CONFIG_FILE='$HOOK_STATE/config.json' AUTOPILOT_LIVE_DIR='$HOOK_STATE/live' node '$REPO_ROOT/hooks/per-turn-gate.js'"
  HOOK_CMD="$HOOK_CMD" node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({ hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: process.env.HOOK_CMD, timeout: 60 }] }] } }, null, 2) + "\n");
' "$TEMP_REPO/.claude/settings.json"
  printf '.claude/\n' >> "$TEMP_REPO/.git/info/exclude"
fi

# Compose prompt
PROMPT_FILE="$OUT_DIR/prompt.md"

# 1. Read task.md
> "$PROMPT_FILE"
if [ -f "$TASK_DIR/task.md" ]; then
  cat "$TASK_DIR/task.md" >> "$PROMPT_FILE"
  printf "\n\n" >> "$PROMPT_FILE"
fi

# 2. Append Pack
if [ -n "$PACK_FILE" ]; then
  cat "$PACK_FILE" >> "$PROMPT_FILE"
elif [ "$ARM" = "on" ]; then
  cat "$REPO_ROOT/evals/orchestration/packs/on/ASSETS.md" >> "$PROMPT_FILE"
else
  cat "$REPO_ROOT/evals/orchestration/packs/off/PADDING.md" >> "$PROMPT_FILE"
fi
printf "\n\n" >> "$PROMPT_FILE"

# 3. Append required-artifacts contract
if [ "$CONTRACT_MODE" = "on" ]; then
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
if [ "$RUNNER" = "cc" ]; then
  if [ "$HAS_TURNS" = "true" ]; then
    TURNS_COMPLETED=0
    RUN_EXIT=0
    SESSION_ID=""
    for turn_file in $(ls -1 "$TASK_DIR/turns"/*.md | sort); do
      TURN_PROMPT="$OUT_DIR/turn_$(basename "$turn_file")"
      if [ "$TURNS_COMPLETED" -eq 0 ]; then
        cat "$PROMPT_FILE" > "$TURN_PROMPT"
        emit_reinject_block "$TURN_PROMPT"
        cat "$turn_file" >> "$TURN_PROMPT"
        set_cc_trace 1
        OUT_JSON=$(
          cd "$TEMP_REPO"
          export HOME="$SCRATCH_HOME"
          timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json ${CC_TRACE[@]+"${CC_TRACE[@]}"} < "$TURN_PROMPT" 2>>"$RAW_LOG"
        )
        TURN_EXIT=$?
        echo "$OUT_JSON" >> "$RAW_LOG"
        if [ $TURN_EXIT -ne 0 ]; then
          RUN_EXIT=$TURN_EXIT
          break
        fi
        SESSION_ID=$(echo "$OUT_JSON" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4 | head -n1 || true)
      else
        : > "$TURN_PROMPT"
        emit_reinject_block "$TURN_PROMPT"
        cat "$turn_file" >> "$TURN_PROMPT"
        set_cc_trace "$((TURNS_COMPLETED + 1))"
        (
          cd "$TEMP_REPO"
          export HOME="$SCRATCH_HOME"
          if gate_records; then
            timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json ${CC_TRACE[@]+"${CC_TRACE[@]}"} --resume "$SESSION_ID" < "$TURN_PROMPT"
          else
            timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --setting-sources project --strict-mcp-config --dangerously-skip-permissions ${CC_TRACE[@]+"${CC_TRACE[@]}"} --resume "$SESSION_ID" < "$TURN_PROMPT"
          fi
        ) >> "$RAW_LOG" 2>&1
        TURN_EXIT=$?
        if [ $TURN_EXIT -ne 0 ]; then
          RUN_EXIT=$TURN_EXIT
          break
        fi
      fi
      if gate_records; then
        apply_gate "$((TURNS_COMPLETED + 1))" cc
        if [ "$GATE_TURN_FAILED" -eq 1 ]; then
          RUN_EXIT=$GATE_TURN_EXIT
          break
        fi
        # Verifier exit 2 is an infra failure. Do not call the model for later turns.
        if [ "$GATE_ERROR" = "true" ]; then
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
        cat "$PROMPT_FILE" > "$TURN_PROMPT"
        emit_reinject_block "$TURN_PROMPT"
        cat "$turn_file" >> "$TURN_PROMPT"
      else
        cat "$LAST_PROMPT" > "$TURN_PROMPT"
        emit_reinject_block "$TURN_PROMPT"
        cat "$turn_file" >> "$TURN_PROMPT"
      fi
      LAST_PROMPT="$TURN_PROMPT"
      # A stub that emulates the Stop hooks appends its "Hooks: Stop [...]" lines here (stub runner only).
      if [ -n "$HOOK_TRACE_DIR" ]; then mkdir -p "$HOOK_TRACE_DIR"; export ORCH_STUB_TRACE_FILE="$HOOK_TRACE_DIR/trace-turn$((TURNS_COMPLETED + 1)).log"; fi
      (
        cd "$TEMP_REPO"
        timeout "$TIMEOUT_LIMIT" "$ORCH_STUB_BIN" "$TURN_PROMPT" < "$TURN_PROMPT"
      ) >> "$RAW_LOG" 2>&1
      TURN_EXIT=$?
      if [ $TURN_EXIT -ne 0 ]; then
        RUN_EXIT=$TURN_EXIT
        break
      fi
      if gate_records; then
        apply_gate "$((TURNS_COMPLETED + 1))" stub
        if [ "$GATE_TURN_FAILED" -eq 1 ]; then
          RUN_EXIT=$GATE_TURN_EXIT
          break
        fi
        # Verifier exit 2 is an infra failure. Do not call the model for later turns.
        if [ "$GATE_ERROR" = "true" ]; then
          break
        fi
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

# Classify every failed row from observable harness evidence.  Keep both fields on
# successful rows as null so old successful results remain scoreable.  Causes are
# deliberately a closed, content-free vocabulary: result.json must never copy raw
# provider/oracle logs.
failure_class="null"
failure_cause="null"
if [ "$oracle_pass" = "false" ]; then
  failure_class='"capability_fail"'
  failure_cause='"oracle_rejected"'

  run_effect="false"
  if [ "$(git -C "$TEMP_REPO" rev-parse HEAD)" != "$FROZEN_BASE_SHA" ] \
      || git -C "$TEMP_REPO" status --porcelain \
        | grep -Ev '^\?\? oracle\.sh$' \
        | grep -q .; then
    run_effect="true"
  fi

  if [ "${RUN_EXIT:-0}" -eq 124 ] || [ "${RUN_EXIT:-0}" -eq 137 ]; then
    failure_class='"infra_fail"'
    failure_cause='"runner_timeout"'
  elif [ "${RUN_EXIT:-0}" -ne 0 ] \
      && grep -Eqi '(^|[^a-z])(unauthorized|forbidden|authentication|invalid[ _-]?(api[ _-]?)?key|login required|token expired)([^a-z]|$)' "$RAW_LOG" 2>/dev/null; then
    failure_class='"infra_fail"'
    failure_cause='"authentication"'
  elif [ "${RUN_EXIT:-0}" -ne 0 ]; then
    failure_class='"infra_fail"'
    failure_cause='"runner_error"'
  elif [ ! -s "$RAW_LOG" ] && [ "$run_effect" = "false" ]; then
    failure_class='"infra_fail"'
    failure_cause='"empty_output"'
  elif [ ! -f "$TASK_DIR/oracle.sh" ]; then
    failure_class='"infra_fail"'
    failure_cause='"missing_oracle"'
  elif ! bash -n "$TASK_DIR/oracle.sh" >/dev/null 2>&1 \
      || [ "$ORACLE_EXIT" -eq 126 ] || [ "$ORACLE_EXIT" -eq 127 ]; then
    failure_class='"infra_fail"'
    failure_cause='"oracle_error"'
  fi
fi

if [ "$GATE_ERROR" = "true" ]; then
  failure_class='"infra_fail"'
  failure_cause='"gate_error"'
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

REINJECT_JSON_FRAGMENT=""
if [ -n "${REINJECT_SRC:-}" ]; then
  REINJECT_JSON_FRAGMENT=',"reinject":"'"$(printf '%s' "$REINJECT_FILE" | tr -d '"\\')"'"'
fi
GATE_JSON_FRAGMENT=""
if gate_records; then
  GATE_JSON_FRAGMENT=$(printf ',"gate":"%s","gate_retries":%s,"gate_retries_by_turn":[%s],"gate_violations_by_turn":[%s],"gate_exhausted":%s,"gate_error":%s,"gate_retry_feedback":"%s"' \
    "$GATE_MODE" "$GATE_RETRIES" "$GATE_RETRIES_BY_TURN" "$GATE_VIOLATIONS_BY_TURN" "$GATE_EXHAUSTED" "$GATE_ERROR" "$GATE_RETRY_FEEDBACK")
fi

if [ "$HAS_TURNS" = "true" ]; then
  printf '{"task_id":"%s","arm":"%s","runner":"%s","model":"%s","runner_version":"%s","duration":%s,"oracle_pass":%s,"failure_class":%s,"failure_cause":%s,"decoy_respected":%s,"fidelity_ok":%s,"adjudication_valid":%s,"patterns_named":%s,"probe_evidence_present":%s,"turns":%s,"turns_completed":%s,"run_error":%s%s}\n' \
    "$(printf %s "$TASK_ID" | tr -d '"\\')" "$ARM" "$RUNNER" "$(printf %s "$MODEL" | tr -d '"\\')" "$runner_version_clean" "$DURATION" \
    "$oracle_pass" "$failure_class" "$failure_cause" "$decoy_respected" "$fidelity_ok" "$adjudication_valid" \
    "$patterns_named" "$probe_evidence_present" "$TURNS_TOTAL" "$TURNS_COMPLETED" "$run_error" "$REINJECT_JSON_FRAGMENT$GATE_JSON_FRAGMENT" > "$RESULT_JSON"
else
  # Single-prompt tasks still omit turns/run_error; failure truth is additive.
  printf '{"task_id":"%s","arm":"%s","runner":"%s","model":"%s","runner_version":"%s","duration":%s,"oracle_pass":%s,"failure_class":%s,"failure_cause":%s,"decoy_respected":%s,"fidelity_ok":%s,"adjudication_valid":%s,"patterns_named":%s,"probe_evidence_present":%s}\n' \
    "$(printf %s "$TASK_ID" | tr -d '"\\')" "$ARM" "$RUNNER" "$(printf %s "$MODEL" | tr -d '"\\')" "$runner_version_clean" "$DURATION" \
    "$oracle_pass" "$failure_class" "$failure_cause" "$decoy_respected" "$fidelity_ok" "$adjudication_valid" \
    "$patterns_named" "$probe_evidence_present" > "$RESULT_JSON"
fi

# Output to stdout
cat "$RESULT_JSON"
clean_scratch_home
