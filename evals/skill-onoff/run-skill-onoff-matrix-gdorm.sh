#!/usr/bin/env bash
# run-skill-onoff-matrix-gdorm.sh — gdorm copy of the resume-by-cell driver.
# The shared run-skill-onoff-matrix.sh is digest-frozen. This copy calls
# run-skill-onoff-eval-gdorm.sh and is otherwise the same driver.
# Pattern copied from evals/skill-transport/run-matrix.sh: cell key = task|arm|rep, rows
# already present in the results JSONL are skipped, so an interrupted campaign (529 windows,
# operator ctrl-C) resumes by re-running the same command. Deterministic cell order (sorted;
# no shuffle — arms interleave per task so a mid-campaign CLI drift hits arms evenly).
#
# Usage:
#   run-skill-onoff-matrix.sh --model <m> --reps <n> --results <file.jsonl> \
#     [--tasks d1,d2,...] [--arms full,card,off] [--runner cc|stub]
#   Generic arms (P1W; see run-skill-onoff-eval.sh): add --skill <name> (arms default base,change)
#     [--pack-base <dir>] [--pack-change <dir>] [--with-pack <skill>=<dir>]... [--fixture-scripts <dir>]
#     [--check-skill <name>]; each is passed through to every cell unchanged.
#   Multi-pack arms (P5): --arm-manifests <dir> (needs --arms) — each arm runs with
#     --arm-manifest <dir>/<arm>.json (see run-skill-onoff-eval.sh); --fixture-scripts a,b passes through.
#
# Env ONOFF_KEEP_CELLS_DIR=<dir>: keep each cell's out dir under <dir>/<task>/<arm>/<rep>/ instead of deleting it.
#
# Fail fast (BL-0112): a cell that fails with failure_cause authentication or quota stops the whole campaign at once
# (exit 4, reason on stderr) — every later cell would fail the same way in ~2 s. Causes come from run-skill-onoff-eval.sh's
# classifier (stderr + is_error transcript lines). Other infra_fail causes keep the old rule (3 attempts per cell, the
# campaign scorer then decides). Resume after fixing the cause by re-running the same command (infra_fail rows re-run).
# Runner pin (BL-0113): the first run records the runner version in <results>.runner-pin; before every cell the version
# is re-probed and a different one stops the campaign (exit 3) so one results file never mixes two runner versions.
# cc runs also export DISABLE_AUTOUPDATER=1. Probe command: ONOFF_VERSION_CMD (default `claude --version` for --runner cc;
# none for the stub runner unless ONOFF_VERSION_CMD is set). To deliberately move to a new version, start a new results file.
#
# Rows with failure_class=infra_fail are NOT treated as complete — they re-run on resume
# (max 3 recorded attempts per cell, then the cell stays missing for score-onoff to judge).

set -euo pipefail

MODEL=""; REPS="3"; RESULTS=""; TASKS=""; ARMS=""; RUNNER="cc"; ARM_MANIFESTS=""
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --reps) REPS="$2"; shift 2 ;;
    --results) RESULTS="$2"; shift 2 ;;
    --tasks) TASKS="$2"; shift 2 ;;
    --arms) ARMS="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    --arm-manifests) ARM_MANIFESTS="$2"; shift 2 ;;
    --skill|--pack-base|--pack-change|--with-pack|--fixture-scripts|--check-skill)
      [ "$1" != "--skill" ] || SKILL_SET=1
      PASS+=("$1" "$2"); shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODEL" ] && [ -n "$RESULTS" ] || {
  echo "Usage: $0 --model <m> --reps <n> --results <file.jsonl> [--tasks ...] [--arms ...] [--runner cc|stub]" >&2
  exit 2
}

if [ -n "$ARM_MANIFESTS" ] && [ -z "$ARMS" ]; then
  echo "ERROR: --arm-manifests needs --arms" >&2; exit 2
fi
if [ -z "$ARMS" ]; then
  if [ "${SKILL_SET:-0}" = 1 ]; then ARMS="base,change"; else ARMS="full,card,off"; fi
fi
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$TASKS" ]; then
  TASKS=$(ls -1 "$BASE_DIR/tasks" | sort | paste -sd, -)
fi
mkdir -p "$(dirname "$RESULTS")"
touch "$RESULTS"

VERSION_CMD="${ONOFF_VERSION_CMD:-}"
[ -n "$VERSION_CMD" ] || [ "$RUNNER" != "cc" ] || VERSION_CMD="claude --version"
[ "$RUNNER" != "cc" ] || export DISABLE_AUTOUPDATER=1
PIN_FILE="$RESULTS.runner-pin"
probe_version() { [ -z "$VERSION_CMD" ] || { bash -c "$VERSION_CMD" 2>/dev/null | head -n 1 || true; }; }
if [ -n "$VERSION_CMD" ]; then
  PINNED=$(probe_version)
  [ -n "$PINNED" ] || { echo "ERROR: runner version probe ('$VERSION_CMD') returned nothing — cannot pin" >&2; exit 3; }
  if [ -s "$PIN_FILE" ]; then
    WANT=$(head -n 1 "$PIN_FILE")
    [ "$WANT" = "$PINNED" ] || { echo "ERROR: runner version changed: campaign pinned '$WANT', now '$PINNED' ($PIN_FILE) — use a new results file to start a fresh version" >&2; exit 3; }
  else
    printf '%s\n' "$PINNED" > "$PIN_FILE"
  fi
fi

cell_state() { # $1 task $2 arm $3 rep → echoes "done" | "attempts:<n>"
  node -e '
    const fs=require("fs");
    const [file,task,arm,rep]=process.argv.slice(1);
    let ok=false,attempts=0;
    try{
      for(const line of fs.readFileSync(file,"utf8").split("\n")){
        if(!line.trim())continue;
        let j;try{j=JSON.parse(line)}catch{continue}
        if(j.task_id===task&&j.arm===arm&&String(j.rep)===rep){
          if(j.failure_class===null||j.failure_class===undefined) ok=true; else attempts++;
        }
      }
    }catch{}
    process.stdout.write(ok?"done":`attempts:${attempts}`);
  ' "$RESULTS" "$1" "$2" "$3"
}

total=0; ran=0; skipped=0; exhausted=0
IFS=',' read -ra TASK_ARR <<< "$TASKS"
IFS=',' read -ra ARM_ARR <<< "$ARMS"
for task in "${TASK_ARR[@]}"; do
  for rep in $(seq 1 "$REPS"); do
    for arm in "${ARM_ARR[@]}"; do
      total=$((total+1))
      state=$(cell_state "$task" "$arm" "$rep")
      if [ "$state" = "done" ]; then
        skipped=$((skipped+1)); continue
      fi
      attempts=${state#attempts:}
      if [ "$attempts" -ge 3 ]; then
        echo "cell $task|$arm|$rep: 3 infra_fail attempts recorded — leaving missing" >&2
        exhausted=$((exhausted+1)); continue
      fi
      if [ -n "$VERSION_CMD" ]; then
        NOW=$(probe_version)
        [ "$NOW" = "$PINNED" ] || { echo "ERROR: runner version drifted mid-campaign: pinned '$PINNED', now '$NOW' — stopping before cell $task|$arm|$rep" >&2; exit 3; }
      fi
      out=$(mktemp -d -t "onoff-cell-XXXXXX")
      echo "── cell $task|$arm|$rep (attempt $((attempts+1)))"
      abort_cause=""
      MAN=(); [ -z "$ARM_MANIFESTS" ] || MAN=(--arm-manifest "$ARM_MANIFESTS/$arm.json")
      if bash "$BASE_DIR/run-skill-onoff-eval-gdorm.sh" \
          --task "$task" --arm "$arm" --model "$MODEL" --rep "$rep" "${MAN[@]+"${MAN[@]}"}" \
          --runner "$RUNNER" --out "$out" "${PASS[@]+"${PASS[@]}"}" >/dev/null; then
        cat "$out/result.json" >> "$RESULTS"
        cause=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.failure_class==="infra_fail"?String(j.failure_cause):"")}catch{}' "$out/result.json")
        case "$cause" in authentication|quota) abort_cause="$cause" ;; esac
      else
        echo "harness error on $task|$arm|$rep (exit $?)" >&2
      fi
      # Retain the cell's artifacts (transcript, prompt, stderr, markers, state, stage-graph-extracted.json) before the
      # scratch dir goes: opt-in via ONOFF_KEEP_CELLS_DIR -> <dir>/<task>/<arm>/<rep>/ (an earlier attempt of the same
      # cell is kept as <rep>.attempt<N>). Scoring never reads it.
      if [ -n "${ONOFF_KEEP_CELLS_DIR:-}" ]; then
        keep="$ONOFF_KEEP_CELLS_DIR/$task/$arm/$rep"
        mkdir -p "$(dirname "$keep")"
        if [ -e "$keep" ]; then mv "$keep" "$keep.attempt$attempts" 2>/dev/null || rm -rf "$keep"; fi
        cp -r "$out" "$keep" 2>/dev/null || echo "WARN: could not retain $out -> $keep" >&2
      fi
      rm -rf "$out"
      ran=$((ran+1))
      if [ -n "$abort_cause" ]; then  # after retention, so a misclassification can be inspected afterwards
        echo "ABORT: cell $task|$arm|$rep failed with $abort_cause — stopping the campaign (remaining cells would fail the same way). Fix it, then re-run the same command to resume." >&2
        exit 4
      fi
    done
  done
done
echo "matrix: total=$total ran=$ran skipped(done)=$skipped missing(exhausted)=$exhausted → $RESULTS"
