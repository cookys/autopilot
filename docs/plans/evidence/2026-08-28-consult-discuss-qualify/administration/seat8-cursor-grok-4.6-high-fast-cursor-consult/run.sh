#!/usr/bin/env bash
# run.sh — Seat 8: cursor-grok-4.6-high-fast / cursor — consult role administration.
#
# STATUS: NOT-READY. The prior blocker (no QRP_CLI_KIND for `cursor`) is fixed —
# scripts/qualification-review-provider.js's callCli() now HAS a `kind ===
# 'cursor'` branch — but that branch is a DELIBERATE, UNCONDITIONAL REFUSAL,
# not a working transport:
#
#   cursor-agent exposes NO verified tool-deny/sandbox mechanism this repo has
#   ever probed. The only permission-shaped flag on record is `--mode ask`,
#   and docs/plans/2026-08-26-cursor-cli-adaptor.md's own risk register (R-3)
#   already ruled it out for exactly this purpose: "`--mode ask` read-only is
#   not proven tamper-resistant... P9 is one cooperative probe... evidence of
#   refusal, not evidence of server-side enforcement against an adversarial or
#   injected prompt" — and that plan's own mitigation was to exclude cursor
#   from the blind-review allowlist until it earns "its own adversarial
#   probe." A consult exam prompt is exactly that adversarial shape (the model
#   is graded and has every incentive to reach for a tool to "help"), so this
#   adapter inherits the same unresolved risk rather than re-litigating it.
#   Per this repo's safety contract ("if it has no such model, the adapter
#   must refuse to run rather than expose the host"), callCli() throws before
#   ever building args or spawning — see:
#     docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/cursor-containment-probe/
#
# SEPARATELY, cursor-agent is also NOT INSTALLED on this machine right now
# (re-probed 2026-08-29, same as the 2026-08-27 finding):
#   node scripts/lib/runner-binary.js version --runner cursor --json
#   -> {"ok":false,...,"reason":"missing_binary"}
# This is an environment fact, not the reason for the refusal above — the
# adapter would refuse identically even with the binary present.
#
# This script still assembles a believed-correct argv (identity reused from
# the qualified `cursor` implementer row — see DERIVATION.md) and PROVES the
# --plan smoke passes (the five frozen identities + case-plan construction
# never touch the transport). `execute` mode refuses itself LOUD before
# spending anything — see the guard below.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#
# Usage:
#   ./run.sh            # = ./run.sh plan   (free; proves argv/identity are valid)
#   ./run.sh plan        # free dry-run smoke
#   ./run.sh execute      # REFUSES — see STATUS above; unproven containment, binary absent

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/scripts/engine-qualify.js" ] \
  || { echo "run.sh: could not resolve repo root from $SELF_DIR" >&2; exit 2; }

MODE="${1:-plan}"
case "$MODE" in
  plan) ;;
  execute)
    echo "run.sh: REFUSING execute for seat 8 — cursor-agent has no verified" >&2
    echo "  tool-deny/sandbox mechanism (docs/plans/2026-08-26-cursor-cli-adaptor.md" >&2
    echo "  R-3); qualification-review-provider.js's cursor branch refuses" >&2
    echo "  unconditionally, and the cursor-agent binary is also absent on this" >&2
    echo "  machine right now. See the STATUS comment at the top of this file /" >&2
    echo "  ../DERIVATION.md / ../cursor-containment-probe/." >&2
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
# smoke only. Re-probe before any real --execute (which is refused above
# regardless). ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner cursor --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: cursor-agent --version probe refused (expected — see STATUS above): $RUNNER_PROBE_JSON" >&2
  RUNNER_VERSION="2026.08.25-3e8eec8"   # last known-good probe (2026-08-27 bundle), NOT re-verified today
else
  RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"
fi

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="cdc4859912eb74352bf3f1d38a7c8e9e3d0c6769314e12e95aa3111983e37d62"
HARNESS_VERSION="qrp:cdc48599"

# --- transport env: QRP_CLI_KIND=cursor NOW EXISTS but ALWAYS REFUSES (see
# STATUS above) — set anyway so the --plan argv is complete and
# self-documenting. ---
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
