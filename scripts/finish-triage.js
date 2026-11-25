#!/usr/bin/env node
/**
 * finish-triage.js — P5 finish three-cell verifier (merged / live pin / Used) & look/skip triage.
 *
 * Usage:
 *   node scripts/finish-triage.js --task <id> --sha <merged_sha> [--repo <dir>] [--json]
 *
 * Environment:
 *   FINISH_TRIAGE_FLEET_BIN  Override `fleet` binary path (for testing/stubbing).
 *
 * Exit codes:
 *   0  All three cells (merged, live pin, Used) verified.
 *   1  One or more cells failed verification.
 *   2  Usage / CLI argument error.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');

const PLACEHOLDER_RE = /^(?:n\/a|tbd|none|-)$/i;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_PNG_BYTES = 2048;

function isPlaceholder(val) {
  return !val || PLACEHOLDER_RE.test(String(val).trim());
}

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function parseArgs(argv) {
  const args = { task: '', sha: '', repo: process.cwd(), json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task' && i + 1 < argv.length) {
      args.task = argv[++i];
    } else if (a === '--sha' && i + 1 < argv.length) {
      args.sha = argv[++i];
    } else if (a === '--repo' && i + 1 < argv.length) {
      args.repo = argv[++i];
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/finish-triage.js --task <id> --sha <merged_sha> [--repo <dir>] [--json]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!args.task || !args.sha || args.sha.length < 16) {
    console.error('Error: --task <id> and --sha <merged_sha> (>=16 chars) are required.');
    process.exit(2);
  }
  return args;
}

function fetchFleetTask(taskId) {
  const fleetBin = process.env.FINISH_TRIAGE_FLEET_BIN || 'fleet';
  try {
    const out = execFileSync(fleetBin, ['task', 'show', taskId, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return JSON.parse(out);
  } catch (err) {
    return { _error: err.message || String(err) };
  }
}

function collectTaskText(taskObj) {
  const parts = [];
  if (Array.isArray(taskObj.comments)) {
    for (const c of taskObj.comments) {
      if (c && typeof c.text === 'string') {
        parts.push(c.text);
      }
    }
  }
  if (typeof taskObj.progress === 'string') {
    parts.push(taskObj.progress);
  }
  if (typeof taskObj.result === 'string') {
    parts.push(taskObj.result);
  }
  if (typeof taskObj.result_text === 'string') {
    parts.push(taskObj.result_text);
  }
  return parts.join('\n');
}

function verifyUsedCommand(filePath, sha16) {
  if (isPlaceholder(filePath)) {
    return { ok: false, reason: `Used: command path is placeholder (${filePath})` };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `Used: command file not found: ${filePath}` };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) {
    return { ok: false, reason: `Used: command file is empty: ${filePath}` };
  }

  const lines = raw.split(/\r?\n/);
  let cmdLine = null;
  let rcLine = null;
  let outShaLine = null;
  let headerEndIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (cmdLine === null && /^cmd:\s*(.+)$/.test(line)) {
      cmdLine = line.match(/^cmd:\s*(.+)$/)[1].trim();
    } else if (rcLine === null && /^rc=(\d+)$/.test(line.trim())) {
      rcLine = parseInt(line.trim().match(/^rc=(\d+)$/)[1], 10);
    } else if (outShaLine === null && /^out-sha256:\s*([0-9a-fA-F]{64})$/.test(line.trim())) {
      outShaLine = line.trim().match(/^out-sha256:\s*([0-9a-fA-F]{64})$/)[1].toLowerCase();
      headerEndIdx = i;
      break;
    }
  }

  if (!cmdLine || isPlaceholder(cmdLine)) {
    return { ok: false, reason: 'Used: command missing valid cmd: line' };
  }
  if (rcLine === null || rcLine !== 0) {
    return { ok: false, reason: `Used: command rc=${rcLine} (expected rc=0)` };
  }
  if (!outShaLine) {
    return { ok: false, reason: 'Used: command missing valid out-sha256: <64-hex> line' };
  }

  const outputLines = lines.slice(headerEndIdx + 1);
  // Trim trailing empty line if file ends with newline
  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === '') {
    outputLines.pop();
  }
  if (outputLines.length < 3) {
    return { ok: false, reason: `Used: command output block has ${outputLines.length} lines (< 3 required)` };
  }

  const outputBlock = outputLines.join('\n');
  const computedSha = sha256Hex(outputBlock);
  if (computedSha !== outShaLine) {
    return { ok: false, reason: `Used: command out-sha256 mismatch (expected ${outShaLine}, got ${computedSha})` };
  }

  if (!outputBlock.includes(sha16)) {
    return { ok: false, reason: `Used: command output block does not contain sha16 (${sha16})` };
  }

  return { ok: true, kind: 'command', file: filePath };
}

function verifyUsedScreenshot(pngPath, sha16) {
  if (isPlaceholder(pngPath)) {
    return { ok: false, reason: `Used: screenshot path is placeholder (${pngPath})` };
  }
  if (!fs.existsSync(pngPath)) {
    return { ok: false, reason: `Used: screenshot file not found: ${pngPath}` };
  }

  const buf = fs.readFileSync(pngPath);
  if (buf.length < MIN_PNG_BYTES) {
    return { ok: false, reason: `Used: screenshot size ${buf.length} < ${MIN_PNG_BYTES} bytes` };
  }
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, reason: 'Used: screenshot missing PNG magic header' };
  }

  const metaPath = `${pngPath}.meta`;
  if (!fs.existsSync(metaPath)) {
    return { ok: false, reason: `Used: screenshot .meta file not found: ${metaPath}` };
  }
  const metaRaw = fs.readFileSync(metaPath, 'utf8');
  if (!metaRaw.trim()) {
    return { ok: false, reason: `Used: screenshot .meta file is empty: ${metaPath}` };
  }

  const meta = {};
  for (const line of metaRaw.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (m) {
      meta[m[1].toLowerCase()] = m[2].trim();
    }
  }

  const expectedPngSha = meta['png-sha256'];
  if (!expectedPngSha || !/^[0-9a-fA-F]{64}$/.test(expectedPngSha)) {
    return { ok: false, reason: 'Used: screenshot .meta missing valid png-sha256' };
  }
  const actualPngSha = sha256Hex(buf);
  if (actualPngSha !== expectedPngSha.toLowerCase()) {
    return { ok: false, reason: `Used: screenshot png-sha256 mismatch (expected ${expectedPngSha}, got ${actualPngSha})` };
  }

  if (!meta.action || isPlaceholder(meta.action)) {
    return { ok: false, reason: 'Used: screenshot .meta missing valid action' };
  }
  if (meta.result !== 'ok') {
    return { ok: false, reason: `Used: screenshot .meta result=${meta.result || 'missing'} (expected ok)` };
  }
  if (!metaRaw.includes(sha16)) {
    return { ok: false, reason: `Used: screenshot .meta does not contain sha16 (${sha16})` };
  }

  return { ok: true, kind: 'screenshot', file: pngPath };
}

function verifyUsed(text, sha16) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const cmdMatch = line.match(/^\s*Used:\s*command\s+(.+?)\s*$/);
    if (cmdMatch) {
      return verifyUsedCommand(cmdMatch[1], sha16);
    }
    const ssMatch = line.match(/^\s*Used:\s*screenshot\s+(.+?)\s*$/);
    if (ssMatch) {
      return verifyUsedScreenshot(ssMatch[1], sha16);
    }
  }
  return { ok: false, reason: 'Used: line not found in task comments/progress' };
}

function verifyLivePin(text, sha16, repo, sha) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const notNeededMatch = line.match(/^\s*Pin:\s*not-needed\s+(.+?)\s*$/);
    if (notNeededMatch) {
      const reason = notNeededMatch[1].trim();
      if (isPlaceholder(reason) || reason.length < 20) {
        return { ok: false, reason: `Pin: not-needed reason too short or placeholder (${reason.length} chars, need >= 20)` };
      }
      const classes = loadLookClasses();
      let touched = [];
      try {
        const shipped = (classes && classes.shipped) || [];
        touched = changedFiles(repo, sha, null).filter((f) => shipped.some((re) => re.test(f)));
        if (!classes) return { ok: false, reason: 'Pin: not-needed refused: look-classes.json unreadable (conservative)' };
      } catch {
        return { ok: false, reason: 'Pin: not-needed refused: cannot read the diff (conservative)' };
      }
      if (touched.length > 0) {
        return { ok: false, reason: `Pin: not-needed refused: diff touches plugin-shipped path ${touched[0]}` };
      }
      return { ok: true, kind: 'not-needed', reason };
    }

    const pinnedMatch = line.match(/^\s*Pinned:\s*(\S+)\s+(.+?)\s*$/);
    if (pinnedMatch) {
      const host = pinnedMatch[1].trim();
      const target = pinnedMatch[2].trim();
      if (isPlaceholder(host) || isPlaceholder(target)) {
        return { ok: false, reason: `Pinned: placeholder host or target (${host} ${target})` };
      }
      if (/^[0-9a-fA-F]{16,}$/.test(target)) {
        if (!target.toLowerCase().startsWith(sha16.toLowerCase())) {
          return { ok: false, reason: `Pinned: sha16 mismatch (expected ${sha16}, got ${target})` };
        }
        return { ok: true, kind: 'sha16', host, sha16: target };
      }
      // Otherwise treat target as readback file
      if (!fs.existsSync(target)) {
        return { ok: false, reason: `Pinned: readback file not found: ${target}` };
      }
      const rb = fs.readFileSync(target, 'utf8');
      if (!rb.trim() || !rb.includes(sha16)) {
        return { ok: false, reason: `Pinned: readback file empty or missing sha16 (${sha16})` };
      }
      return { ok: true, kind: 'readback', host, file: target };
    }
  }
  return { ok: false, reason: 'Pinned: or Pin: not-needed line not found' };
}

function verifyMerged(repo, sha) {
  try {
    execFileSync('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return { ok: true, sha };
  } catch (err) {
    return { ok: false, reason: `merged sha ${sha} not found in repo ${repo}` };
  }
}

function loadLookClasses() {
  const candidates = [
    path.join(__dirname, 'look-classes.json'),
    path.join(process.cwd(), 'scripts', 'look-classes.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(data.classes)) {
          const list = data.classes.map((c) => ({ name: c.name, scope: c.scope === 'changed' ? 'changed' : 'added', re: new RegExp(c.pattern) }));
          list.shipped = (Array.isArray(data.plugin_shipped) ? data.plugin_shipped : []).map((x) => new RegExp(x));
          return list;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function changedFiles(repo, sha, filter) {
  const args = ['-C', repo, 'diff', '--name-only'];
  if (filter) args.push(`--diff-filter=${filter}`);
  const hasParent = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', `${sha}^1`], { stdio: 'ignore' }).status === 0;
  args.push(hasParent ? `${sha}^1` : '4b825dc642cb6eb9a060e54bf8d69288fbee4904', sha);
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 })
    .split(/\r?\n/).filter(Boolean);
}

function computeTriage(taskObj, text, repo, sha) {
  const reasons = [];

  if (taskObj.needs_look === true || /^\s*Needs-look:\s*yes\s*$/im.test(text)) {
    reasons.push('needs_look');
  }
  if (/^\s*First-live:\s*yes\s*$/im.test(text)) {
    reasons.push('First-live: yes');
  }

  const classes = loadLookClasses();
  if (!classes) {
    reasons.push('look-classes.json unreadable (conservative look)');
    return { decision: 'look', reasons };
  }

  try {
    const added = changedFiles(repo, sha, 'A');
    const changed = changedFiles(repo, sha, null);
    for (const cls of classes) {
      const files = cls.scope === 'changed' ? changed : added;
      for (const file of files) {
        if (cls.re.test(file)) reasons.push(`${cls.scope} ${cls.name}: ${file}`);
      }
    }
  } catch {
    reasons.push('git diff failed (conservative look)');
  }

  return {
    decision: reasons.length > 0 ? 'look' : 'skip',
    reasons,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const sha16 = args.sha.slice(0, 16);

  const taskObj = fetchFleetTask(args.task);
  if (taskObj._error) {
    console.error(`Error fetching fleet task ${args.task}: ${taskObj._error}`);
    process.exit(1);
  }

  const text = collectTaskText(taskObj);
  const merged = verifyMerged(args.repo, args.sha);
  const livePin = verifyLivePin(text, sha16, args.repo, args.sha);
  const used = verifyUsed(text, sha16);
  const triage = computeTriage(taskObj, text, args.repo, args.sha);

  const ok = merged.ok && livePin.ok && used.ok;
  const result = {
    ok,
    task: args.task,
    sha: args.sha,
    sha16,
    cells: {
      merged,
      live_pin: livePin,
      used,
    },
    triage,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`merged: ${merged.ok ? 'PASS' : 'FAIL - ' + merged.reason}`);
    console.log(`live_pin: ${livePin.ok ? 'PASS' : 'FAIL - ' + livePin.reason}`);
    console.log(`used: ${used.ok ? 'PASS' : 'FAIL - ' + used.reason}`);
    console.log(`triage: ${triage.decision}${triage.reasons.length ? ' (' + triage.reasons.join('; ') + ')' : ''}`);
  }

  process.exit(ok ? 0 : 1);
}

main();
