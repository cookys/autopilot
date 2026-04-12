#!/usr/bin/env node
/**
 * session-summary — Stop
 * Writes session summary (cwd, git status, recent commits) to
 * ~/.claude/sessions/{date}-{sessionId}.md. Appends on multiple Stop events.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function git(args) {
  const r = spawnSync('git', args, { timeout: 3000, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function getSessionId() {
  const raw = process.env.CLAUDE_SESSION_ID || '';
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const crypto = require('crypto');
  return crypto.createHash('sha1').update(process.cwd() + Date.now()).digest('hex').slice(0, 12);
}

try {
  // Consume stdin
  fs.readFileSync('/dev/stdin', 'utf8');

  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19);
  const sid = getSessionId();

  const status = git(['status', '--short']);
  const log = git(['log', '--oneline', '-10']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

  const content = [
    `## ${time}`,
    '',
    `**CWD:** \`${process.cwd()}\``,
    `**Branch:** \`${branch}\``,
    '',
    '### Git Status',
    '```',
    status || '(clean)',
    '```',
    '',
    '### Recent Commits',
    '```',
    log || '(no commits)',
    '```',
    '',
    '---',
    '',
  ].join('\n');

  const filePath = path.join(sessionsDir, `${date}-${sid}.md`);

  // Append header on first write
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# Session ${sid} — ${date}\n\n`);
  }

  fs.appendFileSync(filePath, content);
  process.exit(0);
} catch (e) {
  process.stderr.write(`session-summary error: ${e.message}\n`);
  process.exit(0);
}
