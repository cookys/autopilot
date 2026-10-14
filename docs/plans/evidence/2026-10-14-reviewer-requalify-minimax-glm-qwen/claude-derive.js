#!/usr/bin/env node
'use strict';
// Read-only. Usage: node derive-fingerprints.js <model> <effort> [repoRoot]
// Writes identity/<role>-<lane>.json (all 6 roles) and identity-brain-<lane>.json (flat, grok-sweep format).
// Recipes copied from: brain = gpt6-low-sweep/run-brain.sh + brain-opus-5.5-high/fingerprint-derivation.json;
// reviewer = grok-4.7-low-seats/fingerprint-reviewer.json; va = verification-author-suite/dogfood/README.md;
// consult/discuss = 2026-08-28-consult-discuss-qualify/administration/derive-hashes.js (prompt+semantic).
// owner + consult/discuss containment + claude-specific surfaces have NO precedent: flagged invented=true.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [model, effort, rootArg] = process.argv.slice(2);
const REPO = rootArg || '/home/cookys/projects/autopilot/.claude/worktrees/agent-a16d390b66014e3cf';
const HERE = __dirname;
const { canonicalJson } = require(path.join(REPO, 'src/engine/owner-kernel/canonical.js'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sj = (o) => sha(canonicalJson(o));
const short = model.replace(/^claude-/, '').replace(/-5-5$/, '');
const lane = `${short}-${effort}`;
const provSrc = fs.readFileSync(path.join(REPO, 'scripts/qualification-review-provider.js'), 'utf8');
function tmpl(name) { // sha256 of raw template-literal body (escape-aware), as run-brain.sh does
  const marker = `const ${name} = \``; const at = provSrc.indexOf(marker); if (at < 0) throw new Error(name);
  let out = '', i = at + marker.length;
  while (i < provSrc.length) { const ch = provSrc[i]; if (ch === '\\') { out += ch + (provSrc[i + 1] ?? ''); i += 2; continue; } if (ch === '`') break; out += ch; i++; }
  return sha(out);
}
function vaPrompt() { // rendered vaSystemPrompt() evaluated from source (function is not exported)
  const a = provSrc.indexOf('function vaSystemPrompt() {'); const b = provSrc.indexOf('\n}\n', a) + 2;
  const fn = new Function('require', 'fail', `${provSrc.slice(a, b)}; return vaSystemPrompt();`);
  return sha(fn((p) => require(path.resolve(REPO, 'scripts', p)), (m) => { throw new Error(m); }));
}
const harness = 'engine-qualify:' + sha(fs.readFileSync(path.join(REPO, 'scripts/engine-qualify.js'))).slice(0, 8);
const runnerVersion = JSON.parse(require('child_process').execFileSync('node', [path.join(REPO, 'scripts/lib/runner-binary.js'), 'version', '--runner', 'claude-native', '--json'])).token;
const POSTURE = 'claude -p --tools "" --setting-sources "" --strict-mcp-config';
const TRANSPORT = 'qualification-case-broker-networkless-bwrap';
const CRED = 'dedicated-exam-config-dir-credentials-only';
const corp = (r) => { const c = fs.readFileSync(path.join(REPO, `evals/${r}-capability-evidence-corpus.json`)); const g = fs.readFileSync(path.join(REPO, `evals/${r}-eval-generator.js`)); const j = JSON.parse(c);
  return { prompt: sha(Buffer.concat([c, g])), sem: sha(Buffer.from(JSON.stringify({ corpus_version: j.corpus_version, families: j.families, thresholds: j.thresholds, canary_closure: 'negative_control_admission_failed:true' }), 'utf8')) }; };
const ownerPath = path.join(HERE, 'owner-provider.js'); // owner-provider.js was never committed; owner is not examined this round
const ownerPromptHash = fs.existsSync(ownerPath) ? sha(fs.readFileSync(ownerPath)) : null;
const roles = {
  reviewer: { prompt: tmpl('SYSTEM_PROMPT'), sem: { kind: 'reviewer-semantic-surface-v1', model, transport: 'claude-p-tools-empty', reasoning_effort: effort, endpoint: '@none' }, con: { kind: 'reviewer-containment-surface-v1', exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED }, invented: ['claude-specific surface strings'] },
  owner: { prompt: ownerPromptHash, sem: { kind: 'owner-semantic-surface-v1', model, transport: 'claude-p-tools-empty', reasoning_effort: effort }, con: { kind: 'owner-containment-surface-v1', exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED }, invented: ['entire owner identity (no precedent); prompt hash = sha256(owner-provider.js bytes)'] },
  brain: { prompt: tmpl('BRAIN_SYSTEM_PROMPT'), sem: { kind: 'brain-seat-semantic-surface-v1', model, transport: 'claude-p-tools-empty', reasoning_effort: effort, setting_sources: 'none' }, con: { kind: 'brain-seat-containment-surface-v2', exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED }, invented: ['credential_isolation string and --strict-mcp-config in posture differ from the 2026-09-24 opus row'] },
  verification_author: { prompt: vaPrompt(), sem: { kind: 'va-semantic-surface-v1', model, transport: 'claude-p-tools-empty', reasoning_effort: effort, endpoint: '@none' }, con: { kind: 'va-containment-surface-v1', exam_transport: TRANSPORT, twin_execution: 'host-va-runner-bwrap', credential_isolation: CRED }, invented: ['claude transport strings'] },
};
if (ownerPromptHash === null) delete roles.owner;
for (const r of ['consult', 'discuss']) {
  const c = corp(r);
  roles[r] = { prompt: c.prompt, sem: null, semHex: sha(Buffer.from(JSON.stringify({ r, base: c.sem, model, effort }))), con: { kind: `${r}-containment-surface-v1`, exam_transport: TRANSPORT, cli_posture: POSTURE, credential_isolation: CRED }, invented: ['semantic = derive-hashes corpus semantic ⊕ model/effort (derive-hashes alone has no model/effort, so all seats collide); containment surface'] };
}
fs.mkdirSync(path.join(HERE, 'identity'), { recursive: true });
const all = {};
for (const [role, d] of Object.entries(roles)) {
  const id = { identity: model, model_alias: model, model_version: model, family: 'anthropic', runner: 'claude-native', runner_version: runnerVersion, harness_version: harness, effort, identity_resolved: true,
    prompt_config_hash: d.prompt, semantic_fingerprint: d.semHex || sj(d.sem), containment_fingerprint: sj(d.con) };
  all[role] = id;
  fs.writeFileSync(path.join(HERE, 'identity', `${role}-${lane}.json`), JSON.stringify({ ...id, _invented: d.invented, _semantic_surface: d.sem, _containment_surface: d.con }, null, 2) + '\n');
  if (role === 'brain') fs.writeFileSync(path.join(HERE, `identity-brain-${lane}.json`), JSON.stringify(id, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ lane, all }, null, 1) + '\n');
