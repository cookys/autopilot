#!/usr/bin/env bash
# run.sh — Seat 6: Gemini 3.7 Flash (High) / agy — discuss role administration.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)". Free `plan` dry-run by
#   default; `execute` is real, paid, and requires the CLI flag below.
#
# agy takes NO --effort (every agy model bakes its tier into the model name —
# QRP_CLI_EFFORT is deliberately not set/forwarded here, per
# qualification-review-provider.js's header note, probed 2026-08-20 on agy
# 1.1.16: `--effort` is rejected for every model in its roster).
#
# QRP_CLI_HOME: agy reads $HOME/.gemini/antigravity-cli/ for credentials and
# the broker forces HOME to a fresh provider-owned dir per case, so without
# this every case would see "Authentication required". This script stages a
# CREDENTIAL-ONLY exam home (antigravity-oauth-token, installation_id,
# settings.json — a few KB, well under the adapter's 8 MB template cap) under
# $HOME/.autopilot/qualify-staging/ — OUTSIDE the repo, so no OAuth material
# is ever written into git-tracked evidence.
#
# READY. agy 1.1.22 present (matches the Board-cited version); model probed
# via `agy models` (2026-08-29): "Gemini 3.7 Flash (High)" -> gemini-3.7-flash-high.
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

# --- identity (operator-asserted; agy CLI transport reports no runtime model id) ---
ENGINE="gemini-3.7-flash-high"          # --engine is a strict TOKEN (no spaces/parens);
                                          # the vendor display id lives in --model below.
MODEL="Gemini 3.7 Flash (High)"          # exact vendor model id (MODEL_ID charset: letters,
                                          # digits, space . _ : ( ) / -)
MODEL_VERSION="gemini-3.7-flash-high-20260829"   # --model-version is also a strict TOKEN
RUNNER="agy"
FAMILY="google"
EFFORT="high"   # receipt-only classification, matching engine-scorecard.js's
                 # closed enum (none|low|medium|high|xhigh|max) — same pattern
                 # as kimi/grok. agy rejects --effort entirely; the CLI never
                 # sees this value (no QRP_CLI_EFFORT export below) — it only
                 # labels the tier already named in the model id above
                 # ("Gemini 3.7 Flash (High)"), it does not enforce it.

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner agy --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: agy --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="0203f714f9aca37c15c8ebff58f4d5802a0000ac4ad10e8ec2f7f11c55c9512f"
SEMANTIC_FINGERPRINT="30c32f0d21cf9c4ca9c7e5341217d6e643b3557f9fb019dce5f6a44f764cce08"
CONTAINMENT_FINGERPRINT="cdc4859912eb74352bf3f1d38a7c8e9e3d0c6769314e12e95aa3111983e37d62"
HARNESS_VERSION="qrp:cdc48599"

# --- dedicated exam agy home, credential files only (see header note) ---
STAGING_HOME="$HOME/.autopilot/qualify-staging/seat6-gemini-3.7-flash-high-agy-discuss/agy-home"
STAGING_AGY_DIR="$STAGING_HOME/.gemini/antigravity-cli"
mkdir -p "$STAGING_AGY_DIR"
chmod 700 "$STAGING_HOME" "$HOME/.autopilot/qualify-staging/seat6-gemini-3.7-flash-high-agy-discuss" 2>/dev/null || true
REAL_AGY_DIR="$HOME/.gemini/antigravity-cli"
for f in antigravity-oauth-token installation_id settings.json; do
  if [ ! -f "$STAGING_AGY_DIR/$f" ] && [ -f "$REAL_AGY_DIR/$f" ]; then
    cp "$REAL_AGY_DIR/$f" "$STAGING_AGY_DIR/$f"
  fi
done
if [ ! -f "$STAGING_AGY_DIR/antigravity-oauth-token" ]; then
  echo "run.sh: no antigravity-oauth-token seeded into $STAGING_AGY_DIR — --execute will fail to authenticate" >&2
fi
# Guard the template size against the adapter's 8 MB cap (see QRP header) —
# never let this silently point at a real, huge home.
STAGING_BYTES="$(du -sk "$STAGING_HOME" 2>/dev/null | awk '{print $1*1024}')"
if [ -n "$STAGING_BYTES" ] && [ "$STAGING_BYTES" -gt $((8*1024*1024)) ]; then
  echo "run.sh: staged agy home is ${STAGING_BYTES} bytes, over the 8MB QRP_CLI_HOME cap — re-seed credential-only" >&2
  exit 2
fi
export QRP_CLI_HOME="$STAGING_HOME"

export QRP_TRANSPORT=cli
export QRP_CLI_KIND=agy
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="agy-gemini"
export QRP_PROMPT_MODE=discuss

RAW_DIR="$SELF_DIR/raw"
mkdir -p "$RAW_DIR"
STORE="$HOME/.autopilot/engine-scorecard/scorecard.jsonl"

ARGS=(
  "$REPO_ROOT/scripts/engine-qualify.js" discuss
  --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION"
  --runner "$RUNNER" --runner-version "$RUNNER_VERSION" --family "$FAMILY"
  --harness-version "$HARNESS_VERSION" --effort "$EFFORT"
  --prompt-config-hash "$PROMPT_CONFIG_HASH"
  --semantic-fingerprint "$SEMANTIC_FINGERPRINT"
  --containment-fingerprint "$CONTAINMENT_FINGERPRINT"
  --remote-provider-cmd "node $REPO_ROOT/scripts/qualification-review-provider.js"
  --remote-provider agy-gemini
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_MODEL
  --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_CLI_HOME
  --remote-timeout-ms 300000
  --task-class discuss --domain cross-cutting --language en --tool read_only
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
