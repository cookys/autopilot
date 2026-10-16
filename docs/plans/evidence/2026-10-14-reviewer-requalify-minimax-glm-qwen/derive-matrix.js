#!/usr/bin/env node
'use strict';
// Read-only except identity/<role>-<lane>.json. Usage: node derive-matrix.js <lane> <role> [repoRoot]
// lane: glm | minimax | minimax31 | qwen | kimi ; role: reviewer | verification_author | consult | discuss | brain
// Adapted from ../2026-10-14-gemini-4-argon-qualify/derive-fingerprints.js (corpus/prompt hashing) and
// ./derive-fingerprints.js (per-lane transport surfaces). Surface strings with no precedent for that role are listed in _invented.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [lane, role, rootArg] = process.argv.slice(2);  // lane also: kimi28 (display name 'K2.8 Preview', alias kimi-code/kimi-for-coding)
const LANES = {
  glm:       { engine: 'GLM-5.3',                    model: 'glm-5.3',                    family: 'zhipu',    kind: 'http', endpoint: 'glm',     effort: 'high' },
  minimax:   { engine: 'MiniMax-M3',                 model: 'MiniMax-M3',                 family: 'minimax',  kind: 'http', endpoint: 'minimax', effort: 'high' },
  minimax31: { engine: 'MiniMax-M3.1-Flash-Preview', model: 'MiniMax-M3.1-Flash-Preview', family: 'minimax',  kind: 'http', endpoint: 'minimax', effort: 'max' },
  qwen:      { engine: 'Qwen3.8-Max',                model: 'Qwen3.8-Max',                family: 'alibaba',  kind: 'cli',  cli: 'qoderclicn', effort: 'high',
               transport: 'qoderclicn-p-tools-empty', posture: 'qoderclicn -p --model --tools "" --permission-mode dont_ask (no skip-permissions)' },
  kimi:      { engine: 'kimi-code-k3',               model: 'kimi-code/k3',               family: 'moonshot', kind: 'cli',  cli: 'kimi', effort: 'high',
               transport: 'kimi-m-p-argv', posture: 'kimi -m <model> -p <prompt> (default agent; no tool-deny in provider kimi branch)' },
  muse:      { engine: 'muse-spark-1.3-contributor', model: 'muse-spark-1.3-contributor', family: 'meta',     kind: 'http', endpoint: 'opencode-go', effort: 'default', protocol: 'responses' },
  muse_low:  { engine: 'muse-spark-1.3-contributor', model: 'muse-spark-1.3-contributor', family: 'meta',     kind: 'http', endpoint: 'opencode-go', effort: 'low',  protocol: 'responses' },
  muse_high: { engine: 'muse-spark-1.3-contributor', model: 'muse-spark-1.3-contributor', family: 'meta',     kind: 'http', endpoint: 'opencode-go', effort: 'high', protocol: 'responses' },
  glm_low:        { engine: 'GLM-5.3',                    model: 'glm-5.3',                    family: 'zhipu',    kind: 'http', endpoint: 'glm',     effort: 'low',  wire: 'messages' },
  glm_high:       { engine: 'GLM-5.3',                    model: 'glm-5.3',                    family: 'zhipu',    kind: 'http', endpoint: 'glm',     effort: 'high', wire: 'messages' },
  minimax31_low:  { engine: 'MiniMax-M3.1-Flash-Preview', model: 'MiniMax-M3.1-Flash-Preview', family: 'minimax',  kind: 'http', endpoint: 'minimax', effort: 'low',  wire: 'messages' },
  minimax31_high: { engine: 'MiniMax-M3.1-Flash-Preview', model: 'MiniMax-M3.1-Flash-Preview', family: 'minimax',  kind: 'http', endpoint: 'minimax', effort: 'high', wire: 'messages' },
  minimax_think:  { engine: 'MiniMax-M3',                 model: 'MiniMax-M3',                 family: 'minimax',  kind: 'http', endpoint: 'minimax', effort: 'default', wire: 'messages', thinking: 'adaptive' },
  kimi28:    { engine: 'kimi-k2.8-preview',          model: 'kimi-code/kimi-for-coding',  family: 'moonshot', kind: 'cli',  cli: 'kimi', effort: 'high',
               transport: 'kimi-m-p-argv', posture: 'kimi -m <model> -p <prompt> (default agent; no tool-deny in provider kimi branch)' },
};
const L = LANES[lane];
if (!L || !['reviewer', 'verification_author', 'consult', 'discuss', 'brain'].includes(role)) { console.error('usage: <glm|minimax|minimax31|qwen|kimi> <reviewer|verification_author|consult|discuss|brain>'); process.exit(2); }
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
else if (role === 'brain') { prompt = tmpl('BRAIN_SYSTEM_PROMPT'); sem = semBase('brain-seat-semantic-surface-v1'); con = conBase('brain-seat-containment-surface-v2'); }
else if (role === 'verification_author') { prompt = vaPrompt(); sem = semBase('va-semantic-surface-v1'); con = conBase('va-containment-surface-v1', { twin_execution: 'host-va-runner-bwrap' }); }
else { const c = corp(role); prompt = c.prompt; semHex = sha(Buffer.from(JSON.stringify({ r: role, base: c.sem, model: L.model, effort: L.effort }))); con = conBase(`${role}-containment-surface-v1`); }
const id = { identity: L.model, engine: L.engine, family: L.family, runner, runner_version: runnerVersion, harness_version: harness, effort: L.effort,
  prompt_config_hash: prompt, semantic_fingerprint: semHex || sj(sem), containment_fingerprint: sj(con) };
fs.mkdirSync(path.join(__dirname, 'identity'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'identity', `${role}-${lane}.json`), JSON.stringify({ ...id, _invented: invented, _semantic_surface: sem || null, _containment_surface: con }, null, 2) + '\n');
process.stdout.write(JSON.stringify(id, null, 1) + '\n');
