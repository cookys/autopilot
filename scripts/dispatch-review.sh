#!/usr/bin/env bash
# dispatch-review — READ-ONLY heterogeneous reviewer dispatch (sibling of, NOT a
# mode of, the write-oriented dispatch-hetero.sh). Feeds a diff as TEXT to a panel
# engine and parses a VERDICT, so a disjoint-family qc panel can include a vendor
# (e.g. Gemini-via-agy) that is unreliable as an implementer but fine as a reviewer.
#
# Why a script: the agy/Gemini read path has two non-obvious rails that MUST NOT be
# skipped — (1) the diff goes in the PROMPT as text (agy -p ignores cwd; asking it to
# read the worktree re-triggers the scratch-project hunt), and (2) agy -p drops stdout
# under a non-TTY pipe (#76/#408), so its output is captured through a `script -qec`
# pseudo-TTY. EMPTY / unparseable capture is treated FAIL-CLOSED (status:no_verdict) —
# an empty agy reply must NEVER be read as SHIP-AS-IS.
#
# This script NEVER writes the repo, creates no worktree, runs no git mutation — it is
# read-only by construction. Verdict synthesis (union-on-verified-critical) stays at
# depth 0; this only obtains ONE panelist's verdict.
#
# USAGE:
#   scripts/dispatch-review.sh --runner codex|agy --model <name> --diff-file <file>
#       [--effort xhigh]        # codex reasoning effort (low|medium|high|xhigh|max)
#       [--timeout 5m]          # agy --print-timeout (default 5m)
#       [--bin <path>]          # override the runner binary (test seam)
#
# OUTPUT: one JSON object on stdout:
#   { "runner": "agy|codex", "model": "...", "status": "reviewed|no_verdict|precondition_failed",
#     "verdict": "SHIP-AS-IS|FIX-THEN-SHIP|null", "findings": "...", "raw_log": "<path>", "error": "..." }
#
# EXIT: 0 = reviewed (a verdict was parsed) ; 1 = no_verdict (FAIL-CLOSED — caller must
#   NOT treat as pass) ; 2 = precondition_failed.

set -uo pipefail

RUNNER=""; MODEL=""; DIFF_FILE=""; EFFORT="xhigh"; TIMEOUT="5m"; BIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner)    RUNNER="${2:-}"; shift 2 ;;
    --model)     MODEL="${2:-}"; shift 2 ;;
    --diff-file) DIFF_FILE="${2:-}"; shift 2 ;;
    --effort)    EFFORT="${2:-}"; shift 2 ;;
    --timeout)   TIMEOUT="${2:-}"; shift 2 ;;
    --bin)       BIN="${2:-}"; shift 2 ;;
    -h|--help)   sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

die_precondition() { printf '{ "runner": "%s", "model": "%s", "status": "precondition_failed", "verdict": null, "findings": "", "raw_log": null, "error": "%s" }\n' "$RUNNER" "$MODEL" "$1"; exit 2; }

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy)"
case "$RUNNER" in codex|agy) ;; *) die_precondition "--runner must be codex or agy (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
[[ -n "$DIFF_FILE" && -r "$DIFF_FILE" ]] || die_precondition "--diff-file is required and must be readable"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be low|medium|high|xhigh|max" ;; esac

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'; }

# Build the review prompt: diff goes in as TEXT (never ask the engine to read the worktree).
PROMPT_FILE="$(mktemp -t dispatch-review-prompt-XXXXXX)"
RAW_LOG="$(mktemp -t dispatch-review-log-XXXXXX)"
cleanup() { rm -f "$PROMPT_FILE"; }
trap cleanup EXIT
{
  cat <<'HDR'
You are a code reviewer. Review ONLY the diff below for correctness, security, and
completeness. Do NOT edit any file, do NOT create any project, do NOT run commands.
Output your verdict in EXACTLY this format and nothing else:
VERDICT: <SHIP-AS-IS | FIX-THEN-SHIP>
FINDINGS: <one finding per line, or the single word none>

Diff under review:
```
HDR
  cat "$DIFF_FILE"
  printf '\n```\n'
} > "$PROMPT_FILE"

# --- dispatch (read-only) ---
if [[ "$RUNNER" = "codex" ]]; then
  CODEX_BIN="${BIN:-codex}"
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN"
  # codex stdout is delivered normally under a pipe.
  "$CODEX_BIN" exec --model "$MODEL" \
      --dangerously-bypass-approvals-and-sandbox \
      -c "model_reasoning_effort=\"$EFFORT\"" < "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
else
  AGY_BIN="${BIN:-agy}"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  # agy -p drops stdout under a non-TTY pipe (#76/#408) → capture through a pseudo-TTY.
  RUN_SH="$(mktemp -t dispatch-review-agy-XXXXXX)"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'exec %q -p "$(cat %q)" --model %q --dangerously-skip-permissions --print-timeout %q\n' \
      "$AGY_BIN" "$PROMPT_FILE" "$MODEL" "$TIMEOUT"
  } > "$RUN_SH"
  chmod +x "$RUN_SH"
  script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1 || true
  rm -f "$RUN_SH"
  # strip carriage returns the pseudo-TTY inserts
  tr -d '\r' < "$RAW_LOG" > "$RAW_LOG.clean" && mv "$RAW_LOG.clean" "$RAW_LOG"
fi

# --- parse verdict (fail-closed) ---
VERDICT="$(grep -aoE 'VERDICT:[[:space:]]*(SHIP-AS-IS|FIX-THEN-SHIP)' "$RAW_LOG" 2>/dev/null | head -1 | grep -aoE 'SHIP-AS-IS|FIX-THEN-SHIP' | head -1)"
FINDINGS="$(grep -aoE 'FINDINGS:.*' "$RAW_LOG" 2>/dev/null | head -1 | sed -E 's/^FINDINGS:[[:space:]]*//')"

if [[ "$VERDICT" != "SHIP-AS-IS" && "$VERDICT" != "FIX-THEN-SHIP" ]]; then
  # EMPTY or unparseable capture — FAIL-CLOSED. Never silently treated as a pass.
  printf '{ "runner": "%s", "model": "%s", "status": "no_verdict", "verdict": null, "findings": "", "raw_log": "%s", "error": "no parseable VERDICT line (empty capture or stdout-drop) — fail-closed, NOT a pass" }\n' \
    "$RUNNER" "$(json_escape "$MODEL")" "$RAW_LOG"
  exit 1
fi

printf '{ "runner": "%s", "model": "%s", "status": "reviewed", "verdict": "%s", "findings": "%s", "raw_log": "%s", "error": null }\n' \
  "$RUNNER" "$(json_escape "$MODEL")" "$VERDICT" "$(json_escape "${FINDINGS:-none}")" "$RAW_LOG"
exit 0
