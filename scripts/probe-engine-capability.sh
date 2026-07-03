#!/usr/bin/env bash
# probe-engine-capability.sh — safe manual probe wrapper for runner status

set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
STATE_CLI="$SELF_DIR/engine-capability-state.js"

RUNNER=""
MODEL=""
SAFE=1
LIVE_SPEND=0
STORE=""
NOW=""
ROLE="reviewer"

usage() {
  cat <<EOF
Usage:
  scripts/probe-engine-capability.sh quota --runner <runner> --model <model> [--safe] [--live-spend] [--store <path>] [--now <ISO>]

Options:
  --runner <r>       Specify runner name (e.g. codex, agy, grok, cc-shim).
  --model <m>        Specify model name.
  --safe             Safe mode (default), no paid model prompt.
  --live-spend       Live spend mode, send a tiny prompt to verify quota.
  --store <path>     Override capability store.
  --now <ISO>        Override current timestamp for deterministic tests.
  --role <role>      Override role (default: reviewer).
  -h, --help         Show this help text.
EOF
}

# Parse options
if [ $# -eq 0 ]; then
  usage
  exit 2
fi

# The subcommand must be 'quota' per the acceptance check
SUBCOMMAND="$1"
if [ "$SUBCOMMAND" = "--help" ] || [ "$SUBCOMMAND" = "-h" ] || [ "$SUBCOMMAND" = "help" ]; then
  usage
  exit 0
fi

if [ "$SUBCOMMAND" != "quota" ]; then
  echo "ERROR: unknown subcommand '$SUBCOMMAND', only 'quota' is supported" >&2
  usage
  exit 2
fi

shift

while [ $# -gt 0 ]; do
  case "$1" in
    --runner)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --runner requires a value" >&2
        exit 2
      fi
      RUNNER="$2"
      shift 2
      ;;
    --model)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --model requires a value" >&2
        exit 2
      fi
      MODEL="$2"
      shift 2
      ;;
    --safe)
      SAFE=1
      LIVE_SPEND=0
      shift
      ;;
    --live-spend)
      LIVE_SPEND=1
      SAFE=0
      shift
      ;;
    --store)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --store requires a value" >&2
        exit 2
      fi
      STORE="$2"
      shift 2
      ;;
    --now)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --now requires a value" >&2
        exit 2
      fi
      NOW="$2"
      shift 2
      ;;
    --role)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --role requires a value" >&2
        exit 2
      fi
      ROLE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ -z "$RUNNER" ]; then
  echo "ERROR: --runner is required" >&2
  exit 2
fi

if [ -z "$MODEL" ]; then
  echo "ERROR: --model is required" >&2
  exit 2
fi

# Determine current timestamp
if [ -z "$NOW" ]; then
  NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
else
  NOW_ISO="$NOW"
fi

# Safe mode checks
STATUS="unknown"
CONFIDENCE="low"
EVIDENCE=""
RUNNER_VERSION="unknown"

# 1. Binary presence check
BINARY_FOUND=0
case "$RUNNER" in
  codex)
    if command -v codex >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(codex --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  agy)
    if command -v agy >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(agy --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  grok)
    if command -v grok >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(grok --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  cc-shim)
    if command -v claude >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(claude --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  *)
    # Custom/other runner
    if command -v "$RUNNER" >/dev/null 2>&1; then
      BINARY_FOUND=1
    fi
    ;;
esac

if [ "$BINARY_FOUND" -eq 0 ]; then
  STATUS="unknown"
  CONFIDENCE="low"
  EVIDENCE="Binary for runner $RUNNER not found"
else
  EVIDENCE="Binary $RUNNER verified in PATH"
  # medium: binary present is a real (if weak) availability signal. A no-signal
  # `unknown` never overrides a known status regardless of confidence (see
  # mergeCurrentState J1 guard), so this stays medium to match the probe contract.
  CONFIDENCE="medium"
fi

# 2. Check if we should execute live spend
if [ "$LIVE_SPEND" -eq 1 ] && [ "$BINARY_FOUND" -eq 1 ]; then
  PROBE_ERR_FILE="$(mktemp)"
  PROBE_EXIT=0
  # A quota probe only needs the API to reply — it must never run tools or mutate the
  # caller's repo. Run every runner READ-ONLY in a scratch cwd, WITHOUT any auto-approve /
  # skip-permissions flag (a text-only "reply OK" needs no tools; headless -p has no TTY so
  # a denied tool auto-denies). Only the exit code matters here (quota detection). (gpt-5.5 R6.)
  PROBE_CWD="$(mktemp -d)"
  # Clean up scratch state even if the probed runner times out or the script is
  # interrupted (SIGINT/SIGTERM) — otherwise PROBE_CWD/PROBE_ERR_FILE leak, accumulating
  # scratch dirs and possibly-sensitive runner output (gpt-5.5 R7). The explicit rm's on
  # the normal path below stay (idempotent); this trap covers the abnormal-exit paths.
  trap 'rm -rf "${PROBE_CWD:-}" 2>/dev/null; rm -f "${PROBE_ERR_FILE:-}" 2>/dev/null' EXIT INT TERM

  case "$RUNNER" in
    codex)
      ( cd "$PROBE_CWD" && codex exec --model "$MODEL" --sandbox read-only "reply with the single word: probe" ) >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    agy)
      # NO --dangerously-skip-permissions (that would let it run tools / mutate files).
      ( cd "$PROBE_CWD" && agy -p "Respond only with OK" --model "$MODEL" ) >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    grok)
      # scratch --cwd (never the repo), NO --always-approve (cannot auto-run/edit), no web search.
      grok -p "Respond only with OK" --model "$MODEL" --cwd "$PROBE_CWD" --no-alt-screen --disable-web-search >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    cc-shim)
      # cc-shim doesn't run without env, but if it runs, send a minimal prompt
      env -u ANTHROPIC_API_KEY claude -p "Respond only with OK" --model "$MODEL" --tools "" >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    *)
      PROBE_EXIT=1
      echo "No live spend method defined for runner $RUNNER" >"$PROBE_ERR_FILE" 2>&1
      ;;
  esac
  rm -rf "$PROBE_CWD"

  if [ "$PROBE_EXIT" -eq 0 ]; then
    STATUS="available"
    CONFIDENCE="high"
    EVIDENCE="Live spend probe succeeded"
  else
    # Classify error. classify-error reads the file directly, so it retains full context.
    CLASSIFICATION="$(node "$STATE_CLI" classify-error --file "$PROBE_ERR_FILE" --exit-code "$PROBE_EXIT")"
    # Do NOT persist raw runner stderr/stdout as evidence: on auth failures it can contain API
    # keys, tokens, or Authorization headers that would land in the on-disk capability store and
    # in reports. Record only the non-secret classification + exit code; surface the raw
    # diagnostic to the operator on THIS script's stderr — live-spend is operator-gated, so the
    # operator sees it live but it is never written to the store. (gpt-5.5 P6 F6)
    EVIDENCE="Live spend probe failed (exit $PROBE_EXIT; classified: $CLASSIFICATION)"
    # Surface the raw diagnostic to the operator on stderr (never persisted), but redact common
    # secret shapes first — stderr can be captured by CI/operator logs, so defense-in-depth beats
    # trusting the runner not to echo an API key/token/Authorization header. (gpt-5.5 P6 F6 r2)
    printf 'probe-engine-capability: live-spend runner failure (exit %s, %s). Redacted diagnostic below is NOT persisted:\n' "$PROBE_EXIT" "$CLASSIFICATION" >&2
    # Case classes are spelled out as bracket expressions (NOT the GNU-only `I` flag) so the
    # redaction is fully case-insensitive AND portable to BSD sed (macOS operators). The
    # Authorization/Proxy-Authorization rules redact the REST of the line (covers `Basic <b64>`,
    # any scheme); scheme/prefix tokens and key=value pairs are redacted regardless of length;
    # a length-20 base64/hex fallback catches anything else. (gpt-5.5 P6 F6 r3)
    sed -E \
      -e 's/(([Pp][Rr][Oo][Xx][Yy]-)?[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn])([":= ]+).*/\1\3[REDACTED]/g' \
      -e 's/([Bb][Ee][Aa][Rr][Ee][Rr]|[Bb][Aa][Ss][Ii][Cc]|sk|pk|xai|gsk|ghp|ghs|glpat|xoxb|xoxp)[-_ ]?[A-Za-z0-9._+\/=-]{4,}/[REDACTED-TOKEN]/g' \
      -e 's/([Aa][Pp][Ii][-_ ]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd])([":= ]+)[^[:space:]"]+/\1\2[REDACTED]/g' \
      -e 's/[A-Za-z0-9+/_-]{20,}/[REDACTED-LONG]/g' \
      "$PROBE_ERR_FILE" >&2

    case "$CLASSIFICATION" in
      quota_exhausted)
        STATUS="exhausted"
        CONFIDENCE="high"
        ;;
      rate_limited)
        STATUS="limited"
        CONFIDENCE="medium"
        ;;
      overloaded)
        STATUS="unknown"
        CONFIDENCE="low"
        ;;
      auth_failed)
        STATUS="unknown"
        CONFIDENCE="low"
        ;;
      network_failed)
        STATUS="unknown"
        CONFIDENCE="low"
        ;;
      *)
        STATUS="unknown"
        CONFIDENCE="low"
        ;;
    esac
  fi
  rm -f "$PROBE_ERR_FILE"
fi

# Build event JSON
RECORD_ARGS=()
if [ -n "$STORE" ]; then
  RECORD_ARGS+=(--store "$STORE")
fi

# Construct JSON payload using node to ensure values are safely escaped
JSON_PAYLOAD="$(NOW_ISO="$NOW_ISO" RUNNER="$RUNNER" MODEL="$MODEL" ROLE="$ROLE" RUNNER_VERSION="$RUNNER_VERSION" STATUS="$STATUS" CONFIDENCE="$CONFIDENCE" EVIDENCE="$EVIDENCE" node -e '
  const p = process.env;
  const payload = {
    schema_version: 1,
    observed_at: p.NOW_ISO,
    runner: p.RUNNER,
    model: p.MODEL,
    role: p.ROLE,
    runner_version: p.RUNNER_VERSION === "unknown" ? null : p.RUNNER_VERSION,
    capability: {
      quota: {
        status: p.STATUS,
        reset_at: null,
        confidence: p.CONFIDENCE,
        evidence: p.EVIDENCE || null,
        ttl_seconds: 3600
      }
    }
  };
  console.log(JSON.stringify(payload));
')"

# Record the event to store
echo "$JSON_PAYLOAD" | node "$STATE_CLI" record "${RECORD_ARGS[@]}"

# Exit with 0
exit 0
