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

// Rules 1-3 fixtures use `ls` as filler; rule 4 would deny them first, so it is off unless `lsDefault` (rule 4 tests).
function run(cmd, { shell = 'bash', extra = {}, env = {}, lsDefault = false } = {}) {
  const home = mk('blg-home-');
  const live = mk('blg-live-');
  // An ambient knob must not leak in: only the `env` argument may set it.
  const baseEnv = { ...process.env };
  delete baseEnv.AUTOPILOT_BASH_GUARD_PKILL_MODE;
  delete baseEnv.AUTOPILOT_BASH_GUARD_LS_MODE;
  delete baseEnv.AUTOPILOT_BASH_GUARD_RMVAR_MODE;
  delete baseEnv.AUTOPILOT_BASH_GUARD_SUBAGENT_RM_MODE;
  delete baseEnv.AUTOPILOT_BASH_GUARD_SHARED_RM_MODE;
  delete baseEnv.AUTOPILOT_CONFIG_FILE;
  delete baseEnv.CLAUDE_CODE_TMPDIR;
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash', session_id: 'blg', hook_event_name: 'PreToolUse', cwd: home,
      tool_input: { command: cmd }, ...extra,
    }),
    encoding: 'utf8',
    env: {
      ...baseEnv, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_BASH_GUARD_SHELL: shell, ...(lsDefault ? {} : { AUTOPILOT_BASH_GUARD_LS_MODE: 'off' }), ...env,
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

// ---- BL-0139: launch shapes the first guard missed (each denial case was red on the previous rules) ----
const BL0139_DENY = [
  // case block backgrounded as a whole (single arm, multi-arm, label with a pipe)
  'case $x in a) scripts/dispatch-review.sh x;; esac &',
  'case $x in\n a) echo hi;;\n b) scripts/dispatch-review.sh x;;\nesac &',
  'case $x in a|b) scripts/dispatch-review.sh x;; esac &',
  // xargs -P fan-out launched in the background
  'ls | xargs -P 4 -n1 scripts/dispatch-review.sh &',
  'printf "%s\\n" a b | xargs -I {} -P2 scripts/dispatch-review.sh --seat {} &',
  // scheduler / lock wrappers
  'ionice -c3 scripts/dispatch-review.sh x &',
  'ionice -c 2 -n 7 scripts/dispatch-review.sh x &',
  'flock /tmp/l scripts/dispatch-review.sh x &',
  'flock -n /tmp/l scripts/dispatch-review.sh x &',
  'taskset -c 0,1 scripts/dispatch-review.sh x &',
  'taskset 0x3 scripts/dispatch-review.sh x &',
  'chrt -b 0 scripts/dispatch-review.sh x &',
  'setsid -f ionice -c3 scripts/dispatch-review.sh x',
  // coproc is always asynchronous
  'coproc scripts/dispatch-review.sh x',
  'coproc REV { scripts/dispatch-review.sh x; }',
  // function wrapping the launch
  'f(){ scripts/dispatch-review.sh x; }; f &',
  'f() { scripts/dispatch-review.sh x; }\nf &',
  'function f { scripts/dispatch-review.sh x; }; f &',
  // substitution nested three deep
  'echo $(echo $(echo $(scripts/dispatch-review.sh x &)))',
  // python / perl one-liners handing the string to a shell
  `python3 -c "import os; os.system('scripts/dispatch-review.sh x &')"`,
  `python3 -c "import subprocess; subprocess.Popen('scripts/dispatch-review.sh x', shell=True)"`,
  `perl -e 'system("scripts/dispatch-review.sh x &")'`,
  // a waiter that cannot wake this launch
  'node scripts/wait-dispatch-results.js --ledger L --expect old.s; nohup scripts/dispatch-review.sh x &', // runs BEFORE the launch
  'nohup scripts/dispatch-review.sh x & node scripts/wait-dispatch-results.js --ledger L --expect R.S &', // waiter itself backgrounded
  // wait on a pid that is not the launched job
  'scripts/dispatch-review.sh x & wait $other',
  'scripts/dispatch-review.sh x & wait $pid', // pid never captured from $!
  'scripts/dispatch-review.sh a & scripts/dispatch-review.sh b & pid=$!; wait $pid', // first launch is still unwaited
  'scripts/dispatch-review.sh x & pid=$!; sleep 1; wait $pid2',
  // a wait that sits in another shell level does not see the job
  '(scripts/dispatch-review.sh x &); wait',
  "bash -c 'scripts/dispatch-review.sh x &'; wait",
];
for (const cmd of BL0139_DENY) {
  test(`BL-0139 denies: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /detach-no-wake/);
  });
}

const BL0139_ALLOW = [
  // look-alikes: same shapes, but foreground, waited, or not a rail
  'case $x in a) scripts/dispatch-review.sh x;; esac',
  'case $x in a) scripts/dispatch-review.sh x;; esac &\nwait',
  'case $x in a) echo hi;; esac &',
  'case "$rail" in dispatch-review.sh) echo ok;; esac &', // the rail name is only a case label
  'ls | xargs -n1 scripts/dispatch-review.sh',
  'ls | xargs -P 4 -n1 scripts/dispatch-review.sh & wait',
  'ls | xargs -P 4 echo &',
  'ionice -c3 scripts/dispatch-review.sh x',
  'ionice -c3 scripts/dispatch-review.sh x & wait',
  'flock /tmp/l scripts/dispatch-review.sh x',
  'flock /tmp/l echo hi &',
  'taskset -c 0 scripts/dispatch-review.sh x',
  'coproc echo hi',
  'echo coproc scripts/dispatch-review.sh x',
  'coproc scripts/dispatch-review.sh x & wait',
  'f(){ scripts/dispatch-review.sh x; }; f',
  'f(){ scripts/dispatch-review.sh x; }; f & wait',
  'f(){ echo hi; }; f &', // function that never runs a rail
  'f(){ scripts/dispatch-review.sh x; }; g(){ echo hi; }; g &',
  'echo $(echo $(echo $(scripts/dispatch-review.sh x)))', // deep, but foreground
  `python3 -c "import os; os.system('scripts/dispatch-review.sh x')"`, // foreground
  `python3 -c "print('scripts/dispatch-review.sh x &')"`, // string never reaches a shell
  `python3 -c "import os; os.system('echo hi &')"`,
  // waits that DO cover the launch (previously false denials)
  "bash -c 'scripts/dispatch-review.sh x & wait'",
  'echo "$(scripts/dispatch-review.sh x & wait)"',
  '(scripts/dispatch-review.sh x & wait)',
  'scripts/dispatch-review.sh x & wait >| /tmp/o',
  'scripts/dispatch-review.sh x & wait >| /tmp/o 2>&1',
  'scripts/dispatch-review.sh x & pid=$!\nwait $pid',
  'scripts/dispatch-review.sh x & pid=$!; wait "$pid"',
  'scripts/dispatch-review.sh x & rpid=$!; wait ${rpid}',
  'node scripts/wait-dispatch-results.js --ledger L --expect R.S & scripts/dispatch-review.sh x', // foreground rail, no launch
  'nohup scripts/dispatch-review.sh x & node scripts/wait-dispatch-results.js --ledger L --expect R.S',
];
for (const cmd of BL0139_ALLOW) {
  test(`BL-0139 allows: ${JSON.stringify(cmd)}`, () => {
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

// ---- BL-0185: more background-launch shapes (list-form interpreters, parallel, subshell functions) + multi-pid wait ----
const RV = 'scripts/dispatch-review.sh';
const BL185_DENY = [
  `python3 -c "import subprocess; subprocess.Popen(['${RV}', 'x'])"`, // python list form
  `python3 -c "import subprocess; subprocess.Popen(['bash', '${RV}', 'x'])"`,
  `python3 -c 'import subprocess; subprocess.Popen(["${RV}", "x"])'`,
  `node -e "const c=require('child_process').spawn('${RV}', ['x'], {detached: true}); c.unref()"`, // node list form (unref'd)
  `node -e 'const c=require("child_process").spawn("bash", ["${RV}", "x"], {detached: true}); c.unref()'`,
  `parallel ${RV} {} ::: a b &`, // GNU parallel backgrounded
  `parallel -j2 ${RV} {} ::: a b &`,
  `setsid -f parallel --jobs 2 ${RV} {} ::: a b`,
  `f() ( ${RV} x )\nf &`, // subshell-body function
  `f() ( ${RV} x ); f &`,
  `f() (\n  ${RV} x\n)\nf &`,
  `{ ${RV} x; } &`, // brace group sent to the background (already caught on base: regression pin)
  `{\n${RV} x\n} > log 2>&1 &`,
  `${RV} a & P1=$!\n${RV} b & P2=$!\nwait -n $P1 $P2`, // wait -n returns after ONE job
  `${RV} a & P1=$!\nwait 12345`, // waits for an unrelated pid
];
for (const cmd of BL185_DENY) {
  test(`rule1 denies (BL-0185): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /detach-no-wake/);
  });
}
const BL185_ALLOW = [
  `${RV} a & P1=$!\n${RV} b & P2=$!\nwait $P1 $P2`, // wait with two pid variables
  `${RV} a & P1=$!\n${RV} b & P2=$!\nwait "$P1" "$P2"`,
  `${RV} a & P1=$!\n${RV} b & P2=$!\nwait \${P1} \${P2}`,
  `${RV} a &\nwait $! 999`,
  `{ ${RV} x; } & wait`,
  `parallel ${RV} {} ::: a b`, // foreground parallel blocks until done
  `parallel -j2 ${RV} {} ::: a b && echo done`,
  `parallel -j2 ${RV} {} ::: a b & wait`,
  `f() ( ${RV} x )\nf`, // subshell function called in the foreground
  `f() ( ${RV} x )\nf & wait`,
  `python3 -c "import subprocess; p=subprocess.Popen(['${RV}', 'x']); p.wait()"`, // python waits for its child
  `python3 -c "import subprocess; subprocess.Popen(['grep', 'dispatch-review.sh', 'f'])"`, // not a rail
  `node -e "require('child_process').spawn('${RV}', ['x'])"`, // node keeps running until the child ends
  `node -e "require('child_process').spawn('grep', ['dispatch-review.sh'], {detached: true}).unref()"`,
];
for (const cmd of BL185_ALLOW) {
  test(`rule1 allows (BL-0185): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
  });
}

// ---- BL-0190: string-form Popen/spawn judged by the same wait/unref rule as the list form ----
const BL190_DENY = [
  `python3 -c "import subprocess; subprocess.Popen('${RV} x', shell=True)"`, // string form, nothing waits (control: still blocked)
  `python3 -c "import subprocess; subprocess.Popen('${RV} x', shell=True); print(1)"`,
  `node -e "const c=require('child_process').spawn('${RV} x', {shell: true, detached: true}); c.unref()"`, // string form, unref'd
  `node -e "require('child_process').spawn('${RV} x', {shell: true, detached: true}).unref()"`,
  `node -e "const child_process=require('child_process'); child_process.spawn('${RV} x', {shell: true, detached: true}).unref()"`,
];
for (const cmd of BL190_DENY) {
  test(`rule1 denies (BL-0190): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /detach-no-wake/);
  });
}
const BL190_ALLOW = [
  `python3 -c "import subprocess; p=subprocess.Popen('${RV} x', shell=True); p.wait()"`, // body waits for its child
  `python3 -c "import subprocess; subprocess.Popen('${RV} x', shell=True).wait()"`,
  `python3 -c "import subprocess; p=subprocess.Popen('${RV} x', shell=True); p.communicate()"`,
  `node -e "require('child_process').spawn('${RV} x', {shell: true})"`, // node keeps running until the child ends
  `node -e "require('child_process').spawn('${RV} x', {shell: true, stdio: 'inherit'})"`,
  `node -e "const child_process=require('child_process'); child_process.spawn('${RV} x', {shell: true})"`, // base denied this (unqualified literal spawn always background)
];
for (const cmd of BL190_ALLOW) {
  test(`rule1 allows (BL-0190): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
  });
}

// ---- BL-0190 review fix: a wait/unref counts only when it is on THIS launch (its variable, or chained on the call) ----
const BL190B_DENY = [
  `python3 -c "import subprocess; p=subprocess.Popen('${RV} x', shell=True); q=subprocess.Popen(['ls']); q.wait()"`, // q waited, p not (string)
  `python3 -c "import subprocess; p=subprocess.Popen(['${RV}', 'x']); q=subprocess.Popen(['ls']); q.wait()"`, // same, list form
  `python3 -c "import subprocess; subprocess.Popen('${RV} x', shell=True); subprocess.Popen(['ls']).wait()"`, // chained wait belongs to the OTHER call
];
for (const cmd of BL190B_DENY) {
  test(`rule1 denies (BL-0190 review): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /detach-no-wake/);
  });
}
const BL190B_ALLOW = [
  `python3 -c "import subprocess; p=subprocess.Popen(['${RV}', 'x']); p.wait()"`, // own variable
  `python3 -c "import subprocess; subprocess.Popen(['${RV}', 'x']).wait()"`, // chained on the call
  `python3 -c "import subprocess; p=subprocess.Popen('${RV} x', shell=True); q=subprocess.Popen(['ls']); p.wait()"`,
  `python3 -c "import subprocess; with subprocess.Popen('${RV} x', shell=True) as p: pass"`, // with-exit waits
  // node: unref on a DIFFERENT variable does not detach this spawn; it keeps the event loop alive until the child ends
  `node -e "const s=require('child_process').spawn('${RV} x', {shell: true}); other.unref()"`,
  `node -e "const s=require('child_process').spawn('${RV}', ['x']); other.unref()"`,
];
for (const cmd of BL190B_ALLOW) {
  test(`rule1 allows (BL-0190 review): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
  });
}
const BL190B_DENY2 = [
  `node -e "const s=require('child_process').spawn('${RV} x', {shell: true, detached: true}); s.unref(); other.ref()"`, // own variable unref'd
  `node -e "const s=require('child_process').spawn('${RV}', ['x'], {detached: true}); s.unref()"`,
];
for (const cmd of BL190B_DENY2) {
  test(`rule1 denies (BL-0190 review): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
  });
}

// ---- Rule 2: pkill/pgrep -f without [x] => DENY by default (BL-0148; was warn-only BL-0019) ----
// Cases are data, run through the real hook; the command text never reaches a live Bash tool call.
const PK_DENY = [
  'until ! pgrep -f "selftest-s1-winb.sh all" >/dev/null; do sleep 20; done',
  'until ! pgrep -f "selftest-stub-s0c.sh nospace2" >/dev/null; do sleep 15; done; sleep 5',
  'pkill -f dispatch-review', 'pkill -f vllm', 'sudo pkill -f -9 vllm', 'sudo pkill -9 -f foo',
  'pgrep -af "s1-winb-runner" | head', 'pgrep -fa "my server"',
  'n=$(pgrep -fc stub_server)', 'echo "count: $(pgrep -fc runner)"',
  'x; /usr/bin/pgrep --full foo',
  'while true; do\npgrep -f foo || break; sleep 5; done',
  'test -n "`pgrep -f bar`"', 'kill $(pgrep -f myserver)', 'echo `pgrep -f foo`',
  'pgrep -u me -f foo', 'pkill -u me -f "my server"',
  "cat > f <<'EOF'\ndata\nEOF\npkill -f vllm",
  "pkill -f 'vllm serve'",
  'git commit -m "see `pgrep -f x`"',
  // BL-0153: shapes that really match the shell running the call
  "bash <<'EOF'\npgrep -f foo\nEOF", "cat <<'EOF' | bash\npkill -f foo\nEOF",
  "cat > /tmp/x.sh <<'EOF'\npgrep -f foo\nEOF\nbash /tmp/x.sh", "cat > x.sh <<'EOF'\npkill -f foo\nEOF\nchmod +x x.sh\n./x.sh",
  'P=foo; pgrep -f "$P"', 'P=foo\npkill -f ${P}', 'a=fo; b=o; pgrep -f "$a$b"; echo foo',
  'echo 1 | xargs pkill -f foo', 'eval "pkill -f foo"', "eval 'pgrep -f foo'", 'watch pgrep -f foo', "watch -n 2 'pgrep -f foo'",
  '\\pkill -f foo', "'pkill' -f foo", 'command pkill -f foo',
  "pgrep -f '[f]oo'; echo foo", // the bracket guards one occurrence, the other still matches
  'pkill -f -HUP foo', 'pgrep -f -d , foo', 'pgrep -if FOO; echo foo',
];
for (const cmd of PK_DENY) {
  test(`rule2 denies: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /pkill-self-match/);
  });
}
const PK_ALLOW = [
  "pkill -f '[d]ispatch-review'", 'pgrep -f "[f]oo bar"', 'pkill node', 'pkill -x node', 'echo "pkill -f foo"', 'pkill -f "$PAT"',
  'pgrep -u me -f "[f]oo"', 'pkill -P 1 -fa "[f]oo"', 'pgrep -f --uid me "[f]oo"',
  'pgrep -f "[s]elftest-s1-winb.sh all"', 'pgrep -x las', 'pgrep -c -x las', 'kill -0 "$(cat out/runner.pid)"',
  'grep -n pgrep doc/x.md', 'echo "never use pkill -f"',
  'git commit -qm "hooks: deny self-matching pgrep -f / pkill -f in Bash"', "git commit -m 'x: pgrep -f foo is bad'",
  'grep -c "pgrep -f" notes.md', 'echo unbalanced "quote',
  "cat >> notes.md <<'EOF'\nany literal `pgrep -f X` hits the wrapper shell\nEOF\ngrep -c x notes.md",
  'cat > f <<EOF\npkill -f vllm\nEOF',
  "echo 'use `pgrep -f x` never'",
  "pgrep -f '[s]elftest'",
  // BL-0153 look-alikes: patterns that cannot match this call's own text
  "pkill -f '[fF]oo'", "pgrep -f '^x'", "pgrep -f 'x\\.py'", "pgrep -f -d , '[f]oo'", "pgrep -d , -f '^zzz'", 'pgrep -f "foo$"',
  'a=fo; b=o; pgrep -f "$a$b"', 'P=[f]oo; pgrep -f "$P"', 'kill "$(cat x.pid)"', 'pgrep -x foo', 'pgrep -fx "[f]oo"',
  'echo "pkill -f foo" | cat', 'echo "eval pkill -f foo"', 'grep -n "watch pgrep -f" notes.md', 'echo "\\pkill -f foo"',
  "cat > x.sh <<'EOF'\npgrep -f foo\nEOF\ncat x.sh", // written, never run: data
  "cat <<'EOF' | grep pgrep\npgrep -f foo\nEOF",
  'eval "pkill -x foo"', "watch -n 2 'pgrep -fa [f]oo'", 'pkill -f "[v]llm"; true',
];
for (const cmd of PK_ALLOW) {
  test(`rule2 allows: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
    assert.doesNotMatch(r.ctx, /pkill-self-match/);
  });
}
test('rule2 deny message names the alternatives', () => {
  const r = run('pkill -f foo');
  assert.match(r.reason, /pidfile/);
  assert.match(r.reason, /PID/);
  assert.match(r.reason, /variable/);
  assert.match(r.reason, /AUTOPILOT_BASH_GUARD_PKILL_MODE/);
});
// Knob: env AUTOPILOT_BASH_GUARD_PKILL_MODE or ~/.autopilot/config.json depth0_delegate_gate.pkill_self_match.
test('rule2 knob warn: back to advisory (the old BL-0019 behaviour)', () => {
  const r = run('pgrep -f foo', { env: { AUTOPILOT_BASH_GUARD_PKILL_MODE: 'warn' } });
  assert.strictEqual(r.deny, false);
  assert.match(r.ctx, /pkill-self-match/);
});
test('rule2 knob off: silent', () => {
  const r = run('pgrep -f foo', { env: { AUTOPILOT_BASH_GUARD_PKILL_MODE: 'off' } });
  assert.strictEqual(r.deny, false);
  assert.doesNotMatch(r.ctx, /pkill-self-match/);
});
test('rule2 knob deny: explicit deny', () => {
  assert.strictEqual(run('pgrep -f foo', { env: { AUTOPILOT_BASH_GUARD_PKILL_MODE: 'deny' } }).deny, true);
});
test('rule2 knob garbage falls back to the deny default', () => {
  assert.strictEqual(run('pgrep -f foo', { env: { AUTOPILOT_BASH_GUARD_PKILL_MODE: 'bogus' } }).deny, true);
});
test('rule2 knob via config.json', () => {
  const home = mk('blg-cfg-');
  fs.mkdirSync(path.join(home, '.autopilot'));
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify({ depth0_delegate_gate: { pkill_self_match: 'warn' } }));
  const env = { ...process.env, HOME: home, AUTOPILOT_CONFIG_FILE: path.join(home, '.autopilot', 'config.json'), AUTOPILOT_LIVE_DIR: mk('blg-live-'), AUTOPILOT_BASH_GUARD_SHELL: 'bash' };
  delete env.AUTOPILOT_BASH_GUARD_PKILL_MODE;
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', session_id: 'blg', cwd: home, tool_input: { command: 'pgrep -f foo' } }),
    encoding: 'utf8',
    env,
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, undefined);
  assert.match(out.hookSpecificOutput.additionalContext, /pkill-self-match/);
});
test('rule2 denies in warn and block gate modes alike; gate mode off silences it', () => {
  for (const mode of ['warn', 'block']) {
    assert.strictEqual(run('pkill -f foo', { env: { AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: mode } }).deny, true);
  }
  assert.strictEqual(run('pkill -f foo', { env: { AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: 'off' } }).deny, false);
});

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

test('pkill warning (knob warn) merges with the wait advisory (no early return)', () => {
  const r = run('pkill -f foo; tail -f /tmp/x.log', { env: { AUTOPILOT_BASH_GUARD_PKILL_MODE: 'warn' } });
  assert.match(r.ctx, /pkill-self-match/);
  assert.match(r.ctx, /foreground wait/);
});

test('rule2 also applies at subagent depth (agent_id present): deny, and warn under the knob', () => {
  assert.strictEqual(run('pkill -f foo', { extra: { agent_id: 'a1' } }).deny, true);
  assert.match(run('pkill -f foo', { extra: { agent_id: 'a1' }, env: { AUTOPILOT_BASH_GUARD_PKILL_MODE: 'warn' } }).ctx, /pkill-self-match/);
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

// Cost-bound tests come in two forms. The default form is load-proof: it compares the time at size n with
// the time at 16n (best of several runs, same process), so a loaded host scales both sides alike. Linear work
// gives a ratio near 16, quadratic work near 256; the ceiling is 64. The absolute wall-clock ceilings
// (100 ms per hook call, 150 ms per rule4 call) stay available as an opt-in variant: BLG_SLOW_TIMING=1.
const SLOW_TIMING = process.env.BLG_SLOW_TIMING === '1';
const slowTest = (name, fn) => (SLOW_TIMING ? test(`@slow ${name}`, fn) : test.skip(`@slow ${name} (set BLG_SLOW_TIMING=1)`, () => {}));
function bestMs(fn, reps = 9, iters = 1) {
  let best = Infinity;
  for (let i = 0; i < reps; i += 1) {
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < iters; k += 1) fn();
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return best;
}
const GROWTH_FACTOR = 16;
const GROWTH_CEILING = 64; // linear ~16x for a 16x input, quadratic ~256x
function growthRatio(fn, build, n, iters = 1) {
  const small = build(n);
  const large = build(GROWTH_FACTOR * n);
  fn(small); // warm up the JIT before measuring
  return bestMs(() => fn(large), 5, iters) / Math.max(bestMs(() => fn(small), 5, iters), 0.05);
}


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
function bestWall(cmd, reps = 5) { return Math.min(...Array.from({ length: reps }, () => wallMs(cmd).ms)); }
test('real hook under zsh: `ls <huge dir>/*` and `/*.zza` cost within 3x of the same call on a tiny dir (load-proof)', () => {
  const big = mk('blg-big-');
  for (let i = 0; i < 60000; i += 1) fs.closeSync(fs.openSync(path.join(big, `f${i}.txt`), 'w'));
  const tiny = mk('blg-tiny-');
  fs.closeSync(fs.openSync(path.join(tiny, 'f0.txt'), 'w'));
  run('true', { shell: 'zsh' }); // warm the file cache / node
  for (const suffix of ['*', '*.zza']) {
    const base = bestWall(`ls ${tiny}/${suffix}`);
    const cost = bestWall(`ls ${big}/${suffix}`);
    assert.ok(cost < 3 * base + 20, `${suffix}: ${cost.toFixed(0)} ms on 60000 files vs ${base.toFixed(0)} ms on 1`);
  }
});
slowTest('real hook under zsh: `ls <huge dir>/*` and `/*.zza` stay under 100 ms per call', () => {
  const d = mk('blg-big-');
  for (let i = 0; i < 60000; i += 1) fs.closeSync(fs.openSync(path.join(d, `f${i}.txt`), 'w'));
  run('true', { shell: 'zsh' }); // warm the file cache / node
  for (const cmd of [`ls ${d}/*`, `ls ${d}/*.zza`]) {
    const best = Math.min(...[1, 2, 3].map(() => wallMs(cmd).ms));
    assert.ok(best < 100, `${cmd.slice(0, 12)}… took ${best.toFixed(0)} ms`);
  }
});
test('crafted quadratic input (`[a` x 25000): costs within 3x of a small one, zsh rule skipped, rail rule still runs', () => {
  const bomb = '[a'.repeat(25000);
  const small = '[a'.repeat(100);
  const { r } = wallMs(`ls ${bomb}`);
  const base = bestWall(`ls ${small}`);
  const cost = bestWall(`ls ${bomb}`);
  assert.ok(cost < 3 * base + 20, `${cost.toFixed(0)} ms for 25000 units vs ${base.toFixed(0)} ms for 100`);
  assert.doesNotMatch(r.ctx, /zsh-expansion/);
  assert.strictEqual(run(`ls ${bomb}; nohup scripts/dispatch-review.sh x &`, { shell: 'zsh' }).deny, true);
});
slowTest('crafted quadratic input (`[a` x 25000): still fast (< 100 ms)', () => {
  const { ms } = wallMs(`ls ${'[a'.repeat(25000)}`);
  assert.ok(ms < 100, `took ${ms.toFixed(0)} ms`);
});
test('a huge token is not judged (no warning, no cost)', () => {
  assert.doesNotMatch(run(`ls /nonexistent-dir-blg/${'a'.repeat(600)}*.zzq`, { shell: 'zsh' }).ctx, /zsh-expansion/);
});

// Deterministic form of the glob cost bounds: count the directory reads the rule performs instead of timing
// them. A load spike moves a clock, never a count. The absolute ceilings stay as opt-in @slow variants.
const { detectZshExpansion } = require('../scripts/lib/bash-launch-rules.js');
function countOpendirs(fn) {
  const real = fs.opendirSync;
  let n = 0;
  fs.opendirSync = (...a) => { n += 1; return real.apply(fs, a); };
  try { fn(); } finally { fs.opendirSync = real; }
  return n;
}
test('positive control: a single-level glob in a fresh tmp dir does read it (the counter is live)', () => {
  const d = mk('blg-pc-');
  const opendirs = countOpendirs(() => { detectZshExpansion(`ls ${d}/*.zzq`, os.tmpdir()); });
  assert.ok(opendirs >= 1, `${opendirs} directory reads: the rule no longer uses fs.opendirSync, the counts below prove nothing`);
});
test('deep globs read no directory at all (count-based, load-proof)', () => {
  const opendirs = countOpendirs(() => {
    detectZshExpansion('ls /*/*/*/*/*/*/*.zzqq', os.tmpdir());
    detectZshExpansion('ls /*/*/* /*/*/*/* /*/*/*/*/* /*/*/*/*/*/* /*/*/*/*/*/*/*.zzqq', os.tmpdir());
  });
  assert.strictEqual(opendirs, 0, `${opendirs} directory reads for multi-level globs`);
});
test('single-level globs are capped at 3 directory reads per command (count-based, load-proof)', () => {
  const globs = Array.from({ length: 8 }, () => '/*').join(' '); // each one matches, so the scan goes on to the next
  const opendirs = countOpendirs(() => { detectZshExpansion(`ls ${globs}`, os.tmpdir()); });
  assert.ok(opendirs >= 1 && opendirs <= 3, `${opendirs} directory reads for 8 single-level globs (want 1..3)`);
});
slowTest('deep glob is bounded (worst case stays fast)', () => {
  const t0 = Date.now();
  run('ls /*/*/*/*/*/*/*.zzqq', { shell: 'zsh' });
  assert.ok(Date.now() - t0 < 1500);
});

// In-process timing of the rule itself (absolute form is opt-in; the default form above counts reads).
slowTest('five deep globs cost < 200 ms in total', () => {
  const t0 = Date.now();
  const r = detectZshExpansion('ls /*/*/* /*/*/*/* /*/*/*/*/* /*/*/*/*/*/* /*/*/*/*/*/*/*.zzqq', os.tmpdir());
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  assert.strictEqual(r, null);
});
test('five deep globs stay silent', () => {
  assert.strictEqual(detectZshExpansion('ls /*/*/* /*/*/*/* /*/*/*/*/* /*/*/*/*/*/* /*/*/*/*/*/*/*.zzqq', os.tmpdir()), null);
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
test('segments()/expandSegments() grow linearly: 16x the input costs < 64x the time (load-proof, deterministic)', () => {
  const { segments, expandSegments } = require('../scripts/lib/bash-launch-rules.js');
  for (const [name, unit, n] of [['} & ', '} & ', 250], ['fi & ', 'fi & ', 200], ['done & ', 'done & ', 145]]) {
    // 16n of every unit stays <= SEG_MAX_TEXT (16384 chars): both sizes take the structural path. Past that the
    // `big` flag skips it, and a quadratic regression in it would hide behind the cheaper path.
    // QUARANTINED, tracked as BL-0370 (project/backlog/segments-dollar-paren-superlinear.md); unquarantine = fix it,
    // then add ['$(', '$(', n] back to the list above.
    // `$(` x n is not here on purpose: segments() is superlinear on it past ~16 KB (cur.trim() on a growing
    // cons-string, 55 ms at 64 KB, 514 ms at 128 KB). It is still bounded by the opt-in @slow absolute variant
    // below; the growth itself is a finding for the owner of scripts/lib/bash-launch-rules.js, not hidden here.
    for (const [fname, fn] of [['segments', segments], ['expandSegments', expandSegments]]) {
      const ratio = growthRatio((c) => { try { fn(c); } catch (_e) { /* fail-open is fine; cost is what is measured */ } }, (k) => unit.repeat(k), n, 20);
      assert.ok(unit.repeat(GROWTH_FACTOR * n).length <= 16384, `${name}: 16n is past SEG_MAX_TEXT`);
      assert.ok(ratio < GROWTH_CEILING, `${fname}(${name} x n) grew ${ratio.toFixed(1)}x for 16x input`);
    }
  }
});
// Negative control for the growth measure itself: a deliberately quadratic function must be flagged.
test('growth measure flags a quadratic function (negative control)', () => {
  const quadratic = (c) => { let acc = 0; for (let i = 0; i < c.length; i += 1) acc += c.indexOf('~', i); return acc; };
  const ratio = growthRatio(quadratic, (k) => '} & '.repeat(k), 1000);
  assert.ok(ratio >= GROWTH_CEILING, `quadratic stand-in grew only ${ratio.toFixed(1)}x; the ceiling would not catch it`);
});
slowTest('segments() stays linear-ish: `} & ` x 4000 and a 64 KB input are each < 100 ms through the real hook', () => {
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

// ---- exit-file wake: a detached rail with every ledger arg lands <ledger>.results/<id>.<stage>.exit, and the
// NEXT call (until-loop / Monitor on that file) is the wake-up, so the launch call itself needs no waiter ----
for (const cmd of [
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage S > o 2>&1', // stage rail, all three
  'setsid -f bash scripts/dispatch-author.sh brief.md --ledger L --run-id R --stage S',
  'setsid -f scripts/dispatch-hetero.sh --ledger L --run-id R --stage S --branch b',
  'setsid -f scripts/dispatch-foreman.sh x --ledger L --run-id R', // fixed rail, two
  'nohup setsid -f scripts/dispatch-foreman.sh x --ledger "$L" --run-id r1 > o 2>&1',
]) {
  test(`exit-file wake accepted: ${JSON.stringify(cmd)}`, () => {
    assert.strictEqual(run(cmd).deny, false);
  });
}
for (const cmd of [
  'setsid -f scripts/dispatch-review.sh x', // no ledger args at all
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R', // stage rail missing --stage
  'setsid -f scripts/dispatch-author.sh x --run-id R --stage S', // missing --ledger
  'setsid -f scripts/dispatch-hetero.sh x --ledger L --stage S', // missing --run-id
  'setsid -f scripts/dispatch-foreman.sh x --ledger L', // fixed rail missing --run-id
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage', // --stage without a value
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage --other', // value is another flag
  'setsid -f scripts/dispatch-consult.sh x --ledger L --run-id R --stage S', // rail never writes .exit
  'setsid -f scripts/dispatch-explore.sh x --ledger L --run-id R',
  'DISPATCH_DETACH=0 setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage S', // detach off: stays inline
]) {
  test(`exit-file wake still denied: ${JSON.stringify(cmd)}`, () => {
    assert.strictEqual(run(cmd).deny, true);
  });
}
test('exit-file wake: a plain `&` launch with full ledger args is not covered (only `setsid -f`)', () => {
  assert.strictEqual(run('nohup scripts/dispatch-review.sh x --ledger L --run-id R --stage S &').deny, true);
});
test('message: the exit-file watch recipe, the no-grep warning and no short ScheduleWakeup', () => {
  for (const [c, key] of [['setsid -f scripts/dispatch-review.sh x', '<id>.<name>'], ['nohup scripts/dispatch-author.sh x &', '<id>.<name>'], ['nohup scripts/dispatch-foreman.sh x &', '<id>.foreman']]) {
    const r = run(c).reason;
    assert.ok(r.includes(`until [ -f <ledger>.results/${key}.exit ]; do sleep 30; done`), r);
    assert.match(r, /Monitor/);
    assert.match(r, /Do NOT grep a log for a string such as `rc=`/);
    assert.match(r, /test output can print the same string/);
    assert.match(r, /Do not poll with short-interval ScheduleWakeup/);
  }
  assert.doesNotMatch(run('nohup scripts/dispatch-consult.sh x &').reason, /\.results\//); // no .exit file, no watch recipe
});

// ---- review FIX: more shapes that write no .exit file stay denied ----
for (const cmd of [
  'setsid -f scripts/dispatch-foreman.sh --resume --run-dir D --answer-file A --ledger L --run-id R > o 2>&1', // --resume runs inline
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage 2>&1', // value is an fd redirection
  'setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage 2>/dev/null',
  "DISPATCH_DETACH='0' setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage S",
  'DISPATCH_DETACH="0" setsid -f scripts/dispatch-review.sh x --ledger L --run-id R --stage S',
]) {
  test(`exit-file wake still denied (review FIX): ${JSON.stringify(cmd)}`, () => {
    assert.strictEqual(run(cmd).deny, true);
  });
}
test('message: the watch recipe is bounded by timeout, warns about stale .exit, and Monitor is depth-0 only', () => {
  const r = run('setsid -f scripts/dispatch-review.sh x').reason;
  assert.ok(r.includes("timeout <seconds> bash -c 'until [ -f <ledger>.results/<id>.<name>.exit ]; do sleep 30; done'"), r);
  assert.match(r, /ALWAYS set the timeout/);
  assert.match(r, /foreman --resume/);
  assert.match(r, /fresh run-id per launch/);
  assert.match(r, /must not contain `\.`/);
  assert.match(r, /a subagent cannot/);
});

// ---- BL-0153 review: ReDoS guard. A catastrophic pattern must be unjudgeable (never run) and return fast. ----
{
  const { detectPkillSelfMatch } = require('../scripts/lib/bash-launch-rules.js');
  for (const pat of ['(.*)*x$', '(a+)+b', '(a|aa)+c', 'x'.repeat(400)]) {
    test(`rule2 ReDoS guard returns fast: ${pat.slice(0, 12)}`, () => {
      const t0 = Date.now();
      detectPkillSelfMatch(`pgrep -f '${pat}'`);
      assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
    });
  }
  const { patternMatchesSelf } = require('../scripts/lib/bash-launch-rules.js');
  for (const pat of ['((a+))+c', '((a|aa))+c', '(?:(a+))+c', '(.*)*x$', '(a+)+b']) {
    test(`patternMatchesSelf is unjudgeable and fast: ${pat}`, () => {
      const t0 = Date.now();
      const r = patternMatchesSelf(pat, 'pgrep -f x', new Map(), {});
      assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
      assert.strictEqual(r, null);
    });
  }
  test('patternMatchesSelf still judges ordinary groups', () => {
    assert.strictEqual(patternMatchesSelf('(foo)+bar', 'pgrep -f foobar', new Map(), {}), true);
    assert.strictEqual(patternMatchesSelf('(foo)+bar', 'pgrep -f x', new Map(), {}), false);
    assert.strictEqual(patternMatchesSelf('(foo|bar)x', 'pgrep -f barx', new Map(), {}), true);
    assert.strictEqual(patternMatchesSelf('[(]a+[)]+', 'pgrep -f x', new Map(), {}), false);
  });
  test('rule2 ReDoS pattern takes the null (unjudgeable) path and falls back to the old stance', () => {
    assert.strictEqual(detectPkillSelfMatch("pgrep -f '(.*)*x$'"), null); // `$` => assumed fine
    assert.strictEqual(detectPkillSelfMatch("pgrep -f '(a+)+[b]'"), null); // bracket => assumed fine
    assert.strictEqual(detectPkillSelfMatch("pgrep -f '(a+)+b'").rule, 'pkill-self-match'); // plain => denied, regex never run
  });
}

// ---- BL-0192: a re-assigned handle hides the first child; an attribute handle is one handle ----
const BL192_DENY = [
  `python3 -c "import subprocess; p=subprocess.Popen(['${RV}', 'x']); p=subprocess.Popen(['ls']); p.wait()"`, // first child never waited
  `python3 -c "import subprocess; p=subprocess.Popen('${RV} x', shell=True); p=subprocess.Popen(['ls']); p.communicate()"`,
  `python3 -c "import subprocess; self.p=subprocess.Popen(['${RV}', 'x']); self.p=subprocess.Popen(['ls']); self.p.wait()"`,
];
for (const cmd of BL192_DENY) {
  test(`rule1 denies (BL-0192 rebind): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /detach-no-wake/);
  });
}
const BL192_ALLOW = [
  `python3 -c "import subprocess; self.p=subprocess.Popen(['${RV}', 'x']); self.p.wait()"`, // attribute handle waited
  `python3 -c "import subprocess; self.p=subprocess.Popen('${RV} x', shell=True); self.p.communicate()"`,
  `python3 -c "import subprocess; p=subprocess.Popen(['${RV}', 'x']); p.wait(); p=subprocess.Popen(['ls'])"`, // waited before the rebind
];
for (const cmd of BL192_ALLOW) {
  test(`rule1 allows (BL-0192 handle): ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false);
  });
}

// ---- Rule 4 (BL-0300): bare `ls` in command position => deny ----
const BARE_LS_DENY = [
  'ls',
  'ls -la /tmp',
  'cd /repo && ls',
  'echo hi; ls docs',
  'false || ls',
  'cat x | ls',
  'echo $(ls)',
  'echo `ls`',
  'FOO=1 ls',
  'time ls',
  'time -p ls',
  'time -- ls',
  'time -p -- ls',
  '! ls',
  'time ! ls',
  // array bodies: parentheses inside quotes or after a backslash are data (verified with a harmless alias in real bash)
  'a=( "(" ); ls',
  'a=( \\( ); ls',
  "a=( ')' ); ls",
  'a=( ")" ); ls',
  'a=( $( echo ")" ) ); ls',
  'a=(\n"(" \n)\nls',
  'a=( "a\\"b)" ); ls',
  'a=( `echo ")"` ); ls',
  'a=( "$(ls)" )', // a command substitution inside double quotes runs
  'a=( x ) y=1; ls', // a scalar assignment after an array one must not be read as another array
  'opts=( -a ) F=1 ls',
  'a[1]=( x ) ls',
  'cat <(ls)',
  // quoted openers are text: the ls after them still runs (verified with a harmless alias in real bash)
  'echo "(("; ls',
  'printf "%s" "(("; ls',
  "echo '(('; ls",
  'a=( "(()" ); ls',
  'echo "a=(" ; ls',
  'echo "x a=(" ; ls',
  'grep "((" Makefile; ls',
  'echo "(( "; ls',
  // unterminated openers: bash itself rejects the line, but the guard never drops the tail it cannot judge
  '(( 1 + ; ls',
  "echo '<(' ; ls",
  'echo "\\$((" ; ls',
  'echo "x" "((" ; ls',
  '( ls )', // a subshell, even when nested with a space between the parentheses
  '( (ls) )',
  '(( ls = 1 )); ls',
  'echo $(( $(ls) + 1 ))',
  'echo $(( `ls` + 1 ))',
  'for (( i=0; i<1; i++ )); do ls; done',
  'echo "`echo \\`x\\`; ls`"', // an escaped backtick inside a backtick body is a nested substitution, not the end
  'echo "`echo \\`ls\\``"',
  'echo `echo \\`x\\`; ls`',
  'a=( `echo \\`x\\`; ls` )',
  'echo "`cat <(ls)`"',
  'echo "$(ls)"',
  'echo "a $(cat <(ls)) b"',
  'cat <(ls) <(command ls)',
  'tee >(ls)',
  'coproc ls',
  'coproc NAME { ls; }',
  'a=( $(ls) )',
  'a=( `ls` )',
  'a=( x <(ls) )',
  '> /tmp/x ls',
  '2>/dev/null ls',
  '<f ls',
  '>>x ls',
  '&>x ls',
  '2> /dev/null ls -la',
  'FOO=1 >x ls',
  'case $x in\n a) ls;;\nesac',
  'case $x in a|b) ls ;; *) echo n ;; esac',
  'case $x in a) echo y;; b) ls;; esac',
  'case $x in a) ls;; esac',
  'if ls; then echo y; fi',
  'ls -la | head',
];
for (const cmd of BARE_LS_DENY) {
  test(`rule4 denies bare ls: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd, { lsDefault: true });
    assert.strictEqual(r.deny, true);
    assert.match(r.reason, /bare-ls/);
    assert.match(r.reason, /command ls/);
    assert.match(r.reason, /AUTOPILOT_BASH_GUARD_LS_MODE/);
  });
}
const BARE_LS_ALLOW = [
  'command ls',
  'command ls -la',
  'exec ls', // builtins/commands take ls as an argument: bash expands aliases only in command position
  'nice ls',
  'env ls',
  'sudo ls',
  'nohup ls',
  'builtin ls',
  'xargs ls',
  'time -p command ls',
  'cat <(command ls)',
  '(( ls = 1 )); printf "%s\\n" "$ls"', // arithmetic: ls is a variable
  '(( ls > 0 ))',
  '(( (ls) ))',
  'x=$(( ls + 1 )); echo $x',
  'for (( ls=0; ls<3; ls++ )); do :; done',
  'echo $(( ls + 1 ))',
  'echo "\\`ls\\`"', // escaped backticks in double quotes are literal text
  'echo \\`ls\\`',
  'echo "`command ls`"',
  'a=( \\)\nls\n)', // `\)` is data, so the ls below is an array element
  "a=( ')'\nls\n)",
  'a=( "x)"\nls\n)',
  "a=( '$(ls)' )", // single quotes are literal
  `a[${'x'.repeat(300)}]=( ls )`, // long subscript: the array target is recognised by a forward scan, not a fixed look-back
  `a[${'x'.repeat(300)}]=(\nls\n)`,
  `declare -a v[${'x'.repeat(300)}]=( ls )`,
  'coproc foo ls', // bash runs `foo` with argument ls (foo: command not found): ls is never executed as a command
  'echo "<(ls)"', // no process substitution inside double quotes
  'printf "%s\\n" "<(ls)"',
  'echo "x >(ls) y"',
  'echo \\<\\(ls\\)',
  "echo '<(ls)'",
  'coproc command ls',
  'coproc NAME { command ls; }',
  'a=( $(command ls) )',
  'commands=( ls -la )', // array assignment: words, not a command
  'commands=(\nls\n)',
  'declare -a c=( ls x )',
  'ls () { echo ok; }', // function definition
  'ls() { echo ok; }',
  '> /tmp/x command ls',
  'case $x in a) command ls;; esac',
  'case $x in ls) echo y;; esac', // ls as a pattern
  '\\ls',
  '/bin/ls',
  '/usr/bin/ls -la',
  "'ls'",
  'cat ls.txt',
  'grep ls file',
  'echo ls',
  'echo "ls -la"',
  "echo 'a; ls'",
  'lsof -i :80',
  'lsblk',
  'git ls-files',
  'git ls-files | wc -l',
  'for x in ls; do echo $x; done',
  'cat <<EOF\nls\nEOF',
  "bash -c 'ls'",
  'echo x && command ls | head',
];
for (const cmd of BARE_LS_ALLOW) {
  test(`rule4 allows: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd, { lsDefault: true });
    assert.strictEqual(r.deny, false);
    assert.doesNotMatch(r.ctx, /bare-ls/);
  });
}
test('rule4 knob: env warn advises without denying, off is silent, garbage denies', () => {
  const w = run('ls', { lsDefault: true, env: { AUTOPILOT_BASH_GUARD_LS_MODE: 'warn' } });
  assert.strictEqual(w.deny, false);
  assert.match(w.ctx, /bare-ls/);
  const o = run('ls', { lsDefault: true, env: { AUTOPILOT_BASH_GUARD_LS_MODE: 'off' } });
  assert.strictEqual(o.deny, false);
  assert.doesNotMatch(o.ctx, /bare-ls/);
  assert.strictEqual(run('ls', { lsDefault: true, env: { AUTOPILOT_BASH_GUARD_LS_MODE: 'bogus' } }).deny, true);
});

// Cost bound: the hook runs on every Bash call, so crafted unclosed `[a` / `a=(` runs must stay linear.
for (const [name, unit] of [['[a', '[a'], ['a=(', 'a=('], ['"((', '"(('], ['((', '(('], ['<(', '<(']]) {
  test(`rule4 grows linearly on ${name} runs: 16x the input costs < 64x the time (load-proof)`, () => {
    const { detectBareLs } = require('../scripts/lib/bash-launch-rules.js');
    for (const prefix of ['echo ', 'echo ls ']) {
      const ratio = growthRatio((c) => detectBareLs(c), (k) => `${prefix}${unit.repeat(k)}`, 1500);
      assert.ok(ratio < GROWTH_CEILING, `${prefix.trim()} ${name}: grew ${ratio.toFixed(1)}x for 16x input`);
    }
  });
  slowTest(`rule4 stays fast on 25000 x ${name}`, () => {
    const { detectBareLs } = require('../scripts/lib/bash-launch-rules.js');
    for (const cmd of [`echo ${unit.repeat(25000)}`, `echo ls ${unit.repeat(25000)}`]) {
      const t0 = process.hrtime.bigint();
      detectBareLs(cmd);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 150, `${ms} ms for ${cmd.slice(0, 12)}`);
    }
  });
}

test('rule4 fails open (no throw) on deeply nested quote/substitution input', () => {
  const { detectBareLs } = require('../scripts/lib/bash-launch-rules.js');
  for (const unit of ['a=( "$(', 'x="$(', '"`', '"((', "'((", '"<(', '"a=(']) {
    assert.doesNotThrow(() => detectBareLs(`echo ls ${unit.repeat(25000)}`));
  }
});

// ---- Rule 5: recursive rm with an expanding target => deny (every depth) ----
const RMVAR_DENY = [
  'rm -rf "$D"',
  'rm -rf $D',
  'rm -rf ${D}/x',
  'rm -rf "${D}/x"',
  'rm -fr -- "$(mktemp -d)"',
  'rm -r $D',
  'rm -R "$D"',
  'rm --recursive "$D"',
  'rm -Rf "$D"',
  'rm -fR "$D"',
  'rm -rf -- "$D"',
  'rm "$D" -rf',
  'rm -r -f "$D"',
  'rm -rf `mktemp -d`',
  'cd x && rm -rf $D',
  'cd x; rm -rf "$D"/sub',
  'true\nrm -rf "$D"\ntrue',
  'echo hi\nrm -rf \\\n  "$D"',
  'sudo rm -rf "$D"',
  'env A=1 rm -rf "$D"',
  'nice -n 10 rm -rf "$D"',
  '/bin/rm -rf "$D"',
  'FOO=1 rm -rf "$D"',
  'if true; then rm -rf "$D"; fi',
  'rm -rf literal "$D"',
  'bash -c \'rm -rf "$D"\'',
  'echo $(rm -rf "$D")',
  'x=$(rm -rf "$D")',
  'rm -rf $HOME/x',
  'rm -rf ~/"$D"',
  'rm -rf "$D" > log',
  'rm -rf "$D" 2>&1',
  'eval "rm -rf $D"',
  "eval 'rm -rf $D'",
  'bash <<\'EOF\'\nrm -rf "$D"\nEOF',
  'command rm -rf "$D"',
  'timeout 5 rm -rf "$D"',
  'nohup rm -rf "$D"',
  'exec rm -rf "$D"',
];
for (const cmd of RMVAR_DENY) {
  test(`rule5 denies: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, true, r.reason);
    assert.match(r.reason, /rm-var-target/);
    assert.match(r.reason, /literal path|trash/);
  });
}

const RMVAR_PASS = [
  'rm -rf /tmp/blg-literal-dir',
  'rm -rf ./build dist',
  'rm -rf -- literal',
  'rm $F',
  'rm -f "$F"',
  'rm "$F" "$G"',
  "rm -rf '$D'",
  "rm -rf '$(mktemp -d)'",
  'rm -rf \\$D',
  "rm -rf $'$D'",
  'echo "rm -rf $D"',
  "echo 'rm -rf $D'",
  'echo rm -rf $D',
  '# rm -rf $D\ntrue',
  "cat <<'EOF'\nrm -rf $D\nEOF",
  'git commit -m "$(cat <<\'EOF\'\nnote: rm -rf $D is denied\nEOF\n)"',
  'mv "$D" "$Q/trash/"',
  'ls -r "$D"',
  'grep -r foo "$D"',
  'cp -r "$A" "$B"',
  'git rm -r "$D"',
  'for d in a b; do echo "$d"; done',
  'echo $D | xargs echo rm -rf',
  'rm -rf build > "$LOG"',
  'rm -rf build 2>"$ERR"',
  'rm -rf build &>"$L"',
  'rm -rf build >>"$L" 2>&1',
  'rm -rf build < "$IN"',
];
for (const cmd of RMVAR_PASS) {
  test(`rule5 passes: ${JSON.stringify(cmd)}`, () => {
    const r = run(cmd);
    assert.strictEqual(r.deny, false, r.reason);
    assert.doesNotMatch(r.ctx, /rm-var-target/);
  });
}

test('rule5 also denies inside a subagent call (agent_id present)', () => {
  const r = run('rm -rf "$D"', { extra: { agent_id: 'sub-1', agent_type: 'general-purpose' } });
  assert.strictEqual(r.deny, true, r.reason);
  assert.match(r.reason, /rm-var-target/);
});

test('rule5 knob: off passes, warn advises without denying, garbage stays deny', () => {
  const off = run('rm -rf "$D"', { env: { AUTOPILOT_BASH_GUARD_RMVAR_MODE: 'off' } });
  assert.strictEqual(off.deny, false);
  assert.doesNotMatch(off.ctx, /rm-var-target/);
  const warn = run('rm -rf "$D"', { env: { AUTOPILOT_BASH_GUARD_RMVAR_MODE: 'warn' } });
  assert.strictEqual(warn.deny, false);
  assert.match(warn.ctx, /rm-var-target/);
  assert.strictEqual(run('rm -rf "$D"', { env: { AUTOPILOT_BASH_GUARD_RMVAR_MODE: 'bogus' } }).deny, true);
});

test('rule5 fails open (no throw) on deeply nested quote/substitution input', () => {
  const { detectRecursiveRmVar } = require('../scripts/lib/bash-launch-rules.js');
  for (const unit of ['a=( "$(', 'x="$(', '"`', '"((', "'((", '"<(', '"a=(']) {
    assert.doesNotThrow(() => detectRecursiveRmVar(`echo rm ${unit.repeat(25000)}`));
  }
});

// ---- Rules 6 & 7: subagent-rm-outside-scratch + rm-shared-dir (PM go 01M747MFS8) ----
function mkScratchSandbox(sessionId = 'blg') {
  const tmpRoot = mk('blg-tmproot-');
  const sandbox = mk('blg-sandbox-');
  const sessionRoot = path.join(tmpRoot, `claude-${process.getuid()}`, 'proj-slug', sessionId);
  const scratch = path.join(sessionRoot, 'scratchpad');
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
  fs.chmodSync(scratch, 0o700);
  fs.chmodSync(sandbox, 0o700);
  return { tmpRoot, sandbox, sessionRoot, scratch };
}

test('rule6 denies subagent `rm -rf /tmp/rv1` (literal target outside session scratchpad)', () => {
  const { tmpRoot } = mkScratchSandbox('blg');
  const r = run('rm -rf /tmp/rv1', {
    extra: { agent_id: 'sub-1', agent_type: 'general-purpose' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  });
  assert.strictEqual(r.deny, true, r.reason);
  assert.match(r.reason, /subagent-rm-outside-scratch/);
  assert.match(r.reason, /AUTOPILOT_BASH_GUARD_SUBAGENT_RM_MODE/);
});

test('rule6 denies subagent recursive rm across flags, wrappers, cwd resolution, ~ and eval/heredoc', () => {
  const { tmpRoot, sandbox } = mkScratchSandbox('blg');
  const outDir = path.join(sandbox, 'rv1');
  fs.mkdirSync(outDir);
  fs.chmodSync(outDir, 0o700);
  for (const cmd of [
    `rm -rf ${outDir}`,
    `rm -r ${outDir}`,
    `rm -R ${outDir}`,
    `rm -fr -- ${outDir}`,
    `rm --recursive ${outDir}`,
    `sudo rm -rf ${outDir}`,
    `/bin/rm -rf ${outDir}`,
    `command rm -rf ${outDir}`,
    'rm -rf ./rel-outside',
    'rm -rf ~/outside-home-target',
    `cd ${sandbox} && rm -rf rv1`,
    `bash -c 'rm -rf ${outDir}'`,
    `eval "rm -rf ${outDir}"`,
    `bash <<'EOF'\nrm -rf ${outDir}\nEOF`,
  ]) {
    const r = run(cmd, {
      extra: { agent_id: 'sub-1', cwd: sandbox },
      env: { CLAUDE_CODE_TMPDIR: tmpRoot },
    });
    assert.strictEqual(r.deny, true, `expected deny for ${cmd}: got ${JSON.stringify(r)}`);
    assert.match(r.reason, /subagent-rm-outside-scratch/);
  }
});

test('rule6 allows subagent `rm -rf <scratch>/x` (CLAUDE_CODE_TMPDIR and TMPDIR fallback)', () => {
  const { tmpRoot, scratch } = mkScratchSandbox('blg');
  const target = path.join(scratch, 'x');
  fs.mkdirSync(target);
  fs.chmodSync(target, 0o700);
  for (const env of [
    { CLAUDE_CODE_TMPDIR: tmpRoot },
    { TMPDIR: tmpRoot },
  ]) {
    const r = run(`rm -rf ${target}`, { extra: { agent_id: 'sub-1' }, env });
    assert.strictEqual(r.deny, false, r.reason);
    assert.doesNotMatch(r.ctx, /subagent-rm-outside-scratch|rm-shared-dir/);
  }
  // Relative target after `cd <scratch>` also resolves inside scratchpad.
  const rel = run(`cd ${scratch} && rm -rf x`, {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  });
  assert.strictEqual(rel.deny, false, rel.reason);
});

test('rule6 phantom cd: a cd that does not run in the shell of the later rm never commits a cwd', () => {
  const { tmpRoot, sandbox, scratch } = mkScratchSandbox('blg');
  for (const cmd of [
    `cd ${scratch} & rm -rf rv1`,
    `cd ${scratch} | rm -rf rv1`,
    `false && cd ${scratch}; rm -rf rv1`,
    `false || cd ${scratch}; rm -rf rv1`,
    `false && cd ${scratch}\nrm -rf rv1`,
  ]) {
    const r = run(cmd, {
      extra: { agent_id: 'sub-1', cwd: sandbox },
      env: { CLAUDE_CODE_TMPDIR: tmpRoot },
    });
    assert.strictEqual(r.deny, true, `expected deny for ${JSON.stringify(cmd)}: got ${JSON.stringify(r)}`);
    assert.match(r.reason, /subagent-rm-outside-scratch/);
  }
  // Same-shell cd stays honoured, also when the rm is in the same backgrounded list.
  for (const cmd of [`cd ${scratch} && rm -rf x`, `cd ${scratch}; rm -rf x`, `cd ${scratch} && rm -rf x &`]) {
    const ok = run(cmd, {
      extra: { agent_id: 'sub-1', cwd: sandbox },
      env: { CLAUDE_CODE_TMPDIR: tmpRoot },
    });
    assert.strictEqual(ok.deny, false, `expected allow for ${JSON.stringify(cmd)}: ${ok.reason}`);
  }
});

test('rule6 heredoc script runs in the cwd of the segment that runs it, not the payload cwd', () => {
  const { tmpRoot, sandbox, scratch } = mkScratchSandbox('blg');
  // payload cwd is the scratchpad, but a preceding `cd` moves the heredoc shell outside it: deny
  const outside = run(`cd ${sandbox} && bash <<'EOF'\nrm -rf rv1\nEOF`, {
    extra: { agent_id: 'sub-1', cwd: scratch },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  });
  assert.strictEqual(outside.deny, true, JSON.stringify(outside));
  assert.match(outside.reason, /subagent-rm-outside-scratch/);
  // payload cwd is outside, a preceding `cd` moves the heredoc shell into the scratchpad: allow
  const inside = run(`cd ${scratch} && bash <<'EOF'\nrm -rf x\nEOF`, {
    extra: { agent_id: 'sub-1', cwd: sandbox },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  });
  assert.strictEqual(inside.deny, false, inside.reason);
});

test('rule6 denies subagent targeting another session scratchpad, wrong uid dir, or session root itself', () => {
  const { tmpRoot, sessionRoot } = mkScratchSandbox('blg');
  const otherSession = path.join(tmpRoot, `claude-${process.getuid()}`, 'proj-slug', 'other-sid', 'scratchpad', 'x');
  const otherUid = path.join(tmpRoot, `claude-${process.getuid() + 1}`, 'proj-slug', 'blg', 'scratchpad', 'x');
  for (const bad of [otherSession, otherUid, sessionRoot]) {
    const r = run(`rm -rf ${bad}`, {
      extra: { agent_id: 'sub-1' },
      env: { CLAUDE_CODE_TMPDIR: tmpRoot },
    });
    assert.strictEqual(r.deny, true, `expected deny for ${bad}`);
    assert.match(r.reason, /subagent-rm-outside-scratch/);
  }
});

test('rule6 allows main session (no agent_id, or empty agent_id) on a non-shared tmp dir owned by us', () => {
  const { tmpRoot, sandbox } = mkScratchSandbox('blg');
  const ownDir = path.join(sandbox, 'rv1');
  fs.mkdirSync(ownDir);
  fs.chmodSync(ownDir, 0o700);
  assert.strictEqual(fs.statSync(ownDir).mode & 0o777, 0o700);

  const main = run(`rm -rf ${ownDir}`, { env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(main.deny, false, main.reason);
  assert.strictEqual(main.ctx, '');

  const emptyAgent = run(`rm -rf ${ownDir}`, {
    extra: { agent_id: '' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  });
  assert.strictEqual(emptyAgent.deny, false, emptyAgent.reason);
  assert.strictEqual(emptyAgent.ctx, '');
});

test('rule6 allows subagent non-recursive rm and quoted/heredoc data', () => {
  const { tmpRoot, sandbox } = mkScratchSandbox('blg');
  const f = path.join(sandbox, 'file.txt');
  fs.writeFileSync(f, 'x');
  for (const cmd of [
    `rm -f ${f}`,
    'echo "rm -rf /tmp/rv1"',
    "cat <<'EOF'\nrm -rf /tmp/rv1\nEOF",
  ]) {
    const r = run(cmd, { extra: { agent_id: 'sub-1' }, env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
    assert.strictEqual(r.deny, false, r.reason);
    assert.doesNotMatch(r.ctx, /subagent-rm-outside-scratch/);
  }
});

test('rule6 knob: warn -> warn not deny, off -> allow, garbage -> deny, config.json honored', () => {
  const { tmpRoot } = mkScratchSandbox('blg');
  const warn = run('rm -rf /tmp/rv1', {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_BASH_GUARD_SUBAGENT_RM_MODE: 'warn' },
  });
  assert.strictEqual(warn.deny, false);
  assert.match(warn.ctx, /subagent-rm-outside-scratch/);

  const off = run('rm -rf /tmp/rv1', {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_BASH_GUARD_SUBAGENT_RM_MODE: 'off' },
  });
  assert.strictEqual(off.deny, false);
  assert.doesNotMatch(off.ctx, /subagent-rm-outside-scratch/);

  const bogus = run('rm -rf /tmp/rv1', {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_BASH_GUARD_SUBAGENT_RM_MODE: 'bogus' },
  });
  assert.strictEqual(bogus.deny, true);

  // config.json knob: subagent_rm = warn and off
  const cfgHome = mk('blg-cfg-sr-');
  const cfgFile = path.join(cfgHome, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ depth0_delegate_gate: { subagent_rm: 'warn' } }));
  const cfgWarn = run('rm -rf /tmp/rv1', {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_CONFIG_FILE: cfgFile },
  });
  assert.strictEqual(cfgWarn.deny, false);
  assert.match(cfgWarn.ctx, /subagent-rm-outside-scratch/);

  fs.writeFileSync(cfgFile, JSON.stringify({ depth0_delegate_gate: { subagent_rm: 'off' } }));
  const cfgOff = run('rm -rf /tmp/rv1', {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_CONFIG_FILE: cfgFile },
  });
  assert.strictEqual(cfgOff.deny, false);
  assert.doesNotMatch(cfgOff.ctx, /subagent-rm-outside-scratch/);
});

test('rule6 symlink escape: trailing slash or descendant through symlink to outside dir is denied; bare symlink leaf passes', () => {
  const { tmpRoot, sandbox, scratch } = mkScratchSandbox('blg');
  const outside = path.join(sandbox, 'outside-real');
  fs.mkdirSync(path.join(outside, 'child'), { recursive: true });
  const link = path.join(scratch, 'esc');
  fs.symlinkSync(outside, link);

  const slash = run(`rm -rf ${link}/`, { extra: { agent_id: 'sub-1' }, env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(slash.deny, true, slash.reason);
  assert.match(slash.reason, /subagent-rm-outside-scratch/);

  const desc = run(`rm -rf ${link}/child`, { extra: { agent_id: 'sub-1' }, env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(desc.deny, true, desc.reason);

  const bare = run(`rm -rf ${link}`, { extra: { agent_id: 'sub-1' }, env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(bare.deny, false, bare.reason);
});

test('rule7 warns on chmod 0775 (group-writable) and 0777 (world-writable) dir in main session; chmod 0700/0755 own dir has no warn', () => {
  const { tmpRoot, sandbox } = mkScratchSandbox('blg');
  const grpDir = path.join(sandbox, 'shared-0775');
  fs.mkdirSync(grpDir);
  fs.chmodSync(grpDir, 0o775);
  assert.strictEqual(fs.statSync(grpDir).mode & 0o777, 0o775);

  const w1 = run(`rm -rf ${grpDir}`, { env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(w1.deny, false);
  assert.match(w1.ctx, /rm-shared-dir/);
  assert.match(w1.ctx, /group-writable \(mode 0775\)/);

  const worldDir = path.join(sandbox, 'shared-0777');
  fs.mkdirSync(worldDir);
  fs.chmodSync(worldDir, 0o777);
  const w2 = run(`rm -rf ${worldDir}`, { env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(w2.deny, false);
  assert.match(w2.ctx, /rm-shared-dir/);
  assert.match(w2.ctx, /world-writable \(mode 0777\)/);

  const own700 = path.join(sandbox, 'own-0700');
  fs.mkdirSync(own700);
  fs.chmodSync(own700, 0o700);
  const ok700 = run(`rm -rf ${own700}`, { env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(ok700.deny, false);
  assert.doesNotMatch(ok700.ctx, /rm-shared-dir/);

  const own755 = path.join(sandbox, 'own-0755');
  fs.mkdirSync(own755);
  fs.chmodSync(own755, 0o755);
  const ok755 = run(`rm -rf ${own755}`, { env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(ok755.deny, false);
  assert.doesNotMatch(ok755.ctx, /rm-shared-dir/);
});

test('rule7 precedence & scratchpad exemption: subagent + shared dir outside scratch -> deny (rule 6 wins); shared dir inside scratch -> exempt', () => {
  const { tmpRoot, sandbox, scratch } = mkScratchSandbox('blg');
  const outsideShared = path.join(sandbox, 'shared-outside');
  fs.mkdirSync(outsideShared);
  fs.chmodSync(outsideShared, 0o775);

  const subOut = run(`rm -rf ${outsideShared}`, {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  });
  assert.strictEqual(subOut.deny, true, subOut.reason);
  assert.match(subOut.reason, /subagent-rm-outside-scratch/);

  const insideShared = path.join(scratch, 'shared-inside');
  fs.mkdirSync(insideShared);
  fs.chmodSync(insideShared, 0o775);
  for (const extra of [{}, { agent_id: 'sub-1' }]) {
    const r = run(`rm -rf ${insideShared}`, { extra, env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
    assert.strictEqual(r.deny, false, r.reason);
    assert.doesNotMatch(r.ctx, /rm-shared-dir|subagent-rm-outside-scratch/);
  }
});

test('rule7 knob: deny blocks, off silences, garbage falls back to warn, config.json honored', () => {
  const { tmpRoot, sandbox } = mkScratchSandbox('blg');
  const grpDir = path.join(sandbox, 'shared-knob');
  fs.mkdirSync(grpDir);
  fs.chmodSync(grpDir, 0o775);

  const denied = run(`rm -rf ${grpDir}`, {
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_BASH_GUARD_SHARED_RM_MODE: 'deny' },
  });
  assert.strictEqual(denied.deny, true);
  assert.match(denied.reason, /rm-shared-dir/);

  const off = run(`rm -rf ${grpDir}`, {
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_BASH_GUARD_SHARED_RM_MODE: 'off' },
  });
  assert.strictEqual(off.deny, false);
  assert.doesNotMatch(off.ctx, /rm-shared-dir/);

  const bogus = run(`rm -rf ${grpDir}`, {
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_BASH_GUARD_SHARED_RM_MODE: 'bogus' },
  });
  assert.strictEqual(bogus.deny, false);
  assert.match(bogus.ctx, /rm-shared-dir/);

  const cfgHome = mk('blg-cfg-sh-');
  const cfgFile = path.join(cfgHome, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ depth0_delegate_gate: { shared_rm: 'deny' } }));
  const cfgDeny = run(`rm -rf ${grpDir}`, {
    env: { CLAUDE_CODE_TMPDIR: tmpRoot, AUTOPILOT_CONFIG_FILE: cfgFile },
  });
  assert.strictEqual(cfgDeny.deny, true);
  assert.match(cfgDeny.reason, /rm-shared-dir/);
});

test('rules 6 & 7 unexpanded glob targets: rule 6 judges literal parent dir; rule 7 skips globs', () => {
  const { tmpRoot, sandbox, scratch } = mkScratchSandbox('blg');
  const grpDir = path.join(sandbox, 'glob-shared');
  fs.mkdirSync(grpDir);
  fs.chmodSync(grpDir, 0o775);

  // Rule 6: outside glob parent -> deny; scratchpad glob parent -> allow; climb `..` after glob -> deny.
  assert.strictEqual(run(`rm -rf ${grpDir}/*`, {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  }).deny, true);
  assert.strictEqual(run(`rm -rf ${scratch}/*`, {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  }).deny, false);
  assert.strictEqual(run(`rm -rf ${scratch}/*/../../outside`, {
    extra: { agent_id: 'sub-1' },
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
  }).deny, true);

  // Rule 7: main session with unexpanded glob skips rule 7 (no warn).
  const mainGlob = run(`rm -rf ${grpDir}/*`, { env: { CLAUDE_CODE_TMPDIR: tmpRoot } });
  assert.strictEqual(mainGlob.deny, false);
  assert.doesNotMatch(mainGlob.ctx, /rm-shared-dir/);
});

test('rule7 detects foreign owner uid even when directory mode is 0700', () => {
  const { detectRmSharedDir } = require('../scripts/lib/bash-launch-rules.js');
  const { tmpRoot, sandbox } = mkScratchSandbox('blg');
  const foreignDir = path.join(sandbox, 'foreign-0700');
  fs.mkdirSync(foreignDir);
  fs.chmodSync(foreignDir, 0o700);
  const hit = detectRmSharedDir(`rm -rf ${foreignDir}`, {
    sessionId: 'blg',
    cwd: sandbox,
    env: { CLAUDE_CODE_TMPDIR: tmpRoot },
    uid: process.getuid() + 1,
  });
  assert.ok(hit, 'expected rm-shared-dir hit on uid mismatch');
  assert.strictEqual(hit.rule, 'rm-shared-dir');
  assert.match(hit.why, /owned by uid/);
});

test('rules 6 & 7 fail open (no throw) on deeply nested quote/substitution input', () => {
  const { detectSubagentRmOutsideScratch, detectRmSharedDir } = require('../scripts/lib/bash-launch-rules.js');
  for (const unit of ['a=( "$(', 'x="$(', '"`', '"((', "'((", '"<(', '"a=(']) {
    assert.doesNotThrow(() => detectSubagentRmOutsideScratch(`echo rm ${unit.repeat(25000)}`, { agentId: 's1', sessionId: 'blg' }));
    assert.doesNotThrow(() => detectRmSharedDir(`echo rm ${unit.repeat(25000)}`, { sessionId: 'blg' }));
  }
});
