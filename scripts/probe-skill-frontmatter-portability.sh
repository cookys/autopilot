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
const path = require('path');
const file = process.argv[2];
let value;
const errors = [];
try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (error) { console.error('invalid JSON: ' + error.message); process.exit(1); }
const isHex = (input) => typeof input === 'string' && /^[0-9a-f]{64}$/.test(input);
const outcomes = new Set(['pass', 'fail', 'inconclusive']);
const isPath = (input) => typeof input === 'string' && path.isAbsolute(input);
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
  if (typeof attempt.executable_present !== 'boolean') errors.push(attempt.runtime + ': executable_present missing');
  if (typeof attempt.execution_attempted !== 'boolean') errors.push(attempt.runtime + ': execution_attempted missing');
  if (attempt.execution_attempted !== true) errors.push(attempt.runtime + ': real runtime execution missing');
  if (attempt.executable_present && !attempt.execution_attempted) errors.push(attempt.runtime + ': installed runtime was not executed');
  if (!outcomes.has(attempt.outcome)) errors.push(attempt.runtime + ': invalid outcome');
  if (attempt.execution_attempted && !Number.isInteger(attempt.exit_code)) errors.push(attempt.runtime + ': exit_code missing');
  if (!Array.isArray(attempt.before_inventory) || !Array.isArray(attempt.after_inventory)) errors.push(attempt.runtime + ': inventories missing');
  for (const key of ['stdout_sha256', 'stderr_sha256', 'fixture_sha256']) if (!isHex(attempt[key])) errors.push(attempt.runtime + ': ' + key + ' invalid');
  for (const key of ['stdout_excerpt', 'stderr_excerpt']) if (typeof attempt[key] !== 'string') errors.push(attempt.runtime + ': ' + key + ' missing');
  if (typeof attempt.stdout_bytes !== 'number' || typeof attempt.stderr_bytes !== 'number') errors.push(attempt.runtime + ': log byte counts missing');
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
AUTOPILOT_FRONTMATTER_SENTINEL_8f4
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
  run_capture claude_exec env HOME="$ROOT/claude-home" CLAUDE_CONFIG_DIR="$ROOT/claude-config" TMPDIR="$ROOT/tmp" claude --bare --plugin-dir "$PLUGIN" -p '/portability-probe' --output-format json --max-budget-usd 0.01 --no-session-persistence
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
  run_capture codex_exec env HOME="$ROOT/codex-home-home" CODEX_HOME="$ROOT/codex-home" TMPDIR="$ROOT/tmp" codex exec --ephemeral --sandbox read-only --json --skip-git-repo-check -C "$ROOT/codex-scratch" '<invoke $autopilot-frontmatter-probe:portability-probe; respond with exactly AUTOPILOT_FRONTMATTER_SENTINEL_8f4>'
else
  CODEX_VERSION=""
  printf '%s\n' "codex executable not found" > "$ROOT/codex_probe.stderr" "$ROOT/codex_list.stderr" "$ROOT/codex_add.stderr"
  printf '%s\n' "127" > "$ROOT/codex_probe.rc" "$ROOT/codex_list.rc" "$ROOT/codex_add.rc" "$ROOT/codex_exec.rc"
fi

CLAUDE_AFTER="$(inventory "$ROOT/claude-home")"
CODEX_AFTER="$(inventory "$ROOT/codex-home")"
export ROOT OUTPUT RETAINED_ROOT CLAUDE_VERSION CODEX_VERSION CLAUDE_BEFORE CLAUDE_AFTER CODEX_BEFORE CODEX_AFTER

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
const body = fs.readFileSync(path.join(root, 'claude-plugin/skills/portability-probe/SKILL.md'));
const fixtureSha = sha256(body);
const command = {
  claude: ['claude', 'plugin', 'validate', '<plugin>', '&&', 'claude', '--bare', '--plugin-dir', '<plugin>', '-p', '/portability-probe', '--output-format', 'json', '--max-budget-usd', '0.01', '--no-session-persistence'],
  codex: ['codex', 'plugin', 'marketplace', 'add', '<marketplace>', '--json', '&&', 'codex', 'plugin', 'list', '--marketplace', 'autopilot-frontmatter-probe-local', '--available', '--json', '&&', 'codex', 'plugin', 'add', 'autopilot-frontmatter-probe@autopilot-frontmatter-probe-local', '--json', '&&', 'codex', 'exec', '--ephemeral', '--sandbox', 'read-only', '--json', '--skip-git-repo-check', '-C', '<scratch>', '<invoke $autopilot-frontmatter-probe:portability-probe; respond with exact sentinel>'],
};
const claudeStdout = read('claude_probe.stdout') + read('claude_exec.stdout');
const claudeStderr = read('claude_probe.stderr') + read('claude_exec.stderr');
const codexStdout = read('codex_probe.stdout') + read('codex_list.stdout') + read('codex_add.stdout') + read('codex_exec.stdout');
const codexStderr = read('codex_probe.stderr') + read('codex_list.stderr') + read('codex_add.stderr') + read('codex_exec.stderr');
const claudeInstalled = Boolean(process.env.CLAUDE_VERSION);
const codexInstalled = Boolean(process.env.CODEX_VERSION);
const claudeNoAuth = /not logged in|run \/login|authentication|auth/i.test(claudeStdout + '\n' + claudeStderr);
const claudeValidationOk = rc('claude_probe') === 0;
const claudeSentinel = claudeStdout.includes('AUTOPILOT_FRONTMATTER_SENTINEL_8f4');
const claudeVersionOk = /^2\.1\.220(?:\s|$)/.test(process.env.CLAUDE_VERSION.trim());
const claudeOutcome = !claudeInstalled || !claudeVersionOk || claudeNoAuth ? 'inconclusive'
  : (!claudeValidationOk || rc('claude_exec') !== 0 || !claudeSentinel ? 'fail' : 'pass');
const list = parsed(read('codex_list.stdout'));
const added = parsed(read('codex_add.stdout'));
const installedPath = added && typeof added.installedPath === 'string' ? added.installedPath : '';
const installedSkill = installedPath ? path.join(installedPath, 'skills/portability-probe/SKILL.md') : '';
const installedBody = installedSkill && fs.existsSync(installedSkill) ? fs.readFileSync(installedSkill) : Buffer.alloc(0);
const codexDiscovery = JSON.stringify(list || '').includes('autopilot-frontmatter-probe@autopilot-frontmatter-probe-local');
const codexSkillExact = installedBody.length > 0 && installedBody.equals(body);
const codexSentinel = codexStdout.includes('AUTOPILOT_FRONTMATTER_SENTINEL_8f4');
const codexVersionOk = /^codex-cli 0\.146\.0(?:\s|$)/.test(process.env.CODEX_VERSION.trim());
const codexNoAuth = /not logged in|authentication|auth required/i.test(codexStdout + '\n' + codexStderr);
const codexOutcome = !codexInstalled || !codexVersionOk || codexNoAuth ? 'inconclusive'
  : (rc('codex_probe') !== 0 || rc('codex_list') !== 0 || rc('codex_add') !== 0 || rc('codex_exec') !== 0 || !codexDiscovery || !codexSkillExact || !codexSentinel ? 'fail' : 'pass');
fs.mkdirSync(retainedRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(retainedRoot, 0o700);
const retainLog = (runtime, stream, content) => {
  const target = path.join(retainedRoot, runtime + '.' + stream + '.log');
  fs.writeFileSync(target, content, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
};
const attempt = (runtime, installed, version, outcome, before, after, stdout, stderr, commands, details, exitCode) => ({
  runtime,
  expected_version: runtime === 'claude' ? '2.1.220' : 'codex-cli 0.146.0',
  version: String(version || '').trim(),
  executable_present: installed,
  execution_attempted: installed,
  command: commands,
  command_text: commands.join(' '),
  exit_code: exitCode,
  outcome,
  before_inventory: JSON.parse(before),
  after_inventory: JSON.parse(after),
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
  details,
});
const attempts = [
  attempt('claude', claudeInstalled, process.env.CLAUDE_VERSION, claudeOutcome, process.env.CLAUDE_BEFORE, process.env.CLAUDE_AFTER, claudeStdout, claudeStderr, command.claude, { manifest_validation: claudeValidationOk, sentinel_seen: claudeSentinel, version_match: claudeVersionOk }, rc('claude_exec')),
  attempt('codex', codexInstalled, process.env.CODEX_VERSION, codexOutcome, process.env.CODEX_BEFORE, process.env.CODEX_AFTER, codexStdout, codexStderr, command.codex, { marketplace_discovered: codexDiscovery, installed_skill_exact: codexSkillExact, installed_path: installedPath || null, runtime_invocation: true, sentinel_seen: codexSentinel, version_match: codexVersionOk }, rc('codex_exec')),
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
