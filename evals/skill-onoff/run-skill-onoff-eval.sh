#!/usr/bin/env bash
# run-skill-onoff-eval.sh — single-run arm runner for the depth-0 skill ON/OFF instrument.
#
# Measures whether skills/dev-flow content, loaded as a REAL plugin skill at depth 0
# (routing + loading channel, not prompt injection), changes orchestrator behavior on
# micro-tasks with deterministic markers. Three arms: full | card | off — the ONLY
# variable is the dev-flow pack content; companion roster, prompt bytes, and repo
# fixtures are identical across arms (plan: docs/plans/2026-08-18-dev-flow-contract-card.md §3).
#
# Usage:
#   run-skill-onoff-eval.sh --task d1-s-tiny-feature --arm full|card|off \
#     --model <model> [--out <dir>] [--rep <n>] [--runner cc|stub]
#
# Env: ONOFF_TIMEOUT (default 10m) · ONOFF_STUB_BIN (required for --runner stub)
# Emits: $OUT/result.json (single-line JSONL row), $OUT/transcript.jsonl, $OUT/prompt.md
# Exit: 0 = row emitted (marker outcomes live IN the row) · 2 = harness/config error

set -euo pipefail

TASK_ID=""; ARM=""; MODEL=""; OUT_DIR=""; REP="1"; RUNNER="cc"
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK_ID="$2"; shift 2 ;;
    --arm) ARM="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --rep) REP="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$TASK_ID" ] || [ -z "$ARM" ] || [ -z "$MODEL" ]; then
  echo "Usage: $0 --task <id> --arm full|card|off --model <m> [--out <dir>] [--rep <n>] [--runner cc|stub]" >&2
  exit 2
fi
case "$ARM" in full|card|off) ;; *) echo "ERROR: arm must be full|card|off" >&2; exit 2 ;; esac
case "$RUNNER" in cc|stub) ;; *) echo "ERROR: runner must be cc|stub" >&2; exit 2 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$REPO_ROOT/evals/skill-onoff"
TASK_DIR="$BASE_DIR/tasks/$TASK_ID"
PACKS_DIR="$BASE_DIR/packs"
[ -d "$TASK_DIR" ] || { echo "ERROR: task dir not found: $TASK_DIR" >&2; exit 2; }
[ -f "$TASK_DIR/task.md" ] || { echo "ERROR: task.md missing: $TASK_DIR" >&2; exit 2; }
[ -f "$TASK_DIR/markers.sh" ] || { echo "ERROR: markers.sh missing: $TASK_DIR" >&2; exit 2; }

if [ -z "$OUT_DIR" ]; then OUT_DIR=$(mktemp -d -t "onoff-out-${TASK_ID}-${ARM}-XXXXXX"); fi
mkdir -p "$OUT_DIR"

# ── digest integrity: every pack file consumed must match the frozen manifest ──
verify_pack() { # $1 = pack key (e.g. dev-flow-card)
  node -e '
    const fs=require("fs"),crypto=require("crypto"),path=require("path");
    const [packsDir,key]=process.argv.slice(1);
    const man=JSON.parse(fs.readFileSync(path.join(packsDir,"manifest.json"),"utf8"));
    const files=(man.packs||{})[key];
    if(!files){console.error(`manifest has no pack: ${key}`);process.exit(2);}
    for(const [rel,digest] of Object.entries(files)){
      const p=path.join(packsDir,rel);
      const got=crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      if(got!==digest){console.error(`digest mismatch: ${rel}`);process.exit(2);}
    }
  ' "$PACKS_DIR" "$1"
}

# ── temp repo with per-task branch topology (frozen fixture: repo/ + init-repo.sh) ──
TEMP_REPO=$(mktemp -d -t "onoff-repo-${TASK_ID}-XXXXXX")
SCRATCH_HOME=$(mktemp -d -t "onoff-home-XXXXXX")
SCRATCH_CONFIG="$SCRATCH_HOME/.claude-config"
SCRATCH_PLUGIN=$(mktemp -d -t "onoff-plugin-XXXXXX")
cleanup() { rm -rf "$TEMP_REPO" "$SCRATCH_HOME" "$SCRATCH_PLUGIN"; }
trap cleanup EXIT

cp -r "$TASK_DIR/repo"/. "$TEMP_REPO"/
(
  cd "$TEMP_REPO"
  git init -q
  git config user.name "Autopilot Eval"; git config user.email "eval@example.com"
  git config commit.gpgsign false
  # Task-owned branch topology (d3/d7: develop default + main; d4: main default + develop).
  # init-repo.sh runs AFTER files land and owns all branch/commit layout.
  bash "$TASK_DIR/init-repo.sh"
)
FROZEN_BASE_SHA="$(git -C "$TEMP_REPO" rev-parse HEAD)"

# ── synthetic plugin: companions identical across arms; dev-flow per arm ──
mkdir -p "$SCRATCH_PLUGIN/.claude-plugin"
printf '{"name":"autopilot","version":"0.0.1","description":"skill-onoff eval plugin"}\n' \
  > "$SCRATCH_PLUGIN/.claude-plugin/plugin.json"
for comp in "$PACKS_DIR/companions"/*/; do
  [ -d "$comp" ] || continue
  name=$(basename "$comp")
  mkdir -p "$SCRATCH_PLUGIN/skills/$name"
  cp -r "$comp". "$SCRATCH_PLUGIN/skills/$name/"
done
verify_pack "companions"
case "$ARM" in
  full)
    verify_pack "dev-flow-full"
    mkdir -p "$SCRATCH_PLUGIN/skills/dev-flow"
    cp -r "$PACKS_DIR/dev-flow-full"/. "$SCRATCH_PLUGIN/skills/dev-flow/" ;;
  card)
    verify_pack "dev-flow-card"
    mkdir -p "$SCRATCH_PLUGIN/skills/dev-flow"
    cp -r "$PACKS_DIR/dev-flow-card"/. "$SCRATCH_PLUGIN/skills/dev-flow/" ;;
  off) : ;; # dev-flow absent — plugin + companion catalog still present
esac

# ── scratch HOME + scratch CLAUDE_CONFIG_DIR, credentials-only seeding ──
# NEVER point CLAUDE_CONFIG_DIR at the real ~/.claude (it gets reset); an UNSET
# config dir can leak the operator's installed plugins into the OFF arm (G1-F9),
# so both HOME and CLAUDE_CONFIG_DIR are always exported to scratch paths.
mkdir -p "$SCRATCH_CONFIG"
if [ "$RUNNER" = "cc" ] && [ -f "${HOME}/.claude/.credentials.json" ]; then
  cp "${HOME}/.claude/.credentials.json" "$SCRATCH_CONFIG/"
  chmod 600 "$SCRATCH_CONFIG/.credentials.json"
fi
printf '{"hasCompletedOnboarding":true}\n' > "$SCRATCH_HOME/.claude.json"

# ── prompt: task.md VERBATIM — byte-identical across arms, no artifacts contract ──
PROMPT_FILE="$OUT_DIR/prompt.md"
cp "$TASK_DIR/task.md" "$PROMPT_FILE"

TRANSCRIPT="$OUT_DIR/transcript.jsonl"
RAW_ERR="$OUT_DIR/stderr.log"
TIMEOUT_LIMIT="${ONOFF_TIMEOUT:-10m}"
START_TIME=$(date +%s)

set +e
if [ "$RUNNER" = "cc" ]; then
  (
    cd "$TEMP_REPO"
    export HOME="$SCRATCH_HOME"
    export CLAUDE_CONFIG_DIR="$SCRATCH_CONFIG"
    timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" \
      --plugin-dir "$SCRATCH_PLUGIN" \
      --setting-sources project --strict-mcp-config --dangerously-skip-permissions \
      --output-format stream-json --verbose < "$PROMPT_FILE"
  ) > "$TRANSCRIPT" 2> "$RAW_ERR"
  RUN_EXIT=$?
else
  [ -n "${ONOFF_STUB_BIN:-}" ] || { echo "ERROR: ONOFF_STUB_BIN not set for stub runner" >&2; exit 2; }
  (
    cd "$TEMP_REPO"
    # stub runs under the SAME isolation exports as cc, so the tests exercise them
    export HOME="$SCRATCH_HOME"
    export CLAUDE_CONFIG_DIR="$SCRATCH_CONFIG"
    export ONOFF_ARM="$ARM" ONOFF_TASK="$TASK_ID" ONOFF_PLUGIN_DIR="$SCRATCH_PLUGIN"
    timeout "$TIMEOUT_LIMIT" "$ONOFF_STUB_BIN" "$PROMPT_FILE"
  ) > "$TRANSCRIPT" 2> "$RAW_ERR"
  RUN_EXIT=$?
fi
set -e
END_TIME=$(date +%s)

# ── markers (deterministic; task-owned) ──
MARKERS_OUT="$OUT_DIR/markers.env"
set +e
(
  cd "$TEMP_REPO"
  TRANSCRIPT="$TRANSCRIPT" FROZEN_BASE_SHA="$FROZEN_BASE_SHA" \
  QUERY="$BASE_DIR/lib/transcript-query.js" \
    bash "$TASK_DIR/markers.sh"
) > "$MARKERS_OUT" 2>> "$RAW_ERR"
MARKERS_EXIT=$?
set -e

# ── manipulation check: dev-flow Skill invocation observed in transcript ──
skill_invoked_devflow="false"
if node "$BASE_DIR/lib/transcript-query.js" "$TRANSCRIPT" skill-invoked dev-flow >/dev/null 2>&1; then
  skill_invoked_devflow="true"
fi

# ── failure classification (closed vocabulary; content-free) ──
failure_class="null"; failure_cause="null"
if [ "$RUN_EXIT" -eq 124 ] || [ "$RUN_EXIT" -eq 137 ]; then
  failure_class='"infra_fail"'; failure_cause='"runner_timeout"'
elif [ "$RUN_EXIT" -ne 0 ] \
    && grep -Eqi '(^|[^a-z])(unauthorized|forbidden|authentication|invalid[ _-]?(api[ _-]?)?key|login required|token expired)([^a-z]|$)' "$RAW_ERR" 2>/dev/null; then
  failure_class='"infra_fail"'; failure_cause='"authentication"'
elif [ "$RUN_EXIT" -ne 0 ]; then
  failure_class='"infra_fail"'; failure_cause='"runner_error"'
elif [ ! -s "$TRANSCRIPT" ]; then
  failure_class='"infra_fail"'; failure_cause='"empty_output"'
elif [ "$MARKERS_EXIT" -ne 0 ]; then
  failure_class='"infra_fail"'; failure_cause='"marker_error"'
fi

runner_version="null"
if [ "$RUNNER" = "cc" ]; then
  runner_version=$(claude --version 2>/dev/null | head -n 1 || echo "unknown")
fi
runner_version_clean=$(printf '%s' "$runner_version" | tr -d '"\\' | head -c 120)

# markers.env (marker_x=true|false lines) → JSON object
markers_json=$(node -e '
  const fs=require("fs");
  const out={};
  try{
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      const m=line.match(/^marker_([a-z0-9_]+)=(true|false)$/);
      if(m) out[m[1]]=m[2]==="true";
    }
  }catch{}
  process.stdout.write(JSON.stringify(out));
' "$MARKERS_OUT")

RESULT_JSON="$OUT_DIR/result.json"
printf '{"task_id":"%s","arm":"%s","model":"%s","runner":"%s","runner_version":"%s","rep":%s,"duration_s":%s,"frozen_base_sha":"%s","markers":%s,"skill_invoked_devflow":%s,"failure_class":%s,"failure_cause":%s}\n' \
  "$TASK_ID" "$ARM" "$MODEL" "$RUNNER" "$runner_version_clean" "$REP" \
  "$((END_TIME - START_TIME))" "$FROZEN_BASE_SHA" "$markers_json" \
  "$skill_invoked_devflow" "$failure_class" "$failure_cause" > "$RESULT_JSON"

cat "$RESULT_JSON"
