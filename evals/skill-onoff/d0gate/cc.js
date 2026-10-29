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
// Cost: per session the LAST result's total_cost_usd (cumulative), summed over sessions.
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
    else for (const f of ['gate_exercised', 'completed', 'violating', 'hand_clean']) if (!isBool(row.g4[f])) p.push(`g4.${f}`);
  } else {
    if (!isBool(row.skill_invoked)) p.push('skill_invoked');
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
  ? { g4: { gate_exercised: false, completed: false, violating: false, hand_clean: false } }
  : { markers: { [D0_MARKER[c.task]]: false }, skill_invoked: false });
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
}
const failureRow = (ctx, c, o) => ({
  row: ctx.P.row, task_id: c.task, arm: c.arm, rep: c.rep, ...falseShape(c), model: o.model, pilot: ctx.pilot, runner: 'cc',
  runner_version: ctx.runnerVersion, session_id: o.sessionId || '', duration_s: o.durationS, cost_usd: o.cost,
  cost_turns: o.costTurns || [], ...(o.costNested ? { cost_nested_usd: o.costNested } : {}),
  ...(o.costUnknown ? { cost_unknown: true, cost_estimated: true } : {}), failure_class: o.cls, failure_cause: o.cause,
  ...(o.detail ? { failure_detail: String(o.detail).slice(0, 300) } : {}),
});

// ---------------------------------------------------------------- depth-0 cell (G1-G3)
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
    // The depth-0 turn itself runs the REAL claude by absolute path (counted once, from its own result events). The cell PATH starts with
    // the capped wrapper, so a `claude` the agent starts itself (Bash) gets --max-budget-usd = what is left of the cell and its spend is
    // teed to nested-out.jsonl and added to the cell's cost.
    const nestedOut = path.join(cell.root, '.d0gate', 'nested-out.jsonl');
    fs.writeFileSync(nestedOut, '');
    const bin = handWrapper(cell, ctx.realClaude);
    const baseEnv = cellEnv(cell, { PATH: `${bin}:${process.env.PATH || ''}`, D0GATE_HAND_OUT: nestedOut, D0GATE_WORKER: D0_WORKER[c.task] });
    const prompts = TASKS.turns(c.task, ctx.P.invocation_prefix);
    const transcript = [];
    let sid = '';
    const costTurns = [];
    let costTurnsKnown = true;
    let nested = { total: 0, costKnown: true, results: [] };
    let fail = null;
    let exit = 0;
    let errAll = '';
    let sum = null;
    let timedOut = false;
    for (let i = 0; i < prompts.length; i++) {
      const spentSoFar = costTurns.reduce((a, b) => a + b, 0) + nested.total; // conservative: every call added, even if resume totals are cumulative
      const left = Number((budget - spentSoFar).toFixed(4));
      if (i > 0 && left <= 0.0005) { fail = { cls: 'infra_fail', cause: 'budget_exceeded' }; break; }
      if (i > 0 && !sid) { fail = { cls: 'infra_fail', cause: 'resume_unavailable' }; break; }
      const env = { ...baseEnv, D0GATE_HAND_BUDGET: String(Math.max(left, 0.0005)) };
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
      nested = summary(fs.readFileSync(nestedOut, 'utf8'));
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
    const known = costTurnsKnown && !timedOut && nested.results.every((r) => num(r.total_cost_usd) !== null);
    const mainCost = ctx.P.cc.resume_cost_cumulative === true ? (costTurns[costTurns.length - 1] || 0) : costTurns.reduce((a, b) => a + b, 0);
    const o = { model, sessionId: sid, durationS: Math.round((Date.now() - t0) / 1000), cost: known ? Number((mainCost + nested.total).toFixed(6)) : ceiling, costUnknown: !known, costTurns, costNested: Number(nested.total.toFixed(6)) };
    if (fail) {
      keepCopy(keepDir, cell);
      const row = failureRow(ctx, c, { ...o, cls: fail.cls, cause: fail.cause, detail: errAll.trim().split('\n').pop() });
      row.skill_invoked = skillInvoked;
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
      model_seen: sum.modelSeen, skill_invoked: skillInvoked, duration_s: o.durationS, cost_usd: o.cost, cost_turns: costTurns, cost_nested_usd: o.costNested, failure_class: null,
      ...(o.costUnknown ? { cost_unknown: true, cost_estimated: true } : {}),
      ...(c.arm === 'change' ? { arm_manifest_sha256: ctx.changeSha } : {}),
    };
  } finally { cell.destroy(); }
}

// ---------------------------------------------------------------- G4 cell (real claude-native rail)
function handWrapper(cell, realClaude) {
  const bin = path.join(cell.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // The rail starts `claude -p ... --output-format json`; this wrapper tees the envelope (spend) and adds the cell's budget cap.
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/bash',
    `REAL='${realClaude.replace(/'/g, "'\\''")}'`,
    'args=("$@")',
    '[ -z "${D0GATE_HAND_BUDGET:-}" ] || args+=(--max-budget-usd "$D0GATE_HAND_BUDGET")',
    '"$REAL" "${args[@]}" | tee -a "$D0GATE_HAND_OUT"',
    'exit "${PIPESTATUS[0]}"',
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
    const known = sum.costKnown && exit !== 124 && exit !== 137;
    const o = { model, sessionId: session, durationS: Math.round((Date.now() - t0) / 1000), cost: known ? Number(sum.total.toFixed(6)) : ceiling, costUnknown: !known, costTurns: [Number(sum.total.toFixed(6))] };
    const keep = () => keepCopy(keepDir, cell, { 'hand-out.json': handOut });
    if (keepDir) { fs.mkdirSync(keepDir, { recursive: true }); fs.writeFileSync(path.join(keepDir, 'rail-stdout.json'), out); fs.writeFileSync(path.join(keepDir, 'rail-stderr.log'), errText); }
    const fail = (cls, cause, detail) => { keep(); return failureRow(ctx, c, { ...o, cls, cause, detail }); };
    if (exit === 124 || exit === 137) return fail('infra_fail', 'runner_timeout', 'outer timeout');
    if (env0.status === 'precondition_failed' || exit === 2) return fail('infra_fail', 'precondition_failed', env0.error || env0.reason || errText.trim().split('\n').pop());
    if (!env0.status) return fail('infra_fail', 'rail_no_output', errText.trim().split('\n').pop());
    // A hand the rail timed out is an observation, not an infra failure, when the gate demonstrably blocked it first (ON arm, at least one
    // block record): the gate keeping the hand from finishing is the cost side the decision table measures. Anything else stays infra.
    let timedOutAfterBlock = false;
    if (env0.timed_out === true) {
      const blocked = on && Object.values(facts0.hook).some((recs) => recs.some((r) => r.decision === 'block'));
      if (!blocked) return fail('infra_fail', 'runner_timeout', 'the rail timed the hand out');
      timedOutAfterBlock = true;
    }
    if (sum.results.some((x) => x.subtype === 'error_max_budget_usd' && x.is_error === true)) return fail('infra_fail', 'budget_exceeded');
    if (env0.status === 'failure' && !timedOutAfterBlock) {
      const g = classify(1, sum, `${errText}\n${env0.error || ''}`);
      return fail('infra_fail', g ? g.cause : 'runner_error', env0.error);
    }
    if (!sum.costKnown && !timedOutAfterBlock) return fail('infra_fail', 'cost_unknown');
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

module.exports = { runCell, shapeProblems, summary, classify, falseShape, whichClaude, REPO_ROOT, D0_MARKER };
