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
#   scripts/dispatch-author.sh --strict-roster --repo-root <consuming-repo> --prompt-file <file>
#       # active `/l6` contract: strict roster selection only.
#   scripts/dispatch-author.sh --strict-roster --repo-root <consuming-repo> --prompt-file <file> --bin <path>
#       # test seam only: override the runner binary for seam/fake tests.
#   In strict roster mode, do not pass `--runner`, `--model`, `--effort`, or `--endpoint`.
#   strict mode resolves runner/model/effort/endpoint from `<consuming-repo>/.claude/review-loop-config.md`.
#   Fail closed if strict config/roster tuple is absent, malformed, same-family, unknown-family,
#   or endpoint resolution is not ready.
#   Known behavior: the agy path passes prompt bytes via "$(cat ...)" (via a helper
#   shell script), which drops trailing prompt newlines. This mirrors dispatch-review
#   and is safe for prompt semantics.
#   ⏳ TIMEOUT: this call can run for MINUTES.
#   DISPATCH_QUIET=1 suppresses progress notes on stderr.
#   AUTOPILOT_SETTLE_MS         # override the late-flush settle wait bounds in milliseconds
#                               #   (default: 3000ms; cc-shim: 10000ms)
#
# OUTPUT: one JSON object on stdout:
#   {
#     "runner": "codex|agy|grok|cc-shim",
#     "model": "...",
#     "status": "authored|empty_output|precondition_failed|runner_failed",
#     "raw_log": "<path>",
#     "error": "...",
#     "selection_source": "explicit_cli|strict_roster",
#     "selection_path": "<path>|null",
#     "verification_author": null|{
#       "engine": "...",
#       "runner": "...",
#       "effort": "...",
#       "endpoint": "<name>",
#       "family": "..."
#     }
#   }
#   Non-secret provenance: verification_author.endpoint is the endpoint name only, not URL/token.
#
# EXIT: 0 = authored (non-empty raw output), 1 = empty_output, 2 = precondition_failed, 3 = runner_failed.

set -uo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/output-quiescence.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/dispatch-detach.sh"

# Preserve original argv so the R1 detach supervisor can re-run this EXACT dispatch inline
# inside a kill-surviving setsid session (lib/dispatch-detach.sh). Captured before parsing.
ORIG_ARGS=("$@")

# Populate endpoint credential env from the canonical ~/.autopilot/endpoints.env (best-effort;
# absent/rejected file = no-op → the cc-shim precondition fires normally). Loaded BEFORE any
# env consumption. Contract stays AUTOPILOT_ENDPOINT_<NAME>_* env vars.
_AUTHOR_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
[ -r "$_AUTHOR_SELF_DIR/load-endpoints-env.sh" ] && . "$_AUTHOR_SELF_DIR/load-endpoints-env.sh" && autopilot_load_endpoints_env || true
# Startup retention prune of OUR OWN aged ${TMPDIR} residue (raw logs, prompt temps,
# scratch cwds). Best-effort; AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 disables.
# shellcheck source=/dev/null
[ -r "$_AUTHOR_SELF_DIR/lib/prune-tmp-residue.sh" ] && . "$_AUTHOR_SELF_DIR/lib/prune-tmp-residue.sh" \
  && prune_tmp_residue "${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}" 'dispatch-author-*' || true

RUNNER=""; MODEL=""; PROMPT_FILE=""; EFFORT="xhigh"; TIMEOUT="5m"; BIN=""; ENDPOINT=""
REPO_ROOT=""; STRICT_ROSTER=0
RUNNER_SUPPLIED=0; MODEL_SUPPLIED=0; EFFORT_SUPPLIED=0; ENDPOINT_SUPPLIED=0
# R1 detach coords (all OPTIONAL; absent ⇒ byte-identical inline behavior). See lib/dispatch-detach.sh.
LEDGER=""; RUN_ID=""; STAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner)      RUNNER="${2:-}"; RUNNER_SUPPLIED=1; shift 2 ;;
    --model)       MODEL="${2:-}"; MODEL_SUPPLIED=1; shift 2 ;;
    --prompt-file)  PROMPT_FILE="${2:-}"; shift 2 ;;
    --effort)      EFFORT="${2:-}"; EFFORT_SUPPLIED=1; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; shift 2 ;;
    --bin)         BIN="${2:-}"; shift 2 ;;
    --ledger)      LEDGER="${2:-}"; shift 2 ;;
    --run-id)      RUN_ID="${2:-}"; shift 2 ;;
    --stage)       STAGE="${2:-}"; shift 2 ;;
    --endpoint)    { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--endpoint requires a non-empty value" >&2; exit 2; }; ENDPOINT="$2"; ENDPOINT_SUPPLIED=1; shift 2 ;;
    --strict-roster) STRICT_ROSTER=1; shift ;;
    --repo-root)    { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--repo-root requires a non-empty value" >&2; exit 2; }; REPO_ROOT="$2"; shift 2 ;;
    -h|--help)     sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

SELECTION_SOURCE="explicit_cli"
if [[ "$STRICT_ROSTER" -eq 1 ]]; then
  SELECTION_SOURCE="strict_roster"
fi
SELECTION_PATH=""
SELECTION_PATH_RESOLVED=0
VERIFICATION_AUTHOR_ENGINE=""
VERIFICATION_AUTHOR_RUNNER=""
VERIFICATION_AUTHOR_EFFORT=""
VERIFICATION_AUTHOR_ENDPOINT=""
VERIFICATION_AUTHOR_FAMILY=""

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | sed -e ':a;N;$!ba;s/\n/\\n/g'; }

read_review_loop_field() {
  local key="$1"
  node -e '
const fs = require("fs");

const key = process.argv[1];
let raw;
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(2);
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(2);
}

if (!Object.prototype.hasOwnProperty.call(data, key)) {
  process.exit(3);
}

const value = data[key];
if (typeof value === "boolean") {
  process.stdout.write(value ? "true" : "false");
  process.exit(0);
}

if (typeof value === "string" || typeof value === "number") {
  process.stdout.write(String(value));
  process.exit(0);
}

process.exit(4);
' "$key"
}

emit_verification_author() {
  if [[ "$SELECTION_PATH_RESOLVED" -ne 1 ]]; then
    printf 'null'
    return
  fi

  printf '{ "engine": "%s", "runner": "%s", "effort": "%s", "endpoint": "%s", "family": "%s" }' \
    "$(json_escape "$VERIFICATION_AUTHOR_ENGINE")" \
    "$(json_escape "$VERIFICATION_AUTHOR_RUNNER")" \
    "$(json_escape "$VERIFICATION_AUTHOR_EFFORT")" \
    "$(json_escape "$VERIFICATION_AUTHOR_ENDPOINT")" \
    "$(json_escape "$VERIFICATION_AUTHOR_FAMILY")"
}

emit_result() {
  local status="$1"
  local raw_log="$2"
  local error_message="$3"
  local exit_code="$4"

  local raw_log_json="null"
  if [[ "$raw_log" != "null" ]]; then
    raw_log_json="\"$(json_escape "$raw_log")\""
  fi

  local error_json="null"
  if [[ "$error_message" != "null" ]]; then
    error_json="\"$(json_escape "$error_message")\""
  fi

  local selection_path_json="null"
  if [[ "$SELECTION_PATH_RESOLVED" -eq 1 ]]; then
    selection_path_json="\"$(json_escape "$SELECTION_PATH")\""
  fi

  printf '{ "runner": "%s", "model": "%s", "status": "%s", "raw_log": %s, "error": %s, "selection_source": "%s", "selection_path": %s, "verification_author": %s }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$status")" \
    "$raw_log_json" "$error_json" "$(json_escape "$SELECTION_SOURCE")" "$selection_path_json" "$(emit_verification_author)"
  exit "$exit_code"
}

die_precondition() {
  emit_result "precondition_failed" "null" "$1" "2"
}

die_runner_failed() {
  local -r runner_exit_code="$1"
  emit_result "runner_failed" "$RAW_LOG" "runner exited $runner_exit_code" 3
}

ACTIVE_L6_MODE=0
ACTIVE_L6_MARKER_LEVEL="$(node -e 'const m = require(process.argv[1]).readMarker(); if (m && m.level === "l6") { process.stdout.write("l6"); }' "$_AUTHOR_SELF_DIR/session-mode.js" 2>/dev/null || true)"
[[ "$ACTIVE_L6_MARKER_LEVEL" == "l6" ]] && ACTIVE_L6_MODE=1 || true
if [[ "$ACTIVE_L6_MODE" -eq 1 && "$STRICT_ROSTER" -ne 1 ]]; then
  die_precondition "active session-mode=l6 requires --strict-roster"
fi

if [[ "$STRICT_ROSTER" -eq 1 ]]; then
  [[ "$RUNNER_SUPPLIED" -eq 0 ]] || die_precondition "manual --runner is not allowed with --strict-roster"
  [[ "$MODEL_SUPPLIED" -eq 0 ]] || die_precondition "manual --model is not allowed with --strict-roster"
  [[ "$EFFORT_SUPPLIED" -eq 0 ]] || die_precondition "manual --effort is not allowed with --strict-roster"
  [[ "$ENDPOINT_SUPPLIED" -eq 0 ]] || die_precondition "manual --endpoint is not allowed with --strict-roster"
  [[ -n "$REPO_ROOT" ]] || die_precondition "--repo-root is required with --strict-roster"
  [[ -d "$REPO_ROOT" ]] || die_precondition "--repo-root must point to an existing directory"
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
  REVIEW_LOOP_CONFIG="$REPO_ROOT/.claude/review-loop-config.md"
  [[ -r "$REVIEW_LOOP_CONFIG" ]] || die_precondition "config missing at --repo-root/.claude/review-loop-config.md"
  REVIEW_LOOP_JSON="$(
    cd "$REPO_ROOT" && REVIEW_LOOP_CONFIG_OVERRIDE="$REVIEW_LOOP_CONFIG" "$_AUTHOR_SELF_DIR/resolve-review-loop.sh"
  )"
  REVIEW_LOOP_JSON_RC=$?
  if [[ "$REVIEW_LOOP_JSON_RC" -ne 0 ]]; then
    die_precondition "resolve-review-loop failed"
  fi

  verification_author_present="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_present)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid verification_author_present in review loop config"
  verification_author_engine="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_engine)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid verification_author_engine in review loop config"
  verification_author_runner="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_runner)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid verification_author_runner in review loop config"
  verification_author_effort="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_effort)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid verification_author_effort in review loop config"
  verification_author_endpoint="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_endpoint)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid verification_author_endpoint in review loop config"
  verification_author_family="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_family)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid verification_author_family in review loop config"
  implementer_family="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field implementer_family)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid implementer_family in review loop config"
  config_path="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field config_path)"; status=$?
  [[ "$status" -eq 0 ]] || die_precondition "missing/invalid config_path in review loop config"

  [[ "$verification_author_present" == true ]] || die_precondition "strict roster requires verification_author_present=true"
  [[ -n "$verification_author_engine" ]] || die_precondition "strict roster requires verification_author_engine"
  [[ -n "$verification_author_runner" ]] || die_precondition "strict roster requires verification_author_runner"
  [[ -n "$verification_author_effort" ]] || die_precondition "strict roster requires verification_author_effort"
  [[ -n "$verification_author_family" ]] || die_precondition "strict roster requires verification_author_family"
  [[ -n "$implementer_family" ]] || die_precondition "strict roster requires implementer_family"
  [[ "$verification_author_family" != unknown ]] || die_precondition "verification_author_family must not be unknown"
  [[ "$implementer_family" != unknown ]] || die_precondition "implementer_family must not be unknown"
  [[ "$verification_author_family" != "$implementer_family" ]] || die_precondition "strict roster requires distinct verification_author_family and implementer_family"
  [[ "$config_path" == "$REVIEW_LOOP_CONFIG" ]] || die_precondition "strict roster requires config_path to equal --repo-root/.claude/review-loop-config.md"
  RUNNER="$verification_author_runner"; status=$?; [[ "$status" -eq 0 ]] || die_precondition "internal failure assigning strict roster runner"
  MODEL="$verification_author_engine"; status=$?; [[ "$status" -eq 0 ]] || die_precondition "internal failure assigning strict roster model"
  EFFORT="$verification_author_effort"; status=$?; [[ "$status" -eq 0 ]] || die_precondition "internal failure assigning strict roster effort"
  ENDPOINT="$verification_author_endpoint"; status=$?; [[ "$status" -eq 0 ]] || die_precondition "internal failure assigning strict roster endpoint"
  SELECTION_PATH="$REVIEW_LOOP_CONFIG"
  SELECTION_PATH_RESOLVED=1
  VERIFICATION_AUTHOR_ENGINE="$verification_author_engine"
  VERIFICATION_AUTHOR_RUNNER="$verification_author_runner"
  VERIFICATION_AUTHOR_EFFORT="$verification_author_effort"
  VERIFICATION_AUTHOR_ENDPOINT="$verification_author_endpoint"
  VERIFICATION_AUTHOR_FAMILY="$verification_author_family"
fi

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy|grok|cc-shim)"
case "$RUNNER" in codex|agy|grok|cc-shim) ;; *) die_precondition "--runner must be codex, agy, grok, or cc-shim (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
[[ -n "$PROMPT_FILE" && -r "$PROMPT_FILE" ]] || die_precondition "--prompt-file is required and must be readable"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be low|medium|high|xhigh|max" ;; esac

if [[ -n "${AUTOPILOT_SETTLE_MS:-}" && ! "$AUTOPILOT_SETTLE_MS" =~ ^[0-9]+$ ]]; then
  die_precondition "AUTOPILOT_SETTLE_MS must be an integer millisecond value (got: $AUTOPILOT_SETTLE_MS)"
fi

# R1 detach: when ledger coords are supplied and detach is on (default), re-run this dispatch
# INLINE inside a kill-surviving setsid session and relay its durable result. Byte-identical
# inline behavior when no coords / DISPATCH_DETACH=0. NEVER returns when it engages.
dispatch_detach_supervise "$0" "$LEDGER" "$RUN_ID" "$STAGE" "$_AUTHOR_SELF_DIR" -- "${ORIG_ARGS[@]}"

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

# grep -c (not -q): -q exits at first match and SIGPIPEs tr/sed under pipefail — a
# multi-KB capture then misclassifies as empty ~97% of the time (measured 2026-07-05).
if ! tr -d '\r' < "$RAW_LOG" \
  | sed '/^Script started on /d; /^Script done on /d' \
  | grep -c '[^[:space:]]' > /dev/null; then
  emit_result "empty_output" "$RAW_LOG" "no non-whitespace output from runner — fail-closed" 1
fi

emit_result "authored" "$RAW_LOG" "null" 0
