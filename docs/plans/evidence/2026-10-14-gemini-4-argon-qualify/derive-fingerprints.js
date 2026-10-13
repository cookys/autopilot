#!/usr/bin/env node
'use strict';
// Read-only. Usage: node derive-fingerprints.js <effort> [repoRoot]
// Adapted from docs/plans/evidence/2026-10-12-claude-5.5-requalify/broker/derive-fingerprints.js
// for runner=agy, model gemini-4-argon-<effort> (agy encodes the tier in the model id).
// Writes identity/<role>-argon-<effort>.json for reviewer, brain, verification_author, consult, discuss.
// owner is not derived: the provider has no owner prompt mode (QRP_PROMPT_MODE rejects it).
// Surface strings for agy (transport/posture/credential isolation) have no precedent for these roles
// and are marked invented in the output, like the claude lanes' were.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [effort, rootArg] = process.argv.slice(2);
if (!['low', 'medium', 'high'].includes(effort)) { console.error('effort low|medium|high'); process.exit(2); }
const REPO = rootArg || process.cwd();
const HERE = __dirname;
const model = `gemini-4-argon-${effort}`;
const { canonicalJson } = require(path.join(REPO, 'src/engine/owner-kernel/canonical.js'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sj = (o) => sha(canonicalJson(o));
const provSrc = fs.readFileSync(path.join(REPO, 'scripts/qualification-review-provider.js'), 'utf8');
function tmpl(name) {
  const marker = `const ${name} = \``; const at = provSrc.indexOf(marker); if (at < 0) throw new Error(name);
  let out = '', i = at + marker.length;
  while (i < provSrc.length) { const ch = provSrc[i]; if (ch === '\\') { out += ch + (provSrc[i + 1] ?? ''); i += 2; continue; } if (ch === '`') break; out += ch; i++; }
  return sha(out);
}
function vaPrompt() {
  const a = provSrc.indexOf('function vaSystemPrompt() {'); const b = provSrc.indexOf('\n}\n', a) + 2;
  const fn = new Function('require', 'fail', `${provSrc.slice(a, b)}; return vaSystemPrompt();`);
  return sha(fn((p) => require(path.resolve(REPO, 'scripts', p)), (m) => { throw new Error(m); }));
}
const harness = 'engine-qualify:' + sha(fs.readFileSync(path.join(REPO, 'scripts/engine-qualify.js'))).slice(0, 8);
const runnerVersion = JSON.parse(require('child_process').execFileSync('node', [path.join(REPO, 'scripts/lib/runner-binary.js'), 'version', '--runner', 'agy', '--json'])).token;
const POSTURE = 'agy -p --model --dangerously-skip-permissions --agent autopilot-toolless-reviewer + forced permissions.deny';
const TRANSPORT = 'qualification-case-broker-networkless-bwrap';
const CRED = 'qrp-cli-home-credential-only-seed';
const corp = (r) => { const c = fs.readFileSync(path.join(REPO, `evals/${r}-capability-evidence-corpus.json`)); const g = fs.readFileSync(path.join(REPO, `evals/${r}-eval-generator.js`)); const j = JSON.parse(c);
  return { prompt: sha(Buffer.concat([c, g])), sem: sha(Buffer.from(JSON.stringify({ corpus_version: j.corpus_version, families: j.families, thresholds: j.thresholds, canary_closure: 'negative_control_admission_failed:true' }), 'utf8')) }; };
const T = 'agy-p-argv-tool-deny';
const roles = {
  reviewer: { prompt: tmpl('SYSTEM_PROMPT'), sem: { kind: 'reviewer-semantic-surface-v1', model, transport: T, reasoning_effort: effort, endpoint: '@none' }, con: { kind: 'reviewer-containment-surface-v1', exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED } },
  brain: { prompt: tmpl('BRAIN_SYSTEM_PROMPT'), sem: { kind: 'brain-seat-semantic-surface-v1', model, transport: T, reasoning_effort: effort, setting_sources: 'none' }, con: { kind: 'brain-seat-containment-surface-v2', exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED } },
  verification_author: { prompt: vaPrompt(), sem: { kind: 'va-semantic-surface-v1', model, transport: T, reasoning_effort: effort, endpoint: '@none' }, con: { kind: 'va-containment-surface-v1', exam_transport: TRANSPORT, twin_execution: 'host-va-runner-bwrap', credential_isolation: CRED } },
};
for (const r of ['consult', 'discuss']) {
  const c = corp(r);
  roles[r] = { prompt: c.prompt, semHex: sha(Buffer.from(JSON.stringify({ r, base: c.sem, model, effort }))), con: { kind: `${r}-containment-surface-v1`, exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED } };
}
fs.mkdirSync(path.join(HERE, 'identity'), { recursive: true });
const all = {};
for (const [role, d] of Object.entries(roles)) {
  const id = { identity: model, model_alias: model, model_version: model, family: 'google', runner: 'agy', runner_version: runnerVersion, harness_version: harness, effort, identity_resolved: true,
    prompt_config_hash: d.prompt, semantic_fingerprint: d.semHex || sj(d.sem), containment_fingerprint: sj(d.con) };
  all[role] = id;
  fs.writeFileSync(path.join(HERE, 'identity', `${role}-argon-${effort}.json`), JSON.stringify({ ...id, _invented: ['agy transport/posture/credential surface strings (no precedent for these roles)'], _semantic_surface: d.sem || null, _containment_surface: d.con }, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ model, all }, null, 1) + '\n');
