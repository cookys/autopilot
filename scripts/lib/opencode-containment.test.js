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
// v2 adaptor (opencode 2.x; spike 2026-10-18). Every v2 property has a negative control, run in-test by
// mutating a COPY of the lib (tampered()) and, for the record, shown red by editing the real lib (see the
// lane report): drop --standalone / drop OPENCODE_DISABLE_PROJECT_CONFIG / allow-config / cwd inside a git
// worktree / HOME = real home / auditEvents tolerating a completed tool event / an unknown major accepted.
// Fixtures scripts/lib/fixtures/opencode-v2/*.ndjson are trimmed REAL v2.0.32 event streams (spike t6/t7/t13).
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
  eq(oc.lockedEnv({ OPENCODE_PERMISSION: '{"*":"allow"}', K: 'v' }).OPENCODE_PERMISSION, undefined, 'lockedEnv drops OPENCODE_PERMISSION');
  eq(oc.lockedEnv({ OPENCODE_CLI_CONFIG_CONTENT: '{}' }).OPENCODE_CLI_CONFIG_CONTENT, undefined, 'lockedEnv drops OPENCODE_CLI_CONFIG_CONTENT');
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
const a = process.argv.slice(2);
if (a[0] === '--version') { process.stdout.write((process.env.STUB_VERSION || '1.19.2') + '\\n'); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'export') { process.stdout.write('{"credential":"SECRET-V2-CRED"}'); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'import') {
  const f = a[a.length - 1];
  fs.mkdirSync(process.env.XDG_DATA_HOME + '/opencode', { recursive: true });
  fs.writeFileSync(process.env.XDG_DATA_HOME + '/opencode/imported.json', fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(process.env.STUB_CAPTURE + '.import', JSON.stringify({ file: f, mode: (fs.statSync(f).mode & 0o777).toString(8), home: process.env.HOME, pwd: process.env.PWD, standalone: a.includes('--standalone') }));
  process.exit(0);
}
const stdin = fs.readFileSync(0, 'utf8');
const dirIdx = a.indexOf('--dir');
fs.writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({
  argv: a, env: process.env, stdin, cwd: process.cwd(),
  cwdEntries: fs.readdirSync(process.cwd()),
  imported: fs.existsSync(process.env.XDG_DATA_HOME + '/opencode/imported.json') ? fs.readFileSync(process.env.XDG_DATA_HOME + '/opencode/imported.json', 'utf8') : null,
  dirEntries: dirIdx >= 0 ? fs.readdirSync(a[dirIdx + 1]) : null,
  configDirEntries: fs.existsSync(process.env.XDG_CONFIG_HOME) ? fs.readdirSync(process.env.XDG_CONFIG_HOME) : null,
  auth: fs.existsSync(process.env.XDG_DATA_HOME + '/opencode/auth.json') ? fs.readFileSync(process.env.XDG_DATA_HOME + '/opencode/auth.json', 'utf8') : null,
}));
if (process.env.STUB_TOOL) process.stdout.write(JSON.stringify({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed' } } }) + '\\n');
if (process.env.STUB_FIXTURE) process.stdout.write(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));
const out = JSON.stringify({ verdict: 'pass', findings: [] });
process.stdout.write(JSON.stringify({ type: 'step_start' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'text', part: { text: out } }) + '\\n');
`, { mode: 0o755 });

fs.mkdirSync(path.join(tmp, '.local', 'share', 'opencode'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.local', 'share', 'opencode', 'auth.json'), 'SECRET-AUTH');
fs.mkdirSync(path.join(tmp, '.config', 'opencode', 'agent'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.config', 'opencode', 'agent', 'locked.md'), '---\npermission: allow\n---\n');
const PROVIDER = path.join(__dirname, '..', 'qualification-review-provider.js');
let lastCapture = null;
function runProvider(extraEnv) {
  const capture = path.join(tmp, `cap-${Math.random().toString(36).slice(2)}.json`);
  const child = spawnSync(process.execPath, [PROVIDER], {
    input: `${JSON.stringify({ schema_version: 1, request_id: 'r', role: 'reviewer', payload: { format: 'case_content', content: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' } })}\n`,
    encoding: 'utf8', timeout: 30000,
    env: {
      PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, PWD: process.cwd(), QRP_PROVIDER: 'oc', QRP_MODEL: 'opencode-go/x',
      QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'opencode', QRP_CLI_BIN: stub, STUB_CAPTURE: capture,
      // hostile ambient values must be overridden, not inherited
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: 'allow' }),
      OPENCODE_CONFIG: '/ambient/opencode.json', OPENCODE_CONFIG_DIR: '/ambient/dir',
      OPENCODE_PERMISSION: '{"*":"allow"}', OPENCODE_CLI_CONFIG_CONTENT: '{"permission":"allow"}',
      ...extraEnv,
    },
  });
  let captured = null;
  lastCapture = capture;
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
  eq(captured.env.OPENCODE_PERMISSION, undefined, 'provider v1: ambient OPENCODE_PERMISSION removed');
  eq(captured.env.OPENCODE_CLI_CONFIG_CONTENT, undefined, 'provider v1: ambient OPENCODE_CLI_CONFIG_CONTENT removed');
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
const SCRIPTS = path.join(__dirname, '..');
const REVIEW = path.join(SCRIPTS, 'dispatch-review.sh');
const diff = path.join(tmp, 'd.diff');
fs.writeFileSync(diff, 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
// A bash stub opencode: answers --version / auth export|import like the real CLI, records what a
// `run` receives, then runs `body` (stdin is consumed by `cat`). VER picks the adaptor.
function bashStub(name, ver, body) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "${ver}"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "export" ]; then printf '{"credential":"SECRET-V2-CRED"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "import" ]; then
  mkdir -p "$XDG_DATA_HOME/opencode"; cp "$4" "$XDG_DATA_HOME/opencode/imported.json"; cp "$4" "${f}.imported"
  printf '%s|%s|%s' "$4" "$(stat -c %a "$4")" "$HOME" > "${f}.import-file"; exit 0; fi
if [ "$1" = "run" ] && [ -f "$XDG_DATA_HOME/opencode/imported.json" ]; then cp "$XDG_DATA_HOME/opencode/imported.json" "${f}.run-saw-cred"; fi
printf '%s\\n' "$@" > "${f}.argv"
printf '%s' "\${OPENCODE_CONFIG_CONTENT:-UNSET}" > "${f}.env"
printf 'C=%s|D=%s|P=%s|H=%s\\n' "\${OPENCODE_CONFIG-UNSET}" "\${OPENCODE_CONFIG_DIR-UNSET}" "\${OPENCODE_DISABLE_PROJECT_CONFIG-UNSET}" "$HOME" > "${f}.envx"
pwd > "${f}.cwd"
ls -A "$(pwd)" > "${f}.ls"
${body}
`, { mode: 0o755 });
  return f;
}
const SHIP = `cat >/dev/null\nprintf '%s\\n' '{"type":"text","part":{"text":"VERDICT: SHIP-AS-IS\\n"}}'`;
// a stub's bare VERDICT line has no BEGIN frame, so the status is no_verdict either way; what these tests
// pin is that the seat RAN (reached the binary) and was not refused or voided by containment
const ranClean = (r, st) => !/precondition_failed|containment breach/.test(r.stdout) && fs.existsSync(`${st}.argv`);
function review(bin, extraEnv, script = REVIEW) {
  return spawnSync('bash', [script, '--runner', 'opencode', '--model', 'opencode-go/x', '--diff-file', diff, '--bin', bin],
    { encoding: 'utf8', timeout: 90000, env: { ...process.env, TMPDIR: tmp, ...extraEnv } });
}
{
  // v1: unchanged shape (--dir / --pure / --variant), same canonical env, scratch cwd empty
  const st = bashStub('sh-stub-v1', '1.19.2', SHIP);
  const r = review(st);
  ok(ranClean(r, st), `dispatch-review v1 ran clean (${r.stdout.slice(0, 200)})`);
  const argv = fs.readFileSync(`${st}.argv`, 'utf8').split('\n');
  eq(argv[argv.indexOf('--agent') + 1], 'locked', 'dispatch-review v1: --agent locked');
  ok(argv.includes('--pure'), 'dispatch-review v1: --pure');
  ok(!argv.includes('--standalone'), 'dispatch-review v1: no --standalone');
  eq(argv[argv.indexOf('--variant') + 1], 'xhigh', 'dispatch-review v1: default effort xhigh');
  eq(JSON.parse(fs.readFileSync(`${st}.env`, 'utf8')), oc.CONFIG, 'dispatch-review v1: canonical env');
  eq(fs.readFileSync(`${st}.ls`, 'utf8'), '', 'dispatch-review v1: scratch cwd empty');
  eq(argv[argv.indexOf('--dir') + 1], fs.readFileSync(`${st}.cwd`, 'utf8').trim(), 'dispatch-review v1: --dir is the cwd');
  ok(/P=UNSET/.test(fs.readFileSync(`${st}.envx`, 'utf8')), 'dispatch-review v1: no OPENCODE_DISABLE_PROJECT_CONFIG (v1 does not need it)');
}
{
  // v2: --standalone, model#variant, no --dir/--pure/--variant, v2-native config, project config off,
  // clean home with imported credentials, the export file gone afterwards
  const st = bashStub('sh-stub-v2', 'v2.0.32', SHIP);
  const r = review(st, { OPENCODE_CONFIG: '/somewhere/opencode.json', OPENCODE_CONFIG_DIR: '/somewhere/dir' });
  ok(ranClean(r, st), `dispatch-review v2 ran clean (${r.stdout.slice(0, 200)})`);
  const argv = fs.readFileSync(`${st}.argv`, 'utf8').split('\n').filter(Boolean);
  eq(argv, ['run', '--standalone', '-m', 'opencode-go/x#xhigh', '--agent', 'locked', '--format', 'json'], 'dispatch-review v2: exact argv');
  eq(JSON.parse(fs.readFileSync(`${st}.env`, 'utf8')), oc.CONFIG_V2, 'dispatch-review v2: canonical v2 env');
  const envx = fs.readFileSync(`${st}.envx`, 'utf8').trim();
  ok(/^C=UNSET\|D=UNSET\|P=1\|H=/.test(envx), `dispatch-review v2: config vars stripped, project config disabled (${envx})`);
  ok(!envx.endsWith(`H=${process.env.HOME}`), 'dispatch-review v2: HOME is not the real home');
  eq(fs.readFileSync(`${st}.ls`, 'utf8'), '', 'dispatch-review v2: cwd empty');
  const [impFile, impMode, impHome] = fs.readFileSync(`${st}.import-file`, 'utf8').split('|');
  eq(impMode, '600', 'dispatch-review v2: credential export file is 0600 while it exists');
  ok(!fs.existsSync(impFile), 'dispatch-review v2: credential export file deleted after the call');
  eq(fs.readFileSync(`${st}.run-saw-cred`, 'utf8'), '{"credential":"SECRET-V2-CRED"}', 'dispatch-review v2: run sees the imported credential in the clean home');
  ok(impHome === envx.split('|H=')[1], 'dispatch-review v2: auth import ran under the clean home');
  ok(!fs.existsSync(impHome), 'dispatch-review v2: clean home removed after the call');
  const stb = bashStub('sh-stub-v2b', '2.0.32', SHIP); const bare = review(stb);
  ok(ranClean(bare, stb), 'dispatch-review v2: bare `2.0.32` version line is recognised');
}
{
  // unknown major / garbage version: refuse BEFORE any run (binary never runs `run`)
  for (const ver of ['3.0.1', '0.9.0', 'garbage']) {
    const st = bashStub(`sh-stub-ver-${ver}`, ver, SHIP);
    const r = review(st);
    ok(/"status": "precondition_failed"/.test(r.stdout) && /unsupported opencode version/.test(r.stdout), `dispatch-review refuses version ${ver} (${r.stdout.slice(0, 160)})`);
    ok(!fs.existsSync(`${st}.argv`), `opencode never ran for version ${ver}`);
  }
}
{
  // the --version runs exactly once per call
  const st = bashStub('sh-stub-count', '2.0.32', SHIP);
  fs.writeFileSync(st, fs.readFileSync(st, 'utf8').replace('if [ "$1" = "--version" ];', `if [ "$1" = "--version" ]; then echo x >> "${st}.vcount"; fi\nif [ "$1" = "--version" ];`));
  review(st);
  eq(fs.readFileSync(`${st}.vcount`, 'utf8').trim().split('\n').length, 1, '--version ran once in a dispatch-review call');
}

// dispatch-review with OPENCODE_CONFIG / OPENCODE_CONFIG_DIR exported by the operator (v1): the review
// must still run (assert sees the stripped env) and the spawned opencode must not receive them.
{
  const st = bashStub('sh-env-v1', '1.19.2', SHIP);
  const r = review(st, { OPENCODE_CONFIG: '/somewhere/opencode.json', OPENCODE_CONFIG_DIR: '/somewhere/dir' });
  ok(!/precondition_failed/.test(r.stdout), `exported OPENCODE_CONFIG does not fail the review (${r.stdout.slice(0, 160)})`);
  ok(/^C=UNSET\|D=UNSET\|/.test(fs.readFileSync(`${st}.envx`, 'utf8')), 'spawned opencode env has neither OPENCODE_CONFIG nor OPENCODE_CONFIG_DIR');
}

// dispatch-review: tool_use event -> no_verdict naming the breach (answer discarded); v2 audit rules
const TOOL_STREAM = (ev) => `cat >/dev/null\nprintf '%s\\n' '${ev}'\nprintf '%s\\n' '{"type":"text","part":{"text":"VERDICT: SHIP-AS-IS\\n"}}'`;
{
  const completed = '{"type":"tool_use","part":{"tool":"bash","state":{"status":"completed"}}}';
  for (const ver of ['1.19.2', '2.0.32']) {
    const r = review(bashStub(`sh-tool-${ver}`, ver, TOOL_STREAM(completed)));
    ok(/"status": "no_verdict"/.test(r.stdout) && /containment breach/.test(r.stdout), `dispatch-review ${ver}: completed tool_use -> no_verdict with containment breach`);
    ok(!/SHIP-AS-IS/.test(r.stdout.replace(/containment[^\n]*/g, '')), `dispatch-review ${ver}: no verdict salvaged from a breached run`);
  }
  // v2 only: a hallucinated call to a tool that does not exist (nothing ran) is let through
  const halluc = '{"type":"tool_use","part":{"tool":"read","state":{"status":"error","error":"No tool named \\"read\\" is currently available. Please use a tool from the available tool list.","metadata":{"providerResult":{"executed":false}}}}}';
  const sth = bashStub('sh-halluc-v2', '2.0.32', TOOL_STREAM(halluc)); const ok2 = review(sth);
  ok(ranClean(ok2, sth), `dispatch-review v2: unavailable-tool error is not a breach (${ok2.stdout.slice(0, 160)})`);
  const bad1 = review(bashStub('sh-halluc-v1', '1.19.2', TOOL_STREAM(halluc)));
  ok(/"status": "no_verdict"/.test(bad1.stdout), 'dispatch-review v1: the same event is still a breach (v1 audit is strict)');
}

// ── v2 audit on the REAL event streams (spike t6 / t7 / t13) ──
const FX = path.join(__dirname, 'fixtures', 'opencode-v2');
const OCJS = path.join(__dirname, 'opencode-containment.js');
{
  const fx = (n) => fs.readFileSync(path.join(FX, n), 'utf8');
  eq(oc.auditEvents(fx('t6-locked-deny.ndjson'), 'v2'), [], 't6 (locked, nothing ran): clean');
  eq(oc.auditEvents(fx('t13-unavailable-tool-errors.ndjson'), 'v2'), [], 't13 (hallucinated tools, all "No tool named"): clean under v2');
  eq(oc.auditEvents(fx('t13-unavailable-tool-errors.ndjson'), 'v1').length, 3, 't13 under the v1 audit is still 3 breaches');
  eq(oc.auditEvents(fx('t7-allow-tools-completed.ndjson'), 'v2'), ['tool event read:completed', 'tool event shell:completed'], 't7 (open agent, tools ran): both completed events are breaches');
  const mk = (st) => `${JSON.stringify({ type: 'tool_use', part: { tool: 'shell', state: st } })}\n`;
  eq(oc.auditEvents(mk({ status: 'running' }), 'v2').length, 1, 'running tool event is a breach');
  eq(oc.auditEvents(mk({ status: 'error', error: 'permission denied by rule' }), 'v2').length, 1, 'any other error status is a breach');
  eq(oc.auditEvents(mk({ status: 'error', error: 'No tool named "x" is currently available', metadata: { providerResult: { executed: true } } }), 'v2').length, 1, 'unavailable-tool text but executed:true is a breach');
  eq(oc.auditEvents(mk({ status: 'completed', error: 'No tool named "x" is currently available' }), 'v2').length, 1, 'completed + unavailable-tool text is a breach');
  const cli = (args) => spawnSync(process.execPath, [OCJS, ...args], { encoding: 'utf8' });
  eq(cli(['audit', path.join(FX, 't13-unavailable-tool-errors.ndjson'), 'v2']).status, 0, 'CLI audit v2 passes t13');
  eq(cli(['audit', path.join(FX, 't7-allow-tools-completed.ndjson'), 'v2']).status, 1, 'CLI audit v2 refuses t7');
}

// ── v2 assertLockedV2: every deviation refused ──
{
  const root = fs.mkdtempSync(path.join(tmp, 'v2root-')); const work = path.join(root, 'work'); fs.mkdirSync(work);
  const home = path.join(root, 'home');
  const h = { HOME: home, XDG_CONFIG_HOME: `${home}/.config`, XDG_DATA_HOME: `${home}/.local/share`, XDG_STATE_HOME: `${home}/.local/state`, XDG_CACHE_HOME: `${home}/.cache` };
  const good2 = () => ({ args: oc.lockedArgsV2({ model: 'p/m', variant: 'high' }), env: { ...h, PWD: work, OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_CONFIG_CONTENT: oc.CONFIG_V2_JSON }, cwd: work, realHome: '/home/someone' });
  eq(oc.assertLockedV2(good2()), null, 'canonical v2 invocation passes');
  eq(good2().args, ['run', '--standalone', '-m', 'p/m#high', '--agent', 'locked', '--format', 'json'], 'v2 argv shape');
  const refuse = (name, mut, re) => { const g = good2(); mut(g); const b = oc.assertLockedV2(g); ok(b && re.test(b), `v2 refuses: ${name} (${b})`); };
  const allow = [{ action: '*', resource: '*', effect: 'allow' }];
  refuse('no --standalone', (g) => { g.args = g.args.filter((a) => a !== '--standalone'); }, /--standalone is missing/);
  refuse('no OPENCODE_DISABLE_PROJECT_CONFIG', (g) => { delete g.env.OPENCODE_DISABLE_PROJECT_CONFIG; }, /DISABLE_PROJECT_CONFIG/);
  refuse('DISABLE_PROJECT_CONFIG=0', (g) => { g.env.OPENCODE_DISABLE_PROJECT_CONFIG = '0'; }, /DISABLE_PROJECT_CONFIG/);
  refuse('allow config', (g) => { g.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permissions: allow, agents: { locked: { mode: 'primary', permissions: allow } } }); }, /canonical v2/);
  refuse('v1-shaped config', (g) => { g.env.OPENCODE_CONFIG_CONTENT = oc.CONFIG_JSON; }, /canonical v2/);
  refuse('global deny only (no locked agent)', (g) => { g.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permissions: oc.CONFIG_V2.permissions }); }, /canonical v2/);
  refuse('other agent', (g) => { g.args[g.args.indexOf('--agent') + 1] = 'plan'; }, /--agent is not locked/);
  refuse('legacy --dir', (g) => { g.args.push('--dir', work); }, /--dir must not/);
  refuse('legacy --pure', (g) => { g.args.push('--pure'); }, /--pure must not/);
  refuse('--auto', (g) => { g.args.push('--auto'); }, /--auto must not/);
  refuse('--server', (g) => { g.args.push('--server', 'http://x'); }, /--server must not/);
  refuse('PWD points at another directory (the caller\'s cwd)', (g) => { g.env.PWD = process.cwd(); }, /PWD is not the empty cwd/);
  refuse('PWD unset', (g) => { delete g.env.PWD; }, /PWD is not the empty cwd/);
  refuse('OPENCODE_CONFIG set', (g) => { g.env.OPENCODE_CONFIG = '/x'; }, /unset/);
  refuse('OPENCODE_PERMISSION set', (g) => { g.env.OPENCODE_PERMISSION = '{"*":"allow"}'; }, /OPENCODE_PERMISSION must be unset/);
  refuse('cwd inside a git worktree', (g) => { const r = fs.mkdtempSync(path.join(tmp, 'wt-')); fs.mkdirSync(path.join(r, '.git')); g.cwd = path.join(r, 'sub'); fs.mkdirSync(g.cwd); g.env.PWD = g.cwd; }, /git worktree/);
  refuse('HOME is the real home', (g) => { g.realHome = home; }, /real home/);
  refuse('HOME unset', (g) => { delete g.env.HOME; }, /HOME is not set/);
  refuse('XDG_CONFIG_HOME outside the clean home', (g) => { g.env.XDG_CONFIG_HOME = '/tmp/elsewhere'; }, /not inside the clean HOME/);
  refuse('XDG_DATA_HOME is the real data dir (HOME is a real-home child)', (g) => { g.realHome = root; g.env.XDG_DATA_HOME = path.join(root, '.local/share'); g.env.HOME = root; }, /real|inside the clean/);
  refuse('non-empty cwd', () => { fs.writeFileSync(path.join(work, 'f'), 'x'); }, /not empty/);
}

// ── detectAdaptor ──
{
  eq(oc.detectAdaptor('x', { versionString: 'v2.0.32\n' }).adaptor, 'v2', 'v2.0.32 -> v2');
  eq(oc.detectAdaptor('x', { versionString: '1.19.2' }).adaptor, 'v1', '1.19.2 -> v1');
  for (const bad of ['3.0.0', '0.1.0', 'dev', 'v10.0.0']) {
    let msg = null; try { oc.detectAdaptor('x', { versionString: bad }); } catch (e) { msg = e.message; }
    ok(msg && /unsupported opencode version/.test(msg), `unknown version "${bad}" refused (fail closed)`);
  }
  let msg = null; try { oc.detectAdaptor('/nonexistent/opencode-bin'); } catch (e) { msg = e.message; }
  ok(msg && /--version failed/.test(msg), 'unrunnable binary refused');
}

// ── plan CLI: NUL hand-off files ──
{
  const st = bashStub('plan-stub', '2.0.32', SHIP);
  const root = fs.mkdtempSync(path.join(tmp, 'plan-root-')); const out = path.join(root, 'plan');
  const nul = (d, f) => fs.readFileSync(path.join(d, f), 'utf8').split('\0').slice(0, -1);
  const cli = (args) => spawnSync(process.execPath, [OCJS, ...args], { encoding: 'utf8' });
  const r = cli(['plan', '--bin', st, '--model', 'p/m', '--effort', 'max', '--profile', 'review', '--root', root, '--out', out]);
  eq(r.status, 0, `plan CLI succeeds (${r.stderr})`);
  eq(nul(out, 'argv.nul'), ['run', '--standalone', '-m', 'p/m#xhigh', '--agent', 'locked', '--format', 'json'], 'argv.nul is NUL separated, max -> xhigh');
  eq(fs.readFileSync(path.join(out, 'adaptor'), 'utf8'), 'v2', 'adaptor file');
  eq(cli(['assert-plan', out]).status, 0, 'assert-plan passes the written plan');
  ok(!fs.existsSync(path.join(root, 'auth-export.json')), 'plan leaves no auth export file behind');
  fs.writeFileSync(path.join(root, 'work', 'junk'), 'x');
  eq(cli(['assert-plan', out]).status, 1, 'assert-plan refuses once the cwd is dirty');
  const bad = cli(['plan', '--bin', bashStub('plan-stub-3', '3.1.0', SHIP), '--model', 'p/m', '--profile', 'review', '--root', root, '--out', path.join(root, 'plan3')]);
  ok(bad.status === 1 && /unsupported opencode version/.test(bad.stderr), 'plan CLI refuses an unknown major');
  // implement profile: v2 = no containment env, model#variant; v1 = unchanged --dir/--pure/--variant
  const i2 = path.join(root, 'impl');
  cli(['plan', '--bin', st, '--model', 'p/m', '--effort', 'max', '--profile', 'implement', '--cwd', '/wt', '--version-string', 'v2.0.32', '--out', i2]);
  eq(nul(i2, 'argv.nul'), ['run', '--standalone', '-m', 'p/m#xhigh', '--format', 'json'], 'implement v2 argv');
  eq(nul(i2, 'env.nul'), ['PWD=/wt'], 'implement v2 env delta is only PWD (opencode 2.x works in $PWD)');
  const i1 = path.join(root, 'impl1');
  cli(['plan', '--bin', st, '--model', 'p/m', '--effort', 'high', '--profile', 'implement', '--cwd', '/wt', '--version-string', '1.19.2', '--out', i1]);
  eq(nul(i1, 'argv.nul'), ['run', '--dir', '/wt', '--pure', '-m', 'p/m', '--variant', 'high', '--format', 'json'], 'implement v1 argv unchanged');
  // effort `default` = send no variant at all (providers with no effort tier); never `#default` / `--variant default`
  const d2 = path.join(root, 'impl-default2');
  cli(['plan', '--bin', st, '--model', 'p/m', '--effort', 'default', '--profile', 'implement', '--cwd', '/wt', '--version-string', 'v2.0.32', '--out', d2]);
  eq(nul(d2, 'argv.nul'), ['run', '--standalone', '-m', 'p/m', '--format', 'json'], 'implement v2 default effort: bare model, no #variant');
  const d1 = path.join(root, 'impl-default1');
  cli(['plan', '--bin', st, '--model', 'p/m', '--effort', 'default', '--profile', 'implement', '--cwd', '/wt', '--version-string', '1.19.2', '--out', d1]);
  eq(nul(d1, 'argv.nul'), ['run', '--dir', '/wt', '--pure', '-m', 'p/m', '--format', 'json'], 'implement v1 default effort: no --variant');
  const p1 = path.join(root, 'probe1');
  cli(['plan', '--bin', st, '--model', 'p/m', '--effort', 'max', '--profile', 'probe', '--cwd', '/pc', '--version-string', '1.19.2', '--out', p1]);
  eq(nul(p1, 'argv.nul'), ['run', '--dir', '/pc', '--pure', '-m', 'p/m', '--agent', 'plan', '--variant', 'xhigh'], 'probe v1 argv unchanged');
}

// ── provider end-to-end, v2 adaptor ──
{
  const { child, captured } = runProvider({ QRP_CLI_EFFORT: 'max', STUB_VERSION: 'v2.0.32' });
  eq(child.status, 0, `provider v2 run with stub succeeds (stderr: ${child.stderr})`);
  ok(captured, 'v2 stub was spawned');
  eq(captured.argv, ['run', '--standalone', '-m', 'opencode-go/x#xhigh', '--agent', 'locked', '--format', 'json'], 'provider v2 argv');
  eq(JSON.parse(captured.env.OPENCODE_CONFIG_CONTENT), oc.CONFIG_V2, 'provider v2: canonical v2 env (ambient allow overridden)');
  eq(captured.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1', 'provider v2: project config disabled');
  eq(captured.env.OPENCODE_CONFIG, undefined, 'provider v2: ambient OPENCODE_CONFIG removed');
  eq(captured.env.OPENCODE_PERMISSION, undefined, 'provider v2: ambient OPENCODE_PERMISSION removed');
  eq(captured.env.OPENCODE_CLI_CONFIG_CONTENT, undefined, 'provider v2: ambient OPENCODE_CLI_CONFIG_CONTENT removed');
  eq(captured.cwdEntries, [], 'provider v2: cwd empty');
  eq(captured.env.PWD, captured.cwd, 'provider v2: PWD is the empty cwd (v2 resolves its project dir from $PWD)');
  ok(captured.env.HOME !== tmp && captured.env.HOME.startsWith(os.tmpdir()), 'provider v2: clean temp HOME');
  eq(captured.imported, '{"credential":"SECRET-V2-CRED"}', 'provider v2: credential imported into the clean home');
  ok(!fs.existsSync(captured.cwd), 'provider v2: scratch root removed');
  const impInfo = JSON.parse(fs.readFileSync(`${lastCapture}.import`, 'utf8'));
  eq(impInfo.pwd, captured.env.PWD, 'provider v2: auth import ran with PWD = the empty work dir, not the caller repo');
  ok(impInfo.pwd !== process.cwd(), 'provider v2: auth import PWD is not the dispatcher cwd');
}
{
  const t13 = runProvider({ STUB_VERSION: '2.0.32', STUB_FIXTURE: path.join(FX, 't13-unavailable-tool-errors.ndjson') });
  eq(t13.child.status, 0, `provider v2 passes the real t13 stream (hallucinated tools) (${t13.child.stderr})`);
  const t7 = runProvider({ STUB_VERSION: '2.0.32', STUB_FIXTURE: path.join(FX, 't7-allow-tools-completed.ndjson') });
  ok(t7.child.status !== 0 && /containment breach/.test(t7.child.stderr + t7.child.stdout), 'provider v2 voids the real t7 stream (tools completed)');
  const unk = runProvider({ STUB_VERSION: '4.0.0' });
  ok(unk.child.status !== 0 && /unsupported opencode version/.test(unk.child.stderr + unk.child.stdout), 'provider refuses an unknown major');
  ok(!unk.captured, 'provider never ran opencode for an unknown major');
}

// tampered copies of the lib: dispatch-review must refuse BEFORE spawn (precondition_failed, `run`
// never reached). The plan is BUILT by one function and VERIFIED by another, so a drifted builder
// fails the verifier.
{
  function tamperedReview(ver, edit, body = SHIP) {
    const root = fs.mkdtempSync(path.join(tmp, 'tamper-'));
    const sdir = path.join(root, 'scripts'); fs.mkdirSync(path.join(sdir, 'lib'), { recursive: true });
    for (const e of fs.readdirSync(SCRIPTS)) if (e !== 'lib' && e !== 'dispatch-review.sh') fs.symlinkSync(path.join(SCRIPTS, e), path.join(sdir, e));
    for (const e of fs.readdirSync(path.join(SCRIPTS, 'lib'))) fs.symlinkSync(path.join(SCRIPTS, 'lib', e), path.join(sdir, 'lib', e));
    fs.copyFileSync(REVIEW, path.join(sdir, 'dispatch-review.sh')); fs.chmodSync(path.join(sdir, 'dispatch-review.sh'), 0o755);
    const l = path.join(sdir, 'lib', 'opencode-containment.js');
    const src = fs.readFileSync(path.join(SCRIPTS, 'lib', 'opencode-containment.js'), 'utf8');
    const out = edit(src); if (out === src) throw new Error('tamper did not change the lib');
    fs.rmSync(l); fs.writeFileSync(l, out);
    const st = bashStub(`tamper-bin-${Math.random().toString(36).slice(2)}`, ver, body);
    return { r: review(st, {}, path.join(sdir, 'dispatch-review.sh')), ran: fs.existsSync(`${st}.argv`) };
  }
  const refuses = (name, ver, edit) => {
    const { r, ran } = tamperedReview(ver, edit);
    ok(/"status": "precondition_failed"/.test(r.stdout) && /containment verification failed/.test(r.stdout), `dispatch-review refuses: ${name} (${r.stdout.slice(0, 220)})`);
    ok(!ran, `opencode never spawned: ${name}`);
  };
  refuses('v1 no --pure', '1.19.2', (t) => t.replace("['run', '--dir', dir, '--pure', '-m', model, '--agent', AGENT_NAME]", "['run', '--dir', dir, '-m', model, '--agent', AGENT_NAME]"));
  refuses('v1 other agent', '1.19.2', (t) => t.replace("'-m', model, '--agent', AGENT_NAME];\n  if (variant)", "'-m', model, '--agent', 'plan'];\n  if (variant)"));
  refuses('v2 builder drops --standalone', '2.0.32', (t) => t.replace("return ['run', '--standalone', '-m', variant", "return ['run', '-m', variant"));
  refuses('v2 builder drops OPENCODE_DISABLE_PROJECT_CONFIG', '2.0.32', (t) => t.replace("OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_CONFIG_CONTENT: CONFIG_V2_JSON", 'OPENCODE_CONFIG_CONTENT: CONFIG_V2_JSON'));
  refuses('v2 builder ships an allow config', '2.0.32', (t) => t.replace('OPENCODE_CONFIG_CONTENT: CONFIG_V2_JSON }', "OPENCODE_CONFIG_CONTENT: CONFIG_V2_JSON.replace(/deny/g, 'allow') }"));
  refuses('v2 builder leaves PWD at the caller directory', '2.0.32', (t) => t.replace('set: { ...home, PWD: work,', 'set: { ...home,'));
  refuses('v2 builder leaves a file in the cwd', '2.0.32', (t) => t.replace('  plan.args = lockedArgsV2({ model, variant });', "  fs.writeFileSync(path.join(work, 'opencode.json'), '{}');\n  plan.args = lockedArgsV2({ model, variant });"));
  refuses('v2 builder points HOME at the real home', '2.0.32', (t) => t.replace('set: { ...home, PWD: work,', 'set: { ...home, HOME: realHomeDir(), PWD: work,'));
  refuses('v2 builder runs in a git worktree', '2.0.32', (t) => t.replace('  plan.args = lockedArgsV2({ model, variant });', "  fs.mkdirSync(path.join(root, '.git'), { recursive: true });\n  plan.args = lockedArgsV2({ model, variant });"));
  // audit: a lib whose v2 audit forgives every tool event lets a completed tool through, so the
  // un-tampered completed-tool test above has teeth
  const { r } = tamperedReview('2.0.32', (t) => t.replace("if (adaptor === 'v2' && isUnavailableToolCall(part)) continue;", "if (adaptor === 'v2') continue;"),
    TOOL_STREAM('{"type":"tool_use","part":{"tool":"shell","state":{"status":"completed"}}}'));
  ok(!/containment breach/.test(r.stdout), 'negative-control self-check: a v2 audit that forgives everything would pass a completed tool');
}

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`${n} assertions passed\n`);
