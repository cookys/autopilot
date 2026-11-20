#!/usr/bin/env node
'use strict';
// Read-only except identity/<role>-<lane>.json. Usage: node derive-matrix.js <lane> <role> [repoRoot]
// lane: qwen | glm (local vLLM, /v1/messages) ; role: reviewer | verification_author | consult. Effort label is `default` (nothing sent).
// Adapted from ../2026-10-14-gemini-4-argon-qualify/derive-fingerprints.js (corpus/prompt hashing) and
// ./derive-fingerprints.js (per-lane transport surfaces). Surface strings with no precedent for that role are listed in _invented.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [lane, role, rootArg] = process.argv.slice(2);  // lane also: kimi28 (display name 'K2.8 Preview', alias kimi-code/kimi-for-coding)
const LANES = {
  qwen: { engine: 'Qwen3.8-27B-QUASAR-NVFP4', model: 'Qwen3.8-27B-QUASAR-NVFP4', family: 'alibaba', kind: 'http', endpoint: 'qwen_local', effort: 'default', wire: 'messages' },
  glm:  { engine: 'GLM-5.3-Flash-NVFP4',       model: 'GLM-5.3-Flash-NVFP4',       family: 'zhipu',   kind: 'http', endpoint: 'glm_local',  effort: 'default', wire: 'messages' },
};

const L = LANES[lane];
if (!L || !['reviewer', 'verification_author', 'consult', 'discuss', 'owner', 'brain'].includes(role)) { console.error('usage: <qwen|glm> <reviewer|verification_author|consult|discuss|owner|brain>'); process.exit(2); }
const REPO = rootArg || process.cwd();
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
const corp = (r) => { const c = fs.readFileSync(path.join(REPO, `evals/${r}-capability-evidence-corpus.json`)); const g = fs.readFileSync(path.join(REPO, `evals/${r}-eval-generator.js`)); const j = JSON.parse(c);
  return { prompt: sha(Buffer.concat([c, g])), sem: sha(Buffer.from(JSON.stringify({ corpus_version: j.corpus_version, families: j.families, thresholds: j.thresholds, canary_closure: 'negative_control_admission_failed:true' }), 'utf8')) }; };
const TRANSPORT = 'qualification-case-broker-networkless-bwrap';
const http = L.kind === 'http';
const T = http ? (L.protocol === 'responses' ? 'opencode-go-responses-http' : 'anthropic-compatible-http') : L.transport;
const CRED = http ? 'broker-env-allowlist-http-token' : 'qrp-cli-home-credential-only-seed';
let runnerVersion = L.protocol === 'responses' ? 'opencode-go-responses-v1' : 'node-direct-http-fetch', runner = 'anthropic-compatible', harness;
const invented = [];
if (http) { harness = 'engine-qualify-' + sha(fs.readFileSync(path.join(REPO, 'scripts/engine-qualify.js'))).slice(0, 8); }
else {
  runner = L.cli;
  runnerVersion = JSON.parse(require('child_process').execFileSync('node', [path.join(REPO, 'scripts/lib/runner-binary.js'), 'version', '--runner', L.cli, '--json'])).token;
  harness = 'qrp:' + sha(fs.readFileSync(path.join(REPO, 'scripts/qualification-review-provider.js'))).slice(0, 8);
  invented.push(`${L.cli} ${role} transport/posture/credential surface strings (no precedent for this role)`);
}
const semBase = (kind) => ({ kind, model: L.model, transport: T, ...((L.protocol === 'responses' || L.wire === 'messages') && L.effort !== 'default' ? { http_reasoning_effort: L.effort } : {}), ...(L.thinking ? { http_thinking: L.thinking } : {}), ...(http ? { endpoint: L.endpoint } : { reasoning_effort: L.effort, endpoint: '@none' }) });
const conBase = (kind, extra = {}) => ({ kind, exam_transport: TRANSPORT, ...extra, ...(http ? {} : { cli_posture: L.posture }), credential_isolation: CRED });
let prompt, sem, con, semHex;
if (role === 'reviewer') { prompt = tmpl('SYSTEM_PROMPT'); sem = semBase('reviewer-semantic-surface-v1'); con = conBase('reviewer-containment-surface-v1'); }
else if (role === 'verification_author') { prompt = vaPrompt(); sem = semBase('va-semantic-surface-v1'); con = conBase('va-containment-surface-v1', { twin_execution: 'host-va-runner-bwrap' }); }
else if (role === 'owner') { prompt = tmpl('OWNER_SYSTEM_PROMPT'); sem = semBase('owner-semantic-surface-v1'); con = conBase('owner-containment-surface-v1'); }
else if (role === 'brain') { prompt = tmpl('BRAIN_SYSTEM_PROMPT');
  sem = { kind: 'brain-seat-semantic-surface-v1', model: L.model, transport: 'anthropic-compatible-http-direct-no-tools', setting_sources: 'none', max_tokens: 32768 };
  con = { kind: 'brain-seat-containment-surface-v2', exam_transport: TRANSPORT, cli_posture: 'no-cli-child: host-side HTTP POST /v1/messages, tools absent from request body', credential_isolation: 'host-held-endpoint-token-never-enters-evaluator-sandbox' }; }
else { const c = corp(role); prompt = c.prompt; semHex = sha(Buffer.from(JSON.stringify({ r: role, base: c.sem, model: L.model, effort: L.effort }))); con = conBase(`${role}-containment-surface-v1`); }
const id = { identity: L.model, engine: L.engine, family: L.family, runner, runner_version: runnerVersion, harness_version: harness, effort: L.effort,
  prompt_config_hash: prompt, semantic_fingerprint: semHex || sj(sem), containment_fingerprint: sj(con) };
const IDDIR = process.env.IDENTITY_DIR || path.join(__dirname, 'identity');
fs.mkdirSync(IDDIR, { recursive: true });
fs.writeFileSync(path.join(IDDIR, `${role}-${lane}.json`), JSON.stringify({ ...id, _invented: invented, _semantic_surface: sem || null, _containment_surface: con }, null, 2) + '\n');
process.stdout.write(JSON.stringify(id, null, 1) + '\n');
