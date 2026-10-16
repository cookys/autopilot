#!/usr/bin/env bash
# BL-0093 point-1 campaign driver. Usage: run-campaign.sh <cells-root>
# Cells: <arm>/<task>/<i>. Skips cells that already have result.json (resumable).
set -u
ROOT="$1"; REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
export DISABLE_AUTOUPDATER=1 ORCH_TIMEOUT=8m
MODEL="${MODEL:-sonnet}"
P="$REPO/evals/orchestration/packs"
declare -A PACK=( [maximal]=completeness-maximal [proportional]=completeness-proportional [red-reckless]=red-reckless [red-bloat]=red-bloat )
cells=()
for i in 1 2 3 4 5; do for t in t18-proportional-waste t19-edge-case-escape; do for a in maximal proportional; do cells+=("$a $t $i"); done; done; done
for i in 1 2 3; do cells+=("red-reckless t19-edge-case-escape $i" "red-bloat t18-proportional-waste $i"); done
run1() { set -- $1; a=$1 t=$2 i=$3; d="$ROOT/$a/$t/$i"
  [ -s "$d/result.json" ] && return 0; rm -rf "$d"; mkdir -p "$d"
  bash "$REPO/evals/orchestration/run-orchestration-eval.sh" --task "$t" --arm "$a" --pack "$P/${PACK[$a]}/PROMPT.md" --contract on --runner cc --model "$MODEL" --out "$d" >/dev/null 2>"$d/stderr.log"; }
active=0
for c in "${cells[@]}"; do run1 "$c" & active=$((active+1)); [ $active -ge 2 ] && { wait -n; active=$((active-1)); }; done
wait; echo CAMPAIGN_DONE
