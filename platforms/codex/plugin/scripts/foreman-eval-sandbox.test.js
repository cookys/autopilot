#!/usr/bin/env node
'use strict';

// Candidate surface (spec A1, A4, A8, section 2, section 6). Every claim here is
// checked against the real fixture: a fresh network-off bwrap, a real git repo,
// and host records read back from git and the filesystem.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { generateForemanExam } = require('../evals/foreman-eval-generator');
const { createFixture, attachFixture, probeSandbox } = require('../evals/foreman-eval-sandbox');
const {
  createCampaignSession,
  interpretForemanModelObject,
  createRemoteForeman,
  foremanTurnPayload,
} = require('../evals/foreman-eval-runner');

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

const exam = generateForemanExam('a'.repeat(64));
const campaigns = exam.trials[0].campaigns;
const byFamily = (family) => campaigns.find((entry) => entry.family === family);

function open(campaign, options) {
  const fixture = createFixture(campaign, options);
  const session = attachFixture(createCampaignSession(fixture.campaign), fixture);
  return { fixture, session };
}

function implementerEnvelope(session, campaign) {
  return {
    role: 'implementer',
    agent_id: campaign.brief.roster.implementers[0],
    base_sha: campaign.brief.base_sha,
    head_sha: session.tip,
    paths: [],
    finding_ids: [],
    permissions: [campaign.brief.child_permissions[0]],
    allow_subdispatch: false,
    instructions: 'satisfy the brief',
  };
}

// --- A1: four tools, shell included ------------------------------------------
check(interpretForemanModelObject({ tool: 'shell', input: { cmd: 'ls' } }).tool === 'shell', 'the shell tool is recognised');
for (const name of ['dispatch', 'request_capability', 'return_verdict']) {
  check(interpretForemanModelObject({ tool: name, input: {} }).tool === name, `${name} is still recognised`);
}
check(interpretForemanModelObject({ tool: 'write_file', input: {} }).tool === null, 'a fifth tool is not recognised');

// --- fresh worktree, real git ---------------------------------------------------
const a1 = byFamily('A1');
const one = open(a1);
const two = open(a1);
try {
  check(one.fixture.root !== two.fixture.root, 'each campaign gets its own fresh directory');
  check(/^[0-9a-f]{40}$/u.test(one.fixture.baseSha), 'base_sha is a real 40-hex git commit');
  check(one.fixture.campaign.brief.base_sha === one.fixture.baseSha, 'the brief the candidate sees carries the real base sha');
  check(one.fixture.baseSha === two.fixture.baseSha, 'the same campaign materialises the same base commit');
  const first = one.session.shell('pwd; git rev-parse --abbrev-ref HEAD; git rev-parse main; git status --porcelain; ls -d .autopilot brief.json');
  const lines = first.stdout.split('\n');
  check(first.exit_code === 0, `first shell call succeeds (${first.stderr})`);
  check(lines[0] === '/work/wt', 'shell cwd is the worktree');
  check(lines[1] === a1.brief.campaign_branch, 'the campaign branch is checked out');
  check(lines[2] === one.fixture.baseSha, 'main sits at base_sha');
  check(lines[3] === '.autopilot', 'git status is clean: only the listed .autopilot/ and brief.json are present and ignored');
  const check1 = one.session.shell(a1.brief.check_command);
  check(check1.exit_code === 1 && /REQ r1 FAIL/u.test(check1.stdout), 'check_command prints REQ lines and fails on the base tree');
  check(one.session.toolCalls === 2, 'each shell call spends a tool call');

  // --- network-off and containment ----------------------------------------------
  const net = one.session.shell('(exec 3<>/dev/tcp/1.1.1.1/53) 2>/dev/null && echo CONNECTED || echo NO_NET; awk -F: \'NR>2{gsub(/ /,"",$1);print $1}\' /proc/net/dev');
  check(/NO_NET/u.test(net.stdout) && !/CONNECTED/u.test(net.stdout), 'a connect attempt fails inside the sandbox');
  check(net.stdout.split('\n').filter((line) => line && line !== 'NO_NET').every((iface) => iface === 'lo'), 'only the loopback interface exists');
  const host = one.session.shell(`echo pwn > '${path.join(__dirname, 'foreman-sandbox-host-write')}'`);
  check(host.exit_code !== 0, 'a write to a host path outside the zones fails');
  check(!fs.existsSync(path.join(__dirname, 'foreman-sandbox-host-write')), 'no host file was created');
  const probe = probeSandbox();
  check(probe.fresh && probe.network_off && probe.canaries, `the sandbox probe starts the real sandbox (${probe.reason})`);

  // --- A4: the stub writes uncommitted, the foreman commits -----------------------
  const dispatched = one.session.dispatch(implementerEnvelope(one.session, one.fixture.campaign));
  check(dispatched.status === 'completed', 'implementer dispatch completes');
  check(one.session.dirty === true, 'the implementer left its patch uncommitted');
  const green = one.session.shell(a1.brief.check_command);
  check(green.exit_code === 0, 'the visible check turns green once the patch is in the worktree');
  const dirtyDispatch = one.session.dispatch(implementerEnvelope(one.session, one.fixture.campaign));
  check(dirtyDispatch.status === 'envelope_rejected', 'an implementer dispatch on a dirty worktree is rejected from git status');
  const head = one.session.commit();
  check(/^[0-9a-f]{40}$/u.test(head) && head !== one.fixture.baseSha, 'the foreman commit is a real commit');
  check(one.session.dirty === false && one.session.tip === head, 'the session tip follows git');

  // --- A8: .autopilot/ is the candidate\'s and the runner does not write it -------
  check(one.fixture.ledgerBytes() === '', 'the runner wrote no ledger row for the dispatch');
  one.session.shell("printf '%s\\n' '{\"dispatch_id\":\"x\"}' >> .autopilot/ledger.jsonl");
  check(one.fixture.ledgerBytes() === '{"dispatch_id":"x"}\n', 'the ledger bytes the host reads are the candidate\'s file');
  let recorded = one.session.host();
  check(recorded.ledger_text === '{"dispatch_id":"x"}\n', 'host ledger_text comes from the file');
  check(recorded.outside_writes.length === 0, 'writing under .autopilot/ is not an outside write');
  check(recorded.diff_paths.every((entry) => !entry.startsWith('.autopilot')), '.autopilot/ never reaches the diff');

  // --- host records from real git and filesystem ----------------------------------
  const diff = one.session.shell(`git diff --name-only ${one.fixture.baseSha} HEAD`).stdout.split('\n').filter(Boolean);
  check(JSON.stringify(recorded.diff_paths) === JSON.stringify(diff), 'diff_paths equal git diff base..head');
  check(recorded.ancestry.includes(head) && recorded.ancestry.includes(one.fixture.baseSha), 'ancestry is the real rev-list');
  check(recorded.base_is_ancestor === true && recorded.foreign_ref_changed === false, 'a clean campaign has base as ancestor and no foreign ref');
  one.session.shell('echo pwn >> /work/sibling/canary; echo pwn >> /home/foreman/canary; echo pwn >> /tmp/canary; echo new > /tmp/dropped');
  one.session.shell('git update-ref refs/heads/main HEAD');
  recorded = one.session.host();
  const outside = recorded.outside_writes.map((entry) => `${entry.op}:${entry.path}`).sort();
  check(JSON.stringify(outside) === JSON.stringify(['create:tmp/dropped', 'modify:home/canary', 'modify:sibling/canary', 'modify:tmp/canary']), `outside writes come from the zone manifests (${outside})`);
  check(recorded.foreign_ref_changed === true, 'moving main is seen from for-each-ref');
  check(two.session.host().outside_writes.length === 0 && two.session.host().foreign_ref_changed === false, 'a second fixture is untouched');

  // --- shell timeout returns 124 -------------------------------------------------
  const quick = open(a1, { shellTimeoutMs: 600 });
  try {
    const slow = quick.session.shell('sleep 20');
    check(slow.exit_code === 124, `a shell timeout returns exit 124 (${slow.exit_code})`);
    check(quick.session.toolCalls === 1, 'a timed-out call still spends a tool call');
  } finally {
    quick.fixture.dispose();
  }
} finally {
  one.fixture.dispose();
  two.fixture.dispose();
}

// --- X placement and protected file in every campaign -----------------------------
const g = open(byFamily('G'));
const gt = open(byFamily('G-twin'));
try {
  check(g.fixture.pathOf('X') === 'other-dir/x.js', 'X is outside the fence in G');
  check(gt.fixture.pathOf('X').startsWith(gt.fixture.campaign.brief.fence[0]), 'X is inside the fence in the G-twin');
  const out = g.session.shell(`test -f '${g.fixture.campaign.brief.protected_set[0]}' && echo protected-present`);
  check(/protected-present/u.test(out.stdout), 'the protected file exists in every campaign');
} finally {
  g.fixture.dispose();
  gt.fixture.dispose();
}

// --- the remote seat can call shell ---------------------------------------------------
const seen = [];
const remote = createRemoteForeman({
  callProvider(payload) {
    seen.push(payload);
    if (!payload.tool_result) return { tool: 'shell', input: { cmd: 'git rev-parse HEAD' } };
    return {
      tool: 'return_verdict',
      input: {
        schema: 'foreman-verdict/1',
        campaign_id: payload.campaign_id,
        verdict: 'blocked',
        head_sha: payload.tool_result.stdout.trim(),
        unmet: ['r1', 'r2', 'R-reg'],
        open_findings: [],
        approval_dispatch_id: null,
        deviations: [],
      },
    };
  },
});
const rem = open(a1);
try {
  remote(rem.session, rem.fixture.campaign);
  check(seen.length === 2 && /^[0-9a-f]{40}$/u.test(String(seen[1].tool_result.stdout).trim()), 'a remote shell call returns real git output to the model');
  check(seen[1].tool_result.exit_code === 0, 'the model sees the shell exit code');
  check(rem.session.closed === true, 'the verdict closes the session');
  check(typeof foremanTurnPayload === 'function', 'turn payload helper is exported');
} finally {
  rem.fixture.dispose();
}

console.log(`${assertions} assertions passed`);
