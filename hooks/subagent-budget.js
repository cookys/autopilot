#!/usr/bin/env node
/**
 * subagent-budget — PreToolUse Task|Agent (default-on). A per-lane relay and turn ceiling on subagent dispatch.
 *
 * WHY: cuda revival.3d (2026-10-16/17) ran 104 sonnet subagents in a session with no session-mode level: 8758 turns,
 * about $715 at API prices, with lanes re-dispatched ~10 times. The only budget that survived a relay was the managed
 * campaign's, and the parallel-units recipe bypasses it. This hook makes the relay chain of one LANE share one account,
 * re-derived at dispatch time from the subagent transcripts themselves (plan project/plans/2026-10-18-subagent-budget-gate.md).
 *
 * COUNTS come from the session's subagents dir (<dirname(transcript_path)>/<session_id>/subagents, or the dir of
 * transcript_path itself when a subagent is the dispatcher), agent-*.jsonl, on every call (never costs.jsonl, which
 * misses in-flight background agents). The hook only READS transcripts. Persisted state: a parse cache keyed by
 * (path, size, mtimeMs) and the card pointers, both under the live-state dir.
 *
 * LANE KEY: first of the brief's first 5 lines matching `Lane: <slug>`; else the Agent `description`, first line, trimmed,
 * lower-cased; else no lane (counts only toward the root total). A transcript's lane uses the same rule on its first user
 * message, then the nearest ancestor's (meta.json parentAgentId chain, at most 8 hops) brief Lane:, then `description` in
 * agent-<id>.meta.json. A brief with no Lane: from a subagent dispatcher joins that dispatcher's lane. Nested transcripts
 * (spawnDepth >= 2) add turns to their lane but take no dispatch slot (COUNT_NESTED_DISPATCHES=false, decided by owner card d-53cf611a). `Role: reviewer` in the first 5 lines excludes a brief
 * from the lane RELAY count (its turns still count).
 *
 * LANE REQUIRED (owner card d-0bb18035): a brief whose line 1 starts with `Engine:` (same test as foreman-guard's
 * isAutopilotDispatched) must carry a lane: a valid `Lane:` in its first 5 lines, or one inherited from the dispatching
 * subagent / its ancestors. Otherwise remind mode denies (marker-independent, no panel card: a format problem the
 * dispatcher fixes itself), warn mode only warns, off ignores. `Budget-Ack:` passes it. A brief not starting with
 * `Engine:` (Explore etc.) still falls back to `description` and only counts toward the root total.
 *
 * CEILINGS (default warn mode: note only, no deny; remind mode: deny): lane dispatches >= lane_dispatch_max (default 4, so
 * the 5th is over); lane turns >= lane_turns_max (300); root subagent turns in the last 60 min >= root_turns_per_hour_max (400).
 * RUNAWAY CEILING (warn mode): a ceiling hit whose actual count is >= runaway_multiple (default 3, 0 = off) times its limit
 * is denied even in warn mode, a `runaway_block` row goes to the decision ledger, and NO owner card is opened (the operator
 * answers such cards with "you decide", so they only interrupt). `Budget-Ack:` still passes it. Remind mode is opt-in and
 * unchanged: any ceiling denies and opens one owner card. Lane totals count a subagent only when its start
 * timestamp (earliest timestamp in the transcript) is inside lane_window_minutes (default 360; 0 counts every
 * transcript, the old behaviour). A subagent with no timestamp is omitted while the window is on. The hour total
 * still filters on its own, by turn timestamp (now-3600000 < ts; a later ts counts; a missing ts is not an hour turn).
 *
 * ACK: `Budget-Ack: <reason>` (>= 8 chars) in the first 10 lines passes a would-be deny and appends a decision-ledger row.
 * The first deny per (session, lane-or-root) opens one owner panel card (pointer file dedup); later denies open none.
 * Every allowed dispatch gets one additionalContext line: last-hour turns, estimated USD, heaviest lane.
 *
 * TICKET CEILING (hard, per Fleet-Task): the brief's `Fleet-Task: <26-char ULID>` line (scripts/lib/fleet-task-ref.js
 * findTaskId) names the ticket. Spend = the sum over this session's EARLIER subagent dispatches (the subagents dir this
 * hook reads) whose own first user message carries the same Fleet-Task, estimated exactly like the lane USD (costOf per
 * assistant turn, all turns, no hour window and no lane window). Budget: a `Claude-Budget: <usd>` line in THIS
 * brief, else subagent_budget.per_ticket_usd (default 5). spend >= budget denies the Agent call with a
 * Traditional-Chinese reason (the ticket's Claude budget is used up, spent/budget; report progress on the ticket;
 * dispatch cheap non-Claude engines) — regardless of mode (warn/remind both deny), no owner card, no ledger row, and
 * `Budget-Ack:` does NOT pass it (a money ceiling). 0.8*budget <= spend < budget appends one advisory line to the allow;
 * under 0.8*budget is silent. Kill switches: the hook's own enable/disable (subagent_budget.mode=off /
 * AUTOPILOT_SUBAGENT_BUDGET_MODE=off turns off the whole hook) and AUTOPILOT_TICKET_BUDGET=0 (turns off ONLY this
 * part; the lane ceilings keep working). FAIL-OPEN: any error in the ticket part (unparsable budget line, unreadable
 * data) is treated as "no ticket ceiling" and the dispatch falls back to the lane logic alone; the hook itself stays
 * fail-open (main entry catches, exit 0, no stdout).
 *
 * MODES (default warn): ~/.autopilot/config.json {"subagent_budget": {"mode": "remind"|"warn"|"off", "lane_dispatch_max", "lane_turns_max",
 * "root_turns_per_hour_max", "runaway_multiple", "lane_window_minutes", "concurrent_advise_max"}} or the matching environment variables registered in scripts/lib/config-keys.json.
 * lane_window_minutes (default 360, env AUTOPILOT_SUBAGENT_BUDGET_LANE_WINDOW_MINUTES, 0 = count every transcript) is how far back a subagent start counts toward lane dispatches and lane turns.
 * concurrent_advise_max (default 3, env AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX, 0 off) appends one advisory
 * sentence after an allow. It never denies. AUTOPILOT_AGENT_ACTIVITY=off skips it. A thrown reader fails open.
 * Clock: AUTOPILOT_SUBAGENT_BUDGET_NOW_MS, honoured only with AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK=1 (tests). FAIL-OPEN: no transcript_path, an unreadable or corrupt transcript, or any
 * internal error => exit 0 with no stdout. This hook is its own process, separate from dispatch-model-guard.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOUR_MS = 3600000;
const READONLY_AGENT_TYPES = new Set(['probe', 'hands', 'test-runner', 'transcript-digest']);
const DEFAULTS = { mode: 'warn', lane_dispatch_max: 4, lane_turns_max: 300, root_turns_per_hour_max: 400, runaway_multiple: 3, lane_window_minutes: 360, concurrent_advise_max: 3, per_ticket_usd: 5 };
const { LANE_RE, headerDenialSuffix } = require('./lib/brief-header-template.js');
const { findTaskId } = require('../scripts/lib/fleet-task-ref.js');
const { gateHint } = require('./lib/gate-hint.js');
const REVIEWER_RE = /^Role:[ \t]*reviewer[ \t]*$/;
const ACK_RE = /^Budget-Ack:[ \t]*(.*)$/;
const CLAUDE_BUDGET_RE = /^Claude-Budget:[ \t]*(.+)$/;
const ACK_MIN_REASON = 8;
// v4: entries gained `startMs` (earliest transcript timestamp) for the lane window; older caches cold-parse.
const CACHE_SCHEMA = 'autopilot.subagent-budget-cache/4';
const MAX_ANCESTOR_DEPTH = 8;
// BL-0209 / panel card d-53cf611a (decided): a nested (spawnDepth >= 2) transcript occupies no lane DISPATCH slot
// (its turns always count). tally()'s fourth parameter overrides this for tests.
const COUNT_NESTED_DISPATCHES = false;
const LANE_FORMAT_HELP = 'Add a line "Lane: <name>" within the first 5 lines of the brief (convention: line 3, after "Engine:" and "Role:"); '
  + 'name rule [A-Za-z0-9][A-Za-z0-9._-]{0,63}, e.g. "Lane: revival-3d".';

function posInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 0 is valid and means the concurrency advisory is off. Negative and non-integers are ignored.
function nonNegInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function normMode(v) {
  const m = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return m === 'remind' || m === 'warn' || m === 'off' ? m : null;
}

// USD amount (a budget): positive finite number (number or plain digit string). null = absent or invalid.
function usdValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim());
    return n > 0 ? n : null;
  }
  return null;
}

function loadConfig() {
  const cfg = { ...DEFAULTS };
  let file = {};
  try {
    const { configPath } = require('../scripts/lib/config-path.js');
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (c && typeof c.subagent_budget === 'object' && c.subagent_budget && !Array.isArray(c.subagent_budget)) file = c.subagent_budget;
  } catch { /* absent or unreadable config => defaults */ }
  const pick = (key, envName) => {
    const e = posInt(process.env[envName]);
    if (e !== null) return e;
    const f = posInt(file[key]);
    return f !== null ? f : DEFAULTS[key];
  };
  cfg.mode = normMode(process.env.AUTOPILOT_SUBAGENT_BUDGET_MODE) || normMode(file.mode) || DEFAULTS.mode;
  cfg.lane_dispatch_max = pick('lane_dispatch_max', 'AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX');
  cfg.lane_turns_max = pick('lane_turns_max', 'AUTOPILOT_SUBAGENT_BUDGET_LANE_TURNS_MAX');
  cfg.root_turns_per_hour_max = pick('root_turns_per_hour_max', 'AUTOPILOT_SUBAGENT_BUDGET_ROOT_TURNS_PER_HOUR_MAX');
  const runEnv = nonNegInt(process.env.AUTOPILOT_SUBAGENT_BUDGET_RUNAWAY_MULTIPLE);
  const runFile = nonNegInt(file.runaway_multiple);
  cfg.runaway_multiple = runEnv !== null ? runEnv : (runFile !== null ? runFile : DEFAULTS.runaway_multiple);
  const winEnv = nonNegInt(process.env.AUTOPILOT_SUBAGENT_BUDGET_LANE_WINDOW_MINUTES);
  const winFile = nonNegInt(file.lane_window_minutes);
  cfg.lane_window_minutes = winEnv !== null ? winEnv : (winFile !== null ? winFile : DEFAULTS.lane_window_minutes);
  const adviseEnv = nonNegInt(process.env.AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX);
  const adviseFile = nonNegInt(file.concurrent_advise_max);
  cfg.concurrent_advise_max = adviseEnv !== null ? adviseEnv : (adviseFile !== null ? adviseFile : DEFAULTS.concurrent_advise_max);
  const ticketEnv = usdValue(process.env.AUTOPILOT_SUBAGENT_BUDGET_PER_TICKET_USD);
  const ticketFile = usdValue(file.per_ticket_usd);
  cfg.per_ticket_usd = ticketEnv !== null ? ticketEnv : (ticketFile !== null ? ticketFile : DEFAULTS.per_ticket_usd);
  return cfg;
}

// Test-only. Ignored unless AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_MUTANT is exactly 1.
// Not a user knob. AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT names the oracle row.
function testMutant() {
  if (process.env.AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_MUTANT !== '1') return '';
  const raw = process.env.AUTOPILOT_TEST_SUBAGENT_BUDGET_MUTANT;
  return typeof raw === 'string' ? raw.trim() : '';
}

// One extra sentence, or '' when the advisory is off, under threshold, or the reader fails open.
function advisorySuffix(payload) {
  const mutant = testMutant();
  const { knobOff, liveBase } = require('./live-session-lib.js');
  if (knobOff('AUTOPILOT_AGENT_ACTIVITY') && mutant !== 'activity_off_silent') return '';
  const max = loadConfig().concurrent_advise_max;
  if (max === 0 && mutant !== 'knob_zero_silent') return '';
  const { sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const { scanRunningAdvisory } = require('../scripts/lib/workflow-snapshot.js');
  const sid = payload && typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!sid) return '';
  const dir = path.join(liveBase(), 'agents', sanitizeSessionId(sid));
  const scan = scanRunningAdvisory(dir, { now: nowMs(), mutant: mutant || undefined });
  const threshold = max === 0 ? DEFAULTS.concurrent_advise_max : max;
  if (!scan || !(scan.count >= threshold)) return '';
  if (scan.partial) return `at least ${scan.count} appear running (scan truncated)`;
  const shown = max === 0 ? DEFAULTS.concurrent_advise_max : max;
  return `${scan.count} subagents appear running (advisory threshold ${shown}; token-discipline: keep lightweight subagents at most 3 at a time)`;
}

function withAdvisory(payload, base) {
  try {
    const extra = advisorySuffix(payload);
    return extra ? `${base} ${extra}` : base;
  } catch {
    return base;
  }
}

function nowMs() {
  // The clock override is a test seam: it only applies together with the explicit test flag, never in production.
  if (process.env.AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK === '1') {
    const raw = process.env.AUTOPILOT_SUBAGENT_BUDGET_NOW_MS;
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  }
  return Date.now();
}

// ---- brief parsing -------------------------------------------------------------------------------------------------

const { headLines } = require('./lib/brief-head.js');

function laneFromBrief(text) {
  for (const line of headLines(text, 5)) {
    const m = LANE_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

function laneFromDescription(desc) {
  if (typeof desc !== 'string') return null;
  const first = desc.replace(/\r\n/g, '\n').split('\n')[0].trim().toLowerCase();
  return first || null;
}

// Same test as hooks/foreman-guard.js isAutopilotDispatched: the brief's first line starts with `Engine:`.
function isEngineBrief(text) {
  if (typeof text !== 'string') return false;
  const nl = text.indexOf('\n');
  return (nl < 0 ? text : text.slice(0, nl)).startsWith('Engine:');
}

function isReviewer(text) {
  return headLines(text, 5).some((l) => REVIEWER_RE.test(l));
}

// Returns { reason } for the first valid ack line within the first 10 lines, { reason: null } for an ack line whose
// reason is too short, or null when there is no ack line at all.
function ackFromBrief(text) {
  let weak = null;
  for (const line of headLines(text, 10)) {
    const m = ACK_RE.exec(line);
    if (!m) continue;
    const reason = m[1].trim();
    if (reason.length >= ACK_MIN_REASON) return { reason };
    weak = { reason: null };
  }
  return weak;
}

function claudeBudgetFromBrief(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = CLAUDE_BUDGET_RE.exec(line);
    if (m) return usdValue(m[1].trim());
  }
  return null;
}

function isUnderDir(filePath, dir) {
  if (!dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(filePath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function claudeBudgetFromPromptOrFile(brief, cwd) {
  const direct = claudeBudgetFromBrief(brief);
  if (direct !== null) return direct;
  if (typeof brief !== 'string' || !brief) return null;
  const os = require('os');
  const tmpDir = os.tmpdir();
  const matches = brief.match(/[^\s"'`<>|;]+\.(?:md|txt)/g) || [];
  for (const rawPath of matches) {
    try {
      const resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : (cwd ? path.resolve(cwd, rawPath) : null);
      if (!resolved) continue;
      if (!isUnderDir(resolved, cwd) && !isUnderDir(resolved, tmpDir) && !isUnderDir(resolved, '/tmp')) continue;
      const content = fs.readFileSync(resolved, 'utf8');
      const fromFile = claudeBudgetFromBrief(content);
      if (fromFile !== null) return fromFile;
    } catch { /* fail-open on unreadable or missing prompt file */ }
  }
  return null;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  }
  return '';
}

// ---- transcript parsing --------------------------------------------------------------------------------------------

function firstUserFromLines(lines) {
  let valid = 0;
  let firstUser = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    valid += 1;
    if (firstUser === null && rec.type === 'user' && rec.message) firstUser = contentText(rec.message.content);
  }
  return { valid, firstUser };
}

function firstUserMessage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return firstUserFromLines(raw.split('\n')).firstUser || '';
}

function parseTranscript(file, metaFile) {
  const { parseAssistantTurns, costOf } = require('./cost-tracker-lib.js');
  const raw = fs.readFileSync(file, 'utf8'); // EACCES etc. throw => fail-open
  const lines = raw.split('\n');
  const { valid, firstUser } = firstUserFromLines(lines);
  if (raw.trim() && valid === 0) throw new Error(`corrupt transcript: ${path.basename(file)}`);
  const head = firstUser || '';
  const briefLane = laneFromBrief(head);
  let descLane = null;
  let parent = null;
  let depth = null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (meta && typeof meta === 'object') {
      descLane = laneFromDescription(meta.description);
      if (typeof meta.parentAgentId === 'string' && meta.parentAgentId) parent = meta.parentAgentId;
      if (Number.isInteger(meta.spawnDepth)) depth = meta.spawnDepth;
    }
  } catch { /* no or unreadable meta => no description lane, no parent */ }
  const turns = parseAssistantTurns(raw);
  const t = [];
  for (const turn of turns) {
    t.push(Number.isFinite(turn.ts) ? turn.ts : null, costOf(turn));
  }
  let startMs = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.timestamp === undefined || rec.timestamp === null) continue;
    const ts = typeof rec.timestamp === 'number' ? rec.timestamp : Date.parse(rec.timestamp);
    if (Number.isFinite(ts) && (startMs === null || ts < startMs)) startMs = ts;
  }
  let ticket = null;
  try { ticket = findTaskId(head); } catch { ticket = null; }
  return { briefLane, descLane, parent, depth, reviewer: isReviewer(head), ticket, n: turns.length, t, startMs };
}

function cacheFile(sessionId) {
  const L = require('./live-session-lib.js');
  const { sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  return path.join(L.liveBase(), 'subagent-budget', 'cache', `${sanitizeSessionId(sessionId)}.json`);
}

function ticketLedgerFile(env = process.env) {
  const { stateDir } = require('../scripts/lib/state-dir.js');
  return path.join(stateDir(env), 'subagent-budget', 'ticket-usage.jsonl');
}

function legacyTicketLedgerFile() {
  const L = require('./live-session-lib.js');
  return path.join(L.liveBase(), 'subagent-budget', 'ticket-usage.jsonl');
}

function roleFromBrief(brief) {
  if (typeof brief !== 'string' || !brief) return '';
  const firstLine = brief.split(/\r?\n/, 1)[0];
  const m = firstLine.match(/(?:^|\|)\s*Role:\s*([^|\r\n]+)/i);
  return m ? m[1].trim() : '';
}

function entryUsd(e) {
  let usd = 0;
  if (e && Array.isArray(e.t)) {
    for (let i = 0; i + 1 < e.t.length; i += 2) usd += e.t[i + 1];
  }
  return usd;
}

function readTicketLedgerRows() {
  const rows = [];
  // A ticket's spend can sit in both ledgers: read the legacy one first, then the new one, so a
  // session+subagent present in both is counted once with the new ledger's figure.
  let raw = '';
  for (const file of [legacyTicketLedgerFile(), ticketLedgerFile()]) {
    try {
      raw += fs.readFileSync(file, 'utf8') + '\n';
    } catch { /* absent or unreadable ledger */ }
  }
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const row = JSON.parse(s);
      if (row && typeof row === 'object') rows.push(row);
    } catch { /* skip malformed line */ }
  }
  return rows;
}

function recordTicketLedger(sessionId, entries, now, toolInput = {}) {
  if (!sessionId || !entries) return;
  try {
    const sid = String(sessionId);
    const model = toolInput && typeof toolInput.model === 'string' ? toolInput.model.trim() : '';
    const subagentType = toolInput && typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type.trim() : '';
    const role = roleFromBrief(toolInput && typeof toolInput.prompt === 'string' ? toolInput.prompt : '');
    const existing = new Map();
    for (const row of readTicketLedgerRows()) {
      if (row.session === sid && row.subagent) {
        existing.set(`${row.ticket}\0${row.subagent}`, row.usd);
      }
    }
    const toAppend = [];
    for (const [name, e] of Object.entries(entries)) {
      if (!e || !e.ticket) continue;
      const usd = entryUsd(e);
      if (!(usd > 0)) continue;
      const key = `${e.ticket}\0${name}`;
      const prev = existing.get(key);
      if (prev !== undefined && Math.abs(prev - usd) <= 1e-9) continue;
      toAppend.push(JSON.stringify({
        ts: now,
        ticket: e.ticket,
        session: sid,
        subagent: name,
        usd,
        model,
        subagent_type: subagentType,
        role,
      }));
    }
    if (toAppend.length > 0) {
      const { ensurePrivateDir } = require('../scripts/lib/runtime-paths.js');
      const file = ticketLedgerFile();
      const ensured = ensurePrivateDir(path.dirname(file));
      if (ensured.ok) {
        fs.appendFileSync(path.join(ensured.path, path.basename(file)), toAppend.join('\n') + '\n', { mode: 0o600 });
      }
    }
  } catch { /* fail-open if ledger cannot be written */ }
}

function ticketLedgerSpend(ticket) {
  if (!ticket) return 0;
  const bySubagent = new Map();
  for (const row of readTicketLedgerRows()) {
    if (row.ticket !== ticket) continue;
    if (typeof row.usd !== 'number' || !Number.isFinite(row.usd) || row.usd < 0) continue;
    const key = `${row.session || ''}\0${row.subagent || ''}`;
    bySubagent.set(key, row.usd);
  }
  let total = 0;
  for (const v of bySubagent.values()) total += v;
  return total;
}

function loadCache(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v && v.schema === CACHE_SCHEMA && v.files && typeof v.files === 'object') return v.files;
  } catch { /* cold */ }
  return {};
}

function saveCache(file, files) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: CACHE_SCHEMA, files }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* a cache that cannot be written is only slower */ }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

const OWN_TRANSCRIPT_RE = /(?:^|[\\/])subagents[\\/]agent-([^\\/]+)\.jsonl$/;

// The subagents dir of the session, whether the dispatcher is depth-0 (transcript_path = main transcript) or a subagent
// (transcript_path = its own agent-*.jsonl inside that dir). Unknown which one the harness sends, so try both.
function resolveDir(payload) {
  const tp = payload.transcript_path;
  const cands = [];
  if (OWN_TRANSCRIPT_RE.test(tp)) cands.push(path.dirname(tp));
  cands.push(path.join(path.dirname(tp), String(payload.session_id), 'subagents'));
  for (const c of cands) if (isDir(c)) return c;
  return null;
}

// Lane of a transcript: its own brief Lane:, else the first ancestor (meta parentAgentId chain, a cycle is cut by the
// MAX_ANCESTOR_DEPTH hop cap) with a brief Lane:, else (withDesc) its own description. Entries are keyed by file name.
function laneOf(entries, name, withDesc) {
  const e = entries[name];
  if (!e) return null;
  if (e.briefLane) return e.briefLane;
  let cur = e;
  for (let i = 0; i < MAX_ANCESTOR_DEPTH && cur && cur.parent; i++) {
    const pn = `agent-${cur.parent}.jsonl`;
    cur = Object.prototype.hasOwnProperty.call(entries, pn) ? entries[pn] : null;
    if (cur && cur.briefLane) return cur.briefLane;
  }
  return withDesc ? e.descLane : null;
}

// Entries for every agent-*.jsonl of the session. null => no subagents dir yet (nothing to count).
function collect(payload) {
  const dir = resolveDir(payload);
  if (dir === null) return null;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  const cpath = cacheFile(payload.session_id);
  const cached = loadCache(cpath);
  const next = {};
  let dirty = false;
  for (const name of names) {
    if (!/^agent-.+\.jsonl$/.test(name)) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch (e) { if (e && e.code === 'ENOENT') continue; throw e; }
    const hit = cached[name];
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      next[name] = hit;
      continue;
    }
    const meta = path.join(dir, name.replace(/\.jsonl$/, '.meta.json'));
    next[name] = { size: st.size, mtimeMs: st.mtimeMs, ...parseTranscript(file, meta) };
    dirty = true;
  }
  if (Object.keys(cached).some((k) => !next[k])) dirty = true;
  if (dirty) saveCache(cpath, next);
  return next;
}

// Cached entries plus the resolved lane (ancestry applied) for counting.
function withLanes(entries) {
  const out = {};
  for (const name of Object.keys(entries)) out[name] = { ...entries[name], lane: laneOf(entries, name, true) };
  return out;
}

// ---- counting ------------------------------------------------------------------------------------------------------

function tally(entries, lane, now, countNested = COUNT_NESTED_DISPATCHES, ticket = null, windowMinutes = DEFAULTS.lane_window_minutes) {
  const floor = now - HOUR_MS;
  const windowOn = windowMinutes > 0;
  const laneFloor = windowOn ? now - windowMinutes * 60 * 1000 : null;
  const lanes = new Map();
  let hourTurns = 0;
  let hourUsd = 0;
  let ticketUsd = 0;
  for (const e of Object.values(entries)) {
    const inLaneWindow = !windowOn || (typeof e.startMs === 'number' && e.startMs > laneFloor);
    if (e.lane && inLaneWindow) {
      const l = lanes.get(e.lane) || { dispatches: 0, turns: 0 };
      if (!e.reviewer && (countNested || !(e.depth >= 2))) l.dispatches += 1;
      l.turns += e.n;
      lanes.set(e.lane, l);
    }
    if (ticket && e.ticket === ticket) {
      for (let i = 0; i + 1 < e.t.length; i += 2) ticketUsd += e.t[i + 1];
    }
    if (!(e.mtimeMs > floor)) continue; // only the hour total may skip old files
    for (let i = 0; i + 1 < e.t.length; i += 2) {
      const ts = e.t[i];
      if (ts !== null && ts > floor) { hourTurns += 1; hourUsd += e.t[i + 1]; }
    }
  }
  let heaviest = null;
  for (const [name, l] of lanes) {
    if (!heaviest || l.turns > heaviest.turns) heaviest = { lane: name, ...l };
  }
  const own = lane && lanes.get(lane) ? lanes.get(lane) : { dispatches: 0, turns: 0 };
  return { laneDispatches: own.dispatches, laneTurns: own.turns, hourTurns, hourUsd, ticketUsd, heaviest, files: Object.keys(entries).length };
}

function contextLine(c) {
  const hv = c.heaviest ? `${c.heaviest.lane} (${c.heaviest.turns} turns, ${c.heaviest.dispatches} dispatches)` : 'none';
  return `subagent-budget: last 60 min ${c.hourTurns} subagent turns, ~$${c.hourUsd.toFixed(2)} est.; heaviest lane: ${hv}.`;
}

// ---- side effects --------------------------------------------------------------------------------------------------

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x';
}

function appendAckRow(payload, laneLabel, n, reason, hits) {
  const { spawnSync } = require('child_process');
  const row = {
    decision_id: `budget-ack-${slug(laneLabel)}-${n}`,
    round: 0,
    class: 'tactical',
    rationale: `Budget-Ack: ${reason} (passed: ${hits.map((h) => h.id).join(', ')})`,
    reversibility: 'reversible',
    refs: [],
  };
  const script = path.join(__dirname, '..', 'scripts', 'decision-ledger.js');
  const r = spawnSync(process.execPath, [script, 'append', '--kind', 'decision', '--json', JSON.stringify(row)], {
    cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd(),
    encoding: 'utf8',
    timeout: 8000,
  });
  if (r.status !== 0) process.stderr.write(`subagent-budget: decision-ledger append failed (${String(r.stderr || '').trim().slice(0, 200)})\n`);
}

// Audit row for a runaway deny: one `runaway_block` decision per blocked dispatch. The id carries the counts and a time
// stamp so repeated blocks of one lane each leave a row (the ledger skips a repeated decision_id).
function appendRunawayRow(payload, laneLabel, hits, multiple) {
  try {
    const { spawnSync } = require('child_process');
    const row = {
      decision_id: `runaway_block-${slug(laneLabel)}-${hits.map((h) => `${h.id}${h.actual}`).join('-')}-${nowMs()}`,
      round: 0,
      class: 'tactical',
      rationale: `runaway_block: ${hits.map((h) => `${h.id} ${h.actual}/${h.limit}`).join(', ')} (runaway_multiple ${multiple}; lane ${laneLabel}; no owner card)`,
      reversibility: 'reversible',
      refs: [],
    };
    const script = path.join(__dirname, '..', 'scripts', 'decision-ledger.js');
    const r = spawnSync(process.execPath, [script, 'append', '--kind', 'decision', '--json', JSON.stringify(row)], {
      cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd(),
      encoding: 'utf8',
      timeout: 8000,
    });
    if (r.status !== 0) process.stderr.write(`subagent-budget: runaway audit append failed (${String(r.stderr || '').trim().slice(0, 200)})\n`);
  } catch (e) {
    process.stderr.write(`subagent-budget: runaway audit append failed (${e.message})\n`);
  }
}

// Opens the owner card once per (session, key). Returns { id, fresh } or null when no card could be made.
function ensureCard(payload, key, hit, c) {
  try {
    const L = require('./live-session-lib.js');
    const { sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
    const sid = sanitizeSessionId(payload.session_id);
    const keyName = key === 'root' ? 'root' : `${slug(key)}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
    const ptr = path.join(L.liveBase(), 'subagent-budget', 'cards', `${sid}-${keyName}.json`);
    fs.mkdirSync(path.dirname(ptr), { recursive: true, mode: 0o700 });
    return L.withLock(ptr, () => {
      const prev = L.readJsonFile(ptr);
      if (prev && typeof prev.decision_id === 'string') return { id: prev.decision_id, fresh: false };
      if (typeof payload.cwd !== 'string' || !payload.cwd) return null;
      const { openDecision } = require('../scripts/open-decision.js');
      const { markerRoot } = require('./ask-decision.js');
      const where = key === 'root' ? '整個 session' : `lane「${key}」`;
      const r = openDecision({
        cwd: payload.cwd,
        root: markerRoot(payload.session_id),
        session: sid,
        question: `子代理預算閘擋下一次派工（${where}）：${hit.text}。要放行、調高上限，還是收掉這條 lane？`,
        background: `${contextLine(c)} 派工時在 brief 前 10 行加 \`Budget-Ack: <理由>\` 可放行（會記入 decision ledger）；`
          + '上限在 ~/.autopilot/config.json 的 subagent_budget，或設 AUTOPILOT_SUBAGENT_BUDGET_MODE=remind|warn|off。',
        source: 'subagent-budget hook',
        origin: 'subagent_budget',
      });
      if (r.status !== 'ok') { process.stderr.write(`subagent-budget: card not opened (${r.message})\n`); return null; }
      L.atomicWriteJson(ptr, { schema: 'autopilot.subagent-budget-card/1', decision_id: r.id, decision_file: r.file, key });
      return { id: r.id, fresh: true };
    });
  } catch (e) {
    process.stderr.write(`subagent-budget: card not opened (${e.message})\n`);
    return null;
  }
}

function logWarnOnly(hits) {
  try {
    const { record } = require('./_shared/hook-log');
    for (const h of hits) record({ hook: 'subagent-budget', rule: h.id, decision: 'warn', intercepted: false });
  } catch { /* fail-open: the log must never change a dispatch decision */ }
}

function emit(obj) {
  try { fs.writeSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...obj } })}\n`); } catch { /* fail-open */ }
}

// ---- main ----------------------------------------------------------------------------------------------------------

function run(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.hook_event_name === 'SubagentStop') {
    const cfg = loadConfig();
    if (cfg.mode === 'off') return;
    if (process.env.AUTOPILOT_TICKET_BUDGET === '0') return;
    if (typeof payload.session_id !== 'string' || !payload.session_id
      || typeof payload.transcript_path !== 'string' || !payload.transcript_path) return;
    const raw = collect(payload);
    if (raw) recordTicketLedger(payload.session_id, raw, nowMs());
    return;
  }
  if (payload.tool_name !== 'Agent' && payload.tool_name !== 'Task') return;
  const cfg = loadConfig();
  if (cfg.mode === 'off') return;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const brief = typeof input.prompt === 'string' ? input.prompt : '';
  // Read-only agent types (agents/probe|hands|test-runner|transcript-digest) need no Lane: line.
  const needLane = isEngineBrief(brief) && !READONLY_AGENT_TYPES.has(String(input.subagent_type || '').replace(/^autopilot:/, ''));
  const noTranscript = typeof payload.session_id !== 'string' || !payload.session_id
    || typeof payload.transcript_path !== 'string' || !payload.transcript_path;
  if (noTranscript) {
    // Nothing to count. The lane format rule needs no transcript though: a depth-0 Engine: brief without a Lane: is
    // still checked; every other payload fails open.
    const sub = typeof payload.agent_id === 'string' && payload.agent_id;
    if (!(needLane && !sub && !laneFromBrief(brief))) {
      process.stderr.write('subagent-budget: no session_id/transcript_path on the payload, allowing (fail-open)\n');
      return;
    }
    payload = { ...payload, transcript_path: '' };
  }
  const now = nowMs();
  const ticketBudgetEnabled = process.env.AUTOPILOT_TICKET_BUDGET !== '0';
  let ticket = null;
  if (ticketBudgetEnabled) {
    try { ticket = findTaskId(brief); } catch { ticket = null; }
  }
  const raw = noTranscript ? null : collect(payload);
  if (raw === null) {
    // No subagents dir: nothing to count and no ancestry to inherit from. A depth-0 Engine: brief with no Lane: is
    // still a format error (the first dispatch of a session is where the lane must start); anything else fails open
    // unless a Fleet-Task ticket has prior spend in the cross-session ledger.
    const sub = (typeof payload.agent_id === 'string' && payload.agent_id) || OWN_TRANSCRIPT_RE.test(payload.transcript_path);
    if (!(needLane && !sub && !laneFromBrief(brief)) && !ticket) return;
  }
  if (raw && ticketBudgetEnabled) recordTicketLedger(payload.session_id, raw, now, input);
  const entries = withLanes(raw || {});

  let lane = laneFromBrief(brief);
  if (!lane) {
    // A subagent dispatching without a Lane: line joins its own lane (the one its transcript is attributed to).
    const own = typeof payload.agent_id === 'string' && payload.agent_id ? payload.agent_id : (OWN_TRANSCRIPT_RE.exec(payload.transcript_path) || [])[1];
    if (own && raw) lane = laneOf(raw, `agent-${own}.jsonl`, false);
  }
  const laneMissing = needLane && !lane;
  // Only a brief that is not an Engine: brief falls back to the description; an Engine: brief with no lane stays
  // lane-less (root total only), so a missing Lane: is never billed to, or carded under, a description lane.
  if (!lane && !needLane) lane = laneFromDescription(input.description);
  const reviewer = isReviewer(brief);
  const c = tally(entries, lane, now, COUNT_NESTED_DISPATCHES, ticket, cfg.lane_window_minutes);

  // Per-ticket Claude budget ceiling (hard deny regardless of mode, no owner card, no Budget-Ack bypass; fail-open on error).
  let ticketAdvisory = '';
  if (ticket && ticketBudgetEnabled) {
    try {
      const briefBudget = claudeBudgetFromPromptOrFile(brief, typeof payload.cwd === 'string' ? payload.cwd : '');
      const ticketBudget = briefBudget !== null ? briefBudget : cfg.per_ticket_usd;
      const spentUsd = Math.max(c.ticketUsd, ticketLedgerSpend(ticket));
      if (spentUsd >= ticketBudget) {
        emit({
          permissionDecision: 'deny',
          permissionDecisionReason: `票務 ${ticket} 的 Claude 預算已用盡（已花費 $${spentUsd.toFixed(2)} / 上限 $${ticketBudget.toFixed(2)}）。請立即回報此票務的進度，並改派便宜的非 Claude 引擎（如 codex / grok / agy）。`
            + '若已核准加碼，請在 Agent 提示詞內加一行「Claude-Budget: <美元數>」（整行、行首，無縮排），或在 ~/.autopilot/config.json 的 subagent_budget.per_ticket_usd 調整預設。'
            + gateHint('回報進度並改派便宜引擎（codex / grok / agy）；要繼續用 Claude 才請操作員調高 per-ticket 上限', 'hooks/README.md'),
        });
        return;
      }
      if (spentUsd >= 0.8 * ticketBudget) {
        ticketAdvisory = ` 票務 ${ticket} 的 Claude 預算已使用 ${Math.round((spentUsd / ticketBudget) * 100)}%（$${spentUsd.toFixed(2)} / $${ticketBudget.toFixed(2)}）。`;
      }
    } catch { /* fail-open on ticket budget error */ }
  }

  const hits = [];
  if (lane && !reviewer && c.laneDispatches >= cfg.lane_dispatch_max) {
    hits.push({ id: 'lane_dispatch_max', scope: lane, actual: c.laneDispatches, limit: cfg.lane_dispatch_max, text: `lane '${lane}' already has ${c.laneDispatches} dispatches (lane_dispatch_max ${cfg.lane_dispatch_max})` });
  }
  if (lane && c.laneTurns >= cfg.lane_turns_max) {
    hits.push({ id: 'lane_turns_max', scope: lane, actual: c.laneTurns, limit: cfg.lane_turns_max, text: `lane '${lane}' already used ${c.laneTurns} subagent turns (lane_turns_max ${cfg.lane_turns_max})` });
  }
  if (c.hourTurns >= cfg.root_turns_per_hour_max) {
    hits.push({ id: 'root_turns_per_hour_max', scope: 'root', actual: c.hourTurns, limit: cfg.root_turns_per_hour_max, text: `this session's subagents used ${c.hourTurns} turns in the last 60 minutes (root_turns_per_hour_max ${cfg.root_turns_per_hour_max})` });
  }

  if (laneMissing) {
    hits.push({
      id: 'lane_missing',
      scope: 'format',
      noCard: true,
      text: 'the brief starts with "Engine:" but carries no valid "Lane:" line (and none is inherited from the dispatcher), so the lane ceilings cannot apply',
    });
  }

  const line = contextLine(c) + ticketAdvisory;
  if (hits.length === 0) { emit({ additionalContext: withAdvisory(payload, line) }); return; }

  const summary = hits.map((h) => h.text).join('; ');
  const ack = ackFromBrief(brief);
  if (cfg.mode === 'warn') {
    const runaway = cfg.runaway_multiple > 0
      ? hits.filter((h) => h.limit > 0 && h.actual >= cfg.runaway_multiple * h.limit)
      : [];
    if (runaway.length === 0) {
      process.stderr.write(`subagent-budget: ${summary}\n`);
      // Warn mode blocks nothing here: it is log-only, and the shared hook log says so (per 01M88SBJ98).
      logWarnOnly(hits);
      emit({ additionalContext: withAdvisory(payload, `subagent-budget (warn mode, not blocking): ${summary}. ${line}`) });
      return;
    }
    const rtext = runaway.map((h) => `${h.id} ${h.actual} is ${(h.actual / h.limit).toFixed(1)}x its limit ${h.limit}`).join('; ');
    if (ack && ack.reason) {
      appendAckRow(payload, lane || 'root', (lane ? c.laneDispatches : c.files) + 1, ack.reason, runaway);
      emit({ additionalContext: withAdvisory(payload, `subagent-budget: runaway ceiling passed on Budget-Ack (${rtext}). ${line}`) });
      return;
    }
    appendRunawayRow(payload, lane || 'root', runaway, cfg.runaway_multiple);
    // No ensureCard here, on purpose: the operator answers budget cards with "you decide", so this path only blocks and logs.
    emit({
      permissionDecision: 'deny',
      permissionDecisionReason: `subagent-budget: runaway ceiling, dispatch denied (warn mode, no owner card opened). ${rtext}; `
        + `runaway_multiple ${cfg.runaway_multiple}. ${summary}. `
        + 'To proceed anyway, re-dispatch with a line "Budget-Ack: <reason, at least 8 characters>" in the first 10 lines of the brief '
        + '(it is logged to the decision ledger); otherwise stop re-dispatching this lane and report to the owner. '
        + 'Tuning: raise the ceilings (lane_dispatch_max, lane_turns_max, root_turns_per_hour_max) or runaway_multiple (0 turns this guard off) in subagent_budget in ~/.autopilot/config.json, '
        + 'or AUTOPILOT_SUBAGENT_BUDGET_RUNAWAY_MULTIPLE; AUTOPILOT_SUBAGENT_BUDGET_MODE=remind|warn|off.'
        + gateHint('要繼續就加 "Budget-Ack: <理由>" 行（≥8 字）再派；否則停止重派並回報操作員', 'hooks/README.md')
        + headerDenialSuffix(brief, input.model, { engineBy: 'other', laneBy: 'self', includeLane: false }),
    });
    return;
  }
  if (ack && ack.reason) {
    appendAckRow(payload, lane || 'root', (lane ? c.laneDispatches : c.files) + 1, ack.reason, hits);
    emit({ additionalContext: withAdvisory(payload, `subagent-budget: passed on Budget-Ack (${summary}). ${line}`) });
    return;
  }
  const budgetHit = hits.find((h) => !h.noCard);
  const card = budgetHit ? ensureCard(payload, budgetHit.scope, budgetHit, c) : null;
  const laneNote = laneMissing ? `${LANE_FORMAT_HELP} ` : '';
  const cardNote = !budgetHit
    ? 'No owner panel card is opened for this (format problem only).'
    : card
    ? `Owner panel card ${card.id} ${card.fresh ? 'has been opened' : 'is already open'} for this ${budgetHit.scope === 'root' ? 'session' : 'lane'}.`
    : 'No owner panel card could be opened.';
  const ackNote = ack
    ? 'Your Budget-Ack line was ignored: the reason needs at least 8 characters. '
    : '';
  emit({
    permissionDecision: 'deny',
    permissionDecisionReason: `subagent-budget: dispatch denied. ${summary}. `
      + `Counts: lane dispatches ${c.laneDispatches}, lane turns ${c.laneTurns}, root turns in last 60 min ${c.hourTurns}. `
      + `${laneNote}${ackNote}To proceed anyway, re-dispatch with a line "Budget-Ack: <reason, at least 8 characters>" in the first 10 lines of the brief `
      + '(it is logged to the decision ledger); otherwise stop re-dispatching this lane and report to the owner. '
      + `${cardNote} Tuning: subagent_budget in ~/.autopilot/config.json, or AUTOPILOT_SUBAGENT_BUDGET_MODE=remind|warn|off.`
      + gateHint('要繼續就加 "Budget-Ack: <理由>" 行（≥8 字）再派；否則停下來回報操作員', 'hooks/README.md')
      + headerDenialSuffix(brief, input.model, { engineBy: 'other', laneBy: 'self', includeLane: laneMissing }),
  });
}

module.exports = { ticketLedgerSpend, run, collect, withLanes, tally, resolveDir, contentText, firstUserMessage, laneOf, laneFromBrief, laneFromDescription, ackFromBrief, claudeBudgetFromBrief, isReviewer, isEngineBrief };

if (require.main === module) {
  try {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
    run(JSON.parse(raw || '{}'));
  } catch (e) {
    try { process.stderr.write(`subagent-budget: ${e && e.message ? e.message : e} (fail-open)\n`); } catch { /* ignore */ }
  }
  process.exit(0);
}
