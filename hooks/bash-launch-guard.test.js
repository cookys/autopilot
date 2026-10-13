/**
 * Tests for the Bash-launch guard inside depth0-delegate-gate.js (BL-0019), rules in
 * scripts/lib/bash-launch-rules.js. Black-box: spawns the real hook.
 *
 * Run: node --test hooks/bash-launch-guard.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'depth0-delegate-gate.js');

function run(cmd, { shell = 'bash', extra = {}, env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blg-home-'));
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'blg-live-'));
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash', session_id: 'blg', hook_event_name: 'PreToolUse', cwd: home,
      tool_input: { command: cmd }, ...extra,
    }),
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_BASH_GUARD_SHELL: shell, ...env,
    },
  });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* leave null */ }
  const h = out && out.hookSpecificOutput;
  return {
    deny: !!(h && h.permissionDecision === 'deny'),
    ctx: (h && h.additionalContext) || '',
    reason: (h && h.permissionDecisionReason) || '',
    status: r.status,
  };
}

// ---- Rule 1: detach rail without wake-up => deny ----
for (const cmd of [
  'nohup scripts/dispatch-review.sh --base a --head b > /tmp/x.log 2>&1 &',
  'setsid -f bash scripts/dispatch-author.sh brief.md',
  'setsid --fork scripts/dispatch-review.sh x',
  'bash scripts/dispatch-hetero.sh foo &',
  'cd /repo && nohup node scripts/dispatch-plan-review.js --x y &',
  "bash -c 'nohup scripts/dispatch-explore.sh q &'",
  'nohup scripts/dispatch-review.sh x & echo wait;', // `wait` as an argument is not a waiter
  '(setsid nohup "$ROOT/scripts/dispatch-review.sh" x &)',
  'env FOO=1 nohup bash scripts/dispatch-consult.sh q &',
  // whole pipeline / and-list / loop / group backgrounded (review round 2)
  'scripts/dispatch-review.sh x 2>&1 | tee /tmp/l &',
  'env X=1 bash scripts/dispatch-review.sh a 2>&1 | tee /tmp/r.log &',
  'cd /repo && scripts/dispatch-review.sh x &',
  'for s in a b; do bash scripts/dispatch-review.sh --seat $s > /tmp/$s.log 2>&1 & done',
  'if true; then bash scripts/dispatch-review.sh x & fi',
  '{ scripts/dispatch-review.sh x; } &',
  // more prefixes
  'timeout 600 scripts/dispatch-review.sh x &',
  'nice -n 5 scripts/dispatch-review.sh x &',
  'sudo -u bob scripts/dispatch-review.sh x &',
  'cd scripts && nohup ./dispatch-review.sh x &',
  // whole loop / conditional backgrounded
  'for i in 1 2; do scripts/dispatch-review.sh $i; done &',
  'if true; then scripts/dispatch-review.sh x; fi &',
  'while true; do for i in 1 2; do scripts/dispatch-review.sh $i; done; done &',
  'for i in 1 2; do scripts/dispatch-review.sh $i; done > /tmp/log 2>&1 &',
]) {
  test(`rule1 denies: ${cmd}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /run_in_background/);
  });
}

test('rule1 denies at subagent depth too (agent_id present)', () => {
  assert.strictEqual(run('nohup scripts/dispatch-review.sh x &', { extra: { agent_id: 'a1' } }).deny, true);
});

for (const cmd of [
  'setsid nohup bash x.sh > /tmp/o 2>&1 &', // detach, but not a rail
  'scripts/dispatch-review.sh --base a --head b', // foreground rail
  'echo "nohup scripts/dispatch-review.sh &"', // quoted mention
  'nohup scripts/dispatch-review.sh x & scripts/wait-dispatch-results.js --dir d', // has a waiter
  'nohup scripts/dispatch-review.sh x --ledger L --run-id R --stage S > out.log 2>&1 & node scripts/wait-dispatch-results.js --ledger L --expect R.S', // the deny message's own recipe
  'scripts/dispatch-review.sh x & wait $!', // builtin wait
  'setsid -w scripts/dispatch-review.sh x', // setsid --wait is foreground
  'setsid bash scripts/dispatch-author.sh brief.md', // bare setsid runs in the foreground
  'nohup scripts/dispatch-review.sh x > /tmp/o 2>&1', // bare nohup runs in the foreground
  'nohup bash scripts/dispatch-review.sh x',
  'cat <<EOF\nnohup scripts/dispatch-review.sh &\nEOF', // heredoc body is data
  'grep -n dispatch-review.sh docs/x.md &&  echo ok', // && is not background
  'nohup node scripts/dispatch-status.js --run x > /tmp/o 2>&1 &',
  'scripts/dispatch-review.sh x 2>&1 | tail -5', // 2>&1 is not background
  'grep dispatch-hetero.sh foo &', // rail name only as an argument
  'git log -- scripts/dispatch-review.sh &',
  'ps aux | grep dispatch-review.sh &',
  "bash -c 'grep dispatch-review.sh docs' &",
  'setsid nohup bash hooks/tests/dispatch-contract-pin.test.sh > /tmp/o 2>&1 &', // test file, not a rail
  'node --test scripts/dispatch-review.test.js &',
  'for s in a b; do bash scripts/dispatch-review.sh --seat $s; done', // foreground loop
  'for s in a b; do scripts/dispatch-review.sh $s & done; wait', // waiter present
  '{ scripts/dispatch-review.sh x; }', // foreground group
  'cd hooks/tests && ./dispatch-contract-pin.test.sh &', // test file via ./
  'echo hi | tee /tmp/x &', // pipeline without a rail
  'node scripts/dispatch-status.js --run x &', // observers / validators are not launchers
  'node scripts/dispatch-contract.js --check &',
  'nohup node scripts/dispatch-tree.js &',
  'cd scripts && ./dispatch-status.js &',
  'for i in 1 2; do echo $i; done &', // backgrounded loop without a rail
  'for i in 1 2; do scripts/dispatch-review.sh $i; done', // same loop in the foreground
  'if true; then echo hi; fi &',
  './dispatch-review.sh x &', // ./ form only counts after a cd scripts
]) {
  test(`rule1 allows: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
    assert.doesNotMatch(r.ctx, /detach-no-wake/);
  });
}

// ---- heredoc bodies inside "$(…)" are data (commit / PR messages) ----
const MSG_HEREDOC = [
  'git commit -m "$(cat <<\'EOF\'\nnohup scripts/dispatch-review.sh x & \n\nEOF\n)"',
  'gh pr create --title t --body "$(cat <<\'EOF\'\nnohup scripts/dispatch-review.sh x &\nEOF\n)"',
];
for (const cmd of MSG_HEREDOC) {
  test(`heredoc in substitution is data (rule 1): ${JSON.stringify(cmd).slice(0, 50)}`, () => {
    assert.strictEqual(run(cmd).deny, false);
  });
}
test('heredoc in substitution is data (rule 3, zsh)', () => {
  const r = run('git commit -m "$(cat <<\'EOF\'\nsee hooks/*.zzq and =x\nEOF\n)"', { shell: 'zsh' });
  assert.doesNotMatch(r.ctx, /zsh-expansion/);
});
test('a REAL detached rail inside a substitution is still denied', () => {
  assert.strictEqual(run('echo "$(nohup scripts/dispatch-review.sh x &)"').deny, true);
});

// ---- Rule 2: pkill/pgrep -f without [x] => warn only ----
for (const cmd of ['pkill -f dispatch-review', 'pgrep -fa "my server"', 'sudo pkill -9 -f foo', 'kill $(pgrep -f myserver)', 'echo `pgrep -f foo`']) {
  test(`rule2 warns: ${cmd}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
    assert.match(r.ctx, /pkill-self-match/);
  });
}
for (const cmd of ["pkill -f '[d]ispatch-review'", 'pgrep -f "[f]oo bar"', 'pkill node', 'pkill -x node', 'echo "pkill -f foo"', 'pkill -f "$PAT"']) {
  test(`rule2 silent: ${cmd}`, () => {
    assert.doesNotMatch(run(cmd).ctx, /pkill-self-match/);
  });
}

// ---- Rule 3: zsh only, warn only ----
for (const cmd of ['git config a =b', 'echo foo ==x', 'curl https://x.test/a?b=1', 'ls /nonexistent-dir-blg/*.zzz', 'grep -r foo --include=*.zzz .']) {
  test(`rule3 warns under zsh: ${cmd}`, () => {
    const r = run(cmd, { shell: 'zsh' });
    assert.strictEqual(r.deny, false);
    assert.match(r.ctx, /zsh-expansion/);
  });
  test(`rule3 silent under bash: ${cmd}`, () => {
    assert.doesNotMatch(run(cmd, { shell: 'bash' }).ctx, /zsh-expansion/);
  });
}
for (const cmd of ["echo '=' x", 'echo "a = b"', 'echo foo = bar', '[ "$x" = y ]', 'test a = a', 'echo "a"=b', 'ls "$HOME"/projects/*', 'ls ~/.claude/*.json', 'ls $HOME/.claude/*.json', 'cd hooks && ls *.test.js', "bash -c 'ls /nonexistent-dir-blg/*.zzz'", "bash -c 'echo =x'", 'ls /*/*/*/*/*/*/*.zzqq', 'ls a*/b*/c*/d*/e*.zzqq', 'ls /nonexistent-dir-blg/**/*.zzz', 'FOO=bar env', 'ls --color=auto', 'grep -E "[a-z]+" f', "ls '*.js'", 'echo $?', '[[ a == b ]] && echo y', 'echo $((1*2))', 'cat <<EOF\n= x\n*.zzz\nEOF']) {
  test(`rule3 silent under zsh: ${JSON.stringify(cmd)}`, () => {
    assert.doesNotMatch(run(cmd, { shell: 'zsh' }).ctx, /zsh-expansion/);
  });
}

test('mode off silences the guard', () => {
  const r = run('nohup scripts/dispatch-review.sh x &', { env: { AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: 'off' } });
  assert.strictEqual(r.deny, false);
});

test('rule1 still denies in block and warn modes', () => {
  for (const mode of ['warn', 'block']) {
    assert.strictEqual(run('setsid -f scripts/dispatch-review.sh x', { env: { AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: mode } }).deny, true);
  }
});

test('pkill warning merges with the wait advisory (no early return)', () => {
  const r = run('pkill -f foo; tail -f /tmp/x.log');
  assert.match(r.ctx, /pkill-self-match/);
  assert.match(r.ctx, /foreground wait/);
});

test('warnings also reach subagent depth (agent_id present)', () => {
  assert.match(run('pkill -f foo', { extra: { agent_id: 'a1' } }).ctx, /pkill-self-match/);
});

test('deny message names both paths and the three ledger flags', () => {
  const r = run('nohup scripts/dispatch-review.sh x &');
  assert.match(r.reason, /run_in_background/);
  assert.match(r.reason, /wait-dispatch-results/);
  assert.match(r.reason, /--ledger.*--run-id.*--stage/);
});

// The recipe the deny message gives, executed for real: a stub rail that uses the real
// scripts/lib/dispatch-detach.sh, then scripts/wait-dispatch-results.js in the same command.
const REPO = path.join(__dirname, '..');
function recipe(withLedgerArgs, waiter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blg-recipe-'));
  const stub = path.join(dir, 'stub-rail.sh');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env bash',
    'LEDGER=""; RUN_ID=""; STAGE=""; ORIG=("$@")',
    'while [ $# -gt 0 ]; do case "$1" in --ledger) LEDGER="$2"; shift 2;; --run-id) RUN_ID="$2"; shift 2;; --stage) STAGE="$2"; shift 2;; *) shift;; esac; done',
    `. "${REPO}/scripts/lib/dispatch-detach.sh"`,
    `dispatch_detach_supervise "$0" "$LEDGER" "$RUN_ID" "$STAGE" "${REPO}/scripts" -- "\${ORIG[@]}"`,
    'sleep 1; echo \'{"ok":true}\'',
  ].join('\n'), { mode: 0o755 });
  const ledgerArgs = withLedgerArgs ? `--ledger ${dir}/L --run-id r1 --stage s1` : '';
  const sh = `( nohup ${stub} ${ledgerArgs} > ${dir}/out 2>&1 & ${waiter(dir)} )`;
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', sh], { encoding: 'utf8' });
  return { r, ms: Date.now() - t0 };
}
const WAIT = (dir) => `node ${REPO}/scripts/wait-dispatch-results.js --ledger ${dir}/L --expect r1.s1 --timeout 4 --poll 1`;

test('recipe: detached rail WITH ledger/run-id/stage + wait-dispatch-results lands in time', () => {
  const { r } = recipe(true, WAIT);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).complete, true);
});

test('recipe: the same without the three ledger args never lands (waiter times out)', () => {
  const { r } = recipe(false, WAIT);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(JSON.parse(r.stdout).complete, false);
});

test('recipe: bare `wait` also wakes after a detached rail', () => {
  const { r, ms } = recipe(true, () => 'wait');
  assert.strictEqual(r.status, 0);
  assert.ok(ms >= 900 && ms < 10000);
});

test('deep glob is bounded (worst case stays fast)', () => {
  const t0 = Date.now();
  run('ls /*/*/*/*/*/*/*.zzqq', { shell: 'zsh' });
  assert.ok(Date.now() - t0 < 1500);
});

// Drift guard: every launching rail script in scripts/ is on the guard's explicit list. A new
// scripts/dispatch-*.sh|js must either be a rail (add it to RAIL_NAMES) or an observer (add it here).
const OBSERVERS = new Set(['dispatch-status.js', 'dispatch-contract.js', 'dispatch-tree.js']);
for (const f of fs.readdirSync(path.join(__dirname, '..', 'scripts'))) {
  if (!/^dispatch-.*\.(sh|js)$/.test(f) || /\.test\./.test(f) || OBSERVERS.has(f)) continue;
  test(`rail on the explicit list: ${f}`, () => {
    assert.strictEqual(run(`nohup scripts/${f} x &`).deny, true);
  });
}
