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
# - --bin: for `anthropic-compatible`, overrides the JS path only (test seam; must point
#   at `dispatch-anthropic-review.js`-compatible logic).
# - anthropic-compatible: direct HTTP POST of RAW PROMPT BYTES to an
#   Anthropic-compatible /v1/messages endpoint via dispatch-anthropic-review.js --raw.
#   Auth from env only (`MINIMAX_API_KEY` or `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`).
#   This runner intentionally ignores `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`,
#   does not export `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`, and resolves base URL
#   from `--endpoint` or `ANTHROPIC_COMPATIBLE_BASE_URL` / `AUTOPILOT_MINIMAX_BASE_URL`
#   (default `https://api.minimax.io/anthropic`). (`--effort` is accepted but unused.)
#   Response cap: `--max-tokens ${AUTOPILOT_AUTHOR_MAX_TOKENS:-30000}` (authoring payloads
#   exceed the JS's 4096 review default; a truncated response fail-closes in the JS).
#
# USAGE:
#   scripts/dispatch-author.sh --runner codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn --model <name> --prompt-file <file>
#       # explicit mode (non-strict roster path)
#   scripts/dispatch-author.sh --strict-roster --repo-root <consuming-repo> --prompt-file <file>
#       # active `/l6` contract: strict roster selection only.
#   scripts/dispatch-author.sh --strict-roster --repo-root <consuming-repo> --prompt-file <file> --bin <path>
#       # test seam only: override the runner binary for seam/fake tests.
#   [--context-window off|warn|block] on any mode: pre-dispatch context-window gate (default:
#       block; also AUTOPILOT_CONTEXT_WINDOW_GATE). Authoring payloads are the largest
#       single-file inputs on any rail, so this is the rail most likely to overflow a small
#       window. Over budget ⇒ fail closed with no runner spawn.
#       See references/hetero-dispatch.md § Context-window gate.
#   In strict roster mode, do not pass `--runner`, `--model`, `--effort`, or `--endpoint`.
#   strict mode resolves runner/model/effort/endpoint from `<consuming-repo>/.claude/review-loop-config.md`.
#   scripts/dispatch-author.sh --strict-contract --contract-file <json> --repo-root <consuming-repo> --prompt-file <file>
#       # GO-gated verification-author contract mode.
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
#     "runner": "codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn",
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
#   On strict-contract containment violations (repo-state changed), status becomes
#   containment_breach with exit code 4.
# EXIT: 0 = authored (non-empty raw output), 1 = empty_output, 2 = precondition_failed, 3 = runner_failed, 4 = containment_breach.

set -uo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/output-quiescence.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/dispatch-detach.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/dispatch-author-codex-transport.sh"

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
# Pre-dispatch context-window gate (lib/context-window.sh). Best-effort source: a missing
# helper degrades to "no gate", never to a dispatch outage.
# shellcheck source=/dev/null
[ -r "$_AUTHOR_SELF_DIR/lib/context-window.sh" ] && . "$_AUTHOR_SELF_DIR/lib/context-window.sh" || true

CONTEXT_WINDOW_GATE=""   # off|warn|block; empty ⇒ AUTOPILOT_CONTEXT_WINDOW_GATE, else block
RUNNER=""; MODEL=""; PROMPT_FILE=""; EFFORT="xhigh"; TIMEOUT="5m"; BIN=""; ENDPOINT=""
REPO_ROOT=""; STRICT_ROSTER=0; STRICT_CONTRACT=0; CONTRACT_FILE=""; CONTRACT_FILE_SUPPLIED=0
TIMEOUT_SUPPLIED=0
RUNNER_SUPPLIED=0; MODEL_SUPPLIED=0; EFFORT_SUPPLIED=0; ENDPOINT_SUPPLIED=0
STRICT_CONTRACT_RESULT_FIELDS=0
STRICT_UNIT_ID=""; STRICT_CONTRACT_SHA=""; STRICT_SPEC_SHA=""; STRICT_GO=""
# R1 detach coords (all OPTIONAL; absent ⇒ byte-identical inline behavior). See lib/dispatch-detach.sh.
LEDGER=""; RUN_ID=""; STAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner)      RUNNER="${2:-}"; RUNNER_SUPPLIED=1; shift 2 ;;
    --model)       MODEL="${2:-}"; MODEL_SUPPLIED=1; shift 2 ;;
    --prompt-file)  PROMPT_FILE="${2:-}"; shift 2 ;;
    --effort)      EFFORT="${2:-}"; EFFORT_SUPPLIED=1; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; TIMEOUT_SUPPLIED=1; shift 2 ;;
    --bin)         BIN="${2:-}"; shift 2 ;;
    --context-window) CONTEXT_WINDOW_GATE="${2:-}"; shift 2 ;;
    --ledger)      LEDGER="${2:-}"; shift 2 ;;
    --run-id)      RUN_ID="${2:-}"; shift 2 ;;
    --stage)       STAGE="${2:-}"; shift 2 ;;
    --endpoint)    { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--endpoint requires a non-empty value" >&2; exit 2; }; ENDPOINT="$2"; ENDPOINT_SUPPLIED=1; shift 2 ;;
    --strict-roster) STRICT_ROSTER=1; shift ;;
    --strict-contract) STRICT_CONTRACT=1; shift ;;
    --contract-file) CONTRACT_FILE="${2:-}"; CONTRACT_FILE_SUPPLIED=1; shift 2 ;;
    --repo-root)    { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--repo-root requires a non-empty value" >&2; exit 2; }; REPO_ROOT="$2"; shift 2 ;;
    -h|--help)     sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# shellcheck source=lib/json-emit.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/json-emit.sh"

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

extract_json_value() {
  local key="" json=""
  if [ "$#" -eq 1 ]; then
    key="$1"
    json="$(cat)"
  else
    json="${1-}"
    key="${2-}"
  fi
  [ -n "$json" ] || return 1
  printf '%s' "$json" | node -e '
const fs = require("fs");
const key = process.argv[1];
const raw = fs.readFileSync(0, "utf8").trim();
let data;
try { data = JSON.parse(raw); } catch (e) { process.exit(1); }
const parts = key.split(".");
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(2);
  }
  cur = cur[part];
}
if (cur === null || cur === undefined) process.exit(3);
if (typeof cur === "object") {
  process.stdout.write(JSON.stringify(cur));
} else {
  process.stdout.write(String(cur));
}
' "$key"
}

extract_last_json() {
  node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").split(/\r?\n/);
for (let i = lines.length - 1; i >= 0; i--) {
  const line = String(lines[i] || "").trim();
  if (!line) continue;
  try {
    JSON.parse(line);
    process.stdout.write(line);
    process.exit(0);
  } catch (e) {}
}
process.exit(1);
'
}

extract_file_json_value() {
  local path="$1" key="$2"
  node -e '
const fs = require("fs");
const path = process.argv[1];
const key = process.argv[2];
let data;
try { data = JSON.parse(fs.readFileSync(path, "utf8")); } catch (e) { process.exit(1); }
const parts = key.split(".");
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(2);
  }
  cur = cur[part];
}
if (cur === null || cur === undefined) process.exit(3);
if (typeof cur === "object") {
  process.stdout.write(JSON.stringify(cur));
} else {
  process.stdout.write(String(cur));
}
' "$path" "$key"
}

normalize_timeout_seconds() {
  node -e '
const v = String(process.argv[1] || "").trim().toLowerCase();
if (!v) process.exit(1);
if (/^\d+$/.test(v)) {
  process.stdout.write(String(parseInt(v, 10)));
  process.exit(0);
}
if (/^\d+\s*s$/.test(v)) {
  process.stdout.write(String(parseInt(v.slice(0, -1), 10)));
  process.exit(0);
}
if (/^\d+\s*m$/.test(v)) {
  const m = parseInt(v, 10);
  process.stdout.write(String(m * 60));
  process.exit(0);
}
process.exit(2);
' "$1"
}

strict_result_fields() {
  local containment="$1"
  local fields=""

  [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ] || return 0
  [ -n "${STRICT_UNIT_ID:-}" ] || return 0
  [ -n "${STRICT_CONTRACT_SHA:-}" ] || return 0
  [ -n "${STRICT_SPEC_SHA:-}" ] || return 0
  [ -n "${STRICT_GO:-}" ] || return 0

  fields=', "unit_id": "'$(json_escape "$STRICT_UNIT_ID")'", "contract_sha256": "'$(json_escape "$STRICT_CONTRACT_SHA")'", "spec_sha256": "'$(json_escape "$STRICT_SPEC_SHA")'", "go": "'$(json_escape "$STRICT_GO")'"'
  if [ -n "$containment" ]; then
    fields="$fields, \"containment\": \"$containment\""
  fi
  printf '%s' "$fields"
}

emit_result() {
  local status="$1"
  local raw_log="$2"
  local error_message="$3"
  local exit_code="$4"
  local extra_fields="${5-}"

  # Identity containment rail: compare + restore consuming-repo identity when a
  # pre-run snapshot was taken. Drift FLAGS only (additive JSON field + warning);
  # does NOT change the exit code (containment_breach is a separate rail).
  if [ -n "$REPO_ROOT" ] && [ "${IDENTITY_SNAPSHOT_TAKEN:-0}" -eq 1 ]; then
    local post_name post_email
    # --local: shared .git/config is local scope; empty pre restores inheritance via --unset.
    post_name="$(git -C "$REPO_ROOT" config --local user.name 2>/dev/null || true)"
    post_email="$(git -C "$REPO_ROOT" config --local user.email 2>/dev/null || true)"
    if [ "$post_name" != "$IDENTITY_PRE_NAME" ] || [ "$post_email" != "$IDENTITY_PRE_EMAIL" ]; then
      IDENTITY_DRIFT=1
      # Explicit if/else — never fall through to --unset when a non-empty set fails.
      if [ -n "$IDENTITY_PRE_NAME" ]; then
        git -C "$REPO_ROOT" config --local user.name "$IDENTITY_PRE_NAME" \
          || echo "WARNING: identity restore failed — could not set local user.name" >&2
      else
        git -C "$REPO_ROOT" config --local --unset user.name 2>/dev/null || true
      fi
      if [ -n "$IDENTITY_PRE_EMAIL" ]; then
        git -C "$REPO_ROOT" config --local user.email "$IDENTITY_PRE_EMAIL" \
          || echo "WARNING: identity restore failed — could not set local user.email" >&2
      else
        git -C "$REPO_ROOT" config --local --unset user.email 2>/dev/null || true
      fi
      echo "WARNING: identity drift detected — worker changed the consuming repo's git identity; restored the original values" >&2
    fi
  fi
  if [ "${IDENTITY_DRIFT:-0}" -eq 1 ]; then
    extra_fields="${extra_fields}, \"identity_drift\": true"
  fi

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

  local verification_author_json
  verification_author_json="$(emit_verification_author)"
  printf '{ "runner": "%s", "model": "%s", "status": "%s", "raw_log": %s, "error": %s, "selection_source": "%s", "selection_path": %s, "verification_author": %s%s }\n' \
    "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$status")" \
    "$raw_log_json" "$error_json" "$(json_escape "$SELECTION_SOURCE")" "$selection_path_json" \
    "$verification_author_json" "$extra_fields"
  exit "$exit_code"
}

die_precondition() {
  emit_result "precondition_failed" "null" "$1" "2"
}

die_runner_failed() {
  local -r runner_exit_code="$1"
  emit_result "runner_failed" "$RAW_LOG" "runner exited $runner_exit_code" 3
}

check_session_mode_gate() {
  local marker_dir="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  local marker level consumed_repo normalized_repo
  if [[ -n "$REPO_ROOT" ]]; then
    consumed_repo="$(cd "$REPO_ROOT" 2>/dev/null && pwd -P || true)"
  else
    consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  fi
  [ "$marker_dir" != "/.autopilot/session-mode" ] || return 0
  [ -d "$marker_dir" ] || return 0
  [ -n "$consumed_repo" ] || return 0
  normalized_repo="$(cd "$consumed_repo" && pwd -P 2>/dev/null || echo "$consumed_repo")"
  for marker in "$marker_dir"/*.json; do
    [ -f "$marker" ] || continue
    if level="$(node -e 'const fs = require("fs"); const path = require("path"); const file = process.argv[1]; const root = path.resolve(process.argv[2] || ""); const now = Date.now(); try { const data = JSON.parse(fs.readFileSync(file, "utf8")); if (!data || typeof data !== "object") process.exit(1); if (data.level !== "l5" && data.level !== "l6") process.exit(1); if (!data.expires_at) process.exit(1); const exp = Date.parse(data.expires_at); if (!Number.isFinite(exp) || exp <= now) process.exit(1); if (path.resolve(String(data.repo_root || "")) !== root) process.exit(1); process.stdout.write(String(data.level || "")); process.exit(0); } catch (e) { process.exit(1); }' "$marker" "$normalized_repo")"; then
      die_precondition "active session-mode=$level blocks non-strict dispatch (repo=$consumed_repo)"
    fi
  done
}

load_verification_author_from_review_loop() {
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

  VERIFICATION_AUTHOR_ENGINE="$verification_author_engine"
  VERIFICATION_AUTHOR_RUNNER="$verification_author_runner"
  VERIFICATION_AUTHOR_EFFORT="$verification_author_effort"
  VERIFICATION_AUTHOR_ENDPOINT="$verification_author_endpoint"
  VERIFICATION_AUTHOR_FAMILY="$verification_author_family"
}

run_strict_contract_preflight() {
  local contract_check_out contract_check_json contract_check_rc
  local verdict contract_model contract_runner contract_role checker_reasons
  local contract_wall_seconds normalized_timeout

  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  [ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] || die_precondition "--strict-contract requires --contract-file"
  [ -r "$CONTRACT_FILE" ] || die_precondition "contract file not readable: $CONTRACT_FILE"
  [ -n "$REPO_ROOT" ] || die_precondition "--repo-root is required with --strict-contract"
  [ -d "$REPO_ROOT" ] || die_precondition "--repo-root must point to an existing directory"
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"

  contract_check_out="$(node "$_AUTHOR_SELF_DIR/dispatch-contract.js" check --contract "$CONTRACT_FILE" --repo "$REPO_ROOT" --json 2>&1)"
  contract_check_rc=$?

  contract_check_json="$(printf '%s' "$contract_check_out" | extract_last_json)"
  if [ "$contract_check_rc" -ne 0 ] || [ -z "$contract_check_json" ]; then
    checker_reasons="$(extract_json_value "$contract_check_json" reasons 2>/dev/null || true)"
    [ -n "$checker_reasons" ] || checker_reasons="$(printf '%s' "$contract_check_out" | tr '\n' ' ')"
    [ -n "$checker_reasons" ] || checker_reasons="contract check failed"
    die_precondition "contract checker failed: $checker_reasons"
  fi

  verdict="$(extract_json_value "$contract_check_json" verdict 2>/dev/null || true)"
  [ "$verdict" = "GO" ] || die_precondition "contract checker failed: verdict=$verdict"
  contract_role="$(extract_file_json_value "$CONTRACT_FILE" "go.required_engine_role" 2>/dev/null || true)"
  [[ -n "$contract_role" ]] || die_precondition "contract has empty required_engine_role"
  [[ "$contract_role" == "verification-author" ]] || die_precondition "contract required_engine_role is '$contract_role' (expected verification-author)"

  STRICT_CONTRACT_RESULT_FIELDS=1
  STRICT_UNIT_ID="$(extract_json_value "$contract_check_json" unit_id 2>/dev/null || true)"
  STRICT_CONTRACT_SHA="$(extract_json_value "$contract_check_json" contract_sha256 2>/dev/null || true)"
  STRICT_SPEC_SHA="$(extract_json_value "$contract_check_json" spec_sha256 2>/dev/null || true)"
  contract_model="$(extract_json_value "$contract_check_json" resolved_engine.model 2>/dev/null || true)"
  contract_runner="$(extract_json_value "$contract_check_json" resolved_engine.runner 2>/dev/null || true)"
  STRICT_GO="$verdict"

  [ -n "$STRICT_UNIT_ID" ] || die_precondition "contract checker returned empty unit_id"
  [ -n "$STRICT_CONTRACT_SHA" ] || die_precondition "contract checker returned empty contract_sha256"
  [ -n "$STRICT_SPEC_SHA" ] || die_precondition "contract checker returned empty spec_sha256"
  [ -n "$contract_model" ] || die_precondition "contract checker returned empty resolved_engine.model"
  [ -n "$contract_runner" ] || die_precondition "contract checker returned empty resolved_engine.runner"

  if [ "$RUNNER_SUPPLIED" -eq 1 ]; then
    [[ "$RUNNER" == "$contract_runner" ]] || die_precondition "caller --runner ($RUNNER) disagrees with checker resolved_engine.runner ($contract_runner)"
  else
    RUNNER="$contract_runner"
  fi
  if [ "$MODEL_SUPPLIED" -eq 1 ]; then
    [[ "$MODEL" == "$contract_model" ]] || die_precondition "caller --model ($MODEL) disagrees with checker resolved_engine.model ($contract_model)"
  else
    MODEL="$contract_model"
  fi

  contract_wall_seconds="$(extract_file_json_value "$CONTRACT_FILE" "budget.wall_seconds" 2>/dev/null || true)"
  [ -n "$contract_wall_seconds" ] || die_precondition "contract missing budget.wall_seconds"
  if [ "$TIMEOUT_SUPPLIED" -eq 0 ]; then
    TIMEOUT="${contract_wall_seconds}s"
  else
    normalized_timeout="$(normalize_timeout_seconds "$TIMEOUT" 2>/dev/null || true)"
    [ -n "$normalized_timeout" ] || die_precondition "invalid --timeout value: $TIMEOUT"
    [[ "$normalized_timeout" -eq "$contract_wall_seconds" ]] || die_precondition "caller --timeout ($TIMEOUT) disagrees with contract budget.wall_seconds (${contract_wall_seconds}s)"
  fi

  load_verification_author_contract_config
  EFFORT="$VERIFICATION_AUTHOR_EFFORT"
  if [ "$ENDPOINT_SUPPLIED" -eq 1 ]; then
    [[ "$ENDPOINT" == "$VERIFICATION_AUTHOR_ENDPOINT" ]] || die_precondition "caller --endpoint ($ENDPOINT) disagrees with verification_author_endpoint ($VERIFICATION_AUTHOR_ENDPOINT)"
  fi
  if [ "$ENDPOINT_SUPPLIED" -eq 0 ]; then
    ENDPOINT="$VERIFICATION_AUTHOR_ENDPOINT"
  fi
}

load_verification_author_contract_config() {
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
  VERIFICATION_AUTHOR_ENGINE="$verification_author_engine"
  VERIFICATION_AUTHOR_RUNNER="$verification_author_runner"
  VERIFICATION_AUTHOR_EFFORT="$verification_author_effort"
  VERIFICATION_AUTHOR_ENDPOINT="$(printf '%s' "$REVIEW_LOOP_JSON" | read_review_loop_field verification_author_endpoint || true)"
  VERIFICATION_AUTHOR_FAMILY="$(extract_json_value "$REVIEW_LOOP_JSON" verification_author_family 2>/dev/null || true)"

  [[ "$verification_author_present" == true ]] || die_precondition "strict contract requires verification_author_present=true"
  [[ -n "$verification_author_engine" ]] || die_precondition "strict contract requires verification_author_engine"
  [[ -n "$verification_author_runner" ]] || die_precondition "strict contract requires verification_author_runner"
  [[ -n "$verification_author_effort" ]] || die_precondition "strict contract requires verification_author_effort"
}

[[ "$STRICT_CONTRACT" -eq 1 && "$CONTRACT_FILE_SUPPLIED" -eq 0 ]] && die_precondition "--strict-contract requires --contract-file"
[[ "$CONTRACT_FILE_SUPPLIED" -eq 1 && "$STRICT_CONTRACT" -eq 0 ]] && die_precondition "--contract-file requires --strict-contract"

if [[ "$STRICT_CONTRACT" -eq 1 ]]; then
  run_strict_contract_preflight
  SELECTION_SOURCE="strict_contract"
else
  check_session_mode_gate
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

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn)"
case "$RUNNER" in codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn) ;; *) die_precondition "--runner must be codex, agy, grok, cc-shim, anthropic-compatible, or qoderclicn (got: $RUNNER)" ;; esac
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

EP_URL=""; EP_TOKEN_ENV=""; ANTHROPIC_TOKEN_ENV=""
if [[ -n "$ENDPOINT" ]]; then
  case "$RUNNER" in
    cc-shim|anthropic-compatible) ;;
    *) die_precondition "--endpoint applies only to --runner anthropic-compatible or cc-shim (got: $RUNNER)" ;;
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
  elif [[ "$RUNNER" = "anthropic-compatible" ]]; then
    ANTHROPIC_BASE_URL="$EP_URL"
    ANTHROPIC_TOKEN_ENV="$EP_TOKEN_ENV"
  fi
  unset _ep_json
fi

timeout_to_ms() {
  local t="$1"
  if [[ "$t" =~ ^([0-9]+)m$ ]]; then printf '%s' "$(( ${BASH_REMATCH[1]} * 60000 ))"; return; fi
  if [[ "$t" =~ ^([0-9]+)s$ ]]; then printf '%s' "$(( ${BASH_REMATCH[1]} * 1000 ))"; return; fi
  if [[ "$t" =~ ^[0-9]+$ ]]; then printf '%s' "$t"; return; fi
  return 1
}

RAW_LOG="$(mktemp -t dispatch-author-log-XXXXXX)"

# Context-window gate — runs BEFORE any runner spawns, so an over-budget authoring
# payload costs nothing. Authoring prompts are the largest single-file payloads on
# any rail (see the header note about the 4096 review default truncating them), which
# makes this the rail most likely to overflow a small window.
if declare -F context_window_gate > /dev/null 2>&1; then
  _CB_MODE="$(context_window_mode "${CONTEXT_WINDOW_GATE:-}")"
  if ! context_window_gate "$_CB_MODE" "$_AUTHOR_SELF_DIR" "$MODEL" "${PROMPT_FILE:-}"; then
    printf '[dispatch-author: context-window blocked] %s\n' "${CONTEXT_WINDOW_JSON:-}" >> "$RAW_LOG"
    die_precondition "context budget exceeded: ${CONTEXT_WINDOW_REASON:-over budget}"
  fi
  [ -n "${CONTEXT_WINDOW_JSON:-}" ] \
    && printf '[dispatch-author: context-window %s] %s\n' \
      "${CONTEXT_WINDOW_VERDICT:-}" "${CONTEXT_WINDOW_JSON:-}" >> "$RAW_LOG"
fi

RUNNER_EXIT=0
CODEX_TRANSPORT=0
CODEX_DEADLINE_HIT=0
CODEX_INCOMPLETE_TREE=0
CODEX_SESSION_ID=""
CODEX_RUN_DIR=""
CODEX_STDOUT=""
CODEX_STDERR=""
CODEX_SIDECAR=""
CONTAINMENT_PRE_STATUS=""
CONTAINMENT_PRE_HEAD=""
CONTAINMENT_POST_STATUS=""
CONTAINMENT_POST_HEAD=""
IDENTITY_DRIFT=0
IDENTITY_PRE_NAME=""
IDENTITY_PRE_EMAIL=""
IDENTITY_SNAPSHOT_TAKEN=0
GROK_CWD=""
CCSHIM_CWD=""
AGY_CWD=""
QODER_CWD=""
cleanup() {
  [ -n "$GROK_CWD" ] && rm -rf "$GROK_CWD" || true
  [ -n "$CCSHIM_CWD" ] && rm -rf "$CCSHIM_CWD" || true
  [ -n "$AGY_CWD" ] && rm -rf "$AGY_CWD" || true
  [ -n "$QODER_CWD" ] && rm -rf "$QODER_CWD" || true
  # Codex private run artifacts are retained for raw_log consumers (not deleted).
}
trap cleanup EXIT

if [[ "$STRICT_CONTRACT" -eq 1 ]]; then
  CONTAINMENT_PRE_STATUS="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)"
  CONTAINMENT_PRE_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
  [ -n "$CONTAINMENT_PRE_HEAD" ] || die_precondition "not a git repository at --repo-root"
fi

# Snapshot consuming-repo git identity BEFORE the runner (alongside CONTAINMENT_PRE_*).
# A worker that reaches the shared .git/config can rewrite user.name/email; we restore
# on emit. Only when --repo-root is known (strict-roster / strict-contract paths).
if [ -n "$REPO_ROOT" ]; then
  # --local only: effective-scope reads would materialize a global identity as local on restore.
  IDENTITY_PRE_NAME="$(git -C "$REPO_ROOT" config --local user.name 2>/dev/null || true)"
  IDENTITY_PRE_EMAIL="$(git -C "$REPO_ROOT" config --local user.email 2>/dev/null || true)"
  IDENTITY_SNAPSHOT_TAKEN=1
fi

[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-author: ${RUNNER}/${MODEL} (effort=${EFFORT}, timeout=${TIMEOUT})" >&2

if [[ "$RUNNER" = "codex" ]]; then
  CODEX_BIN="${BIN:-codex}"
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN"
  # Honest timeout parse BEFORE any runner start: unparseable → precondition,
  # never a silent 300s default inside the transport.
  if ! codex_transport_timeout_seconds "$TIMEOUT" >/dev/null; then
    die_precondition "invalid --timeout value: $TIMEOUT"
  fi
  # READ-ONLY by posture only; codex is the same sandboxed runner used for
  # review in dispatch-review.sh and is the strongest default isolation option
  # available here.
  #
  # D0-T transport: private 0700/0600 artifacts, exit-first process-tree
  # classification, stdout authority + last-message witness, chrome-frame
  # session-id anchoring. Caller-supplied --output-last-message is already a
  # usage error (unknown arg → exit 2) before we reach here.
  if ! codex_transport_create_artifacts; then
    die_precondition "failed to create private codex transport artifacts"
  fi
  # Drop the generic pre-allocated capture; stdout in the private run dir is
  # the sole content authority and the raw_log path consumers receive.
  rm -f "$RAW_LOG" 2>/dev/null || true
  RAW_LOG="$CODEX_STDOUT"
  CODEX_TRANSPORT=1
  set +e
  codex_transport_run \
    "$CODEX_BIN" "$MODEL" "$EFFORT" "$PROMPT_FILE" \
    "$CODEX_STDOUT" "$CODEX_STDERR" "$CODEX_SIDECAR" "$TIMEOUT"
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
elif [[ "$RUNNER" = "qoderclicn" ]]; then
  QODER_BIN="${BIN:-qoderclicn}"
  command -v "$QODER_BIN" >/dev/null 2>&1 || die_precondition "qoder binary not found: $QODER_BIN (Qoder CLI CN)"
  # Read-only authoring, grok-shaped: scratch cwd (-w), --tools "" (no editor/tools — the
  # authored content is produced as STDOUT text, not repo edits), prompt via STDIN. STDERR is
  # discarded (2>/dev/null) so qoder's benign non-git-cwd 'fatal: not a git repository' never
  # lands in the captured authored text. Enforced timeout is the hang backstop.
  QODER_CWD="$(mktemp -d -t dispatch-author-qodercwd-XXXXXX)"
  set +e
  timeout "$TIMEOUT" bash -c 'cd "$1" && exec "$2" -p --model "$3" -w "$1" \
    --reasoning-effort "$4" --tools "" --dangerously-skip-permissions --no-session-persistence < "$5"' \
    _ "$QODER_CWD" "$QODER_BIN" "$MODEL" "$EFFORT" "$PROMPT_FILE" > "$RAW_LOG" 2>/dev/null
  RUNNER_EXIT=$?
  set -e
  rm -rf "$QODER_CWD"; QODER_CWD=""
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
elif [[ "$RUNNER" = "anthropic-compatible" ]]; then
  ANTHROPIC_JS="${BIN:-$(cd "$(dirname "$0")" && pwd)/dispatch-anthropic-review.js}"
  [[ -r "$ANTHROPIC_JS" ]] || die_precondition "dispatch-anthropic-review.js not found beside dispatch-author.sh"
  command -v node >/dev/null 2>&1 || die_precondition "node binary not found: node (required for anthropic-compatible author)"
  TIMEOUT_MS="$(timeout_to_ms "$TIMEOUT")" || die_precondition "--timeout must be an integer millisecond value or use Ns/Nm syntax (got: $TIMEOUT)"
  if [[ -n "$EP_URL" ]]; then
    ANTHROPIC_BASE_URL="$EP_URL"
    ANTHROPIC_TOKEN_ENV="$EP_TOKEN_ENV"
  elif [[ -n "${ANTHROPIC_COMPATIBLE_BASE_URL:-}" ]]; then
    ANTHROPIC_BASE_URL="$ANTHROPIC_COMPATIBLE_BASE_URL"
  elif [[ -n "${AUTOPILOT_MINIMAX_BASE_URL:-}" ]]; then
    ANTHROPIC_BASE_URL="$AUTOPILOT_MINIMAX_BASE_URL"
  else
    ANTHROPIC_BASE_URL="https://api.minimax.io/anthropic"
  fi
  # Authoring payloads are large single files; the JS's 4096 review default truncates them
  # and the truncated response fail-closes (verified live: GLM r6 oracle stopped at
  # max_tokens). Env override for calibration; validated as a positive integer.
  AUTHOR_MAX_TOKENS="${AUTOPILOT_AUTHOR_MAX_TOKENS:-30000}"
  [[ "$AUTHOR_MAX_TOKENS" =~ ^[1-9][0-9]*$ ]] || die_precondition "AUTOPILOT_AUTHOR_MAX_TOKENS must be a positive integer (got: $AUTHOR_MAX_TOKENS)"
  ANTHROPIC_ARGS=(
    --raw
    --prompt-file "$PROMPT_FILE"
    --model "$MODEL"
    --timeout-ms "$TIMEOUT_MS"
    --max-tokens "$AUTHOR_MAX_TOKENS"
    --base-url "$ANTHROPIC_BASE_URL"
  )
  if [[ -n "$ANTHROPIC_TOKEN_ENV" ]]; then
    ANTHROPIC_ARGS+=(--token-env "$ANTHROPIC_TOKEN_ENV")
  fi
  set +e
  node "$ANTHROPIC_JS" "${ANTHROPIC_ARGS[@]}" > "$RAW_LOG" 2>>"$RAW_LOG"
  RUNNER_EXIT=$?
  set -e
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

# Exit-first classification: deadline / incomplete tree / any nonzero precede
# ALL content reads (witness, session, empty check). Bytes written during
# cleanup cannot recover an authored result.
if [[ "$CODEX_TRANSPORT" -eq 1 ]]; then
  if [[ "$CODEX_DEADLINE_HIT" -eq 1 ]]; then
    die_runner_failed "${RUNNER_EXIT:-124}"
  fi
  if [[ "$CODEX_INCOMPLETE_TREE" -eq 1 ]]; then
    die_runner_failed "${RUNNER_EXIT:-1}"
  fi
fi

if [[ "$RUNNER_EXIT" -ne 0 ]]; then
  die_runner_failed "$RUNNER_EXIT"
fi

# Codex transport gates (only after exit 0 + fully reaped tree).
# Artifact integrity precedes settle; hardened content checks run after settle on
# the final bytes so empty_output stays the post-settle classification for blank
# stdout, while any non-empty result must still clear chrome+witness+session.
if [[ "$CODEX_TRANSPORT" -eq 1 ]]; then
  if ! codex_transport_check_all_artifacts "$CODEX_RUN_DIR"; then
    emit_result "runner_failed" "$RAW_LOG" "codex transport artifact integrity failed" 3
  fi
fi

# Fail-closed checks model content, not pseudo-TTY chrome.
# `script -qec` always emits chrome lines; strip CR and those lines before
# checking for non-whitespace output.
# Bounded settle-wait for late-flush
# (Codex: settle never converts a prior exit-first/incomplete-tree rejection
# into authored — those paths already exited above. Post-settle content still
# faces unconditional chrome/witness/session gates below.)
if [[ "$RUNNER" = "cc-shim" ]]; then
  wait_output_quiescent "$RAW_LOG" "${AUTOPILOT_SETTLE_MS:-60000}" 30000 || true
else
  wait_output_quiescent "$RAW_LOG" "${AUTOPILOT_SETTLE_MS:-60000}" || true
fi

if [[ "$STRICT_CONTRACT" -eq 1 ]]; then
  CONTAINMENT_POST_STATUS="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)"
  CONTAINMENT_POST_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$CONTAINMENT_PRE_STATUS" != "$CONTAINMENT_POST_STATUS" || "$CONTAINMENT_PRE_HEAD" != "$CONTAINMENT_POST_HEAD" ]]; then
    emit_result "containment_breach" "$RAW_LOG" "containment_breach: repo state changed during dispatch; output is quarantined for manual recovery" 4 "$(strict_result_fields "breach")"
  fi
fi

# grep -c (not -q): -q exits at first match and SIGPIPEs tr/sed under pipefail — a
# multi-KB capture then misclassifies as empty ~97% of the time (measured 2026-07-05).
if ! tr -d '\r' < "$RAW_LOG" \
  | sed '/^Script started on /d; /^Script done on /d' \
  | grep -c '[^[:space:]]' > /dev/null; then
  emit_result "empty_output" "$RAW_LOG" "no non-whitespace output from runner — fail-closed" 1
fi

# Codex hardened content checks — unconditional once stdout is non-empty.
# Remove the has-chrome-frame bypass: missing chrome is runner_failed, same as
# witness or session-id failure. No normalization / fallback / recovery path.
if [[ "$CODEX_TRANSPORT" -eq 1 ]]; then
  if ! codex_transport_has_chrome_frame "$CODEX_STDERR"; then
    emit_result "runner_failed" "$RAW_LOG" "codex transport chrome frame missing" 3
  fi
  if ! codex_transport_verify_witness "$CODEX_STDOUT" "$CODEX_SIDECAR"; then
    emit_result "runner_failed" "$RAW_LOG" "codex transport witness verification failed" 3
  fi
  if ! CODEX_SESSION_ID="$(codex_transport_extract_session_id "$CODEX_STDERR")"; then
    CODEX_SESSION_ID=""
    emit_result "runner_failed" "$RAW_LOG" "codex transport session id extraction failed" 3
  fi
fi

AUTHOR_EXTRA="$(strict_result_fields "clean")"
if [[ "$CODEX_TRANSPORT" -eq 1 && -n "$CODEX_SESSION_ID" ]]; then
  AUTHOR_EXTRA="${AUTHOR_EXTRA}, \"session_id\": \"$(json_escape "$CODEX_SESSION_ID")\""
fi
emit_result "authored" "$RAW_LOG" "null" 0 "$AUTHOR_EXTRA"
