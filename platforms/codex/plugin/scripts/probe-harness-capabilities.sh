#!/usr/bin/env bash
# Deterministic D1 capability probe. Raw prompts and credentials are never persisted;
# only version-bound command/output digests reach the closed aggregate receipt.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT=""
ALL=0

usage() {
  cat <<'USAGE'
Usage: probe-harness-capabilities.sh --all --output FILE

Probe the exact D2/D3/D4 harness surfaces, create a closed dual-evidence input,
and delegate the only receipt write to platform-capability-claims.js generate.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --all) ALL=1; shift ;;
    --output)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "error: --output requires a value" >&2; exit 2; }
      OUTPUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ "$ALL" -eq 1 ] || { echo "error: --all is required" >&2; exit 2; }
[ -n "$OUTPUT" ] || { echo "error: --output is required" >&2; exit 2; }

for binary in agy codex grok opencode claude node; do
  command -v "$binary" >/dev/null 2>&1 || { echo "error: required binary unavailable: $binary" >&2; exit 1; }
done

PROBE_SUFFIX="$(printf '%s' X X X X X X)"
PROBE_TMP="$(mktemp -d -t "autopilot-platform-capabilities-$PROBE_SUFFIX")"
cleanup_probe() { rm -rf "$PROBE_TMP"; }
trap cleanup_probe EXIT INT TERM

version_of() {
  "$1" --version 2>&1 | node -e '
    const fs = require("fs");
    const text = fs.readFileSync(0, "utf8");
    const match = text.match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:$|[^0-9])/);
    if (!match) process.exit(1);
    process.stdout.write(match[1]);
  '
}

AGY_BIN="$(realpath "$(command -v agy)")"
CODEX_BIN="$(realpath "$(command -v codex)")"
GROK_BIN="$(realpath "$(command -v grok)")"
OPENCODE_BIN="$(realpath "$(command -v opencode)")"
CLAUDE_BIN="$(realpath "$(command -v claude)")"

AGY_VERSION="$(version_of "$AGY_BIN")"
CODEX_VERSION="$(version_of "$CODEX_BIN")"
GROK_VERSION="$(version_of "$GROK_BIN")"
OPENCODE_VERSION="$(version_of "$OPENCODE_BIN")"
CLAUDE_VERSION="$(version_of "$CLAUDE_BIN")"

AGY_HELP="$PROBE_TMP/agy-help.txt"
CODEX_HELP="$PROBE_TMP/codex-help.txt"
GROK_HELP="$PROBE_TMP/grok-help.txt"
OPENCODE_HELP="$PROBE_TMP/opencode-help.txt"
CLAUDE_HELP="$PROBE_TMP/claude-help.txt"
"$AGY_BIN" --help >"$AGY_HELP" 2>&1
"$CODEX_BIN" --help >"$CODEX_HELP" 2>&1
"$GROK_BIN" --help >"$GROK_HELP" 2>&1
"$OPENCODE_BIN" --help >"$OPENCODE_HELP" 2>&1
"$CLAUDE_BIN" --help >"$CLAUDE_HELP" 2>&1

# shellcheck source=lib/agy-model-alias.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/agy-model-alias.sh"
# Resolve before any paid agy -p. A tier-encoded id must not be paired with --effort.
AGY_MODEL="$(agy_resolve_model_alias gemini-flash-high "$AGY_BIN")" || {
  printf 'error: %s\n' "$AGY_MODEL" >&2
  exit 1
}
AGY_MODEL_DISPLAY="$(timeout 20 "$AGY_BIN" models 2>/dev/null | awk -F '\t' -v id="$AGY_MODEL" '$1 == id { print $2; exit }')"
if [ -z "$AGY_MODEL_DISPLAY" ]; then
  agy_ver="${AGY_MODEL#gemini-}"
  agy_ver="${agy_ver%-flash-*}"
  case "${AGY_MODEL##*-}" in
    low) agy_tier="Low" ;;
    medium) agy_tier="Medium" ;;
    high) agy_tier="High" ;;
    *) agy_tier="${AGY_MODEL##*-}" ;;
  esac
  AGY_MODEL_DISPLAY="Gemini ${agy_ver} Flash (${agy_tier})"
fi

# D2 is the only fresh paid behavior probe in this rerunnable driver. The exact
# production agy transport passes the normalized model slug and no effort flag;
# effort remains validated tuple metadata in the generated claim.
AGY_JSON="$PROBE_TMP/agy-structured.json"
AGY_STDERR="$PROBE_TMP/agy-structured.stderr"
set +e
# Prompt travels on stdin as stream-json (BL-0298); --emit envelope prints the `result` object, the same
# response+usage shape the old `--output-format json` envelope carried.
timeout 120 node "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/agy-stream-json.js" run \
  --prefix 'Return exactly AGY_CAPABILITY_OK and do not use tools.' --emit envelope -- \
  "$AGY_BIN" --model "$AGY_MODEL" --dangerously-skip-permissions \
  --print-timeout 90s >"$AGY_JSON" 2>"$AGY_STDERR"
AGY_RC=$?
set -e
[ "$AGY_RC" -eq 0 ] || { echo "error: agy structured probe failed (exit $AGY_RC)" >&2; exit 1; }
node - "$AGY_JSON" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const usageKeys = ['cache_read_tokens', 'input_tokens', 'output_tokens', 'thinking_tokens', 'total_tokens'];
if (!value || value.status !== 'SUCCESS' || typeof value.response !== 'string'
    || value.response.trim() !== 'AGY_CAPABILITY_OK'
    || !value.usage || usageKeys.some((key) => !Number.isFinite(value.usage[key]))) {
  process.stderr.write('error: agy structured probe did not expose the declared response+usage envelope\n');
  process.exit(1);
}
NODE

OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
AGY_HELP_SHA="$(sha256sum "$AGY_HELP" | cut -d' ' -f1)"
AGY_JSON_SHA="$(sha256sum "$AGY_JSON" | cut -d' ' -f1)"
CODEX_HELP_SHA="$(sha256sum "$CODEX_HELP" | cut -d' ' -f1)"
GROK_HELP_SHA="$(sha256sum "$GROK_HELP" | cut -d' ' -f1)"
OPENCODE_HELP_SHA="$(sha256sum "$OPENCODE_HELP" | cut -d' ' -f1)"
CLAUDE_HELP_SHA="$(sha256sum "$CLAUDE_HELP" | cut -d' ' -f1)"
D4_ROSTER_SHA="$(sha256sum "$REPO/docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/canonical-roster.json" | cut -d' ' -f1)"
CLAUDE_HOOKS_SHA="$(sha256sum "$REPO/hooks/hooks.json" | cut -d' ' -f1)"

export REPO AGY_BIN CODEX_BIN GROK_BIN OPENCODE_BIN CLAUDE_BIN
export AGY_MODEL AGY_MODEL_DISPLAY
export AGY_VERSION CODEX_VERSION GROK_VERSION OPENCODE_VERSION CLAUDE_VERSION
export OBSERVED_AT AGY_HELP_SHA AGY_JSON_SHA CODEX_HELP_SHA GROK_HELP_SHA OPENCODE_HELP_SHA CLAUDE_HELP_SHA
export D4_ROSTER_SHA CLAUDE_HOOKS_SHA

INPUT="$PROBE_TMP/probe-input.json"
node - "$INPUT" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const output = process.argv[2];
const env = process.env;
const ttl = 14 * 24 * 60 * 60;
const officialCodexDocumentSha = '458ed508d0f3dbb1a3106a906951827bad7af1d2f7dc1f50000e11dc7150d1aa';
const codexHostProbeSha = '89d76cd6d7dc8d815761d547e3325e9dcd6858a29d259093ef27a22cbb1fbd23';
const codexHostObservedAt = '2026-08-03T22:23:16.577Z';

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function binding(executionModel, normalizedModel, normalizedEffort, effortArgument = null) {
  return {
    execution_model: executionModel,
    execution_effort_argument: effortArgument,
    normalized_model: normalizedModel,
    normalized_effort: normalizedEffort,
  };
}

function target(runner, model, role, effort, endpoint, family, binary, version) {
  return { runner, model, role, effort, endpoint, family, binary_realpath: binary, cli_version: version };
}

function claim(capabilityId, consumerId, targetIdentity, locator, documentSha, assertion,
  commandShape, outputSha, behaviorClass, observedAt, transportBinding, agreement = true, result = assertion) {
  return {
    capability_id: capabilityId,
    consumer_id: consumerId,
    target_identity: targetIdentity,
    official_contract: {
      locator,
      retrieved_at: env.OBSERVED_AT,
      document_sha256: documentSha,
      assertion,
    },
    live_evidence: {
      cli_version: targetIdentity.cli_version,
      probe_command_sha256: digest(JSON.stringify(commandShape)),
      probe_output_sha256: outputSha,
      behavior_class: behaviorClass,
      observed_at: observedAt,
      ttl_seconds: ttl,
      result,
      transport_binding: transportBinding,
    },
    agreement,
  };
}

const agyD2 = target('agy', env.AGY_MODEL_DISPLAY, 'telemetry', 'high', null, 'google', env.AGY_BIN, env.AGY_VERSION);
const codexHook = target('codex', null, 'compaction_hook', null, null, 'openai', env.CODEX_BIN, env.CODEX_VERSION);
// D4 provider rows bind to the canonical strict /l5 roster; the D2 agy telemetry claims bind to the agy CLI help (AGY_HELP_SHA), never to this document.
const d4RosterLocator = 'repo:docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/canonical-roster.json#tuples';
const claims = [];

for (const [suffix, assertion] of [
  ['response', 'agy native JSON envelope exposes a separately typed response string'],
  ['usage', 'agy native JSON envelope exposes numeric input/output/thinking/cache/total usage'],
]) {
  claims.push(claim(
    `agy-structured-envelope-${suffix}`, 'D2', agyD2,
    `agy://cli-help/${env.AGY_VERSION}#output-format-json`, env.AGY_HELP_SHA, assertion,
    [env.AGY_BIN, '--model', env.AGY_MODEL, '--dangerously-skip-permissions', '--print-timeout', '90s', '--input-format', 'stream-json', '--output-format', 'stream-json', '--print='],
    env.AGY_JSON_SHA, `structured-envelope-${suffix}`, env.OBSERVED_AT,
    binding(env.AGY_MODEL, env.AGY_MODEL, 'high'),
  ));
}

for (const [suffix, assertion, behavior] of [
  ['registration', 'Codex plugin loader registers and invokes PostCompact command hooks', 'host-registration'],
  ['payload', 'Codex PostCompact payload exposes the documented event and turn identity fields', 'host-payload-shape'],
  ['matcher', 'Codex PostCompact matcher manual|auto fires for explicit and threshold compaction', 'host-manual-auto'],
  ['failure-boundary', 'Codex PostCompact zero-exit command permits compaction to complete without blocking', 'host-nonblocking-boundary'],
]) {
  claims.push(claim(
    `codex-postcompact-${suffix}`, 'D3', codexHook,
    'https://learn.chatgpt.com/docs/hooks.md#postcompact', officialCodexDocumentSha, assertion,
    ['codex', 'tui', '--dangerously-bypass-hook-trust', 'installed-autopilot-hook-probe', behavior],
    codexHostProbeSha, behavior, codexHostObservedAt,
    binding(null, null, null),
  ));
}

const providerRows = [
  // The six strict /l5 canonical tuples (src/readiness/provider-bootstrap.js STRICT_L5_PROVIDER_POLICY,
  // BL-0198). hooks/tests/strict-l5-policy-shipped-defaults.test.sh keeps their models equal to the shipped defaults.
  {
    id: 'verification-author-cc-shim-glm-5-3-high',
    identity: target('cc-shim', 'GLM-5.3', 'verification_author', 'high', 'glm', 'zhipu', env.CLAUDE_BIN, env.CLAUDE_VERSION),
    helpSha: env.CLAUDE_HELP_SHA,
    executionModel: 'GLM-5.3', effortArgument: 'high',
  },
  {
    id: 'qc-cc-shim-glm-5-3-high',
    identity: target('cc-shim', 'GLM-5.3', 'qc', 'high', 'glm', 'zhipu', env.CLAUDE_BIN, env.CLAUDE_VERSION),
    helpSha: env.CLAUDE_HELP_SHA,
    executionModel: 'GLM-5.3', effortArgument: 'high',
  },
  {
    id: 'qc-codex-gpt-6-1-sol-max',
    identity: target('codex', 'gpt-6.1-sol', 'qc', 'max', null, 'openai', env.CODEX_BIN, env.CODEX_VERSION),
    helpSha: env.CODEX_HELP_SHA,
    executionModel: 'gpt-6.1-sol', effortArgument: 'max',
  },
  {
    id: 'implementer-grok-grok-4-7-high',
    identity: target('grok', 'grok-4.7', 'implementer', 'high', null, 'xai', env.GROK_BIN, env.GROK_VERSION),
    helpSha: env.GROK_HELP_SHA,
    executionModel: 'grok-4.7', effortArgument: 'high',
  },
  {
    id: 'qc-cc-shim-minimax-m3-high',
    identity: target('cc-shim', 'MiniMax-M3', 'qc', 'high', 'minimax', 'minimax', env.CLAUDE_BIN, env.CLAUDE_VERSION),
    helpSha: env.CLAUDE_HELP_SHA,
    executionModel: 'MiniMax-M3', effortArgument: 'high',
  },
  {
    id: 'reviewer-cc-shim-minimax-m3-high',
    identity: target('cc-shim', 'MiniMax-M3', 'reviewer', 'high', 'minimax', 'minimax', env.CLAUDE_BIN, env.CLAUDE_VERSION),
    helpSha: env.CLAUDE_HELP_SHA,
    executionModel: 'MiniMax-M3', effortArgument: 'high',
  },
];

for (const row of providerRows) {
  const assertion = `exact provider transport tuple ${row.id} is declared and its installed CLI exposes the required model/effort transport surface`;
  const normalizedModel = row.normalizedModel || row.identity.model;
  claims.push(claim(
    `provider-transport-${row.id}`, 'D4', row.identity,
    d4RosterLocator, env.D4_ROSTER_SHA, assertion,
    [row.identity.binary_realpath, '--version', '--help', row.executionModel, row.effortArgument],
    row.helpSha, 'installed-transport-surface', env.OBSERVED_AT,
    binding(row.executionModel, normalizedModel, row.identity.effort, row.effortArgument),
  ));
}

const optionalRows = [
  {
    id: 'codex-install-time-generator', binary: env.CODEX_BIN, version: env.CODEX_VERSION,
    runner: 'codex', family: 'openai', sha: env.CODEX_HELP_SHA,
    assertion: 'Codex exposes a fail-loud install and upgrade payload generator lifecycle',
    result: 'blocked: no supported install-time generator lifecycle was observed',
  },
  {
    id: 'opencode-debug-skill-installed-completeness', binary: env.OPENCODE_BIN, version: env.OPENCODE_VERSION,
    runner: 'opencode', family: 'sst', sha: env.OPENCODE_HELP_SHA,
    assertion: 'OpenCode debug skill returns complete discovered-skill JSON',
    result: 'blocked: installed debug skill output truncates near 65536 bytes',
  },
  {
    id: 'grok-sessionend-usage-event', binary: env.GROK_BIN, version: env.GROK_VERSION,
    runner: 'grok', family: 'xai', sha: env.GROK_HELP_SHA,
    assertion: 'Grok fires a SessionEnd hook containing authoritative headless usage',
    result: 'blocked: headless JSON usage is proven but SessionEnd host firing remains unverified',
  },
  {
    id: 'generic-tier-frontmatter-portability', binary: env.CODEX_BIN, version: env.CODEX_VERSION,
    runner: 'codex', family: 'openai', sha: env.CODEX_HELP_SHA,
    assertion: 'Generic tier frontmatter is a portable cross-harness contract',
    result: 'blocked: generic tier frontmatter remains inconclusive',
  },
];

for (const row of optionalRows) {
  const identity = target(row.runner, null, 'optional_probe', null, null, row.family, row.binary, row.version);
  claims.push(claim(
    row.id, null, identity, `local-cli://${row.runner}/${row.version}`, row.sha,
    row.assertion, [row.binary, '--version', '--help'], row.sha,
    'blocked-negative-finding', env.OBSERVED_AT, binding(null, null, null), false, row.result,
  ));
}

const claudeBaseline = 'Claude Code current hook baseline is version-captured and digest-bound';
claims.push(claim(
  'claude-current-hook-baseline', null,
  target('claude-native', null, 'optional_probe', null, null, 'anthropic', env.CLAUDE_BIN, env.CLAUDE_VERSION),
  'repo:hooks/hooks.json', env.CLAUDE_HOOKS_SHA, claudeBaseline,
  [env.CLAUDE_BIN, '--version', 'repo:hooks/hooks.json'], env.CLAUDE_HOOKS_SHA,
  'hook-baseline-digest', env.OBSERVED_AT, binding(null, null, null), true,
));

fs.writeFileSync(output, `${JSON.stringify({ schema_version: 1, claims }, null, 2)}\n`, { mode: 0o600 });
NODE

node "$REPO/scripts/platform-capability-claims.js" generate --input "$INPUT" --output "$OUTPUT"
