#!/usr/bin/env node
/**
 * quota-wait-sweep.js — Read-only scan of `fleet tasks` for quota-wait wording,
 * joined with current engine quota readings from `quota-wait-check.js`.
 *
 * Does NOT modify any task.
 *
 * Usage:
 *   node scripts/quota-wait-sweep.js [--json]
 *
 * Env:
 *   AUTOPILOT_FLEET_TASKS_JSON_FILE  Optional path to a JSON file mocking `fleet tasks --json`.
 *   AUTOPILOT_FLEET_QUOTA_JSON_FILE  Optional path to a JSON file mocking `fleet seats --quota --json`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkEngineQuota, normalizeEngine } = require('./quota-wait-check.js');

const QUOTA_WAIT_RE = /等\s*([A-Za-z0-9_.-]*)\s*額度|quota[\s_-]*wait|wait(?:ing)?\s+(?:for|on)\s+quota/i;
const SWEEP_MATCH_RE = QUOTA_WAIT_RE;

function readOpenFleetTaskFiles(dir) {
  const targetDir = dir || process.env.AUTOPILOT_OPEN_FLEET_TASKS_DIR || '/run/user/1001/autopilot/open-fleet-tasks';
  const tasks = [];
  try {
    if (!fs.existsSync(targetDir)) return tasks;
    for (const name of fs.readdirSync(targetDir)) {
      if (!name.endsWith('.txt')) continue;
      const fullPath = path.join(targetDir, name);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        // One task per line: "<26-char id> <state> <title>".
        for (const line of content.split(/\r?\n/)) {
          const m = /^([0-9A-Z]{26})\s+(\S+)\s+(.*)$/.exec(line);
          if (m) tasks.push({ id: m[1], status: m[2], title: m[3] });
        }
      } catch {
        // ignore unreadable task file
      }
    }
  } catch {
    // ignore missing directory
  }
  return tasks;
}

function readFleetTasks(opts = {}) {
  const extraTasks = (opts.openFleetTasksDir || (!opts.tasksData && !opts.tasksJsonFile && !process.env.AUTOPILOT_FLEET_TASKS_JSON_FILE))
    ? readOpenFleetTaskFiles(opts.openFleetTasksDir)
    : [];
  const mergeExtra = (baseTasks) => {
    if (!extraTasks.length) return baseTasks;
    const seen = new Set(baseTasks.map((t) => t && (t.id || t.task_id)).filter(Boolean));
    const merged = baseTasks.slice();
    for (const t of extraTasks) {
      if (!t.id || !seen.has(t.id)) merged.push(t);
    }
    return merged;
  };
  if (opts.tasksData) return { ok: true, tasks: mergeExtra(opts.tasksData) };
  const mockFile = opts.tasksJsonFile || process.env.AUTOPILOT_FLEET_TASKS_JSON_FILE;
  if (mockFile) {
    try {
      const raw = fs.readFileSync(mockFile, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
      return { ok: true, tasks: mergeExtra(list) };
    } catch (err) {
      return { ok: false, error: `讀取任務假檔失敗 (${mockFile}): ${err.message}`, tasks: [] };
    }
  }
  try {
    const out = execFileSync('fleet', ['tasks', '--json'], {
      encoding: 'utf8',
      timeout: opts.timeoutMs || 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    return { ok: true, tasks: mergeExtra(list) };
  } catch (err) {
    if (extraTasks.length) return { ok: true, tasks: extraTasks };
    return { ok: false, error: `fleet tasks --json 執行失敗: ${err.message}`, tasks: [] };
  }
}

function extractTaskText(task) {
  if (!task || typeof task !== 'object') return '';
  const parts = [task.id || task.task_id, task.title, task.content, task.description, task.note, task.status_note, task.last_comment];
  if (Array.isArray(task.comments)) {
    for (const c of task.comments) {
      if (typeof c === 'string') parts.push(c);
      else if (c && typeof c === 'object') parts.push(c.body || c.text || c.content || '');
    }
  }
  return parts.filter((v) => typeof v === 'string' && v.trim()).join(' ');
}

function guessEngineFromTask(task) {
  if (!task || typeof task !== 'object') return '';
  if (typeof task.engine === 'string' && task.engine.trim()) return normalizeEngine(task.engine);
  const text = [task.title, task.content, task.description, task.note, task.status_note].filter(Boolean).join(' ');
  const m = QUOTA_WAIT_RE.exec(text);
  if (m && m[1]) return normalizeEngine(m[1]);
  for (const kw of ['codex', 'agy', 'carbon', 'hydrogen', 'claude', 'grok', 'kimi', 'cursor', 'opencode']) {
    if (text.toLowerCase().includes(kw)) return normalizeEngine(kw);
  }
  return 'unknown';
}

function sweepQuotaWaitTasks(opts = {}) {
  const res = readFleetTasks(opts);
  if (!res.ok) {
    return { ok: false, error: res.error, rows: [] };
  }
  const rows = [];
  for (const task of res.tasks) {
    const text = extractTaskText(task);
    if (!SWEEP_MATCH_RE.test(text)) continue;
    const engine = guessEngineFromTask(task);
    const quota = engine && engine !== 'unknown'
      ? checkEngineQuota(engine, opts)
      : { verdict: 'unknown', pct_5h: null, pct_7d: null, reset_at: null, observed_at: null };
    rows.push({
      id: task.id || task.task_id || '(no-id)',
      status: task.status || task.state || 'unknown',
      engine,
      verdict: quota.verdict,
      pct_5h: quota.pct_5h,
      pct_7d: quota.pct_7d,
      reset_at: quota.reset_at || '-',
      observed_at: quota.observed_at || '-',
    });
  }
  return { ok: true, rows };
}

function formatTable(rows) {
  if (!rows.length) return '（無含等額度字樣的任務）';
  const header = ['ID', 'Status', 'Engine', 'Verdict', '5h%', '7d%', 'Reset At', 'Observed At'];
  const lines = [
    header.join(' | '),
    header.map(() => '---').join(' | '),
  ];
  for (const r of rows) {
    lines.push([
      r.id,
      r.status,
      r.engine,
      r.verdict,
      r.pct_5h !== null && r.pct_5h !== undefined ? `${r.pct_5h}%` : '-',
      r.pct_7d !== null && r.pct_7d !== undefined ? `${r.pct_7d}%` : '-',
      r.reset_at,
      r.observed_at,
    ].join(' | '));
  }
  return lines.join('\n');
}

if (require.main === module) {
  const asJson = process.argv.includes('--json');
  const result = sweepQuotaWaitTasks();
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(result.rows, null, 2));
  } else {
    console.log(formatTable(result.rows));
  }
}

module.exports = {
  sweepQuotaWaitTasks,
  formatTable,
};
