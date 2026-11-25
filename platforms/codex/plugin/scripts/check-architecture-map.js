#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REQUIRED_HEADERS = ['名稱', '狀態', '在哪裡', '依據', '互動介面', '驗收方式'];
const REQUESTED_HEADERS = ['名稱', '狀態', '在哪裡'];
const FULL_STATUSES = new Set(['live', 'building', 'planned']);

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    base: 'HEAD~1',
    head: 'HEAD',
    mode: 'block',
    runInteraction: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === '--repo' && val !== undefined) {
      args.repo = path.resolve(val);
      i++;
    } else if (flag === '--base' && val !== undefined) {
      args.base = val;
      i++;
    } else if (flag === '--head' && val !== undefined) {
      args.head = val;
      i++;
    } else if (flag === '--mode' && val !== undefined) {
      if (val !== 'warn' && val !== 'block') {
        throw new Error(`Invalid --mode: ${val} (expected warn or block)`);
      }
      args.mode = val;
      i++;
    } else if (flag === '--run-interaction') {
      args.runInteraction = true;
    }
  }
  return args;
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.slice(1, -1);
  } else {
    trimmed = trimmed.slice(1);
  }
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseArchitectureTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  let headers = null;
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = splitTableRow(lines[i]);
    if (!cells) {
      if (headers) break;
      continue;
    }
    if (!headers) {
      const hasAll = REQUIRED_HEADERS.every((h) => cells.includes(h));
      if (hasAll) {
        headers = cells;
      }
      continue;
    }
    if (isSeparatorRow(cells)) {
      continue;
    }
    const row = { _raw: lines[i].trim() };
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (cells[c] || '').trim();
    }
    rows.push(row);
  }

  return rows;
}

function globToRegex(glob) {
  const normalized = glob.replace(/^`+|`+$/g, '').trim();
  if (!normalized) return null;
  let regexStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
}

function extractGlobs(whereCell) {
  if (!whereCell) return [];
  return whereCell
    .split(/[,，\s]+/)
    .map((s) => s.replace(/^`+|`+$/g, '').trim())
    .filter(Boolean);
}

function getChangedFiles(repo, base, head) {
  try {
    const out = execFileSync(
      'git',
      ['-C', repo, 'diff', '--name-only', base, head],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getChangedArchLines(repo, base, head) {
  try {
    const out = execFileSync(
      'git',
      ['-C', repo, 'diff', '-U0', base, head, '--', 'ARCHITECTURE.md'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const added = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('+') && !line.startsWith('+++ ')) {
        added.add(line.slice(1).trim());
      }
    }
    return added;
  } catch {
    return new Set();
  }
}

function checkArchitectureMap(options) {
  const { repo, base, head, mode, runInteraction } = options;
  const mapPath = path.join(repo, 'ARCHITECTURE.md');

  if (!fs.existsSync(mapPath)) {
    return {
      ok: true,
      note: 'no_map',
      findings: [],
      exitCode: 0,
    };
  }

  const content = fs.readFileSync(mapPath, 'utf8');
  const rows = parseArchitectureTable(content);
  const findings = [];

  const changedFiles = getChangedFiles(repo, base, head);
  const archUpdated = changedFiles.includes('ARCHITECTURE.md');
  const changedArchLines = runInteraction
    ? getChangedArchLines(repo, base, head)
    : new Set();

  for (const row of rows) {
    const rowName = row['名稱'] || '(unnamed)';
    const status = (row['狀態'] || '').toLowerCase();

    // Rule 1: required columns
    const required = FULL_STATUSES.has(status)
      ? REQUIRED_HEADERS
      : status === 'requested'
        ? REQUESTED_HEADERS
        : [];
    if (required.length > 0) {
      const missing = required.filter((col) => !row[col]);
      if (missing.length > 0) {
        findings.push({
          rule: 'missing_columns',
          row: rowName,
          detail: `missing columns: ${missing.join(', ')}`,
        });
      }
    }

    // Rule 2: diff matches glob without ARCHITECTURE.md update
    const globs = extractGlobs(row['在哪裡']);
    if (globs.length > 0 && changedFiles.length > 0 && !archUpdated) {
      const matchers = globs.map(globToRegex).filter(Boolean);
      const matched = changedFiles.some((file) =>
        matchers.some((re) => re.test(file))
      );
      if (matched) {
        findings.push({
          rule: 'unupdated_row',
          row: rowName,
          detail: 'matched files changed without updating ARCHITECTURE.md',
        });
      }
    }

    // Rule 3: interaction interface requires existing tests/interaction/ script
    const iface = (row['互動介面'] || '').trim();
    if (iface && iface !== '無') {
      const verify = (row['驗收方式'] || '').trim();
      const match = verify.match(/tests\/interaction\/[^\s`"')]+/);
      if (!match) {
        findings.push({
          rule: 'missing_interaction_script',
          row: rowName,
          detail: '驗收方式 must reference a file under tests/interaction/',
        });
      } else {
        const scriptRel = match[0];
        const scriptAbs = path.join(repo, scriptRel);
        if (!fs.existsSync(scriptAbs) || !fs.statSync(scriptAbs).isFile()) {
          findings.push({
            rule: 'missing_interaction_script',
            row: rowName,
            detail: `interaction script not found: ${scriptRel}`,
          });
        } else if (runInteraction && changedArchLines.has(row._raw)) {
          const res = spawnSync(scriptAbs, [], {
            cwd: repo,
            timeout: 120_000,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
          });
          if (res.error || res.status !== 0) {
            const code =
              res.status !== null && res.status !== undefined
                ? String(res.status)
                : res.signal
                  ? `signal ${res.signal}`
                  : res.error?.code || res.error?.message || 'unknown';
            const stderrTail = (res.stderr || '').slice(-300);
            findings.push({
              rule: 'interaction_script_failed',
              row: rowName,
              detail: `interaction script failed (${scriptRel}, exit ${code}): ${stderrTail}`,
            });
          }
        }
      }
    }
  }

  const hasBlocking = findings.some((f) => {
    if (
      f.rule === 'missing_columns' ||
      f.rule === 'missing_interaction_script' ||
      f.rule === 'interaction_script_failed'
    ) {
      return true;
    }
    if (f.rule === 'unupdated_row' && mode === 'block') {
      return true;
    }
    return false;
  });

  return {
    ok: !hasBlocking,
    findings,
    exitCode: hasBlocking ? 1 : 0,
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    const result = checkArchitectureMap(args);
    const output = { ok: result.ok, findings: result.findings };
    if (result.note) output.note = result.note;
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(result.exitCode);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        findings: [{ rule: 'error', row: '', detail: err.message }],
      }) + '\n'
    );
    process.exit(1);
  }
}

module.exports = { checkArchitectureMap, parseArchitectureTable, globToRegex };
