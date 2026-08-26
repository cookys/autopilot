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
EFFORT=""
ENDPOINT=""
ENDPOINT_SET=0

usage() {
  cat <<EOF
Usage:
  scripts/probe-engine-capability.sh quota --runner <runner> --model <model> \\
    [--effort <effort>] [--endpoint <name|@none>] [--safe] [--live-spend] \\
    [--store <path>] [--now <ISO>] [--role <role>]

Options:
  --runner <r>       Specify runner name (e.g. codex, agy, grok, qoderclicn, cursor, cc-shim).
  --model <m>        Specify model name.
  --effort <e>       Exact effort partition written into the capability row.
  --endpoint <v>     Exact endpoint wallet name, or @none for explicit endpoint:null.
  --safe             Safe mode (default), no paid model prompt.
  --live-spend       Live spend mode, send a tiny prompt to verify quota.
  --store <path>     Override capability store.
  --now <ISO>        Override current timestamp for deterministic tests.
  --role <role>      Override role (default: reviewer).
  -h, --help         Show this help text.

Notes:
  Live probing writes the same exact runner/model/effort/endpoint identity that
  strict dispatch admission reads. Omit --effort/--endpoint only for legacy
  telemetry rows; those cannot authorize exact-tuple dispatch.
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
    --effort)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --effort requires a value" >&2
        exit 2
      fi
      EFFORT="$2"
      shift 2
      ;;
    --endpoint)
      if [ $# -lt 2 ]; then
        echo "ERROR: option --endpoint requires a value" >&2
        exit 2
      fi
      ENDPOINT="$2"
      ENDPOINT_SET=1
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
  qoderclicn)
    if command -v qoderclicn >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(qoderclicn --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  cursor)
    # The binary is cursor-agent, NOT cursor — a name-derived fallthrough would
    # probe the wrong command entirely.
    if command -v cursor-agent >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(cursor-agent --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  cc-shim)
    if command -v claude >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(claude --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  claude-native)
    # Drives the local Claude Code CLI with its own ambient auth. The dispatcher resolves
    # `command -v "${BIN:-claude}"`; this probe has no --bin input, so BIN is always unset
    # here and the two resolutions are identical. Matches the cc-shim branch below, which
    # invokes `claude` the same way. (If probe ever gains --bin, mirror it in BOTH places.)
    if command -v claude >/dev/null 2>&1; then
      BINARY_FOUND=1
      RUNNER_VERSION="$(claude --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  kimi)
    # Kimi Code CLI is routinely NOT on bare PATH. Mirror dispatch-review.sh's
    # resolution order exactly (PATH, then the well-known install path) — a probe
    # that resolves the binary differently from the dispatcher would report on a
    # different tool than the one dispatch actually runs.
    if command -v kimi >/dev/null 2>&1; then
      KIMI_BIN="$(command -v kimi)"
    elif [ -x "$HOME/.kimi-code/bin/kimi" ]; then
      KIMI_BIN="$HOME/.kimi-code/bin/kimi"
    else
      KIMI_BIN=""
    fi
    if [ -n "$KIMI_BIN" ]; then
      BINARY_FOUND=1
      RUNNER_VERSION="$("$KIMI_BIN" --version 2>&1 | head -n 1 || echo "unknown")"
    fi
    ;;
  anthropic-compatible)
    # NOT a binary runner: dispatch-review.sh drives dispatch-anthropic-review.js
    # over HTTP. Its real preconditions are `node` plus that script, so those are
    # what presence means here. `command -v anthropic-compatible` can never
    # succeed, and the generic branch below made this runner permanently unknown.
    if command -v node >/dev/null 2>&1 && [ -r "$SELF_DIR/dispatch-anthropic-review.js" ]; then
      BINARY_FOUND=1
      RUNNER_VERSION="node $(node --version 2>&1 | head -n 1 || echo "unknown")"
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

  # Exact-tuple live observation: when --effort/--endpoint are supplied, the
  # runner command must apply them. Never stamp an unobserved exact identity as
  # available. Unsupported exact tuples emit non-authorizing unknown telemetry.
  EXACT_TUPLE=0
  SKIP_LIVE_CMD=0
  if [ -n "$EFFORT" ] || [ "$ENDPOINT_SET" -eq 1 ]; then
    EXACT_TUPLE=1
  fi
  # Exact tuple partitions authorize dispatch only when this runner actually
  # consumes the requested dimension.  Named endpoints are a verified
  # cc-shim/anthropic-compatible transport; exporting ANTHROPIC_* around
  # Codex/Grok/Qoder does not observe their endpoint tuple.
  #
  # Effort: only codex / grok / qoderclicn consume it — verified by reading the
  # dispatcher, not by assumption (dispatch-review.sh: codex `-c
  # model_reasoning_effort`, grok `--reasoning-effort`, qoderclicn
  # `--reasoning-effort`; agy/cc-shim/anthropic-compatible/claude-native/kimi
  # never receive it, and dispatch-anthropic-review.js has no effort parameter
  # at all).  An effort-bearing tuple on a non-consuming runner is unobserved,
  # so it must stay non-authorizing rather than be stamped available.
  case "$RUNNER" in
    cc-shim|anthropic-compatible) _ENDPOINT_CONSUMER=1 ;;
    *)                            _ENDPOINT_CONSUMER=0 ;;
  esac
  case "$RUNNER" in
    codex|grok|qoderclicn) _EFFORT_CONSUMER=1 ;;
    *)                     _EFFORT_CONSUMER=0 ;;
  esac
  if [ "$ENDPOINT_SET" -eq 1 ] && [ "$ENDPOINT" != "@none" ] \
      && [ "$_ENDPOINT_CONSUMER" -eq 0 ]; then
    PROBE_EXIT=1
    SKIP_LIVE_CMD=1
    echo "runner $RUNNER does not consume named endpoint tuples" >"$PROBE_ERR_FILE"
  fi
  if [ -n "$EFFORT" ] && [ "$_EFFORT_CONSUMER" -eq 0 ] && [ "$RUNNER" != "agy" ]; then
    PROBE_EXIT=1
    SKIP_LIVE_CMD=1
    echo "runner $RUNNER has no verified exact effort control" >"$PROBE_ERR_FILE"
  fi
  # shellcheck source=lib/grok-effort.sh
  . "$SELF_DIR/lib/grok-effort.sh" 2>/dev/null || true
  # Resolve named endpoint via the canonical endpoint mechanism (never invent env).
  if [ "$SKIP_LIVE_CMD" -eq 0 ] \
      && [ "$ENDPOINT_SET" -eq 1 ] && [ "$ENDPOINT" != "@none" ]; then
    if [ -r "$SELF_DIR/load-endpoints-env.sh" ]; then
      # shellcheck source=load-endpoints-env.sh
      . "$SELF_DIR/load-endpoints-env.sh" && autopilot_load_endpoints_env || true
    fi
    if [ ! -r "$SELF_DIR/resolve-endpoint.sh" ]; then
      PROBE_EXIT=1
      SKIP_LIVE_CMD=1
      echo "Named endpoint resolution unavailable; cannot probe exact endpoint tuple" >"$PROBE_ERR_FILE"
    else
      _ep_json="$("$SELF_DIR/resolve-endpoint.sh" "$ENDPOINT" 2>/dev/null)" || _ep_json=""
      if [ -z "$_ep_json" ]; then
        PROBE_EXIT=1
        SKIP_LIVE_CMD=1
        echo "Endpoint '$ENDPOINT' not ready" >"$PROBE_ERR_FILE"
      else
        _ep_url="$(printf '%s' "$_ep_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.base_url||"");}catch(_e){}})')"
        _ep_tokenv="$(printf '%s' "$_ep_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.token_env||"");}catch(_e){}})')"
        if [ -n "$_ep_url" ]; then
          export ANTHROPIC_BASE_URL="$_ep_url"
        fi
        if [ -n "$_ep_tokenv" ]; then
          # Indirect env expand for the resolved token variable name.
          eval "_ep_token_val=\"\${$_ep_tokenv:-}\""
          if [ -n "$_ep_token_val" ]; then
            export ANTHROPIC_AUTH_TOKEN="$_ep_token_val"
          fi
        fi
      fi
    fi
  fi

  if [ "$SKIP_LIVE_CMD" -eq 0 ]; then

  case "$RUNNER" in
    codex)
      # codex accepts model_reasoning_effort via -c; exact effort when supplied.
      if [ -n "$EFFORT" ]; then
        # ⛔ --skip-git-repo-check：PROBE_CWD 是 mktemp -d，不是 git repo。
        #    少了它 codex 直接拒跑（rc=1、stdout 0 bytes、"Not inside a trusted
        #    directory"），探測會把「環境沒設好」誤報成「這個引擎不能用」。
        #    2026-08-10 實測：無旗標 rc=1/0 bytes；加旗標 rc=0/輸出 probe。
        ( cd "$PROBE_CWD" && codex exec --model "$MODEL" -c "model_reasoning_effort=\"$EFFORT\"" --sandbox read-only --skip-git-repo-check "reply with the single word: probe" ) >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      else
        ( cd "$PROBE_CWD" && codex exec --model "$MODEL" --sandbox read-only --skip-git-repo-check "reply with the single word: probe" ) >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      fi
      ;;
    agy)
      # NO --dangerously-skip-permissions (that would let it run tools / mutate files).
      # Exact effort requests stay non-authorizing — but NOT because the flag is absent.
      # Probe-verified 2026-08-20 (agy 1.1.16), three different model families:
      #   --effort low|medium|high  → "--effort is not supported for <model>"  (level valid,
      #                                model refuses it)
      #   --effort xhigh|max|bogus  → "invalid --effort \"xhigh\""              (level absent
      #                                from the enum entirely)
      # Every model in agy's roster carries its effort IN THE MODEL NAME
      # ("Gemini 3.7 Flash (High)", "GPT-OSS 120B (Medium)", "Claude Sonnet 4.6 (Thinking)"),
      # and each one rejects a separate --effort. Reproduce:
      #   for e in low medium high xhigh max bogus_level; do \
      #     agy -p ok --model "Gemini 3.7 Flash (High)" --effort "$e"; done
      # ⇒ the effort partition for agy lives in $MODEL, not in a flag. If agy ever ships a
      #   model that DOES accept --effort, this branch must pass it through rather than
      #   refuse — re-probe before assuming either way.
      if [ -n "$EFFORT" ]; then
        PROBE_EXIT=1
        echo "agy cannot probe exact effort tuple; emit non-authorizing telemetry" >"$PROBE_ERR_FILE"
      else
        ( cd "$PROBE_CWD" && agy -p "Respond only with OK" --model "$MODEL" ) >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      fi
      ;;
    grok)
      # scratch --cwd (never the repo), NO --always-approve (cannot auto-run/edit), no web search.
      # Apply verified --reasoning-effort when exact effort is requested.
      if [ -n "$EFFORT" ] && type grok_effort_clamp >/dev/null 2>&1; then
        _ge="$(grok_effort_clamp "$EFFORT")"
        grok -p "Respond only with OK" --model "$MODEL" --cwd "$PROBE_CWD" \
          --reasoning-effort "$_ge" --no-alt-screen --disable-web-search \
          >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      else
        grok -p "Respond only with OK" --model "$MODEL" --cwd "$PROBE_CWD" --no-alt-screen --disable-web-search >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      fi
      ;;
    qoderclicn)
      # scratch --cwd (never the repo), no session persistence, and tools disabled:
      # a quota probe needs only a text reply and must not mutate files.
      if [ -n "$EFFORT" ]; then
        printf 'Respond only with OK' | qoderclicn -p --cwd "$PROBE_CWD" --model "$MODEL" \
          --reasoning-effort "$EFFORT" \
          --permission-mode dont_ask --tools "" --no-session-persistence --output-format text \
          >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      else
        printf 'Respond only with OK' | qoderclicn -p --cwd "$PROBE_CWD" --model "$MODEL" \
          --permission-mode dont_ask --tools "" --no-session-persistence --output-format text \
          >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      fi
      ;;
    cursor)
      # scratch --cwd (never the repo). --trust is required or the run aborts on
      # workspace trust. No --reasoning-effort: cursor-agent has no such flag —
      # effort lives in the model-id suffix, so an effort-bearing tuple never
      # reaches this branch (see the _EFFORT_CONSUMER gate above; cursor is
      # deliberately NOT in that list).
      printf 'Respond only with OK' | cursor-agent -p --cwd "$PROBE_CWD" --model "$MODEL" \
        --trust --mode ask --output-format text \
        >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    cc-shim)
      # cc-shim doesn't run without env, but if it runs, send a minimal prompt.
      # Named endpoint resolution above exports ANTHROPIC_* when --endpoint is set.
      if [ "$ENDPOINT_SET" -eq 1 ] && [ "$ENDPOINT" != "@none" ] && [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
        PROBE_EXIT=1
        echo "cc-shim exact endpoint unobserved: ANTHROPIC_BASE_URL unset after resolve" >"$PROBE_ERR_FILE"
      else
        env -u ANTHROPIC_API_KEY claude -p "Respond only with OK" --model "$MODEL" --tools "" >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      fi
      ;;
    claude-native)
      # Local Claude Code CLI on its own ambient auth — unlike cc-shim, no ANTHROPIC_*
      # override, so the ambient credential is exactly what dispatch would use.
      claude -p "Respond only with OK" --model "$MODEL" --tools "" \
        >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    kimi)
      # $KIMI_BIN resolved in the binary-presence case above (same order as the dispatcher).
      # -p is the non-interactive path; no --auto/--plan (they cannot combine with -p).
      ( cd "$PROBE_CWD" && "$KIMI_BIN" -m "$MODEL" -p "Respond only with OK" ) \
        >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      ;;
    anthropic-compatible)
      # HTTP transport, no CLI to spend through. The endpoint resolution above already
      # exported ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN; a minimal /v1/messages POST is
      # the smallest observation that proves this exact (endpoint, model) tuple is live.
      # Without credentials there is nothing to observe — stay non-authorizing, never
      # stamp available off the mere presence of node.
      if [ -z "${ANTHROPIC_BASE_URL:-}" ] || [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
        PROBE_EXIT=1
        echo "anthropic-compatible exact endpoint unobserved: ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN unset after resolve" >"$PROBE_ERR_FILE"
      else
        MODEL="$MODEL" node -e '
          const url = (process.env.ANTHROPIC_BASE_URL || "").replace(/\/+$/, "") + "/v1/messages";
          const body = JSON.stringify({ model: process.env.MODEL, max_tokens: 16,
            messages: [{ role: "user", content: "Respond only with OK" }] });
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 60000);
          fetch(url, { method: "POST", signal: ac.signal, body, headers: {
              "content-type": "application/json",
              "anthropic-version": "2023-06-01",
              "authorization": "Bearer " + process.env.ANTHROPIC_AUTH_TOKEN } })
            .then(async r => {
              clearTimeout(t);
              // BOUNDED read: r.text() would buffer whatever the remote chooses to send.
              // The peer here is the untrusted side of the probe, so read at most one small
              // chunk for diagnostics and drop the rest. Body never reaches the persisted
              // store (EVIDENCE keeps only the classification) and the operator-stderr path
              // runs it through the secret-redaction sed below first.
              let head = "";
              try {
                const reader = r.body && r.body.getReader ? r.body.getReader() : null;
                if (reader) {
                  const chunk = await reader.read();
                  if (!chunk.done && chunk.value) {
                    head = Buffer.from(chunk.value).toString("utf8").slice(0, 200);
                  }
                  await reader.cancel();
                }
              } catch { /* diagnostics only — never let the read decide the verdict */ }
              process.stderr.write("HTTP " + r.status + " " + head + "\n");
              process.exit(r.ok ? 0 : 1);
            })
            .catch(e => { clearTimeout(t); process.stderr.write(String(e && e.message) + "\n"); process.exit(1); });
        ' >"$PROBE_ERR_FILE" 2>&1 || PROBE_EXIT=$?
      fi
      ;;
    *)
      PROBE_EXIT=1
      echo "No live spend method defined for runner $RUNNER" >"$PROBE_ERR_FILE" 2>&1
      ;;
  esac
  fi # SKIP_LIVE_CMD
  rm -rf "$PROBE_CWD"

  if [ "$PROBE_EXIT" -eq 0 ]; then
    STATUS="available"
    CONFIDENCE="high"
    EVIDENCE="Live spend probe succeeded"
  else
    # Exact-tuple failure: never stamp available for an unobserved identity.
    if [ "$EXACT_TUPLE" -eq 1 ]; then
      STATUS="unknown"
      CONFIDENCE="low"
      EVIDENCE="exact runner/model/effort/endpoint tuple unobserved (non-authorizing)"
      CLASSIFICATION="exact_tuple_unobserved"
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
    fi # EXACT_TUPLE
  fi
  rm -f "$PROBE_ERR_FILE"
fi

# Build event JSON
RECORD_ARGS=()
if [ -n "$STORE" ]; then
  RECORD_ARGS+=(--store "$STORE")
fi

# Construct JSON payload using node to ensure values are safely escaped.
# When --effort / --endpoint are supplied, write the exact-tuple partition that
# strict admission reads; omit those fields only for legacy telemetry rows.
JSON_PAYLOAD="$(NOW_ISO="$NOW_ISO" RUNNER="$RUNNER" MODEL="$MODEL" ROLE="$ROLE" \
  RUNNER_VERSION="$RUNNER_VERSION" STATUS="$STATUS" CONFIDENCE="$CONFIDENCE" \
  EVIDENCE="$EVIDENCE" EFFORT="$EFFORT" ENDPOINT="$ENDPOINT" ENDPOINT_SET="$ENDPOINT_SET" \
  node -e '
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
  if (p.EFFORT && p.EFFORT.length > 0) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(p.EFFORT)) {
      process.stderr.write("ERROR: --effort must be a bounded classification code\n");
      process.exit(2);
    }
    payload.effort = p.EFFORT;
  }
  if (p.ENDPOINT_SET === "1") {
    if (p.ENDPOINT === "@none") {
      payload.endpoint = null;
    } else if (/^[A-Za-z0-9_]{1,128}$/.test(p.ENDPOINT || "")) {
      payload.endpoint = p.ENDPOINT;
    } else {
      process.stderr.write("ERROR: --endpoint must be a canonical name or @none\n");
      process.exit(2);
    }
  }
  console.log(JSON.stringify(payload));
')"

# Record the event to store
echo "$JSON_PAYLOAD" | node "$STATE_CLI" record "${RECORD_ARGS[@]}"

# Exit with 0
exit 0
