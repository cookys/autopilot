#!/usr/bin/env node
'use strict';

/**
 * per-turn-gate — opt-in Stop hook (BL-0055 phase 2, plan docs/plans/2026-10-24-per-turn-gate-phase2.md).
 *
 * At the end of every turn it runs a project-supplied verifier and, when the verifier reports a
 * violation, blocks the stop once with the verifier's text so the model fixes it inside the same
 * session. Default OFF: it does nothing until `hooks.per-turn-gate` is enabled (opt-in.js) AND a
 * verifier command is configured.
 *
 * Knobs (config.json, no environment variables):
 *   per_turn_gate.verifier    command run as `<command> --turn <n> --repo <cwd> --json`
 *                             (same interface and exit codes as the t14 verify-turn.js: 0 clean,
 *                              1 violations, anything else is an error). It is exec'd through
 *                              `sh -c`, so give a simple command, not a pipeline.
 *   per_turn_gate.mode        "violations" (default): only exit 1 can block.
 *                             "violations+features" (W4, guidance): exit 0 with a non-empty
 *                             feature_gaps list blocks too, and the retry text lists the violations,
 *                             then the gaps, then a keep-what-works line. EVALUATED: the P2-3r2 and
 *                             P2-3-h55 ON arms ran this mode (PASS, Haiku only, task t14); mode
 *                             "violations" alone was not run as an ON arm.
 *   per_turn_gate.max_blocks  blocks allowed per (session, turn); default 2 (the historical cap).
 *   per_turn_gate.timeout_ms  hard timeout for the verifier; default 30000.
 *
 * Decision: reportable and counter below the cap -> print {"decision":"block","reason":...} and
 * count it. Not reportable, cap reached, verifier error (crash, timeout, unparseable output, missing
 * command) or knob off -> allow. An error never blocks, with one exception: when a gate file armed the
 * gate (below), a gate-verify.js exit 2 ("the check could not run", which a worker can cause by changing a
 * path, permission or link) blocks like a violation, shares the same max_blocks counter and is logged
 * decision block / reason error (BL-0318, owner choice B).
 *
 * Worker-bound arming (BL-0306 P2, plan docs/plans/2026-10-26-depth0-per-turn-gate.md): a valid gate file
 * <live-state>/per-turn-gate/<session>.gate.json (Stop) or <session>.<agent_id>.gate.json (SubagentStop),
 * written only by scripts/per-turn-gate-arm.js, arms the gate for that one session/subagent even when the
 * global knob is off. Its mode and max_blocks replace the config values and the verifier is
 * scripts/gate-verify.js reading the file through AUTOPILOT_GATE_FILE. Any invalid, missing or expired
 * file is ignored: the run is then byte-identical to a run without it. A SubagentStop without a valid
 * subagent gate file returns silently. per_turn_gate.session_arming=false ignores gate files entirely.
 * An armed record gains one optional field, `source` (session|subagent); no other record has it.
 *
 * Log contract: every invocation appends exactly ONE record to
 * <live-state>/per-turn-gate/<session>.jsonl before it exits:
 *   {session, turn, prompt_id, decision: allow|block, reason: block|clean|cap|error|off, counter}
 * (prompt_id is the stdin field of that name, or null when absent)
 * so the record count equals the invocation count. `off` is written only when a verifier is
 * configured but the hook is not enabled (a hook nobody configured leaves no trace); in that case
 * `turn` is null and no counter state is touched.
 *
 * Nothing configured (hook not enabled AND no verifier): the hook returns before touching the disk, so the
 * live-state directory gets no new file at all. Verifier configured but hook not enabled: exactly one `off`
 * record per Stop (so a live check can tell "knob off" from "hook not running"). Enabled without a usable
 * verifier: `error`.
 *
 * Concurrency: per-session state changes run under an atomic lock directory (<session>.lock holding
 * owner.json {pid, token, created}; mkdir; stale after 30 s; a stale lock is reclaimed by renaming it away
 * and checking the token that was moved). A short lock decides the turn and reads the cap (at cap: allow,
 * no verifier run); the verifier runs outside any lock; only a block takes a second lock, re-reads the
 * state (same turn, below the cap) and then counts. Nothing is taken before it is needed, so nothing is
 * given back. A lock not taken in 5 s, or one found taken from us at release, allows and logs `error`
 * (an error never blocks; a broken lock can only block less). State writes are fenced: tmp file, then right
 * before the rename a check that the lock path still holds our token and that less than half the stale
 * threshold (15 s) has passed since we took the lock; otherwise the write is dropped and the call allows
 * with `error`. Accepted residual risk: an external stop of more than 15 s between that check and the
 * rename (two adjacent synchronous calls). A lock path occupied by a regular file: a fresh one makes the
 * call allow with `error` after 5 s; one older than the stale threshold is leftover and is reclaimed.
 *
 * Retention: every call deletes this hook's own counter, turn, pid-tmp and lock files older than
 * per_turn_gate.state_retention_days (default 7). Log files are kept.
 *
 * State (same directory): <session>.turn holds the current turn index; <session>.t<turn>.count holds
 * the number of blocks given in that turn.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in.js');
const { configPath } = require('../scripts/lib/config-path.js');
const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');

const HOOK_STEM = 'per-turn-gate';
const ID_RE = /^[A-Za-z0-9-]{1,128}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const GATE_KEYS = ['v', 'repo', 'base', 'mode', 'max_blocks', 'expires_at', 'rules'];
const GATE_VERIFY = path.resolve(__dirname, '..', 'scripts', 'gate-verify.js');
const DEFAULT_MAX_BLOCKS = 2;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETENTION_DAYS = 7;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;
const MODES = ['violations', 'violations+features'];

/**
 * TURN BOUNDARY RULE (single function so it can be replaced).
 * Confirmed by P2-0 on CLI 2.1.309 (docs/plans/evidence/2026-10-24-per-turn-gate-p2-0/README.md on
 * branch hands/ptg-p20/1): the first Stop of every turn has stop_hook_active false (also in a
 * resumed turn), a re-entry after a block has it true, and session_id is stable across resume.
 * stdin also carries prompt_id (constant within a turn, new on the next); it is logged as a
 * cross-check but is not the boundary rule.
 */
function startsNewTurn(payload) {
  return payload.stop_hook_active !== true;
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (_e) {
    return {};
  }
}

function intKnob(v, dflt, min) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : dflt;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

function readInt(file) {
  try {
    const n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

/** Run the verifier. Returns {kind:'error'} or {kind:'clean'|'violations', json}. */
function runVerifier(command, turn, repo, timeoutMs, env) {
  if (typeof command !== 'string' || command.trim() === '') return { kind: 'error' };
  let r;
  try {
    r = spawnSync('/bin/sh', ['-c', `exec ${command} "$@"`, 'sh', '--turn', String(turn), '--repo', repo, '--json'], {
      cwd: repo,
      env: env || process.env,
      input: '',
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (_e) {
    return { kind: 'error' };
  }
  if (r.error || r.signal || (r.status !== 0 && r.status !== 1)) {
    return { kind: 'error', status: r.error || r.signal ? null : r.status, stderr: cleanStderr(r.stderr) };
  }
  let json;
  try {
    json = JSON.parse(String(r.stdout || '').trim());
  } catch (_e) {
    return { kind: 'error' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { kind: 'error' };
  if (!validSchema(json)) return { kind: 'error' };
  return { kind: r.status === 1 ? 'violations' : 'clean', json };
}

/** First 200 bytes of a verifier's stderr, control characters removed. */
function cleanStderr(raw) {
  try {
    return Buffer.from(String(raw || ''), 'utf8').subarray(0, 200).toString('utf8').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  } catch (_e) {
    return '';
  }
}

/** Is this verifier result one the current mode may block on? */
function isReportable(result, mode) {
  if (result.kind === 'violations') return true;
  return mode === 'violations+features' && gapsOf(result.json).length > 0;
}

function gapsOf(json) {
  return json && Array.isArray(json.feature_gaps) ? json.feature_gaps : [];
}

const isText = (x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x));

/** Schema of a verifier answer: violations[] of {constraint, rule, evidence}, feature_gaps[] of strings (optional). */
function validSchema(json) {
  if (!Array.isArray(json.violations)) return false;
  for (const v of json.violations) {
    if (!v || typeof v !== 'object' || !isText(v.constraint) || !isText(v.rule) || !isText(v.evidence)) return false;
  }
  if (json.feature_gaps !== undefined) {
    if (!Array.isArray(json.feature_gaps) || !json.feature_gaps.every((g) => typeof g === 'string')) return false;
  }
  return true;
}

function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_e) { /* nothing */ }
}

const crypto = require('crypto');

function readOwner(lockDir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_e) {
    return null;
  }
}

/** Age of a lock in ms: from its owner record, else (owner not written yet, or not a lock) from the path's mtime. */
function lockAgeMs(lockDir) {
  const o = readOwner(lockDir);
  if (o && Number.isFinite(o.created)) return Date.now() - o.created;
  return Date.now() - fs.statSync(lockDir).mtimeMs;
}

/**
 * Take the per-session lock: mkdir is atomic, and the directory holds owner.json {pid, token, created}.
 * Returns {release()} or null when the lock could not be taken within LOCK_WAIT_MS.
 * release() returns false when the lock is no longer ours (our token is gone from the path): the caller
 * must then turn its result into allow/error. A stale lock is reclaimed by renaming it to a unique name
 * first (atomic) and checking the token of what was moved: a different token than the one judged stale
 * means a live lock was moved, so this call gives up (null) instead of continuing. Either way a broken
 * mutual exclusion can only make the hook block LESS, never past the cap.
 * `seam.afterJudged(lockDir)` is a test hook called between the stale judgement and the rename.
 */
function acquireLock(lockDir, seam) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = crypto.randomBytes(8).toString('hex');
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      const acquiredAt = Date.now();
      try {
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, token, created: Date.now() }));
      } catch (_e) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_e2) { /* nothing */ }
        return null;
      }
      return {
        /**
         * Release atomically: rename the lock directory away first, then check the token in what was moved.
         * Matching token: ours, delete it. Anything else (or nothing to move): the lock was taken from us, so
         * return false and the caller allows; what we moved is NOT deleted but put back (or, if the path is
         * taken again, left for the retention cleanup).
         */
        release() {
          const moved = `${lockDir}.rel.${crypto.randomBytes(6).toString('hex')}`;
          try { fs.renameSync(lockDir, moved); } catch (_e) { return false; }
          const o = readOwner(moved);
          if (!o || o.token !== token) {
            // Not ours: never delete someone else's live lock. Put it back; the lock directory is non-empty
            // (owner.json), so the rename fails if the path already holds a newer lock, and then the moved
            // directory is left for the retention cleanup (.lock.rel.* names are covered).
            try { fs.renameSync(moved, lockDir); } catch (_e) { /* left for retention cleanup */ }
            return false;
          }
          try { fs.rmSync(moved, { recursive: true, force: true }); } catch (_e) { /* nothing */ }
          return true;
        },
        /**
         * Fenced state write: tmp file first, then, on the line right before the rename, check that the lock
         * path still holds our token AND that less than half the stale threshold has passed since we took it.
         * Either failing deletes the tmp file and throws, so a holder that was paused past the stale
         * threshold (and reclaimed meanwhile) cannot write an out-of-date counter. Accepted residual risk: a
         * stop of more than half the threshold (15 s) between the check and the rename, two adjacent
         * synchronous calls (an external SIGSTOP).
         */
        writeInt(file, n) {
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, `${n}\n`);
          const fenced = (readOwner(lockDir) || {}).token === token && Date.now() - acquiredAt < LOCK_STALE_MS / 2;
          if (!fenced) { try { fs.unlinkSync(tmp); } catch (_e) { /* nothing */ } throw new Error('lock fence'); }
          fs.renameSync(tmp, file);
        },
      };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return null;
    }
    let judged = null; // owner token of the lock judged stale; undefined when not stale
    try {
      if (lockAgeMs(lockDir) > LOCK_STALE_MS) {
        const o = readOwner(lockDir);
        judged = o && typeof o.token === 'string' ? o.token : null;
      } else {
        judged = undefined;
      }
    } catch (_e) { judged = undefined; } // vanished between mkdir and stat: just retry (after the deadline check)
    if (judged !== undefined) {
      if (seam && typeof seam.afterJudged === 'function') seam.afterJudged(lockDir);
      const moved = `${lockDir}.reclaim.${crypto.randomBytes(6).toString('hex')}`;
      let renamed = false;
      try { fs.renameSync(lockDir, moved); renamed = true; } catch (_e) { /* someone else got there first */ }
      if (renamed) {
        const o = readOwner(moved);
        const movedToken = o && typeof o.token === 'string' ? o.token : null;
        try { fs.rmSync(moved, { recursive: true, force: true }); } catch (_e) { /* nothing */ }
        if (movedToken !== judged) return null; // we moved a live lock: give up, the caller allows
      }
    }
    if (Date.now() >= deadline) return null;
    sleepMs(20);
  }
}

/** Delete this hook's own state files (not the logs, not anything else) untouched for more than `days` days. */
const KEY_PART = '[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9-]+)?'; // <session> or <session>.<agent_id>
const STATE_NAME = new RegExp(
  `^${KEY_PART}\\.(?:turn|t\\d+\\.count)(?:\\.\\d+\\.tmp)?$|^${KEY_PART}\\.lock(?:\\.(?:reclaim|rel)\\.[0-9a-f]+)?$|^${KEY_PART}\\.gate\\.json(?:\\.\\d+\\.tmp)?$`);
function cleanupState(dir, days) {
  const cutoff = Date.now() - days * 86400000;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_e) { return; }
  for (const name of names) {
    if (!STATE_NAME.test(name)) continue;
    const f = path.join(dir, name);
    try {
      if (fs.statSync(f).mtimeMs >= cutoff) continue;
      fs.rmSync(f, { recursive: true, force: true });
    } catch (_e) { /* fail-open */ }
  }
}

/**
 * Retry text, the wording of gate_write_retry in evals/orchestration/run-orchestration-eval.sh.
 * Mode "violations+features" appends the feature gaps and the keep-what-works line (W4, the evaluated mode).
 */
function renderRetry(json, mode) {
  const real = Array.isArray(json.violations) ? json.violations : [];
  const gaps = gapsOf(json);
  const withGaps = mode === 'violations+features' && gaps.length > 0;
  const violations = real.length
    ? real
    : (withGaps ? [] : [{ constraint: '?', rule: 'unspecified', evidence: 'verifier reported a violation' }]);
  const lines = violations.map((v) =>
    `The change you just made breaks project rule ${v.constraint}: \`${v.rule}\`. Observed: \`${v.evidence}\`. Fix this without removing any feature you were asked for, and keep every other rule.`);
  let text = lines.length ? `${lines.join('\n\n')}\n` : '';
  if (withGaps) {
    const extra = gaps.map((g) => `A feature you were asked for so far is not working yet: \`${g}\`.`);
    extra.push('Keep the parts that already work; do not delete or break any existing feature.');
    text += `${extra.join('\n')}\n`;
  }
  return text;
}

// ------------------------------------------------------------------ worker-bound gate file

// Two kinds of "not usable", kept apart on purpose (BL-0306, owner choice B):
//  - the gate file itself is invalid, or it is not this worker's (other session/agent id, repo that is not
//    this cwd, expired): not ours, ignored silently, run exactly as without a file.
//  - the file is valid and ours (right session, repo equals this cwd) but the check cannot run: base is
//    gone, or .git was moved or damaged. That is a verification error, not "no gate": a worker could
//    otherwise switch the gate off by deleting .git. So the file arms the gate, gate-verify.js exits 2
//    and the hook blocks with reason `error`, counted in the same max_blocks.
// The hook therefore makes no git call of its own; every git read happens in gate-verify.js (isolated).
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

let liveBaseCache = null;
function liveBase() {
  if (liveBaseCache === null) liveBaseCache = resolveLiveDir().base;
  return liveBaseCache;
}

/**
 * Find a valid gate file for this payload. Returns {file, source, key, session, mode, maxBlocks} or null.
 * Creates nothing. Every failure (bad id, no file, unreadable, malformed, expired, unknown or missing field,
 * repo mismatch) means "no gate file": the caller then runs exactly as without one.
 * Whether `rules` passes the verifier's schema is NOT judged here: an invalid list is gate-verify exit 2.
 */
function findArmed(payload, isSub) {
  try {
    const sid = payload.session_id;
    if (typeof sid !== 'string' || !ID_RE.test(sid)) return null;
    let key = sid;
    if (isSub) {
      if (typeof payload.agent_id !== 'string' || !ID_RE.test(payload.agent_id)) return null;
      key = `${sid}.${payload.agent_id}`;
    }
    const file = path.join(liveBase(), HOOK_STEM, `${key}.gate.json`);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > 1024 * 1024) return null;
    const g = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isPlain(g)) return null;
    const keys = Object.keys(g);
    if (keys.length !== GATE_KEYS.length || !keys.every((k) => GATE_KEYS.includes(k))) return null;
    if (g.v !== 1 || !isPlain(g.rules)) return null;
    if (typeof g.repo !== 'string' || !path.isAbsolute(g.repo)) return null;
    if (typeof g.base !== 'string' || !SHA_RE.test(g.base)) return null;
    if (!MODES.includes(g.mode)) return null;
    if (!Number.isInteger(g.max_blocks) || g.max_blocks < 0 || g.max_blocks > 2) return null;
    if (typeof g.expires_at !== 'string' || !ISO_RE.test(g.expires_at)) return null;
    const exp = Date.parse(g.expires_at);
    if (Number.isNaN(exp) || exp <= Date.now()) return null;
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const repoReal = fs.realpathSync(cwd);
    if (fs.realpathSync(g.repo) !== repoReal) return null;
    return { file, source: isSub ? 'subagent' : 'session', key, session: sid, mode: g.mode, maxBlocks: g.max_blocks };
  } catch (_e) {
    return null;
  }
}

const shq = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;

// One record per invocation: `done` flips on the first write; `write` lets the outer catch log an error.
const LOG_STATE = { done: false, write: null };

function main() {
  const cfg = readConfig();
  const gate = cfg.per_turn_gate && typeof cfg.per_turn_gate === 'object' ? cfg.per_turn_gate : {};
  const enabled = isEnabled(HOOK_STEM);
  const hasVerifier = typeof gate.verifier === 'string' && gate.verifier.trim() !== '';
  const armingAllowed = gate.session_arming !== false;
  if (!enabled && !hasVerifier && !armingAllowed) return; // never configured, arming vetoed: leave no trace

  let payload = {};
  let payloadOk = true;
  try {
    payload = JSON.parse(readStdin() || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload');
  } catch (_e) {
    payload = {};
    payloadOk = false;
  }

  const isSub = payload.hook_event_name === 'SubagentStop' || (typeof payload.agent_id === 'string' && payload.agent_id !== '');
  const armed = armingAllowed ? findArmed(payload, isSub) : null;
  if (!armed) {
    if (isSub) return; // SubagentStop without its own gate file: not ours, leave no trace
    if (!enabled && !hasVerifier) return; // never configured: leave no trace
  }
  const on = armed ? true : enabled;
  const canVerify = armed ? true : hasVerifier;

  const rawSid = typeof payload.session_id === 'string' ? payload.session_id : '';
  const session = armed ? armed.session : sanitizeSessionId(rawSid);
  const key = armed ? armed.key : session; // state and log file name stem
  let dir = null;
  try {
    dir = path.join(liveBase(), HOOK_STEM);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (_e) {
    return; // no state directory: cannot count or log, so allow silently (fail-open)
  }

  const promptId = typeof payload.prompt_id === 'string' && payload.prompt_id ? payload.prompt_id : null;
  const log = (turn, decision, reason, counter) => {
    if (LOG_STATE.done) return;
    LOG_STATE.done = true;
    try {
      const rec = { session, turn, prompt_id: promptId, decision, reason, counter };
      if (armed) rec.source = armed.source;
      fs.appendFileSync(path.join(dir, `${key}.jsonl`), `${JSON.stringify(rec)}\n`);
    } catch (_e) { /* fail-open */ }
  };

  LOG_STATE.write = log;
  if (!on) {
    log(null, 'allow', 'off', 0);
    return;
  }

  cleanupState(dir, intKnob(gate.state_retention_days, DEFAULT_RETENTION_DAYS, 1));

  const maxBlocks = armed ? armed.maxBlocks : intKnob(gate.max_blocks, DEFAULT_MAX_BLOCKS, 0);
  const mode = armed ? armed.mode : (MODES.includes(gate.mode) ? gate.mode : MODES[0]);
  if (!payloadOk || !canVerify) {
    log(null, 'allow', 'error', 0);
    return;
  }

  const lockDir = path.join(dir, `${key}.lock`);
  const turnFile = path.join(dir, `${key}.turn`);

  // Phase A (short lock): decide the turn and read the cap. No slot is taken here.
  const lockA = acquireLock(lockDir);
  if (!lockA) {
    log(null, 'allow', 'error', 0);
    return;
  }
  let turn;
  let atCap = false;
  let capCounter = 0;
  try {
    const prevTurn = readInt(turnFile);
    turn = prevTurn === 0 ? 1 : (startsNewTurn(payload) ? prevTurn + 1 : prevTurn);
    lockA.writeInt(turnFile, turn);
    capCounter = readInt(path.join(dir, `${key}.t${turn}.count`));
    atCap = capCounter >= maxBlocks;
  } catch (_e) {
    lockA.release();
    log(null, 'allow', 'error', 0);
    return;
  }
  if (!lockA.release()) {
    log(turn, 'allow', 'error', capCounter); // our lock was taken from us: do not trust the decision
    return;
  }
  if (atCap) {
    log(turn, 'allow', 'cap', capCounter);
    return;
  }

  // Verifier and text (unlocked). Everything that can fail happens before any state change or log record.
  let text = null;
  let outcome = 'error';
  let blockReason = 'block';
  try {
    const repo = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const command = armed ? `${shq(process.execPath)} ${shq(GATE_VERIFY)}` : gate.verifier;
    const env = armed ? Object.assign({}, process.env, { AUTOPILOT_GATE_FILE: armed.file }) : undefined;
    const result = runVerifier(command, turn, repo, intKnob(gate.timeout_ms, DEFAULT_TIMEOUT_MS, 1), env);
    if (armed && result.kind === 'error' && result.status === 2) {
      // BL-0318 (owner choice B): the check could not run. Tell the worker, share the max_blocks counter.
      text = `The per-turn check could not run: ${result.stderr || 'no detail'}. Restore what it needs (a path, permission or link you changed) and keep every other rule.\n`;
      outcome = 'block';
      blockReason = 'error';
    }
    else if (result.kind === 'error') outcome = 'error';
    else if (!isReportable(result, mode)) outcome = 'clean';
    else { text = renderRetry(result.json, mode); outcome = 'block'; }
  } catch (_e) {
    outcome = 'error';
  }
  if (outcome !== 'block') {
    log(turn, 'allow', outcome, capCounter);
    return;
  }

  // Phase B (lock): only a block changes the counter. Re-read under the lock; still the same turn and
  // still below the cap, else allow. Nothing is taken before this point, so nothing has to be given back.
  const lockB = acquireLock(lockDir);
  if (!lockB) {
    log(turn, 'allow', 'error', capCounter);
    return;
  }
  let verdict = 'error';
  let counterNow = capCounter;
  const countFile = path.join(dir, `${key}.t${turn}.count`);
  try {
    counterNow = readInt(countFile);
    if (readInt(turnFile) !== turn) verdict = 'error'; // a newer turn began while the verifier ran: this answer is stale
    else if (counterNow >= maxBlocks) verdict = 'cap';
    else { lockB.writeInt(countFile, counterNow + 1); counterNow += 1; verdict = 'block'; }
  } catch (_e) {
    verdict = 'error';
  }
  if (!lockB.release() && verdict === 'block') verdict = 'error'; // mutual exclusion was broken: block less, never more
  if (verdict !== 'block') {
    log(turn, 'allow', verdict, counterNow);
    return;
  }
  log(turn, 'block', blockReason, counterNow);
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: text })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (_e) {
    // fail-open: an unexpected error never blocks a stop; it still leaves its one record
    try { if (LOG_STATE.write) LOG_STATE.write(null, 'allow', 'error', 0); } catch (_e2) { /* nothing */ }
  }
  process.exit(0);
}

module.exports = { acquireLock, cleanupState, STATE_NAME }; // for the lock tests
