#!/usr/bin/env node
'use strict';
// node derive.js <lane> <role> <autopilotRoot>  -> prints {seat-ish identity + engine-qualify args + QRP env} as JSON.
// Recipes copied from autopilot docs/plans/evidence:
//   2026-10-14-reviewer-requalify-minimax-glm-qwen/derive-matrix.js  (reviewer/va/consult/discuss, kimi lane strings)
//   2026-10-14-reviewer-requalify-minimax-glm-qwen/cell-opencode-rv6.sh (opencode reviewer strings)
//   2026-10-17-owner-requalify/derive-owner.js (owner)
// harness_version follows the closest precedent for the same runner: kimi non-owner -> qrp:<sha8 provider>,
// everything opencode and every owner sitting -> engine-qualify-<sha8 engine-qualify.js>.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const [lane, role, AP] = process.argv.slice(2);
const LANES = {
  k31:     { cli: 'kimi', engine: 'kimi-code/k3.1-pro', model: 'kimi-code/k3.1-pro', family: 'moonshot', effort: 'high', provider: 'moonshot',
             transport: 'kimi-m-p-argv', posture: 'kimi -m <model> -p <prompt> (default agent; no tool-deny in provider kimi branch)',
             cred: 'qrp-cli-home-credential-only-seed', endpoint: '@none', qrpTimeout: 570000, remoteTimeout: 600000 },
  beam:    { cli: 'opencode', engine: 'opencode-go/beam-free', model: 'opencode-go/beam-free', family: 'reflection', effort: 'default', provider: 'opencode-cli',
             transport: 'opencode-cli-run-locked-agent', posture: 'opencode run --pure --agent locked --format json empty-dir OPENCODE_CONFIG_CONTENT deny-all',
             cred: 'clean-temp-home-auth-json-only', endpoint: 'opencode-go', qrpTimeout: 300000, remoteTimeout: 360000 },
  longcat: { cli: 'opencode', engine: 'opencode-go/longcat-2.0', model: 'opencode-go/longcat-2.0', family: 'meituan', effort: 'default', provider: 'opencode-cli',
             transport: 'opencode-cli-run-locked-agent', posture: 'opencode run --pure --agent locked --format json empty-dir OPENCODE_CONFIG_CONTENT deny-all',
             cred: 'clean-temp-home-auth-json-only', endpoint: 'opencode-go', qrpTimeout: 300000, remoteTimeout: 360000 },
  // codex strings from autopilot docs/plans/evidence/2026-10-14-reviewer-requalify-minimax-glm-qwen/cell-cli-{rv6,consult}.sh
  terra:   { cli: 'codex', engine: 'gpt-6.1-terra', model: 'gpt-6.1-terra', family: 'openai', effort: 'low', provider: 'codex-cli',
             transport: 'codex-cli-exec-read-only', posture: 'codex exec --sandbox read-only --skip-git-repo-check',
             cred: 'codex-home-redirect-broker-env-allowlist', endpoint: '@none', qrpTimeout: 570000, remoteTimeout: 600000,
             homeVar: 'CODEX_HOME' },
};
const ROLES = { reviewer: ['reviewer', 'code_review'], verification_author: ['va', 'verification_authoring'], consult: ['consult', 'consult'],
  discuss: ['discuss', 'discuss'], owner: ['owner', 'owner_intent_control'] };
const L = LANES[lane];
if (!L || !ROLES[role] || !AP) { console.error('usage: derive.js <k31|beam|longcat|terra> <reviewer|verification_author|consult|discuss|owner> <autopilotRoot>'); process.exit(2); }
const { canonicalJson } = require(path.join(AP, 'src/engine/owner-kernel/canonical.js'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sj = (o) => sha(canonicalJson(o));
const provPath = path.join(AP, 'scripts/qualification-review-provider.js');
const provSrc = fs.readFileSync(provPath, 'utf8');
function tmpl(name) {
  const marker = `const ${name} = \``; const at = provSrc.indexOf(marker); if (at < 0) throw new Error(name);
  let out = '', i = at + marker.length;
  while (i < provSrc.length) { const ch = provSrc[i]; if (ch === '\\') { out += ch + (provSrc[i + 1] ?? ''); i += 2; continue; } if (ch === '`') break; out += ch; i++; }
  return sha(out);
}
function vaPrompt() {
  const a = provSrc.indexOf('function vaSystemPrompt() {'); const b = provSrc.indexOf('\n}\n', a) + 2;
  const fn = new Function('require', 'fail', `${provSrc.slice(a, b)}; return vaSystemPrompt();`);
  return sha(fn((p) => require(path.resolve(AP, 'scripts', p)), (m) => { throw new Error(m); }));
}
const corp = (r) => { const c = fs.readFileSync(path.join(AP, `evals/${r}-capability-evidence-corpus.json`)); const g = fs.readFileSync(path.join(AP, `evals/${r}-eval-generator.js`)); const j = JSON.parse(c);
  return { prompt: sha(Buffer.concat([c, g])), sem: sha(Buffer.from(JSON.stringify({ corpus_version: j.corpus_version, families: j.families, thresholds: j.thresholds, canary_closure: 'negative_control_admission_failed:true' }), 'utf8')) }; };
const TRANSPORT = 'qualification-case-broker-networkless-bwrap';
const runnerVersion = JSON.parse(cp.execFileSync('node', [path.join(AP, 'scripts/lib/runner-binary.js'), 'version', '--runner', L.cli, '--json'])).token;
const eqHarness = 'engine-qualify-' + sha(fs.readFileSync(path.join(AP, 'scripts/engine-qualify.js'))).slice(0, 8);
const harness = (L.cli === 'kimi' && role !== 'owner') ? 'qrp:' + sha(fs.readFileSync(provPath)).slice(0, 8) : eqHarness;
const semBase = (kind) => ({ kind, model: L.model, transport: L.transport, reasoning_effort: L.effort, endpoint: L.endpoint });
const conBase = (kind, extra = {}) => ({ kind, exam_transport: TRANSPORT, ...extra, cli_posture: L.posture, credential_isolation: L.cred });
let prompt, sem = null, con, semHex = null;
if (role === 'reviewer') { prompt = tmpl('SYSTEM_PROMPT'); sem = semBase('reviewer-semantic-surface-v1'); con = conBase('reviewer-containment-surface-v1'); }
else if (role === 'verification_author') { prompt = vaPrompt(); sem = semBase('va-semantic-surface-v1'); con = conBase('va-containment-surface-v1', { twin_execution: 'host-va-runner-bwrap' }); }
else if (role === 'owner') { prompt = tmpl('OWNER_SYSTEM_PROMPT'); sem = semBase('owner-semantic-surface-v1'); con = conBase('owner-containment-surface-v1'); }
else { const c = corp(role); prompt = c.prompt; semHex = sha(Buffer.from(JSON.stringify({ r: role, base: c.sem, model: L.model, effort: L.effort }))); con = conBase(`${role}-containment-surface-v1`); }
const [mode, taskClass] = ROLES[role];
const env = { QRP_TIMEOUT_MS: String(L.qrpTimeout), QRP_TRANSPORT: 'cli', QRP_CLI_KIND: L.cli, QRP_PROMPT_MODE: mode,
  QRP_MODEL: L.model, QRP_PROVIDER: L.provider };
// kimi: the tier travels as KIMI_MODEL_THINKING_EFFORT, set by the provider only from QRP_CLI_EFFORT (else config default = max).
// opencode default: no variant at all (beam-free / longcat-2.0 have no effort tier), so QRP_CLI_EFFORT stays unset.
if (L.effort !== 'default') env.QRP_CLI_EFFORT = L.effort;
const args = ['--runner-version', runnerVersion, '--family', L.family, '--harness-version', harness,
  '--semantic-fingerprint', semHex || sj(sem), '--containment-fingerprint', sj(con),
  '--remote-provider-cmd', `node ${provPath}`, '--remote-provider', L.provider, '--remote-timeout-ms', String(L.remoteTimeout),
  ...[...Object.keys(env), L.homeVar || 'QRP_CLI_HOME'].flatMap((k) => ['--provider-env', k]),
  '--task-class', taskClass, '--domain', 'cross-cutting', '--language', 'en', '--tool', 'read_only',
  '--version-source', 'operator-asserted', ...((role === 'consult' || role === 'discuss') ? ['--execute'] : [])];
process.stdout.write(JSON.stringify({ lane, role, prompt_config_hash: prompt, args, env, home_var: L.homeVar || 'QRP_CLI_HOME',
  _semantic_surface: sem, _containment_surface: con }, null, 1) + '\n');
