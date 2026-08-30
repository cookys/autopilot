#!/usr/bin/env bash
# D7 pooled re-administration 2026-08-30 — Board authorization:
#   docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-30 (D7 re-administration authorization)".
# Copied from the 2026-08-28 recipe; ONLY these changed: HARNESS_VERSION +
# CONTAINMENT_FINGERPRINT re-pinned to the current provider sha, --store now
# the canonical evidence DIRECTORY, MODEL_VERSION probe date, output paths
# local to this dir. Transport env, identity pins, effort and timeouts are
# byte-identical to the run that worked on 2026-08-29.
# run.sh — Seat 1: gpt-5.6-sol / codex-cli — consult role administration.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)". This script NEVER spends
#   money on its own: `--execute` (real, paid) requires the explicit CLI flag
#   below AND is refused unless this script is invoked with `execute` as $1.
#   Default / `plan` mode is a free dry-run smoke (verifies the five frozen
#   identities + prints the case plan; never calls the codex CLI).
#
# READY. codex CLI present (`codex-cli 0.150.1`), CODEX_HOME creds present at
# $HOME/.codex, --remote-provider-cmd transport supports QRP_CLI_KIND=codex.
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

# --- identity (operator-asserted; codex CLI transport reports no runtime model id) ---
ENGINE="gpt-5.6-sol"
MODEL="gpt-5.6-sol"
MODEL_VERSION="gpt-5.6-sol-20260830"   # requested id + probe date (today)
RUNNER="codex"
FAMILY="openai"
EFFORT="max"                            # this seat's calibrated tier (matches its
                                         # existing `reviewer` qualification)

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner codex --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: codex --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="eddc2a1915e1c504511e6bce87bf910714e7ba6d90022af4e093f23a37867a55"
HARNESS_VERSION="qrp:eddc2a19"   # sha256(scripts/qualification-review-provider.js) short blob, re-pinned for D7 2026-08-30

# --- transport env (forwarded into the QRP child via --provider-env; CODEX_HOME
# rides the harness-native redirect var since the broker forces HOME to a fresh
# provider-owned dir per QRP's own header comment) ---
export QRP_TRANSPORT=cli
export QRP_CLI_KIND=codex
export QRP_CLI_EFFORT="$EFFORT"
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="codex-cli"
export QRP_PROMPT_MODE=consult
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
[ -d "$CODEX_HOME" ] || { echo "run.sh: CODEX_HOME not found: $CODEX_HOME" >&2; exit 2; }

# --- runtime assert: the pinned harness/containment sha IS the provider that runs ---
ACTUAL_QRP_SHA="$(sha256sum "$REPO_ROOT/scripts/qualification-review-provider.js" | cut -d" " -f1)"
if [ "$ACTUAL_QRP_SHA" != "$CONTAINMENT_FINGERPRINT" ]; then
  echo "run.sh: provider sha drift: pinned $CONTAINMENT_FINGERPRINT actual $ACTUAL_QRP_SHA" >&2; exit 2
fi
if [ "qrp:${ACTUAL_QRP_SHA:0:8}" != "$HARNESS_VERSION" ]; then
  echo "run.sh: HARNESS_VERSION drift: $HARNESS_VERSION vs qrp:${ACTUAL_QRP_SHA:0:8}" >&2; exit 2
fi

RAW_DIR="$SELF_DIR/raw"
mkdir -p "$RAW_DIR"
STORE="$HOME/.autopilot/engine-capability"

ARGS=(
  "$REPO_ROOT/scripts/engine-qualify.js" consult
  --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION"
  --runner "$RUNNER" --runner-version "$RUNNER_VERSION" --family "$FAMILY"
  --harness-version "$HARNESS_VERSION" --effort "$EFFORT"
  --prompt-config-hash "$PROMPT_CONFIG_HASH"
  --semantic-fingerprint "$SEMANTIC_FINGERPRINT"
  --containment-fingerprint "$CONTAINMENT_FINGERPRINT"
  --remote-provider-cmd "node $REPO_ROOT/scripts/qualification-review-provider.js"
  --remote-provider codex-cli
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE
  --provider-env CODEX_HOME
  --remote-timeout-ms 400000
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

# execute: real, paid. Requires the Board authorization named at the top of this file.
exec node "${ARGS[@]}" --execute
