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
# Read-only posture: the diff under review is UNTRUSTED (a malicious diff could carry a
# prompt-injection). So the codex path runs under `--sandbox read-only` (NOT a sandbox
# bypass — the reviewer never needs to write/exec), and the agy path (no upstream
# read-only mode) is dispatched from a throwaway scratch cwd, never the repo. This script
# itself creates no worktree and runs no git mutation. Verdict synthesis
# (union-on-verified-critical) stays at depth 0; this only obtains ONE panelist's verdict.
#
# USAGE:
#   scripts/dispatch-review.sh --runner codex|agy|grok --model <name> --diff-file <file>
#       [--effort xhigh]        # codex reasoning effort (low|medium|high|xhigh|max)
#       [--timeout 5m]          # agy --print-timeout (default 5m)
#       [--bin <path>]          # override the runner binary (test seam)
#   grok runner: read-only by construction (scratch cwd, no --always-approve,
#   --disable-web-search, --output-format plain). models: grok-build, grok-composer-2.5-fast
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

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy|grok)"
case "$RUNNER" in codex|agy|grok) ;; *) die_precondition "--runner must be codex, agy, or grok (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
[[ -n "$DIFF_FILE" && -r "$DIFF_FILE" ]] || die_precondition "--diff-file is required and must be readable"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be low|medium|high|xhigh|max" ;; esac

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'; }

# Build the review prompt: diff goes in as TEXT (never ask the engine to read the worktree).
PROMPT_FILE="$(mktemp -t dispatch-review-prompt-XXXXXX)"
RAW_LOG="$(mktemp -t dispatch-review-log-XXXXXX)"
GROK_CWD=""   # set only on the grok path; cleaned by the trap so it can't leak on interrupt
cleanup() { rm -f "$PROMPT_FILE"; [ -n "$GROK_CWD" ] && rm -rf "$GROK_CWD"; }
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
  # READ-ONLY sandbox: a reviewer never writes/execs, and the diff is untrusted (injection).
  # codex stdout is delivered normally under a pipe.
  "$CODEX_BIN" exec --model "$MODEL" \
      --sandbox read-only \
      -c "model_reasoning_effort=\"$EFFORT\"" < "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
elif [[ "$RUNNER" = "grok" ]]; then
  GROK_BIN="${BIN:-grok}"
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN"
  # READ-ONLY by construction (the diff is untrusted): run in a SCRATCH cwd (never the
  # repo), NO --always-approve (so it cannot auto-run/edit — Spike-verified that a pure
  # review prompt needs no tools and does not hang without it), --disable-web-search (no
  # external calls on an untrusted diff). --output-format plain so the VERDICT/FINDINGS
  # come out as line-start plain text the parser matches (json wraps them in a "text"
  # field with literal \n → parser miss). grok delivers stdout under a pipe (unlike agy),
  # so a direct redirect captures it — no script -qec needed. (Spike 2026-06-29.)
  GROK_CWD="$(mktemp -d -t dispatch-review-grokcwd-XXXXXX)"
  # ENFORCED timeout (grok has no --print-timeout like agy): an auth prompt, model/tool
  # approval prompt, network stall, or a prompt-injected tool attempt could otherwise hang
  # the caller forever. `timeout` kills the run at $TIMEOUT (exit 124) → captured below →
  # parser sees no verdict → fail-closed no_verdict. Never SHIP on a stall.
  # Feed the prompt via --prompt-file (NOT -p "$(cat …)"): a large diff as a single argv
  # arg can hit ARG_MAX before grok runs → avoidable no_verdict. PROMPT_FILE is an
  # absolute mktemp path (grok resolves --prompt-file relative to --cwd, so it MUST be
  # absolute — Spike-verified 2026-06-29: a relative path errored, absolute worked).
  timeout "$TIMEOUT" "$GROK_BIN" --prompt-file "$PROMPT_FILE" --cwd "$GROK_CWD" --model "$MODEL" \
      --no-alt-screen --output-format plain --disable-web-search > "$RAW_LOG" 2>/dev/null
  GROK_RC=$?   # do NOT swallow with `|| true`: no `set -e` here, so capturing is safe
  rm -rf "$GROK_CWD"
  # FAIL-CLOSED on any non-zero grok exit (bad flag/model, auth, or rc=124 timeout):
  # emit no_verdict and EXIT HERE, BEFORE the shared VERDICT parser. Critical — grok can
  # print a partial `VERDICT: SHIP-AS-IS` line and THEN stall/fail; letting that partial
  # output reach the parser would mark a failed/timed-out run as a SHIP (gpt-5.5 review).
  # The partial output stays in raw_log for debugging; it is never trusted as a verdict.
  if [ "$GROK_RC" -ne 0 ]; then
    printf '\n[dispatch-review: grok exited non-zero (rc=%s%s) — partial output NOT parsed]\n' \
      "$GROK_RC" "$([ "$GROK_RC" -eq 124 ] && printf ' TIMEOUT after %s' "$TIMEOUT")" >> "$RAW_LOG"
    printf '{ "runner": "%s", "model": "%s", "status": "no_verdict", "verdict": null, "findings": "", "raw_log": "%s", "error": "grok exited non-zero (rc=%s) — fail-closed, partial output not parsed" }\n' \
      "$RUNNER" "$(json_escape "$MODEL")" "$RAW_LOG" "$GROK_RC"
    exit 1
  fi
else
  AGY_BIN="${BIN:-agy}"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  # agy -p drops stdout under a non-TTY pipe (#76/#408) → capture through a pseudo-TTY.
  RUN_SH="$(mktemp -t dispatch-review-agy-XXXXXX)"
  AGY_CWD="$(mktemp -d -t dispatch-review-agycwd-XXXXXX)"  # scratch cwd, NEVER the repo
  {
    printf '#!/usr/bin/env bash\n'
    printf 'cd %q || exit 9\n' "$AGY_CWD"
    printf 'exec %q -p "$(cat %q)" --model %q --dangerously-skip-permissions --print-timeout %q\n' \
      "$AGY_BIN" "$PROMPT_FILE" "$MODEL" "$TIMEOUT"
  } > "$RUN_SH"
  chmod +x "$RUN_SH"
  script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1 || true
  rm -rf "$RUN_SH" "$AGY_CWD"
  # strip carriage returns the pseudo-TTY inserts
  tr -d '\r' < "$RAW_LOG" > "$RAW_LOG.clean" && mv "$RAW_LOG.clean" "$RAW_LOG"
fi

# --- parse verdict (fail-closed AND fail-toward-block) ---
# Only consider lines that START with VERDICT: (ignoring leading whitespace), so prose
# that merely mentions a token mid-sentence ("not a VERDICT: SHIP-AS-IS situation") is
# ignored. Resolve CONSERVATIVELY: any FIX-THEN-SHIP among the verdict lines blocks; SHIP
# only when a SHIP line exists and NO FIX line does. Never let an explained reply flip a
# block into a ship.
VLINES="$(grep -aE '^[[:space:]]*VERDICT:[[:space:]]*(SHIP-AS-IS|FIX-THEN-SHIP)' "$RAW_LOG" 2>/dev/null)"
if printf '%s' "$VLINES" | grep -qaE 'FIX-THEN-SHIP'; then
  VERDICT="FIX-THEN-SHIP"
elif printf '%s' "$VLINES" | grep -qaE 'SHIP-AS-IS'; then
  VERDICT="SHIP-AS-IS"
else
  VERDICT=""
fi
FINDINGS="$(grep -aE '^[[:space:]]*FINDINGS:' "$RAW_LOG" 2>/dev/null | head -1 | sed -E 's/^[[:space:]]*FINDINGS:[[:space:]]*//')"

if [[ "$VERDICT" != "SHIP-AS-IS" && "$VERDICT" != "FIX-THEN-SHIP" ]]; then
  # EMPTY or unparseable capture — FAIL-CLOSED. Never silently treated as a pass.
  printf '{ "runner": "%s", "model": "%s", "status": "no_verdict", "verdict": null, "findings": "", "raw_log": "%s", "error": "no parseable VERDICT line (empty capture or stdout-drop) — fail-closed, NOT a pass" }\n' \
    "$RUNNER" "$(json_escape "$MODEL")" "$RAW_LOG"
  exit 1
fi

printf '{ "runner": "%s", "model": "%s", "status": "reviewed", "verdict": "%s", "findings": "%s", "raw_log": "%s", "error": null }\n' \
  "$RUNNER" "$(json_escape "$MODEL")" "$VERDICT" "$(json_escape "${FINDINGS:-none}")" "$RAW_LOG"
exit 0
