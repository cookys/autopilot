#!/usr/bin/env bash
# run.sh — Seat 8: cursor-grok-4.6-high-fast / cursor — consult role administration.
#
# STATUS: NOT-READY, for TWO independent reasons discovered while assembling
# this bundle (2026-08-29):
#   1. Kernel adapter gap (same class as seat 5): scripts/qualification-
#      review-provider.js's CLI transport only recognizes QRP_CLI_KIND in
#      {codex, claude, agy, kimi} (see CLI_KINDS, ~line 120). `cursor` is
#      wired only into the LIVE-RAIL transport (scripts/dispatch-hetero.sh,
#      the `implementer` role's `--runner cursor`) — never into the
#      case-broker/QRP transport `consult`/`discuss` require.
#   2. The `cursor-agent` binary itself is ABSENT on this machine right now:
#        node scripts/lib/runner-binary.js version --runner cursor --json
#        -> {"ok":false,...,"reason":"missing_binary"}
#      (it was present at ~/.local/bin/cursor-agent for the 2026-08-27
#      implementer administration in
#      docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/ — this is
#      an environment fact as of THIS session, not a code claim; re-probe
#      before relying on it.)
#
# This script still assembles a believed-correct argv (identity reused from
# the qualified `cursor` implementer row — see DERIVATION.md) and PROVES the
# --plan smoke passes (the five frozen identities + case-plan construction
# never touch the transport, so it does not depend on the binary or the
# CLI_KIND gap). `execute` mode refuses itself LOUD before spending anything —
# see the guard below — rather than attempting a call the kernel cannot honor.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#
# Usage:
#   ./run.sh            # = ./run.sh plan   (free; proves argv/identity are valid)
#   ./run.sh plan        # free dry-run smoke
#   ./run.sh execute      # REFUSES — see STATUS above; no cursor CLI kind + binary absent

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/scripts/engine-qualify.js" ] \
  || { echo "run.sh: could not resolve repo root from $SELF_DIR" >&2; exit 2; }

MODE="${1:-plan}"
case "$MODE" in
  plan) ;;
  execute)
    echo "run.sh: REFUSING execute for seat 8 — qualification-review-provider.js has" >&2
    echo "  no QRP_CLI_KIND for 'cursor' (only codex|claude|agy|kimi exist), and" >&2
    echo "  the cursor-agent binary is not installed on this machine right now." >&2
    echo "  See the STATUS comment at the top of this file / ../DERIVATION.md." >&2
    exit 2
    ;;
  *) echo "run.sh: usage: $0 [plan|execute]" >&2; exit 2 ;;
esac

# --- identity (operator-asserted; cursor CLI transport reports no runtime model id) ---
ENGINE="cursor-grok-4.6-high-fast"      # identity reused byte-for-byte from the
MODEL="cursor-grok-4.6-high-fast"        # qualified `cursor`/`implementer` row —
MODEL_VERSION="cursor-grok-4.6-high-fast" # see docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/
RUNNER="cursor"
FAMILY="xai"
EFFORT="high"

# --- live runner identity probe (fail closed — never guess). EXPECTED to
# report missing_binary right now (see STATUS above) — this script does not
# hide that; it surfaces the probe's own JSON and falls back to the last
# KNOWN-GOOD probed runner-version, clearly labelled, for the --plan argv
# smoke only. Re-probe before any real --execute. ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner cursor --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: cursor-agent --version probe refused (expected — see STATUS above): $RUNNER_PROBE_JSON" >&2
  RUNNER_VERSION="2026.08.25-3e8eec8"   # last known-good probe (2026-08-27 bundle), NOT re-verified today
else
  RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"
fi

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="2ff3fe6ab3a13154fc1a316c0ba05445e730d068d9f96d0529701ff542a55204"
SEMANTIC_FINGERPRINT="da6e86f5aa8d132470badc7e2db0cc91b4429be427492e84ed518b88e85e6161"
CONTAINMENT_FINGERPRINT="4c839d055442a0797ff772b31264720f0fa0d63539b7f7936319e36d127c43a7"
HARNESS_VERSION="qrp:4c839d05"

# --- transport env: BELIEVED shape only — QRP_CLI_KIND=cursor does not
# exist in qualification-review-provider.js today (see STATUS above). Set
# anyway so the --plan argv is complete and self-documenting. ---
export QRP_TRANSPORT=cli
export QRP_CLI_KIND=cursor
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="cursor-grok"
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
  --remote-provider cursor-grok
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_MODEL
  --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE
  --remote-timeout-ms 300000
  --task-class consult --domain cross-cutting --language en --tool read_only
  --store "$STORE"
  --raw-dir "$RAW_DIR"
  --version-source operator-asserted
  --emit-row
)

# Only --plan is ever reachable here — the execute branch above exits 2 first.
node "${ARGS[@]}" --plan | tee "$SELF_DIR/plan-out.json"
exit "${PIPESTATUS[0]}"
