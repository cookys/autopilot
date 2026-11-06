#!/usr/bin/env node
/**
 * exec-boundary oracle harness (reference parity for hooks/exec-boundary.js rule E2).
 *
 * For every command string (a fixture corpus plus generated variants) it asks two
 * questions and compares the answers:
 *   1. TRUTH   — did a real shell (zsh, which is what the Bash tool of this host runs,
 *                and bash as a second oracle) execute a recursive rm on an out-of-scope
 *                target? Every oracle shell runs inside bubblewrap: the host filesystem is
 *                read-only, only the harness work dir is writable, no network, and the stub
 *                rm (appends its argv to a log, exits 0) is bind-mounted over every real rm
 *                path (/usr/bin/rm and /bin/rm, the coreutils and busybox multi-call
 *                binaries), so `/bin/rm`, `command -p rm` and `busybox rm` hit the stub too.
 *                Also `env -i`-style clean env, stub-only PATH, throwaway HOME and cwd,
 *                `timeout 2`, stdin /dev/null. Without bwrap the harness refuses to run (exit 3).
 *                Before any case a self-check runs each rm spelling under both shells against
 *                a victim file created outside the sandbox: every one must show in the stub
 *                log and the victim must survive, else exit 3.
 *   2. VERDICT — does the hook DENY (exit 2) the same string?
 * Truth yes + verdict ALLOW = BYPASS (always blocking). Truth no + verdict DENY = false
 * DENY (reported; blocking only for corpus cases whose expectation is `allow`).
 *
 * "Recursive" means the flag shapes the hook itself recognises (-rf / -fr / --recursive);
 * "out-of-scope" means an absolute target that is not under /tmp or the sandbox cwd.
 *
 * Usage: node exec-boundary-oracle.js [--hook <file>] [--corpus <file>] [--shells zsh,bash]
 *        [--concurrency N] [--fuzz N --seed S] [--list <id-regex>] [--json <out-file>] [--no-generated]
 * Exit: 0 clean; 1 bypass or failed corpus expectation; 3 bwrap missing or sandbox self-check failed.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const k = argv.indexOf(name); return k === -1 ? dflt : argv[k + 1]; };
const HOOK = path.resolve(opt('--hook', path.join(__dirname, '..', 'exec-boundary.js')));
const CORPUS = path.resolve(opt('--corpus', path.join(__dirname, 'fixtures', 'exec-boundary-oracle-cases.txt')));
const SHELLS = opt('--shells', 'zsh,bash').split(',');
const CONC = Number(opt('--concurrency', '8'));
const LIST = opt('--list', '');
const JSON_OUT = opt('--json', '');
const BWRAP = '/usr/bin/bwrap';
const SHELL_BIN = { zsh: '/usr/bin/zsh', bash: '/usr/bin/bash' };
const SHELL_FLAGS = { zsh: ['-f', '-c'], bash: ['--norc', '--noprofile', '-c'] };

const BASE = fs.mkdtempSync(path.join(process.env.ORACLE_TMP || os.tmpdir(), 'ebo-'));
const STUBS = path.join(BASE, 'stubs');
fs.mkdirSync(STUBS);
const stub = (name, body) => fs.writeFileSync(path.join(STUBS, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
stub('rm', 'printf \'%s\\n\' "$*" >> "$RMLOG"\nexit 0');
for (const n of ['cat', 'ls', 'date', 'git', 'psql', 'timeout', 'bash', 'sh', 'xargs']) stub(n, 'exit 0');
for (const n of ['sudo', 'nohup', 'env']) stub(n, 'exec "$@"');

// ── corpus ──
function loadCorpus(file) {
  const cases = [];
  let cur = null;
  const flush = () => { if (cur) { cur.cmd = cur.lines.join('\n'); delete cur.lines; cases.push(cur); } cur = null; };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^#@ (\S+) (deny|allow|oracle)$/);
    if (m) { flush(); cur = { id: m[1], expect: m[2], lines: [], kind: 'corpus' }; continue; }
    if (line.startsWith('#@ ')) continue; // preamble comment
    if (cur) cur.lines.push(line);
  }
  flush();
  // a block's last line is followed by the next header, so the final newline is not command text
  return cases;
}

// ── generated variants: quote x substitution x arithmetic x procsub x continuation x heredoc ──
function generate() {
  const S = 'rm -rf /etc/x';
  const live = [
    ['top', (s) => s],
    ['subst', (s) => `echo $(${s})`],
    ['subst-dq', (s) => `echo "$(${s})"`],
    ['bt', (s) => `echo \`${s}\``],
    ['bt-dq', (s) => `echo "\`${s}\`"`],
    ['arith-cmd', (s) => `echo $(( $(${s}; echo 0) + 1 ))`],
    ['arith-bt', (s) => `echo $(( \`${s}\` ))`],
    ['arith-dq', (s) => `echo "$(( $(${s}) ))"`],
    ['arith-nest', (s) => `echo $(($(${s})))`],
    ['bare-arith', (s) => `(( $(${s}) ))`],
    ['arith-subshell', (s) => `echo $((true); ${s})`],
    ['procsub', (s) => `cat <(${s})`],
    ['procsub-arg', () => 'rm -rf <(true) /etc/x'],
    ['procsub-out', (s) => `true >(${s})`],
    ['heredoc-bare', (s) => `cat <<EOF\n$(${s})\nEOF`],
    ['heredoc-bare-bt', (s) => `cat <<EOF\n\`${s}\`\nEOF`],
    ['heredoc-dash', (s) => `cat <<-EOF\n\t$(${s})\n\tEOF`],
    ['heredoc-in-subst', (s) => `echo $(cat <<'EOF'\nx\nEOF\n${s})`],
    ['heredoc-in-dq-subst', (s) => `echo "$(cat <<'EOF'\nx\nEOF\n${s})"`],
    ['subshell', (s) => `(${s})`],
    ['brace', (s) => `{ ${s}; }`],
    ['if', (s) => `if true; then ${s}; fi`],
    ['and', (s) => `true && ${s}`],
    ['pipe', (s) => `true | ${s}`],
    ['semi', (s) => `true; ${s}`],
    ['cont-word', () => 'r\\\nm -rf /etc/x'],
    ['cont-flag', () => 'rm \\\n-rf /etc/x'],
    ['cont-target', () => 'rm -rf /etc/\\\nx'],
    ['param-subst', (s) => `echo \${a:-$(${s})}`],
    ['param-comment', (s) => `echo \${a:- # }; ${s}`],
    ['nested-subst', (s) => `echo $(echo $(${s}))`],
    ['bt-in-subst', (s) => `echo $(echo \`${s}\`)`],
    ['quoted-word', () => '"rm" -rf /etc/x'],
    ['split-quoted-word', () => 'r""m -rf /etc/x'],
    ['dq-then-live', (s) => `echo "a b"; ${s}`],
    ['sq-then-live', (s) => `echo 'a b'; ${s}`],
    ['comment-then-live', (s) => `echo hi # note\n${s}`],
  ];
  const inert = [
    ['sq', (s) => `echo '${s}'`],
    ['dq', (s) => `echo "${s}"`],
    ['ansi', (s) => `echo $'${s}'`],
    ['heredoc-sq', (s) => `cat <<'EOF'\n${s}\nEOF`],
    ['heredoc-dq', (s) => `cat <<"EOF"\n${s}\nEOF`],
    ['heredoc-bs', (s) => `cat <<\\EOF\n${s}\nEOF`],
    ['heredoc-partq', (s) => `cat <<E"OF"\n${s}\nEOF`],
    ['commit-msg', (s) => `git commit -m "docs: ${s} mentioned"`],
    ['commit-heredoc', (s) => `git commit -m "$(cat <<'EOF'\n${s}\nEOF\n)"`],
    ['comment', (s) => `echo hi # ${s}`],
    ['printf-file', (s) => `printf '%s\\n' "${s}" > note.txt`],
    ['dq-with-subst', (s) => `echo "$(date) ${s}"`],
    ['sq-multiline', (s) => `echo 'a\n${s}\nb'`],
  ];
  const pre = [
    '', "echo 'a'\n", 'echo "q"\n', "echo $'it\\'s'\n", '# c\n', "cat <<'EOF'\nx\nEOF\n",
    'cat <<<hi\n', 'echo $((1<<4))\n', 'true \\\n', 'x=$(echo 1)\n', 'cat <<E"OF"\nb\nEOF\n',
    'echo "$(printf x)"; ', 'echo `echo a`; ', 'echo a && ', '(( 1<<2 ))\n', 'cat <(true) ; ',
    'cat <<EOF\n$(true)\nEOF\n',
  ];
  const suf = ['', '\n# tail', '; echo done', "\necho 'x'"];
  const out = [];
  let n = 0;
  for (const [kind, list] of [['live', live], ['inert', inert]]) {
    for (const [wid, wrap] of list) {
      for (const [pi, p] of pre.entries()) {
        let s = suf[(n++) % suf.length];
        if (/heredoc/.test(wid) && s.startsWith(';')) s = '\n' + s.slice(2); // a heredoc terminator line must stand alone
        out.push({ id: `gen-${kind}-${wid}-p${pi}`, expect: 'oracle', kind: 'gen-' + kind, cmd: p + wrap(S) + s });
      }
    }
  }
  return out;
}

// Seeded random compositions of shell fragments (--fuzz N --seed S). Most are syntax errors
// and run nothing; the ones a shell does execute are checked against the hook like the rest.
function fuzz(count, seed) {
  const frags = ['rm -rf /etc/x', 'echo', ' ', ' ', '\n', ';', '&&', '|', "'", '"', '`', '$(', ')', '(', '((', '))', '$((',
    '<<EOF\n', "<<'EOF'\n", '\nEOF\n', 'EOF', '<<<', '#', '\\\n', '\\', "$'", '<(', '>(', '${', '}', 'x', '${a:-', 'true;', '\nrm -rf /etc/x\n'];
  let st = seed >>> 0 || 1;
  const rnd = (n) => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return (st >>> 8) % n; };
  const out = [];
  for (let k = 0; k < count; k++) {
    let cmd = '';
    const len = 3 + rnd(9);
    for (let j = 0; j < len; j++) cmd += frags[rnd(frags.length)];
    if (!/rm -rf \/etc\/x/.test(cmd)) cmd += ' ; rm -rf /etc/x';
    out.push({ id: `fuzz-${seed}-${k}`, expect: 'oracle', kind: 'gen-fuzz', cmd });
  }
  return out;
}

// ── sandbox + hook execution ──
const RECUR = /(^|\s)-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive/;
const outOfScope = (a, cwd) => a.startsWith('/') && !(a === '/tmp' || a.startsWith('/tmp/') || a === cwd || a.startsWith(cwd + '/'));
function truthOf(line, cwd) {
  return RECUR.test(line) && line.split(' ').some((a) => outOfScope(a, cwd));
}

function spawnP(cmd, args, o, input) {
  return new Promise((res) => {
    const c = cp.spawn(cmd, args, o);
    let err = '';
    if (c.stderr) c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => res({ code, err }));
    if (input !== undefined) c.stdin.end(input);
  });
}

// bwrap argv for one sandboxed shell run. Lines tagged STUB-BIND overlay the stub on every
// real rm path; the harness negative control strips them and expects the self-check to fail.
function stubBinds() {
  const dests = new Set();
  for (const p of ['/usr/bin/rm', '/bin/rm', '/usr/bin/busybox', '/usr/bin/coreutils', '/usr/lib/cargo/bin/coreutils/rm']) {
    try { dests.add(fs.realpathSync(p)); } catch { /* absent on this host */ }
  }
  return [...dests].flatMap((d) => ['--ro-bind', path.join(STUBS, 'rm'), d]); // STUB-BIND
}
function sandboxArgs(w, inner) {
  return ['--unshare-all', '--die-with-parent', '--new-session',
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
    '--bind', BASE, BASE,
    ...stubBinds(),
    '--chdir', w.dir, '--clearenv',
    '--setenv', 'PATH', STUBS, '--setenv', 'HOME', w.home, '--setenv', 'RMLOG', w.log,
    '--setenv', 'T', '/tmp/ebo-t', '--setenv', 'S', '/tmp/ebo-s',
    ...inner];
}
function sandboxShell(shell, cmd, w) {
  return spawnP(BWRAP, sandboxArgs(w, ['/usr/bin/timeout', '2', SHELL_BIN[shell], ...SHELL_FLAGS[shell], cmd]),
    { cwd: w.dir, stdio: ['ignore', 'ignore', 'ignore'] });
}

async function oracleRun(shell, cmd, w) {
  fs.writeFileSync(w.log, '');
  await sandboxShell(shell, cmd, w);
  const lines = fs.readFileSync(w.log, 'utf8').split('\n').filter(Boolean);
  return { calls: lines, hit: lines.some((l) => truthOf(l, w.dir)) };
}

async function hookRun(cmd, w) {
  const r = await spawnP(process.execPath, [HOOK], {
    cwd: w.dir, env: { PATH: process.env.PATH, HOME: '/var/ebo-sandbox-home', AUTOPILOT_HOOK_EXEC_BOUNDARY: '1' }, stdio: ['pipe', 'ignore', 'pipe'],
  }, JSON.stringify({ tool_input: { command: cmd } }));
  return { deny: r.code === 2, code: r.code, err: r.err.trim() };
}

// Every spelling of rm that a case could use must land in the stub log, and the victim file
// (created outside the sandbox, in a dir only this check uses) must survive.
async function selfCheck() {
  if (!fs.existsSync(BWRAP)) {
    process.stderr.write(`oracle harness refuses to run: ${BWRAP} is missing; the PATH-only sandbox is not safe enough (a case could run /bin/rm)\n`);
    process.exit(3);
  }
  const fail = (msg) => { process.stderr.write(`oracle sandbox self-check FAILED: ${msg}\n`); process.exit(3); };
  const dir = path.join(BASE, 'selfcheck');
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  const w = { dir, home: path.join(dir, 'home'), log: path.join(dir, 'rm.log') };
  const victimDir = fs.mkdtempSync(path.join(process.env.ORACLE_TMP || os.tmpdir(), 'ebo-victim-'));
  const victim = path.join(victimDir, 'victim');
  fs.writeFileSync(victim, 'keep');
  const spellings = ['/bin/rm', '/usr/bin/rm', 'command -p rm', 'rm', '/usr/bin/busybox rm', 'command -p busybox rm', '/usr/bin/coreutils rm'];
  for (const sh of SHELLS) {
    const r = cp.spawnSync(BWRAP, sandboxArgs(w, [SHELL_BIN[sh], ...SHELL_FLAGS[sh], 'command -v rm; command -v rmdir; command -v find']), { encoding: 'utf8' });
    const lines = (r.stdout || '').split('\n').filter(Boolean);
    if (lines[0] !== path.join(STUBS, 'rm') || lines.length !== 1) fail(`${sh}: command -v rm is ${JSON.stringify(r.stdout)}`);
    for (const sp of spellings) {
      if (/busybox/.test(sp) && !fs.existsSync('/usr/bin/busybox')) continue;
      if (/coreutils/.test(sp) && !fs.existsSync('/usr/bin/coreutils')) continue;
      fs.writeFileSync(w.log, '');
      const cmd = `${sp} -rf ${victim}`;
      const rr = cp.spawnSync(BWRAP, sandboxArgs(w, ['/usr/bin/timeout', '2', SHELL_BIN[sh], ...SHELL_FLAGS[sh], cmd]), { encoding: 'utf8' });
      const log = fs.readFileSync(w.log, 'utf8');
      const hit = log.includes(victim);
      const alive = fs.existsSync(victim);
      console.log(`self-check ${sh.padEnd(4)} ${sp.padEnd(24)} -> ${hit ? 'stub log' : 'NOT IN STUB LOG'}; victim ${alive ? 'intact' : 'GONE'}${rr.status ? ` (rc ${rr.status})` : ''}`);
      if (!hit || !alive) fail(`${sh}: "${cmd}" ${!hit ? 'did not reach the stub' : ''} ${!alive ? 'and the victim file is gone' : ''}`);
    }
  }
}

async function main() {
  await selfCheck();
  let cases = loadCorpus(CORPUS);
  if (!argv.includes('--no-generated')) cases = cases.concat(generate());
  if (Number(opt('--fuzz', '0'))) cases = cases.concat(fuzz(Number(opt('--fuzz', '0')), Number(opt('--seed', '1'))));
  if (LIST) cases = cases.filter((c) => new RegExp(LIST).test(c.id));
  const workers = [];
  for (let k = 0; k < CONC; k++) {
    const dir = path.join(BASE, `w${k}`);
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    workers.push({ dir, home: path.join(dir, 'home'), log: path.join(dir, 'rm.log') });
  }
  const results = [];
  let next = 0;
  await Promise.all(workers.map(async (w) => {
    while (next < cases.length) {
      const c = cases[next++];
      const o = {};
      for (const sh of SHELLS) o[sh] = await oracleRun(sh, c.cmd, w);
      const h = await hookRun(c.cmd, w);
      const truth = SHELLS.some((sh) => o[sh].hit);
      const diverge = SHELLS.some((sh) => o[sh].hit !== truth);
      results.push({ ...c, truth, diverge, shells: Object.fromEntries(SHELLS.map((sh) => [sh, o[sh].hit])), deny: h.deny, hookCode: h.code, err: h.err });
    }
  }));
  results.sort((a, b) => a.id.localeCompare(b.id));

  const bypass = results.filter((r) => r.truth && !r.deny);
  const expectFail = results.filter((r) => (r.expect === 'deny' && !r.deny) || (r.expect === 'allow' && r.deny));
  const falseDeny = results.filter((r) => !r.truth && r.deny && r.expect !== 'deny');
  const diverge = results.filter((r) => r.diverge);
  const show = (r) => `${r.id} ${JSON.stringify(r.cmd)}`;
  const gen = results.filter((r) => r.kind.startsWith('gen-'));
  console.log(`oracle shells: ${SHELLS.join(', ')}; hook: ${HOOK}`);
  console.log(`cases: ${results.length} (corpus ${results.length - gen.length}, generated ${gen.length})`);
  console.log(`truth(rm ran recursive out-of-scope): ${results.filter((r) => r.truth).length}; hook DENY: ${results.filter((r) => r.deny).length}`);
  console.log(`BYPASS (truth yes, hook ALLOW): ${bypass.length}`);
  for (const r of bypass) console.log(`  BYPASS ${show(r)} shells=${JSON.stringify(r.shells)}`);
  console.log(`EXPECTATION FAILURES (corpus deny/allow): ${expectFail.length}`);
  for (const r of expectFail) console.log(`  EXPECT-${r.expect.toUpperCase()} got ${r.deny ? 'DENY' : 'ALLOW'} ${show(r)}`);
  console.log(`FALSE DENY (no rm ran, hook DENY, not an expect=deny case): ${falseDeny.length}`);
  for (const r of falseDeny.slice(0, 40)) console.log(`  FALSE-DENY ${show(r)}`);
  console.log(`SHELL DIVERGENCE (zsh vs bash disagree on whether rm ran): ${diverge.length}`);
  for (const r of diverge.slice(0, 20)) console.log(`  DIVERGE ${show(r)} shells=${JSON.stringify(r.shells)}`);
  const noRun = results.filter((r) => r.expect === 'deny' && !r.truth && r.kind === 'corpus' && /^g[12]-/.test(r.id));
  if (noRun.length) console.log(`note: corpus expect=deny cases where no shell ran the rm (denied by design / fail closed): ${noRun.map((r) => r.id).join(' ')}`);
  if (LIST) for (const r of results) console.log(`  ${r.id.padEnd(22)} truth=${r.truth ? 'RAN ' : 'none'} hook=${r.deny ? 'DENY ' : 'ALLOW'} ${JSON.stringify(r.shells)}`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
  process.exit(bypass.length || expectFail.length ? 1 : 0);
}

main();
