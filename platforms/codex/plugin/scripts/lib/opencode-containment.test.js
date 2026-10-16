#!/usr/bin/env node
'use strict';
// opencode deny-all containment (lib/opencode-containment.js, qualification-review-provider.js
// opencode kind, dispatch-review.sh opencode branch). No real opencode and no network: a stub
// binary records the env/argv/cwd it receives. The live counterpart is
// hooks/tests/opencode-deny-all-live.test.sh (AUTOPILOT_LIVE_OPENCODE=1).
//
// Negative controls (shown red 2026-10-16 by mutating the provider/dispatch-review, then restored):
//   - provider: drop `childEnv = lockedEnv(childEnv)`       -> "env carries" + "refuses" tests fail
//   - provider: swap `--agent locked` for `--agent plan`    -> argv test + assertLocked refusal fail
//   - dispatch-review.sh: drop the env OPENCODE_CONFIG_CONTENT= prefix -> shell argv/env test fails
//   - provider/dispatch-review: drop the tool-event audit -> the tool_use NDJSON tests fail
//   - dispatch-review: run assert in the operator's raw env (not the spawn prefix) -> exported-OPENCODE_CONFIG test fails
//   - dispatch-review: drop the assert call -> the tampered-copy tests (no --pure / other agent / dirty --dir) fail
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const oc = require('./opencode-containment');

let n = 0;
const ok = (v, m) => { n += 1; assert.ok(v, m); };
const eq = (a, b, m) => { n += 1; assert.deepStrictEqual(a, b, m); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-contain-test-'));
const emptyDir = fs.mkdtempSync(path.join(tmp, 'empty-'));
const good = () => ({
  args: oc.lockedArgs({ model: 'p/m', dir: emptyDir }),
  env: oc.lockedEnv({ PATH: '/bin' }),
});

// ── assertLocked: the canonical shape passes, every deviation is refused ──
eq(oc.assertLocked(good()), null, 'canonical invocation passes');
eq(JSON.parse(oc.CONFIG_JSON), { permission: { '*': 'deny' }, agent: { locked: { mode: 'primary', permission: { '*': 'deny' } } } }, 'canonical config');
{
  const g = good(); delete g.env.OPENCODE_CONFIG_CONTENT;
  ok(/not set/.test(oc.assertLocked(g)), 'no env refused');
}
{
  const g = good(); g.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'allow' } });
  ok(/canonical/.test(oc.assertLocked(g)), 'weakened env refused');
}
{
  const g = good(); g.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'deny' } });
  ok(/canonical/.test(oc.assertLocked(g)), 'global-deny-only env (no locked agent) refused');
}
{
  const g = good(); g.args[g.args.indexOf('--agent') + 1] = 'plan';
  ok(/--agent/.test(oc.assertLocked(g)), '--agent plan refused');
}
{
  const g = good(); g.args = g.args.filter((a) => a !== '--pure');
  ok(/--pure/.test(oc.assertLocked(g)), 'missing --pure refused');
}
{
  const dirty = fs.mkdtempSync(path.join(tmp, 'dirty-')); fs.writeFileSync(path.join(dirty, 'opencode.json'), '{}');
  const g = good(); g.args[g.args.indexOf('--dir') + 1] = dirty;
  ok(/not empty/.test(oc.assertLocked(g)), 'non-empty --dir refused');
}
{
  const g = good(); g.args = g.args.filter((a, i, arr) => a !== '--dir' && arr[i - 1] !== '--dir');
  ok(/--dir/.test(oc.assertLocked(g)), 'missing --dir refused');
}
{
  const g = good(); g.args.push('--agent', 'plan');
  ok(/more than once/.test(oc.assertLocked(g)), 'duplicate --agent refused');
}
{
  const g = good(); g.env.OPENCODE_CONFIG = '/x/opencode.json';
  ok(/unset/.test(oc.assertLocked(g)), 'OPENCODE_CONFIG in env refused');
  eq(oc.lockedEnv({ OPENCODE_CONFIG: 'a', OPENCODE_CONFIG_DIR: 'b', K: 'v' }).OPENCODE_CONFIG, undefined, 'lockedEnv drops OPENCODE_CONFIG');
  eq(oc.lockedEnv({ OPENCODE_CONFIG_DIR: 'b' }).OPENCODE_CONFIG_DIR, undefined, 'lockedEnv drops OPENCODE_CONFIG_DIR');
}
{
  const repo = fs.mkdtempSync(path.join(tmp, 'repo-')); fs.mkdirSync(path.join(repo, '.git'));
  const inner = path.join(repo, 'sub'); fs.mkdirSync(inner);
  const g = good(); g.args[g.args.indexOf('--dir') + 1] = inner;
  ok(/git worktree/.test(oc.assertLocked(g)), '--dir under a git worktree refused');
}
eq(oc.auditEvents('{"type":"text","part":{"text":"x"}}\n{"type":"step_finish"}\n'), [], 'text-only stream passes the audit');
ok(oc.auditEvents('{"type":"tool_use","part":{"tool":"bash","state":{"status":"completed"}}}\n')[0].includes('bash:completed'), 'tool_use completed is a breach');
ok(oc.auditEvents('{"type":"tool_use","part":{"tool":"read","state":{"status":"error"}}}\n').length === 1, 'even a denied/errored tool_use is reported');
// the CLI assert + audit subcommands
{
  const cli = (args, env) => spawnSync(process.execPath, [path.join(__dirname, 'opencode-containment.js'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  eq(cli(['assert', ...good().args], { OPENCODE_CONFIG_CONTENT: oc.CONFIG_JSON }).status, 0, 'CLI assert passes the locked shape');
  eq(cli(['assert', ...good().args], {}).status, 1, 'CLI assert refuses when env is missing');
  const f = path.join(tmp, 'tool.ndjson'); fs.writeFileSync(f, '{"type":"tool_use","part":{"tool":"bash"}}\n');
  eq(cli(['audit', f], {}).status, 1, 'CLI audit refuses a tool event');
}
eq(oc.extractText('{"type":"step"}\nnot json\n{"type":"text","part":{"text":"a"}}\n{"type":"text","part":{"text":"b"}}\n'), 'b', 'last text event wins');

// ── provider end-to-end with a stub opencode ──
const stub = path.join(tmp, 'stub-opencode');
fs.writeFileSync(stub, `#!/usr/bin/env node
const fs = require('fs');
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({
  argv: process.argv.slice(2), env: process.env, stdin, cwd: process.cwd(),
  dirEntries: fs.readdirSync(process.argv[process.argv.indexOf('--dir') + 1]),
  configDirEntries: fs.existsSync(process.env.XDG_CONFIG_HOME) ? fs.readdirSync(process.env.XDG_CONFIG_HOME) : null,
  auth: fs.existsSync(process.env.XDG_DATA_HOME + '/opencode/auth.json') ? fs.readFileSync(process.env.XDG_DATA_HOME + '/opencode/auth.json', 'utf8') : null,
}));
if (process.env.STUB_TOOL) process.stdout.write(JSON.stringify({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed' } } }) + '\\n');
const out = JSON.stringify({ verdict: 'pass', findings: [] });
process.stdout.write(JSON.stringify({ type: 'step_start' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'text', part: { text: out } }) + '\\n');
`, { mode: 0o755 });

fs.mkdirSync(path.join(tmp, '.local', 'share', 'opencode'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.local', 'share', 'opencode', 'auth.json'), 'SECRET-AUTH');
fs.mkdirSync(path.join(tmp, '.config', 'opencode', 'agent'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.config', 'opencode', 'agent', 'locked.md'), '---\npermission: allow\n---\n');
const PROVIDER = path.join(__dirname, '..', 'qualification-review-provider.js');
function runProvider(extraEnv) {
  const capture = path.join(tmp, `cap-${Math.random().toString(36).slice(2)}.json`);
  const child = spawnSync(process.execPath, [PROVIDER], {
    input: `${JSON.stringify({ schema_version: 1, request_id: 'r', role: 'reviewer', payload: { format: 'unified_diff', content: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' } })}\n`,
    encoding: 'utf8', timeout: 30000,
    env: {
      PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, QRP_PROVIDER: 'oc', QRP_MODEL: 'opencode-go/x',
      QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'opencode', QRP_CLI_BIN: stub, STUB_CAPTURE: capture,
      // hostile ambient values must be overridden, not inherited
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: 'allow' }),
      OPENCODE_CONFIG: '/ambient/opencode.json', OPENCODE_CONFIG_DIR: '/ambient/dir',
      ...extraEnv,
    },
  });
  let captured = null;
  try { captured = JSON.parse(fs.readFileSync(capture, 'utf8')); } catch { /* not spawned */ }
  return { child, captured };
}
{
  const { child, captured } = runProvider({ QRP_CLI_EFFORT: 'max' });
  eq(child.status, 0, `provider run with stub opencode succeeds (stderr: ${child.stderr})`);
  ok(captured, 'stub opencode was spawned');
  eq(JSON.parse(captured.env.OPENCODE_CONFIG_CONTENT), oc.CONFIG, 'stub received the canonical deny-all env (ambient allow overridden)');
  const a = captured.argv;
  eq(a[0], 'run', 'opencode run');
  eq(a[a.indexOf('--agent') + 1], 'locked', '--agent locked');
  ok(a.includes('--pure'), '--pure present');
  eq(a[a.indexOf('--variant') + 1], 'xhigh', 'max clamps to xhigh');
  eq(a[a.indexOf('-m') + 1], 'opencode-go/x', 'model verbatim');
  const dir = a[a.indexOf('--dir') + 1];
  eq(captured.dirEntries, [], '--dir was an EMPTY directory when opencode started');
  eq(path.basename(captured.cwd), path.basename(dir), 'cwd is the same empty scratch dir');
  ok(!fs.existsSync(dir), 'scratch dir removed after the run');
  ok(captured.stdin.includes('precision code reviewer'), 'prompt travels on stdin');
  eq(captured.env.OPENCODE_CONFIG, undefined, 'ambient OPENCODE_CONFIG removed');
  eq(captured.env.OPENCODE_CONFIG_DIR, undefined, 'ambient OPENCODE_CONFIG_DIR removed');
  ok(captured.env.HOME !== tmp && captured.env.HOME.startsWith(os.tmpdir()), 'seat runs under a temp HOME, not the ambient one');
  eq(captured.configDirEntries, [], 'XDG_CONFIG_HOME is empty (no ~/.config/opencode agents/MCP/plugins)');
  eq(captured.auth, 'SECRET-AUTH', 'only auth.json was carried over');
  ok(!a.some((x) => String(x).includes('precision code reviewer')), 'prompt not on argv');
}

// provider: a tool_use event voids the case even though the stub exits 0 with a text answer
{
  const { child } = runProvider({ STUB_TOOL: '1' });
  ok(child.status !== 0, 'tool_use in the NDJSON: provider case fails (not a clean answer)');
  ok(/containment breach/.test(child.stderr + child.stdout), 'provider names the containment breach');
}

// ── dispatch-review.sh opencode branch passes the same env + argv ──
{
  const argvFile = path.join(tmp, 'sh-argv');
  const shStub = path.join(tmp, 'sh-stub-opencode');
  fs.writeFileSync(shStub, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${argvFile}"
printf '%s' "\${OPENCODE_CONFIG_CONTENT:-UNSET}" > "${argvFile}.env"
pwd > "${argvFile}.cwd"
ls -A "$(pwd)" > "${argvFile}.ls"
cat >/dev/null
printf '%s\\n' '{"type":"text","part":{"text":"VERDICT: SHIP-AS-IS\\n"}}'
`, { mode: 0o755 });
  const diff = path.join(tmp, 'd.diff');
  fs.writeFileSync(diff, 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
  spawnSync('bash', [path.join(__dirname, '..', 'dispatch-review.sh'), '--runner', 'opencode',
    '--model', 'opencode-go/x', '--diff-file', diff, '--bin', shStub], { encoding: 'utf8', timeout: 60000, env: { ...process.env, TMPDIR: tmp } });
  const argv = fs.readFileSync(argvFile, 'utf8').split('\n');
  eq(argv[argv.indexOf('--agent') + 1], 'locked', 'dispatch-review: --agent locked');
  ok(argv.includes('--pure'), 'dispatch-review: --pure');
  eq(JSON.parse(fs.readFileSync(`${argvFile}.env`, 'utf8')), oc.CONFIG, 'dispatch-review: canonical env');
  eq(fs.readFileSync(`${argvFile}.ls`, 'utf8'), '', 'dispatch-review: scratch cwd empty');
  eq(argv[argv.indexOf('--dir') + 1], fs.readFileSync(`${argvFile}.cwd`, 'utf8').trim(), 'dispatch-review: --dir is the cwd');
}

// dispatch-review with OPENCODE_CONFIG / OPENCODE_CONFIG_DIR exported by the operator: the review
// must still run (assert sees the stripped env) and the spawned opencode must not receive them.
{
  const envStub = path.join(tmp, 'sh-env-opencode');
  const envOut = path.join(tmp, 'sh-env-out');
  fs.writeFileSync(envStub, `#!/usr/bin/env bash
printf 'C=%s|D=%s\\n' "\${OPENCODE_CONFIG-UNSET}" "\${OPENCODE_CONFIG_DIR-UNSET}" > "${envOut}"
cat >/dev/null
printf '%s\\n' '{"type":"text","part":{"text":"VERDICT: SHIP-AS-IS\\n"}}'
`, { mode: 0o755 });
  const d3 = path.join(tmp, 'd3.diff');
  fs.writeFileSync(d3, 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
  const r = spawnSync('bash', [path.join(__dirname, '..', 'dispatch-review.sh'), '--runner', 'opencode', '--model', 'opencode-go/x', '--diff-file', d3, '--bin', envStub], { encoding: 'utf8', timeout: 60000, env: { ...process.env, TMPDIR: tmp, OPENCODE_CONFIG: '/somewhere/opencode.json', OPENCODE_CONFIG_DIR: '/somewhere/dir' } });
  ok(!/precondition_failed/.test(r.stdout), `exported OPENCODE_CONFIG does not fail the review (${r.stdout.slice(0, 160)})`);
  eq(fs.readFileSync(envOut, 'utf8').trim(), 'C=UNSET|D=UNSET', 'spawned opencode env has neither OPENCODE_CONFIG nor OPENCODE_CONFIG_DIR');
}

// dispatch-review: tool_use event -> no_verdict naming the breach (answer discarded)
const SCRIPTS = path.join(__dirname, '..');
{
  const toolStub = path.join(tmp, 'sh-tool-opencode');
  fs.writeFileSync(toolStub, `#!/usr/bin/env bash
cat >/dev/null
printf '%s\\n' '{"type":"tool_use","part":{"tool":"bash","state":{"status":"completed"}}}'
printf '%s\\n' '{"type":"text","part":{"text":"VERDICT: SHIP-AS-IS\\n"}}'
`, { mode: 0o755 });
  const diff = path.join(tmp, 'd2.diff');
  fs.writeFileSync(diff, 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
  const r = spawnSync('bash', [path.join(SCRIPTS, 'dispatch-review.sh'), '--runner', 'opencode', '--model', 'opencode-go/x', '--diff-file', diff, '--bin', toolStub], { encoding: 'utf8', timeout: 60000, env: { ...process.env, TMPDIR: tmp } });
  ok(/"status": "no_verdict"/.test(r.stdout) && /containment breach/.test(r.stdout), 'dispatch-review: tool_use -> no_verdict with containment breach');
  ok(!/SHIP-AS-IS/.test(r.stdout.replace(/containment[^\n]*/g, '')), 'dispatch-review: no verdict salvaged from a breached run');

  // tampered copies of the script/lib: assert must refuse BEFORE spawn (precondition_failed, binary never run)
  function tampered(name, edit) {
    const root = fs.mkdtempSync(path.join(tmp, 'tamper-'));
    const sdir = path.join(root, 'scripts'); fs.mkdirSync(path.join(sdir, 'lib'), { recursive: true });
    for (const e of fs.readdirSync(SCRIPTS)) if (e !== 'lib' && e !== 'dispatch-review.sh') fs.symlinkSync(path.join(SCRIPTS, e), path.join(sdir, e));
    for (const e of fs.readdirSync(path.join(SCRIPTS, 'lib'))) fs.symlinkSync(path.join(SCRIPTS, 'lib', e), path.join(sdir, 'lib', e));
    let sh = fs.readFileSync(path.join(SCRIPTS, 'dispatch-review.sh'), 'utf8');
    edit({ sh: (f) => { sh = f(sh); }, lib: (f) => { const l = path.join(sdir, 'lib', 'opencode-containment.js'); fs.rmSync(l); fs.writeFileSync(l, f(fs.readFileSync(path.join(SCRIPTS, 'lib', 'opencode-containment.js'), 'utf8'))); } });
    fs.writeFileSync(path.join(sdir, 'dispatch-review.sh'), sh, { mode: 0o755 });
    const ran = path.join(root, 'binary-ran');
    const bin = path.join(root, 'bin'); fs.writeFileSync(bin, `#!/usr/bin/env bash\ntouch "${ran}"\ncat >/dev/null\n`, { mode: 0o755 });
    const out = spawnSync('bash', [path.join(sdir, 'dispatch-review.sh'), '--runner', 'opencode', '--model', 'opencode-go/x', '--diff-file', diff, '--bin', bin], { encoding: 'utf8', timeout: 60000, env: { ...process.env, TMPDIR: tmp } });
    ok(/"status": "precondition_failed"/.test(out.stdout) && /containment verification failed/.test(out.stdout), `dispatch-review refuses: ${name} (${out.stdout.slice(0, 200)})`);
    ok(!fs.existsSync(ran), `opencode never spawned: ${name}`);
  }
  tampered('no --pure', (e) => e.sh((t) => t.replace('OC_ARGS=(run --dir "$OPENCODE_CWD" --pure', 'OC_ARGS=(run --dir "$OPENCODE_CWD"')));
  tampered('other agent', (e) => e.sh((t) => t.replace('--agent locked --variant', '--agent plan --variant')));
  tampered('non-empty --dir', (e) => e.sh((t) => t.replace('  OC_ARGS=(run', '  touch "$OPENCODE_CWD/opencode.json"\n  OC_ARGS=(run')));
}

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`${n} assertions passed\n`);
