#!/usr/bin/env node
// stage-graph-cell.js — per-cell observation + judgement for the stage-graph eval (P0, plan
// docs/plans/2026-10-06-dev-flow-stage-graph.md §4 P0; rules frozen in prereg/stage-graph.{md,json}).
//
// It reads ONE claude -p stream-json transcript and extracts, in transcript order, from Bash tool_use:
//   session-mode.js set --size <S> [--bug] [--urgent]   -> the FIRST such call that did not fail
//   stage-advance.js ... --to <node>                    -> the walk (consecutive duplicates collapsed:
//                                                          a same-node update is not a transition)
//   probe-unknown.js classify ...                       -> the FIRST call; its tool_result JSON gives
//                                                          eligible_max (see "first rung" below)
// session-mode / classify: a Bash command whose paired tool_result has is_error:true is discarded (the
// write was refused, the marker did not change). A tool_use with no paired result is counted (synthetic/aborted
// transcripts).
// stage-advance (amend-2-instrument, fix 2): each INVOCATION's own outcome is read from its JSON stdout in the
// tool_result ({allowed:true,...} written; {allowed:false,...} exit 3 or {bump_to,...} exit 4 refused), matched to
// the invocations of the command in order. `stage-advance --to X && bash run-tests.sh` with a red test is_error
// the whole call but the advance was written, so the call's is_error is NOT the outcome.
// amend-3-extractor: the target node is read from that JSON too (`to`/`stage`), so `--to $n` and `for n in ..; do ..--to $n` work;
// an invocation whose JSON is not visible (stdout redirected, or the records do not match the invocations) is `ambiguous`:
// never written, not in the walk, obs.ambiguous set (supersedes the amend-2 call-level is_error fallback for stage-advance).
// classify: the unknown_probe object is picked out of a result holding several JSON objects (see classifyResult).
//
// First rung (defined precisely): "none" when no classify call exists; otherwise the `eligible_max`
// field of the first classify result. eligible_max is signal-determined (S4 zero-hit term -> U1, all
// terms hit -> U0) and does NOT depend on consult seat qualification, so it is stable across hosts,
// unlike `recommend` (U1 vs none/not-heterogeneous). An unparseable result is "unobserved" (fails).
//
// Tool ordering is cross-checked against lib/transcript-query.js `tool-events` (the harness's own
// reader); a count mismatch fails closed. transcript-query.js is digest-frozen in prereg/FROZEN.json,
// so tool_result access and full (untruncated) commands live here instead of extending it.
//
// Usage:
//   stage-graph-cell.js --task <id> --transcript <file> [--work-done true|false] [--markers]
//     [--repo <dir> --base-sha <sha>]   repo context for the rung-consistency derivation (without it: pinned rule)
//     [--extracted-out <file>]          write {task,cell,observed,judged} (judged is not ANDed with work_done)
//     --tasks-dir <dir> / --expected <file> override the defaults (tests).
//     stdout: one JSON object (observation + judgement), or with --markers the marker_sg_* lines.
// Exit: 0 judged (a failed judgement is still exit 0) · 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const BASE = path.join(HERE, '..');
const REPO = path.join(BASE, '..', '..');

// expected first rung -> accepted observed rungs. "none" tolerates a local-only consult (U0): not
// escalating is the claim; U0 and U1 are exact because they are the discriminating cells.
const RUNG_ACCEPTS = { none: ['none', 'U0'], U0: ['U0'], U1: ['U1'] };

// amend-2-instrument (fix 3): for these briefs the first rung is scored by CONSISTENCY with the probe, not pinned.
// Their rung depends on which nouns the agent hands to classify (a free variable the brief cannot fix), so the
// check re-derives eligible_max from the agent's own --terms against the frozen base tree.
const RUNG_CONSISTENCY_TASKS = ['stage-graph-l-feature', 'stage-graph-xl-deliverable', 'stage-graph-l-u0-known'];

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line, like transcript-query */ }
  }
  return out;
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n');
  return '';
}

function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const body = text.slice(start);
  for (let end = body.length; end > 0; end -= 1) {
    if (body[end - 1] !== '}') continue;
    try { return JSON.parse(body.slice(0, end)); } catch { /* shorter */ }
  }
  return null;
}

// every top-level JSON object in a text (braces balanced, string-aware); non-JSON braces are skipped
function jsonObjects(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i += 1; continue; }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let k = i; k < text.length; k += 1) {
      const c = text[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) { i += 1; continue; }
    try { out.push(JSON.parse(text.slice(i, end + 1))); i = end + 1; } catch { i += 1; }
  }
  return out;
}

// the stdout objects stage-advance.js prints: written {allowed:true,...} · denied {allowed:false,...} · bump {bump_to,...}
const isSessionModeJson = (o) => !!o && typeof o === 'object' && o.ok === true && typeof o.marker_path === 'string';
const isStageAdvanceJson = (o) => !!o && typeof o === 'object' && (typeof o.allowed === 'boolean' || typeof o.bump_to === 'string');

// --terms value of a classify command; terms null when it cannot be read statically (shell expansion)
function parseTerms(fragment) {
  const m = fragment.match(/--terms(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/);
  if (!m) return { present: false, terms: [] };
  const raw = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
  if (/[$`()]/.test(raw)) return { present: true, terms: null };
  return { present: true, terms: raw.split(',').map((t) => t.trim()).filter(Boolean) };
}

// eligible_max the probe yields for these terms with no other signal, derived on the FROZEN BASE tree.
// Mirrors probe-unknown.js termHits' repo lookup (a case-insensitive grep of the tracked files); knowledge/memory
// dirs do not exist in a cell. Any zero-hit term (S4) -> U1; --fast-moving -> U2; all hit / no terms -> U0.
// null = not derivable (no repo context, unreadable terms, grep error).
function deriveEligibleMax(terms, fastMoving, ctx) {
  if (!ctx || !ctx.repo || !ctx.baseSha || terms === null) return null;
  let zero = 0;
  for (const t of terms) {
    const r = cp.spawnSync('git', ['grep', '-il', '--', t, ctx.baseSha], { cwd: ctx.repo, encoding: 'utf8', timeout: 15000 });
    if (r.status === 0) continue;
    if (r.status === 1) { zero += 1; continue; }
    return null;
  }
  if (fastMoving) return terms.length ? 'U2' : null;
  return zero ? 'U1' : 'U0';
}

function toolUses(file) {
  const uses = [];
  const results = new Map();
  for (const j of readJsonl(file)) {
    const content = j && j.message && j.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'tool_use') uses.push({ id: b.id || null, name: String(b.name || ''), input: b.input || {} });
      else if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { is_error: b.is_error === true, text: resultText(b.content) });
    }
  }
  return { uses, results };
}

function queryEventCount(file) {
  const r = cp.spawnSync('node', [path.join(HERE, 'transcript-query.js'), file, 'tool-events'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).length;
}

// amend-3-extractor (defect 3): a classify call's stdout may hold several JSON objects (a chained `stage-advance ... &&`
// object before it, other commands' output after it). The classify result is the one carrying eligible_max
// (artifact_type unknown_probe) wherever it sits; a truncated one (| head -c) is read by its eligible_max field.
function classifyResult(text) {
  const objs = jsonObjects(text).filter((o) => o && typeof o === 'object' && typeof o.eligible_max === 'string');
  const probe = objs.find((o) => o.artifact_type === 'unknown_probe') || objs[0];
  if (probe) return probe;
  const m = text.match(/"eligible_max"\s*:\s*"(none|U[0-9])"/);
  return m ? { eligible_max: m[1] } : null;
}

// amend-3-extractor (defects 1+2): the invocations of stage-advance.js in one Bash command, in EXECUTION order, each with
// its own outcome. Targets come from the invocation's own JSON stdout (`to`, else `stage`), so `--to $n` and
// `for n in ...; do ... --to $n; done` (one site, several invocations) yield every written node in order. A literal
// `--to <node>` is only a fallback name when the outcome is not visible. An invocation whose JSON is not visible is
// `ambiguous` and NEVER counts as written (nor as matched in a walk): stdout redirected (>/dev/null, > file), or the
// JSON records in the result do not add up to the visible invocations (cut by tail, a loop of unknown length, a
// skipped command). A record is read tolerantly (`{"allowed":true,"from":..,"to":".."` cut by `head -c N` still names
// allowed + to).
const STDOUT_REDIRECT = /(?:^|\s)(?:1?>>?|&>>?)\s*(?!&)\S/;
function stageAdvanceRecords(text) {
  const starts = [...text.matchAll(/\{\s*"(?:allowed|bump_to)"\s*:/g)].map((m) => m.index);
  return starts.map((st, i) => {
    const chunk = text.slice(st, i + 1 < starts.length ? starts[i + 1] : text.length);
    const al = chunk.match(/^\{\s*"allowed"\s*:\s*(true|false)/);
    const to = chunk.match(/"to"\s*:\s*"([a-z][a-z-]*)"/) || chunk.match(/"stage"\s*:\s*"([a-z][a-z-]*)"/);
    return { written: !!al && al[1] === 'true', to: to ? to[1] : null };
  });
}
function stageAdvanceInvocations(cmd, res) {
  const loops = [...cmd.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+([^;\n]*?)\s*;\s*do\b([\s\S]*?)\bdone\b/g)].map((m) => {
    const bodyStart = m.index + m[0].length - m[3].length - 4; // "done"
    const unknown = /[$`()*]/.test(m[2]);
    return { v: m[1], items: unknown ? null : m[2].trim().split(/\s+/).filter(Boolean), from: bodyStart, to: m.index + m[0].length, sites: [] };
  });
  const sites = [];
  for (const m of cmd.matchAll(/stage-advance\.js["']?((?:[^\n;|&]|&>|(?<=>)&\d)*)/g)) {
    const toM = m[1].match(/--to(?:=|\s+)(?:["']?([a-z][a-z-]*)["']?(?=\s|$)|["']?\$\{?([A-Za-z_]\w*)\}?["']?(?=\s|$))/);
    if (!toM) continue; // not an advance invocation (cat/grep of the script, --help, ...)
    const loop = loops.find((l) => m.index >= l.from && m.index < l.to) || null;
    const site = { lit: toM[1] || null, vr: toM[2] || null, hidden: STDOUT_REDIRECT.test(m[1]), loop };
    if (loop) loop.sites.push(site);
    sites.push(site);
  }
  if (!sites.length) return [];
  const groups = [];
  for (const s of sites) {
    if (!s.loop) groups.push({ sites: [s], mult: 1 });
    else if (!groups.some((g) => g.loop === s.loop)) groups.push({ loop: s.loop, sites: s.loop.sites, mult: s.loop.items ? s.loop.items.length : null });
  }
  const countKnown = groups.every((g) => g.mult !== null);
  const visible = countKnown ? groups.reduce((n, g) => n + g.sites.filter((s) => !s.hidden).length * g.mult, 0) : -1;
  const recs = res ? stageAdvanceRecords(res.text) : [];
  const attributable = countKnown && recs.length === visible;
  const out = [];
  let k = 0;
  for (const g of groups) {
    for (let i = 0; i < (g.mult === null ? 1 : g.mult); i += 1) {
      for (const s of g.sites) {
        const argvTo = s.lit || (s.vr && g.loop && s.vr === g.loop.v && g.loop.items ? g.loop.items[i] : null);
        if (s.hidden) out.push({ to: argvTo, written: false, outcome: 'ambiguous', basis: 'hidden' });
        else if (attributable) { const r = recs[k]; k += 1; out.push({ to: r.to || argvTo, written: r.written, outcome: r.written ? 'written' : 'refused', basis: 'json' }); }
        else out.push({ to: argvTo, written: false, outcome: 'ambiguous', basis: 'unattributable' });
      }
    }
  }
  return out;
}

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

function extract(file, ctx) {
  const { uses, results } = toolUses(file);
  const obs = { set: null, set_calls: 0, walk_raw: [], walk: [], rung: 'none', classify_called: false, classify: null, derived_eligible_max: null, stage_calls: [], set_outcomes: [], ambiguous: false, error: null };
  const qn = queryEventCount(file);
  if (qn === null || qn !== uses.length) {
    obs.error = `tool_use count mismatch (reader ${qn} vs parsed ${uses.length})`;
    return obs;
  }
  for (const u of uses) {
    if (u.name !== 'Bash') continue;
    const cmd = String(u.input.command || '');
    const res = u.id ? results.get(u.id) : null;
    const refused = !!(res && res.is_error);
    // session-mode: one outcome per invocation, from its own JSON stdout {ok:true, marker_path, ...} (amend-2-instrument, same
    // attribution as stage-advance below; every session-mode subcommand prints that object on success and nothing on stdout
    // on failure, so the invocations of the call are aligned with the ok-objects in order; a count mismatch -> old rule)
    const sms = [...cmd.matchAll(/session-mode\.js["']?\s+([a-z][a-z-]*)\b([^\n;&|]*)/g)];
    if (sms.length) {
      const smJson = res ? jsonObjects(res.text).filter(isSessionModeJson) : [];
      const smAttr = smJson.length === sms.length;
      sms.forEach((m) => {
        if (m[1] !== 'set') return;
        if (!smAttr) obs.ambiguous = true;
        const written = smAttr ? true : !refused;
        const sz = m[2].match(/--size(?:=|\s+)["']?(XS|S|M|L|XL)["']?(?=\s|$)/);
        obs.set_outcomes.push({ size: sz ? sz[1] : null, written, basis: smAttr ? 'json' : 'is_error' });
        if (!written || !sz) return;
        obs.set_calls += 1;
        if (!obs.set) obs.set = { size: sz[1], bug: /(^|\s)--bug(\s|$)/.test(m[2]), urgent: /(^|\s)--urgent(\s|$)/.test(m[2]) };
      });
    }
    // stage-advance: one outcome per invocation, from its own JSON stdout (header; amend-3 rules in stageAdvanceInvocations)
    for (const inv of stageAdvanceInvocations(cmd, res)) {
      if (inv.outcome === 'ambiguous') obs.ambiguous = true;
      obs.stage_calls.push({ to: inv.to, written: inv.written, basis: inv.basis, outcome: inv.outcome });
      if (inv.written && inv.to) obs.walk_raw.push(inv.to);
    }
    // first classify
    const cl = cmd.match(/probe-unknown\.js["']?\s+classify\b([^\n;&|]*)/);
    if (!obs.classify_called && cl && !refused) {
      obs.classify_called = true;
      const j = res ? classifyResult(res.text) : null;
      obs.rung = j && typeof j.eligible_max === 'string' ? j.eligible_max : 'unobserved';
      const pt = parseTerms(cl[1]);
      const fast = /(^|\s)--fast-moving(\s|$)/.test(cl[1]);
      obs.classify = { terms: pt.terms, terms_present: pt.present, fast_moving: fast, at_intent: !obs.walk_raw.some((n) => n !== 'intent') };
      obs.derived_eligible_max = deriveEligibleMax(pt.terms, fast, ctx);
    }
  }
  for (const n of obs.walk_raw) if (obs.walk[obs.walk.length - 1] !== n) obs.walk.push(n);
  return obs;
}

// Rung judgement. Consistency briefs (RUNG_CONSISTENCY_TASKS) with a derivable probe: the agent's first classify
// must report what the probe yields for the terms the agent passed (deriveEligibleMax); a U0 key also needs that
// classify to have happened at intent (before any stage past intent was written) and a `none` key needs no
// classify at all. A later classify may also report U0 for terms that were zero-hit at base (the agent's own
// files can create hits). Otherwise, or when the derivation is not possible, the pinned RUNG_ACCEPTS rule applies.
// obs.rung_check records which rule ran.
function judgeRung(answer, obs) {
  const pinned = (RUNG_ACCEPTS[answer.first_rung] || []).includes(obs.rung);
  if (!RUNG_CONSISTENCY_TASKS.includes(answer.task_id)) return pinned;
  if (!obs.classify_called) {
    obs.rung_check = { mode: 'consistency', classify_called: false };
    return answer.first_rung === 'none';
  }
  const derived = obs.derived_eligible_max;
  if (derived === null || derived === undefined) { obs.rung_check = { mode: 'pinned-fallback', reason: 'derivation unavailable' }; return pinned; }
  const atIntent = !!(obs.classify && obs.classify.at_intent);
  const consistent = obs.rung === derived || (!atIntent && derived === 'U1' && obs.rung === 'U0');
  const timing = answer.first_rung === 'none' || atIntent;
  obs.rung_check = { mode: 'consistency', derived, observed: obs.rung, consistent, at_intent: atIntent, timing_ok: timing };
  return consistent && timing;
}

function judge(answer, expectedCell, obs, workDone, researchCell) {
  const j = { size: false, bug: false, urgent: false, walk: false, rung: false, work: workDone === true };
  if (obs.error) return { ...j, pass: false };
  j.rung = judgeRung(answer, obs);
  if (obs.set) {
    j.size = obs.set.size === answer.size;
    j.bug = obs.set.bug === answer.bug;
    j.urgent = obs.set.urgent === answer.urgent;
  }
  // amend-2-instrument: on a consistency brief the walk cell follows the consistent rung — the `research` variant when the
  // agent's (probe-consistent) first classify says >= U1, the key's own cell when U0/none. Pinned tasks keep their cell.
  let walkCell = expectedCell;
  obs.walk_variant = 'key';
  const rc = obs.rung_check;
  if (researchCell && rc && rc.mode === 'consistency' && rc.consistent && rc.timing_ok && /^U[1-9]$/.test(rc.observed || '')) { walkCell = researchCell; obs.walk_variant = 'research'; }
  const hIdx = walkCell.walk.indexOf(answer.horizon_node);
  const need = hIdx >= 0 ? hIdx + 1 : answer.horizon_index + 1;
  const want = walkCell.walk.slice(0, need);
  j.walk = obs.walk.length >= need && want.every((n, i) => obs.walk[i] === n);
  j.pass = j.size && j.bug && j.urgent && j.walk && j.rung && j.work;
  return j;
}

function loadKey(taskId, tasksDir, expectedFile) {
  const answer = JSON.parse(fs.readFileSync(path.join(tasksDir, taskId, 'answer.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const cell = expected.cells.find((c) => c.id === answer.cell);
  if (!cell) throw new Error(`answer.json cell not in expected.json: ${answer.cell}`);
  // consistency briefs: the research variant of the key's cell (same axes, research instead of noresearch)
  let researchCell = null;
  if (RUNG_CONSISTENCY_TASKS.includes(taskId)) {
    researchCell = expected.cells.find((c) => c.id === answer.cell.replace('.noresearch.', '.research.'));
    if (!researchCell || researchCell.research !== 'research') throw new Error(`no research variant of ${answer.cell} in expected.json`);
  }
  return { answer, cell, researchCell };
}

// answer.json must agree with its expected.json cell (a stale key cannot silently score)
function validateKey(answer, cell) {
  const errs = [];
  if (!SIZES.includes(answer.size)) errs.push('size not a size');
  if (cell.size !== answer.size) errs.push('size != cell.size');
  if (cell.bug !== answer.bug) errs.push('bug != cell.bug');
  if (cell.urgent !== answer.urgent) errs.push('urgent != cell.urgent');
  if (cell.research !== answer.research) errs.push('research != cell.research');
  if (cell.units !== answer.units) errs.push('units != cell.units');
  if (!Number.isInteger(answer.horizon_index) || answer.horizon_index < 0 || answer.horizon_index >= cell.walk.length) errs.push('horizon_index out of walk');
  else if (cell.walk[answer.horizon_index] !== answer.horizon_node) errs.push('horizon_node != walk[horizon_index]');
  if (!(answer.first_rung in RUNG_ACCEPTS)) errs.push('first_rung unknown');
  if (typeof answer.horizon_justification !== 'string' || answer.horizon_justification.length < 20) errs.push('horizon_justification missing');
  return errs;
}

module.exports = { extract, judge, loadKey, validateKey, RUNG_ACCEPTS, RUNG_CONSISTENCY_TASKS, SIZES };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const task = opt('--task');
  const tr = opt('--transcript');
  if (!task || !tr) { console.error('usage: stage-graph-cell.js --task <id> --transcript <file> [--work-done true|false] [--markers] [--repo <dir> --base-sha <sha>] [--extracted-out <file>]'); process.exit(2); }
  const tasksDir = opt('--tasks-dir') || path.join(BASE, 'tasks');
  const expectedFile = opt('--expected') || path.join(REPO, 'hooks', 'tests', 'fixtures', 'stage-graph', 'expected.json');
  let key;
  let obs;
  try { key = loadKey(task, tasksDir, expectedFile); obs = extract(tr, opt('--repo') && opt('--base-sha') ? { repo: opt('--repo'), baseSha: opt('--base-sha') } : null); } catch (e) { console.error(`stage-graph-cell: ${e.message}`); process.exit(2); }
  const j = judge(key.answer, key.cell, obs, opt('--work-done') === 'true', key.researchCell);
  // retained raw extraction + UNMASKED judgement (amend-2-instrument fix 1): the markers below AND everything with work_done
  if (opt('--extracted-out')) {
    try { fs.writeFileSync(opt('--extracted-out'), `${JSON.stringify({ task, cell: key.answer.cell, observed: obs, judged: j })}\n`); } catch (e) { console.error(`stage-graph-cell: extracted-out: ${e.message}`); }
  }
  if (argv.includes('--markers')) {
    // every marker is ANDed with work_done, so a no-op cell (e.g. no stage calls, rung "none") scores false everywhere
    for (const k of ['size', 'bug', 'urgent', 'walk', 'rung', 'work', 'pass']) console.log(`marker_sg_${k}=${j[k] === true && j.work === true ? 'true' : 'false'}`);
  } else {
    console.log(JSON.stringify({ task, cell: key.answer.cell, observed: obs, judged: j }));
  }
}
