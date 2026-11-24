#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sessionHandoffPath } = require('../hooks/context-budget-lib.js');

const SKIP_PREFIXES = ['<system-reminder>', '<task-notification>', '<channel'];
const MAX_UTTERANCES = 5;
const MAX_UTTERANCE_CHARS = 300;

function parseArgs(argv) {
  const args = { transcript: null, sessionId: null, out: null, now: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--transcript' && i + 1 < argv.length) args.transcript = argv[++i];
    else if (k === '--session-id' && i + 1 < argv.length) args.sessionId = argv[++i];
    else if (k === '--out' && i + 1 < argv.length) args.out = argv[++i];
    else if (k === '--now' && i + 1 < argv.length) args.now = argv[++i];
    else if (k === '--help' || k === '-h') {
      console.log('Usage: node scripts/pm-auto-handoff.js --transcript <jsonl> --session-id <sid> [--out <path>] [--now <ISO>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${k}`);
    }
  }
  if (!args.transcript) throw new Error('Missing required --transcript');
  if (!args.sessionId && !args.out) throw new Error('Missing required --session-id (or --out)');
  return args;
}

function extractUserText(content) {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return null;
    if (SKIP_PREFIXES.some((p) => trimmed.startsWith(p))) return null;
    return content;
  }
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === 'tool_result')) return null;
    const texts = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text);
    if (texts.length === 0) return null;
    const joined = texts.join('\n');
    const trimmed = joined.trim();
    if (!trimmed) return null;
    if (SKIP_PREFIXES.some((p) => trimmed.startsWith(p))) return null;
    return joined;
  }
  return null;
}

function extractAssistantText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

function extractFallbackOpenItems(assistantText) {
  if (!assistantText) return null;
  const paragraphs = assistantText.split(/\n\s*\n/);
  const matched = [];
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (/^(下一步|待辦|pending\b)/i.test(trimmed)) {
      matched.push(trimmed);
    }
  }
  return matched.length > 0 ? matched.join('\n\n') : null;
}

function parseTranscript(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n');
  const utterances = [];
  const tasks = new Map();
  let nextTaskSeq = 1;
  let sawTaskTool = false;
  let lastAssistantText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const content = obj.message && obj.message.content;

    if (obj.type === 'user') {
      const text = extractUserText(content);
      if (text !== null) {
        utterances.push(text.slice(0, MAX_UTTERANCE_CHARS));
      }
    } else if (obj.type === 'assistant') {
      const text = extractAssistantText(content);
      if (text.trim()) lastAssistantText = text;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || block.type !== 'tool_use') continue;
          const input = block.input && typeof block.input === 'object' ? block.input : {};
          if (block.name === 'TaskCreate') {
            sawTaskTool = true;
            const id = String(input.taskId || input.id || nextTaskSeq++);
            tasks.set(id, {
              id,
              subject: input.subject || input.title || `(task ${id})`,
              status: input.status || 'pending',
            });
          } else if (block.name === 'TaskUpdate') {
            sawTaskTool = true;
            const id = String(input.taskId || input.id || '');
            if (!id) continue;
            const existing = tasks.get(id) || { id, subject: input.subject || `(task ${id})`, status: 'pending' };
            if (input.subject) existing.subject = input.subject;
            if (input.status) existing.status = input.status;
            tasks.set(id, existing);
          }
        }
      }
    }
  }

  let openItemsText;
  if (sawTaskTool) {
    const open = [...tasks.values()].filter((t) => t.status !== 'completed');
    openItemsText = open.length > 0
      ? open.map((t) => `- [${t.status}] #${t.id}: ${t.subject}`).join('\n')
      : 'missing_open_items';
  } else {
    openItemsText = extractFallbackOpenItems(lastAssistantText) || 'missing_open_items';
  }

  return {
    recentUtterances: utterances.slice(-MAX_UTTERANCES),
    openItemsText,
  };
}

function getGitBranch() {
  try {
    const out = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || 'unknown';
  } catch {
    return 'unknown';
  }
}

function renderHandoff({ now, branch, recentUtterances, openItemsText }) {
  const utterancesBlock = recentUtterances.map((u, idx) => `${idx + 1}. ${u}`).join('\n');
  return [
    '## 目標',
    '自動交接 PM 席 context 達標前的工作狀態，供 `/clear` 後無縫接續。',
    '',
    '## 現況',
    `- 時間：${now}`,
    `- Git 分支：${branch}`,
    '',
    '## 操作員最近的話',
    utterancesBlock,
    '',
    '## 未完成事項',
    openItemsText,
    '',
    '## 已決事項(不重議)',
    '- 由 `scripts/pm-auto-handoff.js` 機械產出，保留交接當下狀態。',
    '',
    '## 下一步',
    '1. 依 `## 未完成事項` 與 `## 操作員最近的話` 接續執行。',
    '',
    '## 驗證方式',
    '- 確認 `## 操作員最近的話` 與 `## 未完成事項` 皆非空且反映最新進度。',
    '',
    '## Read-order',
    '1. 本 handoff 檔 — 確認操作員最近的話與未完成事項',
    '',
    '## 陷阱',
    '- 本檔為機械產出快照，接續完成後應依 `handoff` Resume Mode 清理。',
    '',
  ].join('\n');
}

function writeAtomic(outPath, content) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(outPath)}.tmp.${process.pid}.${Date.now()}`);
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  if (!fs.existsSync(args.transcript)) {
    process.stderr.write('missing_operator_utterance\n');
    process.exit(3);
  }

  try {
    const { recentUtterances, openItemsText } = parseTranscript(args.transcript);
    if (recentUtterances.length === 0) {
      process.stderr.write('missing_operator_utterance\n');
      process.exit(3);
    }

    const outPath = args.out || sessionHandoffPath(args.sessionId);
    const now = args.now || new Date().toISOString();
    const branch = getGitBranch();
    const markdown = renderHandoff({ now, branch, recentUtterances, openItemsText });
    writeAtomic(outPath, markdown);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseTranscript, extractUserText, extractFallbackOpenItems, renderHandoff, writeAtomic };
