'use strict';
// Spike harness: estimate a remote reviewer's per-case accuracy on the
// engine-qualify corpus BEFORE spending a full 2-trial qualification run.
// Generates a seeded corpus sample, drives scripts/qualification-review-provider.js
// per case with a broker-shaped request, and scores against the generator's own
// ground truth (rule/file/line/severity + canonical witness equality) — the same
// predicates engine-qualify.js applies.
// Usage:
//   QRP_BASE_URL=... QRP_AUTH_TOKEN=... QRP_MODEL=... QRP_PROVIDER=spike \
//     node spike-harness.js <seed-label> <knownBadCount> <cleanCount>
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '../../../../..');
const { generateReviewerEvaluation } = require(path.join(repo, 'evals/reviewer-eval-generator'));
const { canonicalJson } = require(path.join(repo, 'src/engine/owner-kernel/canonical'));

const seedLabel = process.argv[2] || 'spike-1';
const kbCount = Number(process.argv[3] || 5);
const clCount = Number(process.argv[4] || 4);
const seed = crypto.createHash('sha256').update(seedLabel).digest('hex');
const ev = generateReviewerEvaluation(seed);

function pickSpread(list, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(list[Math.floor((i * list.length) / n)]);
  return out;
}

const cases = [
  ...pickSpread(ev.knownBad, Math.min(kbCount, ev.knownBad.length)).map((c) => ({ kind: 'known-bad', c })),
  ...pickSpread(ev.clean, Math.min(clCount, ev.clean.length)).map((c) => ({ kind: 'clean', c })),
];

let pass = 0;
const failures = [];
for (const [index, { kind, c }] of cases.entries()) {
  const request = {
    schema_version: 1,
    request_id: `spike-${index}`,
    role: 'reviewer',
    payload: { format: 'unified_diff', content: c.diff },
  };
  const run = spawnSync('node', [path.join(repo, 'scripts/qualification-review-provider.js')], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    env: process.env,
    timeout: 200_000,
  });
  let verdictInfo = { ok: false, why: `adapter exit ${run.status}: ${String(run.stderr).slice(0, 200)}` };
  if (run.status === 0) {
    try {
      const wrapped = JSON.parse(run.stdout);
      const result = JSON.parse(wrapped.output);
      if (kind === 'clean') {
        verdictInfo = result.verdict === 'pass' && result.findings.length === 0
          ? { ok: true }
          : { ok: false, why: `false positive: ${JSON.stringify(result).slice(0, 300)}` };
      } else {
        const f = Array.isArray(result.findings) ? result.findings[0] : null;
        if (result.verdict !== 'fail' || !f) {
          verdictInfo = { ok: false, why: `false pass (missed ${c.ruleId})` };
        } else {
          const checks = {
            rule: f.rule_id === c.ruleId,
            file: f.file === c.file,
            line: f.line === c.changedLine,
            severity: f.severity === c.severity,
            witness: !!f.witness && canonicalJson({
              export_path: f.witness.export_path,
              args: f.witness.args,
              environment: f.witness.environment,
            }) === canonicalJson(c.witnessCall),
          };
          const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
          verdictInfo = bad.length === 0
            ? { ok: true }
            : {
              ok: false,
              why: `caught ${c.ruleId} but wrong ${bad.join(',')}: got ${JSON.stringify({ rule: f.rule_id, file: f.file, line: f.line, severity: f.severity, witness: f.witness && { export_path: f.witness.export_path, args: f.witness.args, environment: f.witness.environment } })} want ${JSON.stringify({ line: c.changedLine, severity: c.severity, witness: c.witnessCall })}`,
            };
        }
      }
    } catch (error) {
      verdictInfo = { ok: false, why: `unparseable adapter output: ${error.message}` };
    }
  }
  const label = `${kind}${kind === 'known-bad' ? `:${c.ruleId}` : `:${c.id || 'case'}`}`;
  if (verdictInfo.ok) {
    pass += 1;
    console.log(`OK   ${label}`);
  } else {
    failures.push({ label, why: verdictInfo.why });
    console.log(`FAIL ${label} — ${verdictInfo.why}`);
  }
}
console.log(`\n${pass}/${cases.length} cases correct`);
process.exit(failures.length === 0 ? 0 : 1);
