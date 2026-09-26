#!/usr/bin/env node
/**
 * check-console — Stop [OPT-IN]
 * Scans modified JS/TS files for console.log statements.
 * Warning only — does not block.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in');

if (!isEnabled('check-console')) process.exit(0);

const EXCLUDED = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.config\.[jt]s$/,
  /scripts\//,
  /__tests__\//,
];

const MAX_REPORT = 5;

try {
  let rawIn = '';
  try { rawIn = fs.readFileSync(0, 'utf8'); }
  catch { rawIn = fs.readFileSync('/dev/stdin', 'utf8'); }
  let sessionId = '';
  try {
    const parsed = JSON.parse(rawIn);
    if (parsed && typeof parsed.session_id === 'string') sessionId = parsed.session_id;
  } catch { /* payload optional */ }

  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    timeout: 3000,
    encoding: 'utf8',
  });

  const files = (diff.stdout || '').trim().split('\n').filter(f =>
    /\.[jt]sx?$/.test(f) && !EXCLUDED.some(ex => ex.test(f))
  );

  const hits = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/console\.log\b/.test(lines[i]) && !/^\s*\/\//.test(lines[i])) {
        hits.push({ file, line: i + 1 });
        if (hits.length >= MAX_REPORT) break;
      }
    }
    if (hits.length >= MAX_REPORT) break;
  }

  if (hits.length > 0) {
    const report = hits.map(h => `  ${h.file}:${h.line}`).join('\n');
    const written =
      `console.log found in modified files:\n${report}\n` +
      `Consider removing before committing.\n`;
    process.stderr.write(written);
    try {
      const qtext = written.endsWith('\n') ? written.slice(0, -1) : written;
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
        const qdir = path.join(resolveLiveDir().base, 'advisory-queue');
        fs.mkdirSync(qdir, { recursive: true });
        const qfile = path.join(qdir, `${sanitizeSessionId(sessionId)}.jsonl`);
        const qfd = fs.openSync(qfile, 'a');
        try {
          fs.writeSync(qfd, `${JSON.stringify({ ts: new Date().toISOString(), source: 'check-console', text: qtext })}\n`);
        } finally { fs.closeSync(qfd); }
        const qlines = fs.readFileSync(qfile, 'utf8').split('\n').filter((l) => l.length > 0);
        const qents = [];
        for (const ql of qlines) {
          try { qents.push(JSON.parse(ql)); } catch {
            process.stderr.write('check-console: debug dropped corrupt advisory-queue line\n');
          }
        }
        const qdump = () => qents.map((e) => `${JSON.stringify(e)}\n`).join('');
        while (qents.length > 20) {
          qents.shift();
          process.stderr.write('check-console: debug dropped advisory-queue entry (cap eviction)\n');
        }
        while (qents.length > 1 && Buffer.byteLength(qdump(), 'utf8') > 8192) {
          qents.shift();
          process.stderr.write('check-console: debug dropped advisory-queue entry (cap eviction)\n');
        }
        if (qents.length === 1 && Buffer.byteLength(qdump(), 'utf8') > 8192) {
          let t = typeof qents[0].text === 'string' ? qents[0].text : '';
          while (t.length > 0 && Buffer.byteLength(`${JSON.stringify({ ...qents[0], text: t })}\n`, 'utf8') > 8192) t = t.slice(0, -1);
          qents[0].text = t;
          process.stderr.write('check-console: debug dropped advisory-queue entry (cap eviction)\n');
        }
        const tmpPath = `${qfile}.tmp.${process.pid}`;
        fs.writeFileSync(tmpPath, qdump());
        fs.renameSync(tmpPath, qfile);
      } else {
        process.stderr.write('check-console: debug missing/empty session_id; advisory not enqueued\n');
      }
    } catch { /* queue is best-effort */ }
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`check-console error: ${e.message}\n`);
  process.exit(0);
}
