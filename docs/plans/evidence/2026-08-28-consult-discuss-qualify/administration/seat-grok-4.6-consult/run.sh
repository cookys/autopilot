#!/usr/bin/env bash
# run.sh — Seat: grok-4.6 / grok — consult role administration.
#
# STATUS: READY (2026-08-29). New adapter: scripts/qualification-review-provider.js's
# callCli() gained a `kind === 'grok'` branch this same change. grok 1.0.13 is
# present on this box; `grok models` lists grok-4.6 as the default model (used
# here — grok-4.5 is also listed but NOT used since 4.6 is available on this
# rail and is the newer/default engine).
#
# CONTAINMENT (see qualification-review-provider.js's grok branch for the full
# live-probe evidence): grok's tool-permission vocabulary mirrors Claude Code's
# names (Bash/Write/Edit/Read/Grep/Glob/WebSearch/WebFetch). `--tools ""` does
# **NOT** block execution for grok (a live probe with only that flag actually
# ran `hostname` and returned the real hostname) — only explicit
# `--deny "<Name>(*)"` rules do, and they were verified to WIN over both
# `--always-approve` and `--permission-mode bypassPermissions`. This adapter
# forces all 8 deny rules on EVERY invocation via argv (never conditional on
# QRP_CLI_HOME). See:
#   docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/grok-containment-probe/
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)" — grok was event-149's
#   rail-attributed failure, unrepaired at authorization time; this change
#   repairs the rail. `--execute` (real, paid) requires the explicit CLI flag
#   below.
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

command -v grok >/dev/null 2>&1 \
  || { echo "run.sh: grok binary not found on PATH" >&2; exit 2; }

# --- identity (operator-asserted; grok CLI transport reports no runtime model id) ---
ENGINE="grok-4.6"
MODEL="grok-4.6"
MODEL_VERSION="grok-4.6-20260829"   # requested id + probe date (today)
RUNNER="grok"
FAMILY="xai"
EFFORT="xhigh"   # this rail's ceiling (grok validates low|medium|high|xhigh only)

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner grok --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: grok --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
# Corpus-v6 consult identity: assets are shared across engines, only
# engine/runner/model identity differs per seat (see DERIVATION.md).
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="cdc4859912eb74352bf3f1d38a7c8e9e3d0c6769314e12e95aa3111983e37d62"
HARNESS_VERSION="qrp:cdc48599"   # sha256(qualification-review-provider.js) short blob, see DERIVATION.md

# --- dedicated exam grok home, credential files only. grok reads GROK_HOME
# (default ~/.grok) for auth.json/agent_id/.metadata_version; this stages a
# credential-only clone OUTSIDE the repo so no OAuth material ever lands in
# git-tracked evidence. Files sit DIRECTLY in the staged root (GROK_HOME layout,
# not nested like agy's $HOME/.gemini/...). ---
STAGING_HOME="$HOME/.autopilot/qualify-staging/seat-grok-4.6-consult/grok-home"
mkdir -p "$STAGING_HOME"
chmod 700 "$STAGING_HOME" "$HOME/.autopilot/qualify-staging/seat-grok-4.6-consult" 2>/dev/null || true
REAL_GROK_HOME="$HOME/.grok"
for f in agent_id .metadata_version; do
  qualify_stage_identity "$STAGING_HOME/$f" "$REAL_GROK_HOME/$f"
done
qualify_stage_credential "$STAGING_HOME/auth.json" "$REAL_GROK_HOME/auth.json" "$MODE"
if [ ! -f "$STAGING_HOME/auth.json" ]; then
  echo "run.sh: no auth.json seeded into $STAGING_HOME — --execute will fail to authenticate" >&2
fi
STAGING_BYTES="$(du -sk "$STAGING_HOME" 2>/dev/null | awk '{print $1*1024}')"
if [ -n "$STAGING_BYTES" ] && [ "$STAGING_BYTES" -gt $((8*1024*1024)) ]; then
  echo "run.sh: staged grok home is ${STAGING_BYTES} bytes, over the 8MB QRP_CLI_HOME cap — re-seed credential-only" >&2
  exit 2
fi
export QRP_CLI_HOME="$STAGING_HOME"

export QRP_TRANSPORT=cli
export QRP_CLI_KIND=grok
export QRP_CLI_EFFORT="$EFFORT"
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="grok-xai"
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
  --remote-provider grok-xai
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE
  --provider-env QRP_CLI_HOME
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
