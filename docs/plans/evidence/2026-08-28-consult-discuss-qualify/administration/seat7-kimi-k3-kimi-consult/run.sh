#!/usr/bin/env bash
# run.sh — Seat 7: kimi-code/k3 / kimi CLI — consult role administration.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)". Seat 7 (kimi) was listed
#   there as Board-deferred for quota; this script assembles the argv now
#   that quota is confirmed back (`kimi -m kimi-code/k3 -p ...` probe returned
#   PONG cleanly, 2026-08-29). Free `plan` dry-run by default; `execute` is
#   real, paid, and requires the literal CLI argument below.
#
# kimi takes NO --effort flag (thinking is a boolean in config.toml, not an
# argv parameter — see qualification-review-provider.js's callCli() `kind ===
# 'kimi'` branch and its header note). QRP_CLI_EFFORT is deliberately not set
# here; EFFORT below is a receipt-only identity classification ("high", to
# match the other consult seats' calibrated tier), not an enforced transport
# parameter — same posture as seat 3's "default"/seat 6's "baked-in-model-name".
#
# QRP_CLI_HOME: kimi keeps credentials under $HOME/.kimi-code (config.toml +
# credentials/ + oauth/ + device_id) and exposes no config-dir env var of its
# own (per qualification-review-provider.js's QRP_CLI_HOME header note: "Same
# posture as CODEX_HOME / KIMI_CODE_HOME"). The broker forces HOME to a fresh
# provider-owned dir per case, so without this every case would hit
# "Authentication required" and the exam would grade a transport failure as a
# model failure. This script stages a CREDENTIAL-ONLY exam home (config.toml,
# credentials/, oauth/, device_id — a few KB, well under the adapter's 8 MB
# QRP_CLI_HOME template cap) under $HOME/.autopilot/qualify-staging/ —
# OUTSIDE the repo, so no credential material is ever written into
# git-tracked evidence. NOT the full ~/.kimi-code (≈90 MB of cache/sessions/
# logs) — that would blow the 8 MB cap and copy far more than credentials.
#
# READY for --plan (verified below). --execute readiness: kimi CLI present
# (`kimi --version` → 0.39.1), quota confirmed back via a live PONG probe
# just prior to this script's authoring, staged credential-only exam home
# seeded from the real ~/.kimi-code.
#
# Usage:
#   ./run.sh            # = ./run.sh plan   (free)
#   ./run.sh plan        # free dry-run smoke
#   ./run.sh execute      # REAL PAID administration (Board go-ahead only)

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/scripts/engine-qualify.js" ] \
  || { echo "run.sh: could not resolve repo root from $SELF_DIR" >&2; exit 2; }

MODE="${1:-plan}"
case "$MODE" in
  plan|execute) ;;
  *) echo "run.sh: usage: $0 [plan|execute]" >&2; exit 2 ;;
esac

# --- identity (operator-asserted; kimi CLI transport reports no runtime model id) ---
ENGINE="kimi-code-k3"           # --engine is a strict TOKEN (no slashes) — the
                                  # exact vendor model id lives in --model below.
MODEL="kimi-code/k3"
MODEL_VERSION="kimi-code-k3"     # --model-version is a strict TOKEN (no `/` allowed
                                  # — engine-qualify.js's TOKEN regex), so this is the
                                  # slash-free form of the model id. operator-asserted:
                                  # the kimi CLI reports no build id distinct from the
                                  # model id itself (`kimi --version` reports only the
                                  # CLI's own version, captured live below as
                                  # RUNNER_VERSION).
RUNNER="kimi"
FAMILY="moonshot"                # src/readiness/status.js:38 — /(kimi|moonshot)/ -> 'moonshot'
EFFORT="high"                    # receipt-only classification (see header note);
                                  # not forwarded to the CLI — matches the other
                                  # consult seats' calibrated tier.

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner kimi --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: kimi --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
# Same corpus-v6 consult identity every consult seat in this bundle shares — the
# exam assets are identical across engines; only engine/runner/model identity
# differs per seat. Do NOT invent new hashes.
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="d6c560be45e9cdda0aaef54aab48f9f32cb910d33b4c1514ab940435574b93d8"
HARNESS_VERSION="qrp:d6c560be"

# --- dedicated exam kimi home, credential files only (see header note) ---
STAGING_ROOT="$HOME/.autopilot/qualify-staging/seat7-kimi-k3-kimi-consult"
STAGING_HOME="$STAGING_ROOT/kimi-home"
STAGING_KIMI_DIR="$STAGING_HOME/.kimi-code"
mkdir -p "$STAGING_KIMI_DIR/credentials" "$STAGING_KIMI_DIR/oauth"
chmod 700 "$STAGING_ROOT" "$STAGING_HOME" "$STAGING_KIMI_DIR" \
  "$STAGING_KIMI_DIR/credentials" "$STAGING_KIMI_DIR/oauth" 2>/dev/null || true
REAL_KIMI_DIR="$HOME/.kimi-code"
for f in config.toml device_id; do
  if [ ! -f "$STAGING_KIMI_DIR/$f" ] && [ -f "$REAL_KIMI_DIR/$f" ]; then
    cp "$REAL_KIMI_DIR/$f" "$STAGING_KIMI_DIR/$f"
    chmod 600 "$STAGING_KIMI_DIR/$f"
  fi
done
if [ ! -f "$STAGING_KIMI_DIR/credentials/kimi-code.json" ] && [ -f "$REAL_KIMI_DIR/credentials/kimi-code.json" ]; then
  cp "$REAL_KIMI_DIR/credentials/kimi-code.json" "$STAGING_KIMI_DIR/credentials/kimi-code.json"
  chmod 600 "$STAGING_KIMI_DIR/credentials/kimi-code.json"
fi
if [ ! -f "$STAGING_KIMI_DIR/oauth/kimi-code" ] && [ -f "$REAL_KIMI_DIR/oauth/kimi-code" ]; then
  cp "$REAL_KIMI_DIR/oauth/kimi-code" "$STAGING_KIMI_DIR/oauth/kimi-code"
  chmod 600 "$STAGING_KIMI_DIR/oauth/kimi-code"
fi
if [ ! -f "$STAGING_KIMI_DIR/credentials/kimi-code.json" ]; then
  echo "run.sh: no credentials/kimi-code.json seeded into $STAGING_KIMI_DIR — --execute will likely fail to authenticate" >&2
fi
# Guard the template size against the adapter's 8 MB cap (see QRP header) —
# never let this silently point at a real, huge home (~90 MB observed for
# the real ~/.kimi-code with cache/sessions/logs included).
STAGING_BYTES="$(du -sk "$STAGING_HOME" 2>/dev/null | awk '{print $1*1024}')"
if [ -n "$STAGING_BYTES" ] && [ "$STAGING_BYTES" -gt $((8*1024*1024)) ]; then
  echo "run.sh: staged kimi home is ${STAGING_BYTES} bytes, over the 8MB QRP_CLI_HOME cap — re-seed credential-only" >&2
  exit 2
fi
export QRP_CLI_HOME="$STAGING_HOME"

export QRP_TRANSPORT=cli
export QRP_CLI_KIND=kimi
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="moonshot"
export QRP_PROMPT_MODE=consult

RAW_DIR="$SELF_DIR/raw"
mkdir -p "$RAW_DIR"
STORE="$HOME/.autopilot/engine-scorecard/scorecard.jsonl"

ARGS=(
  "$REPO_ROOT/scripts/engine-qualify.js" consult
  --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION"
  --runner "$RUNNER" --runner-version "$RUNNER_VERSION" --family "$FAMILY"
  --harness-version "$HARNESS_VERSION" --effort "$EFFORT"
  --prompt-config-hash "$PROMPT_CONFIG_HASH"
  --semantic-fingerprint "$SEMANTIC_FINGERPRINT"
  --containment-fingerprint "$CONTAINMENT_FINGERPRINT"
  --remote-provider-cmd "node $REPO_ROOT/scripts/qualification-review-provider.js"
  --remote-provider moonshot
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_MODEL
  --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_CLI_HOME
  --remote-timeout-ms 300000
  --task-class consult --domain cross-cutting --language en --tool read_only
  --store "$STORE"
  --raw-dir "$RAW_DIR"
  --version-source operator-asserted
  --emit-row
)

if [ "$MODE" = "plan" ]; then
  node "${ARGS[@]}" --plan | tee "$SELF_DIR/plan-out.json"
  exit "${PIPESTATUS[0]}"
fi

exec node "${ARGS[@]}" --execute
