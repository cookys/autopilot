#!/usr/bin/env node
'use strict';
// Read-only. Usage: node derive-fingerprints.js <minimax|glm|qwen|kimi> [repoRoot]
// Writes identity/reviewer-<lane>.json. Recipes:
//  - glm / minimax (http): semantic+containment surfaces are the EXACT canonicalJson recipes recorded in
//    docs/plans/evidence/2026-08-17-roster-qualification/glm53-qualify/README.md (event 140), so glm rows stay
//    comparable (glm reproduces b4d2079f / 8b46dca1 byte-for-byte; minimax swaps model+endpoint only).
//  - qwen (cli qoderclicn): reviewer has no precedent; surfaces follow the argon cell.sh shape with the qoderclicn
//    posture from provider callCli() (`--tools ""`, no skip-permissions). Flagged _invented.
//  - harness_version = engine-qualify-<first8 sha256(scripts/engine-qualify.js)> (the event-140 form).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [lane, rootArg] = process.argv.slice(2);
const LANES = {
  glm:     { engine: 'GLM-5.3',     model: 'glm-5.3',     family: 'zhipu',   runner: 'anthropic-compatible', endpoint: 'glm' },
  minimax: { engine: 'MiniMax-M3',  model: 'MiniMax-M3',  family: 'minimax', runner: 'anthropic-compatible', endpoint: 'minimax' },
  kimi:    { engine: 'kimi-code-k3', model: 'kimi-code/k3', family: 'moonshot', runner: 'kimi' },
  qwen:    { engine: 'Qwen3.8-Max', model: 'Qwen3.8-Max', family: 'alibaba', runner: 'qoderclicn' },
};
const L = LANES[lane]; if (!L) { console.error('lane minimax|glm|qwen|kimi'); process.exit(2); }
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
let harness = 'engine-qualify-' + sha(fs.readFileSync(path.join(REPO, 'scripts/engine-qualify.js'))).slice(0, 8);
let runnerVersion = 'node-direct-http-fetch', sem, con, invented = [];
if (lane === 'kimi') {
  // consult event 182 form: harness qrp:<sha8 of qualification-review-provider.js>; runner_version = `kimi --version` token.
  harness = 'qrp:' + sha(fs.readFileSync(path.join(REPO, 'scripts/qualification-review-provider.js'))).slice(0, 8);
  runnerVersion = JSON.parse(require('child_process').execFileSync('node', [path.join(REPO, 'scripts/lib/runner-binary.js'), 'version', '--runner', 'kimi', '--json'])).token;
  sem = { kind: 'reviewer-semantic-surface-v1', model: L.model, transport: 'kimi-m-p-argv', reasoning_effort: 'high', endpoint: '@none' };
  con = { kind: 'reviewer-containment-surface-v1', exam_transport: 'qualification-case-broker-networkless-bwrap', cli_posture: 'kimi -m <model> -p <prompt> (default agent; no tool-deny in provider kimi branch)', credential_isolation: 'qrp-cli-home-credential-only-seed' };
  invented = ['kimi reviewer transport/posture/credential surface strings (no reviewer precedent)'];
} else if (lane === 'qwen') {
  runnerVersion = JSON.parse(require('child_process').execFileSync('node', [path.join(REPO, 'scripts/lib/runner-binary.js'), 'version', '--runner', 'qoderclicn', '--json'])).token;
  sem = { kind: 'reviewer-semantic-surface-v1', model: L.model, transport: 'qoderclicn-p-tools-empty', reasoning_effort: 'high', endpoint: '@none' };
  con = { kind: 'reviewer-containment-surface-v1', exam_transport: 'qualification-case-broker-networkless-bwrap', cli_posture: 'qoderclicn -p --model --tools "" --permission-mode dont_ask (no skip-permissions)', credential_isolation: 'qrp-cli-home-credential-only-seed' };
  invented = ['qoderclicn reviewer transport/posture/credential surface strings (no reviewer precedent)'];
} else {
  sem = { kind: 'reviewer-semantic-surface-v1', model: L.model, transport: 'anthropic-compatible-http', endpoint: L.endpoint };
  con = { kind: 'reviewer-containment-surface-v1', exam_transport: 'qualification-case-broker-networkless-bwrap', credential_isolation: 'broker-env-allowlist-http-token' };
}
const id = { identity: L.model, engine: L.engine, family: L.family, runner: L.runner, runner_version: runnerVersion, harness_version: harness, effort: 'high',
  prompt_config_hash: tmpl('SYSTEM_PROMPT'), semantic_fingerprint: sj(sem), containment_fingerprint: sj(con) };
fs.mkdirSync(path.join(__dirname, 'identity'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'identity', `reviewer-${lane}.json`), JSON.stringify({ ...id, _invented: invented, _semantic_surface: sem, _containment_surface: con }, null, 2) + '\n');
process.stdout.write(JSON.stringify(id, null, 1) + '\n');
