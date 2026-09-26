#!/usr/bin/env node
/**
 * advisory-relay — UserPromptSubmit (default-on)
 * Drains this session's group-S advisory queue (written by cost-tracker,
 * check-console, batch-format at Stop) into one additionalContext blob.
 * Opt-out: AUTOPILOT_ADVISORY_RELAY=off (no file access).
 * Inert when the queue file is absent or empty.
 *
 * Never emits permissionDecision. Fail-open: any error → exit 0, no stdout.
 */

'use strict';

const fs = require('fs');
const path = require('path');

try {
  if (process.env.AUTOPILOT_ADVISORY_RELAY === 'off') process.exit(0);

  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  const sid = payload && payload.session_id;
  if (typeof sid !== 'string' || sid.length === 0) process.exit(0);

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
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj.text !== 'string') continue;
    const ts = typeof obj.ts === 'string' ? Date.parse(obj.ts) : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    texts.push(obj.text);
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
