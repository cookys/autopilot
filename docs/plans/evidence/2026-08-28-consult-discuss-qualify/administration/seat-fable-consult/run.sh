#!/usr/bin/env bash
# run.sh — Seat: Fable (claude-fable-5) / claude-native — consult role administration.
#
# Board authorization: docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md
#   "Board decision — 2026-08-28 (authorization)". Free `plan` dry-run by
#   default; `execute` is real, paid, and requires the literal CLI argument
#   below.
#
# claude-fable-5 is a NATIVE Claude model. This seat runs through the SAME
# QRP claude adapter as seat 3/4 (`claude -p <prompt> --model <model>`) but
# points it at the REAL Anthropic API using the user's own Claude
# credentials — NOT a third-party Anthropic-compatible endpoint. Unlike
# seat 3 (MiniMax) / seat 4 (GLM), this script never sets
# ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN — there is no third-party
# endpoint to point at; the `claude` CLI's own ambient auth (staged below)
# is the entire credential path.
#
# CLAUDE_CONFIG_DIR TRAP (live incident 2026-08-17 — see
# qualification-review-provider.js's own header note): pointing
# CLAUDE_CONFIG_DIR at the REAL ~/.claude can RESET the live .claude.json
# when a subprocess runs against it. This script stages a DEDICATED,
# exam-only config dir under $HOME/.autopilot/qualify-staging/ — OUTSIDE
# the repo, containing ONLY .credentials.json (never a symlink to, or copy
# of, the whole ~/.claude tree) — so no credential material is ever
# written into git-tracked evidence and the live config is never touched.
# Verified 2026-08-29: `CLAUDE_CONFIG_DIR=<staged dir> claude --version`
# succeeds and `$HOME/.claude/.claude.json` mtime is byte-for-byte
# unchanged before/after (see DERIVATION.md § Seat readiness for the proof).
#
# --runner is "claude-native" (NOT "cc-shim" — cc-shim names the pattern of
# pointing the claude CLI at a THIRD-PARTY Anthropic-compatible endpoint via
# ANTHROPIC_BASE_URL, which this seat deliberately does not do). Confirmed
# via `node scripts/lib/runner-binary.js version --runner claude-native
# --json` → resolves to binary `claude`; `--runner claude` alone is NOT a
# recognized runner token (`reason:"unknown_runner"`). `src/readiness/
# status.js` also accepts `claude-native` in its runner allowlist.
#
# READY for --plan (verified below). --execute readiness: `claude
# --version` succeeds under the staged exam config dir without touching
# the real ~/.claude; a live headless `claude -p "reply PONG" --model
# claude-fable-5` call was NOT run (that is a paid API call and this
# administration is scoped to free --plan smokes only) — see
# DERIVATION.md for the explicit "not verified" note on that point.
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
ENGINE="claude-fable-5"
MODEL="claude-fable-5"
MODEL_VERSION="claude-fable-5"   # operator-asserted: the claude CLI reports no
                                  # build id distinct from the model id itself
                                  # (`claude --version` reports only the CLI's
                                  # own version, captured live below as
                                  # RUNNER_VERSION).
RUNNER="claude-native"
FAMILY="anthropic"
EFFORT="high"        # receipt-only classification (see header note); the
                      # claude CLI kind in qualification-review-provider.js's
                      # callCli() takes NO --effort flag (only agy/codex
                      # branches read one) — this is not enforced on the
                      # transport, matching seat 3's "default"/seat 7's "high"
                      # posture for the same non-effort-taking claude kind.

# --- live runner identity probe (fail closed — never guess) ---
RUNNER_PROBE_JSON="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner claude-native --json)" || true
RUNNER_PROBE_OK="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).ok))" "$RUNNER_PROBE_JSON")"
if [ "$RUNNER_PROBE_OK" != "true" ]; then
  echo "run.sh: claude --version probe refused: $RUNNER_PROBE_JSON" >&2
  exit 2
fi
RUNNER_VERSION="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$RUNNER_PROBE_JSON")"

# --- frozen identity fingerprints (derived by ../derive-hashes.js; see
# ../DERIVATION.md). Same corpus-v6 consult identity every consult seat in
# this bundle shares — the exam assets are identical across engines; only
# engine/runner/model identity differs per seat. Do NOT invent new hashes. ---
PROMPT_CONFIG_HASH="1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635"
SEMANTIC_FINGERPRINT="00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122"
CONTAINMENT_FINGERPRINT="d6c560be45e9cdda0aaef54aab48f9f32cb910d33b4c1514ab940435574b93d8"
HARNESS_VERSION="qrp:d6c560be"

# --- dedicated exam Claude config dir (NEVER the real ~/.claude — see the
# CLAUDE_CONFIG_DIR TRAP note above). Staged OUTSIDE the repo so no credential
# material lands in git-tracked evidence. Seeded once from the real
# ~/.claude/.credentials.json (idempotent — never overwrites an existing
# seed). Contains ONLY the credentials file, not a copy or symlink of the
# whole ~/.claude tree. ---
STAGING_DIR="$HOME/.autopilot/qualify-staging/seat-fable-consult/claude-home"
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
export QRP_PROVIDER="anthropic"
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
  --remote-provider anthropic
  --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_MODEL
  --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE
  --provider-env CLAUDE_CONFIG_DIR
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
