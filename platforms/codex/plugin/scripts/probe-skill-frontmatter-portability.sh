#!/usr/bin/env bash
# Probe whether installed Claude Code and Codex tolerate an unknown skill
# frontmatter field without changing the skill contract. This is an evidence
# probe, not a metadata migration tool.
set -euo pipefail

usage() {
  sed -n '2,7p' "$0"
  cat <<'USAGE'

Usage:
  scripts/probe-skill-frontmatter-portability.sh --check [--output FILE]
  scripts/probe-skill-frontmatter-portability.sh --validate FILE

--check       Run isolated Claude Code and Codex probes and write a receipt.
--validate    Validate an existing receipt without running either runtime.
USAGE
}

MODE=""
OUTPUT="docs/projects/2026-08-02-backlog-actionable-successor/evidence/skill-metadata-portability.json"
VALIDATE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --validate)
      MODE="validate"
      shift
      VALIDATE="$1"
      [ -n "$VALIDATE" ] || { echo "--validate requires a receipt path" >&2; exit 2; }
      ;;
    --output)
      shift
      OUTPUT="$1"
      [ -n "$OUTPUT" ] || { echo "--output requires a path" >&2; exit 2; }
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { usage >&2; exit 2; }

if [ "$MODE" = "validate" ]; then
  node - "$VALIDATE" <<'NODE'
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const file = process.argv[2];
let value;
const errors = [];
try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (error) { console.error('invalid JSON: ' + error.message); process.exit(1); }
const isHex = (input) => typeof input === 'string' && /^[0-9a-f]{64}$/.test(input);
const outcomes = new Set(['pass', 'fail', 'inconclusive']);
const isPath = (input) => typeof input === 'string' && path.isAbsolute(input);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : (value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value));
const receiptBody = value && typeof value === 'object' ? { ...value } : {};
delete receiptBody.receipt_digest;
if (!value || !isHex(value.receipt_digest) || sha256(canonical(receiptBody)) !== value.receipt_digest) errors.push('receipt digest invalid');
const challengeFrom = (raw) => {
  const matches = [...String(raw || '').matchAll(/AUTOPILOT_SKILL_CHALLENGE_[0-9a-f]{32}/g)].map((m) => m[0]);
  return [...new Set(matches)].length === 1 ? matches[0] : '';
};
const expectedVersion = (runtime) => runtime === 'claude' ? /^2\.1\.220(?:\s|$)/ : /^codex-cli 0\.146\.0(?:\s|$)/;
const classifyAttempt = ({ executable, executed, version, codes, text, detailsGreen, challenge }) => {
  if (!executable || !executed || !version) return 'inconclusive';
  const steps = [...String(text).matchAll(/AUTOPILOT_STEP \S+ (-?\d+)\n([\s\S]*?)(?=AUTOPILOT_STEP \S+ -?\d+\n|$)/g)];
  if (steps.length && (steps.length !== codes.length * 2 || steps.some((m, i) => Number(m[1]) !== codes[i % codes.length]))) return 'inconclusive';
  const failed = (steps.length ? steps.filter((m) => Number(m[1]) !== 0).map((m) => m[2]) : [text]).join('\n');
  const infra = /\b(?:not logged in|log in required|run \/login|authentication (?:failed|required)|unauthorized|invalid (?:api )?key|timed? out|timeout|network|transport|ECONN[A-Z]+|ENETUNREACH|EAI_AGAIN|rate limit|quota)\b/i.test(failed) || codes.some((code) => [124, 137, 143].includes(code));
  const rejected = /(?:unknown|unrecognized|unsupported|additional)[^\n]{0,40}\b(?:field|property|key)s?\b[^\n]{0,80}\btier\b|\btier\b[^\n]{0,80}\b(?:not allowed|unknown|unrecognized|unsupported)\b/i.test(failed);
  if (codes.every((code) => code === 0) && detailsGreen && challenge) return 'pass';
  return !infra && rejected && codes.some((code) => code !== 0) ? 'fail' : 'inconclusive';
};
const evidenceDir = value && value.cleanup && isPath(value.cleanup.retained_evidence_dir)
  ? path.resolve(value.cleanup.retained_evidence_dir) : '';
const retainedFile = (target, label) => {
  if (!isPath(target)) { errors.push(label + ' path missing'); return null; }
  const resolved = path.resolve(target);
  const relative = evidenceDir ? path.relative(evidenceDir, resolved) : '..';
  if (!evidenceDir || relative.startsWith('..') || path.isAbsolute(relative)) { errors.push(label + ' escapes retained evidence directory'); return null; }
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('must be a regular 0600 file');
    return fs.readFileSync(resolved);
  } catch (error) { errors.push(label + ' unavailable: ' + error.message); return null; }
};
const readEvidence = (attempt, key, label) => {
  const target = attempt[key];
  if (!isPath(target)) { errors.push(attempt.runtime + ': ' + label + ' path missing'); return null; }
  const resolved = path.resolve(target);
  const relative = evidenceDir ? path.relative(evidenceDir, resolved) : '..';
  if (!evidenceDir || relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push(attempt.runtime + ': ' + label + ' escapes retained evidence directory');
    return null;
  }
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('must be a regular 0600 file');
    return fs.readFileSync(resolved);
  } catch (error) { errors.push(attempt.runtime + ': ' + label + ' unavailable: ' + error.message); return null; }
};
if (!value || value.schema_version !== 1) errors.push('schema_version must be 1');
if (value && value.artifact_type !== 'skill_frontmatter_portability') errors.push('artifact_type mismatch');
if (!value || !value.observed_at || Number.isNaN(Date.parse(value.observed_at))) errors.push('observed_at missing');
if (!value || !value.fixture || value.fixture.skill_name !== 'portability-probe') errors.push('fixture identity missing');
const fixtureBytes = value && value.fixture ? retainedFile(value.fixture.path, 'fixture') : null;
if (fixtureBytes) {
  const expectedFixture = `---\nname: portability-probe\ndescription: Disposable frontmatter portability probe\ntier: core\n---\n# Portability probe\n\nWhen this skill is invoked, respond with exactly:\nthe output of: printf '%s' "$AUTOPILOT_PROBE_CHALLENGE"\nThe challenge is supplied only in the skill runtime environment. Never invent,\nrepeat, or quote a literal challenge from the invocation prompt.\n`;
  if (fixtureBytes.toString('utf8') !== expectedFixture
      || value.fixture.description !== 'Disposable frontmatter portability probe'
      || value.fixture.unknown_field !== 'tier' || value.fixture.tier_value !== 'core'
      || value.fixture.bytes !== fixtureBytes.length || value.fixture.body_sha256 !== sha256(fixtureBytes)) errors.push('retained fixture bytes or exact frontmatter/body binding mismatch');
}
const manifestBytes = retainedFile(value && value.execution_manifest_path, 'execution manifest');
let manifest = [];
if (manifestBytes) {
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (error) { errors.push('execution manifest invalid JSON: ' + error.message); }
  if (!isHex(value.execution_manifest_sha256) || value.execution_manifest_sha256 !== sha256(manifestBytes)
      || canonical(manifest) !== canonical(value.execution_manifest)) errors.push('execution manifest digest/content mismatch');
}
const expectedStepNames = ['claude_probe', 'claude_exec', 'codex_probe', 'codex_list', 'codex_add', 'codex_exec'];
if (!Array.isArray(manifest) || manifest.length !== expectedStepNames.length) errors.push('execution manifest must contain every step');
else manifest.forEach((step, index) => {
  if (!step || step.order !== index + 1 || step.name !== expectedStepNames[index]
      || step.runtime !== (index < 2 ? 'claude' : 'codex') || !Number.isInteger(step.exit_code)
      || typeof step.executed !== 'boolean' || !Array.isArray(step.argv) || step.argv.length === 0
      || step.argv.some((arg) => typeof arg !== 'string' || /^<(?:plugin|marketplace|scratch)>$/.test(arg))
      || !isPath(step.cwd) || (step.executed && (!isPath(step.executable) || step.argv[0] !== step.executable))) errors.push(`execution manifest step ${index + 1} is not exact`);
  if (!Array.isArray(step.env_bindings)) errors.push(`execution manifest step ${index + 1} env missing`);
  else for (const binding of step.env_bindings) {
    if (!binding || typeof binding.name !== 'string' || typeof binding.secret !== 'boolean'
        || (binding.secret ? (Object.prototype.hasOwnProperty.call(binding, 'value') || !isHex(binding.value_sha256)) : !isPath(binding.value))) errors.push(`execution manifest step ${index + 1} env binding invalid`);
  }
});
if (!value || !Array.isArray(value.attempts) || value.attempts.length !== 2) errors.push('exactly two runtime attempts required');
const attempts = value && Array.isArray(value.attempts) ? value.attempts : [];
const names = new Set();
for (const attempt of attempts) {
  if (!attempt || typeof attempt !== 'object') { errors.push('attempt must be an object'); continue; }
  names.add(attempt.runtime);
  if (!['claude', 'codex'].includes(attempt.runtime)) errors.push('unknown runtime ' + attempt.runtime);
  if (!Array.isArray(attempt.command) || attempt.command.length === 0) errors.push(attempt.runtime + ': command missing');
  if (typeof attempt.command_text !== 'string' || attempt.command_text.length === 0) errors.push(attempt.runtime + ': command_text missing');
  if (typeof attempt.command_sha256 !== 'string' || !isHex(attempt.command_sha256)
      || attempt.command_text !== attempt.command.join(' ')
      || attempt.command_sha256 !== sha256(canonical(attempt.command))) errors.push(attempt.runtime + ': command evidence mismatch');
  const runtimeSteps = manifest.filter((step) => step.runtime === attempt.runtime);
  const manifestCommand = runtimeSteps.flatMap((step, index) => index === 0 ? step.argv : ['&&', ...step.argv]);
  if (canonical(manifestCommand) !== canonical(attempt.command)
      || canonical(runtimeSteps.map((step) => step.exit_code)) !== canonical(attempt.probe_exit_codes)) errors.push(attempt.runtime + ': command/exit evidence does not recompute from execution manifest');
  if (typeof attempt.executable_present !== 'boolean') errors.push(attempt.runtime + ': executable_present missing');
  if (typeof attempt.execution_attempted !== 'boolean') errors.push(attempt.runtime + ': execution_attempted missing');
  if (attempt.executable_present && !attempt.execution_attempted) errors.push(attempt.runtime + ': installed runtime was not executed');
  if (!outcomes.has(attempt.outcome)) errors.push(attempt.runtime + ': invalid outcome');
  if (attempt.execution_attempted && !Number.isInteger(attempt.exit_code)) errors.push(attempt.runtime + ': exit_code missing');
  if (!Array.isArray(attempt.probe_exit_codes) || !attempt.probe_exit_codes.every(Number.isInteger)) errors.push(attempt.runtime + ': probe exit evidence missing');
  if (!Array.isArray(attempt.before_inventory) || !Array.isArray(attempt.after_inventory)) errors.push(attempt.runtime + ': inventories missing');
  for (const key of ['stdout_sha256', 'stderr_sha256', 'fixture_sha256', 'version_sha256', 'before_inventory_sha256', 'after_inventory_sha256', 'details_sha256', 'challenge_sha256']) if (!isHex(attempt[key])) errors.push(attempt.runtime + ': ' + key + ' invalid');
  if (fixtureBytes && attempt.fixture_sha256 !== sha256(fixtureBytes)) errors.push(attempt.runtime + ': fixture digest is not bound to retained bytes');
  for (const key of ['stdout_excerpt', 'stderr_excerpt']) if (typeof attempt[key] !== 'string') errors.push(attempt.runtime + ': ' + key + ' missing');
  if (typeof attempt.stdout_bytes !== 'number' || typeof attempt.stderr_bytes !== 'number') errors.push(attempt.runtime + ': log byte counts missing');
  const versionRawBuffer = readEvidence(attempt, 'version_log_path', 'version evidence');
  if (versionRawBuffer) {
    const versionRaw = versionRawBuffer.toString('utf8');
    if (sha256(versionRaw) !== attempt.version_sha256 || versionRaw.length !== attempt.version_bytes
        || versionRaw.trim() !== attempt.version || !expectedVersion(attempt.runtime).test(versionRaw)) {
      errors.push(attempt.runtime + ': version evidence mismatch');
    }
  }
  const beforeBuffer = readEvidence(attempt, 'before_inventory_path', 'before inventory evidence');
  const afterBuffer = readEvidence(attempt, 'after_inventory_path', 'after inventory evidence');
  for (const [buffer, field, digestField] of [[beforeBuffer, 'before_inventory', 'before_inventory_sha256'], [afterBuffer, 'after_inventory', 'after_inventory_sha256']]) {
    if (!buffer) continue;
    const text = buffer.toString('utf8');
    let parsedInventory;
    try { parsedInventory = JSON.parse(text); } catch (_error) { errors.push(attempt.runtime + ': inventory evidence is not JSON'); continue; }
    if (!Array.isArray(parsedInventory) || canonical(parsedInventory) !== canonical(attempt[field])
        || sha256(text) !== attempt[digestField]) errors.push(attempt.runtime + ': inventory evidence mismatch');
  }
  const detailBuffer = readEvidence(attempt, 'details_path', 'details evidence');
  if (detailBuffer) {
    const detailText = detailBuffer.toString('utf8');
    try {
      if (canonical(JSON.parse(detailText)) !== canonical(attempt.details) || sha256(detailText) !== attempt.details_sha256) errors.push(attempt.runtime + ': details evidence mismatch');
    } catch (_error) { errors.push(attempt.runtime + ': details evidence is not JSON'); }
  }
  const stdoutForChallenge = readEvidence(attempt, 'stdout_log_path', 'stdout log');
  const challenge = stdoutForChallenge ? challengeFrom(stdoutForChallenge.toString('utf8')) : '';
  if (attempt.outcome === 'pass'
      && (!Number.isInteger(attempt.challenge_bytes) || attempt.challenge_bytes <= 0
      || !isHex(attempt.challenge_sha256) || !challenge
      || sha256(challenge) !== attempt.challenge_sha256
      || Buffer.byteLength(challenge, 'utf8') !== attempt.challenge_bytes
      || attempt.challenge_seen !== true || attempt.details?.challenge_seen !== true)) {
    errors.push(attempt.runtime + ': per-attempt skill challenge evidence is missing or invalid');
  }
  const stderrForClassification = readEvidence(attempt, 'stderr_log_path', 'stderr log');
  const evidenceText = `${stdoutForChallenge ? stdoutForChallenge.toString('utf8') : ''}\n${stderrForClassification ? stderrForClassification.toString('utf8') : ''}`;
  const versionOk = typeof attempt.version === 'string' && expectedVersion(attempt.runtime).test(attempt.version_raw || '');
  const detailsGreen = attempt.runtime === 'claude'
    ? attempt.details && attempt.details.manifest_validation === true
    : attempt.details && attempt.details.marketplace_discovered === true && attempt.details.installed_skill_exact === true;
  const recomputedOutcome = classifyAttempt({ executable: attempt.executable_present, executed: attempt.execution_attempted, version: versionOk, codes: attempt.probe_exit_codes, text: evidenceText, detailsGreen, challenge: attempt.challenge_seen && Boolean(challenge) });
  if (attempt.outcome !== recomputedOutcome) errors.push(attempt.runtime + ': outcome does not match retained evidence');
  for (const key of ['stdout_log_path', 'stderr_log_path']) {
    if (!isPath(attempt[key])) { errors.push(attempt.runtime + ': ' + key + ' missing'); continue; }
    try {
      const logPath = path.resolve(attempt[key]);
      const evidenceDir = value && value.cleanup && value.cleanup.retained_evidence_dir
        ? path.resolve(value.cleanup.retained_evidence_dir) : '';
      const relative = evidenceDir ? path.relative(evidenceDir, logPath) : '..';
      if (!evidenceDir || relative.startsWith('..') || path.isAbsolute(relative)) errors.push(attempt.runtime + ': raw log escapes retained evidence directory');
      const stat = fs.lstatSync(logPath);
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) errors.push(attempt.runtime + ': raw log must be a regular 0600 file');
      const raw = fs.readFileSync(logPath);
      const digest = require('crypto').createHash('sha256').update(raw).digest('hex');
      const bytes = raw.length;
      const isStdout = key === 'stdout_log_path';
      if (digest !== attempt[isStdout ? 'stdout_sha256' : 'stderr_sha256']) errors.push(attempt.runtime + ': raw log digest mismatch');
      if (bytes !== attempt[isStdout ? 'stdout_bytes' : 'stderr_bytes']) errors.push(attempt.runtime + ': raw log byte count mismatch');
    } catch (error) { errors.push(attempt.runtime + ': raw log unavailable: ' + error.message); }
  }
}
if (!names.has('claude') || !names.has('codex')) errors.push('claude and codex attempts are required');
const expected = attempts.some((row) => row.outcome === 'fail') ? 'fail'
  : attempts.some((row) => row.outcome === 'inconclusive') ? 'inconclusive' : 'pass';
if (!value || value.classification !== expected) errors.push('classification does not match attempt outcomes');
if (!value || !value.cleanup || value.cleanup.zero_residue !== true
    || !Array.isArray(value.cleanup.residue_paths) || value.cleanup.residue_paths.length !== 0) errors.push('cleanup residue receipt is not empty');
if (!value || !value.cleanup || value.cleanup.attempt_dir_mode !== '0700') errors.push('attempt directory mode is not 0700');
if (!value || !value.cleanup || !isPath(value.cleanup.retained_evidence_dir)) errors.push('retained evidence directory missing');
else {
  try {
    const stat = fs.lstatSync(value.cleanup.retained_evidence_dir);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) errors.push('retained evidence directory must be a regular 0700 directory');
  } catch (error) { errors.push('retained evidence directory unavailable: ' + error.message); }
}
if (!value || !value.fixture || value.fixture.unknown_field !== 'tier') errors.push('unknown tier field not recorded');
if (errors.length) { errors.forEach((error) => console.error('receipt: ' + error)); process.exit(1); }
console.log('valid=true classification=' + value.classification);
NODE
  exit $?
fi

mkdir -p "$(dirname "$OUTPUT")"
RETAINED_ROOT="$(mktemp -d -t autopilot-frontmatter-evidence-XXXXXX)"
chmod 700 "$RETAINED_ROOT"
SUFFIX='X'
SUFFIX="${SUFFIX}X"
SUFFIX="${SUFFIX}X"
ROOT="$(mktemp -d -t "autopilot-frontmatter-probe-${SUFFIX}")"
chmod 700 "$ROOT"
cleanup_runtime() { rm -rf -- "$ROOT"; }
trap cleanup_runtime EXIT HUP INT TERM
challenge() {
  local bytes
  bytes="$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || true)"
  printf 'AUTOPILOT_SKILL_CHALLENGE_%s' "${bytes:-00000000000000000000000000000000}"
}
CLAUDE_CHALLENGE="$(challenge)"
CODEX_CHALLENGE="$(challenge)"
mkdir -p "$ROOT/tmp" "$ROOT/claude-home" "$ROOT/claude-config" "$ROOT/codex-home" "$ROOT/codex-home-home" "$ROOT/codex-scratch"
chmod 700 "$ROOT/claude-home" "$ROOT/claude-config" "$ROOT/codex-home" "$ROOT/codex-home-home"

PLUGIN="$ROOT/claude-plugin"
mkdir -p "$PLUGIN/.claude-plugin" "$PLUGIN/skills/portability-probe"
cat > "$PLUGIN/.claude-plugin/plugin.json" <<'JSON'
{
  "name": "autopilot-frontmatter-probe",
  "version": "0.0.1",
  "description": "Disposable frontmatter portability probe",
  "author": {"name": "Autopilot Probe"},
  "skills": "./skills/"
}
JSON
cat > "$PLUGIN/skills/portability-probe/SKILL.md" <<'SKILL'
---
name: portability-probe
description: Disposable frontmatter portability probe
tier: core
---
# Portability probe

When this skill is invoked, respond with exactly:
the output of: printf '%s' "$AUTOPILOT_PROBE_CHALLENGE"
The challenge is supplied only in the skill runtime environment. Never invent,
repeat, or quote a literal challenge from the invocation prompt.
SKILL

CODEX_MARKETPLACE="$ROOT/codex-marketplace"
CODEX_PLUGIN="$CODEX_MARKETPLACE/plugin"
mkdir -p "$CODEX_PLUGIN/.codex-plugin" "$CODEX_PLUGIN/skills/portability-probe" "$CODEX_MARKETPLACE/.agents/plugins"
cp "$PLUGIN/skills/portability-probe/SKILL.md" "$CODEX_PLUGIN/skills/portability-probe/SKILL.md"
cat > "$CODEX_PLUGIN/.codex-plugin/plugin.json" <<'JSON'
{
  "name": "autopilot-frontmatter-probe",
  "version": "0.0.1",
  "description": "Disposable frontmatter portability probe",
  "author": {"name": "Autopilot Probe"},
  "skills": "./skills/",
  "interface": {
    "displayName": "Autopilot Frontmatter Probe",
    "shortDescription": "Disposable portability probe",
    "longDescription": "Loads one skill containing an unknown frontmatter field.",
    "developerName": "Autopilot Probe",
    "category": "Developer Tools",
    "capabilities": ["Read"],
    "defaultPrompt": ["Run the portability probe skill."],
    "brandColor": "#0F766E",
    "screenshots": []
  }
}
JSON
cat > "$CODEX_MARKETPLACE/.agents/plugins/marketplace.json" <<'JSON'
{
  "name": "autopilot-frontmatter-probe-local",
  "interface": {"displayName": "Autopilot Frontmatter Probe Local"},
  "plugins": [{
    "name": "autopilot-frontmatter-probe",
    "source": {"source": "local", "path": "./plugin"},
    "version": "0.0.1",
    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
    "category": "Developer Tools"
  }]
}
JSON

inventory() {
  local target="$1"
  if [ ! -d "$target" ]; then printf '[]\n'; return; fi
  find "$target" -mindepth 1 -maxdepth 4 -print 2>/dev/null |
    sed "s#^$target/##" | LC_ALL=C sort |
    node -e 'const fs=require("fs"); const rows=fs.readFileSync(0,"utf8").split(/\n/).filter(Boolean); process.stdout.write(JSON.stringify(rows));'
}

record_launch() {
  local name="$1"; shift
  printf '%s\0' "$@" > "$ROOT/$name.argv0"
  local -a args=("$@")
  local index=0 command_name
  if [ "${args[0]:-}" = env ]; then
    index=1
    while [ "$index" -lt "${#args[@]}" ] && [[ "${args[$index]}" == *=* ]]; do index=$((index + 1)); done
  fi
  command_name="${args[$index]:-}"
  command -v "$command_name" > "$ROOT/$name.executable" 2>/dev/null || : > "$ROOT/$name.executable"
}

run_capture() {
  local name="$1"; shift
  record_launch "$name" "$@"
  local stdout="$ROOT/$name.stdout" stderr="$ROOT/$name.stderr" rc
  set +e
  timeout --foreground --kill-after=5s 45 "$@" < /dev/null >"$stdout" 2>"$stderr"
  rc=$?
  set -e
  printf '%s\n' "$rc" > "$ROOT/$name.rc"
}

CLAUDE_BEFORE="$(inventory "$ROOT/claude-home")"
CODEX_BEFORE="$(inventory "$ROOT/codex-home")"

if command -v claude >/dev/null 2>&1; then
  CLAUDE_VERSION="$(HOME="$ROOT/claude-home" CLAUDE_CONFIG_DIR="$ROOT/claude-config" TMPDIR="$ROOT/tmp" claude --version 2>&1 || true)"
  run_capture claude_probe env HOME="$ROOT/claude-home" CLAUDE_CONFIG_DIR="$ROOT/claude-config" TMPDIR="$ROOT/tmp" claude plugin validate "$PLUGIN"
  run_capture claude_exec env HOME="$ROOT/claude-home" CLAUDE_CONFIG_DIR="$ROOT/claude-config" TMPDIR="$ROOT/tmp" AUTOPILOT_PROBE_CHALLENGE="$CLAUDE_CHALLENGE" claude --bare --plugin-dir "$PLUGIN" -p '/portability-probe' --output-format json --max-budget-usd 0.01 --no-session-persistence
else
  CLAUDE_VERSION=""
  record_launch claude_probe env HOME="$ROOT/claude-home" CLAUDE_CONFIG_DIR="$ROOT/claude-config" TMPDIR="$ROOT/tmp" claude plugin validate "$PLUGIN"
  record_launch claude_exec env HOME="$ROOT/claude-home" CLAUDE_CONFIG_DIR="$ROOT/claude-config" TMPDIR="$ROOT/tmp" AUTOPILOT_PROBE_CHALLENGE="$CLAUDE_CHALLENGE" claude --bare --plugin-dir "$PLUGIN" -p '/portability-probe' --output-format json --max-budget-usd 0.01 --no-session-persistence
  printf '%s\n' "claude executable not found" > "$ROOT/claude_probe.stderr" "$ROOT/claude_exec.stderr"
  printf '%s\n' "127" > "$ROOT/claude_probe.rc" "$ROOT/claude_exec.rc"
fi

if command -v codex >/dev/null 2>&1; then
  CODEX_VERSION="$(HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex --version 2>&1 || true)"
  run_capture codex_probe env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex plugin marketplace add "$CODEX_MARKETPLACE" --json
  run_capture codex_list env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex plugin list --marketplace autopilot-frontmatter-probe-local --available --json
  run_capture codex_add env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex plugin add autopilot-frontmatter-probe@autopilot-frontmatter-probe-local --json
  run_capture codex_exec env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" AUTOPILOT_PROBE_CHALLENGE="$CODEX_CHALLENGE" codex exec --ephemeral --sandbox read-only --json --skip-git-repo-check -C "$ROOT/codex-scratch" '<invoke $autopilot-frontmatter-probe:portability-probe; respond with exactly the challenge obtained from the skill>'
else
  CODEX_VERSION=""
  record_launch codex_probe env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex plugin marketplace add "$CODEX_MARKETPLACE" --json
  record_launch codex_list env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex plugin list --marketplace autopilot-frontmatter-probe-local --available --json
  record_launch codex_add env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex plugin add autopilot-frontmatter-probe@autopilot-frontmatter-probe-local --json
  record_launch codex_exec env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" AUTOPILOT_PROBE_CHALLENGE="$CODEX_CHALLENGE" codex exec --ephemeral --sandbox read-only --json --skip-git-repo-check -C "$ROOT/codex-scratch" '<invoke $autopilot-frontmatter-probe:portability-probe; respond with exactly the challenge obtained from the skill>'
  printf '%s\n' "codex executable not found" > "$ROOT/codex_probe.stderr" "$ROOT/codex_list.stderr" "$ROOT/codex_add.stderr"
  printf '%s\n' "127" > "$ROOT/codex_probe.rc" "$ROOT/codex_list.rc" "$ROOT/codex_add.rc" "$ROOT/codex_exec.rc"
fi

CLAUDE_AFTER="$(inventory "$ROOT/claude-home")"
CODEX_AFTER="$(inventory "$ROOT/codex-home")"
export ROOT OUTPUT RETAINED_ROOT CLAUDE_VERSION CODEX_VERSION CLAUDE_BEFORE CLAUDE_AFTER CODEX_BEFORE CODEX_AFTER CLAUDE_CHALLENGE CODEX_CHALLENGE

node - <<'NODE'
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const root = process.env.ROOT;
const output = path.resolve(process.env.OUTPUT);
const retainedRoot = path.resolve(process.env.RETAINED_ROOT);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (name) => fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8') : '';
const rc = (name) => Number.parseInt(read(name + '.rc').trim(), 10);
const excerpt = (value) => value.length > 8192 ? value.slice(0, 8192) : value;
const parsed = (json) => { try { return JSON.parse(json); } catch { return null; } };
const canonical = (value) => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : (value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value));
const body = fs.readFileSync(path.join(root, 'claude-plugin/skills/portability-probe/SKILL.md'));
const fixtureSha = sha256(body);
const combined = (names, stream) => names.map((name) => `AUTOPILOT_STEP ${name} ${rc(name)}\n${read(`${name}.${stream}`)}`).join('');
const claudeNames = ['claude_probe', 'claude_exec'];
const codexNames = ['codex_probe', 'codex_list', 'codex_add', 'codex_exec'];
const parseLaunch = (name, order, runtime) => {
  const raw = fs.readFileSync(path.join(root, `${name}.argv0`));
  const args = raw.toString('utf8').split('\0').filter(Boolean);
  let index = args[0] === 'env' ? 1 : 0;
  const envBindings = [];
  while (index < args.length && args[index].includes('=')) {
    const separator = args[index].indexOf('=');
    const envName = args[index].slice(0, separator);
    const envValue = args[index].slice(separator + 1);
    envBindings.push(envName === 'AUTOPILOT_PROBE_CHALLENGE'
      ? { name: envName, secret: true, value_sha256: sha256(envValue) }
      : { name: envName, secret: false, value: envValue });
    index += 1;
  }
  const executable = read(`${name}.executable`).trim() || null;
  const commandArgs = args.slice(index + 1);
  return { order, name, runtime, executed: Boolean(executable), executable, argv: executable ? [executable, ...commandArgs] : [args[index], ...commandArgs], env_bindings: envBindings, cwd: root, exit_code: rc(name) };
};
const executionManifest = [
  parseLaunch('claude_probe', 1, 'claude'), parseLaunch('claude_exec', 2, 'claude'),
  parseLaunch('codex_probe', 3, 'codex'), parseLaunch('codex_list', 4, 'codex'),
  parseLaunch('codex_add', 5, 'codex'), parseLaunch('codex_exec', 6, 'codex'),
];
const commandsFor = (runtime) => executionManifest.filter((step) => step.runtime === runtime)
  .flatMap((step, index) => index === 0 ? step.argv : ['&&', ...step.argv]);
const claudeStdout = combined(claudeNames, 'stdout'); const claudeStderr = combined(claudeNames, 'stderr');
const codexStdout = combined(codexNames, 'stdout'); const codexStderr = combined(codexNames, 'stderr');
const claudeInstalled = Boolean(process.env.CLAUDE_VERSION);
const codexInstalled = Boolean(process.env.CODEX_VERSION);
const claudeValidationOk = rc('claude_probe') === 0;
const challengeToken = (raw) => {
  const matches = [...String(raw || '').matchAll(/AUTOPILOT_SKILL_CHALLENGE_[0-9a-f]{32}/g)].map((m) => m[0]);
  return [...new Set(matches)].length === 1 ? matches[0] : '';
};
const classifyAttempt = ({ executable, executed, version, codes, text, detailsGreen, challenge }) => {
  if (!executable || !executed || !version) return 'inconclusive';
  const steps = [...String(text).matchAll(/AUTOPILOT_STEP \S+ (-?\d+)\n([\s\S]*?)(?=AUTOPILOT_STEP \S+ -?\d+\n|$)/g)];
  if (steps.length && (steps.length !== codes.length * 2 || steps.some((m, i) => Number(m[1]) !== codes[i % codes.length]))) return 'inconclusive';
  const failed = (steps.length ? steps.filter((m) => Number(m[1]) !== 0).map((m) => m[2]) : [text]).join('\n');
  const infra = /\b(?:not logged in|log in required|run \/login|authentication (?:failed|required)|unauthorized|invalid (?:api )?key|timed? out|timeout|network|transport|ECONN[A-Z]+|ENETUNREACH|EAI_AGAIN|rate limit|quota)\b/i.test(failed) || codes.some((code) => [124, 137, 143].includes(code));
  const rejected = /(?:unknown|unrecognized|unsupported|additional)[^\n]{0,40}\b(?:field|property|key)s?\b[^\n]{0,80}\btier\b|\btier\b[^\n]{0,80}\b(?:not allowed|unknown|unrecognized|unsupported)\b/i.test(failed);
  if (codes.every((code) => code === 0) && detailsGreen && challenge) return 'pass';
  return !infra && rejected && codes.some((code) => code !== 0) ? 'fail' : 'inconclusive';
};
const claudeChallengeSeen = challengeToken(claudeStdout) === process.env.CLAUDE_CHALLENGE;
const claudeVersionOk = /^2\.1\.220(?:\s|$)/.test(process.env.CLAUDE_VERSION.trim());
const claudeOutcome = classifyAttempt({ executable: claudeInstalled, executed: claudeInstalled, version: claudeVersionOk, codes: [rc('claude_probe'), rc('claude_exec')], text: claudeStdout + '\n' + claudeStderr, detailsGreen: claudeValidationOk, challenge: claudeChallengeSeen });
const list = parsed(read('codex_list.stdout'));
const added = parsed(read('codex_add.stdout'));
const installedPath = added && typeof added.installedPath === 'string' ? added.installedPath : '';
const installedSkill = installedPath ? path.join(installedPath, 'skills/portability-probe/SKILL.md') : '';
const installedBody = installedSkill && fs.existsSync(installedSkill) ? fs.readFileSync(installedSkill) : Buffer.alloc(0);
const codexDiscovery = JSON.stringify(list || '').includes('autopilot-frontmatter-probe@autopilot-frontmatter-probe-local');
const codexSkillExact = installedBody.length > 0 && installedBody.equals(body);
const codexChallengeSeen = challengeToken(codexStdout) === process.env.CODEX_CHALLENGE;
const codexVersionOk = /^codex-cli 0\.146\.0(?:\s|$)/.test(process.env.CODEX_VERSION.trim());
const codexOutcome = classifyAttempt({ executable: codexInstalled, executed: codexInstalled, version: codexVersionOk, codes: [rc('codex_probe'), rc('codex_list'), rc('codex_add'), rc('codex_exec')], text: codexStdout + '\n' + codexStderr, detailsGreen: codexDiscovery && codexSkillExact, challenge: codexChallengeSeen });
fs.mkdirSync(retainedRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(retainedRoot, 0o700);
const fixturePath = path.join(retainedRoot, 'fixture.SKILL.md');
fs.writeFileSync(fixturePath, body, { mode: 0o600 }); fs.chmodSync(fixturePath, 0o600);
const executionManifestPath = path.join(retainedRoot, 'execution-manifest.json');
const executionManifestBytes = `${JSON.stringify(executionManifest, null, 2)}\n`;
fs.writeFileSync(executionManifestPath, executionManifestBytes, { mode: 0o600 }); fs.chmodSync(executionManifestPath, 0o600);
const retainLog = (runtime, stream, content) => {
  const target = path.join(retainedRoot, runtime + '.' + stream + '.log');
  fs.writeFileSync(target, content, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
};
const retainJson = (runtime, name, value) => retainLog(runtime, name, `${JSON.stringify(value, null, 2)}\n`);
const attempt = (runtime, installed, version, outcome, before, after, stdout, stderr, commands, details, exitCode, challenge, probeExitCodes) => {
  const beforeInventory = JSON.parse(before);
  const afterInventory = JSON.parse(after);
  const versionRaw = String(version || '');
  const challengeSeen = challengeToken(stdout) === challenge;
  const detailPath = retainJson(runtime, 'details', details);
  const beforePath = retainJson(runtime, 'before-inventory', beforeInventory);
  const afterPath = retainJson(runtime, 'after-inventory', afterInventory);
  const versionPath = retainLog(runtime, 'version', versionRaw);
  return {
  runtime,
  expected_version: runtime === 'claude' ? '2.1.220' : 'codex-cli 0.146.0',
  version: versionRaw.trim(),
  version_raw: versionRaw,
  version_bytes: Buffer.byteLength(versionRaw, 'utf8'),
  version_sha256: sha256(versionRaw),
  version_log_path: versionPath,
  executable_present: installed,
  execution_attempted: installed,
  command: commands,
  command_text: commands.join(' '),
  command_sha256: sha256(canonical(commands)),
  exit_code: exitCode,
  probe_exit_codes: probeExitCodes,
  outcome,
  before_inventory: beforeInventory,
  after_inventory: afterInventory,
  before_inventory_path: beforePath,
  after_inventory_path: afterPath,
  before_inventory_sha256: sha256(JSON.stringify(beforeInventory, null, 2) + '\n'),
  after_inventory_sha256: sha256(JSON.stringify(afterInventory, null, 2) + '\n'),
  fixture_sha256: fixtureSha,
  stdout_bytes: Buffer.byteLength(stdout, 'utf8'),
  stderr_bytes: Buffer.byteLength(stderr, 'utf8'),
  stdout_sha256: sha256(stdout),
  stderr_sha256: sha256(stderr),
  stdout_excerpt: excerpt(stdout),
  stderr_excerpt: excerpt(stderr),
  stdout_truncated: stdout.length > 8192,
  stderr_truncated: stderr.length > 8192,
  stdout_log_path: retainLog(runtime, 'stdout', stdout),
  stderr_log_path: retainLog(runtime, 'stderr', stderr),
  challenge_sha256: sha256(challenge),
  challenge_bytes: Buffer.byteLength(challenge, 'utf8'),
  details,
  details_path: detailPath,
  details_sha256: sha256(JSON.stringify(details, null, 2) + '\n'),
  challenge_seen: challengeSeen,
  };
};
const attempts = [
  attempt('claude', claudeInstalled, process.env.CLAUDE_VERSION, claudeOutcome, process.env.CLAUDE_BEFORE, process.env.CLAUDE_AFTER, claudeStdout, claudeStderr, commandsFor('claude'), { manifest_validation: claudeValidationOk, challenge_seen: claudeChallengeSeen, version_match: claudeVersionOk }, rc('claude_exec'), process.env.CLAUDE_CHALLENGE, [rc('claude_probe'), rc('claude_exec')]),
  attempt('codex', codexInstalled, process.env.CODEX_VERSION, codexOutcome, process.env.CODEX_BEFORE, process.env.CODEX_AFTER, codexStdout, codexStderr, commandsFor('codex'), { marketplace_discovered: codexDiscovery, installed_skill_exact: codexSkillExact, installed_path: installedPath || null, runtime_invocation: true, challenge_seen: codexChallengeSeen, version_match: codexVersionOk }, rc('codex_exec'), process.env.CODEX_CHALLENGE, [rc('codex_probe'), rc('codex_list'), rc('codex_add'), rc('codex_exec')]),
];
const classification = attempts.some((row) => row.outcome === 'fail') ? 'fail'
  : attempts.some((row) => row.outcome === 'inconclusive') ? 'inconclusive' : 'pass';
const receipt = {
  schema_version: 1,
  artifact_type: 'skill_frontmatter_portability',
  observed_at: new Date().toISOString(),
  fixture: { skill_name: 'portability-probe', description: 'Disposable frontmatter portability probe', unknown_field: 'tier', tier_value: 'core', path: fixturePath, bytes: body.length, body_sha256: fixtureSha },
  execution_manifest: executionManifest,
  execution_manifest_path: executionManifestPath,
  execution_manifest_sha256: sha256(executionManifestBytes),
  attempts,
  classification,
  policy: classification === 'pass' ? 'Dual runtime pass permits a separately reviewed tier migration.' : 'Do not change canonical skill frontmatter; retain the portability backlog entry.',
  cleanup: { attempt_dir: root, attempt_dir_mode: '0700', retained_evidence_dir: retainedRoot, zero_residue: false, residue_paths: [] },
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
const residue = fs.existsSync(root) ? [root] : [];
receipt.cleanup.zero_residue = residue.length === 0;
receipt.cleanup.residue_paths = residue;
receipt.cleanup.retained_evidence_dir = retainedRoot;
const receiptBody = { ...receipt };
receipt.receipt_digest = sha256(canonical(receiptBody));
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ classification, receipt: output, zero_residue: receipt.cleanup.zero_residue }));
NODE

bash "$0" --validate "$OUTPUT"
