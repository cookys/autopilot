#!/usr/bin/env bash
# D7 pooled re-administration 2026-08-30 — Board authorization:
#   docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-30 (D7 re-administration authorization)".
# Copied from the 2026-08-28 recipe; ONLY these changed: HARNESS_VERSION +
# CONTAINMENT_FINGERPRINT re-pinned to the current provider sha, --store now
# the canonical evidence DIRECTORY, MODEL_VERSION probe date, output paths
# local to this dir. Transport env, identity pins, effort and timeouts are
# byte-identical to the run that worked on 2026-08-29.
# run.sh — Seat 4: GLM-5.3 / cc-shim — consult role administration.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)". Free `plan` dry-run by
#   default; `execute` is real, paid, and requires the CLI flag below.
#
# cc-shim = the Claude Code CLI (`claude`) pointed at GLM's (Zhipu) Anthropic-
# compatible endpoint via ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN. Credentials
# come from scripts/load-endpoints-env.sh + scripts/resolve-endpoint.sh
# (AUTOPILOT_ENDPOINT_GLM_URL/_TOKEN), never hardcoded here.
#
# READY for --plan (verified). --execute readiness for THIS transport also
# needs a dedicated exam Claude config dir seeded with .credentials.json
# (qualification-review-provider.js's own "CLAUDE_CONFIG_DIR TRAP" warning:
# pointing CLAUDE_CONFIG_DIR at the real ~/.claude can RESET the live
# .claude.json — never do that). This script stages that dir itself, once,
# under $HOME/.autopilot/qualify-staging/ — OUTSIDE the repo, so no
# credential material is ever written into git-tracked evidence.
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
source "$REPO_ROOT/scripts/lib/qualify-stage-credentials.sh"

MODE="${1:-plan}"
case "$MODE" in
  plan|execute) ;;
  *) echo "run.sh: usage: $0 [plan|execute]" >&2; exit 2 ;;
esac

# --- identity (operator-asserted; CLI transport reports no runtime model id) ---
ENGINE="GLM-5.3"
MODEL="GLM-5.3"
MODEL_VERSION="GLM-5.3"
RUNNER="cc-shim"
FAMILY="zhipu"
EFFORT="high"    # cc-shim/claude does not take an --effort flag through QRP;
                     # this is a receipt-only classification, not enforced.

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner cc-shim --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: claude --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="eddc2a1915e1c504511e6bce87bf910714e7ba6d90022af4e093f23a37867a55"
HARNESS_VERSION="qrp:eddc2a19"   # sha256(scripts/qualification-review-provider.js) short blob, re-pinned for D7 2026-08-30

# --- endpoint credentials: load the persisted file, then resolve the named
# endpoint's non-secret metadata; the TOKEN VALUE is read only via indirect
# expansion (never through resolve-endpoint.sh's own stdout — that would
# print only the env var NAME, but we still avoid echoing it at all). ---
# shellcheck source=/dev/null
source "$REPO_ROOT/scripts/load-endpoints-env.sh"
autopilot_load_endpoints_env
EP_JSON="$("$REPO_ROOT/scripts/resolve-endpoint.sh" glm 2>/dev/null)"; EP_RC=$?
if [ "$EP_RC" -ne 0 ]; then
  echo "run.sh: glm endpoint not ready (resolve-endpoint.sh exit $EP_RC): $EP_JSON" >&2
  exit 2
fi
EP_URL="$(printf '%s' "$EP_JSON" | sed -n 's/.*"base_url":"\([^"]*\)".*/\1/p')"
EP_TOKENV="$(printf '%s' "$EP_JSON" | sed -n 's/.*"token_env":"\([^"]*\)".*/\1/p')"
{ [ -n "$EP_URL" ] && [ -n "$EP_TOKENV" ]; } || { echo "run.sh: glm endpoint resolved an empty base_url/token_env" >&2; exit 2; }
export ANTHROPIC_BASE_URL="$EP_URL"
export ANTHROPIC_AUTH_TOKEN="${!EP_TOKENV-}"
[ -n "$ANTHROPIC_AUTH_TOKEN" ] || { echo "run.sh: $EP_TOKENV is empty" >&2; exit 2; }
unset EP_JSON EP_URL EP_TOKENV EP_RC

# --- dedicated exam Claude config dir (NEVER the real ~/.claude — see the
# CLAUDE_CONFIG_DIR TRAP note above). Staged OUTSIDE the repo so no credential
# material lands in git-tracked evidence. Seeded once from the real
# ~/.claude/.credentials.json (idempotent — never overwrites an existing seed). ---
STAGING_DIR="$HOME/.autopilot/qualify-staging/seat4-glm-5.3-ccshim-consult/claude-config"
mkdir -p "$STAGING_DIR"
chmod 700 "$STAGING_DIR"
qualify_stage_credential "$STAGING_DIR/.credentials.json" "$HOME/.claude/.credentials.json" "$MODE"
if [ ! -f "$STAGING_DIR/.credentials.json" ]; then
  echo "run.sh: no $HOME/.claude/.credentials.json to seed $STAGING_DIR — --execute will likely fail to authenticate" >&2
fi
export CLAUDE_CONFIG_DIR="$STAGING_DIR"

export QRP_TRANSPORT=cli
export QRP_CLI_KIND=claude
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="cc-shim-glm"
export QRP_PROMPT_MODE=consult

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
  --remote-provider cc-shim-glm
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_MODEL
  --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE
  --provider-env CLAUDE_CONFIG_DIR --provider-env ANTHROPIC_BASE_URL --provider-env ANTHROPIC_AUTH_TOKEN
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
