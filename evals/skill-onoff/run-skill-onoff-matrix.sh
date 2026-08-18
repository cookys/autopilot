#!/usr/bin/env bash
# run-skill-onoff-matrix.sh — resume-by-cell campaign driver for the skill ON/OFF instrument.
# Pattern copied from evals/skill-transport/run-matrix.sh: cell key = task|arm|rep, rows
# already present in the results JSONL are skipped, so an interrupted campaign (529 windows,
# operator ctrl-C) resumes by re-running the same command. Deterministic cell order (sorted;
# no shuffle — arms interleave per task so a mid-campaign CLI drift hits arms evenly).
#
# Usage:
#   run-skill-onoff-matrix.sh --model <m> --reps <n> --results <file.jsonl> \
#     [--tasks d1,d2,...] [--arms full,card,off] [--runner cc|stub]
#
# Rows with failure_class=infra_fail are NOT treated as complete — they re-run on resume
# (max 3 recorded attempts per cell, then the cell stays missing for score-onoff to judge).

set -euo pipefail

MODEL=""; REPS="3"; RESULTS=""; TASKS=""; ARMS="full,card,off"; RUNNER="cc"
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --reps) REPS="$2"; shift 2 ;;
    --results) RESULTS="$2"; shift 2 ;;
    --tasks) TASKS="$2"; shift 2 ;;
    --arms) ARMS="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODEL" ] && [ -n "$RESULTS" ] || {
  echo "Usage: $0 --model <m> --reps <n> --results <file.jsonl> [--tasks ...] [--arms ...] [--runner cc|stub]" >&2
  exit 2
}

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$TASKS" ]; then
  TASKS=$(ls -1 "$BASE_DIR/tasks" | sort | paste -sd, -)
fi
mkdir -p "$(dirname "$RESULTS")"
touch "$RESULTS"

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
      out=$(mktemp -d -t "onoff-cell-XXXXXX")
      echo "── cell $task|$arm|$rep (attempt $((attempts+1)))"
      if bash "$BASE_DIR/run-skill-onoff-eval.sh" \
          --task "$task" --arm "$arm" --model "$MODEL" --rep "$rep" \
          --runner "$RUNNER" --out "$out" >/dev/null; then
        cat "$out/result.json" >> "$RESULTS"
      else
        echo "harness error on $task|$arm|$rep (exit $?)" >&2
      fi
      rm -rf "$out"
      ran=$((ran+1))
    done
  done
done
echo "matrix: total=$total ran=$ran skipped(done)=$skipped missing(exhausted)=$exhausted → $RESULTS"
