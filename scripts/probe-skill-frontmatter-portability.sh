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
const challengeFrom = (raw) => {
  const matches = [...String(raw || '').matchAll(/AUTOPILOT_SKILL_CHALLENGE_[0-9a-f]{32}/g)].map((m) => m[0]);
  return [...new Set(matches)].length === 1 ? matches[0] : '';
};
const expectedVersion = (runtime) => runtime === 'claude' ? /^2\.1\.220(?:\s|$)/ : /^codex-cli 0\.146\.0(?:\s|$)/;
const evidenceDir = value && value.cleanup && isPath(value.cleanup.retained_evidence_dir)
  ? path.resolve(value.cleanup.retained_evidence_dir) : '';
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
  if (typeof attempt.executable_present !== 'boolean') errors.push(attempt.runtime + ': executable_present missing');
  if (typeof attempt.execution_attempted !== 'boolean') errors.push(attempt.runtime + ': execution_attempted missing');
  if (attempt.executable_present && !attempt.execution_attempted) errors.push(attempt.runtime + ': installed runtime was not executed');
  if (!outcomes.has(attempt.outcome)) errors.push(attempt.runtime + ': invalid outcome');
  if (attempt.execution_attempted && !Number.isInteger(attempt.exit_code)) errors.push(attempt.runtime + ': exit_code missing');
  if (!Array.isArray(attempt.probe_exit_codes) || !attempt.probe_exit_codes.every(Number.isInteger)) errors.push(attempt.runtime + ': probe exit evidence missing');
  if (!Array.isArray(attempt.before_inventory) || !Array.isArray(attempt.after_inventory)) errors.push(attempt.runtime + ': inventories missing');
  for (const key of ['stdout_sha256', 'stderr_sha256', 'fixture_sha256', 'version_sha256', 'before_inventory_sha256', 'after_inventory_sha256', 'details_sha256', 'challenge_sha256']) if (!isHex(attempt[key])) errors.push(attempt.runtime + ': ' + key + ' invalid');
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
  if (attempt.outcome !== 'inconclusive'
      && (!Number.isInteger(attempt.challenge_bytes) || attempt.challenge_bytes <= 0
      || !isHex(attempt.challenge_sha256) || !challenge
      || sha256(challenge) !== attempt.challenge_sha256
      || Buffer.byteLength(challenge, 'utf8') !== attempt.challenge_bytes
      || attempt.challenge_seen !== true || attempt.details?.challenge_seen !== true)) {
    errors.push(attempt.runtime + ': per-attempt skill challenge evidence is missing or invalid');
  }
  const noAuth = /not logged in|run \/login|authentication|auth required/i.test(
    `${stdoutForChallenge ? stdoutForChallenge.toString('utf8') : ''}\n${(() => { const b = readEvidence(attempt, 'stderr_log_path', 'stderr log'); return b ? b.toString('utf8') : ''; })()}`,
  );
  const versionOk = typeof attempt.version === 'string' && expectedVersion(attempt.runtime).test(attempt.version_raw || '');
  const probeGreen = attempt.probe_exit_codes.every((code) => code === 0);
  const detailsGreen = attempt.runtime === 'claude'
    ? attempt.details && attempt.details.manifest_validation === true
    : attempt.details && attempt.details.marketplace_discovered === true && attempt.details.installed_skill_exact === true;
  const recomputedOutcome = !attempt.executable_present || !versionOk || noAuth ? 'inconclusive'
    : (!probeGreen || attempt.exit_code !== 0 || !detailsGreen || !attempt.challenge_seen ? 'fail' : 'pass');
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

run_capture() {
  local name="$1"; shift
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
const command = {
  claude: ['claude', 'plugin', 'validate', '<plugin>', '&&', 'claude', '--bare', '--plugin-dir', '<plugin>', '-p', '/portability-probe', '--output-format', 'json', '--max-budget-usd', '0.01', '--no-session-persistence'],
  codex: ['codex', 'plugin', 'marketplace', 'add', '<marketplace>', '--json', '&&', 'codex', 'plugin', 'list', '--marketplace', 'autopilot-frontmatter-probe-local', '--available', '--json', '&&', 'codex', 'plugin', 'add', 'autopilot-frontmatter-probe@autopilot-frontmatter-probe-local', '--json', '&&', 'codex', 'exec', '--ephemeral', '--sandbox', 'read-only', '--json', '--skip-git-repo-check', '-C', '<scratch>', '<invoke $autopilot-frontmatter-probe:portability-probe; respond with the challenge obtained from the skill>'],
};
const claudeStdout = read('claude_probe.stdout') + read('claude_exec.stdout');
const claudeStderr = read('claude_probe.stderr') + read('claude_exec.stderr');
const codexStdout = read('codex_probe.stdout') + read('codex_list.stdout') + read('codex_add.stdout') + read('codex_exec.stdout');
const codexStderr = read('codex_probe.stderr') + read('codex_list.stderr') + read('codex_add.stderr') + read('codex_exec.stderr');
const claudeInstalled = Boolean(process.env.CLAUDE_VERSION);
const codexInstalled = Boolean(process.env.CODEX_VERSION);
const claudeNoAuth = /not logged in|run \/login|authentication|auth/i.test(claudeStdout + '\n' + claudeStderr);
const claudeValidationOk = rc('claude_probe') === 0;
const challengeToken = (raw) => {
  const matches = [...String(raw || '').matchAll(/AUTOPILOT_SKILL_CHALLENGE_[0-9a-f]{32}/g)].map((m) => m[0]);
  return [...new Set(matches)].length === 1 ? matches[0] : '';
};
const claudeChallengeSeen = challengeToken(claudeStdout) === process.env.CLAUDE_CHALLENGE;
const claudeVersionOk = /^2\.1\.220(?:\s|$)/.test(process.env.CLAUDE_VERSION.trim());
const claudeOutcome = !claudeInstalled || !claudeVersionOk || claudeNoAuth ? 'inconclusive'
  : (!claudeValidationOk || rc('claude_exec') !== 0 || !claudeChallengeSeen ? 'fail' : 'pass');
const list = parsed(read('codex_list.stdout'));
const added = parsed(read('codex_add.stdout'));
const installedPath = added && typeof added.installedPath === 'string' ? added.installedPath : '';
const installedSkill = installedPath ? path.join(installedPath, 'skills/portability-probe/SKILL.md') : '';
const installedBody = installedSkill && fs.existsSync(installedSkill) ? fs.readFileSync(installedSkill) : Buffer.alloc(0);
const codexDiscovery = JSON.stringify(list || '').includes('autopilot-frontmatter-probe@autopilot-frontmatter-probe-local');
const codexSkillExact = installedBody.length > 0 && installedBody.equals(body);
const codexChallengeSeen = challengeToken(codexStdout) === process.env.CODEX_CHALLENGE;
const codexVersionOk = /^codex-cli 0\.146\.0(?:\s|$)/.test(process.env.CODEX_VERSION.trim());
const codexNoAuth = /not logged in|authentication|auth required/i.test(codexStdout + '\n' + codexStderr);
const codexOutcome = !codexInstalled || !codexVersionOk || codexNoAuth ? 'inconclusive'
  : (rc('codex_probe') !== 0 || rc('codex_list') !== 0 || rc('codex_add') !== 0 || rc('codex_exec') !== 0 || !codexDiscovery || !codexSkillExact || !codexChallengeSeen ? 'fail' : 'pass');
fs.mkdirSync(retainedRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(retainedRoot, 0o700);
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
  attempt('claude', claudeInstalled, process.env.CLAUDE_VERSION, claudeOutcome, process.env.CLAUDE_BEFORE, process.env.CLAUDE_AFTER, claudeStdout, claudeStderr, command.claude, { manifest_validation: claudeValidationOk, challenge_seen: claudeChallengeSeen, version_match: claudeVersionOk }, rc('claude_exec'), process.env.CLAUDE_CHALLENGE, [rc('claude_probe'), rc('claude_exec')]),
  attempt('codex', codexInstalled, process.env.CODEX_VERSION, codexOutcome, process.env.CODEX_BEFORE, process.env.CODEX_AFTER, codexStdout, codexStderr, command.codex, { marketplace_discovered: codexDiscovery, installed_skill_exact: codexSkillExact, installed_path: installedPath || null, runtime_invocation: true, challenge_seen: codexChallengeSeen, version_match: codexVersionOk }, rc('codex_exec'), process.env.CODEX_CHALLENGE, [rc('codex_probe'), rc('codex_list'), rc('codex_add'), rc('codex_exec')]),
];
const classification = attempts.some((row) => row.outcome === 'fail') ? 'fail'
  : attempts.some((row) => row.outcome === 'inconclusive') ? 'inconclusive' : 'pass';
const receipt = {
  schema_version: 1,
  artifact_type: 'skill_frontmatter_portability',
  observed_at: new Date().toISOString(),
  fixture: { skill_name: 'portability-probe', description: 'Disposable frontmatter portability probe', unknown_field: 'tier', tier_value: 'core', body_sha256: fixtureSha },
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
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ classification, receipt: output, zero_residue: receipt.cleanup.zero_residue }));
NODE

bash "$0" --validate "$OUTPUT"
