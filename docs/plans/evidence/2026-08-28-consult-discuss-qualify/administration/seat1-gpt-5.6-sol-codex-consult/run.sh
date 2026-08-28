#!/usr/bin/env bash
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
MODEL_VERSION="gpt-5.6-sol-20260829"   # requested id + probe date (today)
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
PROMPT_CONFIG_HASH="f2373a1c81078a86334baf5b32a467fb85876b3ada2d1c678d3b1d03c2a13d8e"
SEMANTIC_FINGERPRINT="e3cad122072d6070c09ed203e7e30f8719bce631c887b792c92724b66b23cada"
CONTAINMENT_FINGERPRINT="9e25bea8fb433ca99c1a3b4c7d54431ad8e2b3e51ce70082462d553de09275c6"
HARNESS_VERSION="qrp:9e25bea8"   # sha256(qualification-review-provider.js) short blob, see DERIVATION.md

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
