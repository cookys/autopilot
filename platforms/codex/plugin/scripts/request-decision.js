#!/usr/bin/env node
'use strict';
/**
 * request-decision.js — a non-PM team session asks the PM instead of opening an owner card.
 *
 *   node scripts/request-decision.js send --question <q> --option <label>[::<description>] --option <label>[::<description>]
 *        --recommendation <label> --boundary <boundary>[:<why>] [--why <reason>] [--snapshot <text>] [--blast-radius <text>]
 *        [--to <address>] [--task <id>]
 *   node scripts/request-decision.js forward --id <r-id>
 *
 * Issues r- + 8 hex and stores one record at $HOME/.autopilot/requests/<id>.json (mode 0600).
 * Sends one line: AUTOPILOT-REQ/1 {json} via `fleet send <pm> <line>` (binary: $AUTOPILOT_FLEET_BIN or fleet).
 * The line carries the question, options, recommendation and the r- id. Fields are redact-then-truncate.
 * On a successful send the record status is `waiting_on_operator <r-id>`.
 * --task, or $AUTOPILOT_FLEET_TASK, also runs `fleet task progress <id> blocked_human "waiting_on_operator <r-id>"`.
 * read_only and reversible exit 3 after the send. Other known boundaries exit 0.
 * irreversible without a non-empty --snapshot and --blast-radius exits 2: nothing is sent and no record is written.
 * The PM address is --to, else team.json `pm`, else $AUTOPILOT_PM_ADDRESS. Missing or unusable: exit 2, nothing sent.
 * A failed send exits 1 and the record status is send_failed (not waiting_on_operator).
 * forward resends the stored line. Node built-ins only. Does not set FLEET_FYI and does not pass --as-cli.
 *
 * Exit: 0 sent | 1 send failed | 2 usage or refused before send | 3 read_only or reversible sent.
 */

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'AUTOPILOT-REQ/1 ';
const FIELD_MAX = 400;
const REQUEST_ID = /^r-[0-9a-f]{8}$/;
const BOUNDS = ['read_only', 'reversible', 'external', 'irreversible', 'goal-change', 'scope-expansion', 'resources-2x', 'red-line'];
const EXIT_3 = new Set(['read_only', 'reversible']);

function usage(message) {
  if (message) process.stderr.write(`request-decision: ${message}\n`);
  process.stderr.write('usage: request-decision.js send --question <q> --option <label>[::<description>] --option <label>[::<description>] --recommendation <label> --boundary <boundary>[:<why>] [--why <reason>] [--snapshot <text>] [--blast-radius <text>] [--to <address>] [--task <id>]\n'
    + '       request-decision.js forward --id <r-id>\n');
  return 2;
}

function homeDir() {
  return process.env.HOME || os.homedir();
}

function parse(argv) {
  const out = { _: [], option: [] };
  const valued = new Set(['question', 'option', 'recommendation', 'boundary', 'why', 'snapshot', 'blast-radius', 'to', 'task', 'id']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (!valued.has(name)) return { error: `unknown argument: ${a}` };
    if (i + 1 >= argv.length) return { error: `--${name} needs a value` };
    const v = argv[i + 1];
    i += 1;
    if (name === 'option') out.option.push(v);
    else out[name] = v;
  }
  return out;
}

function boundaryId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return '';
  const at = value.indexOf(':');
  return (at < 0 ? value : value.slice(0, at)).trim().toLowerCase();
}

function field(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return require('./lib/menu-card-content.js').redactThenTruncate(value.trim(), FIELD_MAX);
}

function parseOptions(raw) {
  return raw.map((o) => {
    const at = o.indexOf('::');
    const label = field(at < 0 ? o : o.slice(0, at));
    const description = field(at < 0 ? '' : o.slice(at + 2)) || '';
    return { label: label || '', description };
  });
}

function pmAddress(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  try {
    const pm = require('./lib/team.js').resolve().pm;
    if (pm) return pm;
  } catch { /* no team file: try the env */ }
  const env = process.env.AUTOPILOT_PM_ADDRESS;
  return typeof env === 'string' && env.trim() ? env.trim() : '';
}

function fleetEnv() {
  const env = { ...process.env };
  delete env.FLEET_FYI;
  delete env.FLEET_AS_CLI;
  return env;
}

function fleet(args) {
  const bin = process.env.AUTOPILOT_FLEET_BIN || 'fleet';
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 15000, env: fleetEnv() });
    if (r.error) return { ok: false, why: r.error.code === 'ENOENT' ? 'no fleet binary' : r.error.message };
    return r.status === 0 ? { ok: true } : { ok: false, why: `fleet exit ${r.status}` };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

function recordPath(id) {
  return path.join(homeDir(), '.autopilot', 'requests', `${id}.json`);
}

function writeRecord(rec) {
  const file = recordPath(rec.id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function encode(body) {
  return `${PREFIX}${JSON.stringify(body)}`;
}

function taskIdOf(args) {
  if (typeof args.task === 'string' && args.task.trim()) return args.task.trim();
  const env = process.env.AUTOPILOT_FLEET_TASK;
  return typeof env === 'string' && env.trim() ? env.trim() : '';
}

function send(args) {
  const question = field(args.question);
  if (!question) return usage('send needs a non-empty --question');
  if (args.option.length < 2) return usage('send needs at least two --option <label>[::<description>]');
  const options = parseOptions(args.option);
  if (options.some((o) => !o.label)) return usage('--option labels must be non-empty');
  const recommendation = field(args.recommendation);
  if (!recommendation) return usage('send needs a non-empty --recommendation');
  const idBound = boundaryId(args.boundary);
  if (!BOUNDS.includes(idBound)) return usage(`--boundary must be one of ${BOUNDS.join(' | ')}`);
  const snapshot = field(args.snapshot);
  const blast = field(args['blast-radius']);
  if (idBound === 'irreversible' && (!snapshot || !blast)) return usage('irreversible needs a non-empty --snapshot and --blast-radius; nothing sent');
  const to = pmAddress(args.to);
  if (!to || !require('./lib/fleet-decision.js').isAddress(to)) return usage('no PM address: pass --to <address>, set team.json pm, or AUTOPILOT_PM_ADDRESS; nothing sent');
  const id = `r-${crypto.randomBytes(4).toString('hex')}`;
  const body = {
    id,
    question,
    options,
    recommendation,
    boundary: field(args.boundary),
    why: field(args.why),
    snapshot,
    blast_radius: blast,
  };
  const line = encode(body);
  if (line.includes('\n') || line.includes('\r')) return usage('the request line is not one line; nothing sent');
  const sent = fleet(['send', to, line]);
  const status = sent.ok ? `waiting_on_operator ${id}` : 'send_failed';
  writeRecord({
    id, question, options, recommendation, boundary: body.boundary, why: body.why, snapshot, blast_radius: blast,
    to, status, line, at: new Date().toISOString(),
  });
  if (!sent.ok) { process.stderr.write(`request-decision: send failed (${sent.why}); not waiting\n`); return 1; }
  const task = taskIdOf(args);
  if (task) {
    const progress = fleet(['task', 'progress', task, 'blocked_human', status]);
    if (!progress.ok) { process.stderr.write(`request-decision: task progress failed (${progress.why})\n`); return 1; }
  }
  process.stdout.write(`${id}\n`);
  return EXIT_3.has(idBound) ? 3 : 0;
}

function forward(args) {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!REQUEST_ID.test(id)) return usage('forward needs --id r- plus 8 hex');
  let rec;
  try { rec = JSON.parse(fs.readFileSync(recordPath(id), 'utf8')); } catch { return usage(`no stored request ${id}`); }
  if (!rec || typeof rec.line !== 'string' || !rec.line.startsWith(PREFIX) || !rec.to) return usage(`stored request ${id} has no line to resend`);
  const sent = fleet(['send', rec.to, rec.line]);
  if (!sent.ok) { process.stderr.write(`request-decision: forward failed (${sent.why})\n`); return 1; }
  process.stdout.write(`${id}\n`);
  return 0;
}

function main(argv) {
  const args = parse(argv);
  if (args.error) return usage(args.error);
  const cmd = args._[0];
  if (cmd === 'send' && args._.length === 1) return send(args);
  if (cmd === 'forward' && args._.length === 1) return forward(args);
  return usage(cmd ? `bad command: ${args._.join(' ')}` : 'missing command');
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, PREFIX };
