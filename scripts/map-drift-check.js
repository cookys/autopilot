#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArchitectureTable } = require('./check-architecture-map');

const MS_PER_24H = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    tasks: null,
    now: new Date().toISOString(),
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === '--repo' && val !== undefined) {
      args.repo = path.resolve(val);
      i++;
    } else if (flag === '--tasks' && val !== undefined) {
      args.tasks = path.resolve(val);
      i++;
    } else if (flag === '--now' && val !== undefined) {
      args.now = val;
      i++;
    }
  }
  return args;
}

function hasMapReadyMarker(markdown) {
  return markdown.split(/\r?\n/).some((line) => line.trim() === 'map_ready: true');
}

function extractRepoPaths(text) {
  if (!text) return [];
  const tokens = text
    .split(/[\s,，;；()\[\]"'`]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const paths = [];
  for (const token of tokens) {
    if (token.startsWith('http://') || token.startsWith('https://')) continue;
    if (token.includes('/') && /\.[A-Za-z0-9]{1,10}$/.test(token)) {
      const cleaned = token.replace(/^\.\/+/, '');
      if (cleaned && !paths.includes(cleaned)) {
        paths.push(cleaned);
      }
    }
  }
  return paths;
}

function matchesTaskId(text, taskId) {
  if (!text || !taskId) return false;
  if (text.includes(taskId)) return true;
  if (taskId.length >= 8 && text.includes(taskId.slice(0, 8))) return true;
  return false;
}

function addFinding(findingsByKey, finding) {
  const existing = findingsByKey.get(finding.key);
  if (!existing) {
    findingsByKey.set(finding.key, { ...finding });
    return;
  }
  if (finding.detail && !existing.detail.includes(finding.detail)) {
    existing.detail = `${existing.detail}; ${finding.detail}`;
  }
}

function checkMapDrift(options) {
  const repo = path.resolve(options.repo);
  const repoName = path.basename(repo);
  const mapPath = path.join(repo, 'ARCHITECTURE.md');

  if (!fs.existsSync(mapPath)) {
    return { ok: true, findings: [], skipped: 'no_map' };
  }

  const content = fs.readFileSync(mapPath, 'utf8');
  if (!hasMapReadyMarker(content)) {
    return { ok: true, findings: [], skipped: 'not_map_ready' };
  }

  let tasks = [];
  if (options.tasks && fs.existsSync(options.tasks)) {
    tasks = JSON.parse(fs.readFileSync(options.tasks, 'utf8'));
  } else if (Array.isArray(options.tasksData)) {
    tasks = options.tasksData;
  }

  const nowMs = Date.parse(options.now || new Date().toISOString());
  const rows = parseArchitectureTable(content);
  const findingsByKey = new Map();

  // Rule 2: done_task_no_row
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    const referenced = rows.some(
      (row) => matchesTaskId(row['依據'], task.id) || matchesTaskId(row['名稱'], task.id)
    );
    if (!referenced) {
      addFinding(findingsByKey, {
        key: `${repoName}:task:${task.id}`,
        rule: 'done_task_no_row',
        task: task.id,
        detail: `done task ${task.id} is not referenced in any ARCHITECTURE.md row`,
      });
    }
  }

  // Rule 3: live_row_missing_evidence
  for (const row of rows) {
    const rowName = row['名稱'] || '(unnamed)';
    const status = (row['狀態'] || '').toLowerCase();
    if (status !== 'live') continue;

    const candidates = [
      ...extractRepoPaths(row['依據']),
      ...extractRepoPaths(row['驗收方式']),
    ];
    for (const relPath of candidates) {
      const absPath = path.join(repo, relPath);
      if (!fs.existsSync(absPath)) {
        addFinding(findingsByKey, {
          key: `${repoName}:row:${rowName}`,
          rule: 'live_row_missing_evidence',
          row: rowName,
          detail: `missing evidence path: ${relPath}`,
        });
      }
    }
  }

  // Rule 4: requested_task_done
  const doneTasks = tasks.filter((t) => t.status === 'done');
  for (const row of rows) {
    const rowName = row['名稱'] || '(unnamed)';
    const status = (row['狀態'] || '').toLowerCase();
    if (status !== 'requested') continue;

    for (const task of doneTasks) {
      if (matchesTaskId(row['依據'], task.id)) {
        addFinding(findingsByKey, {
          key: `${repoName}:row:${rowName}`,
          rule: 'requested_task_done',
          row: rowName,
          task: task.id,
          detail: `requested row references done task ${task.id}`,
        });
      }
    }
  }

  // Rule 5: intake_receipt_unreferenced
  const requestedRows = rows.filter(
    (r) => (r['狀態'] || '').toLowerCase() === 'requested'
  );
  for (const task of tasks) {
    const intake = task.intake;
    if (!intake) continue;
    if (intake.verdict !== '沒有' && intake.verdict !== '部分') continue;
    if (!intake.receipt || !intake.at) continue;

    const intakeMs = Date.parse(intake.at);
    if (Number.isNaN(intakeMs) || Number.isNaN(nowMs)) continue;
    if (nowMs - intakeMs <= MS_PER_24H) continue;

    const referenced = requestedRows.some((row) =>
      Object.values(row).some((val) => typeof val === 'string' && val.includes(intake.receipt))
    );
    if (!referenced) {
      addFinding(findingsByKey, {
        key: `${repoName}:receipt:${intake.receipt}`,
        rule: 'intake_receipt_unreferenced',
        task: task.id,
        detail: `intake receipt ${intake.receipt} (${intake.verdict}) >24h old is not referenced by any requested row`,
      });
    }
  }

  const findings = Array.from(findingsByKey.values());
  return {
    ok: findings.length === 0,
    findings,
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    const result = checkMapDrift(args);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        findings: [{ key: 'error', rule: 'error', detail: err.message }],
      }) + '\n'
    );
    process.exit(1);
  }
}

module.exports = { checkMapDrift, hasMapReadyMarker, extractRepoPaths };
