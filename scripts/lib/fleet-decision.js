'use strict';
/**
 * fleet-decision.js — the autopilot side of operator-console F4 (fleet plan docs/plans/2026-11-02-oc-f4-attributed-answers.md, U8 A-side).
 * Thin wrapper over `fleet decision claim|verify`; autopilot never decides who won, the card's courier does.
 *
 *   probe()      'unsupported' | 'supported' | 'probe_error' (see the function). Only 'unsupported' (no fleet binary, or a fleet whose usage has
 *                no `fleet decision`) keeps today's behaviour; 'probe_error' is a failure: callers must not close or act.
 *   claim(...)   `fleet decision claim <card_id> [--option L] [--free-text T]` (both together = an option plus a note; an old courier exits 2 on that, so claim retries once with the option only and returns note_dropped_by_courier:true + note). Exit map (plan "CLI"):
 *                0 claimed (stdout JSON {answer_id, card_id, via, ...}; the same card + same answer again is idempotent: exit 0, same answer_id)
 *                3 already answered (stdout = the winning answer JSON) | 4 unknown card | 10 card closed | 9 courier unreachable.
 *                Exit 9 is retried here, bounded (AUTOPILOT_CLAIM_RETRIES, default 3 attempts; AUTOPILOT_CLAIM_RETRY_MS, default 10000).
 *                Hooks must NOT call claim: they must not sleep or retry. Only the open-decision.js CLI does.
 *   verify(...)  `fleet decision verify <card_id> <answer_id> [--content-sha256 H]` — exit 0 and the stored answer on stdout ({outcome:"verified",...}), or 7.
 *                H is required for a via=console answer and must be absent for via=local (fleet R4.1-1; a local claim vouches for itself).
 *                No retry, no sleep (hook-safe).
 *   isAddress(a) address shape check (namespace/courier/member) for open-decision.js; this module sends nothing but `decision claim|verify`.
 * AUTOPILOT_FLEET_BIN overrides the binary (tests use a stub). Node built-ins only.
 */
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const bin = () => process.env.AUTOPILOT_FLEET_BIN || 'fleet';

function run(args, timeout) {
  const r = spawnSync(bin(), args, { encoding: 'utf8', timeout: timeout || 15000 });
  if (r.error) return { missing: r.error.code === 'ENOENT', error: r.error.message, status: null, stdout: '', stderr: '' };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Three states, never a boolean: a failed probe is NOT "no courier".
//   'unsupported'  spawn ENOENT (no fleet binary), or fleet printed a usage section with subcommand lines and none is `fleet decision` (a bare banner is probe_error)
//   'supported'    fleet printed its usage with a `fleet decision` line
//   'probe_error'  everything else (timeout, other spawn error, no usage text at all)
// The exit status of `--help` is not read: today's fleet prints its usage and exits 1.
function probe() {
  const r = run(['--help'], 5000);
  if (r.missing) return 'unsupported';
  if (r.error) return 'probe_error';
  const text = r.stdout + r.stderr;
  // unsupported needs POSITIVE evidence: a usage section AND at least one subcommand line under it. A banner alone ("courier CLI\ninit failed")
  // proves nothing about the subcommands.
  if (/^\s*fleet decision(\s|$)/m.test(text)) return 'supported';
  if (/^usage:/im.test(text) && /^\s+fleet [a-z][a-z-]*/m.test(text)) return 'unsupported';
  return 'probe_error';
}

// True only when `fleet --help` lists a `fleet recent` line. One bounded call (5 s), no retry, no cache; no binary, a timeout or any
// other failure is false. Used by the post-compaction restore text, which must stay silent when it cannot know.
function supportsRecent() {
  const r = run(['--help'], 5000);
  if (r.missing || r.error) return false;
  return /^\s*fleet recent(\s|$)/m.test(r.stdout + r.stderr);
}

const parseJson = (s) => { try { const v = JSON.parse(String(s).trim().split('\n').pop()); return v && typeof v === 'object' ? v : null; } catch { try { return JSON.parse(s); } catch { return null; } } };

function sleepMs(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// -> { outcome: 'claimed'|'already_answered'|'card_closed'|'unknown'|'unreachable'|'error', json, answer_id, attempts, detail }
function claim(cardId, { option, freeText } = {}) {
  const has = (x) => typeof x === 'string' && x !== '';
  const args = ['decision', 'claim', cardId];
  if (has(option)) args.push('--option', option);
  if (has(freeText)) args.push('--free-text', freeText);
  const attempts = Math.max(1, Number(process.env.AUTOPILOT_CLAIM_RETRIES) || 3);
  const delay = process.env.AUTOPILOT_CLAIM_RETRY_MS !== undefined ? Number(process.env.AUTOPILOT_CLAIM_RETRY_MS) : 10000;
  let r;
  let noteDropped = false;
  for (let i = 1; i <= attempts; i++) {
    r = run(args);
    // an old courier answers `--option` + `--free-text` together with exit 2 (usage): retry once with the option only and hand the note back to the caller
    if (r.status === 2 && has(option) && has(freeText)) {
      noteDropped = true;
      args.splice(args.indexOf('--free-text'), 2);
      r = run(args);
    }
    if (r.status !== 9) { r.attempts = i; break; }
    r.attempts = i;
    if (i < attempts) sleepMs(delay);
  }
  const json = parseJson(r.stdout);
  const base = { json, attempts: r.attempts, detail: (r.stderr || r.error || '').trim() };
  if (noteDropped && r.status === 0) { base.note_dropped_by_courier = true; base.note = freeText; }
  if (r.status === 0) return json && typeof json.answer_id === 'string' && json.answer_id
    ? { ...base, outcome: 'claimed', answer_id: json.answer_id }
    : { ...base, outcome: 'error', detail: 'claim exit 0 but stdout carries no answer_id' };
  if (r.status === 3) return { ...base, outcome: 'already_answered' };
  if (r.status === 4) return { ...base, outcome: 'unknown' };
  if (r.status === 10) return { ...base, outcome: 'card_closed' };
  if (r.status === 9) return { ...base, outcome: 'unreachable' };
  return { ...base, outcome: 'error', detail: base.detail || `claim exit ${r.status}` };
}

// sha256 of the received text, LF-normalised, trailing newline stripped (plan "CLI": decision verify).
function contentSha256(text) {
  return crypto.createHash('sha256').update(String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '')).digest('hex');
}

// One `fleet decision verify`. R4.1-1: --content-sha256 is REQUIRED for a via=console answer and must be ABSENT for a via=local one
// (wrong combination = exit 7), so pass `sha256` only when you know the answer is a console one.
// -> { ok, outcome: 'verified'|'unverified'|'unreachable'|'error', answer }  (answer = the stored answer, the only thing to act on)
function verifyOnce(cardId, answerId, sha256) {
  const args = ['decision', 'verify', cardId, answerId];
  if (sha256) args.push('--content-sha256', sha256);
  const r = run(args);
  if (r.status === 0) return { ok: true, outcome: 'verified', answer: parseJson(r.stdout) };
  if (r.status === 7) return { ok: false, outcome: 'unverified' };
  if (r.status === 9) return { ok: false, outcome: 'unreachable' };
  return { ok: false, outcome: 'error', detail: (r.stderr || r.error || `verify exit ${r.status}`).trim() };
}

// For a received answer LINE whose provenance is unknown: first as a local answer (no hash), then, only on exit 7, as a console one
// (hash of the received text). At most two calls, no sleep, no retry of the same call. Fleet refuses the wrong combination, so there is
// no downgrade: a console answer cannot pass without its hash.
function verify(cardId, answerId, text) {
  const local = verifyOnce(cardId, answerId, null);
  if (local.outcome !== 'unverified') return local;
  return verifyOnce(cardId, answerId, contentSha256(text));
}

// An address must look like namespace/courier/member (or courier/member). open-decision.js checks --executor/--asker/backfill addresses with it; it
// sends nothing itself (PM ruling 01M6RV0Y02, overridden for panel answers by PM 01M6ZXJYTQ (2026-11-09): `close --answer` prints the dispatch JSON and the caller sends it).
const ADDRESS = /^[A-Za-z0-9][A-Za-z0-9._@:-]*(\/[A-Za-z0-9][A-Za-z0-9._@:-]*){1,2}$/;

module.exports = { probe, supportsRecent, claim, verify, verifyOnce, contentSha256, isAddress: (a) => typeof a === 'string' && ADDRESS.test(a) };
