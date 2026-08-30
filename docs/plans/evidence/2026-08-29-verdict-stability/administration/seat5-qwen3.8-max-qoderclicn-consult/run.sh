#!/usr/bin/env bash
# D7 pooled re-administration 2026-08-30 — Board authorization:
#   docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-30 (D7 re-administration authorization)".
# Copied from the 2026-08-28 recipe; ONLY these changed: HARNESS_VERSION +
# CONTAINMENT_FINGERPRINT re-pinned to the current provider sha, --store now
# the canonical evidence DIRECTORY, MODEL_VERSION probe date, output paths
# local to this dir. Transport env, identity pins, effort and timeouts are
# byte-identical to the run that worked on 2026-08-29.
# run.sh — Seat 5: Qwen3.8-Max / qoderclicn — consult role administration.
#
# STATUS: READY (2026-08-29). The prior NOT-READY blocker (no QRP_CLI_KIND for
# qoderclicn) is fixed: scripts/qualification-review-provider.js's callCli() now
# carries a qoderclicn branch (see CLI_KINDS + the `kind === 'qoderclicn'` arm).
# qoderclicn 1.1.35 is present on this box and Qwen3.8-Max is already a
# qualified `implementer` via this same binary (scorecard event 148) — this
# seat only exercises the NEW consult QRP path, not new credentials/transport.
#
# CONTAINMENT (see qualification-review-provider.js's qoderclicn branch for the
# full live-probe evidence): `--tools ""` reliably blocked real tool execution
# across three live probes (no real hostname/file content ever leaked); the
# OTHER deny mechanism (--disallowed-tools) was separately found to be
# defeated by --dangerously-skip-permissions in a live probe (real hostname
# DID leak) — so this adapter, and this seat, NEVER passes
# --dangerously-skip-permissions. See:
#   docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/qoderclicn-containment-probe/
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)". `--execute` (real, paid)
#   requires the explicit CLI flag below.
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

command -v qoderclicn >/dev/null 2>&1 \
  || { echo "run.sh: qoderclicn binary not found on PATH" >&2; exit 2; }

# --- identity (operator-asserted; qoderclicn CLI transport reports no runtime model id) ---
ENGINE="Qwen3.8-Max"
MODEL="Qwen3.8-Max"
MODEL_VERSION="Qwen3.8-Max"
RUNNER="qoderclicn"
FAMILY="alibaba"
EFFORT="high"   # matches the existing qoderclicn `implementer` qualification's tier

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner qoderclicn --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: qoderclicn --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see ../DERIVATION.md) ---
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="eddc2a1915e1c504511e6bce87bf910714e7ba6d90022af4e093f23a37867a55"
HARNESS_VERSION="qrp:eddc2a19"   # sha256(scripts/qualification-review-provider.js) short blob, re-pinned for D7 2026-08-30

# --- dedicated exam config-dir, credential files only. qoderclicn reads
# ~/.qoder-cn/.auth/{dynamic-error-codes.json,machine_id,user,.credential-
# transaction} for auth; --config-dir <dir> replaces the qoder-cn root wholesale
# (verified live: pointing it at an empty dir reports "Not logged in"), so the
# staged dir must mirror that layout: <staging>/.auth/<same files>. ---
STAGING_HOME="$HOME/.autopilot/qualify-staging/seat5-qwen3.8-max-qoderclicn-consult/qoder-config-dir"
STAGING_AUTH_DIR="$STAGING_HOME/.auth"
mkdir -p "$STAGING_AUTH_DIR"
chmod 700 "$STAGING_HOME" "$HOME/.autopilot/qualify-staging/seat5-qwen3.8-max-qoderclicn-consult" 2>/dev/null || true
REAL_AUTH_DIR="$HOME/.qoder-cn/.auth"
for f in dynamic-error-codes.json machine_id; do
  qualify_stage_identity "$STAGING_AUTH_DIR/$f" "$REAL_AUTH_DIR/$f"
done
for f in user .credential-transaction; do
  qualify_stage_credential "$STAGING_AUTH_DIR/$f" "$REAL_AUTH_DIR/$f" "$MODE"
done
if [ ! -f "$STAGING_AUTH_DIR/user" ]; then
  echo "run.sh: no user credential seeded into $STAGING_AUTH_DIR — --execute will fail to authenticate" >&2
fi
STAGING_BYTES="$(du -sk "$STAGING_HOME" 2>/dev/null | awk '{print $1*1024}')"
if [ -n "$STAGING_BYTES" ] && [ "$STAGING_BYTES" -gt $((8*1024*1024)) ]; then
  echo "run.sh: staged qoder config-dir is ${STAGING_BYTES} bytes, over the 8MB QRP_CLI_HOME cap — re-seed credential-only" >&2
  exit 2
fi
export QRP_CLI_HOME="$STAGING_HOME"

export QRP_TRANSPORT=cli
export QRP_CLI_KIND=qoderclicn
export QRP_CLI_EFFORT="$EFFORT"
export QRP_MODEL="$MODEL"
export QRP_PROVIDER="qoderclicn-qwen"
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
  --remote-provider qoderclicn-qwen
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
