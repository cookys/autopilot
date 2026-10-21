#!/usr/bin/env node
/**
 * advisory-relay — UserPromptSubmit (default-on)
 * Drains this session's group-S advisory queue (written by cost-tracker,
 * check-console, batch-format at Stop) into one additionalContext blob.
 * Opt-out: AUTOPILOT_ADVISORY_RELAY=off (no file access).
 * Inert when the queue file is absent or empty.
 *
 * Never emits permissionDecision. Fail-open: any error → exit 0, no stdout.
 *
 * Also the UserPromptSubmit HOST (mods P1W PERF): awaiting-owner's end-of-wait work and the
 * runs-watch-autostart ensure run in THIS process (hooks/awaiting-owner.js onUserPromptSubmit), so a
 * prompt costs no extra node spawn for them. They run before, and independent of, the relay's own knob;
 * their opt-outs are AUTOPILOT_AWAITING_OWNER / AUTOPILOT_RUNS_WATCH_AUTOSTART=0. Their failures never
 * change this hook's output. A live-panel answer whose first line is [待決回覆] closes the named
 * decision cards here too (opt-out AUTOPILOT_DECIDE_REPLY_CLOSE=off); that step is also fail-open.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DECIDE_REPLY_HEAD = '[待決回覆]';
const DECIDE_SCHEMA = 'autopilot.decision/2';
const DECIDE_ID = /^d-[0-9a-f]{8}(?![0-9a-f])/;

// Same scope walk as scripts/open-decision.js projectScopes (those helpers are not exported).
function decideScopeFiles(cwd) {
  const { scopeFromCwd } = require('../src/status/project-key');
  const { commonDirOf, listScopeFiles, readScopeFile } = require('../src/status/scope-key');
  const scope = scopeFromCwd(path.resolve(cwd || process.cwd()));
  const commonDir = commonDirOf(scope.repo_identity);
  if (!scope.project_key || !commonDir) return [];
  const dir = path.join(commonDir, 'autopilot', 'decisions');
  const out = [];
  for (const file of listScopeFiles(dir, scope.project_key)) {
    if (!readScopeFile(file, { schema: DECIDE_SCHEMA, projectKey: scope.project_key, identity: scope.repo_identity })) continue;
    let decisions = [];
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      decisions = v && v.schema === DECIDE_SCHEMA && Array.isArray(v.decisions) ? v.decisions : [];
    } catch { decisions = []; }
    const live = decisions.some((e) => e && typeof e.id === 'string' && e.id && typeof e.question === 'string' && e.question);
    if (live) out.push(file);
  }
  return out;
}

function closeDecideReply(payload) {
  if (process.env.AUTOPILOT_DECIDE_REPLY_CLOSE === 'off') return;
  const prompt = payload && payload.prompt;
  if (typeof prompt !== 'string') return;
  const lines = prompt.split(/\r?\n/);
  if (lines[0] !== DECIDE_REPLY_HEAD) return;
  const ids = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const m = DECIDE_ID.exec(line);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    ids.push(m[0]);
  }
  if (ids.length === 0) return;
  const { closeDecisionById } = require('../scripts/open-decision.js');
  const files = decideScopeFiles(payload.cwd);
  for (const id of ids) {
    for (const file of files) {
      const r = closeDecisionById(file, id);
      if (r && r.status !== 'absent') break;
    }
  }
}

try {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { try { raw = fs.readFileSync('/dev/stdin', 'utf8'); } catch { raw = ''; } }
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  try {
    if (payload && typeof payload === 'object') require('./awaiting-owner.js').onUserPromptSubmit(payload);
  } catch (e) {
    process.stderr.write(`advisory-relay: live-state hosting fail-open: ${e && e.message ? e.message : e}\n`);
  }
  try {
    if (payload && typeof payload === 'object') closeDecideReply(payload);
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
  }
  if (process.env.AUTOPILOT_ADVISORY_RELAY === 'off') process.exit(0);
  const sid = payload && payload.session_id;
  if (typeof sid !== 'string' || sid.length === 0) {
    process.stderr.write('advisory-relay: debug missing/empty session_id; queue not drained\n');
    process.exit(0);
  }

  const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const qfile = path.join(resolveLiveDir().base, 'advisory-queue', `${sanitizeSessionId(sid)}.jsonl`);

  let st;
  try { st = fs.lstatSync(qfile); } catch { process.exit(0); }
  if (!st.isFile() || st.size === 0) process.exit(0);

  const tmp = `${qfile}.drain.${process.pid}.${Date.now()}`;
  try { fs.renameSync(qfile, tmp); } catch (e) {
    if (e && e.code === 'ENOENT') process.exit(0);
    process.exit(0);
  }

  let body = '';
  try { body = fs.readFileSync(tmp, 'utf8'); } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    process.exit(0);
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const texts = [];
  let expiredOrMalformed = 0;
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch {
      expiredOrMalformed += 1;
      continue;
    }
    if (!obj || typeof obj.text !== 'string') {
      expiredOrMalformed += 1;
      continue;
    }
    const ts = typeof obj.ts === 'string' ? Date.parse(obj.ts) : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) {
      expiredOrMalformed += 1;
      continue;
    }
    texts.push(obj.text);
  }
  if (expiredOrMalformed > 0) {
    process.stderr.write(`advisory-relay: debug dropped ${expiredOrMalformed} expired/malformed entries\n`);
  }

  if (texts.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: texts.join('\n'),
      },
    }));
  }

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  process.exit(0);
} catch {
  process.exit(0);
}
