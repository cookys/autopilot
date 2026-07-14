#!/usr/bin/env bash
# run-matrix.sh — deterministic matrix driver for the skill-transport reviewer A/B (plan §3).
#
# For one engine it iterates (arm × case × repeat), shells the reviewer dispatcher once per
# cell, and appends ONE JSONL row per cell to --out. Verdict/caught are computed from the
# dispatcher's JSON + the defect-matched predicate (match-eval.js) — never self-report.
#
# Arms:  nopack  = no methodology pack
#        pack    = --pack-file <reviewer pack>
#        placebo = --pack-file <equal-length irrelevant pack>   (arm C, plan §4 P1.4)
#
# Cell key = engine|arm|case|repeat. Resume is idempotent: a cell already present in --out is
# skipped, so a matrix block can be chunked/interrupted and re-run safely. (case×arm×repeat)
# execution order is shuffled once per engine with a RECORDED seed (--seed, else time-derived,
# written to <out>.<engine>.seed and never re-rolled while rows exist).
#
# no_verdict is recorded fail-closed (status != reviewed ⇒ no_verdict:true, caught:false) and
# is NEVER silently re-rolled.
#
# The dispatcher is overridable for the Phase-0 stub proof: DISPATCH_REVIEW_CMD=<path>
# (default scripts/dispatch-review.sh). A stub must accept the same flags and emit the shared
# review JSON {status, verdict, findings, raw_log}.
#
# Usage:
#   run-matrix.sh --engine haiku --runner claude-native --model haiku \
#     [--endpoint <name>] [--k 3] --arms nopack,pack,placebo \
#     --known-bad-dir evals/known-bad --clean-dir evals/clean \
#     --pack evals/skill-transport/packs/reviewer-pack.md \
#     --placebo evals/skill-transport/packs/placebo-pack.md \
#     --out evals/skill-transport/results/matrix.jsonl \
#     [--seed 12345] [--limit N] [--timeout 5m]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
DISPATCH_REVIEW_CMD="${DISPATCH_REVIEW_CMD:-$REPO_ROOT/scripts/dispatch-review.sh}"
MATCH_EVAL="$HERE/match-eval.js"
EXTRACT_TOKENS="$HERE/lib/extract-tokens.js"

ENGINE=""; RUNNER=""; MODEL=""; ENDPOINT=""; K=1; ARMS="nopack,pack"
KB_DIR="$REPO_ROOT/evals/known-bad"; CLEAN_DIR="$REPO_ROOT/evals/clean"
PACK="$HERE/packs/reviewer-pack.md"; PLACEBO="$HERE/packs/placebo-pack.md"
OUT=""; SEED=""; LIMIT=0; TIMEOUT="5m"
while [ $# -gt 0 ]; do case "$1" in
  --engine) ENGINE="$2"; shift 2 ;;
  --runner) RUNNER="$2"; shift 2 ;;
  --model) MODEL="$2"; shift 2 ;;
  --endpoint) ENDPOINT="$2"; shift 2 ;;
  --k) K="$2"; shift 2 ;;
  --arms) ARMS="$2"; shift 2 ;;
  --known-bad-dir) KB_DIR="$2"; shift 2 ;;
  --clean-dir) CLEAN_DIR="$2"; shift 2 ;;
  --pack) PACK="$2"; shift 2 ;;
  --placebo) PLACEBO="$2"; shift 2 ;;
  --out) OUT="$2"; shift 2 ;;
  --seed) SEED="$2"; shift 2 ;;
  --limit) LIMIT="$2"; shift 2 ;;
  --timeout) TIMEOUT="$2"; shift 2 ;;
  -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac; done

[ -n "$ENGINE" ] || { echo "--engine required" >&2; exit 2; }
[ -n "$RUNNER" ] || { echo "--runner required" >&2; exit 2; }
[ -n "$MODEL" ] || { echo "--model required" >&2; exit 2; }
[ -n "$OUT" ] || { echo "--out required" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"; : > /dev/null
touch "$OUT"
SEED_FILE="$OUT.$ENGINE.seed"

# Freeze/record the seed once per engine (never re-roll while rows exist).
if [ -f "$SEED_FILE" ]; then
  SEED="$(cat "$SEED_FILE")"
elif [ -n "$SEED" ]; then
  printf '%s\n' "$SEED" > "$SEED_FILE"
else
  SEED="$(( ($(date +%s) ^ $$) % 2147483647 ))"
  printf '%s\n' "$SEED" > "$SEED_FILE"
fi

# Build the full cell list: arm|caseset|caseid|repeat  (one line per cell).
build_cells() {
  local arm caseset f cid r; local -a arms_arr
  IFS=',' read -r -a arms_arr <<< "$ARMS"
  for arm in "${arms_arr[@]}"; do
    [ -n "$arm" ] || continue
    for f in "$KB_DIR"/*.diff; do [ -f "$f" ] || continue; cid="$(basename "$f" .diff)"; for r in $(seq 1 "$K"); do printf '%s|known-bad|%s|%s\n' "$arm" "$cid" "$r"; done; done
    for f in "$CLEAN_DIR"/*.diff; do [ -f "$f" ] || continue; cid="$(basename "$f" .diff)"; for r in $(seq 1 "$K"); do printf '%s|clean|%s|%s\n' "$arm" "$cid" "$r"; done; done
  done
}

# Deterministic seeded shuffle (mulberry32 + Fisher-Yates); stdin lines -> shuffled stdout.
shuffle_seeded() {
  node -e '
    const seed = (parseInt(process.argv[1],10) >>> 0) || 1;
    let a = seed >>> 0;
    function rnd(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a>>>15), 1|a); t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t; return ((t ^ (t>>>14))>>>0)/4294967296; }
    const lines = require("fs").readFileSync(0,"utf8").split("\n").filter(x=>x.length);
    for (let i=lines.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [lines[i],lines[j]]=[lines[j],lines[i]]; }
    process.stdout.write(lines.join("\n")+(lines.length?"\n":""));
  ' "$SEED"
}

existing_keys() { [ -s "$OUT" ] && node -e 'const fs=require("fs");for(const l of fs.readFileSync(0,"utf8").split("\n")){if(!l.trim())continue;try{const o=JSON.parse(l);if(o.cell_key)process.stdout.write(o.cell_key+"\n")}catch(e){}}' < "$OUT" || true; }

TMP_KEYS="$(mktemp)"; existing_keys | sort -u > "$TMP_KEYS"
trap 'rm -f "$TMP_KEYS"' EXIT

CELLS="$(build_cells | shuffle_seeded)"
RAN=0
while IFS='|' read -r arm caseset cid rep; do
  [ -z "$arm" ] && continue
  CELL_KEY="$ENGINE|$arm|$cid|$rep"
  if grep -qxF "$CELL_KEY" "$TMP_KEYS"; then continue; fi
  if [ "$LIMIT" -gt 0 ] && [ "$RAN" -ge "$LIMIT" ]; then break; fi

  if [ "$caseset" = "known-bad" ]; then DIFF="$KB_DIR/$cid.diff"; else DIFF="$CLEAN_DIR/$cid.diff"; fi
  [ -f "$DIFF" ] || { echo "missing diff: $DIFF" >&2; continue; }

  # Assemble dispatcher args for the arm.
  ARGS=(--runner "$RUNNER" --model "$MODEL" --diff-file "$DIFF" --timeout "$TIMEOUT")
  [ -n "$ENDPOINT" ] && ARGS+=(--endpoint "$ENDPOINT")
  case "$arm" in
    pack)    ARGS+=(--pack-file "$PACK") ;;
    placebo) ARGS+=(--pack-file "$PLACEBO") ;;
    nopack)  : ;;
    *) echo "unknown arm: $arm" >&2; continue ;;
  esac

  T0="$(date +%s.%N)"
  # </dev/null so a runner that reads stdin (agy's `script -qec` pseudo-TTY) cannot consume
  # the `while read` loop's CELLS heredoc and terminate the matrix after one cell.
  RESP="$(DISPATCH_QUIET=1 "$DISPATCH_REVIEW_CMD" "${ARGS[@]}" </dev/null 2>/dev/null || true)"
  T1="$(date +%s.%N)"
  LAT="$(node -e 'process.stdout.write(String(Math.round((process.argv[1]-process.argv[2])*1000)/1000))' "$T1" "$T0")"

  # Parse the shared review JSON in ONE node pass (findings base64 to survive newlines/tabs).
  # Fail-closed: unparseable ⇒ empty status ⇒ no_verdict.
  PARSED="$(printf '%s' "$RESP" | node -e 'try{const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const b=Buffer.from(String(o.findings==null?"":o.findings)).toString("base64");process.stdout.write([String(o.status||""),o.verdict==null?"":String(o.verdict),o.raw_log==null?"":String(o.raw_log),b].join("\t"))}catch(e){process.stdout.write("\t\t\t")}' 2>/dev/null || printf '\t\t\t')"
  STATUS="$(printf '%s' "$PARSED" | cut -f1)"
  VERDICT="$(printf '%s' "$PARSED" | cut -f2)"
  RAWLOG="$(printf '%s' "$PARSED" | cut -f3)"
  FINDINGS="$(printf '%s' "$PARSED" | cut -f4 | base64 -d 2>/dev/null || true)"

  NO_VERDICT=true; [ "$STATUS" = "reviewed" ] && NO_VERDICT=false
  FLAGGED=false
  case "$(printf '%s' "$VERDICT" | tr '[:lower:]' '[:upper:]')" in
    *FIX*|*BLOCK*|*REJECT*) [ "$NO_VERDICT" = false ] && FLAGGED=true ;;
  esac

  CAUGHT=null
  if [ "$caseset" = "known-bad" ]; then
    FINDINGS_FILE="$(mktemp)"; printf '%s' "$FINDINGS" > "$FINDINGS_FILE"
    if [ "$NO_VERDICT" = false ] && node "$MATCH_EVAL" check-caught --case "$cid" --verdict "$VERDICT" --findings-file "$FINDINGS_FILE" 2>/dev/null; then
      CAUGHT=true; else CAUGHT=false; fi
    rm -f "$FINDINGS_FILE"
  fi

  TOKENS=null
  if [ -n "$RAWLOG" ] && [ -f "$RAWLOG" ] && [ -f "$EXTRACT_TOKENS" ]; then
    TK="$(node "$EXTRACT_TOKENS" --runner "$RUNNER" --log "$RAWLOG" 2>/dev/null || true)"
    case "$TK" in ''|null|0) TOKENS=null ;; *[!0-9]*) TOKENS=null ;; *) TOKENS="$TK" ;; esac
  fi

  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Build the JSON row in ONE node pass (avoids per-field escaper spawns).
  ROW_ENGINE="$ENGINE" ROW_RUNNER="$RUNNER" ROW_MODEL="$MODEL" ROW_ARM="$arm" ROW_CASESET="$caseset" \
  ROW_CASE="$cid" ROW_REPEAT="$rep" ROW_VERDICT="$VERDICT" ROW_HASVERDICT="$([ -n "$VERDICT" ] && echo 1 || echo 0)" \
  ROW_STATUS="$STATUS" ROW_NOVERDICT="$NO_VERDICT" ROW_FLAGGED="$FLAGGED" ROW_CAUGHT="$CAUGHT" ROW_LAT="$LAT" \
  ROW_TOKENS="$TOKENS" ROW_RAWLOG="$RAWLOG" ROW_HASRAW="$([ -n "$RAWLOG" ] && echo 1 || echo 0)" ROW_SEED="$SEED" ROW_TS="$TS" ROW_KEY="$CELL_KEY" ROW_OUT="$OUT" \
  ROW_FINDINGS_B64="$(printf '%s' "$FINDINGS" | base64 | tr -d '\n')" \
  node -e '
    const E=process.env; const num=(x)=>x==="null"||x===""?null:Number(x); const bool=(x)=>x==="true";
    const findings=Buffer.from(E.ROW_FINDINGS_B64||"","base64").toString("utf8");
    const row={engine:E.ROW_ENGINE,runner:E.ROW_RUNNER,model:E.ROW_MODEL,arm:E.ROW_ARM,case_set:E.ROW_CASESET,
      case:E.ROW_CASE,repeat:Number(E.ROW_REPEAT),verdict:E.ROW_HASVERDICT==="1"?E.ROW_VERDICT:null,status:E.ROW_STATUS,
      no_verdict:bool(E.ROW_NOVERDICT),flagged:bool(E.ROW_FLAGGED),caught:E.ROW_CAUGHT==="null"?null:bool(E.ROW_CAUGHT),
      findings,latency_s:num(E.ROW_LAT),tokens:num(E.ROW_TOKENS),raw_log:E.ROW_HASRAW==="1"?E.ROW_RAWLOG:null,
      seed:Number(E.ROW_SEED),ts:E.ROW_TS,cell_key:E.ROW_KEY};
    require("fs").appendFileSync(E.ROW_OUT, JSON.stringify(row)+"\n");
  ' 2>/dev/null || true

  echo "$CELL_KEY -> status=$STATUS verdict=${VERDICT:-none} caught=$CAUGHT flagged=$FLAGGED no_verdict=$NO_VERDICT lat=${LAT}s" >&2
  RAN=$((RAN+1))
done <<< "$CELLS"

echo "run-matrix: engine=$ENGINE ran=$RAN new cells (seed=$SEED); out=$OUT" >&2
