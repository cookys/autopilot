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
# - agy: scratch cwd (never repo cwd) + pseudo-tty capture (`script -qec`), with
#   fail-closed ignoring script chrome; CRLF is stripped only for content checks.
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
#       [--endpoint <name>]     # cc-shim: resolve named-endpoint creds via resolve-endpoint.sh
#                               #   (AUTOPILOT_ENDPOINT_<NAME>_*); raw env still used when omitted
#   Known behavior: the agy path passes prompt bytes via "$(cat ...)" (via a helper
#   shell script), which drops trailing prompt newlines. This mirrors dispatch-review
#   and is safe for prompt semantics.
#   ⏳ TIMEOUT: this call can run for MINUTES.
#   DISPATCH_QUIET=1 suppresses progress notes on stderr.
#   AUTOPILOT_SETTLE_MS         # override the late-flush settle wait bounds in milliseconds
#                               #   (default: 3000ms; cc-shim: 10000ms)
#
# OUTPUT: one JSON object on stdout:
#   { "runner": "codex|agy|grok|cc-shim", "model": "...", "status": "authored|empty_output|precondition_failed|runner_failed", "raw_log": "<path>", "error": "..." }
#
# EXIT: 0 = authored (non-empty raw output), 1 = empty_output, 2 = precondition_failed, 3 = runner_failed.

set -uo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/output-quiescence.sh"

# Populate endpoint credential env from the canonical ~/.autopilot/endpoints.env (best-effort;
# absent/rejected file = no-op → the cc-shim precondition fires normally). Loaded BEFORE any
# env consumption. Contract stays AUTOPILOT_ENDPOINT_<NAME>_* env vars.
_AUTHOR_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
[ -r "$_AUTHOR_SELF_DIR/load-endpoints-env.sh" ] && . "$_AUTHOR_SELF_DIR/load-endpoints-env.sh" && autopilot_load_endpoints_env || true

RUNNER=""; MODEL=""; PROMPT_FILE=""; EFFORT="xhigh"; TIMEOUT="5m"; BIN=""; ENDPOINT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner)      RUNNER="${2:-}"; shift 2 ;;
    --model)       MODEL="${2:-}"; shift 2 ;;
    --prompt-file)  PROMPT_FILE="${2:-}"; shift 2 ;;
    --effort)      EFFORT="${2:-}"; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; shift 2 ;;
    --bin)         BIN="${2:-}"; shift 2 ;;
    --endpoint)    { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--endpoint requires a non-empty value" >&2; exit 2; }; ENDPOINT="$2"; shift 2 ;;
    -h|--help)     sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | sed -e ':a;N;$!ba;s/\n/\\n/g'; }

die_precondition() {
  printf '{ "runner": "%s", "model": "%s", "status": "precondition_failed", "raw_log": null, "error": "%s" }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$1")"
  exit 2
}

die_runner_failed() {
  local -r runner_exit_code="$1"
  printf '{ "runner": "%s", "model": "%s", "status": "runner_failed", "raw_log": "%s", "error": "runner exited %s" }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$RAW_LOG")" "$(json_escape "$runner_exit_code")"
  exit 3
}

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy|grok|cc-shim)"
case "$RUNNER" in codex|agy|grok|cc-shim) ;; *) die_precondition "--runner must be codex, agy, grok, or cc-shim (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
[[ -n "$PROMPT_FILE" && -r "$PROMPT_FILE" ]] || die_precondition "--prompt-file is required and must be readable"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be low|medium|high|xhigh|max" ;; esac

if [[ -n "${AUTOPILOT_SETTLE_MS:-}" && ! "$AUTOPILOT_SETTLE_MS" =~ ^[0-9]+$ ]]; then
  die_precondition "AUTOPILOT_SETTLE_MS must be an integer millisecond value (got: $AUTOPILOT_SETTLE_MS)"
fi

EP_URL=""; EP_TOKEN_ENV=""
if [[ -n "$ENDPOINT" ]]; then
  case "$RUNNER" in
    cc-shim) ;;
    *) die_precondition "--endpoint applies only to --runner cc-shim (got: $RUNNER)" ;;
  esac
  # Readiness = the resolver's EXIT CODE (0=ready), not a stdout grep (spoofable by
  # attacker-controlled field content); exit code is the authoritative fail-closed signal (gpt-5.5 R5).
  _ep_json="$("$(cd "$(dirname "$0")" && pwd)/resolve-endpoint.sh" "$ENDPOINT" 2>/dev/null)"; _ep_rc=$?
  [ "$_ep_rc" -eq 0 ] || die_precondition "--endpoint '$ENDPOINT' not ready: $(printf '%s' "$_ep_json" | sed -n 's/.*\("missing":\[[^]]*\]\).*/\1/p')"
  EP_URL="$(printf '%s' "$_ep_json" | sed -n 's/.*"base_url":"\([^"]*\)".*/\1/p')"
  EP_TOKEN_ENV="$(printf '%s' "$_ep_json" | sed -n 's/.*"token_env":"\([^"]*\)".*/\1/p')"
  # fail closed if extraction yielded nothing — a ready endpoint with an unparseable base_url
  # must NOT silently fall through to the raw-env base-url/token path below (R6).
  { [[ -n "$EP_URL" ]] && [[ -n "$EP_TOKEN_ENV" ]]; } || die_precondition "--endpoint '$ENDPOINT' resolved an empty base_url/token_env"
  if [[ "$RUNNER" = "cc-shim" ]]; then
    set +x
    export ANTHROPIC_BASE_URL="$EP_URL"
    export ANTHROPIC_AUTH_TOKEN="${!EP_TOKEN_ENV-}"
  fi
  unset _ep_json
fi

RAW_LOG="$(mktemp -t dispatch-author-log-XXXXXX)"
RUNNER_EXIT=0
GROK_CWD=""
CCSHIM_CWD=""
AGY_CWD=""
cleanup() {
  [ -n "$GROK_CWD" ] && rm -rf "$GROK_CWD" || true
  [ -n "$CCSHIM_CWD" ] && rm -rf "$CCSHIM_CWD" || true
  [ -n "$AGY_CWD" ] && rm -rf "$AGY_CWD" || true
}
trap cleanup EXIT

[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-author: ${RUNNER}/${MODEL} (effort=${EFFORT}, timeout=${TIMEOUT})" >&2

if [[ "$RUNNER" = "codex" ]]; then
  CODEX_BIN="${BIN:-codex}"
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN"
  # READ-ONLY by posture only; codex is the same sandboxed runner used for
  # review in dispatch-review.sh and is the strongest default isolation option
  # available here.
  set +e
  timeout "$TIMEOUT" "$CODEX_BIN" exec --model "$MODEL" \
    --sandbox read-only \
    -c "model_reasoning_effort=\"$EFFORT\"" < "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
  RUNNER_EXIT=$?
  set -e
elif [[ "$RUNNER" = "grok" ]]; then
  GROK_BIN="${BIN:-grok}"
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN"
  # Read-only by construction: scratch cwd, no --always-approve, no web, no editor.
  GROK_CWD="$(mktemp -d -t dispatch-author-grokcwd-XXXXXX)"
  set +e
  timeout "$TIMEOUT" "$GROK_BIN" --prompt-file "$PROMPT_FILE" --cwd "$GROK_CWD" --model "$MODEL" \
    --no-alt-screen --output-format plain --disable-web-search > "$RAW_LOG" 2>/dev/null
  RUNNER_EXIT=$?
  set -e
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
  set +e
  timeout "$TIMEOUT" env -u ANTHROPIC_API_KEY HOME="$CCSHIM_CWD" \
    bash -c 'cd "$1" && exec "$2" -p --model "$3" --setting-sources project --strict-mcp-config --tools "" < "$4"' \
    _ "$CCSHIM_CWD" "$CC_BIN" "$MODEL" "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
  RUNNER_EXIT=$?
  set -e
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
  set +e
  script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1
  RUNNER_EXIT=$?
  set -e
  rm -rf "$RUN_SH"
fi

if [[ "$RUNNER_EXIT" -ne 0 ]]; then
  die_runner_failed "$RUNNER_EXIT"
fi

# Fail-closed checks model content, not pseudo-TTY chrome.
# `script -qec` always emits chrome lines; strip CR and those lines before
# checking for non-whitespace output.
# Bounded settle-wait for late-flush
if [[ "$RUNNER" = "cc-shim" ]]; then
  wait_output_quiescent "$RAW_LOG" "${AUTOPILOT_SETTLE_MS:-60000}" 30000 || true
else
  wait_output_quiescent "$RAW_LOG" "${AUTOPILOT_SETTLE_MS:-60000}" || true
fi

if ! tr -d '\r' < "$RAW_LOG" \
  | sed '/^Script started on /d; /^Script done on /d' \
  | grep -q '[^[:space:]]'; then
  printf '{ "runner": "%s", "model": "%s", "status": "empty_output", "raw_log": "%s", "error": "no non-whitespace output from runner — fail-closed" }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$RAW_LOG")"
  exit 1
fi

printf '{ "runner": "%s", "model": "%s", "status": "authored", "raw_log": "%s", "error": null }\n' \
  "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$RAW_LOG")"
exit 0
