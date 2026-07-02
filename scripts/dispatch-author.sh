#!/usr/bin/env bash
# dispatch-author — READ-ONLY heterogeneous authoring dispatch (sibling of,
# NOT a mode of, the panel-oriented dispatch-review.sh). This shell accepts a
# prompt file and forwards it as raw prompt bytes to a writer-capable runner for
# AUTHORING tasks (test plans, verification docs, spec/risk writeups), with no
# local template wrapper.
#
# Why separate from dispatch-review.sh:
# - dispatch-review feeds a REVIEW template + embedded DIFF BLOCK for verifier
#   isolation.
# - reviewer and authoring are structurally different contracts; the review
#   template (including "You are a code reviewer" and "Diff under review") causes
#   AUTHORING inputs to be parsed as a spec, not an instruction-to-write, and
#   this was proven in the 2026-07-02 l6/N2 incident (Gemini correctly refused to
#   write spec text under a reviewer template).
#
# Read-only posture: authoring prompt is untrusted input for the engine as with any
# other task, so only untrusted outputs are read; no repo mutation path and no
# temp prompt reuse between invocations. For run-time parity with dispatch-review.sh:
# - codex: --sandbox read-only + model reasoning effort + stdin prompt.
# - agy: scratch cwd (never repo cwd) + pseudo-tty capture (`script -qec`) + CRLF
#   stripping + AGY `--print-timeout`.
# - grok: scratch cwd + `--prompt-file` + `--disable-web-search` + `--output-format plain`.
# - cc-shim: baseline `--setting-sources project`, `--strict-mcp-config`, `--tools ""`,
#   `HOME=<scratch>`, `env -u ANTHROPIC_API_KEY`; preconditions on
#   ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN retained.
#
# USAGE:
#   scripts/dispatch-author.sh --runner codex|agy|grok|cc-shim --model <name> --prompt-file <file>
#       [--effort xhigh]        # codex reasoning effort (low|medium|high|xhigh|max)
#       [--timeout 5m]          # agy --print-timeout / grok/cc-shim timeout (default 5m)
#       [--bin <path>]          # override the runner binary (test seam)
#   ⏳ TIMEOUT: this call can run for MINUTES.
#   DISPATCH_QUIET=1 suppresses progress notes on stderr.
#
# OUTPUT: one JSON object on stdout:
#   { "runner": "codex|agy|grok|cc-shim", "model": "...", "status": "authored|empty_output|precondition_failed", "raw_log": "<path>", "error": "..." }
#
# EXIT: 0 = authored (non-empty raw output), 1 = empty_output, 2 = precondition_failed.

set -uo pipefail

RUNNER=""; MODEL=""; PROMPT_FILE=""; EFFORT="xhigh"; TIMEOUT="5m"; BIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner)      RUNNER="${2:-}"; shift 2 ;;
    --model)       MODEL="${2:-}"; shift 2 ;;
    --prompt-file)  PROMPT_FILE="${2:-}"; shift 2 ;;
    --effort)      EFFORT="${2:-}"; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; shift 2 ;;
    --bin)         BIN="${2:-}"; shift 2 ;;
    -h|--help)     sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'; }

die_precondition() {
  printf '{ "runner": "%s", "model": "%s", "status": "precondition_failed", "raw_log": null, "error": "%s" }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$1")"
  exit 2
}

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy|grok|cc-shim)"
case "$RUNNER" in codex|agy|grok|cc-shim) ;; *) die_precondition "--runner must be codex, agy, grok, or cc-shim (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
[[ -n "$PROMPT_FILE" && -r "$PROMPT_FILE" ]] || die_precondition "--prompt-file is required and must be readable"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be low|medium|high|xhigh|max" ;; esac

RAW_LOG="$(mktemp -t dispatch-author-log-XXXXXX)"
GROK_CWD=""
CCSHIM_CWD=""
AGY_CWD=""
cleanup() { rm -f "$RAW_LOG"; [ -n "$GROK_CWD" ] && rm -rf "$GROK_CWD"; [ -n "$CCSHIM_CWD" ] && rm -rf "$CCSHIM_CWD"; [ -n "$AGY_CWD" ] && rm -rf "$AGY_CWD"; }
trap cleanup EXIT

[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-author: ${RUNNER}/${MODEL} (effort=${EFFORT}, timeout=${TIMEOUT})" >&2

if [[ "$RUNNER" = "codex" ]]; then
  CODEX_BIN="${BIN:-codex}"
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN"
  # READ-ONLY by posture only; codex is the same sandboxed runner used for
  # review in dispatch-review.sh and is the strongest default isolation option
  # available here.
  "$CODEX_BIN" exec --model "$MODEL" \
    --sandbox read-only \
    -c "model_reasoning_effort=\"$EFFORT\"" < "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
elif [[ "$RUNNER" = "grok" ]]; then
  GROK_BIN="${BIN:-grok}"
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN"
  # Read-only by construction: scratch cwd, no --always-approve, no web, no editor.
  GROK_CWD="$(mktemp -d -t dispatch-author-grokcwd-XXXXXX)"
  timeout "$TIMEOUT" "$GROK_BIN" --prompt-file "$PROMPT_FILE" --cwd "$GROK_CWD" --model "$MODEL" \
    --no-alt-screen --output-format plain --disable-web-search > "$RAW_LOG" 2>/dev/null
  rm -rf "$GROK_CWD"; GROK_CWD=""
elif [[ "$RUNNER" = "cc-shim" ]]; then
  CC_BIN="$(command -v "${BIN:-claude}" 2>/dev/null || true)"
  [ -n "$CC_BIN" ] || die_precondition "claude binary not found: ${BIN:-claude} (cc-shim drives the Claude Code CLI)"
  # Make CC_BIN absolute before running from a scratch cwd (`cd` changes CWD).
  case "$CC_BIN" in
    /*) ;;
    *)  CC_BIN="$(cd "$(dirname "$CC_BIN")" 2>/dev/null && pwd)/$(basename "$CC_BIN")" || true
        case "$CC_BIN" in /*) ;; *) die_precondition "could not resolve --bin to an absolute path: ${BIN}" ;; esac ;;
  esac
  [ -n "${ANTHROPIC_BASE_URL:-}" ] || die_precondition "cc-shim requires ANTHROPIC_BASE_URL in env (an Anthropic-compatible endpoint URL)"
  [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || die_precondition "cc-shim requires ANTHROPIC_AUTH_TOKEN in env (base64-like token required)"
  # BEST-EFFORT surface reduction; no local file edits. This mirrors dispatch-review.sh's
  # blast-radius controls and keeps request context constrained to prompt + auth + model.
  CCSHIM_CWD="$(mktemp -d -t dispatch-author-ccshimcwd-XXXXXX)"
  timeout "$TIMEOUT" env -u ANTHROPIC_API_KEY HOME="$CCSHIM_CWD" \
    bash -c 'cd "$1" && exec "$2" -p --model "$3" --setting-sources project --strict-mcp-config --tools "" < "$4"' \
    _ "$CCSHIM_CWD" "$CC_BIN" "$MODEL" "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
  rm -rf "$CCSHIM_CWD"; CCSHIM_CWD=""
else
  AGY_BIN="${BIN:-agy}"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  # agy -p ignores cwd and drops raw stdout under a non-TTY pipe (#76/#408),
  # so capture through pseudo-TTY and strip CR to preserve exactness.
  RUN_SH="$(mktemp -t dispatch-author-agy-XXXXXX)"
  AGY_CWD="$(mktemp -d -t dispatch-author-agycwd-XXXXXX)"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'cd %q || exit 9\n' "$AGY_CWD"
    printf 'exec %q -p "$(cat %q)" --model %q --dangerously-skip-permissions --print-timeout %q\n' \
      "$AGY_BIN" "$PROMPT_FILE" "$MODEL" "$TIMEOUT"
  } > "$RUN_SH"
  chmod +x "$RUN_SH"
  script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1 || true
  rm -rf "$RUN_SH"
  tr -d '\r' < "$RAW_LOG" > "$RAW_LOG.clean" && mv "$RAW_LOG.clean" "$RAW_LOG"
fi

if ! grep -q '[^[:space:]]' "$RAW_LOG" 2>/dev/null; then
  printf '{ "runner": "%s", "model": "%s", "status": "empty_output", "raw_log": "%s", "error": "no non-whitespace output from runner — fail-closed" }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$RAW_LOG")"
  exit 1
fi

printf '{ "runner": "%s", "model": "%s", "status": "authored", "raw_log": "%s", "error": null }\n' \
  "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$RAW_LOG")"
exit 0
