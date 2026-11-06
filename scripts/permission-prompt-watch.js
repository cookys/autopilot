#!/usr/bin/env node
'use strict';
/**
 * permission-prompt-watch.js - the pane-text FALLBACK for a session stuck at a Claude Code permission dialog
 * (the primary signal is the Notification permission_prompt hook in hooks/awaiting-owner.js; this covers a session whose
 * hooks do not run). One run = one look, meant for a cron or a loop; it keeps its own tiny state between runs.
 *
 *   node scripts/permission-prompt-watch.js --pane <tmux pane id> --cwd <dir> [--session <id>] [--socket <tmux -S path>]
 *       [--hold-s 10] [--state-dir <dir>] [--text-file <file>] [--now-ms <n>]
 *
 * Reads the pane with `tmux capture-pane -p -J` ONLY (or --text-file, for tests). It never sends keys and never answers a prompt.
 * A frame (scripts/lib/permission-prompt-detect.js) that stays the same for --hold-s seconds (default 10) opens ONE owner-panel
 * card (hooks/permission-block-lib.js, the same leg as the hook) in the repo at --cwd; the card closes when the frame is gone.
 * With --session, a session whose attention entry already says BLOCKED_ON_PERMISSION (the hook got there first) gets no second card.
 * The card opened here is closed with the session that opened it (the state record's), also when this run is given another --session.
 * When the pane cannot be read any more (pane or tmux server gone) the card this watcher opened is closed and the state dropped.
 * A card the hook opened for the same pane and cwd is reused, not doubled; the hook closes its own (a hook-owned card of a session
 * killed without SessionEnd stays until the owner closes it).
 * State: <state-dir>/<pane>-<hash of socket+pane>.json, default <live>/permwatch/.
 * stdout: one JSON line {verdict: "idle"|"pending"|"BLOCKED_ON_PERMISSION"|"cleared", ...}. Exit 0; 2 usage; 3 capture failed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const detect = require('./lib/permission-prompt-detect.js');
const block = require('../hooks/permission-block-lib.js');
const L = require('../hooks/live-session-lib.js');

function parse(argv) {
  const o = { holdS: 10 };
  const key = { '--pane': 'pane', '--cwd': 'cwd', '--session': 'session', '--socket': 'socket', '--hold-s': 'holdS', '--state-dir': 'stateDir', '--text-file': 'textFile', '--now-ms': 'nowMs' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!key[argv[i]] || argv[i + 1] === undefined) return null;
    o[key[argv[i]]] = argv[i + 1];
  }
  if (!o.pane || !o.cwd) return null;
  o.holdS = Number(o.holdS);
  return Number.isFinite(o.holdS) && o.holdS >= 0 ? o : null;
}

function capture(o) {
  if (o.textFile) return fs.readFileSync(o.textFile, 'utf8');
  const args = [...(o.socket ? ['-S', o.socket] : []), 'capture-pane', '-p', '-J', '-t', o.pane];
  const r = spawnSync('tmux', args, { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) throw new Error(`tmux capture-pane failed: ${(r.stderr || r.error || '').toString().trim()}`);
  return r.stdout;
}

function hookGotThere(sessionId) {
  const f = L.sessionFile({ session_id: sessionId }, 'attention');
  const cur = f ? L.readJsonFile(f) : null;
  return !!(cur && Array.isArray(cur.pending) && cur.pending.some((e) => e && e.state === block.STATE));
}

function main(argv) {
  const o = parse(argv);
  if (!o) { process.stderr.write('usage: permission-prompt-watch.js --pane <id> --cwd <dir> [--session <id>] [--socket <path>] [--hold-s N] [--state-dir D] [--text-file F] [--now-ms N]\n'); return 2; }
  const dir = o.stateDir || path.join(L.liveBase(), 'permwatch');
  const paneKey = o.pane.replace(/[^A-Za-z0-9_-]/g, '_');
  const file = path.join(dir, `${paneKey}-${crypto.createHash('sha1').update(`${o.socket || ''}\n${o.pane}`).digest('hex').slice(0, 8)}.json`);
  const prev = L.readJsonFile(file);
  const session = o.session || `pane-${paneKey}`;
  const closeOld = () => { if (prev && prev.card) block.closeBlockedCard(prev.card.file, prev.card.id, prev.session || session); };
  let text;
  try { text = capture(o); } catch (e) { closeOld(); if (prev) L.removeFile(file); process.stderr.write(`${e.message}\n`); return 3; }
  const now = o.nowMs !== undefined ? Number(o.nowMs) : Date.now();

  const r = detect.step(prev, text, now, o.holdS * 1000);
  const out = (v, extra) => { process.stdout.write(`${JSON.stringify({ verdict: v, pane: o.pane, session, ...extra })}\n`); return 0; };
  if (!r.state) {
    if (r.clear) { closeOld(); L.removeFile(file); return out('cleared', {}); }
    if (prev) L.removeFile(file);
    return out('idle', {});
  }
  if (prev && prev.fired && prev.sig !== r.state.sig) closeOld(); // a different dialog replaced the reported one
  const card = prev && prev.sig === r.state.sig ? prev.card : undefined;
  let next = { ...r.state, pane: o.pane, session, cwd: o.cwd, ...(card ? { card } : {}) }; // the state record carries frame, command, pane and session
  if (r.trigger) {
    const opened = o.session && hookGotThere(o.session) ? null
      : block.openBlockedCard({ cwd: o.cwd, sessionId: session, paneId: o.pane, summary: r.state.command });
    if (opened) next = { ...next, card: opened };
    L.atomicWriteJson(file, next);
    return out(block.STATE, { command: r.state.command, reason: r.state.reason, frame: r.state.frame, cwd: o.cwd, card: opened ? opened.id : null });
  }
  L.atomicWriteJson(file, next);
  return out(next.fired ? block.STATE : 'pending', { held_s: Math.round((now - next.since_ms) / 1000) });
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parse };
