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
#             Model: $QC_JUDGE_A_MODEL (default: claude-haiku-4-5, Amendment-11 factory default)
#   Judge B — Gemini via $QC_AGY_BIN (default: agy)
#             Model: $QC_JUDGE_B_MODEL (default: "Gemini 3.5 Flash (Medium)", Amendment-11 factory default)
#             Runs in a throwaway dir with ONLY intended inputs; file-write
#             mode; --dangerously-skip-permissions --print-timeout 8m
#
# NOTE on model seams: QC_JUDGE_A_MODEL / QC_JUDGE_B_MODEL / QC_SYNTH_MODEL
#   override the hardcoded Amendment-11 factory defaults. Full resolve-dispatch.sh
#   integration for tree-role routing is deferred — see docs/BACKLOG.md
#   "resolve-dispatch.sh tree-role integration".
#
# QUESTION SHAPES (×2 judges = 6 calls):
#   Q1  "What goals were achieved? Cite evidence from the report."
#   Q2  "What was done BEYOND the stated goals (extras/scope-creep)?"
#   Q3  "What goals were NOT achieved?"
#
# REFUTE PASS (Q4 — SHADOW, NON-GATING until calibrated):
#   A 4th question shape that turns the panel's skepticism on the panel ITSELF.
#   All of Q1–Q3 interrogate the IMPLEMENTER; nothing checks whether the panel's
#   OWN misses are real before they cost a fix round (see project memories
#   verify-reviewer-claims, delegate-selftest-false-green — reviewer findings are
#   non-authoritative). For each candidate MISSED: line, the OTHER cross-family
#   judge (the one that did NOT raise it: B refutes A's misses, A refutes B's)
#   attempts to REFUTE it — argue it is wrong / already satisfied by the artifacts
#   / out of scope per SCOPE_RULE.  UNCERTAINTY COUNTS AGAINST THE FINDING
#   (default-refuted-if-uncertain): a miss SURVIVES only by explicitly defeating
#   refutation; anything else (REFUTED / UNCERTAIN / no clear verdict) is refuted.
#
#   🔴 NON-GATING: the refute result NEVER alters `verdict`. The authoritative
#   verdict logic is UNCHANGED — any non-empty MISSED still fails exactly as
#   before.  The refute outcome is emitted ALONGSIDE as the shadow field
#   `refute_shadow:{refuted_misses[],survived_misses[]}` and rides into the
#   calibration sample (--source refute=…) for feed-forward measurement only.
#   It stays SHADOW / non-gating UNTIL it graduates via scripts/calibration.sh /
#   run-known-bad: it may become authoritative ONLY after the calibration harness
#   shows it does not false-suppress critical findings (calibration.sh
#   GRAD_* data block: min samples, min agreement, false_pass_on_critical == 0).
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
#     "refute_shadow": {          # SHADOW / non-gating — does NOT affect verdict
#       "refuted_misses":  [],    # candidate misses the other judge defeated
#       "survived_misses": []     # misses that survived refutation (real, kept)
#     },
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
#   QC_CLAUDE_BIN     claude binary (default: claude)
#   QC_AGY_BIN        agy binary    (default: agy)
#   QC_JUDGE_A_MODEL  Claude judge model  (default: claude-haiku-4-5, Amendment-11 factory default)
#   QC_JUDGE_B_MODEL  Gemini judge model  (default: "Gemini 3.5 Flash (Medium)", Amendment-11 factory default)
#   QC_SYNTH_MODEL    Synthesizer model   (default: claude-haiku-4-5, Amendment-11 factory default)
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

# ── Model seams (Amendment-11 factory defaults; override via env) ─────────────
JUDGE_A_MODEL="${QC_JUDGE_A_MODEL:-claude-haiku-4-5}"
JUDGE_B_MODEL="${QC_JUDGE_B_MODEL:-Gemini 3.5 Flash (Medium)}"
SYNTH_MODEL="${QC_SYNTH_MODEL:-claude-haiku-4-5}"

# ── Question shapes ───────────────────────────────────────────────────────────
# Node-scope rule: the unit under judgment is THE NODE, not the project.
# (2026-06-12 dogfood: without this, judges counted project-lifecycle closure —
# merge / release gates / archiving — as missed goals of an implementation node,
# producing systematic fail verdicts on every mid-flight node; both live
# calibration samples showed the same pattern.)
SCOPE_RULE="Scope rule: judge ONLY the node whose report appears in the context — the deliverables implied by its 'node'/'question' fields and the claims the report itself makes. Project-level lifecycle steps (merging branches, release/quality gates, archiving, project status updates, and work belonging to OTHER nodes) are OUT OF SCOPE: do not list them as goals, extras, or misses."
Q1="What goals were achieved? Cite specific evidence from the report and artifacts. List each achieved goal on its own line prefixed 'ACHIEVED:'."
Q2="What was done BEYOND the stated goals (extras, scope creep, unrequested changes)? Be specific. List each on its own line prefixed 'EXTRA:'."
Q3="What goals were NOT achieved? What is still missing or incomplete? List each on its own line prefixed 'MISSED:'."
# Q4 — REFUTE pass (SHADOW, non-gating). The literal token __MISS__ is replaced
# (via string substitution, NOT printf — a miss line may contain a '%') with the
# single candidate miss being challenged. The judge must try to REFUTE it;
# uncertainty counts AGAINST the finding (default-refuted-if-uncertain) —
# survival requires an explicit SURVIVES verdict, anything else is REFUTED.
Q4_TEMPLATE="Another reviewer claims the following is a MISSED goal of THIS node: __MISS__

Your job is to REFUTE this claim if you can. Using ONLY the node report and artifacts in the context above, decide whether the claim is wrong — e.g. the goal is actually satisfied by the artifacts, the claim is out of scope per the scope rule, or it misreads the node's deliverables.

Default to REFUTED when uncertain: a reviewer's miss must EARN its survival. Output exactly ONE line, one of:
  REFUTED: <one-sentence reason the claimed miss is wrong / already satisfied / out of scope>
  UNCERTAIN: <why you cannot confirm the miss is real>
  SURVIVES: <evidence the miss is genuinely real and in scope>"

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

ENV: QC_CLAUDE_BIN, QC_AGY_BIN,
     QC_JUDGE_A_MODEL, QC_JUDGE_B_MODEL, QC_SYNTH_MODEL,
     CALIBRATION_DATA_DIR

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
import sys, json
text = sys.stdin.read()
# Scan for the LAST parseable JSON object at any nesting depth: try every
# "{" as a start and use raw_decode (regex approaches cap at fixed depth).
decoder = json.JSONDecoder()
best = None
for i, ch in enumerate(text):
    if ch == "{":
        try:
            obj, _ = decoder.raw_decode(text[i:])
            best = json.dumps(obj)
        except Exception:
            pass
if best is not None:
    print(best)
    sys.exit(0)
# No parseable JSON anywhere: make the degradation VISIBLE, then emit the
# last brace-line so the caller falls back to the deterministic verdict.
print("qc-panel: extract_last_json found no parseable JSON; deterministic fallback will be used", file=sys.stderr)
lines = [l.strip() for l in text.splitlines() if l.strip().startswith("{")]
if lines:
    print(lines[-1])
' || true
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
# A corrupt report must be a loud precondition failure, not a silent skip —
# the skip path exits 0 with no calibration sample (Amendment 4 bypass).
jq -e . "$REPORT_FILE" >/dev/null 2>&1 || die "report file is not valid JSON: $REPORT_FILE"
[ -n "$ARTIFACTS_RAW" ] || die "--artifacts is required"

# Validate --proj and --node: reject values not matching ^[A-Za-z0-9][A-Za-z0-9._-]*$
# or containing '..'; mirrors tree.sh validate_proj_name.
validate_path_component() {
  local name="$1" label="$2"
  case "$name" in
    *..*)
      printf 'qc-panel.sh: invalid %s: contains ".." path traversal: %s\n' "$label" "$name" >&2
      exit 2
      ;;
  esac
  if ! printf '%s' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    printf 'qc-panel.sh: invalid %s: must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (got: %s)\n' "$label" "$name" >&2
    exit 2
  fi
}
[ -n "$PROJ" ]    && validate_path_component "$PROJ" "--proj"
[ -n "$NODE_ID" ] && validate_path_component "$NODE_ID" "--node"

# Derive --out from --proj/--node if not given
if [ -z "$OUT_DIR" ]; then
  [ -n "$PROJ" ] && [ -n "$NODE_ID" ] || die "--out is required unless both --proj and --node are set"
  OUT_DIR="$REPO_ROOT/docs/projects/$PROJ/tree/panel"
fi
mkdir -p "$OUT_DIR" || die "cannot create output dir: $OUT_DIR"

# Build artifact list
IFS=',' read -ra ARTIFACT_PATHS <<< "$ARTIFACTS_RAW"

# ── Check for null verdict (non-verdict-bearing node) ─────────────────────────
NODE_VERDICT="$(jq -r '.verdict // "null"' "$REPORT_FILE" 2>/dev/null)"

# ── Calibration vocabulary bridge ─────────────────────────────────────────────
# Node-report verdicts are free-form strings (tree-contracts §4 examples:
# "approved", "rejected"), but calibration.sh add-sample accepts only
# pass|fail. Map the documented vocabulary HERE, before any judge tokens are
# spent — an unmappable verdict is a NAMED liveness failure (VERDICT_UNMAPPABLE),
# not a generic add-sample error after a ~100k-token panel run.
NODE_VERDICT_CAL=""
if [ "$NODE_VERDICT" != "null" ] && [ -n "$NODE_VERDICT" ]; then
  case "$(printf '%s' "$NODE_VERDICT" | tr '[:upper:]' '[:lower:]')" in
    pass|approved|approve|lgtm) NODE_VERDICT_CAL="pass" ;;
    fail|rejected|reject)       NODE_VERDICT_CAL="fail" ;;
    *) die_liveness "VERDICT_UNMAPPABLE: node report verdict '$NODE_VERDICT' has no pass/fail mapping for calibration (pass|approved|approve|lgtm → pass; fail|rejected|reject → fail). Fix the node report verdict or extend the map." ;;
  esac
fi

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
      printf -- '--- %s ---\n' "$ap"
      cat -- "$ap"
      printf '\n'
    else
      printf -- '--- %s (NOT FOUND) ---\n' "$ap"
    fi
  done
  if [ -n "$DIFF_FILE" ] && [ -f "$DIFF_FILE" ]; then
    printf '\n=== DIFF ===\n'
    cat "$DIFF_FILE"
  fi
} > "$CONTEXT_FILE"

CTX_TOKENS="$(estimate_tokens_file "$CONTEXT_FILE")"
# CTX_TOKENS is accumulated per judge call (each judge sees the context once);

# ── Judge A: Claude (haiku-class) ─────────────────────────────────────────────
# Judge A writes its verdict directly to a file (--output-file not available in
# claude -p so we redirect stdout; narrative pollution on claude is minimal)

run_judge_a() {
  local qnum="$1" question="$2" outfile="$3"
  local prompt
  prompt="$(printf 'You are a code review judge. Review the following context and answer the question.\n\n%s\n\nQUESTION: %s\n\nCONTEXT:\n' "$SCOPE_RULE" "$question")"
  local prompt_tokens
  prompt_tokens="$(estimate_tokens_str "$prompt")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + prompt_tokens + CTX_TOKENS))

  if ! { printf '%s' "$prompt"; cat "$CONTEXT_FILE"; } | \
      "$CLAUDE_BIN" -p --model "$JUDGE_A_MODEL" > "$outfile" 2>/dev/null; then
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
  prompt="$(printf 'You are a code review judge. Review context.txt and answer this question:\n\n%s\n\nQUESTION: %s\n\nWRITE your answer to ./verdict.txt then output only the word DONE.\n' "$SCOPE_RULE" "$question")"
  local prompt_tokens
  prompt_tokens="$(estimate_tokens_str "$prompt")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + prompt_tokens + CTX_TOKENS))

  local agy_out
  if [ "$(basename "$AGY_BIN")" = "codex" ] || [[ "$JUDGE_B_MODEL" == *"gpt-5.5"* ]]; then
    agy_out="$(cd "$judge_dir" && codex exec --model "$JUDGE_B_MODEL" \
        --dangerously-bypass-approvals-and-sandbox \
        --dangerously-bypass-hook-trust \
        -c "thinking=\"xhigh\"" \
        -c "shell_environment_policy.inherit=all" \
        <<< "$prompt" 2>/dev/null)" || true
  else
    agy_out="$(cd "$judge_dir" && "$AGY_BIN" -p "$prompt" \
        --model "$JUDGE_B_MODEL" \
        --dangerously-skip-permissions \
        --print-timeout 8m 2>/dev/null)" || true
  fi

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

# ── Refute runners (Q4 SHADOW pass) ───────────────────────────────────────────
# Same binary recipes as the judge runners, but the question is the per-miss
# refute template (filled with one candidate miss) and the raw response is
# returned on stdout for the caller to classify. These are NON-GATING and are
# tolerant of failure: a refute call that errors leaves the miss to survive
# (fail-closed toward the existing verdict — a dead refute pass never suppresses
# a finding). Refute tokens are accounted into TOKEN_TOTAL like any other call.

refute_with_judge_a() {
  local miss="$1"
  local question prompt
  question="${Q4_TEMPLATE//__MISS__/$miss}"
  prompt="$(printf 'You are a code review judge. Review the following context and answer the question.\n\n%s\n\nQUESTION: %s\n\nCONTEXT:\n' "$SCOPE_RULE" "$question")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + $(estimate_tokens_str "$prompt") + CTX_TOKENS))
  local out
  out="$({ printf '%s' "$prompt"; cat "$CONTEXT_FILE"; } | "$CLAUDE_BIN" -p --model "$JUDGE_A_MODEL" 2>/dev/null)" || out=""
  TOKEN_TOTAL=$((TOKEN_TOTAL + ${#out} / 4))
  printf '%s' "$out"
}

refute_with_judge_b() {
  local miss="$1"
  local question prompt judge_dir
  question="${Q4_TEMPLATE//__MISS__/$miss}"
  judge_dir="$(mktemp -d -t "qc-refute-b-XXXXXX")"
  cp "$CONTEXT_FILE" "$judge_dir/context.txt"
  prompt="$(printf 'You are a code review judge. Review context.txt and answer this question:\n\n%s\n\nQUESTION: %s\n\nWRITE your answer to ./verdict.txt then output only the word DONE.\n' "$SCOPE_RULE" "$question")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + $(estimate_tokens_str "$prompt") + CTX_TOKENS))
  local agy_out
  if [ "$(basename "$AGY_BIN")" = "codex" ] || [[ "$JUDGE_B_MODEL" == *"gpt-5.5"* ]]; then
    agy_out="$(cd "$judge_dir" && codex exec --model "$JUDGE_B_MODEL" \
        --dangerously-bypass-approvals-and-sandbox \
        --dangerously-bypass-hook-trust \
        -c "thinking=\"xhigh\"" \
        -c "shell_environment_policy.inherit=all" \
        <<< "$prompt" 2>/dev/null)" || true
  else
    agy_out="$(cd "$judge_dir" && "$AGY_BIN" -p "$prompt" \
        --model "$JUDGE_B_MODEL" \
        --dangerously-skip-permissions \
        --print-timeout 8m 2>/dev/null)" || true
  fi
  local out=""
  if [ -f "$judge_dir/verdict.txt" ] && [ -s "$judge_dir/verdict.txt" ]; then
    out="$(cat "$judge_dir/verdict.txt")"
  else
    out="$agy_out"
  fi
  TOKEN_TOTAL=$((TOKEN_TOTAL + ${#out} / 4))
  rm -rf "$judge_dir"
  printf '%s' "$out"
}

# classify_refutation: map a refute response to refuted|survived.
# default-refuted-if-uncertain — a miss SURVIVES only on an explicit SURVIVES
# verdict; REFUTED, UNCERTAIN, an empty/failed response, or anything ambiguous
# all count AGAINST the finding (it is treated as refuted).
classify_refutation() {
  local resp="$1"
  # First decisive token wins; scan case-insensitively.
  local first
  first="$(printf '%s' "$resp" | grep -ioE 'REFUTED|UNCERTAIN|SURVIVES' | head -1 | tr '[:lower:]' '[:upper:]')"
  case "$first" in
    SURVIVES) printf 'survived' ;;
    *)        printf 'refuted'  ;;
  esac
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

# Per-judge MISSED provenance — refute-pass ONLY (the combined MISSED_FILE above
# is the gating input and is left untouched). A judge's own miss must be
# challenged by the OTHER family, so we keep the two sources separate here.
A_MISSED_FILE="$WORK_DIR/missed_a.txt"
B_MISSED_FILE="$WORK_DIR/missed_b.txt"
collect_lines "MISSED" "$A_Q3" > "$A_MISSED_FILE"
collect_lines "MISSED" "$B_Q3" > "$B_MISSED_FILE"

# Build JSON arrays from collected lines
lines_to_json_array() {
  local file="$1"
  [ -f "$file" ] || { printf '[]'; return; }
  # jq -R reads raw lines and produces RFC-8259-safe JSON strings (handles
  # backslash, quote, AND control characters like tab — sed escaping missed
  # those and could emit malformed JSON).
  jq -R -s 'split("\n") | map(select(length > 0))' "$file" | jq -c .
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
You are a synthesis judge. $SCOPE_RULE

Based on the following interrogation results:

ACHIEVED GOALS:
$(cat "$ACHIEVED_FILE" 2>/dev/null || echo "(none)")

ITEMS BEYOND STATED GOALS (EXTRAS):
$(cat "$EXTRAS_FILE" 2>/dev/null || echo "(none)")

UNACHIEVED GOALS:
$(cat "$MISSED_FILE" 2>/dev/null || echo "(none)")

Output ONLY a JSON object with these fields:
- verdict: "pass" or "fail" (pass = all the NODE's stated goals achieved with no critical misses, applying the scope rule above)
- dissents: array of strings describing disagreements between judges (can be empty)
- extras: array of strings listing items done beyond stated goals (can be empty)

Example: {"verdict":"pass","dissents":[],"extras":["Added error handling beyond spec"]}
PROMPT
)"

SYNTH_OUT="$WORK_DIR/synth.txt"
SYNTH_TOKEN_EST="$(estimate_tokens_str "$SYNTH_PROMPT")"
TOKEN_TOTAL=$((TOKEN_TOTAL + SYNTH_TOKEN_EST))

if printf '%s' "$SYNTH_PROMPT" | "$CLAUDE_BIN" -p --model "$SYNTH_MODEL" > "$SYNTH_OUT" 2>/dev/null; then
  SYNTH_RESP_TOKENS="$(estimate_tokens_file "$SYNTH_OUT")"
  TOKEN_TOTAL=$((TOKEN_TOTAL + SYNTH_RESP_TOKENS))

  SYNTH_JSON="$(extract_last_json "$(cat "$SYNTH_OUT")")"
  if [ -n "$SYNTH_JSON" ]; then
    local_v="$(printf '%s' "$SYNTH_JSON" | jq -r '.verdict // empty' 2>/dev/null)"
    # Guard: only the two contract values may reach the assembled JSON —
    # anything else (multi-token, stray quote) keeps the deterministic fallback.
    case "$local_v" in
      pass|fail) SYNTH_VERDICT="$local_v" ;;
    esac

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

# ── Refute pass (Q4 — SHADOW, NON-GATING) ─────────────────────────────────────
# For each candidate MISSED line, the OTHER cross-family judge tries to refute
# it: judge A's misses are challenged by judge B, judge B's by judge A. A miss
# SURVIVES only on an explicit SURVIVES verdict (default-refuted-if-uncertain).
# This computes a shadow field ONLY — it NEVER touches SYNTH_VERDICT or the
# gating logic above. Stays shadow until graduated via scripts/calibration.sh.
REFUTED_LINES="$WORK_DIR/refuted.txt"
SURVIVED_LINES="$WORK_DIR/survived.txt"
: > "$REFUTED_LINES"
: > "$SURVIVED_LINES"

# Refute judge A's misses with judge B.
if [ -s "$A_MISSED_FILE" ]; then
  while IFS= read -r miss; do
    [ -z "$miss" ] && continue
    if [ "$(classify_refutation "$(refute_with_judge_b "$miss")")" = "survived" ]; then
      printf '%s\n' "$miss" >> "$SURVIVED_LINES"
    else
      printf '%s\n' "$miss" >> "$REFUTED_LINES"
    fi
  done < "$A_MISSED_FILE"
fi
# Refute judge B's misses with judge A.
if [ -s "$B_MISSED_FILE" ]; then
  while IFS= read -r miss; do
    [ -z "$miss" ] && continue
    if [ "$(classify_refutation "$(refute_with_judge_a "$miss")")" = "survived" ]; then
      printf '%s\n' "$miss" >> "$SURVIVED_LINES"
    else
      printf '%s\n' "$miss" >> "$REFUTED_LINES"
    fi
  done < "$B_MISSED_FILE"
fi

REFUTED_JSON="$(lines_to_json_array "$REFUTED_LINES")"
SURVIVED_JSON="$(lines_to_json_array "$SURVIVED_LINES")"
# Count non-empty lines. `grep -c` exits 1 on zero matches, which would make a
# `|| printf 0` fallback DOUBLE-emit ("0\n0") and corrupt the source tag — use a
# single deterministic line count instead.
count_nonempty() { grep -c '.' "$1" 2>/dev/null; :; }
REFUTED_COUNT="$(count_nonempty "$REFUTED_LINES")"; REFUTED_COUNT="${REFUTED_COUNT:-0}"
SURVIVED_COUNT="$(count_nonempty "$SURVIVED_LINES")"; SURVIVED_COUNT="${SURVIVED_COUNT:-0}"
REFUTE_SHADOW_JSON="$(printf '{"refuted_misses":%s,"survived_misses":%s}' "$REFUTED_JSON" "$SURVIVED_JSON")"

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

# refute_shadow rides alongside verdict — it is SHADOW / non-gating and does
# NOT influence the "verdict" field above (which stays the existing any-MISSED
# fail logic, exactly as before this pass existed).
VERDICT_JSON="$(printf '{"status":"ok","verdict":"%s","dissents":%s,"extras":%s,"judges":%s,"refute_shadow":%s,"token_estimate":%d,"skipped_reason":null}\n' \
  "$SYNTH_VERDICT" \
  "$SYNTH_DISSENTS" \
  "$SYNTH_EXTRAS" \
  "$JUDGES_JSON" \
  "$REFUTE_SHADOW_JSON" \
  "$TOKEN_TOTAL")"

printf '%s\n' "$VERDICT_JSON" > "$VERDICT_FILE" || die_liveness "failed to write verdict artifact: $VERDICT_FILE"

# ── Calibration sample (Amendment 4 liveness part b) ─────────────────────────
# This internal sample uses --baseline self-report: the authoritative-verdict
# here is the node report's own verdict (worker self-report), not the reviewer's
# verdict.  It is liveness-only and excluded from graduation math.
# The dispatcher's post-review add-sample (--baseline reviewer) is the
# graduation-bearing sample (see skills/quality-pipeline/references/code-review.md
# "Shadow QC panel" § and skills/quality-pipeline/SKILL.md "Shadow QC panel" §).
CALIBRATION_ARGS=(
  --panel-verdict "$SYNTH_VERDICT"
  --authoritative-verdict "$NODE_VERDICT_CAL"
  --baseline self-report
  --tokens "$TOKEN_TOTAL"
)
# Ride the refute SHADOW result into the sample's --source field so a later
# `calibration.sh report` (or run-known-bad replay) can measure how often the
# refute pass would have SUPPRESSED a miss that the authoritative verdict held
# real — the graduation gate for making it gating. Format is a stable,
# JSON-safe (no quotes/braces) tail: "refute=refuted:N,survived:M,gating_misses:K".
# gating_misses is the count the UNCHANGED verdict logic acted on.
REFUTE_SRC_TAG="refute=refuted:${REFUTED_COUNT},survived:${SURVIVED_COUNT},gating_misses:${MISSED_COUNT}"
if [ -n "${NODE_ID:-}" ]; then
  CALIBRATION_ARGS+=(--source "node:$NODE_ID $REFUTE_SRC_TAG")
else
  CALIBRATION_ARGS+=(--source "$REFUTE_SRC_TAG")
fi

if ! "$CALIBRATION_SH" add-sample "${CALIBRATION_ARGS[@]}"; then
  die_liveness "calibration.sh add-sample failed (liveness assertion: panel run must produce a sample)"
fi

# ── Print verdict to stdout ───────────────────────────────────────────────────
printf '%s\n' "$VERDICT_JSON"
