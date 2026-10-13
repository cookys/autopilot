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

// Every temp dir this file creates is removed when the file ends (pass or fail) — never leave blg-* behind.
const made = [];
function mk(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}
function rmAll() { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }
test.after(rmAll);
process.on('exit', rmAll);

function run(cmd, { shell = 'bash', extra = {}, env = {} } = {}) {
  const home = mk('blg-home-');
  const live = mk('blg-live-');
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
  'scripts/dispatch-review.sh x |& tee /tmp/l &', // `|&` pipeline that IS backgrounded
  'cd scripts && bash dispatch-review.sh x &', // bare file name after a cd
  'pushd scripts && ./dispatch-review.sh x &',
  './dispatch-review.sh x &',
  'bash dispatch-review.sh x &',
  'cd /repo/scripts && setsid -f ./dispatch-hetero.sh x',
  'scripts/dispatch-review.sh x & wait 999', // wait for a different pid
  'scripts/dispatch-review.sh x & wait | cat', // a pipeline member waits for nothing
  'scripts/dispatch-review.sh x & wait |& tee /tmp/l',
  'scripts/dispatch-review.sh x & wait 123 456',
  'scripts/dispatch-review.sh x & wait 999 > /dev/null', // redirected, but still a different pid
  'echo `nohup scripts/dispatch-review.sh x &`', // unquoted backtick substitution
  'x=`setsid -f scripts/dispatch-review.sh x`; echo $x',
  'echo `date; scripts/dispatch-review.sh x &`',
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
  'bash scripts/dispatch-review.sh --base a --head b |& tee /tmp/log', // `|&` is a foreground pipe, not a background `&`
  'scripts/dispatch-review.sh x |& tail -5 && echo done',
  "echo '`nohup scripts/dispatch-review.sh x &`'", // single-quoted backticks are data
  'echo `date`; scripts/dispatch-review.sh x', // backtick substitution without a rail launch
  'for i in 1 2; do echo $i; done &', // backgrounded loop without a rail
  'for i in 1 2; do scripts/dispatch-review.sh $i; done', // same loop in the foreground
  'if true; then echo hi; fi &',
  // look-alikes that are NOT on the rail list
  'bash dispatch-reviewer.sh x &',
  'bash dispatch-review.sh.bak x &',
  'bash my-dispatch-review.sh x &',
  'bash dispatch-foo.sh x &',
  'cd scripts && ./dispatch-review.test.sh &',
  'cd scripts && bash dispatch-status.js &',
  'scripts/dispatch-review.sh x & wait', // bare wait
  'scripts/dispatch-review.sh x & wait $!',
  'scripts/dispatch-review.sh x & wait "$!"',
  'scripts/dispatch-review.sh x & wait 2>/dev/null',
  'scripts/dispatch-review.sh x & wait > /dev/null',
  'scripts/dispatch-review.sh x & wait 2> /dev/null',
  'scripts/dispatch-review.sh x & wait &>/dev/null',
  'scripts/dispatch-review.sh x & wait &> /dev/null', // space-separated target
  'scripts/dispatch-review.sh x & wait $! > /tmp/o 2>&1',
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
for (const cmd of ['pkill -f dispatch-review', 'pgrep -fa "my server"', 'sudo pkill -9 -f foo', 'kill $(pgrep -f myserver)', 'echo `pgrep -f foo`', 'pgrep -u me -f foo', 'pkill -u me -f "my server"']) {
  test(`rule2 warns: ${cmd}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
    assert.match(r.ctx, /pkill-self-match/);
  });
}
for (const cmd of ["pkill -f '[d]ispatch-review'", 'pgrep -f "[f]oo bar"', 'pkill node', 'pkill -x node', 'echo "pkill -f foo"', 'pkill -f "$PAT"', 'pgrep -u me -f "[f]oo"', 'pkill -P 1 -fa "[f]oo"', 'pgrep -f --uid me "[f]oo"']) {
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
for (const cmd of ["echo '=' x", 'echo "a = b"', 'echo foo = bar', '[ "$x" = y ]', 'test a = a', 'echo "a"=b', 'ls "$HOME"/projects/*', 'ls ~/.claude/*.json', 'ls $HOME/.claude/*.json', 'cd hooks && ls *.test.js', "bash -c 'ls /nonexistent-dir-blg/*.zzz'", "bash -c 'echo =x'", 'ls /*/*/*/*/*/*/*.zzqq', 'ls a*/b*/c*/d*/e*.zzqq', 'ls nonexistent-a*/b*.zzqq', 'ls /nonexistent-dir-blg/**/*.zzz', 'FOO=bar env', 'ls --color=auto', 'grep -E "[a-z]+" f', "ls '*.js'", 'echo $?', '[[ a == b ]] && echo y', 'echo $((1*2))', 'cat <<EOF\n= x\n*.zzz\nEOF', 'case $x in\n  *) echo y;;\nesac', 'case $x in a|*.zzq) echo y;; esac', 'x=*.zzq', 'export X=*.zzq; echo $X']) {
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

// The message offers only what literally works for this (shape, rail) pair.
test('message: `&` + ledger rail offers run_in_background, `& wait` and the ledger waiter', () => {
  const r = run('nohup scripts/dispatch-review.sh x &');
  assert.match(r.reason, /run_in_background/);
  assert.match(r.reason, /put `wait` after it/);
  assert.match(r.reason, /--ledger.*--run-id.*--stage/);
  assert.match(r.reason, /wait-dispatch-results\.js --ledger <path> --expect/);
  assert.match(r.reason, /whole command with `run_in_background: true`/); // the waiter outlasts the 600 s foreground limit
});
test('message: `&` + non-ledger rail offers run_in_background and `& wait`, no ledger recipe', () => {
  const r = run('nohup scripts/dispatch-consult.sh x &');
  assert.match(r.reason, /run_in_background/);
  assert.match(r.reason, /put `wait` after it/);
  assert.doesNotMatch(r.reason, /--run-id/);
  assert.match(r.reason, /dispatch-consult never writes the \.exit file/);
});
test('message: `setsid -f` + ledger rail offers the ledger waiter and says bare wait does not work', () => {
  const r = run('setsid -f scripts/dispatch-author.sh x');
  assert.match(r.reason, /does not wait for a `setsid -f` job/);
  assert.doesNotMatch(r.reason, /put `wait` after it/);
  assert.match(r.reason, /--ledger.*--run-id.*--stage/);
});
test('message: `setsid -f` + non-ledger rail offers run_in_background only', () => {
  const r = run('setsid -f scripts/dispatch-explore.sh x');
  assert.match(r.reason, /run_in_background/);
  assert.doesNotMatch(r.reason, /put `wait` after it|--run-id/);
});
test('message: foreman has a fixed stage', () => {
  const r = run('nohup scripts/dispatch-foreman.sh x &');
  assert.match(r.reason, /--expect <id>\.foreman/);
  assert.match(r.reason, /whole command\s+with `run_in_background: true`|whole command with `run_in_background: true`/);
  assert.doesNotMatch(r.reason, /--stage/);
});

// ---- `$(…)` with parens / backticks / nesting in a heredoc body (commit & PR messages) ----
const MSG2 = [
  "git commit -m \"$(cat <<'EOF'\nfix: avoid `nohup scripts/dispatch-review.sh x &` (note)\nEOF\n)\"",
  "git commit -m \"$(cat <<'EOF'\nsubject\n\nnohup scripts/dispatch-review.sh x & (see (a) and (b))\nEOF\n)\"",
  "git commit -m \"$(cat <<'EOF'\nunbalanced ( paren and ) another ) )\n`nohup scripts/dispatch-review.sh x &`\nEOF\n)\"",
  "git commit -m \"$(cat <<'EOF'\nopen ( only\n$(nohup scripts/dispatch-review.sh x &)\nEOF\n)\"",
  "gh pr create --body \"$(cat <<'EOF'\n- item (one)\n- `setsid -f scripts/dispatch-review.sh x`\nEOF\n)\"",
  "git commit -m \"$(cat <<-'EOF'\n\tnohup scripts/dispatch-review.sh x & (y\n\tEOF\n)\"",
];
for (const cmd of MSG2) {
  test(`parens/backticks in a heredoc inside $(…) are data: ${JSON.stringify(cmd).slice(0, 60)}`, () => {
    const r = run(cmd, { shell: 'zsh' });
    assert.strictEqual(r.deny, false);
    assert.doesNotMatch(r.ctx, /zsh-expansion|detach-no-wake/);
  });
}
test('nested $( $( ) ) with a real detached rail inside is still denied', () => {
  assert.strictEqual(run('echo "$(echo $(nohup scripts/dispatch-review.sh x &))"').deny, true);
  assert.strictEqual(run('echo "$(echo "$(printf \'(\'; nohup scripts/dispatch-review.sh x &)")"').deny, true);
});
test('nested $( $( ) ) around a heredoc is data', () => {
  assert.strictEqual(run("echo \"$(echo \"$(cat <<'EOF'\nnohup scripts/dispatch-review.sh x & (y\nEOF\n)\")\")\"").deny, false);
});
test('a quoted paren inside $(…) does not end it early', () => {
  assert.strictEqual(run("echo \"$(printf ')' ; nohup scripts/dispatch-review.sh x &)\"").deny, true);
});
const { findSubstitutions } = require('../scripts/lib/bash-launch-rules.js');
test('findSubstitutions: depth-aware, skips quotes and heredocs', () => {
  assert.deepStrictEqual(findSubstitutions('a $(b $(c) d) e'), ['b $(c) d']);
  assert.deepStrictEqual(findSubstitutions("x \"$(cat <<'E'\n) ( \nE\n)\" y"), ["cat <<'E'\n) ( \nE\n"]);
  assert.deepStrictEqual(findSubstitutions("echo '$(no)' `yes`"), ['yes']);
  assert.deepStrictEqual(findSubstitutions('echo $(unclosed ('), ['unclosed (']);
});

// ---- wake-up is only real for a trailing `&` in the same shell level followed by `wait` ----
for (const cmd of [
  'setsid -f scripts/dispatch-review.sh x; wait',
  'setsid -f scripts/dispatch-review.sh x\nwait',
  '(scripts/dispatch-review.sh x &); wait',
  'wait; scripts/dispatch-review.sh x &', // wait BEFORE the launch waits for nothing
  "bash -c 'scripts/dispatch-review.sh x &'; wait",
  'echo $(scripts/dispatch-review.sh x &); wait',
  'scripts/dispatch-review.sh x & (wait)', // wait inside a subshell cannot see the job
  'scripts/dispatch-review.sh x & wait &',
]) {
  test(`wake tightened, still denied: ${JSON.stringify(cmd)}`, () => {
    assert.strictEqual(run(cmd).deny, true);
  });
}
for (const cmd of [
  'scripts/dispatch-review.sh x & wait',
  'scripts/dispatch-review.sh x &\nwait',
  'scripts/dispatch-review.sh x & echo hi; wait $!',
  '{ scripts/dispatch-review.sh x & }; wait',
  'for s in a b; do scripts/dispatch-review.sh $s & done; wait',
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage S; node scripts/wait-dispatch-results.js --ledger L --expect R.S',
]) {
  test(`wake accepted: ${JSON.stringify(cmd)}`, () => {
    assert.strictEqual(run(cmd).deny, false);
  });
}

test('recipe: `setsid -f` + ledger args + wait-dispatch-results lands in time', () => {
  const { r } = recipe(true, WAIT, { launch: SETSID_F });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).complete, true);
});
test('recipe: a bare `wait` does NOT wait for a `setsid -f` job (why it is denied)', () => {
  const { r, ms, dir } = recipe(true, () => 'wait', { launch: SETSID_F });
  assert.strictEqual(r.status, 0);
  assert.ok(ms < 700, `wait returned after ${ms} ms`);
  assert.ok(!fs.existsSync(path.join(dir, 'L.results', 'r1.s1.exit')), 'job had not finished yet');
  const until = Date.now() + 5000; // let the orphan finish so it cannot write into a removed dir
  while (!fs.existsSync(path.join(dir, 'L.results', 'r1.s1.exit')) && Date.now() < until) { /* spin */ }
});
test('recipe: foreman shape (--ledger/--run-id only, fixed stage) lands under --expect <id>.foreman', () => {
  const w = (dir) => `node ${REPO}/scripts/wait-dispatch-results.js --ledger ${dir}/L --expect r1.foreman --timeout 4 --poll 1`;
  const { r } = recipe(true, w, { fixedStage: 'foreman' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).complete, true);
});

// The recipe the deny message gives, executed for real: a stub rail that uses the real
// scripts/lib/dispatch-detach.sh, then scripts/wait-dispatch-results.js in the same command.
const REPO = path.join(__dirname, '..');
function recipe(withLedgerArgs, waiter, { launch, fixedStage } = {}) {
  const dir = mk('blg-recipe-');
  const stub = path.join(dir, 'stub-rail.sh');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env bash',
    'LEDGER=""; RUN_ID=""; STAGE=""; ORIG=("$@")',
    'while [ $# -gt 0 ]; do case "$1" in --ledger) LEDGER="$2"; shift 2;; --run-id) RUN_ID="$2"; shift 2;; --stage) STAGE="$2"; shift 2;; *) shift;; esac; done',
    fixedStage ? `STAGE="${fixedStage}"` : ':',
    `. "${REPO}/scripts/lib/dispatch-detach.sh"`,
    `dispatch_detach_supervise "$0" "$LEDGER" "$RUN_ID" "$STAGE" "${REPO}/scripts" -- "\${ORIG[@]}"`,
    'sleep 1; echo \'{"ok":true}\'',
  ].join('\n'), { mode: 0o755 });
  const ledgerArgs = withLedgerArgs ? `--ledger ${dir}/L --run-id r1 --stage s1` : '';
  const launchCmd = launch ? launch(stub, ledgerArgs, dir) : `nohup ${stub} ${ledgerArgs} > ${dir}/out 2>&1 &`;
  const sh = `( ${launchCmd} ${waiter(dir)} )`;
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', sh], { encoding: 'utf8' });
  return { r, ms: Date.now() - t0, dir };
}
const SETSID_F = (stub, args, dir) => `setsid -f ${stub} ${args} > ${dir}/out 2>&1;`;
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

// In-process timing of the rule itself: five deep globs must cost well under 200 ms in total.
const { detectZshExpansion } = require('../scripts/lib/bash-launch-rules.js');
test('five deep globs cost < 200 ms in total', () => {
  const t0 = Date.now();
  const r = detectZshExpansion('ls /*/*/* /*/*/*/* /*/*/*/*/* /*/*/*/*/*/* /*/*/*/*/*/*/*.zzqq', os.tmpdir());
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  assert.strictEqual(r, null);
});
test('only the first few globs per command are resolved (stay silent past the cap)', () => {
  const r = detectZshExpansion('ls /* /* /* /* /nonexistent-dir-blg/*.zzq', os.tmpdir());
  assert.strictEqual(r, null);
  assert.ok(detectZshExpansion('ls /nonexistent-dir-blg/*.zzq', os.tmpdir()));
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

// ---- hard cost bounds (item: single glob lookups and crafted input) ----
const { globHasMatch } = require('../scripts/lib/bash-launch-rules.js');
test('globHasMatch: matches, no-match, missing dir, expired deadline => null', () => {
  const d = mk('blg-gm-');
  fs.writeFileSync(path.join(d, 'a.zzq'), '');
  fs.writeFileSync(path.join(d, '.hid'), '');
  assert.strictEqual(globHasMatch(`${d}/*.zzq`, d, Date.now() + 1000), true);
  assert.strictEqual(globHasMatch(`${d}/*.nope`, d, Date.now() + 1000), false);
  assert.strictEqual(globHasMatch(`${d}/*`, d, Date.now() + 1000), true);
  assert.strictEqual(globHasMatch('*.hid', d, Date.now() + 1000), false); // `*` skips dotfiles, like zsh
  assert.strictEqual(globHasMatch('[a-b].zzq', d, Date.now() + 1000), true);
  assert.strictEqual(globHasMatch(`${d}/nonexistent/*.x`, d, Date.now() + 1000), false);
  assert.strictEqual(globHasMatch(`${d}/*.nope`, d, Date.now() - 1), null); // out of time => cannot tell
});

function wallMs(cmd) { // whole hook call, measured OUTSIDE the process
  const t0 = process.hrtime.bigint();
  const r = run(cmd, { shell: 'zsh' });
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, r };
}
test('real hook under zsh: `ls <huge dir>/*` and `/*.zza` stay under 100 ms per call', () => {
  const d = mk('blg-big-');
  for (let i = 0; i < 60000; i += 1) fs.closeSync(fs.openSync(path.join(d, `f${i}.txt`), 'w'));
  run('true', { shell: 'zsh' }); // warm the file cache / node
  for (const cmd of [`ls ${d}/*`, `ls ${d}/*.zza`]) {
    const best = Math.min(...[1, 2, 3].map(() => wallMs(cmd).ms));
    assert.ok(best < 100, `${cmd.slice(0, 12)}… took ${best.toFixed(0)} ms`);
  }
});
test('crafted quadratic input (`[a` x 25000): still fast, zsh rule skipped, rail rule still runs', () => {
  const bomb = '[a'.repeat(25000);
  const { ms, r } = wallMs(`ls ${bomb}`);
  assert.ok(ms < 100, `took ${ms.toFixed(0)} ms`);
  assert.doesNotMatch(r.ctx, /zsh-expansion/);
  assert.strictEqual(run(`ls ${bomb}; nohup scripts/dispatch-review.sh x &`, { shell: 'zsh' }).deny, true);
});
test('a huge token is not judged (no warning, no cost)', () => {
  assert.doesNotMatch(run(`ls /nonexistent-dir-blg/${'a'.repeat(600)}*.zzq`, { shell: 'zsh' }).ctx, /zsh-expansion/);
});

test('segments() stays linear-ish: `} & ` x 4000 and a 64 KB input are each < 100 ms through the real hook', () => {
  for (const cmd of ['} & '.repeat(4000), 'fi & '.repeat(13000), 'done & '.repeat(9300), '$('.repeat(32000)]) {
    const best = Math.min(...[1, 2, 3].map(() => wallMs(cmd).ms));
    assert.ok(best < 100, `${cmd.length} chars took ${best.toFixed(0)} ms`);
  }
});
test('oversized input: the plain trailing-& rail check still runs', () => {
  assert.strictEqual(run(`${'a;'.repeat(9000)} nohup scripts/dispatch-review.sh x &`).deny, true);
  assert.strictEqual(run(`${'a;'.repeat(9000)} scripts/dispatch-review.sh x`).deny, false);
});
test('a closer pull-back within the scan window still backgrounds the whole block', () => {
  assert.strictEqual(run(`${'a;'.repeat(20)} for i in 1 2; do ${'echo x; '.repeat(10)}scripts/dispatch-review.sh $i; done &`).deny, true);
});

// ---- nested launches: the advice must not tell the user to do what is still denied ----
for (const cmd of ['(scripts/dispatch-review.sh x &); wait', "bash -c 'scripts/dispatch-review.sh x &'; wait", 'echo $(scripts/dispatch-review.sh x &); wait']) {
  test(`nested launch advice says to move it out: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /move the launch out of the/);
    assert.doesNotMatch(r.reason, /Or keep the `&` and put `wait`/);
  });
  test(`the advised outermost form is accepted: ${JSON.stringify(cmd)}`, () => {
    assert.strictEqual(run('scripts/dispatch-review.sh x & wait').deny, false);
  });
}

// ---- item 4: the recipe chains the waiter with && and bounds it with --timeout ----
test('message: ledger recipe chains with && and carries --timeout', () => {
  for (const c of ['setsid -f scripts/dispatch-review.sh x', 'nohup scripts/dispatch-author.sh x &', 'nohup scripts/dispatch-foreman.sh x &']) {
    const r = run(c);
    assert.match(r.reason, /&& (?:node )?scripts\/wait-dispatch-results\.js|&& node\s+scripts\/wait-dispatch-results\.js/);
    assert.match(r.reason, /--timeout <seconds>/);
  }
});
const SETSID_F_AND = (stub, args, dir) => `setsid -f ${stub} ${args} > ${dir}/out 2>&1 &&`;
test('recipe: `setsid -f rail … && wait-dispatch-results --timeout` lands', () => {
  const { r } = recipe(true, WAIT, { launch: SETSID_F_AND });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).complete, true);
});
test('recipe: the same with bad args (no .exit ever) is bounded by --timeout, not 3600 s', () => {
  const w = (dir) => `node ${REPO}/scripts/wait-dispatch-results.js --ledger ${dir}/L --expect r1.s1 --timeout 2 --poll 1`;
  const { r, ms } = recipe(false, w, { launch: SETSID_F_AND });
  assert.strictEqual(r.status, 1);
  assert.ok(ms < 8000, `${ms} ms`);
});
test('the chained recipe form is accepted by the guard', () => {
  assert.strictEqual(run('setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage S > o 2>&1 && node scripts/wait-dispatch-results.js --ledger L --expect R.S --timeout 600').deny, false);
});

// ---- item 5: look-alike test files never match the exact rail-name pattern (TEST_FILE_RE was redundant) ----
for (const f of ['dispatch-review.test.sh', 'dispatch-review.test.js', 'dispatch-hetero.test.sh']) {
  test(`test file is not a rail: ${f}`, () => {
    assert.strictEqual(run(`nohup scripts/${f} x &`).deny, false);
    assert.strictEqual(run(`cd scripts && setsid -f ./${f} x`).deny, false);
  });
}

test('message: --timeout is the longest acceptable wait (never "short"), no stale 3600 s default', () => {
  for (const c of ['nohup scripts/dispatch-review.sh x &', 'nohup scripts/dispatch-foreman.sh x &']) {
    const r = run(c).reason;
    assert.match(r, /set --timeout to\s+the longest wait you accept|set --timeout to the longest wait you accept/);
    assert.doesNotMatch(r, /keep --timeout|3600/);
  }
});
