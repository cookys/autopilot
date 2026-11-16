'use strict';
// data-class-policy.js — allowlist for transcript content (AR layer 2, fleet task 01M7DJQ5SMD4FETKXVYW38P1HD).
//
// scripts/lib/data-class-policy.json is the only policy. transcript.mode is "allow";
// families outside that list are refused, including unknown and any new vendor.
// deny_families is the second lock (zhipu, moonshot, minimax, alibaba, deepseek, meituan, qoder).
// It must cover cn-model-dispatch-gate BARRED_FAMILIES — that array stays the cloud-dispatch
// list; this file is the transcript list, and loadPolicy() refuses a policy that drops a barred id.
// deny_names arms a deny family: the family stays denied while any deny_name classifies as that
// family via familyOfEngine. Removing the qwen token disarms alibaba; the allowlist still blocks
// it until alibaba is added there.
//
// No environment variable and no CLI flag overrides a denial. Change the policy file.
//
// Endpoint labels come from scripts/endpoints.env.example (AUTOPILOT_ENDPOINT_<NAME>_URL).
// A fleet-local name in local-sandbox-endpoints.json (qwen_local) maps to model qwen and is
// classified the same way — local qwen is not exempt for transcript content.
//
// CLI: node scripts/lib/data-class-policy.js check --engine E [--model M] [--endpoint EP] --data-class transcript
//   exit 0 allowed; exit 3 refused (one stderr line); exit 2 usage.
//
// assertDataClass(engine, endpoint, cls) is what a later AR runner calls at startup.
// No AR_ pipeline runner exists yet, so a test that "skipping the call fails" waits for that runner.
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { familyOfEngine } = require('./stage-write');
const { BARRED_FAMILIES, localEndpoints } = require('./cn-model-dispatch-gate');

const POLICY_PATH = path.join(__dirname, 'data-class-policy.json');
const ENDPOINTS_EXAMPLE = path.join(__dirname, '..', 'endpoints.env.example');

function loadPolicy() {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  } catch (e) {
    const err = new Error(`data-class-policy: unreadable policy (${e.message})`);
    err.code = 3;
    throw err;
  }
  if (!Array.isArray(policy.deny_families)) {
    const err = new Error('data-class-policy: deny_families missing');
    err.code = 3;
    throw err;
  }
  for (const f of BARRED_FAMILIES) {
    if (!policy.deny_families.includes(f)) {
      const err = new Error(`data-class-policy: deny_families missing barred family ${f}`);
      err.code = 3;
      throw err;
    }
  }
  return policy;
}

function exampleEndpointLabels() {
  let text = '';
  try { text = fs.readFileSync(ENDPOINTS_EXAMPLE, 'utf8'); } catch { text = ''; }
  const set = new Set();
  for (const m of text.matchAll(/AUTOPILOT_ENDPOINT_([A-Za-z0-9_]+)_URL/g)) set.add(m[1].toLowerCase());
  return set;
}

// Endpoint label → model name, then familyOfEngine. Example-file labels use the label
// itself (GLM → glm, QWEN38 → qwen38). qwen_local is not in the example file; its model is qwen.
function endpointModelName(endpoint) {
  const key = String(endpoint || '').trim().toLowerCase();
  if (!key) return '';
  if (exampleEndpointLabels().has(key)) return key;
  if (localEndpoints().some((n) => String(n).toLowerCase() === key)) {
    if (key.includes('qwen') || key.includes('qwq')) return 'qwen';
    return key;
  }
  return key;
}

function nameDenied(name, policy) {
  const n = String(name || '').toLowerCase();
  return (policy.deny_names || []).some((t) => t && n.includes(String(t).toLowerCase()));
}

function familyArmed(family, policy) {
  if (!(policy.deny_families || []).includes(family)) return false;
  return (policy.deny_names || []).some((t) => familyOfEngine(t) === family);
}

function classify(name, policy, cls) {
  const family = familyOfEngine(name);
  const rule = policy[cls];
  if (!rule || rule.mode !== 'allow' || !Array.isArray(rule.families)) {
    return { ok: false, family, name, why: 'policy is not an allowlist' };
  }
  const allowOk = rule.families.includes(family);
  const denied = nameDenied(name, policy) || familyArmed(family, policy);
  if (allowOk && !denied) return { ok: true, family, name };
  const why = [];
  if (!allowOk) why.push('not in allowlist');
  if (denied) why.push('deny list');
  return { ok: false, family, name, why: why.join('; ') || 'refused' };
}

function verdict(engine, endpoint, cls, policy) {
  const c = String(cls || '');
  if (!policy || !c || !policy[c]) {
    return { ok: false, family: 'unknown', reason: `data-class ${c || '(missing)'}: refused (unknown data class)` };
  }
  const probes = [];
  if (engine) probes.push({ kind: 'engine', name: String(engine), model: String(engine) });
  if (endpoint) {
    const ep = String(endpoint);
    probes.push({ kind: 'endpoint', name: ep, model: endpointModelName(ep) });
  }
  if (!probes.length) {
    return { ok: false, family: 'unknown', reason: `data-class ${c}: refused (no engine) family=unknown (not in allowlist)` };
  }
  let last = null;
  for (const p of probes) {
    const r = classify(p.model, policy, c);
    last = r;
    if (!r.ok) {
      const who = p.kind === 'endpoint' ? `endpoint ${p.name} model=${p.model}` : p.model;
      return { ok: false, family: r.family, name: p.model, reason: `data-class ${c}: refused ${who} family=${r.family} (${r.why})` };
    }
  }
  return { ok: true, family: last.family, name: last.name, reason: '' };
}

function checkNames(names, endpoint, cls, policy) {
  const list = [];
  for (const n of names) {
    if (n && !list.includes(n)) list.push(n);
  }
  if (!list.length && !endpoint) {
    return { ok: false, family: 'unknown', reason: `data-class ${cls}: refused (no engine) family=unknown (not in allowlist)` };
  }
  let last = null;
  for (const n of list) {
    last = verdict(n, '', cls, policy);
    if (!last.ok) return last;
  }
  if (endpoint) return verdict('', endpoint, cls, policy);
  return last;
}

function assertDataClass(engine, endpoint, cls) {
  const v = verdict(engine, endpoint, cls, loadPolicy());
  if (!v.ok) {
    const err = new Error(v.reason);
    err.code = 3;
    err.family = v.family;
    throw err;
  }
  return v;
}

function take(argv, i) {
  const next = argv[i + 1];
  if (next === undefined || String(next).startsWith('--')) return null;
  return next;
}

function main(argv) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write('usage: data-class-policy.js check --engine E [--model M] [--endpoint EP] --data-class NAME\n');
    return argv.length === 0 ? 2 : 0;
  }
  if (argv[0] !== 'check') {
    process.stderr.write(`data-class-policy: unknown command ${argv[0]}\n`);
    return 2;
  }
  let engine = '';
  let model = '';
  let endpoint = '';
  let cls = '';
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engine' || a === '--model' || a === '--endpoint' || a === '--data-class') {
      const v = take(argv, i);
      if (v === null) {
        process.stderr.write(`data-class-policy: missing ${a} value\n`);
        return 2;
      }
      i += 1;
      if (a === '--engine') engine = v;
      else if (a === '--model') model = v;
      else if (a === '--endpoint') endpoint = v;
      else cls = v;
    } else {
      process.stderr.write(`data-class-policy: unknown arg ${a}\n`);
      return 2;
    }
  }
  if (!cls) {
    process.stderr.write('data-class-policy: missing --data-class\n');
    return 2;
  }
  const names = [];
  if (engine) names.push(engine);
  if (model) names.push(model);
  const v = checkNames(names, endpoint, cls, loadPolicy());
  if (!v.ok) {
    process.stderr.write(`${v.reason}\n`);
    return 3;
  }
  return 0;
}

module.exports = { assertDataClass, verdict, loadPolicy, endpointModelName, checkNames, POLICY_PATH };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = e.code || 3;
  }
}
