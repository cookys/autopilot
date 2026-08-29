#!/usr/bin/env bash
# run.sh — Seat 5: Qwen3.8-Max / qoderclicn — consult role administration.
#
# STATUS: NOT-READY. This is NOT a credential/token problem — it is a kernel
# adapter gap discovered while assembling this bundle (2026-08-29):
# scripts/qualification-review-provider.js's CLI transport only recognizes
#   QRP_CLI_KIND in {codex, claude, agy, kimi}   (see CLI_KINDS, ~line 120)
# `qoderclicn` is a real, working runner token (scripts/lib/runner-binary.js
# maps it, and `qoderclicn --version` succeeds on this box: 1.1.28) but it is
# ONLY wired into the LIVE-RAIL transport (scripts/dispatch-hetero.sh, used by
# the `implementer` role) — never into the case-broker/QRP transport that
# `consult`/`discuss` require. There is no honest way to populate
# `--remote-provider-cmd` for this seat today: an `--execute` run would abort
# every case with "QRP_TRANSPORT=cli requires QRP_CLI_KIND to be one of:
# codex, claude, agy, kimi" before any real dispatch happened.
#
# This script still assembles a believed-correct argv (for when/if a
# `qoderclicn` QRP_CLI_KIND lands) and PROVES the --plan smoke passes (the
# five frozen identities + case-plan construction never touch the transport).
# `execute` mode refuses itself LOUD before spending anything — see the guard
# below — rather than attempting a call the kernel cannot honor.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#
# Usage:
#   ./run.sh            # = ./run.sh plan   (free; proves argv/identity are valid)
#   ./run.sh plan        # free dry-run smoke
#   ./run.sh execute      # REFUSES — see STATUS above; no qoderclicn CLI kind exists

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/scripts/engine-qualify.js" ] \
  || { echo "run.sh: could not resolve repo root from $SELF_DIR" >&2; exit 2; }

MODE="${1:-plan}"
case "$MODE" in
  plan) ;;
  execute)
    echo "run.sh: REFUSING execute for seat 5 — qualification-review-provider.js has" >&2
    echo "  no QRP_CLI_KIND for 'qoderclicn' (only codex|claude|agy|kimi exist)." >&2
    echo "  See the STATUS comment at the top of this file / ../DERIVATION.md." >&2
    exit 2
    ;;
  *) echo "run.sh: usage: $0 [plan|execute]" >&2; exit 2 ;;
esac

# --- identity (operator-asserted; qoderclicn CLI transport reports no runtime model id) ---
ENGINE="Qwen3.8-Max"
MODEL="Qwen3.8-Max"
MODEL_VERSION="Qwen3.8-Max"
RUNNER="qoderclicn"
FAMILY="alibaba"
EFFORT="high"   # matches the existing qoderclicn `implementer` qualification's tier

# --- live runner identity probe (fail closed — never guess). The binary IS
# present and DOES answer --version — the gap is purely in QRP's CLI_KIND
# allowlist, not here. ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner qoderclicn --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: qoderclicn --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="f2373a1c81078a86334baf5b32a467fb85876b3ada2d1c678d3b1d03c2a13d8e"
SEMANTIC_FINGERPRINT="e3cad122072d6070c09ed203e7e30f8719bce631c887b792c92724b66b23cada"
CONTAINMENT_FINGERPRINT="53b9d0f96f57ac531d202e9b8ed16e4660e46c90489ce5e79d942ad98046ac12"
HARNESS_VERSION="qrp:53b9d0f9"

# --- transport env: BELIEVED shape only — QRP_CLI_KIND=qoderclicn does not
# exist in qualification-review-provider.js today (see STATUS above). Set
# anyway so the --plan argv is complete and self-documenting. ---
export QRP_TRANSPORT=cli
export QRP_CLI_KIND=qoderclicn
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="qoderclicn-qwen"
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
  --remote-provider qoderclicn-qwen
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
