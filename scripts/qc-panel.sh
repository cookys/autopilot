#!/usr/bin/env bash
# qc-panel.sh — Interrogation QC panel dispatcher (task-tree engine P4).
#
# Dispatches 2 judges × 3 question shapes (6 judge calls) over a node report
# and its artifacts, then synthesizes a verdict.
#
# USAGE:
#   scripts/qc-panel.sh --report <node-report.json>
#                        --artifacts <path>[,<path>...]
#                        [--diff <diff-file>]
#                        [--out <dir>]
#                        [--proj <project-name> --node <node-id>]
#
# JUDGES:
#   Judge A — Claude family via $QC_CLAUDE_BIN (default: claude)
#             Model: haiku-class (cheap tier, Amendment 11)
#   Judge B — Gemini via $QC_AGY_BIN (default: agy)
#             Model: Gemini 3.5 Flash (Medium) — spike-proven recipe
#             Runs in a throwaway dir with ONLY intended inputs; file-write
#             mode; --dangerously-skip-permissions --print-timeout 8m
#
# QUESTION SHAPES (×2 judges = 6 calls):
#   Q1  "What goals were achieved? Cite evidence from the report."
#   Q2  "What was done BEYOND the stated goals (extras/scope-creep)?"
#   Q3  "What goals were NOT achieved?"
#
# SYNTHESIZER:
#   1. Deterministic script merge (jq) of 6 judge outputs → achieved/extras/missed
#   2. One haiku-class model pass → {verdict: pass|fail, dissents[], extras[]}
#      If that model call fails → fall back to deterministic majority verdict.
#
# LIVENESS (Amendment 4):
#   Every successful panel run MUST:
#     (a) write the verdict artifact JSON to --out dir
#     (b) call scripts/calibration.sh add-sample
#   If either fails, qc-panel exits non-zero (silently-dead shadow = failure).
#
# SKIPPING:
#   If the node report has "verdict": null (non-verdict-bearing), exits 0 with a
#   skipped JSON written to --out (no calibration sample appended).
#
# OUTPUT JSON SCHEMA:
#   {
#     "status":   "ok" | "skipped" | "error",
#     "verdict":  "pass" | "fail" | null,
#     "dissents": [],
#     "extras":   [],
#     "judges":   { "a_q1": <file>, "a_q2": <file>, "a_q3": <file>,
#                   "b_q1": <file>, "b_q2": <file>, "b_q3": <file> },
#     "token_estimate": <n>,
#     "skipped_reason": null | "null-verdict"
#   }
#
# EXIT CODES:
#   0  panel ran, verdict written, calibration sample appended (or skipped)
#   1  judge failure / liveness assertion failed
#   2  usage / precondition failure
#
# ENV SEAMS (for testing — PATH-stub these binaries):
#   QC_CLAUDE_BIN   claude binary (default: claude)
#   QC_AGY_BIN      agy binary    (default: agy)
#   CALIBRATION_DATA_DIR  passed through to calibration.sh
#
# NOTE on agy judge recipe (verified spike, references/multi-agent-portability.md §7):
#   stdout = narration-polluted → use file-write mode only.
#   --print-timeout 8m (4m timed out in spike).
#   --dangerously-skip-permissions required even for read-only judging.
#   Judge runs in throwaway dir containing ONLY intended inputs; empirically
#   the agent wanders (lists dir, reads its own output, tries git).
#
# shellcheck disable=SC2317  # functions referenced via eval

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CALIBRATION_SH="$SCRIPT_DIR/calibration.sh"

# ── Binary seams ──────────────────────────────────────────────────────────────
CLAUDE_BIN="${QC_CLAUDE_BIN:-claude}"
AGY_BIN="${QC_AGY_BIN:-agy}"

# ── Question shapes ───────────────────────────────────────────────────────────
Q1="What goals were achieved? Cite specific evidence from the report and artifacts. List each achieved goal on its own line prefixed 'ACHIEVED:'."
Q2="What was done BEYOND the stated goals (extras, scope creep, unrequested changes)? Be specific. List each on its own line prefixed 'EXTRA:'."
Q3="What goals were NOT achieved? What is still missing or incomplete? List each on its own line prefixed 'MISSED:'."

# ── Helpers ───────────────────────────────────────────────────────────────────
die()           { printf 'qc-panel.sh: %s\n' "$*" >&2; exit 2; }
die_liveness()  { printf 'qc-panel.sh: liveness failure: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
qc-panel.sh — QC interrogation panel (task-tree engine P4)

  --report     <node-report.json>    required
  --artifacts  <path>[,<path>...]    required
  --diff       <diff-file>           optional
  --out        <dir>                 required unless --proj+--node set
  --proj       <project-name>        used to derive default --out path
  --node       <node-id>             used to derive default --out path

ENV: QC_CLAUDE_BIN, QC_AGY_BIN, CALIBRATION_DATA_DIR

EXIT: 0=ok/skipped, 1=judge/liveness failure, 2=usage/precondition
EOF
}

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# estimate_tokens: rough bytes/4 of a file (or inline string)
estimate_tokens_file() {
  local f="$1"
  [ -f "$f" ] || { printf 0; return; }
  local bytes
  bytes="$(wc -c < "$f" 2>/dev/null | tr -d ' ')" || bytes=0
  printf '%d' "$(( bytes / 4 ))"
}

estimate_tokens_str() {
  local s="$1"
  printf '%d' "$(( ${#s} / 4 ))"
}

# extract_last_json: grab the last {...} block from a string (handles narrative pollution)
extract_last_json() {
  printf '%s' "$1" | python3 -c '
import sys, json, re
text = sys.stdin.read()
# Find all {...} candidates; pick the last valid JSON
matches = list(re.finditer(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}", text, re.DOTALL))
for m in reversed(matches):
    try:
        json.loads(m.group())
        print(m.group())
        sys.exit(0)
    except Exception:
        pass
# fallback: return the last braces-delimited line
lines = [l.strip() for l in text.splitlines() if l.strip().startswith("{")]
if lines:
    print(lines[-1])
' 2>/dev/null || true
}

# ── Argument parsing ──────────────────────────────────────────────────────────
REPORT_FILE=""
ARTIFACTS_RAW=""
DIFF_FILE=""
OUT_DIR=""
PROJ=""
NODE_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --report)    REPORT_FILE="${2:-}";    shift 2 ;;
    --artifacts) ARTIFACTS_RAW="${2:-}";  shift 2 ;;
    --diff)      DIFF_FILE="${2:-}";      shift 2 ;;
    --out)       OUT_DIR="${2:-}";        shift 2 ;;
    --proj)      PROJ="${2:-}";           shift 2 ;;
    --node)      NODE_ID="${2:-}";        shift 2 ;;
    --help|-h)   usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# ── Preconditions ─────────────────────────────────────────────────────────────
[ -n "$REPORT_FILE" ]  || die "--report is required"
[ -r "$REPORT_FILE" ]  || die "report file not readable: $REPORT_FILE"
[ -n "$ARTIFACTS_RAW" ] || die "--artifacts is required"

# Derive --out from --proj/--node if not given
if [ -z "$OUT_DIR" ]; then
  [ -n "$PROJ" ] && [ -n "$NODE_ID" ] || die "--out is required unless both --proj and --node are set"
  OUT_DIR="$REPO_ROOT/docs/projects/$PROJ/tree/panel"
fi
mkdir -p "$OUT_DIR" || die "cannot create output dir: $OUT_DIR"

# Build artifact list
IFS=',' read -ra ARTIFACT_PATHS <<< "$ARTIFACTS_RAW"

# ── Check for null verdict (non-verdict-bearing node) ─────────────────────────
NODE_VERDICT="$(grep -o '"verdict":[^,}]*' "$REPORT_FILE" | head -1 | cut -d: -f2 | tr -d ' "' )"
if [ "$NODE_VERDICT" = "null" ] || [ -z "$NODE_VERDICT" ]; then
  TS="$(now_iso | tr -c '[:alnum:]' '-' | sed 's/-*$//')"
  SKIP_FILE="$OUT_DIR/${NODE_ID:-node}-${TS}-skipped.json"
  printf '{"status":"skipped","verdict":null,"dissents":[],"extras":[],"judges":null,"token_estimate":0,"skipped_reason":"null-verdict"}\n' \
    > "$SKIP_FILE"
  printf '{"status":"skipped","verdict":null,"dissents":[],"extras":[],"judges":null,"token_estimate":0,"skipped_reason":"null-verdict"}\n'
  exit 0
fi

# ── Working dir for judge outputs ─────────────────────────────────────────────
WORK_DIR="$(mktemp -d -t "qc-panel-XXXXXX")"
cleanup_work() { rm -rf "$WORK_DIR"; }
trap cleanup_work EXIT

TOKEN_TOTAL=0

# ── Build shared report context (what judges see) ─────────────────────────────
CONTEXT_FILE="$WORK_DIR/context.txt"
{
  printf '=== NODE REPORT ===\n'
  cat "$REPORT_FILE"
  printf '\n\n=== ARTIFACTS ===\n'
  for ap in "${ARTIFACT_PATHS[@]}"; do
    ap="$(printf '%s' "$ap" | tr -d ' ')"
    if [ -f "$ap" ]; then
      printf '--- %s ---\n' "$ap"
      cat "$ap"
      printf '\n'
    else
      printf '--- %s (NOT FOUND) ---\n' "$ap"
    fi
  done
  if [ -n "$DIFF_FILE" ] && [ -f "$DIFF_FILE" ]; then
    printf '\n=== DIFF ===\n'
    cat "$DIFF_FILE"
  fi
} > "$CONTEXT_FILE"

CTX_TOKENS="$(estimate_tokens_file "$CONTEXT_FILE")"
TOKEN_TOTAL=$((TOKEN_TOTAL + CTX_TOKENS))

# ── Judge A: Claude (haiku-class) ─────────────────────────────────────────────
# Judge A writes its verdict directly to a file (--output-file not available in
# claude -p so we redirect stdout; narrative pollution on claude is minimal)

run_judge_a() {
  local qnum="$1" question="$2" outfile="$3"
  local prompt
  prompt="$(printf 'You are a code review judge. Review the following context and answer the question.\n\nQUESTION: %s\n\nCONTEXT:\n' "$question")"
  local prompt_tokens
  prompt_tokens="$(estimate_tokens_str "$prompt")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + prompt_tokens + CTX_TOKENS))

  if ! { printf '%s' "$prompt"; cat "$CONTEXT_FILE"; } | \
      "$CLAUDE_BIN" -p --model claude-haiku-4-5 > "$outfile" 2>/dev/null; then
    printf 'qc-panel.sh: judge A Q%s failed\n' "$qnum" >&2
    printf '{"judge":"a","q":%s,"error":"judge_failed"}\n' "$qnum" > "$outfile"
    return 1
  fi
  local resp_tokens
  resp_tokens="$(estimate_tokens_file "$outfile")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + resp_tokens))
  return 0
}

# ── Judge B: Gemini via agy (file-write mode) ─────────────────────────────────
# Spike recipe: throwaway dir with ONLY intended inputs; judge writes verdict
# to a file; --dangerously-skip-permissions --print-timeout 8m

run_judge_b() {
  local qnum="$1" question="$2" outfile="$3"
  local judge_dir
  judge_dir="$(mktemp -d -t "qc-judge-b-q${qnum}-XXXXXX")"
  # Copy only intended inputs into throwaway dir
  cp "$CONTEXT_FILE" "$judge_dir/context.txt"
  local verdict_target="$judge_dir/verdict.txt"

  local prompt
  prompt="$(printf 'You are a code review judge. Review context.txt and answer this question:\n\nQUESTION: %s\n\nWRITE your answer to ./verdict.txt then output only the word DONE.\n' "$question")"
  local prompt_tokens
  prompt_tokens="$(estimate_tokens_str "$prompt")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + prompt_tokens + CTX_TOKENS))

  local agy_out
  agy_out="$(cd "$judge_dir" && "$AGY_BIN" -p "$prompt" \
      --model "Gemini 3.5 Flash (Medium)" \
      --dangerously-skip-permissions \
      --print-timeout 8m 2>/dev/null)" || true

  if [ -f "$verdict_target" ] && [ -s "$verdict_target" ]; then
    cp "$verdict_target" "$outfile"
  else
    # fallback: extract from stdout
    printf '%s' "$agy_out" > "$outfile"
    if [ ! -s "$outfile" ]; then
      printf 'qc-panel.sh: judge B Q%s produced no output\n' "$qnum" >&2
      printf '{"judge":"b","q":%s,"error":"judge_failed"}\n' "$qnum" > "$outfile"
      rm -rf "$judge_dir"
      return 1
    fi
  fi

  local resp_tokens
  resp_tokens="$(estimate_tokens_file "$outfile")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + resp_tokens))
  rm -rf "$judge_dir"
  return 0
}

# ── Dispatch 6 judge calls ─────────────────────────────────────────────────────
JUDGE_FAILURES=0

A_Q1="$WORK_DIR/a_q1.txt"; run_judge_a 1 "$Q1" "$A_Q1" || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))
A_Q2="$WORK_DIR/a_q2.txt"; run_judge_a 2 "$Q2" "$A_Q2" || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))
A_Q3="$WORK_DIR/a_q3.txt"; run_judge_a 3 "$Q3" "$A_Q3" || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))
B_Q1="$WORK_DIR/b_q1.txt"; run_judge_b 1 "$Q1" "$B_Q1" || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))
B_Q2="$WORK_DIR/b_q2.txt"; run_judge_b 2 "$Q2" "$B_Q2" || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))
B_Q3="$WORK_DIR/b_q3.txt"; run_judge_b 3 "$Q3" "$B_Q3" || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))

# Liveness: any judge failure → non-zero exit (Amendment 4)
if [ "$JUDGE_FAILURES" -gt 0 ]; then
  die_liveness "$JUDGE_FAILURES judge call(s) failed"
fi

# ── Deterministic merge ────────────────────────────────────────────────────────
# Extract ACHIEVED:/EXTRA:/MISSED: lines from all judge outputs
collect_lines() {
  local prefix="$1"; shift
  for f in "$@"; do
    [ -f "$f" ] || continue
    grep "^${prefix}:" "$f" | sed "s/^${prefix}://" | sed 's/^ *//' | grep -v '^$'
  done
}

ACHIEVED_FILE="$WORK_DIR/achieved.txt"
EXTRAS_FILE="$WORK_DIR/extras.txt"
MISSED_FILE="$WORK_DIR/missed.txt"

collect_lines "ACHIEVED" "$A_Q1" "$B_Q1" > "$ACHIEVED_FILE"
collect_lines "EXTRA"    "$A_Q2" "$B_Q2" > "$EXTRAS_FILE"
collect_lines "MISSED"   "$A_Q3" "$B_Q3" > "$MISSED_FILE"

# Build JSON arrays from collected lines
lines_to_json_array() {
  local file="$1"
  [ -f "$file" ] || { printf '[]'; return; }
  local json="["
  local first=1
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    # escape backslash and double-quote
    local escaped
    escaped="$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    if [ "$first" = "1" ]; then
      json="$json\"$escaped\""
      first=0
    else
      json="$json,\"$escaped\""
    fi
  done < "$file"
  json="$json]"
  printf '%s' "$json"
}

# Build JSON arrays — used in the verdict artifact and as synthesizer fallback
EXTRAS_JSON="$(lines_to_json_array "$EXTRAS_FILE")"

# Majority verdict: if MISSED list is non-empty → fail; else pass
MISSED_COUNT="$(wc -l < "$MISSED_FILE" | tr -d ' ')"
MISSED_COUNT="${MISSED_COUNT:-0}"
if [ "$MISSED_COUNT" -gt 0 ]; then
  DETERMINISTIC_VERDICT="fail"
else
  DETERMINISTIC_VERDICT="pass"
fi

# ── Synthesizer: one haiku model pass ─────────────────────────────────────────
SYNTH_VERDICT="$DETERMINISTIC_VERDICT"  # default: deterministic fallback
SYNTH_DISSENTS="[]"
SYNTH_EXTRAS="$EXTRAS_JSON"

SYNTH_PROMPT="$(cat <<PROMPT
You are a synthesis judge. Based on the following interrogation results:

ACHIEVED GOALS:
$(cat "$ACHIEVED_FILE" 2>/dev/null || echo "(none)")

ITEMS BEYOND STATED GOALS (EXTRAS):
$(cat "$EXTRAS_FILE" 2>/dev/null || echo "(none)")

UNACHIEVED GOALS:
$(cat "$MISSED_FILE" 2>/dev/null || echo "(none)")

Output ONLY a JSON object with these fields:
- verdict: "pass" or "fail" (pass = all stated goals achieved with no critical misses)
- dissents: array of strings describing disagreements between judges (can be empty)
- extras: array of strings listing items done beyond stated goals (can be empty)

Example: {"verdict":"pass","dissents":[],"extras":["Added error handling beyond spec"]}
PROMPT
)"

SYNTH_OUT="$WORK_DIR/synth.txt"
SYNTH_TOKEN_EST="$(estimate_tokens_str "$SYNTH_PROMPT")"
TOKEN_TOTAL=$((TOKEN_TOTAL + SYNTH_TOKEN_EST))

if printf '%s' "$SYNTH_PROMPT" | "$CLAUDE_BIN" -p --model claude-haiku-4-5 > "$SYNTH_OUT" 2>/dev/null; then
  SYNTH_RESP_TOKENS="$(estimate_tokens_file "$SYNTH_OUT")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + SYNTH_RESP_TOKENS))

  SYNTH_JSON="$(extract_last_json "$(cat "$SYNTH_OUT")")"
  if [ -n "$SYNTH_JSON" ]; then
    local_v="$(printf '%s' "$SYNTH_JSON" | grep -o '"verdict":"[^"]*"' | cut -d'"' -f4)"
    [ -n "$local_v" ] && SYNTH_VERDICT="$local_v"

    # Extract dissents array (simple: take the bracket contents)
    local_d="$(printf '%s' "$SYNTH_JSON" | python3 -c '
import sys, json
try:
    d = json.loads(sys.stdin.read())
    arr = d.get("dissents", [])
    import json as j2
    print(j2.dumps(arr))
except Exception:
    print("[]")
' 2>/dev/null || echo "[]")"
    SYNTH_DISSENTS="$local_d"

    local_e="$(printf '%s' "$SYNTH_JSON" | python3 -c '
import sys, json
try:
    d = json.loads(sys.stdin.read())
    arr = d.get("extras", [])
    import json as j2
    print(j2.dumps(arr))
except Exception:
    print("[]")
' 2>/dev/null || echo "[]")"
    SYNTH_EXTRAS="$local_e"
  fi
  # If parsing failed, fallback verdict already set above
else
  printf 'qc-panel.sh: synthesizer model call failed; using deterministic majority verdict (%s)\n' \
    "$DETERMINISTIC_VERDICT" >&2
  # SYNTH_VERDICT already = DETERMINISTIC_VERDICT
fi

# ── Write verdict artifact (Amendment 4 liveness part a) ─────────────────────
TS="$(now_iso)"
TS_SAFE="$(printf '%s' "$TS" | tr ':' '-')"
NODE_LABEL="${NODE_ID:-node}"
VERDICT_FILE="$OUT_DIR/${NODE_LABEL}-${TS_SAFE}.json"

# Store raw judge output paths for traceability
cp "$A_Q1" "$OUT_DIR/${NODE_LABEL}-${TS_SAFE}-a_q1.txt" 2>/dev/null || true
cp "$A_Q2" "$OUT_DIR/${NODE_LABEL}-${TS_SAFE}-a_q2.txt" 2>/dev/null || true
cp "$A_Q3" "$OUT_DIR/${NODE_LABEL}-${TS_SAFE}-a_q3.txt" 2>/dev/null || true
cp "$B_Q1" "$OUT_DIR/${NODE_LABEL}-${TS_SAFE}-b_q1.txt" 2>/dev/null || true
cp "$B_Q2" "$OUT_DIR/${NODE_LABEL}-${TS_SAFE}-b_q2.txt" 2>/dev/null || true
cp "$B_Q3" "$OUT_DIR/${NODE_LABEL}-${TS_SAFE}-b_q3.txt" 2>/dev/null || true

JUDGES_JSON="$(printf '{"a_q1":"%s","a_q2":"%s","a_q3":"%s","b_q1":"%s","b_q2":"%s","b_q3":"%s"}' \
  "${NODE_LABEL}-${TS_SAFE}-a_q1.txt" \
  "${NODE_LABEL}-${TS_SAFE}-a_q2.txt" \
  "${NODE_LABEL}-${TS_SAFE}-a_q3.txt" \
  "${NODE_LABEL}-${TS_SAFE}-b_q1.txt" \
  "${NODE_LABEL}-${TS_SAFE}-b_q2.txt" \
  "${NODE_LABEL}-${TS_SAFE}-b_q3.txt")"

VERDICT_JSON="$(printf '{"status":"ok","verdict":"%s","dissents":%s,"extras":%s,"judges":%s,"token_estimate":%d,"skipped_reason":null}\n' \
  "$SYNTH_VERDICT" \
  "$SYNTH_DISSENTS" \
  "$SYNTH_EXTRAS" \
  "$JUDGES_JSON" \
  "$TOKEN_TOTAL")"

printf '%s\n' "$VERDICT_JSON" > "$VERDICT_FILE" || die_liveness "failed to write verdict artifact: $VERDICT_FILE"

# ── Calibration sample (Amendment 4 liveness part b) ─────────────────────────
# The authoritative verdict is the current node report verdict (what was claimed).
# Panel verdict is our synthesized assessment.
# Note: the 'outcome' field is deferred (unknown at panel time; set later by dispatcher).
CALIBRATION_ARGS=(
  --panel-verdict "$SYNTH_VERDICT"
  --authoritative-verdict "$NODE_VERDICT"
  --tokens "$TOKEN_TOTAL"
)
[ -n "${NODE_ID:-}" ] && CALIBRATION_ARGS+=(--source "node:$NODE_ID")

if ! "$CALIBRATION_SH" add-sample "${CALIBRATION_ARGS[@]}"; then
  die_liveness "calibration.sh add-sample failed (liveness assertion: panel run must produce a sample)"
fi

# ── Print verdict to stdout ───────────────────────────────────────────────────
printf '%s\n' "$VERDICT_JSON"
