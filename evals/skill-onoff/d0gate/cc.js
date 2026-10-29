'use strict';
// d0gate/cc.js - the real cell runner of the d0gate row (BL-0306 P3, unit U2). One call = one cell = one row.
//   depth-0 cells (G1-G3): `claude -p` headless with the arm's plugin (ceo-agent skill pack), working in a tinylib cell whose
//     scripts/dispatch-hetero.sh is the d0gate STUB (zero-spend deterministic hand), so the facts come from the stub ledger and the
//     real per-turn-gate records. Two turns resume the same session (--resume).
//   G4 cells: the REAL scripts/dispatch-hetero.sh --runner claude-native --model <g4 model> [--gate-rules <list>] in the cell repo
//     (the arm is whether the flag is there). The real rail writes no ledger, so one is derived from its stdout JSON and the
//     hook records, then the same markers (lib.js) score the final tree.
// Isolation: every cell has its own HOME, CLAUDE_CONFIG_DIR (only a copy of .credentials.json), AUTOPILOT_LIVE_DIR (tmpfs),
// ENGINE_CAPABILITY_DIR and TMPDIR under one tmpfs cell root, AUTOPILOT_STRIKE_WRITER=off. The real ~/.claude is only READ for
// .credentials.json (copied per cell) and ~/.autopilot/config.json only for the owner's claude-native confirmation timestamp.
// Cost: per call the LAST result's total_cost_usd, summed (cost_turns keeps each); a timed-out cell is charged its whole ceiling.
// Depth-0 cells may NOT start a claude of their own: the cell PATH refuses it (exit 97) and counts the attempts (nested_claude_attempts).
// G4: the claude wrapper on the PATH gives every hand launch of the cell only what is left of the cell budget.
// Row shape: every row, finished or not, carries the fields the scorer judges on (see shapeProblems); an unfinished cell has them
// all false and a failure_class.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const L = require('./lib');
const { Cell } = require('./cell');
const TR = require('./traces');
const TASKS = require('./cc-tasks');

const T = L.TASKS;
const EVAL_DIR = L.EVAL_DIR;
const REPO_ROOT = path.resolve(EVAL_DIR, '..', '..');
const SCORABLE_RAIL = new Set(['committed', 'no_op', 'dirty', 'question_suspected']);
const D0_MARKER = { [T.G1]: 'm_armed', [T.G2]: 'm_not_armed', [T.G3]: 'm_not_wedged' };
const D0_WORKER = { [T.G1]: 'clean-g1', [T.G2]: 'clean-g2', [T.G3]: 'g3-ok' };
const isBool = (v) => typeof v === 'boolean';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// ---------------------------------------------------------------- row shape
function shapeProblems(row) {
  const p = [];
  if (typeof row.row !== 'string') p.push('row');
  if (typeof row.task_id !== 'string') p.push('task_id');
  if (typeof row.arm !== 'string') p.push('arm');
  if (!Number.isInteger(row.rep)) p.push('rep');
  if (row.runner !== 'cc') p.push('runner');
  if (typeof row.model !== 'string') p.push('model');
  if (!isBool(row.pilot)) p.push('pilot');
  if (typeof row.session_id !== 'string') p.push('session_id');
  if (num(row.cost_usd) === null) p.push('cost_usd');
  if (!Array.isArray(row.cost_turns) || row.cost_turns.some((v) => num(v) === null)) p.push('cost_turns');
  if (!(row.failure_class === null || typeof row.failure_class === 'string')) p.push('failure_class');
  if (row.task_id === T.G4) {
    if (!row.g4 || typeof row.g4 !== 'object') p.push('g4');
    else {
      for (const f of ['gate_exercised', 'completed', 'violating', 'hand_clean']) if (!isBool(row.g4[f])) p.push(`g4.${f}`);
      if (!Number.isInteger(row.g4.gate_blocks) || row.g4.gate_blocks < 0) p.push('g4.gate_blocks');
    }
  } else {
    if (!isBool(row.skill_invoked)) p.push('skill_invoked');
    if (!isBool(row.skill_invoked_observed)) p.push('skill_invoked_observed');
    // an unfinished or infra row has every judged boolean false; what the transcript actually showed goes in skill_invoked_observed
    if (row.failure_class !== null && row.skill_invoked !== false) p.push('skill_invoked must be false on an unfinished row');
    if (!Number.isInteger(row.nested_claude_attempts) || row.nested_claude_attempts < 0) p.push('nested_claude_attempts');
    if (!Number.isInteger(row.unaccounted_sessions) || row.unaccounted_sessions < 0) p.push('unaccounted_sessions');
    const m = D0_MARKER[row.task_id];
    if (!m) p.push('task_id unknown');
    else if (!row.markers || typeof row.markers !== 'object') p.push('markers');
    else if (!isBool(row.markers[m])) p.push(`markers.${m}`);
  }
  return p;
}

// ---------------------------------------------------------------- transcripts and cost
function readObjects(text) {
  const out = [];
  const whole = (() => { try { return JSON.parse(text); } catch { return null; } })();
  if (whole && typeof whole === 'object' && !Array.isArray(whole)) return [whole];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* not json */ } }
  return out;
}
// summary(text): the result events, the session id, the model the CLI says it ran, and the spend.
function summary(text) {
  const objs = readObjects(text);
  const results = objs.filter((j) => j && j.type === 'result');
  let sessionId = '';
  let modelSeen = '';
  for (const j of objs) {
    if (!sessionId && typeof j.session_id === 'string') sessionId = j.session_id;
    if (!modelSeen && j.type === 'system' && j.subtype === 'init' && typeof j.model === 'string') modelSeen = j.model;
  }
  const last = new Map();
  let bad = 0;
  for (const r of results) {
    const v = num(r.total_cost_usd);
    if (v === null) bad++; else last.set(typeof r.session_id === 'string' ? r.session_id : '', v);
  }
  let total = 0;
  for (const v of last.values()) total += v;
  return { results, sessionId, modelSeen, total, costKnown: results.length > 0 && bad === 0 };
}
const AUTH_RE = /(^|[^a-z])(unauthorized|forbidden|authentication|invalid[ _-]?(api[ _-]?)?key|login required|token expired|oauth token has expired|please run \/login|not logged in)([^a-z]|$)/i;
const QUOTA_RE = /(usage limit|weekly limit|rate limit|limit reached|hit your limit|quota|credit balance)/i;
// classify(exitCode, text, errText) -> null or {cls, cause}; timeout and budget first, then the exit status, then the terminal event
function classify(exit, sum, errText) {
  if (exit === 124 || exit === 137) return { cls: 'infra_fail', cause: 'runner_timeout' };
  if (sum.results.some((r) => r.subtype === 'error_max_budget_usd' && r.is_error === true)) return { cls: 'infra_fail', cause: 'budget_exceeded' };
  const terminal = sum.results.filter((r) => r.is_error === true).map((r) => `${r.result || ''} ${r.subtype || ''}`).join(' ');
  const txt = `${errText}\n${terminal}`;
  if (exit !== 0 || terminal) {
    if (QUOTA_RE.test(txt)) return { cls: 'infra_fail', cause: 'quota' };
    if (AUTH_RE.test(txt)) return { cls: 'infra_fail', cause: 'authentication' };
    return { cls: 'infra_fail', cause: 'runner_error' };
  }
  if (sum.results.length === 0) return { cls: 'infra_fail', cause: 'empty_output' };
  if (!sum.costKnown) return { cls: 'infra_fail', cause: 'cost_unknown' };
  return null;
}

// ---------------------------------------------------------------- cell plumbing
const falseShape = (c) => (c.task === T.G4
  ? { g4: { gate_exercised: false, completed: false, violating: false, hand_clean: false, gate_blocks: 0 } }
  : { markers: { [D0_MARKER[c.task]]: false }, skill_invoked: false, skill_invoked_observed: false, nested_claude_attempts: 0, unaccounted_sessions: 0 });
function cellEnv(cell, extra = {}) {
  const e = cell.env();
  delete e.ANTHROPIC_BASE_URL; // the stub cells point it at a dead port; a real cell must reach the API
  return {
    ...e, SHELL: '/bin/bash', TMPDIR: path.join(cell.root, 'tmp'), ENGINE_CAPABILITY_DIR: path.join(cell.root, 'engine'),
    AUTOPILOT_STRIKE_WRITER: 'off', AUTOPILOT_DISPATCH_RUNS_DIR: path.join(cell.root, 'runs'), DISPATCH_QUIET: '1', ...extra,
  };
}
// The per-cell config dir holds ONLY a fresh copy of the operator's .credentials.json (a real ~/.claude handed to a child gets reset).
function seedConfig(cell, srcDir) {
  const src = path.join(srcDir, '.credentials.json');
  const dst = path.join(cell.home, '.claude', '.credentials.json');
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o600);
  fs.writeFileSync(path.join(cell.home, '.claude.json'), '{"hasCompletedOnboarding":true}\n');
  for (const d of ['tmp', 'engine', 'runs']) fs.mkdirSync(path.join(cell.root, d), { recursive: true });
}
function buildPlugin(dir, tree) {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"name":"autopilot","version":"0.0.1","description":"d0gate eval plugin"}\n');
  for (const [rel, src] of Object.entries(tree)) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
function keepCopy(keepDir, cell, extra = {}) {
  if (!keepDir) return;
  fs.mkdirSync(keepDir, { recursive: true });
  for (const [name, src] of [['ledger.jsonl', path.join(cell.root, '.d0gate', 'ledger.jsonl')], ...Object.entries(extra)]) {
    try { fs.copyFileSync(src, path.join(keepDir, name)); } catch { /* absent */ }
  }
  try { fs.cpSync(path.join(cell.live, 'per-turn-gate'), path.join(keepDir, 'per-turn-gate'), { recursive: true }); } catch { /* none */ }
  keepProjects(keepDir, [{ label: 'projects', dir: path.join(cell.home, '.claude', 'projects') }, { label: 'hand-sessions', dir: path.join(cell.root, '.d0gate', 'hand-out.json.sessions') }]);
}
// The cell config dir is deleted with the cell, so the evidence about the claude sessions it saw is kept here: the file list of
// <config>/projects/ (path and size, the direct evidence the stray-session check works from) and a copy of those files. A G4 hand runs in
// a config dir the rail seeds and removes itself, so the claude wrapper copies the hand's session files (its tool trajectory; the
// rail's envelope has only the final result) into hand-out.json.sessions/ and they are kept as hand-sessions/.
function keepProjects(keepDir, roots) {
  const list = [];
  const walk = (label, root, d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(label, root, f);
      else if (e.isFile()) { let size = null; try { size = fs.statSync(f).size; } catch { /* gone */ } list.push({ path: path.posix.join(label, path.relative(root, f).split(path.sep).join('/')), size }); }
    }
  };
  for (const r of roots) {
    walk(r.label, r.dir, r.dir);
    if (list.some((x) => x.path.startsWith(`${r.label}/`))) { try { fs.cpSync(r.dir, path.join(keepDir, r.label), { recursive: true }); } catch { /* best effort */ } }
  }
  list.sort((a, b) => (a.path < b.path ? -1 : 1));
  try { fs.writeFileSync(path.join(keepDir, 'projects-files.json'), `${JSON.stringify(list, null, 2)}\n`); } catch { /* best effort */ }
}
const failureRow = (ctx, c, o) => ({
  row: ctx.P.row, task_id: c.task, arm: c.arm, rep: c.rep, ...falseShape(c), model: o.model, pilot: ctx.pilot, runner: 'cc',
  runner_version: ctx.runnerVersion, session_id: o.sessionId || '', duration_s: o.durationS, cost_usd: o.cost,
  cost_turns: o.costTurns || [], ...(o.nestedAttempts !== undefined ? { nested_claude_attempts: o.nestedAttempts } : {}),
  ...(o.unaccounted !== undefined ? { unaccounted_sessions: o.unaccounted } : {}),
  ...(c.task !== T.G4 ? { skill_invoked_observed: !!o.skillObserved } : {}),
  ...(o.costUnknown ? { cost_unknown: true, cost_estimated: true } : {}), failure_class: o.cls, failure_cause: o.cause,
  ...(o.detail ? { failure_detail: String(o.detail).slice(0, 300) } : {}),
});

// ---------------------------------------------------------------- depth-0 cell (G1-G3)
// After-the-fact detection of a claude the depth-0 agent started behind the PATH wrapper's back (absolute path, its own PATH). There is no
// sandbox, so what is checked is the trace it leaves: ASSUMPTION (to be confirmed by depth-0 on real pilot output): claude writes each
// session transcript to <CLAUDE_CONFIG_DIR>/projects/<project dir>/<session id>.jsonl (exactly two levels below projects/; subagent files
// sit deeper and are not looked at). A session file whose id is not one of the cell's own known sessions is "unaccounted".
function sessionFiles(configDir) {
  const out = [];
  let dirs = [];
  const root = path.join(configDir, 'projects');
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, d.name), { withFileTypes: true }); } catch { continue; }
    for (const e of files) if (e.isFile() && /\.jsonl$/.test(e.name)) out.push(path.join(root, d.name, e.name));
  }
  return out;
}
function lastCostIn(file) {
  let last = null;
  try { for (const l of fs.readFileSync(file, 'utf8').split('\n')) { let j; try { j = JSON.parse(l); } catch { continue; } if (j && num(j.total_cost_usd) !== null) last = j.total_cost_usd; } } catch { return null; }
  return last;
}
function turnArgs(ctx, plugin, model, resume, budget) {
  return ['-p', '--model', model, ...(resume ? ['--resume', resume] : []), '--plugin-dir', plugin, '--setting-sources', 'project',
    '--strict-mcp-config', '--dangerously-skip-permissions', '--max-budget-usd', String(budget), '--disallowedTools', ctx.P.cc.disallowed_tools,
    '--output-format', 'stream-json', '--verbose'];
}
function runD0(ctx, c, ceiling, budget, keepDir) {
  const t0 = Date.now();
  const cell = new Cell().init();
  const model = ctx.d0Model;
  try {
    seedConfig(cell, ctx.srcConfigDir);
    const plugin = path.join(cell.root, 'plugin');
    buildPlugin(plugin, ctx.armTree(c.arm));
    if (c.task === T.G3) cell.putRules('g3-wrong.json', 'repo');
    // The depth-0 turn itself runs the REAL claude by absolute path. A depth-0 cell may not start a claude of its own (its hand is the
    // zero-spend dispatch stub): the cell PATH starts with a wrapper that REFUSES (exit 97), runs nothing and records each attempt.
    const nestedLog = path.join(cell.root, '.d0gate', 'nested-attempts.log');
    fs.writeFileSync(nestedLog, '');
    const bin = denyWrapper(cell);
    const baseEnv = cellEnv(cell, { PATH: `${bin}:${process.env.PATH || ''}`, D0GATE_NESTED_LOG: nestedLog, D0GATE_WORKER: D0_WORKER[c.task] });
    const prompts = TASKS.turns(c.task, ctx.P.invocation_prefix);
    const transcript = [];
    let sid = '';
    const costTurns = [];
    let costTurnsKnown = true;
    let fail = null;
    let exit = 0;
    let errAll = '';
    let sum = null;
    let timedOut = false;
    for (let i = 0; i < prompts.length; i++) {
      const spentSoFar = costTurns.reduce((a, b) => a + b, 0); // conservative: every call added, even if resume totals are cumulative
      const left = Number((budget - spentSoFar).toFixed(4));
      if (i > 0 && left <= 0.0005) { fail = { cls: 'infra_fail', cause: 'budget_exceeded' }; break; }
      if (i > 0 && !sid) { fail = { cls: 'infra_fail', cause: 'resume_unavailable' }; break; }
      const env = baseEnv;
      const r = cp.spawnSync('timeout', [`--kill-after=15`, String(ctx.P.cc.timeout_s), ctx.realClaude, ...turnArgs(ctx, plugin, model, i > 0 ? sid : '', i === 0 ? budget : left)],
        { cwd: cell.repo, env, input: prompts[i], encoding: 'utf8', maxBuffer: 1 << 28 });
      exit = r.status === null ? 137 : r.status;
      if (exit === 124 || exit === 137) timedOut = true;
      const out = String(r.stdout || '');
      transcript.push(out);
      errAll += String(r.stderr || '');
      sum = summary(transcript.join('\n'));
      if (!sid) sid = sum.sessionId;
      const turnSum = summary(out);
      costTurns.push(Number(turnSum.total.toFixed(6)));
      if (!turnSum.costKnown) costTurnsKnown = false;
      const f = classify(exit, turnSum, errAll);
      if (f) { fail = f; break; }
    }
    const tfile = keepDir ? path.join(keepDir, 'transcript.jsonl') : null;
    if (tfile) { fs.mkdirSync(keepDir, { recursive: true }); fs.writeFileSync(tfile, transcript.join('\n')); fs.writeFileSync(path.join(keepDir, 'stderr.log'), errAll); }
    const tmpT = tfile || path.join(cell.root, 'transcript.jsonl');
    if (!tfile) fs.writeFileSync(tmpT, transcript.join('\n'));
    const skillInvoked = cp.spawnSync(process.execPath, [path.join(EVAL_DIR, 'lib', 'transcript-query.js'), tmpT, 'skill-invoked', 'ceo-agent']).status === 0;
    // cost_usd: the sum of every call's last total_cost_usd (an over-estimate if resume totals are cumulative, never an under-estimate);
    // prereg cc.resume_cost_cumulative=true switches to the last call's total (set only after the pilot transcripts show cumulative totals).
    const known = costTurnsKnown && !timedOut;
    const mainCost = ctx.P.cc.resume_cost_cumulative === true ? (costTurns[costTurns.length - 1] || 0) : costTurns.reduce((a, b) => a + b, 0);
    const o = { model, sessionId: sid, durationS: Math.round((Date.now() - t0) / 1000), cost: known ? Number(mainCost.toFixed(6)) : ceiling, costUnknown: !known, costTurns, skillObserved: skillInvoked, nestedAttempts: fs.readFileSync(nestedLog, 'utf8').split('\n').filter(Boolean).length };
    const knownSessions = new Set(transcript.flatMap((t) => readObjects(t).map((j) => j.session_id).filter((x) => typeof x === 'string')));
    const strays = sessionFiles(path.join(cell.home, '.claude')).filter((f) => !knownSessions.has(path.basename(f, '.jsonl'))).map((f) => ({ f, cost: lastCostIn(f) }));
    o.unaccounted = strays.length;
    // o.cost is the cell's own charge (what its turns reported, or the whole ceiling when the cell timed out and the report cannot be trusted);
    // the stray's spend comes on top of THAT, never on top of the reported sum, which can be lower than the ceiling.
    if (strays.length > 0) { // a claude of its own: charged what its trace says, or the whole ceiling when nothing readable; the campaign stops
      const readable = strays.reduce((a, x) => a + (x.cost === null ? 0 : x.cost), 0);
      const unreadableN = strays.filter((x) => x.cost === null).length;
      keepCopy(keepDir, cell);
      // every stray whose spend cannot be read is charged one whole ceiling of its own, on top of the cell's charge and the readable strays
      return failureRow(ctx, c, { ...o, cost: Number((o.cost + readable + ceiling * unreadableN).toFixed(6)), costUnknown: unreadableN > 0 || o.costUnknown,
        cls: 'infra_fail', cause: 'unaccounted_claude_session', detail: `${strays.length} session file(s) not started by this cell's own turns: ${strays.map((x) => path.basename(x.f)).join(', ')}` });
    }
    if (fail) {
      keepCopy(keepDir, cell);
      const row = failureRow(ctx, c, { ...o, cls: fail.cls, cause: fail.cause, detail: errAll.trim().split('\n').pop() });
      return row;
    }
    let scored;
    try { scored = TR.scoreCell(cell, c); } catch (e) {
      keepCopy(keepDir, cell);
      return failureRow(ctx, c, { ...o, cls: 'infra_fail', cause: 'marker_error', detail: e.message });
    }
    keepCopy(keepDir, cell);
    return {
      row: ctx.P.row, ...scored, model, pilot: ctx.pilot, runner: 'cc', runner_version: ctx.runnerVersion, session_id: sid,
      model_seen: sum.modelSeen, skill_invoked: skillInvoked, skill_invoked_observed: skillInvoked, duration_s: o.durationS, cost_usd: o.cost, cost_turns: costTurns, nested_claude_attempts: o.nestedAttempts, unaccounted_sessions: 0, failure_class: null,
      ...(o.costUnknown ? { cost_unknown: true, cost_estimated: true } : {}),
      ...(c.arm === 'change' ? { arm_manifest_sha256: ctx.changeSha } : {}),
    };
  } finally { cell.destroy(); }
}

// ---------------------------------------------------------------- G4 cell (real claude-native rail)
// G4: the rail starts exactly one hand per dispatch, but a rail that started more than one for the same cell must still not pass the cell's
// cap, so this wrapper adds up what the cell's earlier hand launches already reported (D0GATE_HAND_OUT) and gives each launch only what is
// left (--max-budget-usd), refusing (exit 97) once nothing is. It also tees the envelope, because the rail prints no spend.
function handWrapper(cell, realClaude) {
  const bin = path.join(cell.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // Everything between "read what is spent and reserved" and "write my reservation" runs under one flock, so two launches at the same time
  // cannot both see the same remaining budget. The reservation is settled after the run: dropped when the launch reported a spend (that
  // spend is then in D0GATE_HAND_OUT, which the tee fills live so a killed launch still leaves its envelope), kept when it did not.
  const reserve = [
    'const fs=require("fs"); const [out,resv,budget,id]=process.argv.slice(1); const last=new Map();',
    'for (const l of fs.readFileSync(out,"utf8").split("\\n")) { let j; try { j=JSON.parse(l); } catch { continue; } if (j && j.type==="result" && Number.isFinite(j.total_cost_usd)) last.set(String(j.session_id), j.total_cost_usd); }',
    'let s=0; for (const v of last.values()) s+=v;',
    'let r=0; try { for (const l of fs.readFileSync(resv,"utf8").split("\\n")) { const f=l.split(" "); if (f.length===2 && Number.isFinite(Number(f[1]))) r+=Number(f[1]); } } catch {}',
    'const rem=Number(budget)-s-r; if (rem<=0.0005) { process.stdout.write("refuse"); process.exit(0); }',
    'const d=Number(process.env.D0GATE_WRAPPER_TEST_DELAY||0); if (d>0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,d*1000);',
    'const amt=String(Number(rem.toFixed(4))); fs.appendFileSync(resv, id+" "+amt+"\\n"); process.stdout.write(amt);',
  ].join(' ');
  // settlement uses the same test as the reservation step: a line of type result carrying a finite total_cost_usd (a mention of the word elsewhere is not a spend)
  const settled = [
    'const fs=require("fs"); let ok=false;',
    'for (const l of fs.readFileSync(process.argv[1],"utf8").split("\\n")) { let j; try { j=JSON.parse(l); } catch { continue; } if (j && j.type==="result" && Number.isFinite(j.total_cost_usd)) ok=true; }',
    'process.exit(ok?0:1);',
  ].join(' ');
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/bash',
    `REAL='${realClaude.replace(/'/g, "'\\''")}'`,
    'args=("$@")',
    'if [ -n "${D0GATE_HAND_BUDGET:-}" ]; then',
    '  if [ -z "${D0GATE_HAND_OUT:-}" ]; then echo "d0gate: D0GATE_HAND_BUDGET is set but D0GATE_HAND_OUT is not set; refusing to start claude" >&2; exit 97; fi',
    '  LOCK="$D0GATE_HAND_OUT.lock"; RESV="$D0GATE_HAND_OUT.resv"; PRIV="$D0GATE_HAND_OUT.$$"; ID="$$"',
    '  : >>"$D0GATE_HAND_OUT"',
    // the rail seeds its own CLAUDE_CONFIG_DIR for the hand and removes it on exit: keep the hand own session files (its tool trajectory) before that
    '  copy_sessions() { if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -d "$CLAUDE_CONFIG_DIR/projects" ]; then mkdir -p "$D0GATE_HAND_OUT.sessions/$ID" && cp -R "$CLAUDE_CONFIG_DIR/projects/." "$D0GATE_HAND_OUT.sessions/$ID/"; fi 2>/dev/null; return 0; }',
    '  trap copy_sessions EXIT; trap "exit 143" TERM INT HUP',
    `  rem="$( ( flock 9; node -e '${reserve}' "$D0GATE_HAND_OUT" "$RESV" "$D0GATE_HAND_BUDGET" "$ID" ) 9>"$LOCK" )"`,
    '  if [ "$rem" = refuse ] || [ -z "$rem" ]; then echo "d0gate: the cell budget is spent or reserved; refusing to start another claude" >&2; exit 97; fi',
    '  args+=(--max-budget-usd "$rem")',
    '  "$REAL" "${args[@]}" | tee -a "$D0GATE_HAND_OUT" "$PRIV"; code="${PIPESTATUS[0]}"',
    `  ( flock 9; if node -e '${settled}' "$PRIV"; then grep -v "^$ID " "$RESV" >"$RESV.tmp"; mv "$RESV.tmp" "$RESV"; fi ) 9>"$LOCK"`,
    '  rm -f "$PRIV"; exit "$code"',
    'fi',
    'exec "$REAL" "${args[@]}"',
    '',
  ].join('\n'), { mode: 0o755 });
  return bin;
}
// depth-0 cells (G1-G3): any claude the agent starts is refused and counted; nothing real runs.
function denyWrapper(cell) {
  const bin = path.join(cell.root, 'bin-deny');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/bash',
    'echo "attempt: $*" >>"$D0GATE_NESTED_LOG"',
    'echo "d0gate: a depth-0 cell may not start claude; refused (the attempt is recorded)" >&2',
    'exit 97',
    '',
  ].join('\n'), { mode: 0o755 });
  return bin;
}
function whichClaude(excludeDir) {
  for (const d of String(process.env.PATH || '').split(':')) {
    if (!d || path.resolve(d) === path.resolve(excludeDir)) continue;
    const f = path.join(d, 'claude');
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
  }
  return null;
}
function lastJson(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch { /* next */ } }
  return null;
}
// The blocked-timeout exception is for a hand that simply did not finish: a scorable rail state, or the plain failure a killed worker leaves.
// An external-cause state such as engine_unavailable stays infra even when the hand also hung (this is checked here, not left to the
// error-text tests, because a timed-out hand leaves no envelope to classify).
function blockedTimeoutApplies(railStatus, on, hasBlock) {
  const eligible = SCORABLE_RAIL.has(railStatus) || railStatus === 'failure';
  return eligible && on === true && hasBlock === true;
}
function runG4(ctx, c, ceiling, budget, keepDir) {
  const t0 = Date.now();
  const cell = new Cell().init();
  const model = ctx.g4Model;
  try {
    seedConfig(cell, ctx.srcConfigDir);
    // the owner's one-time claude-native confirmation (the rail refuses without it); only that key is carried into the cell HOME
    fs.mkdirSync(path.join(cell.home, '.autopilot'), { recursive: true });
    fs.writeFileSync(path.join(cell.home, '.autopilot', 'config.json'), `${JSON.stringify({ implementer_claude_native: { confirmed_at: ctx.confirmedAt } })}\n`);
    const bin = handWrapper(cell, ctx.realClaude);
    const handOut = path.join(cell.root, '.d0gate', 'hand-out.json');
    fs.writeFileSync(handOut, '');
    const promptFile = path.join(cell.root, 'hand-prompt.txt');
    fs.writeFileSync(promptFile, TASKS.handPrompt());
    const on = c.arm === 'gate-on';
    const rules = on ? cell.putRules('g1-good.json', 'tmp') : null;
    const branch = `d0g/g4-${c.arm}-${c.rep}`;
    const argv = ['--runner', 'claude-native', '--model', model, '--prompt-file', promptFile, '--context-window', 'off', '--base', cell.baseSha,
      '--branch', branch, '--timeout', ctx.P.cc.hand_timeout, ...(on ? ['--gate-rules', rules] : [])];
    const env = cellEnv(cell, { PATH: `${bin}:${process.env.PATH || ''}`, D0GATE_HAND_OUT: handOut, D0GATE_HAND_BUDGET: String(budget) });
    const r = cp.spawnSync('timeout', ['--kill-after=30', String(ctx.P.cc.hand_outer_timeout_s), 'bash', ctx.railScript, ...argv],
      { cwd: cell.repo, env, encoding: 'utf8', maxBuffer: 1 << 28 });
    const exit = r.status === null ? 137 : r.status;
    const out = String(r.stdout || '');
    const errText = String(r.stderr || '');
    const env0 = lastJson(out) || {};
    const handText = fs.readFileSync(handOut, 'utf8');
    const sum = summary(handText);
    // session of the gated hand = the session of its hook records (the rail mints it and prints no id)
    const facts0 = cell.facts();
    const sessions = Object.keys(facts0.hook);
    const session = sessions.length ? sessions[0] : (sum.sessionId || '');
    // A hand the rail timed out may have spent after the last number it reported, and nothing measures that: its cell is charged the whole ceiling.
    const timedOut = env0.timed_out === true;
    const known = sum.costKnown && exit !== 124 && exit !== 137 && !timedOut;
    const o = { model, sessionId: session, durationS: Math.round((Date.now() - t0) / 1000), cost: known ? Number(sum.total.toFixed(6)) : ceiling, costUnknown: !known, costTurns: [Number(sum.total.toFixed(6))] };
    const keep = () => keepCopy(keepDir, cell, { 'hand-out.json': handOut, 'hand-prompt.txt': promptFile });
    if (keepDir) { fs.mkdirSync(keepDir, { recursive: true }); fs.writeFileSync(path.join(keepDir, 'rail-stdout.json'), out); fs.writeFileSync(path.join(keepDir, 'rail-stderr.log'), errText); }
    const fail = (cls, cause, detail) => { keep(); return failureRow(ctx, c, { ...o, cls, cause, detail }); };
    if (exit === 124 || exit === 137) return fail('infra_fail', 'runner_timeout', 'outer timeout');
    if (env0.status === 'precondition_failed' || exit === 2) return fail('infra_fail', 'precondition_failed', env0.error || env0.reason || errText.trim().split('\n').pop());
    if (!env0.status) return fail('infra_fail', 'rail_no_output', errText.trim().split('\n').pop());
    if (sum.results.some((x) => x.subtype === 'error_max_budget_usd' && x.is_error === true)) return fail('infra_fail', 'budget_exceeded');
    // ORDER: classify first. A hand error (quota, authentication, any terminal error event, a failure status) is infra whatever else is
    // true of the cell; only what is left may use the blocked-timeout exception below. A timed-out hand has no trustworthy envelope, so
    // an empty output or an unknown cost does not count against it.
    const errBlob = `${errText}\n${env0.error || ''}`;
    const cg = classify(0, sum, errBlob);
    let hard = cg && !['empty_output', 'cost_unknown'].includes(cg.cause) ? cg : null;
    if (!hard && (timedOut || !SCORABLE_RAIL.has(env0.status))) { // quota/auth wording in the error text of a hand that did not end in a scorable state
      if (QUOTA_RE.test(errBlob)) hard = { cls: 'infra_fail', cause: 'quota' };
      else if (AUTH_RE.test(errBlob)) hard = { cls: 'infra_fail', cause: 'authentication' };
    }
    if (hard) return fail(hard.cls, hard.cause, env0.error);
    // A hand the rail timed out is an observation, not an infra failure, when the gate demonstrably blocked it first (ON arm, at least one
    // block record): the gate keeping the hand from finishing is the cost side the decision table measures. Anything else stays infra.
    let timedOutAfterBlock = false;
    if (timedOut) {
      const blocked = blockedTimeoutApplies(env0.status, on, Object.values(facts0.hook).some((recs) => recs.some((r) => r.decision === 'block')));
      if (!blocked) return fail('infra_fail', 'runner_timeout', 'the rail timed the hand out');
      timedOutAfterBlock = true;
    }
    // a failure status is infra whatever classify says (its cause when it has one); the only exception is the blocked timeout above
    // only these rail states are an observation of the hand (committed, nothing to do, left dirty, asked a question); failure, engine_unavailable
    // (seen: a quota stop) and any state not listed are infra
    if (!SCORABLE_RAIL.has(env0.status) && !timedOutAfterBlock) return fail('infra_fail', cg ? cg.cause : 'runner_error', env0.error);
    if (cg && !timedOutAfterBlock) return fail('infra_fail', cg.cause);
    // derived ledger: one accepted dispatch, its arm state, its result (only status committed is a done worker)
    const lf = path.join(cell.root, '.d0gate', 'ledger.jsonl');
    const ts = Date.now();
    const w = (o2) => fs.appendFileSync(lf, `${JSON.stringify(o2)}\n`);
    w({ kind: 'call', ts, n: 1, accepted: true, argv: JSON.stringify(['bash', ctx.railScript, ...argv]), cwd: cell.repo, repo: cell.repo, runner: 'claude-native',
      gate_rules_flag: on, gate_rules_file: on ? rules : '', rules_copy: '', rules_sha: '', base_sha: cell.baseSha, session });
    w({ kind: 'arm', ts, n: 1, armed: on && sessions.length > 0 });
    w({ kind: 'result', ts, n: 1, status: (env0.status === 'committed' || (timedOutAfterBlock && env0.commit)) ? 'done' : (timedOutAfterBlock ? 'timed_out' : env0.status), worker: 'claude-native', branch: env0.branch || branch, result_sha: env0.commit || '', session });
    let scored;
    try { scored = TR.scoreCell(cell, c); } catch (e) { return fail('infra_fail', 'marker_error', e.message); }
    keep();
    // the hand did not finish: completed and hand_clean are false whatever the tree looks like; violating is what the final tree (if any) shows
    if (timedOutAfterBlock) scored.g4 = { ...scored.g4, completed: false, hand_clean: false };
    return {
      row: ctx.P.row, ...scored, model, pilot: ctx.pilot, runner: 'cc', runner_version: ctx.runnerVersion, session_id: session,
      model_seen: sum.modelSeen, rail_status: env0.status, duration_s: o.durationS, cost_usd: o.cost, cost_turns: o.costTurns, failure_class: null,
      ...(timedOutAfterBlock ? { failure_cause: 'timed_out_after_gate_block' } : {}),
      ...(o.costUnknown ? { cost_unknown: true, cost_estimated: true } : {}),
    };
  } finally { cell.destroy(); }
}

// runCell(ctx, c, ceiling, budget, keepDir) -> a row (always complete in shape)
function runCell(ctx, c, ceiling, budget, keepDir) {
  const row = c.task === T.G4 ? runG4(ctx, c, ceiling, budget, keepDir) : runD0(ctx, c, ceiling, budget, keepDir);
  const probs = shapeProblems(row);
  if (probs.length) throw new Error(`cc runner produced an incomplete row for ${c.task}|${c.arm}|${c.rep}: ${probs.join(', ')}`);
  return row;
}

module.exports = { blockedTimeoutApplies, handWrapper, denyWrapper, runCell, shapeProblems, summary, classify, falseShape, whichClaude, REPO_ROOT, D0_MARKER };
