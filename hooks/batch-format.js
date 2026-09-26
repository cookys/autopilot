#!/usr/bin/env node
/**
 * batch-format — Stop [OPT-IN, timeout: 300s]
 * Batch formats (Prettier) and typechecks (tsc) all JS/TS files edited this session.
 * Reads file list from accumulator.js output.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in');

if (!isEnabled('batch-format')) process.exit(0);

const MAX_ERROR_LINES = 30;

function getSessionId() {
  const raw = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
}

function findBin(name) {
  const local = path.join('node_modules', '.bin', name);
  if (fs.existsSync(local)) return local;
  return null;
}

try {
  let rawIn = '';
  try { rawIn = fs.readFileSync(0, 'utf8'); }
  catch { rawIn = fs.readFileSync('/dev/stdin', 'utf8'); }
  let payloadSessionId = '';
  try {
    const parsed = JSON.parse(rawIn);
    if (parsed && typeof parsed.session_id === 'string') payloadSessionId = parsed.session_id;
  } catch { /* payload optional */ }

  const sid = getSessionId();
  const listFile = path.join(os.tmpdir(), `claude-edited-${sid}.txt`);

  if (!fs.existsSync(listFile)) process.exit(0);

  const content = fs.readFileSync(listFile, 'utf8').trim();
  fs.unlinkSync(listFile); // Clean up

  if (!content) process.exit(0);

  const files = [...new Set(content.split('\n'))].filter(f => fs.existsSync(f));
  if (files.length === 0) process.exit(0);

  // Prettier
  const prettier = findBin('prettier');
  if (prettier) {
    const r = spawnSync(prettier, ['--write', ...files], {
      timeout: 60000,
      encoding: 'utf8',
    });
    if (r.stderr) {
      const written = `Prettier warnings:\n${r.stderr.slice(0, 500)}\n`;
      process.stderr.write(written);
      try {
        if (typeof payloadSessionId === 'string' && payloadSessionId.length > 0) {
          const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
          const qdir = path.join(resolveLiveDir().base, 'advisory-queue');
          fs.mkdirSync(qdir, { recursive: true });
          const qfile = path.join(qdir, `${sanitizeSessionId(payloadSessionId)}.jsonl`);
          const qtext = written.endsWith('\n') ? written.slice(0, -1) : written;
          const qfd = fs.openSync(qfile, 'a');
          try {
            fs.writeSync(qfd, `${JSON.stringify({ ts: new Date().toISOString(), source: 'batch-format', text: qtext })}\n`);
          } finally { fs.closeSync(qfd); }
          let qlines = fs.readFileSync(qfile, 'utf8').split('\n').filter((l) => l.length > 0);
          const qents = [];
          for (const ql of qlines) {
            try { qents.push(JSON.parse(ql)); } catch { qents.push({ ts: new Date().toISOString(), source: 'batch-format', text: ql }); }
          }
          while (qents.length > 20) qents.shift();
          const qdump = () => qents.map((e) => `${JSON.stringify(e)}\n`).join('');
          while (qents.length > 1 && Buffer.byteLength(qdump(), 'utf8') > 8192) qents.shift();
          if (qents.length === 1 && Buffer.byteLength(qdump(), 'utf8') > 8192) {
            let t = typeof qents[0].text === 'string' ? qents[0].text : '';
            while (t.length > 0 && Buffer.byteLength(`${JSON.stringify({ ...qents[0], text: t })}\n`, 'utf8') > 8192) t = t.slice(0, -1);
            qents[0].text = t;
          }
          fs.writeFileSync(qfile, qdump());
        }
      } catch { /* queue is best-effort */ }
    }
  }

  // TypeScript check (only if TS files present)
  const tsFiles = files.filter(f => /\.tsx?$/.test(f));
  if (tsFiles.length > 0) {
    const r = spawnSync('npx', ['tsc', '--noEmit'], {
      timeout: 120000,
      encoding: 'utf8',
    });
    if (r.stdout) {
      const lines = r.stdout.split('\n').slice(0, MAX_ERROR_LINES);
      if (lines.length > 0) {
        process.stderr.write(`TypeScript errors:\n${lines.join('\n')}\n`);
      }
    }
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`batch-format error: ${e.message}\n`);
  process.exit(0);
}
