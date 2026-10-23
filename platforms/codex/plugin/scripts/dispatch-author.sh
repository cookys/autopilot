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
#   cursor runner: drives the Cursor CLI (`cursor-agent`, NOT `cursor`). EDIT-ONLY posture via
#   `--mode ask` from a scratch cwd, prompt on STDIN (P7), `--trust` mandatory headlessly (P3),
#   `--output-format text` (P13: clean prose on stdout, empty stderr). `--model` MUST be a full
#   cursor-agent model id (`cursor-agent --list-models`); there is no default and no
#   family-alias resolution on this rail (that lives only in dispatch-hetero.sh's
#   lib/cursor-model.sh) — a missing or bare-alias --model is a precondition failure. No
#   --reasoning-effort/--effort: effort is encoded in the model id (P12); cursor-agent rejects
#   both flags with "error: unknown option". A non-zero exit FROM the invoked cursor-agent
#   process is runner_failed here (parity with every other runner — codex/grok/agy/kimi/etc.
#   all map a non-zero engine exit to runner_failed), never a coerced authored result, and
#   NEVER salvaged from stderr. Only failures BEFORE cursor-agent is invoked (binary missing,
#   bad/bare-alias --model) are precondition_failed.
#
# USAGE:
#   scripts/dispatch-author.sh --runner codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|cursor --model <name> --prompt-file <file>
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
#       --polarity-receipt <file> [--require-polarity-receipt]
#       --polarity-base-sha <full-sha> --polarity-head-sha <full-sha>
#       --polarity-verify-cmd <path> [--polarity-assertion-artifact <path>]...
#       # carry a machine-validated red-before/green-after receipt for deliberately buggy assertions.
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
#     "runner": "codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|cursor",
#     "model": "...",
#     "status": "authored|empty_output|precondition_failed|runner_failed|truncated",
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
# EXIT: 0 = authored (non-empty raw output), 1 = empty_output, 2 = precondition_failed, 3 = runner_failed, 4 = containment_breach, 5 = truncated
#   (non-codex: missing/incomplete AUTHOR/END frame or tool-narration inside the frame;
#   error is one of frame_missing / frame_format / end_missing / tool_narration;
#   frame_format = both derived markers present but not on separate lines, result adds frame_derived). Codex transport is
#   unchanged and never emits truncated.
# Follow-up: AUTHOR/END locator awk is duplicated from dispatch-review.sh (v2.36.4
# grok glued-preamble split + v2.36.70 duplicate-BEGIN handling). Extract a shared
# lib rather than a third hand-rolled parser.
# dispatch-plan-review.js is not touched; its generic non-authored+error handling
# carries truncated.

set -uo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/output-quiescence.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/dispatch-detach.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/dispatch-author-codex-transport.sh"
# shellcheck source=lib/grok-effort.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/grok-effort.sh"
# shellcheck source=lib/cursor-model.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/cursor-model.sh"
# shellcheck source=lib/agy-model-alias.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/agy-model-alias.sh"
# shellcheck source=lib/agy-argv-ceiling.sh
# The agy branch below hands the prompt to agy as ONE argv string (agy has no --prompt-file),
# so this rail has the same MAX_ARG_STRLEN wall as dispatch-hetero.sh and dispatch-review.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/agy-argv-ceiling.sh"

# Preserve original argv so the R1 detach supervisor can re-run this EXACT dispatch inline
# inside a kill-surviving setsid session (lib/dispatch-detach.sh). Captured before parsing.
ORIG_ARGS=("$@")

# Populate endpoint credential env from the canonical ~/.autopilot/endpoints.env (best-effort;
# absent/rejected file = no-op → the cc-shim precondition fires normally). Loaded BEFORE any
# env consumption. Contract stays AUTOPILOT_ENDPOINT_<NAME>_* env vars.
_AUTHOR_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib/repo-identity.sh
# Fail-open: a missing helper only degrades the manifest to repo_identity null (telemetry sidecar).
[ -r "$_AUTHOR_SELF_DIR/lib/repo-identity.sh" ] && . "$_AUTHOR_SELF_DIR/lib/repo-identity.sh" || true
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
RUNNER=""; MODEL=""; PROMPT_FILE=""; EFFORT="xhigh"; EFFORT_EXPLICIT=0; TIMEOUT="5m"; BIN=""; ENDPOINT=""
REPO_ROOT=""; STRICT_ROSTER=0; STRICT_CONTRACT=0; CONTRACT_FILE=""; CONTRACT_FILE_SUPPLIED=0
TIMEOUT_SUPPLIED=0
POLARITY_RECEIPT=""; REQUIRE_POLARITY_RECEIPT=0; POLARITY_RECEIPT_DIGEST=""
CONTRACT_REQUIRES_POLARITY=0
POLARITY_BASE_SHA=""; POLARITY_HEAD_SHA=""; POLARITY_VERIFY_CMD=""
declare -a POLARITY_ASSERTION_ARTIFACTS=()
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
    --effort)      EFFORT="${2:-}"; EFFORT_SUPPLIED=1; EFFORT_EXPLICIT=1; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; TIMEOUT_SUPPLIED=1; shift 2 ;;
    --bin)         BIN="${2:-}"; shift 2 ;;
    --context-window) CONTEXT_WINDOW_GATE="${2:-}"; shift 2 ;;
    --ledger)      LEDGER="${2:-}"; shift 2 ;;
    --run-id)      RUN_ID="${2:-}"; shift 2 ;;
    --stage)       STAGE="${2:-}"; shift 2 ;;
    --endpoint)    { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--endpoint requires a non-empty value" >&2; exit 2; }; ENDPOINT="$2"; [ "$ENDPOINT" = "@none" ] && ENDPOINT=""; [ -n "$ENDPOINT" ] && ENDPOINT_SUPPLIED=1; shift 2 ;;
    --strict-roster) STRICT_ROSTER=1; shift ;;
    --strict-contract) STRICT_CONTRACT=1; shift ;;
    --contract-file) CONTRACT_FILE="${2:-}"; CONTRACT_FILE_SUPPLIED=1; shift 2 ;;
    --polarity-receipt) { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--polarity-receipt requires a non-empty value" >&2; exit 2; }; POLARITY_RECEIPT="$2"; shift 2 ;;
    --require-polarity-receipt) REQUIRE_POLARITY_RECEIPT=1; shift ;;
    --polarity-base-sha|--polarity-base) { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "$1 requires a non-empty value" >&2; exit 2; }; POLARITY_BASE_SHA="$2"; shift 2 ;;
    --polarity-head-sha|--polarity-head) { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "$1 requires a non-empty value" >&2; exit 2; }; POLARITY_HEAD_SHA="$2"; shift 2 ;;
    --polarity-verify-cmd) { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--polarity-verify-cmd requires a non-empty value" >&2; exit 2; }; POLARITY_VERIFY_CMD="$2"; shift 2 ;;
    --polarity-assertion-artifact) { [ $# -ge 2 ] && [ -n "$2" ]; } || { echo "--polarity-assertion-artifact requires a non-empty value" >&2; exit 2; }; POLARITY_ASSERTION_ARTIFACTS+=("$2"); shift 2 ;;
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
# shellcheck source=lib/gitconfig-containment.sh
. "$_AUTHOR_SELF_DIR/lib/gitconfig-containment.sh"

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

validate_polarity_receipt() {
  [ -n "$POLARITY_RECEIPT" ] || die_precondition "--require-polarity-receipt requires --polarity-receipt <file>"
  [ -r "$POLARITY_RECEIPT" ] || die_precondition "polarity receipt is not readable: $POLARITY_RECEIPT"
  [ -n "$REPO_ROOT" ] || die_precondition "polarity receipt validation requires a repository context"
  [ -n "$POLARITY_BASE_SHA" ] || die_precondition "polarity receipt shipping validation requires --polarity-base-sha"
  [ -n "$POLARITY_HEAD_SHA" ] || die_precondition "polarity receipt shipping validation requires --polarity-head-sha"
  [ -n "$POLARITY_VERIFY_CMD" ] || die_precondition "polarity receipt shipping validation requires --polarity-verify-cmd"
  local artifact_args=()
  local artifact
  for artifact in "${POLARITY_ASSERTION_ARTIFACTS[@]}"; do
    artifact_args+=(--assertion-artifact "$artifact")
  done
  local validation validation_rc
  validation="$(bash "$_AUTHOR_SELF_DIR/verify-red-green.sh" --validate \
    --receipt "$POLARITY_RECEIPT" --repo "$REPO_ROOT" \
    --base "$POLARITY_BASE_SHA" --head "$POLARITY_HEAD_SHA" \
    --verify-cmd "$POLARITY_VERIFY_CMD" "${artifact_args[@]}" 2>&1)"
  validation_rc=$?
  if [ "$validation_rc" -ne 0 ]; then
    die_precondition "polarity receipt rejected: $(printf '%s' "$validation" | tr '\n' ' ')"
  fi
  POLARITY_RECEIPT_DIGEST="$(extract_file_json_value "$POLARITY_RECEIPT" receipt_digest 2>/dev/null || true)"
  [[ "$POLARITY_RECEIPT_DIGEST" =~ ^[0-9a-f]{64}$ ]] \
    || die_precondition "polarity receipt has no valid receipt_digest"
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

# Positive-integer kill-after grace. `timeout -k 0` does not send KILL, so a
# non-positive or non-numeric AUTOPILOT_AUTHOR_KILL_GRACE_SECS falls back to 30.
author_kill_grace() {
  AUTHOR_KILL_GRACE_SECS="${AUTOPILOT_AUTHOR_KILL_GRACE_SECS:-30}"
  [[ "$AUTHOR_KILL_GRACE_SECS" =~ ^[1-9][0-9]*$ ]] || AUTHOR_KILL_GRACE_SECS=30
}

# timeout exits 124 when the child dies from TERM, and 137 when the kill-after
# grace has to send KILL. Map 137 back to 124 only after the deadline has
# elapsed, so an early SIGKILL (OOM or an external kill) is not reported as
# transport_status timeout. $1 is $SECONDS taken immediately before timeout.
author_remap_kill_exit() {
  local start_secs="$1" elapsed limit
  if [[ "$RUNNER_EXIT" -eq 137 ]]; then
    elapsed=$((SECONDS - start_secs))
    if limit="$(normalize_timeout_seconds "$TIMEOUT" 2>/dev/null)" \
      && [[ "$elapsed" -ge "$limit" ]]; then
      RUNNER_EXIT=124
    fi
  fi
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
  AUTHOR_FINAL_STATUS="$status"

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
    if [ -n "${GITCONFIG_SNAPSHOT_FILE:-}" ] && [ -f "${GITCONFIG_SNAPSHOT_FILE:-}" ]; then
      local gc_keys="" gc_oneline="" gc_rc=0
      gc_keys="$(gitconfig_containment_restore "$REPO_ROOT" "$GITCONFIG_SNAPSHOT_FILE")" || gc_rc=$?
      rm -f -- "$GITCONFIG_SNAPSHOT_FILE"
      GITCONFIG_SNAPSHOT_FILE=""
      if [ "$gc_rc" -ne 0 ]; then
        GITCONFIG_RESTORE_FAILED=1
      fi
      if [ -n "$gc_keys" ]; then
        GITCONFIG_DRIFT_KEYS="$gc_keys"
        if [ "$gc_rc" -eq 0 ]; then
          gc_oneline="${gc_keys//$'\n'/ }"
          echo "WARNING: git config drift detected — worker changed: ${gc_oneline}; restored the original values" >&2
        fi
      fi
    fi
  fi
  if [ "${IDENTITY_DRIFT:-0}" -eq 1 ]; then
    extra_fields="${extra_fields}, \"identity_drift\": true"
  fi
  if [ -n "${GITCONFIG_DRIFT_KEYS:-}" ]; then
    local gc_json="" gc_line="" gc_first=1
    while IFS= read -r gc_line; do
      [ -n "$gc_line" ] || continue
      if [ "$gc_first" -eq 1 ]; then gc_first=0; else gc_json="$gc_json, "; fi
      gc_json="$gc_json\"$(json_escape "$gc_line")\""
    done <<< "${GITCONFIG_DRIFT_KEYS}"
    extra_fields="${extra_fields}, \"gitconfig_drift\": [${gc_json}]"
  fi
  if [ "${GITCONFIG_RESTORE_FAILED:-0}" -eq 1 ]; then
    extra_fields="${extra_fields}, \"gitconfig_restore_failed\": true"
  fi
  if [ -n "${POLARITY_RECEIPT_DIGEST:-}" ]; then
    extra_fields="${extra_fields}, \"polarity_receipt_digest\": \"$(json_escape "$POLARITY_RECEIPT_DIGEST")\""
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

# Bounded, secret-redacted tail of the runner's captured stderr (BL-0136). Prints
# nothing when there is no stderr file. Redaction reuses hooks/_shared/secret-patterns.
runner_stderr_excerpt() {
  local err_file="${RUNNER_ERR_FILE:-}"
  [[ -n "$err_file" && -s "$err_file" ]] || return 0
  node -e '
    const fs = require("fs"), path = require("path");
    let redact = (t) => String(t);
    try { redact = require(path.join(process.argv[2], "..", "hooks", "_shared", "secret-patterns")).redact; } catch (_e) {}
    const b = fs.readFileSync(process.argv[1]);
    const tail = b.subarray(Math.max(0, b.length - 2048)).toString("utf8");
    process.stdout.write(redact(tail).replace(/\s+/g, " ").trim());
  ' "$err_file" "$_AUTHOR_SELF_DIR" 2>/dev/null || true
}

# transport_status vocabulary matches dispatch-plan-review.js: quota | timeout | exit_failure.
# Quota detection reuses engine-capability-state.js classify-error (402/balance/credits shapes).
runner_transport_status() {
  local exit_code="$1" scan cls
  scan="$(mktemp -t dispatch-author-classify-XXXXXX)"
  { [[ -s "${RUNNER_ERR_FILE:-}" ]] && cat "$RUNNER_ERR_FILE"; tail -c 4096 "$RAW_LOG" 2>/dev/null; } > "$scan" 2>/dev/null || true
  cls="$(node "$_AUTHOR_SELF_DIR/engine-capability-state.js" classify-error --file "$scan" 2>/dev/null || true)"
  rm -f "$scan"
  if [[ "$cls" = "quota_exhausted" ]]; then echo quota
  elif [[ "$exit_code" = "124" ]]; then echo timeout
  else echo exit_failure; fi
}

die_runner_failed() {
  local -r runner_exit_code="$1"
  local excerpt status msg
  excerpt="$(runner_stderr_excerpt)"
  status="$(runner_transport_status "$runner_exit_code")"
  msg="runner exited $runner_exit_code"
  if [[ -n "$excerpt" ]]; then
    msg="$msg: $excerpt"
    # Keep the same redacted excerpt in the raw log so the cause survives the JSON.
    printf '\n--- runner stderr (redacted, last 2048 bytes) ---\n%s\n' "$excerpt" >> "$RAW_LOG" 2>/dev/null || true
    # BL-0229: also surface it on the wrapper's own stderr (masked above, re-cut to <=2000 bytes on a
    # UTF-8 boundary), so a caller that reads only stderr sees why the runner failed, not a silent exit 3.
    printf 'dispatch-author: runner stderr (%s/%s, rc=%s): %s\n' "$RUNNER" "$MODEL" "$runner_exit_code" \
      "$(printf '%s' "$excerpt" | LC_ALL=C tail -c 2000 | LC_ALL=C sed -E '1s/^[\x80-\xBF]+//')" >&2 || true
  fi
  rm -f "${RUNNER_ERR_FILE:-}" 2>/dev/null || true
  emit_result "runner_failed" "$RAW_LOG" "$msg" 3 ", \"transport_status\": \"$status\""
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
      die_precondition "active session-mode=$level blocks non-strict dispatch (repo=$consumed_repo). To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=\$(mktemp -d)"
    fi
  done
}

# run_review_loop_resolver — sets REVIEW_LOOP_JSON / REVIEW_LOOP_JSON_RC from the resolver.
# The resolver prints one "qc_panel[N] seat ... has no recorded operator admission" stderr note
# per unpinned final-panel seat. Those describe the managed review rail's final panel, which
# the author role never touches (BL-0097), so a SUCCESSFUL resolve drops exactly those lines
# and forwards everything else; a FAILED resolve forwards its whole stderr (the notes can be
# part of the diagnosis). The resolver itself still prints them for its other callers.
run_review_loop_resolver() {
  local _rl_err
  _rl_err="$(mktemp -t dispatch-author-resolver-err-XXXXXX)" || _rl_err=""
  if [[ -z "$_rl_err" ]]; then
    REVIEW_LOOP_JSON="$(
      cd "$REPO_ROOT" && REVIEW_LOOP_CONFIG_OVERRIDE="$REVIEW_LOOP_CONFIG" "$_AUTHOR_SELF_DIR/resolve-review-loop.sh"
    )"
    REVIEW_LOOP_JSON_RC=$?
    return 0
  fi
  REVIEW_LOOP_JSON="$(
    cd "$REPO_ROOT" && REVIEW_LOOP_CONFIG_OVERRIDE="$REVIEW_LOOP_CONFIG" "$_AUTHOR_SELF_DIR/resolve-review-loop.sh" 2>"$_rl_err"
  )"
  REVIEW_LOOP_JSON_RC=$?
  if [[ "$REVIEW_LOOP_JSON_RC" -eq 0 ]]; then
    grep -v -E '^resolve-review-loop: ⚠ qc_panel\[[0-9]+\] seat \(.*\) has no recorded operator admission' "$_rl_err" >&2 || true
  else
    cat "$_rl_err" >&2
  fi
  rm -f "$_rl_err"
}

load_verification_author_from_review_loop() {
  REVIEW_LOOP_CONFIG="$REPO_ROOT/.claude/review-loop-config.md"
  [[ -r "$REVIEW_LOOP_CONFIG" ]] || die_precondition "config missing at --repo-root/.claude/review-loop-config.md"
  run_review_loop_resolver
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

  local contract_check_args=(check --contract "$CONTRACT_FILE" --repo "$REPO_ROOT" --json)
  # A standing operator pin reaches the checker ONLY through a --resolved-live document
  # (dispatch-contract.js never opens the pin store). Same shape as dispatch-hetero.sh: the
  # document is handed over only when it carries a pin; any resolver failure proceeds
  # without it, byte-identical to the pre-pin behaviour.
  local live_file="" live_note=""
  if [ "${AUTOPILOT_RESOLVED_LIVE:-auto}" != "off" ]; then
    live_file="$(mktemp -t 'dispatch-author-resolved-live-XX''XX''XX')" || live_file=""
    if [ -n "$live_file" ] \
      && node "$_AUTHOR_SELF_DIR/resolve-dispatch-topology.js" --resolve-live --role verification_author >"$live_file" 2>"$live_file.err"; then
      if node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j&&j.operator_pin&&typeof j.operator_pin==="object"?0:1)' "$live_file" 2>/dev/null; then
        contract_check_args+=(--resolved-live "$live_file")
        live_note="resolved-live: verification_author via resolve-dispatch-topology.js (standing pin present)"
      else
        live_note="resolved-live: no standing pin for verification_author; contract checked without the document"
        rm -f "$live_file" "$live_file.err"; live_file=""
      fi
    else
      live_note="resolved-live unavailable ($(tr '\n' ' ' < "${live_file:-/dev/null}.err" 2>/dev/null | cut -c1-200)); contract checked without it"
      rm -f "${live_file:+$live_file}" "${live_file:+$live_file.err}" 2>/dev/null; live_file=""
    fi
  fi
  [ -n "$live_note" ] && printf 'dispatch-author: %s\n' "$live_note" >&2
  contract_check_out="$(node "$_AUTHOR_SELF_DIR/dispatch-contract.js" "${contract_check_args[@]}" 2>&1)"
  contract_check_rc=$?
  rm -f "${live_file:+$live_file}" "${live_file:+$live_file.err}" 2>/dev/null

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
  jq -e '.deliberate_polarity == true' "$CONTRACT_FILE" >/dev/null && CONTRACT_REQUIRES_POLARITY=1

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
  EFFORT="$VERIFICATION_AUTHOR_EFFORT"; EFFORT_EXPLICIT=1
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
  run_review_loop_resolver
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
  run_review_loop_resolver
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
  EFFORT_EXPLICIT=1
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

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy|grok|kimi|cc-shim|anthropic-compatible|claude-native|qoderclicn|cursor)"
case "$RUNNER" in cc-shim|claude-native) declare -F child_session_mint >/dev/null 2>&1 && child_session_mint ;; esac
case "$RUNNER" in codex|agy|grok|kimi|cc-shim|anthropic-compatible|claude-native|qoderclicn|cursor) ;; *) die_precondition "--runner must be codex, agy, grok, kimi, cc-shim, anthropic-compatible, claude-native, qoderclicn, or cursor (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
if [[ "$RUNNER" = "cursor" ]]; then
  # No family-alias resolution on this rail (that lives only in dispatch-hetero.sh's
  # lib/cursor-model.sh) — --model must already be a full cursor-agent model id. The
  # alias set is a single source of truth (lib/cursor-model.sh's _CURSOR_FAMILIES,
  # via cursor_is_family_alias) rather than restated here as a literal case pattern.
  cursor_is_family_alias "$MODEL" && die_precondition "--model for --runner cursor must be a full cursor-agent model id, not a family alias (got: $MODEL); see cursor-agent --list-models"
fi
[[ -n "$PROMPT_FILE" && -r "$PROMPT_FILE" ]] || die_precondition "--prompt-file is required and must be readable"
case "$EFFORT" in default|low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be default|low|medium|high|xhigh|max" ;; esac
# `default` = no effort sent, the endpoint default runs. Only a runner whose effort is optional can honour that;
# a runner that consumes --effort would be handed the literal word "default".
if [ "$EFFORT" = "default" ]; then
  case "$RUNNER" in
    anthropic-compatible|cc-shim|claude-native|kimi) ;;
    *) die_precondition "--effort default (no effort sent) is only for runners whose effort is optional (anthropic-compatible|cc-shim|claude-native|kimi); runner '$RUNNER' takes an explicit effort" ;;
  esac
fi
# claude CLI (cc-shim / claude-native) takes --effort low|medium|high|xhigh|max (claude 2.1.299 --help); the enum
# check above already rejects anything else, so no value is ever silently remapped. It is forwarded ONLY when the
# caller (or a strict roster) explicitly set EFFORT: the literal EFFORT="xhigh" above is a script default, not a
# seat decision, and silently raising an unspecified call (sonnet medium -> xhigh; xhigh is unprobed on GLM/M3)
# is not this change's job. `default` sends nothing.
CLAUDE_EFFORT_ARG=""
if [ "$EFFORT_EXPLICIT" -eq 1 ] && [ "$EFFORT" != "default" ]; then CLAUDE_EFFORT_ARG="$EFFORT"; fi


if [ "$RUNNER" = "agy" ]; then
  AGY_BIN="${BIN:-agy}"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  # `|| die` in the PARENT — the resolver never dies inside `$( )` (a die there would be
  # captured into MODEL instead of exiting).
  MODEL="$(agy_resolve_model_alias "$MODEL" "$AGY_BIN" "$EFFORT")" \
    || die_precondition "$MODEL"
  command -v bwrap >/dev/null 2>&1 \
    || die_precondition "agy verification-author requires bwrap filesystem/process isolation"
  # Refuse an unexec'able payload by name. The generated run.sh embeds `-p "$(cat <prompt>)"`,
  # so the whole prompt becomes one argv string and execve rejects it over MAX_ARG_STRLEN before
  # agy starts — a bare 126/127 with no vendor text, which reads as a stalled seat. `wc -c` on the
  # file slightly over-counts (command substitution strips trailing newlines): the safe direction.
  if ! AGY_CEILING_REASON="$(agy_argv_ceiling_assert "$(wc -c < "$PROMPT_FILE")" "the authoring prompt" \
      "narrow the authoring task, or use a runner that reads a prompt file (codex, grok, qoderclicn)")"; then
    die_precondition "$AGY_CEILING_REASON"
  fi
fi

if [ "$RUNNER" = "kimi" ]; then
  KIMI_BIN="${BIN:-kimi}"
  command -v "$KIMI_BIN" >/dev/null 2>&1 || die_precondition "kimi binary not found: $KIMI_BIN"
  KIMI_JS="$(cd "$(dirname "$0")" && pwd)/dispatch-author-kimi.js"
  [[ -r "$KIMI_JS" ]] || die_precondition "dispatch-author-kimi.js not found beside dispatch-author.sh"
fi

if [[ -n "${AUTOPILOT_SETTLE_MS:-}" && ! "$AUTOPILOT_SETTLE_MS" =~ ^[0-9]+$ ]]; then
  die_precondition "AUTOPILOT_SETTLE_MS must be an integer millisecond value (got: $AUTOPILOT_SETTLE_MS)"
fi

# R1 detach: when ledger coords are supplied and detach is on (default), re-run this dispatch
# INLINE inside a kill-surviving setsid session and relay its durable result. Byte-identical
# inline behavior when no coords / DISPATCH_DETACH=0. NEVER returns when it engages.
dispatch_detach_supervise "$0" "$LEDGER" "$RUN_ID" "$STAGE" "$_AUTHOR_SELF_DIR" -- "${ORIG_ARGS[@]}"

# The explicit non-strict path historically left REPO_ROOT empty and therefore
# skipped identity containment. Resolve it mechanically from the caller's Git
# context; scratch/non-repository callers remain read-only and uncontained.
AUTHOR_REPO_ROOT_EXPLICIT="$REPO_ROOT" # the operator's --repo-root (before the cwd fallback below); manifest repo_identity_source
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$REPO_ROOT" ]; then
    REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
  fi
fi

if [ "$CONTRACT_REQUIRES_POLARITY" -eq 1 ]; then REQUIRE_POLARITY_RECEIPT=1; fi
if [ "$REQUIRE_POLARITY_RECEIPT" -eq 1 ] || [ -n "$POLARITY_RECEIPT" ]; then
  validate_polarity_receipt
fi

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

# ── mid-run observability ────────────────────────────────────────────────────
# Until v2.34.21 this rail was fire-and-forget: the run's identity surfaced only in
# the FINAL JSON, so nothing could locate, watch or liveness-probe an author run
# in flight. dispatch-hetero.sh and dispatch-review.sh already emit a START-time
# manifest that scripts/dispatch-status.js consumes (--run / --list / --stall-secs);
# this mirrors it. It matters twice over, because dispatch-plan-review.js spawns THIS
# script once per seat — so plan review was unobservable for the same reason.
# Trust boundary is unchanged: scheduling telemetry only, never a verdict input,
# never worker self-report.
AUTHOR_RUN_ID="${RUN_ID:-}"
[ -n "$AUTHOR_RUN_ID" ] || AUTHOR_RUN_ID="author-$(date +%s)-$$"
PROMPT_FILE_ORIG="${PROMPT_FILE_ORIG:-$PROMPT_FILE}"
# Lineage — same env names as dispatch-hetero.sh. parent/root JSON null and depth 0
# when the corresponding env is unexported; with a parent, root falls back to parent.
LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID:-}"
LINEAGE_ROOT=""
LINEAGE_DEPTH=0
if [ -n "${AUTOPILOT_PARENT_RUN_ID:-}" ]; then
  LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID}"
  LINEAGE_ROOT="${AUTOPILOT_ROOT_RUN_ID:-$LINEAGE_PARENT}"
  LINEAGE_DEPTH="${AUTOPILOT_DISPATCH_DEPTH:-1}"
  case "$LINEAGE_DEPTH" in *[!0-9]*|"") LINEAGE_DEPTH=1 ;; esac
  if [ "${#LINEAGE_DEPTH}" -gt 7 ]; then
    LINEAGE_DEPTH=1
  elif [ "$((10#$LINEAGE_DEPTH))" -eq 0 ] \
      || [ "$((10#$LINEAGE_DEPTH))" -gt 1000000 ]; then
    LINEAGE_DEPTH=1
  fi
else
  LINEAGE_ROOT="$AUTHOR_RUN_ID"
  # Job root (mods P1W W1f): no parent and no explicit ROOT env => adopt the session marker's job
  # root so ad-hoc dispatches from one session share one root. ROOT-without-parent
  # (campaign / rehydration re-attach) is deliberately left on the old behaviour.
  if [ -z "${AUTOPILOT_ROOT_RUN_ID:-}" ]; then
    _job_root="$(node "$_AUTHOR_SELF_DIR/session-mode.js" root 2>/dev/null | head -n1 || true)"
    case "$_job_root" in ""|*[!A-Za-z0-9._-]*) ;; *) LINEAGE_ROOT="$_job_root" ;; esac
    unset _job_root
  fi
  LINEAGE_DEPTH=0
fi
# The job-root lookup above was this rail's only legitimate read of the caller's explicit session
# binding. Every runner launched below is a CHILD session: scrub the variable so it cannot make
# session-mode.js getSessionId() resolve to the parent's id and overwrite the parent's marker.
# 3b: resolve the parent id handed to every child BEFORE the scrub below.
declare -F child_session_pin >/dev/null 2>&1 && child_session_pin "$_AUTHOR_SELF_DIR" 2>/dev/null || true
unset AUTOPILOT_SESSION_ID
[ -n "$LINEAGE_PARENT" ] && LINEAGE_PARENT="$(printf '%s' "$LINEAGE_PARENT" | tr -c 'A-Za-z0-9._-' '-')"
[ -n "$LINEAGE_ROOT" ] && LINEAGE_ROOT="$(printf '%s' "$LINEAGE_ROOT" | tr -c 'A-Za-z0-9._-' '-')"
LINEAGE_DEPTH=$((10#$LINEAGE_DEPTH))
AUTHOR_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
AUTHOR_STARTED_EPOCH="$(date +%s)"
AUTHOR_MANIFEST_FILE=""
AUTHOR_MANIFEST_ENDED=""
AUTHOR_MANIFEST_ENDED_EPOCH=""
AUTHOR_FINAL_STATUS=""
write_author_manifest() {
  [ "${AUTOPILOT_DISPATCH_MANIFEST:-1}" = "0" ] && return 0
  local dir="${AUTOPILOT_DISPATCH_RUNS_DIR:-${TMPDIR:-/tmp}/autopilot-dispatch-runs}"
  { mkdir -p "$dir"; } 2>/dev/null || return 0
  local safe_id; safe_id="$(printf '%s' "$AUTHOR_RUN_ID" | tr -c 'A-Za-z0-9._-' '-')"
  AUTHOR_MANIFEST_FILE="$dir/${safe_id}.manifest.json"
  local tmp="$AUTHOR_MANIFEST_FILE.tmp.$$"
  # log_format is dispatcher-DECLARED, never content-sniffed, so an authored payload
  # containing JSON lines can never self-report telemetry (same rule as dispatch-review).
  local log_format="plain" aux_json="null"
  if [ "${CODEX_TRANSPORT:-0}" = "1" ]; then
    log_format="codex-chrome"
    [ -n "${CODEX_STDERR:-}" ] && aux_json="\"$(json_escape "$CODEX_STDERR")\""
  fi
  local ledger_json="null"; [ -n "${LEDGER:-}" ] && ledger_json="\"$(json_escape "$LEDGER")\""
  local stage_json="null"; [ -n "${STAGE:-}" ] && stage_json="\"$(json_escape "$STAGE")\""
  local ended_json="null" endep_json="null"
  if [ -n "$AUTHOR_MANIFEST_ENDED" ]; then
    ended_json="\"$AUTHOR_MANIFEST_ENDED\""
    endep_json="${AUTHOR_MANIFEST_ENDED_EPOCH:-null}"
  fi
  local final_json="null"
  [ -n "$AUTHOR_FINAL_STATUS" ] && final_json="\"$(json_escape "$AUTHOR_FINAL_STATUS")\""
  local parent_json="null"; [ -n "${LINEAGE_PARENT:-}" ] && parent_json="\"$(json_escape "$LINEAGE_PARENT")\""
  local root_json="null"; [ -n "${LINEAGE_ROOT:-}" ] && root_json="\"$(json_escape "$LINEAGE_ROOT")\""
  # Caller-stamped role (BL-0149): plan review drives this script for its reviewer seats, which are not authors. Token-only, else "author".
  local role_tok="author"
  case "${AUTOPILOT_DISPATCH_ROLE:-}" in ""|[!a-z]*|*[!a-z0-9-]*) ;; *) role_tok="$AUTOPILOT_DISPATCH_ROLE" ;; esac
  local depth_json="${LINEAGE_DEPTH:-0}"; case "$depth_json" in *[!0-9]*|"") depth_json=0 ;; esac; depth_json=$((10#$depth_json))
  # repo_identity (mods P1a R1): explicit --repo-root wins, else the cwd's toplevel.
  if declare -F repo_identity_resolve_fields >/dev/null 2>&1; then repo_identity_resolve_fields "${AUTHOR_REPO_ROOT_EXPLICIT:-}" "" || true; fi
  [ -n "${REPO_IDENTITY_FIELDS:-}" ] || REPO_IDENTITY_FIELDS='"repo_identity": null, "repo_identity_source": null'
  {
    printf '{ "schema": 1, "run_id": "%s", "role": "%s", "allow_narrative": null, "runner": "%s", "model": "%s", "branch": null, "base": null, "base_sha": null, "worktree": null, "lock_path": null, "log_path": "%s", "log_format": "%s", "aux_log": %s, "pid": %s, "scope_unit": null, "containment_planned": "scratch", "started_at": "%s", "started_epoch": %s, "prompt_file": "%s", "diff_file": null, "ledger": %s, "stage": %s, "ended_at": %s, "ended_epoch": %s, "final_status": %s, "parent_run_id": %s, "root_run_id": %s, "depth": %s, %s, "session_id": %s, "child_session_id": %s, "child_transcript": %s }\n' \
      "$(json_escape "$AUTHOR_RUN_ID")" "$role_tok" "$RUNNER" "$(json_escape "$MODEL")" \
      "$(json_escape "$RAW_LOG")" "$log_format" "$aux_json" "$$" \
      "$AUTHOR_STARTED_AT" "$AUTHOR_STARTED_EPOCH" \
      "$(json_escape "${PROMPT_FILE_ORIG:-$PROMPT_FILE}")" \
      "$ledger_json" "$stage_json" "$ended_json" "$endep_json" "$final_json" \
      "$parent_json" "$root_json" "$depth_json" "$REPO_IDENTITY_FIELDS" \
      "$(declare -F manifest_session_id_json >/dev/null 2>&1 && manifest_session_id_json || printf null)" \
      "$(declare -F manifest_child_session_json >/dev/null 2>&1 && manifest_child_session_json || printf null)" \
      "$(declare -F manifest_child_transcript_json >/dev/null 2>&1 && manifest_child_transcript_json || printf null)" > "$tmp"
  } 2>/dev/null && mv -f "$tmp" "$AUTHOR_MANIFEST_FILE" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  return 0
}
author_manifest_finalize() {
  [ -n "$AUTHOR_MANIFEST_FILE" ] || return 0
  AUTHOR_MANIFEST_ENDED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  AUTHOR_MANIFEST_ENDED_EPOCH="$(date +%s)"
  write_author_manifest
}
write_author_manifest
[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-author: run_id=${AUTHOR_RUN_ID} manifest=${AUTHOR_MANIFEST_FILE:-none} (watch: scripts/dispatch-status.js --run ${AUTHOR_RUN_ID})" >&2

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
GITCONFIG_SNAPSHOT_FILE=""
GITCONFIG_DRIFT_KEYS=""
GROK_CWD=""
CCSHIM_CWD=""
AGY_CWD=""
QODER_CWD=""
CNATIVE_CWD=""
CURSOR_CWD=""
CURSOR_ERR=""
RUNNER_ERR_FILE=""
AUTHOR_WRAP_FILE=""
AUTHOR_PARSE_FILE=""
AUTHOR_BLOCK_FILE=""
BEGIN=""
END=""
DERIVED=""
cleanup() {
  [ -n "$GROK_CWD" ] && rm -rf "$GROK_CWD" || true
  [ -n "$CCSHIM_CWD" ] && rm -rf "$CCSHIM_CWD" || true
  [ -n "$AGY_CWD" ] && rm -rf "$AGY_CWD" || true
  [ -n "$QODER_CWD" ] && rm -rf "$QODER_CWD" || true
  [ -n "$CNATIVE_CWD" ] && rm -rf "$CNATIVE_CWD" || true
  [ -n "$CURSOR_CWD" ] && rm -rf "$CURSOR_CWD" || true
  [ -n "$CURSOR_ERR" ] && rm -f "$CURSOR_ERR" || true
  [ -n "$RUNNER_ERR_FILE" ] && rm -f "$RUNNER_ERR_FILE" || true
  [ -n "$AUTHOR_WRAP_FILE" ] && rm -f "$AUTHOR_WRAP_FILE" || true
  [ -n "$AUTHOR_PARSE_FILE" ] && rm -f "$AUTHOR_PARSE_FILE" || true
  [ -n "$AUTHOR_BLOCK_FILE" ] && rm -f "$AUTHOR_BLOCK_FILE" || true
  # Codex private run artifacts are retained for raw_log consumers (not deleted).
  # Stamp the manifest terminal so a watcher can tell "finished" from "hung" — the
  # whole point of emitting it. Runs last so it records the real end of the process.
  author_manifest_finalize
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
  gitconfig_containment_snapshot "$REPO_ROOT" || true
fi

# Non-codex: wrap the prompt with a derived nonce-keyed AUTHOR/END frame (same
# family as dispatch-review). Codex keeps exact prompt bytes.
PROMPT_FILE_ORIG="$PROMPT_FILE"
if [[ "$RUNNER" != "codex" ]]; then
  NONCE=""
  NONCE_TRIES=0
  while :; do
    NONCE="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    if ! grep -qF "$NONCE" "$PROMPT_FILE_ORIG"; then
      break
    fi
    NONCE_TRIES=$((NONCE_TRIES + 1))
    if [ "$NONCE_TRIES" -ge 4 ]; then
      die_precondition "failed to generate a non-colliding author nonce (4 attempts)"
    fi
  done
  DERIVED="$(printf 'autopilot-author-v1:%s' "$NONCE" | sha256sum | awk '{print substr($1,1,32)}')"
  BEGIN="<<<AUTOPILOT-AUTHOR-${DERIVED}>>>"
  END="<<<AUTOPILOT-END-${DERIVED}>>>"
  AUTHOR_WRAP_FILE="$(mktemp -t dispatch-author-wrap-XXXXXX)"
  {
    cat <<EOF
Output format contract set by the autopilot dispatcher that is calling you: write your whole answer as ONE wrapped block (no other text, no code fences), beginning with the line:
${BEGIN}

and ending with:
${END}

Framing nonce (do NOT use this raw value as a marker; markers above are derived):
NONCE=${NONCE}

Your VERY FIRST output character MUST be the start of the opening marker line above. Output ONLY the wrapped block. Do not emit a Markdown fence whose info string is tool, tool_call, or function_call, and do not emit a <tool_call> tag.

AUTHORING TASK:
EOF
    cat "$PROMPT_FILE_ORIG"
  } > "$AUTHOR_WRAP_FILE"
  PROMPT_FILE="$AUTHOR_WRAP_FILE"
fi

[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-author: ${RUNNER}/${MODEL} (effort=${EFFORT}, timeout=${TIMEOUT})" >&2

# Runner stderr capture (BL-0136): grok / qoderclicn / cc-shim / claude-native write here
# instead of /dev/null; read only on failure, bounded + redacted, never salvaged as output.
RUNNER_ERR_FILE="$(mktemp -t dispatch-author-runner-err-XXXXXX)"
declare -F child_session_apply_env >/dev/null 2>&1 && child_session_apply_env "$_AUTHOR_SELF_DIR" 2>/dev/null || true   # 3b rule 3 for the in-process runner branches

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
  # The codex branch retargets the live log after the manifest was first written;
  # re-emit so a watcher follows the file that is actually being appended to.
  write_author_manifest
  set +e
  # 9th arg: trusted cwd for repository-trust preflight (D3). Prefer explicit
  # --repo-root; empty keeps ambient cwd (legacy callers / non-repo authoring).
  codex_transport_run \
    "$CODEX_BIN" "$MODEL" "$EFFORT" "$PROMPT_FILE" \
    "$CODEX_STDOUT" "$CODEX_STDERR" "$CODEX_SIDECAR" "$TIMEOUT" \
    "${REPO_ROOT:-}"
  set -e
elif [[ "$RUNNER" = "grok" ]]; then
  GROK_BIN="${BIN:-grok}"
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN"
  # Read-only by construction: scratch cwd, no --always-approve, no web, no editor.
  GROK_CWD="$(mktemp -d -t dispatch-author-grokcwd-XXXXXX)"
  author_kill_grace
  set +e
  # effort enum is per-MODEL (grok-4.5 rejects xhigh; 4.6+ accept) ⇒ clamp against THIS model's live enum.
  GROK_EFFORT="$(grok_effort_clamp "$EFFORT" "$MODEL" "$GROK_BIN")"
  grok_effort_note "$EFFORT" "dispatch-author" "$MODEL" "$GROK_BIN" "$GROK_EFFORT"
  AUTHOR_TIMEOUT_START=$SECONDS
  # grok reads --prompt-file, so stdin is /dev/null (avoids SIGTTOU on a tty).
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" "$GROK_BIN" --prompt-file "$PROMPT_FILE" --cwd "$GROK_CWD" --model "$MODEL" \
    --reasoning-effort "$GROK_EFFORT" \
    --no-alt-screen --output-format plain --disable-web-search </dev/null > "$RAW_LOG" 2>"$RUNNER_ERR_FILE"
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AUTHOR_TIMEOUT_START"
  set -e
  rm -rf "$GROK_CWD"; GROK_CWD=""
elif [[ "$RUNNER" = "qoderclicn" ]]; then
  QODER_BIN="${BIN:-qoderclicn}"
  command -v "$QODER_BIN" >/dev/null 2>&1 || die_precondition "qoder binary not found: $QODER_BIN (Qoder CLI CN)"
  # Read-only authoring, grok-shaped: scratch cwd (-w), --tools "" (no editor/tools — the
  # authored content is produced as STDOUT text, not repo edits), prompt via STDIN. STDERR is
  # captured to RUNNER_ERR_FILE (read only on failure) so qoder's benign non-git-cwd 'fatal: not a git repository' never
  # lands in the captured authored text. Enforced timeout is the hang backstop.
  QODER_CWD="$(mktemp -d -t dispatch-author-qodercwd-XXXXXX)"
  author_kill_grace
  set +e
  AUTHOR_TIMEOUT_START=$SECONDS
  # Prompt is fed with < "$5" inside the exec'd child. Do not redirect this timeout's stdin.
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" bash -c 'cd "$1" && exec "$2" -p --model "$3" -w "$1" \
    --reasoning-effort "$4" --tools "" --dangerously-skip-permissions --no-session-persistence < "$5"' \
    _ "$QODER_CWD" "$QODER_BIN" "$MODEL" "$EFFORT" "$PROMPT_FILE" > "$RAW_LOG" 2>"$RUNNER_ERR_FILE"
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AUTHOR_TIMEOUT_START"
  set -e
  rm -rf "$QODER_CWD"; QODER_CWD=""
elif [[ "$RUNNER" = "cursor" ]]; then
  BIN="${BIN:-cursor-agent}"
  command -v "$BIN" >/dev/null 2>&1 || die_precondition "cursor binary not found: $BIN (Cursor CLI — cursor-agent, not cursor)"
  # EDIT-ONLY authoring, grok/qoder-shaped: scratch cwd, `--mode ask` (P9), prompt via STDIN
  # (P7); `--trust` is MANDATORY headlessly (P3) or the run aborts on workspace trust; the
  # agent never commits/pushes/opens a PR here — the wrapper commits and a separate review
  # verifies (same contract as grok/qoderclicn). Enforced `timeout` is the hang backstop
  # (cursor has no print-timeout flag). `--output-format text` (P13) is bound so the authored
  # text lands as clean prose on stdout with empty stderr. STDOUT and STDERR are captured to
  # SEPARATE temp files — STDOUT is the sole authored-text source ($RAW_LOG); STDERR is chrome
  # only, never salvaged into an authored result. No --reasoning-effort/--effort: effort is
  # encoded in the model id (P12) — cursor-agent rejects both with "error: unknown option".
  # A non-zero exit FROM THE INVOKED cursor-agent process is runner_failed (parity with every
  # other runner: codex/grok/agy/kimi/etc. all map a non-zero engine exit to runner_failed via
  # the shared RUNNER_EXIT check below) — the engine ran and failed, which is a different fact
  # from "we never dispatched". Preconditions (binary missing, bad --model) are checked BEFORE
  # this point and still die_precondition. RUNNER_EXIT is left to the shared classification
  # below (including the timeout case, rc=124, which the codex/grok branches also leave to the
  # generic RUNNER_EXIT != 0 check rather than special-casing) — CURSOR_ERR is never read into
  # the result either way, preserving "fail-closed, no salvage from stderr".
  CURSOR_CWD="$(mktemp -d -t dispatch-author-cursorcwd-XXXXXX)"
  CURSOR_ERR="$(mktemp -t dispatch-author-cursor-err-XXXXXX)"
  author_kill_grace
  set +e
  AUTHOR_TIMEOUT_START=$SECONDS
  # Prompt is fed with < "$4" inside the exec'd child. Do not redirect this timeout's stdin.
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" bash -c 'cd "$1" && exec "$2" -p --trust --mode ask --model "$3" \
    --output-format text < "$4"' \
    _ "$CURSOR_CWD" "$BIN" "$MODEL" "$PROMPT_FILE" > "$RAW_LOG" 2> "$CURSOR_ERR"
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AUTHOR_TIMEOUT_START"
  set -e
  rm -rf "$CURSOR_CWD"; CURSOR_CWD=""
elif [[ "$RUNNER" = "kimi" ]]; then
  # The transport lives in `src/runners/kimi.js` (contract-pinned by
  # hooks/tests/dispatch-author-kimi.test.sh); this branch only supplies the
  # shell-side contract — authored text on stdout into $RAW_LOG, non-zero exit
  # otherwise — via scripts/dispatch-author-kimi.js. The adapter owns the
  # scratch cwd, the required-CLI-surface probe, argv shape, and the UTF-8 /
  # empty-output rejections, so none of that is duplicated here.
  #
  # `timeout` wraps it the same way the grok/qoderclicn branches wrap theirs:
  # the enforced deadline is the hang backstop and stays a shell concern.
  # STDERR is appended to $RAW_LOG rather than discarded — unlike qoder there is
  # no known benign chatter to filter, and a swallowed adapter error would
  # surface downstream as the unfalsifiable `empty_output`.
  #
  # The resolved deadline is also forwarded to the shim (`--timeout-seconds`) so the adapter
  # honours --timeout instead of its fixed 300 s cap; the shim keeps it 5 s under the shell
  # kill so the adapter reports `kimi_timeout`. A TIMEOUT normalize_timeout_seconds cannot
  # parse (e.g. `1h`, which `timeout` accepts) forwards nothing = adapter default.
  KIMI_TIMEOUT_ARGS=()
  if KIMI_TIMEOUT_S="$(normalize_timeout_seconds "$TIMEOUT" 2>/dev/null)" && [[ "$KIMI_TIMEOUT_S" -gt 0 ]]; then
    KIMI_TIMEOUT_ARGS=(--timeout-seconds "$KIMI_TIMEOUT_S")
  fi
  author_kill_grace
  set +e
  AUTHOR_TIMEOUT_START=$SECONDS
  # kimi.js reads --prompt-file, so stdin is /dev/null (avoids SIGTTOU on a tty).
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" node "$KIMI_JS" --model "$MODEL" --prompt-file "$PROMPT_FILE" \
    ${KIMI_TIMEOUT_ARGS[@]+"${KIMI_TIMEOUT_ARGS[@]}"} </dev/null > "$RAW_LOG" 2>>"$RAW_LOG"
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AUTHOR_TIMEOUT_START"
  set -e
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
  child_marker_hook_setup || { CHILD_MARKER_SETTINGS=""; CHILD_MARKER_DIR="${AUTOPILOT_SESSION_MODE_DIR:-}"; }
  author_kill_grace
  AUTHOR_TIMEOUT_START=$SECONDS
  # Prompt is fed with < "$4" inside the exec'd child. Do not redirect this timeout's stdin.
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} -u ANTHROPIC_API_KEY HOME="$CCSHIM_CWD" ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_ID:+"AUTOPILOT_CHILD_SESSION_ID=$CHILD_SESSION_ID"} AUTOPILOT_SESSION_MODE_DIR="$CHILD_MARKER_DIR" \
    bash -c 'cd "$1" && exec "$2" -p ${5:+--session-id "$5"} --model "$3" --setting-sources project --strict-mcp-config --tools "" ${6:+--effort "$6"} ${7:+--settings "$7"} < "$4"' \
    _ "$CCSHIM_CWD" "$CC_BIN" "$MODEL" "$PROMPT_FILE" "${CHILD_SESSION_ID:-}" "$CLAUDE_EFFORT_ARG" "${CHILD_MARKER_SETTINGS:-}" > "$RAW_LOG" 2>"$RUNNER_ERR_FILE"
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AUTHOR_TIMEOUT_START"
  set -e
  declare -F ccshim_keep_transcript >/dev/null 2>&1 && { ccshim_keep_transcript "$CCSHIM_CWD" "$AUTHOR_RUN_ID" || true; }
  rm -rf "$CCSHIM_CWD"; CCSHIM_CWD=""
elif [[ "$RUNNER" = "claude-native" ]]; then
  CC_BIN="$(command -v "${BIN:-claude}" 2>/dev/null || true)"
  [ -n "$CC_BIN" ] || die_precondition "claude binary not found: ${BIN:-claude} (claude-native drives the local Claude Code CLI with ambient/native auth)"
  case "$CC_BIN" in
    /*) ;;
    *)  CC_BIN="$(cd "$(dirname "$CC_BIN")" 2>/dev/null && pwd)/$(basename "$CC_BIN")" || true
        case "$CC_BIN" in /*) ;; *) die_precondition "could not resolve --bin to an absolute path: ${BIN}" ;; esac ;;
  esac
  # First-party Claude authoring transport. It keeps ambient native auth but
  # otherwise uses the same scratch-cwd/no-tools posture as the reviewer rail.
  CNATIVE_CWD="$(mktemp -d)"
  set +e
  child_marker_hook_setup || { CHILD_MARKER_SETTINGS=""; CHILD_MARKER_DIR="${AUTOPILOT_SESSION_MODE_DIR:-}"; }
  author_kill_grace
  AUTHOR_TIMEOUT_START=$SECONDS
  # Prompt is fed with < "$4" inside the exec'd child. Do not redirect this timeout's stdin.
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" env ${CHILD_SESSION_UNSET[@]+"${CHILD_SESSION_UNSET[@]}"} ${CHILD_SESSION_PARENT:+"AUTOPILOT_PARENT_SESSION_ID=$CHILD_SESSION_PARENT"} ${CHILD_SESSION_ID:+"AUTOPILOT_CHILD_SESSION_ID=$CHILD_SESSION_ID"} AUTOPILOT_SESSION_MODE_DIR="$CHILD_MARKER_DIR" bash -c 'cd "$1" && exec "$2" -p ${5:+--session-id "$5"} --model "$3" --setting-sources project --strict-mcp-config --tools "" ${6:+--effort "$6"} ${7:+--settings "$7"} < "$4"' \
    _ "$CNATIVE_CWD" "$CC_BIN" "$MODEL" "$PROMPT_FILE" "${CHILD_SESSION_ID:-}" "$CLAUDE_EFFORT_ARG" "${CHILD_MARKER_SETTINGS:-}" > "$RAW_LOG" 2>"$RUNNER_ERR_FILE"
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AUTHOR_TIMEOUT_START"
  set -e
  rm -rf "$CNATIVE_CWD"; CNATIVE_CWD=""
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
  AGY_BIN="${AGY_BIN:-${BIN:-agy}}"
  # agy -p ignores cwd and drops raw stdout under a non-TTY pipe (#76/#408),
  # so capture through pseudo-TTY and strip CR to preserve exactness.
  RUN_SH="$(mktemp -t dispatch-author-agy-XXXXXX)"
  AGY_CWD="$(mktemp -d -t dispatch-author-agycwd-XXXXXX)"
  # bwrap cannot create a bind destination that traverses a symlink ("Can't mkdir ...: No such file
  # or directory"), so a symlinked TMPDIR made every agy dispatch runner_failed. Bind the real path.
  AGY_CWD="$(cd "$AGY_CWD" && pwd -P)"
  # agy opens its own log + crash files under ~/.gemini/antigravity-cli. Under
  # `--ro-bind / /` those opens fail, and agy does NOT degrade quietly: it
  # redirects the whole language-server diagnostic stream to stdout instead
  # ("ERROR: logging before google.Init: ... read-only file system"). Measured
  # 2026-08-14: a 2-token probe came back as a 30,413-byte raw log, which the
  # provider-readiness live probe classifies as `malformed_response`
  # (`src/readiness/probe.js` LIVE_PROBE_MAX_RESPONSE_BYTES) — so the agy seat
  # could never reach `ready` no matter which model was configured.
  #
  # tmpfs rather than a host bind: the writes are pure diagnostics, must not
  # reach the host, and must not survive the run. `--ro-bind / /` containment is
  # unchanged; only these two leaf paths become writable, and the credential
  # material one level up at ~/.gemini stays read-only and readable.
  AGY_STATE_DIR="${HOME:-/root}/.gemini/antigravity-cli"
  # Mount points must exist before the read-only root bind. These are empty
  # directories agy itself also creates; credential material in the parent
  # .gemini directory stays read-only. Fail open: a mkdir error is bwrap's to report.
  mkdir -p "$AGY_STATE_DIR/log" "$AGY_STATE_DIR/crashes" || true
  AGY_EFFORT="$(agy_effort_for_model "$MODEL" "$EFFORT")"
  AGY_CLAMPED="$(agy_effort_clamp "$EFFORT")"
  if [ "$AGY_EFFORT" != "$AGY_CLAMPED" ]; then
    printf 'agy effort %s (clamped %s) folded to %s: model id encodes the tier\n' \
      "$EFFORT" "$AGY_CLAMPED" "$AGY_EFFORT" >&2
  fi
  {
    printf '#!/usr/bin/env bash\n'
    printf 'cd %q || exit 9\n' "$AGY_CWD"
    printf 'exec bwrap --ro-bind / / --dev /dev --proc /proc --bind %q %q --tmpfs %q --tmpfs %q --unshare-pid --die-with-parent --chdir %q %q -p "$(cat %q)" --model %q --effort %q --dangerously-skip-permissions --print-timeout %q\n' \
      "$AGY_CWD" "$AGY_CWD" "$AGY_STATE_DIR/log" "$AGY_STATE_DIR/crashes" \
      "$AGY_CWD" "$AGY_BIN" "$PROMPT_FILE" "$MODEL" "$AGY_EFFORT" "$TIMEOUT"
  } > "$RUN_SH"
  chmod +x "$RUN_SH"
  # agy ignores SIGTERM. The shared kill-after (author_kill_grace /
  # author_remap_kill_exit) escalates to KILL and maps 137 back to 124 only
  # after the deadline has elapsed, so an early SIGKILL is not a timeout.
  author_kill_grace
  set +e
  AGY_TIMEOUT_START=$SECONDS
  timeout -k "$AUTHOR_KILL_GRACE_SECS" "$TIMEOUT" script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1
  RUNNER_EXIT=$?
  author_remap_kill_exit "$AGY_TIMEOUT_START"
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
rm -f "$RUNNER_ERR_FILE" 2>/dev/null || true

# Codex transport gates (only after exit 0 + fully reaped tree).
# Artifact integrity precedes settle; hardened content checks run after settle on
# the final bytes so empty_output stays the post-settle classification for blank
# stdout, while any non-empty result must still clear chrome+witness+session.
if [[ "$CODEX_TRANSPORT" -eq 1 ]]; then
  if ! codex_transport_check_all_artifacts "$CODEX_RUN_DIR"; then
    emit_result "runner_failed" "$RAW_LOG" "codex transport artifact integrity failed" 3 ", \"transport_status\": \"exit_failure\""
  fi
fi

# Fail-closed checks model content, not pseudo-TTY chrome.
# `script -qec` always emits chrome lines; strip CR and those lines before
# checking for non-whitespace output.
# Bounded settle-wait for late-flush
# (Codex: settle never converts a prior exit-first/incomplete-tree rejection
# into authored — those paths already exited above. Post-settle content still
# faces unconditional chrome/witness/session gates below.)
if [[ "$RUNNER" = "cc-shim" || "$RUNNER" = "claude-native" ]]; then
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

# Positive completion predicate for non-codex runners: exactly one derived BEGIN
# and one END (dispatch-review locator family, including grok glued-preamble split
# and duplicate-BEGIN handling). Missing/incomplete frame or tool-narration inside
# the frame ⇒ truncated/5. Gated on the same RUNNER != codex condition as wrap
# so --runner codex without CODEX_TRANSPORT is not classified truncated, and a
# non-codex runner with CODEX_TRANSPORT=1 still strips the frame.
if [[ "$RUNNER" != "codex" ]]; then
  PARSE_INPUT="$RAW_LOG"
  AUTHOR_PARSE_FILE="$(mktemp -t dispatch-author-parse-XXXXXX)"
  tr -d '\r' < "$RAW_LOG" | sed '/^Script started on /d; /^Script done on /d' > "$AUTHOR_PARSE_FILE"
  PARSE_INPUT="$AUTHOR_PARSE_FILE"
  if [[ "$RUNNER" = "grok" ]]; then
    GROK_SPLIT="$(mktemp -t dispatch-author-grok-parse-XXXXXX)"
    awk -v begin="$BEGIN" '
      { line = $0; sub(/\r$/, "", line) }
      !done && line == begin { done = 1 }
      !done {
        i = index($0, "<<<AUTOPILOT-AUTHOR-")
        if (i > 1) { print substr($0, 1, i - 1); print substr($0, i); done = 1; next }
      }
      { print }
    ' "$PARSE_INPUT" > "$GROK_SPLIT"
    rm -f "$AUTHOR_PARSE_FILE"
    AUTHOR_PARSE_FILE="$GROK_SPLIT"
    PARSE_INPUT="$AUTHOR_PARSE_FILE"
  fi
  AUTHOR_BLOCK_FILE="$(mktemp -t dispatch-author-block-XXXXXX)"
  FRAME_CLOSE_FILE="$(mktemp -t dispatch-author-frame-close-XXXXXX)"
  CHROME_MAX_LINES="${AUTOPILOT_AUTHOR_CHROME_MAX_LINES:-200}"
  CHROME_MAX_BYTES="${AUTOPILOT_AUTHOR_CHROME_MAX_BYTES:-65536}"
  PARSE_RC=0
  awk -v begin="$BEGIN" -v end="$END" -v derived="$DERIVED" \
      -v chrome_max_lines="$CHROME_MAX_LINES" -v chrome_max_bytes="$CHROME_MAX_BYTES" \
      -v close_file="$FRAME_CLOSE_FILE" '
    BEGIN { started=0; ended=0; leading=1; chrome_lines=0; chrome_bytes=0; bail=0; pending_close=0 }
    {
      sub(/\r$/, "", $0)
      if (leading) {
        if ($0 ~ /^[[:space:]]*$/) { next }
        if ($0 == begin) { leading=0; started=1; next }
        if (index($0, "AUTOPILOT-AUTHOR") || index($0, "AUTOPILOT-END") || index($0, derived)) {
          bail=7; exit 7
        }
        echo_line = $0
        sub(/^[[:space:]]*>[[:space:]]?/, "", echo_line)
        sub(/^[[:space:]]+/, "", echo_line)
        if (echo_line ~ /^diff --git [^[:space:]]+ [^[:space:]]+$/ \
            || echo_line ~ /^@@ -[0-9]+(,[0-9]+)? \+[0-9]+(,[0-9]+)? @@/ \
            || echo_line ~ /^Diff under review:[[:space:]]*$/ \
            || echo_line ~ /^FINDINGS:[[:space:]]*one finding per line, or the single word none[[:space:]]*$/ \
            || echo_line ~ /^<one finding per line>[[:space:]]*$/) {
          bail=9; exit 9
        }
        chrome_lines += 1
        chrome_bytes += length($0) + 1
        if (chrome_lines > chrome_max_lines || chrome_bytes > chrome_max_bytes) { bail=8; exit 8 }
        next
      }
      if (!started) { next }
      if ($0 == begin) {
        if (ended || pending_close) { bail=3; exit 3 }
        pending_close=1
        next
      }
      if (pending_close) {
        if ($0 !~ /^[[:space:]]*$/) { bail=3; exit 3 }
        next
      }
      if (ended) {
        if ($0 !~ /^[[:space:]]*$/) {
          bail=6; exit 6
        }
        next
      }
      if ($0 == end) {
        ended=1
        next
      }
      print $0
    }
    END {
      if (bail) { exit bail }
      if (!started) { exit 2 }
      if (pending_close) { ended=1 }
      if (!ended) { exit 5 }
      if (close_file != "") {
        print (pending_close ? "begin-marker" : "end-marker") > close_file
      }
    }
  ' "$PARSE_INPUT" > "$AUTHOR_BLOCK_FILE" || PARSE_RC=$?
  rm -f "$FRAME_CLOSE_FILE"
  if [ "$PARSE_RC" -ne 0 ]; then
    case "$PARSE_RC" in
      5) emit_result "truncated" "$RAW_LOG" "end_missing" 5 ;;
      2|7)
        # Both derived markers are present in the model output but no line IS the opening
        # marker: the model emitted the frame, just not on separate lines (e.g. the whole
        # `BEGIN<payload>END` on one line). Name it instead of folding it into frame_missing.
        # Still truncated/5 — the author path never accepts it. frame_derived is the run's
        # marker id (visible in the model's own output; not a secret) so a caller with a
        # stricter, caller-specific contract (the readiness probe) can verify the nonce.
        if grep -qF -- "$BEGIN" "$AUTHOR_PARSE_FILE" && grep -qF -- "$END" "$AUTHOR_PARSE_FILE"; then
          emit_result "truncated" "$RAW_LOG" "frame_format" 5 ", \"frame_derived\": \"${DERIVED}\""
        fi
        emit_result "truncated" "$RAW_LOG" "frame_missing" 5 ;;
      *) emit_result "truncated" "$RAW_LOG" "frame_missing" 5 ;;
    esac
  fi
  if awk '
    BEGIN { found = 0 }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ /^```[[:space:]]*(tool|tool_call|function_call)([[:space:]]|$)/) found = 1
      if (index(line, "<tool_call>")) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$AUTHOR_BLOCK_FILE"; then
    emit_result "truncated" "$RAW_LOG" "tool_narration" 5
  fi
  cat "$AUTHOR_BLOCK_FILE" > "$RAW_LOG"
fi

# Codex hardened content checks — unconditional once stdout is non-empty.
# Remove the has-chrome-frame bypass: missing chrome is runner_failed, same as
# witness or session-id failure. No normalization / fallback / recovery path.
if [[ "$CODEX_TRANSPORT" -eq 1 ]]; then
  if ! codex_transport_has_chrome_frame "$CODEX_STDERR"; then
    emit_result "runner_failed" "$RAW_LOG" "codex transport chrome frame missing" 3 ", \"transport_status\": \"exit_failure\""
  fi
  if ! codex_transport_verify_witness "$CODEX_STDOUT" "$CODEX_SIDECAR"; then
    emit_result "runner_failed" "$RAW_LOG" "codex transport witness verification failed" 3 ", \"transport_status\": \"exit_failure\""
  fi
  if ! CODEX_SESSION_ID="$(codex_transport_extract_session_id "$CODEX_STDERR")"; then
    CODEX_SESSION_ID=""
    emit_result "runner_failed" "$RAW_LOG" "codex transport session id extraction failed" 3 ", \"transport_status\": \"exit_failure\""
  fi
fi

AUTHOR_EXTRA="$(strict_result_fields "clean")"
if [[ "$CODEX_TRANSPORT" -eq 1 && -n "$CODEX_SESSION_ID" ]]; then
  AUTHOR_EXTRA="${AUTHOR_EXTRA}, \"session_id\": \"$(json_escape "$CODEX_SESSION_ID")\""
fi
emit_result "authored" "$RAW_LOG" "null" 0 "$AUTHOR_EXTRA"
