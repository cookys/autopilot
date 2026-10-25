'use strict';
// Unit tests for hooks/post-tool-chain-lib.js (BL-0241 guard-port Phase 1). The byte-for-byte comparison with
// the separate-process observers lives in hooks/tests/post-tool-chain-differential.test.sh; this file covers the
// chain mechanics with fake members: failure isolation, exit handling, output flush order, large output, TERM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOOKS = __dirname;
// PTC_LIB: the differential shell test points this at a deliberately broken copy (negative controls).
const LIB = process.env.PTC_LIB || path.join(HOOKS, 'post-tool-chain-lib.js');
const { MEMBERS, runChain, capture } = require(LIB);

const fake = (impl) => ({ runHook: impl });
function run(members, mods, stdin = 'IN') {
  const out = [], err = [];
  const code = runChain({
    stdin, members, load: (s) => mods[s],
    writeOut: (b) => out.push(b), writeErr: (b) => err.push(b),
  });
  return { code, out: Buffer.concat(out).toString(), err: Buffer.concat(err).toString() };
}

test('members are forwarded in order, per stream, and every member sees the same stdin text', () => {
  const seen = [];
  const mods = {
    a: fake((t) => { seen.push(t); process.stdout.write('A-out;'); process.stderr.write('A-err;'); return 0; }),
    b: fake((t) => { seen.push(t); process.stdout.write('B-out;'); return 0; }),
    c: fake((t) => { seen.push(t); process.stderr.write('C-err;'); return 0; }),
  };
  const r = run(['a', 'b', 'c'], mods, 'PAYLOAD');
  assert.strictEqual(r.out, 'A-out;B-out;');
  assert.strictEqual(r.err, 'A-err;C-err;');
  assert.deepStrictEqual(seen, ['PAYLOAD', 'PAYLOAD', 'PAYLOAD']);
  assert.strictEqual(r.code, 0);
});

// BL-0304: the host parses stdout only when it is ONE JSON object. Pure additionalContext objects are held and merged.
const ctxObj = (event, text) => `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`;
test('two pure additionalContext outputs become ONE JSON object (texts joined by newline, registration order)', () => {
  const mods = {
    a: fake(() => { process.stdout.write(ctxObj('PostToolUse', 'first')); return 0; }),
    quiet: fake(() => 0),
    b: fake(() => { process.stdout.write(ctxObj('PostToolUse', 'second')); return 0; }),
  };
  const r = run(['a', 'quiet', 'b'], mods);
  assert.strictEqual(r.out, ctxObj('PostToolUse', 'first\nsecond'));
  assert.doesNotThrow(() => JSON.parse(r.out), 'the whole stdout parses as one object');
});

test('a single pure additionalContext output is written byte-for-byte; other stdout is forwarded at once and in order', () => {
  const one = ctxObj('PostToolUse', 'only');
  const mods = {
    a: fake(() => { process.stdout.write(one); return 0; }),
    b: fake(() => { process.stdout.write('plain;'); return 0; }),
  };
  const r = run(['a', 'b'], mods);
  assert.strictEqual(r.out, `plain;${one}`);
  const r2 = run(['a'], mods);
  assert.strictEqual(r2.out, one);
});

test('an object with a permissionDecision, extra keys or a different event is never merged', () => {
  const dec = `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'x' } })}\n`;
  const mods = {
    a: fake(() => { process.stdout.write(dec); return 0; }),
    b: fake(() => { process.stdout.write(ctxObj('PostToolUse', 'ctx')); return 0; }),
    c: fake(() => { process.stdout.write(ctxObj('PreToolUse', 'other')); return 0; }),
  };
  assert.strictEqual(run(['a', 'b'], mods).out, dec + ctxObj('PostToolUse', 'ctx'));
  assert.strictEqual(run(['b', 'c'], mods).out, ctxObj('PostToolUse', 'ctx') + ctxObj('PreToolUse', 'other'));
});

test('a member that throws fails open: one note on stderr, the others still run, status 0', () => {
  const mods = {
    a: fake(() => { process.stdout.write('A;'); return 0; }),
    boom: fake(() => { throw new Error('kaput'); }),
    c: fake(() => { process.stdout.write('C;'); return 0; }),
  };
  const r = run(['a', 'boom', 'c'], mods);
  assert.strictEqual(r.out, 'A;C;');
  assert.strictEqual(r.err, 'post-tool-chain: member fail-open: kaput\n');
  assert.strictEqual(r.code, 0);
});

test('a member that cannot be loaded or exports no runHook fails open the same way', () => {
  const mods = { a: fake(() => 0), nofn: {} };
  const r = run(['missing', 'nofn', 'a'], mods);
  assert.match(r.err, /member fail-open: .*\n.*exports no runHook/s);
  assert.strictEqual(r.code, 0);
});

test('chain exits with the highest member status; a direct process.exit ends only that member', () => {
  const mods = {
    a: fake(() => 0),
    b: fake(() => { process.stdout.write('B;'); process.exit(2); }),
    c: fake(() => { process.stdout.write('C;'); return 1; }),
  };
  const r = run(['a', 'b', 'c'], mods);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.out, 'B;C;');
});

test('stdout/stderr/exit are restored after every member, including a throwing one', () => {
  const w = process.stdout.write, e = process.stderr.write, x = process.exit;
  run(['boom', 'ok'], { boom: fake(() => { throw new Error('x'); }), ok: fake(() => { process.exit(0); }) });
  assert.strictEqual(process.stdout.write, w);
  assert.strictEqual(process.stderr.write, e);
  assert.strictEqual(process.exit, x);
  const c = capture(() => 7);
  assert.strictEqual(c.code, 7);
  assert.strictEqual(process.stdout.write, w);
});

test('a member that writes nothing emits nothing (empty output stays empty)', () => {
  const calls = [];
  const out = [];
  runChain({ stdin: '', members: ['a'], load: () => fake(() => 0), writeOut: (b) => { calls.push('o'); out.push(b); }, writeErr: () => calls.push('e') });
  assert.deepStrictEqual(calls, []);
});

test('non-JSON, binary and multi-byte output is forwarded byte for byte', () => {
  const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x0a, 0xe2, 0x80, 0x94]);
  const mods = { a: fake(() => { process.stdout.write(bytes); process.stdout.write('—', 'utf8'); return 0; }) };
  const out = [];
  runChain({ stdin: '', members: ['a'], load: (s) => mods[s], writeOut: (b) => out.push(b), writeErr: () => {} });
  assert.ok(Buffer.concat(out).equals(Buffer.concat([bytes, Buffer.from('—')])));
});

test('exit statuses are normalised the way a separate process would exit (-1 -> 255, 256 -> 0, "3" -> 3)', () => {
  const st = (v) => run(['a'], { a: fake(() => v) }).code;
  assert.strictEqual(st(-1), 255);
  assert.strictEqual(st(256), 0);
  assert.strictEqual(st(257), 1);
  assert.strictEqual(st('3'), 3);
  assert.strictEqual(st(undefined), 0);
  // process.exit(-1) inside a member counts as 255 and beats a later 1
  const r = run(['a', 'b'], { a: fake(() => { process.exit(-1); }), b: fake(() => 1) });
  assert.strictEqual(r.code, 255);
  // anything Node would reject (non-integer, NaN, boolean, non-numeric string) fails that member open, status 0
  for (const bad of [1.5, NaN, true, 'abc']) {
    const rr = run(['a'], { a: fake(() => bad) });
    assert.strictEqual(rr.code, 0, `status for ${String(bad)}`);
    assert.match(rr.err, /member fail-open: The (value of )?"code"/);
  }
  const rp = run(['a'], { a: fake(() => { process.exit(1.5); }) });
  assert.match(rp.err, /member fail-open/);
});

// Exit-code semantics are Node's own: the chain hands the value to process.exitCode (Node's setter validates and converts) and
// the expected result is what the hook gets as its OWN process (`node -e` running the same statements). Valid values must give
// the identical exit code; values Node rejects make the standalone process die with status 1 and Node's error, which in the
// chain is a fail-open member (status 0) carrying the SAME Node error text.
const CODE_VALUES = ['"3.0"', '"3e0"', '"0x03"', '"0b11"', '"0o3"', '"-1.0"', '" 3 "', '"7"', '3', '-1', '255', '256', '257', 'undefined', 'null',
  '"abc"', '""', '3.5', '1e30', '"1e30"', 'NaN', 'Infinity', 'true', '{}'];
const standalone = (stmt) => {
  const r = spawnSync(process.execPath, ['-e', stmt], { encoding: 'utf8' });
  return { code: r.status, err: r.stderr };
};
const nodeMsg = (stderr) => { const m = /^(?:Uncaught )?(?:RangeError|TypeError)[^\n]*?: (.+)$/m.exec(stderr) || /(The "code" argument[^\n]*)/.exec(stderr); return m ? m[1].replace(/ \[ERR_[A-Z_]+\]$/, '') : null; };
for (const style of ['return', 'exit']) {
  test(`exit code semantics equal the hook running alone (${style} style, every value)`, () => {
    for (const v of CODE_VALUES) {
      const alone = standalone(style === 'return' ? `process.exit((() => (${v}))())` : `process.exit(${v})`);
      const impl = style === 'return' ? new Function(`return (${v});`) : new Function(`process.exit(${v});`);
      const r = run(['a'], { a: fake(impl) });
      if (alone.code === 1 && /ERR_(INVALID_ARG_TYPE|OUT_OF_RANGE)/.test(alone.err)) {
        assert.strictEqual(r.code, 0, `${v}: rejected by Node -> fail-open status`);
        const msg = nodeMsg(alone.err);
        assert.ok(msg && r.err.includes(msg), `${v}: chain diagnostic carries Node's error text (${msg}) got ${r.err}`);
      } else {
        assert.strictEqual(r.code, alone.code, `${v}: chain status equals the standalone status`);
        assert.strictEqual(r.err, '', `${v}: no diagnostic`);
      }
    }
  });
}
test('process.exit() with no argument takes the exitCode the member set; process.exit(undefined) clears it (as alone)', () => {
  const alone = standalone('process.exitCode = 7; process.exit()');
  assert.strictEqual(alone.code, 7);
  assert.strictEqual(run(['a'], { a: fake(() => { process.exitCode = 7; process.exit(); }) }).code, 7);
  const alone2 = standalone('process.exitCode = 7; process.exit(undefined)');
  assert.strictEqual(run(['a'], { a: fake(() => { process.exitCode = 7; process.exit(undefined); }) }).code, alone2.code);
  // and a member returning normally after setting exitCode: alone it is process.exit(<return value>) -> the return value wins
  const alone3 = standalone('process.exitCode = 7; process.exit((() => 0)())');
  assert.strictEqual(run(['a'], { a: fake(() => { process.exitCode = 7; return 0; }) }).code, alone3.code);
  // the member's exitCode does not leak into the next member
  assert.strictEqual(run(['a', 'b'], { a: fake(() => { process.exitCode = 9; return 0; }), b: fake(() => { process.exit(); }) }).code, 0);
});

// --- isolation between members (same process): env, exitCode, listeners, module state ---
test('a member cannot leak process.env into the next one', () => {
  const seen = [];
  run(['a', 'b'], {
    a: fake(() => { process.env.PTC_LEAK = 'x'; delete process.env.PATH_PTC_NONE; process.env.HOME_PTC_CHANGED = 'new'; return 0; }),
    b: fake(() => { seen.push(process.env.PTC_LEAK, process.env.HOME_PTC_CHANGED); return 0; }),
  });
  assert.deepStrictEqual(seen, [undefined, undefined]);
  assert.strictEqual(process.env.PTC_LEAK, undefined);
});

test('a member that changes or deletes an existing env var gets it back', () => {
  process.env.PTC_KEEP = 'orig';
  const seen = [];
  try {
    run(['a', 'b'], {
      a: fake(() => { process.env.PTC_KEEP = 'changed'; return 0; }),
      b: fake(() => { seen.push(process.env.PTC_KEEP); delete process.env.PTC_KEEP; return 0; }),
    });
    assert.deepStrictEqual(seen, ['orig']);
    assert.strictEqual(process.env.PTC_KEEP, 'orig');
  } finally { delete process.env.PTC_KEEP; }
});

test('a member cannot leak process.exitCode', () => {
  const before = process.exitCode;
  const seen = [];
  const r = run(['a', 'b'], {
    a: fake(() => { process.exitCode = 9; return 0; }),
    b: fake(() => { seen.push(process.exitCode); return 0; }),
  });
  assert.deepStrictEqual(seen, [before]);
  assert.strictEqual(process.exitCode, before);
  assert.strictEqual(r.code, 0);
});

test('a member cannot leave process event listeners behind (added ones removed, removed ones restored)', () => {
  const keep = () => {};
  process.on('ptc-test-event', keep);
  try {
    const counts = [];
    run(['a', 'b', 'c'], {
      a: fake(() => { process.on('ptc-test-event', () => {}); process.on('ptc-other-event', () => {}); return 0; }),
      b: fake(() => { counts.push([process.listenerCount('ptc-test-event'), process.listenerCount('ptc-other-event')]); process.removeAllListeners('ptc-test-event'); return 0; }),
      c: fake(() => { counts.push([process.listenerCount('ptc-test-event'), process.listenerCount('ptc-other-event')]); return 0; }),
    });
    assert.deepStrictEqual(counts, [[1, 0], [1, 0]]);
    assert.deepStrictEqual(process.listeners('ptc-test-event'), [keep]);
  } finally { process.removeAllListeners('ptc-test-event'); }
});

test('a once() listener stays once after a member touches the listeners of that event', () => {
  let calls = 0;
  process.once('ptc-once-event', () => { calls++; });
  try {
    run(['a'], { a: fake(() => { process.on('ptc-once-event', () => {}); return 0; }) });
    process.emit('ptc-once-event');
    process.emit('ptc-once-event');
    assert.strictEqual(calls, 1);
  } finally { process.removeAllListeners('ptc-once-event'); }
});

test('a once() listener fired by one member can fire again for the next member (a separate process starts with a fresh one)', () => {
  let calls = 0;
  process.once('ptc-once-fire', () => { calls++; });
  try {
    run(['a', 'b'], {
      a: fake(() => { process.emit('ptc-once-fire'); return 0; }),
      b: fake(() => { process.emit('ptc-once-fire'); return 0; }),
    });
    assert.strictEqual(calls, 2, 'fired once per member');
    // and it is still a once listener afterwards: one more emit fires it, the next does not
    process.emit('ptc-once-fire');
    process.emit('ptc-once-fire');
    assert.strictEqual(calls, 3);
  } finally { process.removeAllListeners('ptc-once-fire'); }
});

test('a shared module PRELOADED before the chain started is fresh for every member', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptc-pre-'));
  try {
    const lib = path.join(dir, 'preloaded-lib.js');
    fs.writeFileSync(lib, "'use strict'; let hits = 0; module.exports = { TAIL: 256, bump() { return ++hits; } };\n");
    const pre = require(lib); // loaded before runChain, as an embedder or an earlier step could have
    assert.strictEqual(pre.TAIL, 256);
    const seen = [];
    const mods = {
      a: fake(() => { const l = require(lib); seen.push([l.TAIL, l.bump()]); l.TAIL = 123; l.bump(); return 0; }),
      b: fake(() => { const l = require(lib); seen.push([l.TAIL, l.bump()]); return 0; }),
    };
    run(['a', 'b'], mods);
    assert.deepStrictEqual(seen, [[256, 1], [256, 1]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('module-level state a member mutates (a shared lib, like transcript-reader-lib TAIL_WINDOW_BYTES) starts fresh for the next member', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptc-mod-'));
  try {
    const lib = path.join(dir, 'shared-lib.js');
    fs.writeFileSync(lib, "'use strict'; let hits = 0; module.exports = { TAIL: 256, bump() { return ++hits; } };\n");
    const seen = [];
    const mods = {
      a: fake(() => { const l = require(lib); l.TAIL = 200; l.bump(); l.bump(); return 0; }),
      b: fake(() => { const l = require(lib); seen.push([l.TAIL, l.bump()]); return 0; }),
    };
    run(['a', 'b'], mods);
    assert.deepStrictEqual(seen, [[256, 1]]);
    assert.ok(!(lib in require.cache), 'module loaded by a member is not left in the cache');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real hook modules can run in reverse order: each member behaves the same wherever it sits', () => {
  // members are independent: reversing the list only reverses the per-stream concatenation
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ptc-rev-'));
  try {
    const script = path.join(tmpHome, 'drive.js');
    fs.writeFileSync(script, `const { runChain, MEMBERS } = require(${JSON.stringify(LIB)});
const payload = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: 'false' }, exit_code: 1, tool_response: 'x' });
const go = (members) => { const o = []; const e = []; const code = runChain({ stdin: payload, members, writeOut: (b) => o.push(String(b)), writeErr: (b) => e.push(String(b)) }); return { code, o, e }; };
const fwd = go(MEMBERS);
const rev = go(MEMBERS.slice().reverse());
const all = go(MEMBERS); // third run: failure counter is now 3
console.log(JSON.stringify({ fwd, rev, all }));`);
    const env = { PATH: process.env.PATH, HOME: path.join(tmpHome, 'home'), TMPDIR: tmpHome, AUTOPILOT_LIVE_DIR: path.join(tmpHome, 'live') };
    fs.mkdirSync(env.HOME);
    const r = spawnSync(process.execPath, [script], { cwd: tmpHome, env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.strictEqual(j.fwd.code, 0);
    assert.strictEqual(j.rev.code, 0);
    // forward run was the 1st failure (silent), reverse the 2nd (L1 text), third the 3rd (L2 text): the counter
    // advanced identically no matter where failure-escalation sat in the list
    assert.strictEqual(j.fwd.o.join(''), '');
    assert.match(j.rev.o.join(''), /Failure Escalation — L1/);
    assert.match(j.all.o.join(''), /Failure Escalation — L2/);
  } finally { fs.rmSync(tmpHome, { recursive: true, force: true }); }
});

// --- real process tests: large output through a slow pipe, TERM, no residue ---
function childScript(dir, body) {
  const f = path.join(dir, 'child.js');
  fs.writeFileSync(f, `'use strict';\nconst { runChain } = require(${JSON.stringify(LIB)});\n${body}\n`);
  return f;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ptc-unit-'));

test('a 3 MB output through a slowly-read pipe arrives complete, in order, and the chain exits 0', async () => {
  const dir = tmp();
  try {
    const f = childScript(dir, `
const big = Buffer.alloc(3 * 1024 * 1024, 'x'); big[0] = 0x41; big[big.length - 1] = 0x5a;
const mods = { a: { runHook() { process.stdout.write(big); return 0; } }, b: { runHook() { process.stdout.write('TAIL'); return 0; } } };
process.exit(runChain({ stdin: '', members: ['a', 'b'], load: (s) => mods[s] }));`);
    const c = spawn(process.execPath, [f], { stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks = [];
    c.stdout.pause();
    await new Promise((r) => setTimeout(r, 300)); // let the pipe fill so the child hits EAGAIN / blocking
    c.stdout.on('data', (d) => chunks.push(d));
    c.stdout.resume();
    const code = await new Promise((r) => c.on('close', r));
    const all = Buffer.concat(chunks);
    assert.strictEqual(code, 0);
    assert.strictEqual(all.length, 3 * 1024 * 1024 + 4);
    assert.strictEqual(all[0], 0x41);
    assert.strictEqual(all.subarray(all.length - 5).toString(), 'ZTAIL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SIGTERM during a later member: earlier member bytes were already flushed, the chain dies, nothing is left behind', async () => {
  const dir = tmp();
  try {
    const f = childScript(dir, `
const mods = {
  a: { runHook() { process.stdout.write('FIRST-DONE\\n'); return 0; } },
  hang: { runHook() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); return 0; } },
  never: { runHook() { process.stdout.write('SHOULD-NOT-RUN\\n'); return 0; } },
};
process.exit(runChain({ stdin: '', members: ['a', 'hang', 'never'], load: (s) => mods[s] }));`);
    const before = fs.readdirSync(dir).sort();
    const c = spawn(process.execPath, [f], { stdio: ['ignore', 'pipe', 'pipe'] });
    let got = '';
    await new Promise((res) => c.stdout.on('data', (d) => { got += d; if (got.includes('FIRST-DONE')) res(); }));
    process.kill(c.pid, 'SIGTERM');
    const [code, sig] = await new Promise((r) => c.on('close', (cd, sg) => r([cd, sg])));
    assert.strictEqual(sig, 'SIGTERM');
    assert.strictEqual(code, null);
    assert.ok(!got.includes('SHOULD-NOT-RUN'));
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), before, 'no temp files left in the working dir');
    assert.ok(!fs.existsSync(`/proc/${c.pid}`), 'no orphan process');
    // the chain starts no child processes of its own: nothing could have been orphaned
    assert.ok(!/child_process/.test(fs.readFileSync(LIB, 'utf8')), 'post-tool-chain-lib.js spawns nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EPIPE on the host side does not stop the remaining members from running', async () => {
  const dir = tmp();
  try {
    const marker = path.join(dir, 'ran-b');
    const f = childScript(dir, `
const fs = require('fs');
const mods = {
  a: { runHook() { process.stdout.write('x'.repeat(200000)); return 0; } },
  b: { runHook() { fs.writeFileSync(${JSON.stringify(marker)}, '1'); return 0; } },
};
process.exit(runChain({ stdin: '', members: ['a', 'b'], load: (s) => mods[s] }));`);
    const c = spawn(process.execPath, [f], { stdio: ['ignore', 'pipe', 'ignore'] });
    c.stdout.destroy(); // reader goes away immediately
    const code = await new Promise((r) => c.on('close', r));
    assert.strictEqual(code, 0);
    assert.ok(fs.existsSync(marker), 'member b still ran after the host closed the pipe');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: unknown member names fail open (exit 0, one stderr line) and run nothing', () => {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'post-tool-chain.js'), 'rm-rf'], { input: '{}', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /unknown member\(s\): rm-rf/);
  assert.strictEqual(r.stdout, '');
});

// --- wiring tripwires ---
// Phase 2 wiring (depth-0 ruling (a)): the chain is registered with argv intent-capture audit-log log-error; reload-watch and
// failure-escalation stay separate registrations. The registered chain members must be a subsequence of MEMBERS.
const REGISTERED_CHAIN = ['intent-capture', 'audit-log', 'log-error'];
function starCommands(hooksJson) {
  return hooksJson.hooks.PostToolUse.find((m) => m.matcher === '.*').hooks.map((h) => h.command);
}
function wiringOk(chainMembers, hooksJson) {
  const cmds = starCommands(hooksJson);
  const chain = cmds.filter((c) => /post-tool-chain\.js/.test(c));
  if (chain.length !== 1) return false;
  const argv = chain[0].replace(/^.*post-tool-chain\.js/, '').trim().split(/\s+/).filter(Boolean);
  if (JSON.stringify(argv) !== JSON.stringify(chainMembers)) return false;
  // no chained member is also registered directly in the same event
  return !cmds.some((c) => chainMembers.some((m) => new RegExp(`hooks/${m}\\.js`).test(c)));
}

test('Phase 2: hooks.json registers the chain for intent-capture, audit-log, log-error and nothing else chained', () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8'));
  assert.ok(wiringOk(REGISTERED_CHAIN, hooksJson));
  for (const m of REGISTERED_CHAIN) assert.ok(MEMBERS.includes(m), `${m} is a chain member`);
  const cmds = starCommands(hooksJson);
  assert.ok(cmds.some((c) => /hooks\/reload-watch\.js/.test(c)), 'reload-watch stays a separate registration');
  assert.ok(cmds.some((c) => /hooks\/failure-escalation\.js/.test(c)), 'failure-escalation stays a separate registration');
  assert.equal(cmds.length, 5, 'PostToolUse `.*` spawns five processes');
  // negative controls: dropping a member, or registering one directly as well, is detected
  assert.ok(!wiringOk(REGISTERED_CHAIN.slice(1), hooksJson));
  const dup = JSON.parse(JSON.stringify(hooksJson));
  dup.hooks.PostToolUse[0].hooks.push({ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/log-error.js' });
  assert.ok(!wiringOk(REGISTERED_CHAIN, dup));
});
