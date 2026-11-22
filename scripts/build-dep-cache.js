#!/usr/bin/env node
'use strict';
// Build a runtime dependency cache for test suites. See --help.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

async function main() {
  let repo = process.cwd(), selection = 'all', out, seconds = 600, jobs = 1;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { console.log('Usage: node scripts/build-dep-cache.js [--repo dir] [--suites paths|all] [--out file] [--timeout-s n] [--jobs 1|2]'); return; }
    if (!['--repo', '--suites', '--out', '--timeout-s', '--jobs'].includes(arg) || !args[i + 1]) throw Error(`invalid argument: ${arg}`);
    const value = args[++i];
    if (arg === '--repo') repo = value;
    if (arg === '--suites') selection = value;
    if (arg === '--out') out = value;
    if (arg === '--timeout-s') seconds = Number(value);
    if (arg === '--jobs') jobs = Number(value);
  }
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(jobs) || jobs < 1 || jobs > 2) throw Error('invalid timeout or jobs (jobs must be 1 or 2)');
  repo = path.resolve(repo);
  const git = (...argv) => execFileSync('git', ['-C', repo, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sha = git('rev-parse', 'HEAD');
  if (!out) out = path.resolve(repo, git('rev-parse', '--git-common-dir'), 'autopilot/dep-cache.json');
  else out = path.resolve(out);
  const selector = path.join(__dirname, 'affected-suites.js');
  const suites = selection === 'all' ? execFileSync(process.execPath, [selector, '--root', repo, '--list-all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean) : selection.split(',');
  for (const suite of suites) {
    const full = path.resolve(repo, suite), rel = path.relative(repo, full);
    if (!suite || rel !== suite || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !(/\.test\.js$|\.test\.sh$/.test(suite)) || !fs.statSync(full).isFile()) throw Error(`invalid suite: ${suite}`);
  }
  const results = {};
  let next = 0;
  async function worker() {
    while (next < suites.length) {
      const suite = suites[next++];
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-cache-'));
      const trace = path.join(temp, 'trace');
      try {
        const hook = path.join(__dirname, 'lib/dep-trace-hook.js');
        const env = { ...process.env, TMPDIR: temp, AUTOPILOT_DEP_TRACE_FILE: trace, AUTOPILOT_DEP_TRACE_ROOT: repo,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(hook)}`,
          BASH_ENV: path.join(__dirname, 'lib/dep-trace-bash.sh') };
        if (env.AUTOPILOT_TEST_TIMING_FACTOR === undefined) env.AUTOPILOT_TEST_TIMING_FACTOR = String(jobs);
        const command = suite.endsWith('.test.js') ? ['node', '--test', path.join(repo, suite)] : ['bash', path.join(repo, suite)];
        const rc = await new Promise(resolve => {
          const child = spawn('timeout', ['-k', '5', String(seconds), 'nice', '-n', '10', ...command], { cwd: repo, env, stdio: 'ignore' });
          child.on('error', () => resolve(127));
          child.on('close', (code, signal) => resolve(code === null ? (signal ? 128 : 127) : code));
        });
        const files = new Set();
        function add(file) {
          if (typeof file !== 'string' || !file) return;
          const abs = path.resolve(repo, file), rel = path.relative(repo, abs);
          if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules') || rel === suite || abs === temp || abs.startsWith(temp + path.sep)) return;
          files.add(rel.split(path.sep).join('/'));
        }
        try { for (const line of fs.readFileSync(trace, 'utf8').split('\n')) { try { const row = JSON.parse(line); if (Array.isArray(row.files)) row.files.forEach(add); } catch (_) {} } } catch (_) {}
        try { for (const line of fs.readFileSync(trace + '.bash', 'utf8').split('\n')) { const match = /^\++DEPTRACE\|([^|]+)\|/.exec(line); if (match) add(match[1]); } } catch (_) {}
        results[suite] = { files: [...files].sort(), rc, traced: rc === 0 };
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  const ordered = Object.fromEntries(suites.map(s => [s, results[s]]));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ schema: 'dep-cache/1', base_sha: sha, built_at_utc: new Date().toISOString(), suites: ordered }, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(tmp, out); }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}
main().catch(err => { console.error(`build-dep-cache: ${err.message}`); process.exitCode = 2; });
