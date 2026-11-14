#!/usr/bin/env node
/**
 * lesson-lint — lint Claude Code memory files of `type: feedback`.
 *
 * Operator rule: a lesson becomes a script, hook or lint within 14 days, or is deleted.
 * Frontmatter (between `---` lines; fields top-level or under `metadata:`) needs
 *   created:   YYYY-MM-DD (optional time)
 *   mechanism: a path-like token (contains `/` and an extension, e.g. scripts/foo.js)
 *              or a fleet task id (26-char ULID)
 * Only the frontmatter is read; bodies are never printed. MEMORY.md and non-feedback types are skipped.
 *
 * Usage:
 *   node scripts/lesson-lint.js check --dir <memory dir> [--now <ISO>] [--json]
 *     findings: missing_created, missing_mechanism, overdue (created > 14 days ago AND no mechanism).
 *     --json prints {schema:"lesson-lint/1", files, findings:[{file,name,code,created}]}.
 *     Exit 0 clean, 1 findings, 2 usage.
 *   node scripts/lesson-lint.js stop-hook --dir <memory dir>
 *     Stop hook (hook JSON on stdin). Blocks ({"decision":"block","reason":...}) when (a) a feedback file
 *     in --dir was modified after the last real user message of the transcript and lacks a valid
 *     mechanism, or (b) any overdue finding exists. stop_hook_active is NOT a bypass (same as
 *     hooks/owner-question-guard.js). Fail-open: unreadable dir/transcript -> one stderr line, exit 0.
 *
 * Install (PM, own settings; NOT registered in hooks/hooks.json), under Stop:
 *   {"type":"command","command":"node <repo>/scripts/lesson-lint.js stop-hook --dir <memory dir>"}
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OVERDUE_DAYS = 14;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  const fields = {};
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return fields;
    const m = lines[i].match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const v = m[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in fields) || v) fields[m[1]] = v;
  }
  return null; // unterminated frontmatter
}

function validMechanism(v) {
  if (!v) return false;
  return ULID.test(v) || (v.includes('/') && /\.[A-Za-z0-9]+$/.test(v));
}

function lintDir(dir, nowMs) {
  const files = [];
  const findings = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    const full = path.join(dir, f);
    let fm;
    try { fm = parseFrontmatter(fs.readFileSync(full, 'utf8')); } catch { continue; }
    if (!fm || fm.type !== 'feedback') continue;
    files.push(f);
    const name = fm.name || f.replace(/\.md$/, '');
    const created = fm.created || '';
    const createdOk = ISO_DATE.test(created) && Number.isFinite(Date.parse(created));
    const add = (code) => findings.push({ file: f, name, code, created: createdOk ? created : null });
    if (!createdOk) add('missing_created');
    const mech = validMechanism(fm.mechanism);
    if (!mech) add('missing_mechanism');
    if (!mech && createdOk && nowMs - Date.parse(created) > OVERDUE_DAYS * 86400000) add('overdue');
  }
  return { files, findings };
}

function parseArgs(argv) {
  const o = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') o.json = true;
    else if (argv[i] === '--dir' || argv[i] === '--now') { o[argv[i].slice(2)] = argv[i + 1]; i += 1; } else return null;
  }
  return o;
}

function cmdCheck(o) {
  const nowMs = o.now ? Date.parse(o.now) : Date.now();
  if (!o.dir || !Number.isFinite(nowMs)) return usage();
  let r;
  try { r = lintDir(o.dir, nowMs); } catch (e) { process.stderr.write(`lesson-lint: ${e.message}\n`); return 2; }
  if (o.json) {
    process.stdout.write(`${JSON.stringify({ schema: 'lesson-lint/1', files: r.files, findings: r.findings })}\n`);
  } else {
    process.stdout.write(`lesson-lint: ${r.files.length} feedback file(s), ${r.findings.length} finding(s)\n`);
    for (const f of r.findings) process.stdout.write(`  ${f.code}  ${f.file}${f.created ? `  (created ${f.created})` : ''}\n`);
  }
  return r.findings.length ? 1 : 0;
}

// Timestamp (ms) of the last real user message (not a pure tool_result entry), or null.
function lastUserTs(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    if (role !== 'user') continue;
    const content = e.message && e.message.content;
    if (Array.isArray(content) && content.length && content.every((b) => b && b.type === 'tool_result')) continue;
    const t = Date.parse(e.timestamp);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function cmdStopHook(o) {
  try {
    if (!o.dir) throw new Error('--dir required');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const r = lintDir(o.dir, Date.now());
    const problems = [];
    const turnStart = typeof input.transcript_path === 'string' && input.transcript_path
      ? lastUserTs(fs.readFileSync(input.transcript_path, 'utf8')) : null;
    const missing = new Set(r.findings.filter((f) => f.code === 'missing_mechanism').map((f) => f.file));
    if (turnStart !== null) {
      for (const f of missing) {
        if (fs.statSync(path.join(o.dir, f)).mtimeMs > turnStart) problems.push(`${f}: 這輪新增或修改的 feedback 教訓沒有 mechanism`);
      }
    }
    for (const f of r.findings) if (f.code === 'overdue') problems.push(`${f.file}: 建立於 ${f.created}，超過 ${OVERDUE_DAYS} 天仍沒有 mechanism`);
    if (problems.length) {
      const reason = `教訓必須在 ${OVERDUE_DAYS} 天內變成腳本、hook 或 lint，否則刪除：\n${problems.join('\n')}\n`
        + '請在該檔 frontmatter 加 `mechanism:`（腳本／hook／lint 路徑或 fleet task id），或刪掉這則教訓。';
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
    }
  } catch (err) {
    process.stderr.write(`lesson-lint: fail-open: ${err && err.message}\n`);
  }
  return 0;
}

function usage() {
  process.stderr.write('usage: lesson-lint.js check --dir <dir> [--now <ISO>] [--json] | stop-hook --dir <dir>\n');
  return 2;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const o = parseArgs(rest);
  if (!o) return usage();
  if (cmd === 'check') return cmdCheck(o);
  if (cmd === 'stop-hook') return cmdStopHook(o);
  return usage();
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { parseFrontmatter, validMechanism, lintDir, lastUserTs };
