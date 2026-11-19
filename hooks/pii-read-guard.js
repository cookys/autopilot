#!/usr/bin/env node
'use strict';

// PreToolUse Read|Grep: keep personal data (TW national ID, mobile, email, card number) out of model context.
//
// Coverage of the PII mask (categories: hooks/_shared/secret-patterns.js piiPatterns):
//   Bash        PostToolUse secret-output-redact.js rewrites stdout/stderr (updatedToolOutput object, probed
//               2026-11-17: docs/plans/evidence/2026-11-17-pm-token-split/p3-probe.md).
//   Read, Grep  This hook. No repo evidence that a hook can rewrite their output (only Bash and MCP were probed;
//               Read's tool_response is a structured file object), so they are blocked BEFORE they run when the
//               target holds PII: Read of a file, Grep in content mode over a file or directory. The deny reason
//               (zh-TW) points to `node scripts/safe-inspect.js file <path>`, which masks PII too.
//   Glob        Not covered, nothing to cover: it returns paths only, never file content.
//   Grep count / files_with_matches modes return no content and pass.
// Block threshold: any tw_national_id / tw_mobile / card_number hit (checksum or Luhn validated), or 3+ emails
// (one author email in a package file is normal; a bulk extract is not). Config: same `secret_print` knob as
// secret-output-redact (`off` skips; AUTOPILOT_BASH_GUARD_SECRET_MODE overrides).
const fs = require('node:fs');
const path = require('node:path');
const { scanPii, piiSummary } = require('./_shared/secret-patterns.js');
const { secretMode } = require('./secret-output-redact.js');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function blocking(counts) {
  const { email = 0, ...strong } = counts;
  return Object.keys(strong).length > 0 || email >= 3;
}

function scanFile(file, counts) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const [name, n] of Object.entries(scanPii(text))) counts[name] = (counts[name] || 0) + n;
}

function scanTarget(target) {
  const counts = {};
  let stat;
  try { stat = fs.statSync(target); } catch { return counts; }
  if (stat.isFile()) { scanFile(target, counts); return counts; }
  const queue = [target];
  let seen = 0;
  while (queue.length && seen < MAX_FILES) {
    const dir = queue.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) queue.push(path.join(dir, entry.name)); continue; }
      if (!entry.isFile() || seen++ >= MAX_FILES) continue;
      scanFile(path.join(dir, entry.name), counts);
    }
  }
  return counts;
}

function handle(payload) {
  if (payload?.hook_event_name !== 'PreToolUse' || secretMode() === 'off') return null;
  const input = payload.tool_input || {};
  let target;
  if (payload.tool_name === 'Read') target = input.file_path;
  else if (payload.tool_name === 'Grep' && input.output_mode === 'content') target = input.path || payload.cwd || process.cwd();
  if (typeof target !== 'string' || !target) return null;
  const counts = scanTarget(path.resolve(payload.cwd || process.cwd(), target));
  if (!blocking(counts)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `這個目標含個人資料 ${piiSummary(counts)}，直接讀會讓真實個資進入對話。`
        + '請改用 node scripts/safe-inspect.js file <路徑>（自動遮罩個資）；目錄請先用 grep -l 或 -c 找到檔案，再逐檔用 safe-inspect。',
    },
  };
}

if (require.main === module) {
  try {
    const output = handle(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (output) process.stdout.write(JSON.stringify(output));
  } catch { /* Invalid hook input: allow, never echo the payload. */ }
}

module.exports = { handle, scanTarget, blocking };
