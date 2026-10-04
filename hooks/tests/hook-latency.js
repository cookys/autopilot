#!/usr/bin/env node
'use strict';
/**
 * hook-latency — per-event hook process cost, measured the way Claude Code runs the hooks
 * (`sh -c <command>` with CLAUDE_PLUGIN_ROOT set, payload on stdin). Mods P1W PERF+STAMP.
 *
 *   node hooks/tests/hook-latency.js --root <plugin root> [--runs 20] [--label NAME]
 *        [--exclude stem,stem]   drop those hook scripts from the set (builds the "pre-W1de" set)
 *        [--ab-root <other root> [--ab-runs 40]]   ALSO run an interleaved A/B of the HOST hooks
 *                                (audit-log for PostToolUse, advisory-relay for UserPromptSubmit) between
 *                                --root (A) and the other root (B): A,B,A,B,... so load drift hits both
 *                                equally; prints sorted samples and the median delta.
 *
 * For each scenario it takes every hooks.json entry whose event + matcher matches, then runs
 * the whole set serially `runs` times. Output (markdown): the node process count per scenario, the
 * per-hook median, and the sorted per-round totals (ms) so a reader sees the whole distribution.
 * Wall time is load-sensitive: /proc/loadavg is printed at start and end of every scenario.
 * Everything runs against temp dirs (HOME, AUTOPILOT_LIVE_DIR on /dev/shm, session-mode dir);
 * the operator's real ~/.claude, ~/.autopilot and live dir are never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(opt('root', path.resolve(__dirname, '..', '..')));
const RUNS = Number(opt('runs', '20'));
const LABEL = opt('label', path.basename(ROOT));
const AB_ROOT = opt('ab-root', '');
const AB_RUNS = Number(opt('ab-runs', '40'));
const EXCLUDE = (opt('exclude', '') || '').split(',').filter(Boolean);

const tmp = fs.mkdtempSync(path.join('/dev/shm', 'hook-latency-'));
fs.chmodSync(tmp, 0o700);
const HOME = path.join(tmp, 'home');
const LIVE = path.join(tmp, 'live');
const MARK = path.join(tmp, 'markers');
const RUNSDIR = path.join(tmp, 'runs');
for (const d of [HOME, LIVE, MARK, RUNSDIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
const OPTED = path.join(tmp, 'repo-opted');
const PLAIN = path.join(tmp, 'repo-plain');
for (const r of [OPTED, PLAIN]) {
  fs.mkdirSync(r);
  execFileSync('git', ['-C', r, 'init', '-q']);
  execFileSync('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);
}
fs.mkdirSync(path.join(OPTED, '.claude'));
fs.writeFileSync(path.join(OPTED, '.claude', 'dispatch-config.md'), '# cfg\n');

const baseEnv = {
  PATH: process.env.PATH, HOME, LANG: 'C', CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_CONFIG_DIR: path.join(HOME, '.claude'),
  XDG_RUNTIME_DIR: path.join(tmp, 'xdg'), AUTOPILOT_LIVE_DIR: LIVE, AUTOPILOT_SESSION_MODE_DIR: MARK,
  AUTOPILOT_COSTS_FILE: path.join(tmp, 'costs.jsonl'), AUTOPILOT_DISPATCH_RUNS_DIR: RUNSDIR, TMPDIR: tmp,
  AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S: '900', AUTOPILOT_RUNS_WATCH_INTERVAL_S: '30',
};

const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
function hooksFor(event, tool) {
  const out = [];
  for (const g of hooksJson[event] || []) {
    const m = g.matcher;
    const hit = !m || m === '*' || new RegExp(`^(?:${m})$`).test(tool || '');
    if (!hit) continue;
    for (const h of g.hooks || []) {
      if (EXCLUDE.some((s) => h.command.includes(`/hooks/${s}.js`))) continue;
      out.push(h.command);
    }
  }
  return out;
}
const short = (c) => c.replace(/^node \$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//, '').replace(/\.js/, '');
const sid = 'lat-session-0001';
const post = (cwd, extra = {}) => JSON.stringify({
  session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd,
  tool_input: { command: 'ls' }, tool_response: { stdout: 'ok' }, ...extra,
});
const ups = (cwd) => JSON.stringify({ session_id: sid, hook_event_name: 'UserPromptSubmit', cwd, prompt: 'hi' });

function runSet(cmds, payload) {
  const t = [];
  for (const c of cmds) {
    const s = process.hrtime.bigint();
    spawnSync('sh', ['-c', c], { input: payload, env: baseEnv, cwd: tmp, timeout: 30000 });
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  return t;
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const load = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');

function scenario(name, event, tool, payload) {
  const cmds = hooksFor(event, tool);
  const l0 = load();
  runSet(cmds, payload); // warm-up (page cache), not counted
  const per = cmds.map(() => []);
  const totals = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t = runSet(cmds, payload);
    t.forEach((x, k) => per[k].push(x));
    totals.push(t.reduce((a, b) => a + b, 0));
  }
  totals.sort((a, b) => a - b);
  console.log(`\n### ${LABEL}: ${name}`);
  console.log(`node processes spawned (hooks.json entries matching ${event}/${tool || '-'}): ${cmds.length}`);
  console.log(`loadavg before ${l0}, after ${load()}`);
  console.log('| hook | median ms |\n|---|---|');
  cmds.forEach((c, k) => console.log(`| ${short(c)} | ${med(per[k]).toFixed(1)} |`));
  console.log(`\nround totals (ms, sorted, n=${RUNS}): ${totals.map((x) => x.toFixed(0)).join(' ')}`);
  console.log(`round-total median ${med(totals).toFixed(1)} ms`);
}

function abScenario(name, hostStem, payload, cwd) {
  const roots = [ROOT, path.resolve(AB_ROOT)];
  const cmd = (r) => `node ${r}/hooks/${hostStem}.js`;
  const one = (r) => {
    const s0 = process.hrtime.bigint();
    spawnSync('sh', ['-c', cmd(r)], { input: payload, env: { ...baseEnv, CLAUDE_PLUGIN_ROOT: r }, cwd, timeout: 30000 });
    return Number(process.hrtime.bigint() - s0) / 1e6;
  };
  roots.forEach(one); // warm-up
  const a = [];
  const b = [];
  const l0 = load();
  for (let i = 0; i < AB_RUNS; i += 1) {
    if (i % 2 === 0) { a.push(one(roots[0])); b.push(one(roots[1])); } else { b.push(one(roots[1])); a.push(one(roots[0])); }
  }
  a.sort((x, y) => x - y);
  b.sort((x, y) => x - y);
  console.log(`\n### A/B ${name} (host ${hostStem}; A=${roots[0]}  B=${roots[1]}) loadavg ${l0} -> ${load()}`);
  console.log(`A sorted ms: ${a.map((x) => x.toFixed(0)).join(' ')}`);
  console.log(`B sorted ms: ${b.map((x) => x.toFixed(0)).join(' ')}`);
  console.log(`median A ${med(a).toFixed(1)}  median B ${med(b).toFixed(1)}  B-A ${(med(b) - med(a)).toFixed(1)} ms`);
}

function stopWatchers() {
  // the watcher envelope names its writer pid; kill by pid only (never a pattern match)
  try {
    for (const f of fs.readdirSync(path.join(LIVE, 'runs'))) {
      if (!f.endsWith('.json')) continue;
      const e = JSON.parse(fs.readFileSync(path.join(LIVE, 'runs', f), 'utf8'));
      if (e.writer && e.writer.pid) { try { process.kill(e.writer.pid, 'SIGKILL'); } catch (_e) { /* gone */ } }
    }
  } catch (_e) { /* none */ }
}

try {
  console.log(`## hook-latency ${LABEL} root=${ROOT} runs=${RUNS} exclude=[${EXCLUDE}] start loadavg ${load()}`);
  const bare = [];
  for (let i = 0; i < RUNS; i += 1) { const s = process.hrtime.bigint(); spawnSync(process.execPath, ['-e', '0']); bare.push(Number(process.hrtime.bigint() - s) / 1e6); }
  bare.sort((a, b) => a - b);
  console.log(`bare node -e 0 sorted ms: ${bare.map((x) => x.toFixed(0)).join(' ')} (median ${med(bare).toFixed(1)})`);
  scenario('PostToolUse Bash, depth-0, no attention pending', 'PostToolUse', 'Bash', post(PLAIN));
  scenario('PostToolUse Bash, subagent call (agent_id present)', 'PostToolUse', 'Bash', post(PLAIN, { agent_id: 'agent-abc', agent_type: 'general-purpose' }));
  scenario('UserPromptSubmit, repo NOT opted in (opt-in check fails)', 'UserPromptSubmit', null, ups(PLAIN));
  // ensure one watcher in the opted-in repo, then measure with it alive
  spawnSync('sh', ['-c', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/runs-watch-autostart.js"'], { input: ups(OPTED), env: baseEnv, cwd: OPTED });
  for (let i = 0; i < 100 && !fs.existsSync(path.join(LIVE, 'runs')); i += 1) spawnSync('sleep', ['0.1']);
  spawnSync('sleep', ['2']);
  scenario('UserPromptSubmit, opted-in repo, watcher alive', 'UserPromptSubmit', null, ups(OPTED));
  if (AB_ROOT) {
    abScenario('PostToolUse Bash depth-0 (no attention)', 'audit-log', post(PLAIN), PLAIN);
    abScenario('PostToolUse Bash subagent (agent_id)', 'audit-log', post(PLAIN, { agent_id: 'agent-abc', agent_type: 'general-purpose' }), PLAIN);
    abScenario('UserPromptSubmit repo not opted in', 'advisory-relay', ups(PLAIN), PLAIN);
    abScenario('UserPromptSubmit opted-in, watcher alive (B only is hosted; A is advisory-relay without the ensure)', 'advisory-relay', ups(OPTED), OPTED);
  }
} finally {
  stopWatchers();
  fs.rmSync(tmp, { recursive: true, force: true });
}
