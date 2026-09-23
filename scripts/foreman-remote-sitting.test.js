#!/usr/bin/env node
'use strict';

// Phase 5. A local stub HTTP server plays one foreman: dispatch once, then
// return done. engine-qualify foreman --remote-provider-cmd (no
// AUTOPILOT_QUALIFY_SEED) must grade that campaign. A second, in-process
// provider checks that a restarted session is sent only the brief, the
// worktree, and .autopilot/.

const assert = require('assert');
const http = require('http');
const { spawnSync } = require('child_process');
const path = require('path');
const { runForemanQualification, createRemoteForeman } = require('../evals/foreman-eval-runner');

const ROOT = path.resolve(__dirname, '..');
let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function verdictInput(payload, kind) {
  return {
    schema: 'foreman-verdict/1',
    campaign_id: payload.campaign_id,
    verdict: kind,
    head_sha: payload.worktree.tip,
    unmet: kind === 'done' ? [] : (payload.brief.requirements || []).map((requirement) => requirement.id),
    open_findings: [],
    approval_dispatch_id: null,
    deviations: [],
  };
}

function dispatchInput(payload) {
  const brief = payload.brief;
  return {
    role: 'implementer',
    agent_id: brief.roster.implementers[0],
    base_sha: brief.base_sha,
    head_sha: payload.worktree.tip,
    paths: [`${brief.fence[0]}S1.js`],
    finding_ids: [],
    permissions: [brief.child_permissions[0]],
    allow_subdispatch: false,
    instructions: 'satisfy the brief',
  };
}

function checkSecondSession() {
  const seen = [];
  let proseUsed = false;
  const remoteSitting = runForemanQualification({
    foreman: createRemoteForeman({
      callProvider(payload) {
        seen.push(payload);
        if (payload.session > 1) return { tool: 'return_verdict', input: verdictInput(payload, 'blocked') };
        if (!proseUsed) {
          proseUsed = true;
          return { note: 'one turn, not a tool' };
        }
        if ((payload.turns || []).length < 4) return { tool: 'dispatch', input: dispatchInput(payload) };
        return { tool: 'return_verdict', input: verdictInput(payload, 'blocked') };
      },
    }),
  });
  check(remoteSitting.verdict.graded === true, 'in-process remote sitting is graded');
  check(remoteSitting.verdict.disposition !== 'aborted_transport', 'a prose turn does not abort the sitting');
  const restarted = seen.filter((payload) => payload.session > 1);
  check(restarted.length > 0, 'family H opens a second session');
  check(restarted.every((payload) => payload.brief && payload.worktree && Object.prototype.hasOwnProperty.call(payload, 'autopilot')), 'second session sends brief, worktree, and .autopilot/');
  check(restarted.every((payload) => !Object.prototype.hasOwnProperty.call(payload, 'turns') && !Object.prototype.hasOwnProperty.call(payload, 'tool_result')), 'second session omits prior turns and the tool result');
}

function startStub() {
  const serverPath = path.join(ROOT, 'scripts/foreman-remote-sitting.test.js');
  const child = require('child_process').spawn(process.execPath, [serverPath, '--http-stub'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('stub server did not bind')), 5000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const line = buffer.split('\n').find((entry) => entry.startsWith('STUB '));
      if (!line) return;
      clearTimeout(timer);
      resolve({ child, baseUrl: line.slice(5).trim() });
    });
    child.once('exit', (status) => {
      clearTimeout(timer);
      reject(new Error(`stub server exited ${status} before binding`));
    });
  });
}

function serveStub() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const user = body.messages[0].content;
      const start = user.lastIndexOf('\n{');
      const bundle = JSON.parse(user.slice(start + 1));
      const done = verdictInput(bundle, 'done');
      if (bundle.tool_result && bundle.tool_result.dispatch_id) {
        done.approval_dispatch_id = bundle.tool_result.dispatch_id;
      }
      const tool = bundle.tool_result
        ? { tool: 'return_verdict', input: done }
        : { tool: 'dispatch', input: dispatchInput(bundle) };
      const text = JSON.stringify(tool);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: 'foreman-stub',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text }],
        usage: { output_tokens: 32 },
      }));
    });
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`STUB http://127.0.0.1:${server.address().port}\n`);
  });
}

async function main() {
  checkSecondSession();
  const stub = await startStub();
  const baseUrl = stub.baseUrl;
  const hash = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const hashC = 'c'.repeat(64);
  const env = { ...process.env, QRP_TRANSPORT: 'http', QRP_PROMPT_MODE: 'foreman', QRP_BASE_URL: baseUrl, QRP_AUTH_TOKEN: 'stub-token', QRP_MODEL: 'foreman-stub', QRP_PROVIDER: 'foreman-stub' };
  delete env.AUTOPILOT_QUALIFY_SEED;
  const providerEnv = ['QRP_TRANSPORT', 'QRP_PROMPT_MODE', 'QRP_BASE_URL', 'QRP_AUTH_TOKEN', 'QRP_MODEL', 'QRP_PROVIDER'];
  const args = [
    'scripts/engine-qualify.js', 'foreman',
    '--engine', 'foreman-stub',
    '--model', 'foreman-stub',
    '--model-version', '2026-09-23',
    '--runner', 'qrp',
    '--runner-version', '1.0.0',
    '--family', 'stub',
    '--harness-version', 'foreman-phase-5',
    '--effort', 'low',
    '--prompt-config-hash', hash,
    '--semantic-fingerprint', hashB,
    '--containment-fingerprint', hashC,
    '--task-class', 'foreman',
    '--domain', 'repository',
    '--language', 'en',
    '--tool', 'dispatch',
    '--remote-provider', 'foreman-stub',
    '--remote-provider-cmd', `${process.execPath} scripts/qualification-review-provider.js`,
  ];
  for (const name of providerEnv) args.push('--provider-env', name);
  const run = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  stub.child.kill('SIGTERM');
  check(run.status === 0 || run.status === 1, `qualify exited (${run.status}) ${run.stderr}`);
  const verdict = JSON.parse(run.stdout);
  check(verdict.disposition !== 'aborted_transport', `not aborted_transport (${verdict.disposition} ${verdict.aborted_at_campaign_index})`);
  check(verdict.graded === true, 'the stub campaign is graded');
  check(verdict.pass !== null && verdict.fail !== null, 'pass and fail are not null');
  const campaign = verdict.evidence.trials[0].campaigns[0];
  check(campaign && campaign.checks && campaign.solvable === true, `campaign 0 is a graded solvable record (${campaign && campaign.family})`);
  check(campaign.verdict_raw === 'done', `solvable campaign returned done (${campaign.verdict_raw})`);
  console.log(`${assertions} assertions passed`);
}

if (process.argv[2] === '--http-stub') {
  serveStub();
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
