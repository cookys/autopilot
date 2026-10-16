#!/usr/bin/env node
'use strict';
// Usage: node derive-owner.js <lane> [repoRoot]   -> prints the lane's owner-exam identity as JSON and writes identity/owner-<lane>.json
// Owner (foreman intent/control) exam identity. prompt_config_hash = sha256 of the OWNER_SYSTEM_PROMPT template body in
// scripts/qualification-review-provider.js (same convention as the reviewer SYSTEM_PROMPT / brain BRAIN_SYSTEM_PROMPT rows).
// semantic/containment surfaces: kinds owner-*-surface-v1; transport / posture / credential strings are copied per runner from
// the 2026-10-14 reviewer cells (cell.sh, cell-cli-rv6.sh, claude-derive.js, argon-derive.js, derive-fingerprints.js,
// cell-opencode-rv6.sh). No owner precedent exists for any of them, so every identity is flagged _invented.
// harness_version = engine-qualify-<sha8 of scripts/engine-qualify.js> (hyphen form) for every lane.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const [lane, rootArg] = process.argv.slice(2);
const REPO = rootArg || path.resolve(__dirname, '../../../..');
const { canonicalJson } = require(path.join(REPO, 'src/engine/owner-kernel/canonical.js'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sj = (o) => sha(canonicalJson(o));
const TRANSPORT = 'qualification-case-broker-networkless-bwrap';
const claude = (m) => ({ kind: 'claude', engine: m, model: m, mv: m, runner: 'claude-native', family: 'anthropic', effort: 'high', provider: 'anthropic',
  transport: 'claude-p-tools-empty', posture: 'claude -p --tools "" --setting-sources "" --strict-mcp-config', cred: 'dedicated-exam-config-dir-credentials-only', endpointKey: false });
const LANES = {
  'opus-high':   claude('claude-opus-5-5'),
  'sonnet-high': claude('claude-sonnet-5-5'),
  'haiku-high':  claude('claude-haiku-5-5'),
  'gpt61-low':   { kind: 'codex', engine: 'gpt-6.1-sol', model: 'gpt-6.1-sol', mv: 'gpt-6.1-sol', runner: 'codex', family: 'openai', effort: 'low', provider: 'codex-cli',
    transport: 'codex-cli-exec-read-only', posture: 'codex exec --sandbox read-only --skip-git-repo-check', cred: 'codex-home-redirect-broker-env-allowlist', rv: 'codex-cli-0.162.1' },
  'argon-high':  { kind: 'agy', engine: 'gemini-4-argon-high', model: 'gemini-4-argon-high', mv: 'gemini-4-argon-high', runner: 'agy', family: 'google', effort: 'high', provider: 'agy-gemini',
    transport: 'agy-p-argv-tool-deny', posture: 'agy -p --model --dangerously-skip-permissions --agent autopilot-toolless-reviewer + forced permissions.deny', cred: 'qrp-cli-home-credential-only-seed' },
  'argon-low':   { kind: 'agy', engine: 'gemini-4-argon-low', model: 'gemini-4-argon-low', mv: 'gemini-4-argon-low', runner: 'agy', family: 'google', effort: 'low', provider: 'agy-gemini',
    transport: 'agy-p-argv-tool-deny', posture: 'agy -p --model --dangerously-skip-permissions --agent autopilot-toolless-reviewer + forced permissions.deny', cred: 'qrp-cli-home-credential-only-seed' },
  'grok47-low':  { kind: 'grok', engine: 'grok-4.7', model: 'grok-4.7', mv: 'grok-4.7', runner: 'grok', family: 'xai', effort: 'low', provider: 'grok-cli',
    transport: 'grok-cli-prompt-file', posture: 'grok --prompt-file --permission-mode dontAsk --no-subagents --deny *', cred: 'qrp-cli-home-credential-only-seed', rv: 'grok-1.0.52-0920c8169e27-stable' },
  'glm-high':    { kind: 'http', engine: 'GLM-5.3', model: 'glm-5.3', mv: 'glm-5.3', runner: 'anthropic-compatible', family: 'zhipu', effort: 'high', provider: 'glm-anthropic', endpoint: 'glm',
    transport: 'anthropic-compatible-http', cred: 'broker-env-allowlist-http-token', rv: 'node-direct-http-fetch' },
  'minimax-high':{ kind: 'http', engine: 'MiniMax-M3', model: 'MiniMax-M3', mv: 'MiniMax-M3', runner: 'anthropic-compatible', family: 'minimax', effort: 'high', provider: 'minimax-anthropic', endpoint: 'minimax',
    transport: 'anthropic-compatible-http', cred: 'broker-env-allowlist-http-token', rv: 'node-direct-http-fetch' },
  'qwen-high':   { kind: 'qoderclicn', engine: 'Qwen3.8-Max', model: 'Qwen3.8-Max', mv: 'Qwen3.8-Max', runner: 'qoderclicn', family: 'alibaba', effort: 'high', provider: 'qoderclicn-qwen',
    transport: 'qoderclicn-p-tools-empty', posture: 'qoderclicn -p --model --tools "" --permission-mode dont_ask (no skip-permissions)', cred: 'qrp-cli-home-credential-only-seed' },
  'kimi-k3-high':{ kind: 'kimi', engine: 'kimi-code-k3', model: 'kimi-code/k3', mv: 'kimi-code-k3', runner: 'kimi', family: 'moonshot', effort: 'high', provider: 'moonshot',
    transport: 'kimi-m-p-argv', posture: 'kimi -m <model> -p <prompt> (default agent; no tool-deny in provider kimi branch)', cred: 'qrp-cli-home-credential-only-seed' },
  'kimi-k28-high':{ kind: 'kimi', engine: 'kimi-k2.8-preview', model: 'kimi-code/kimi-for-coding', mv: 'kimi-for-coding:K2.8-Preview', runner: 'kimi', family: 'moonshot', effort: 'high', provider: 'moonshot',
    transport: 'kimi-m-p-argv', posture: 'kimi -m <model> -p <prompt> (default agent; no tool-deny in provider kimi branch)', cred: 'qrp-cli-home-credential-only-seed' },
  'muse-oc-high':{ kind: 'opencode', engine: 'opencode-go/muse-spark-1.3-contributor', model: 'opencode-go/muse-spark-1.3-contributor', mv: 'opencode-go:muse-spark-1.3-contributor', runner: 'opencode', family: 'meta', effort: 'high', provider: 'opencode-cli',
    transport: 'opencode-cli-run-locked-agent', endpointLabel: 'opencode-go', posture: 'opencode run --pure --agent locked --format json empty-dir OPENCODE_CONFIG_CONTENT deny-all', cred: 'clean-temp-home-auth-json-only' },
};
const L = LANES[lane];
if (!L) { console.error('lane: ' + Object.keys(LANES).join('|')); process.exit(2); }
const provSrc = fs.readFileSync(path.join(REPO, 'scripts/qualification-review-provider.js'), 'utf8');
function tmpl(name) {
  const marker = `const ${name} = \``; const at = provSrc.indexOf(marker); if (at < 0) throw new Error(name);
  let out = '', i = at + marker.length;
  while (i < provSrc.length) { const ch = provSrc[i]; if (ch === '\\') { out += ch + (provSrc[i + 1] ?? ''); i += 2; continue; } if (ch === '`') break; out += ch; i++; }
  return sha(out);
}
const harness = 'engine-qualify-' + sha(fs.readFileSync(path.join(REPO, 'scripts/engine-qualify.js'))).slice(0, 8);
let rv = L.rv;
if (!rv) rv = JSON.parse(cp.execFileSync('node', [path.join(REPO, 'scripts/lib/runner-binary.js'), 'version', '--runner', L.runner, '--json'])).token;
const sem = L.kind === 'http'
  ? { kind: 'owner-semantic-surface-v1', model: L.model, transport: L.transport, endpoint: L.endpoint }
  : { kind: 'owner-semantic-surface-v1', model: L.model, transport: L.transport, reasoning_effort: L.effort, endpoint: L.endpointLabel || '@none' };
const con = L.kind === 'http'
  ? { kind: 'owner-containment-surface-v1', exam_transport: TRANSPORT, credential_isolation: L.cred }
  : { kind: 'owner-containment-surface-v1', exam_transport: TRANSPORT, cli_posture: L.posture, credential_isolation: L.cred };
const id = { lane, kind: L.kind, engine: L.engine, model: L.model, model_version: L.mv, family: L.family, runner: L.runner, runner_version: rv,
  harness_version: harness, effort: L.effort, provider: L.provider, endpoint: L.endpoint || null,
  prompt_config_hash: tmpl('OWNER_SYSTEM_PROMPT'), semantic_fingerprint: sj(sem), containment_fingerprint: sj(con) };
fs.mkdirSync(path.join(__dirname, 'identity'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'identity', `owner-${lane}.json`), JSON.stringify({ ...id, _invented: ['whole owner identity: transport/posture/credential strings copied from the runner\'s reviewer recipe, no owner precedent'], _semantic_surface: sem, _containment_surface: con }, null, 2) + '\n');
process.stdout.write(JSON.stringify(id, null, 1) + '\n');
