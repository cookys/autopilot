#!/usr/bin/env node
/**
 * pm-intake-c — PreToolUse, PM seat only (default-on).
 *
 * Triggers when the tool is mcp__fleet__dispatch, mcp__fleet__reply or
 * mcp__fleet__task_comment and the text contains `ruling` or one of go / 凍結 /
 * 核准, and when Bash runs `open-decision.js close`.
 *
 * Plan text = message text plus `git -C $PM_PLAN_REPO show <sha>:<path>` for every
 * path@sha (`[\w./-]+@[0-9a-f]{7,40}`) in the message. A quoted ref that cannot
 * be read blocks.
 *
 * Scope tags come from the scope vocabulary table in `$PM_CONSTRAINTS_FILE`
 * (keywords, case-insensitive substring). For each constraint of a matching
 * scope, a `forbid` regex hit blocks unless the go text carries
 * `override:<constraint sha>:<operator answer id>`.
 *
 * `$PM_ANSWER_LOOKUP_BIN <id>` must print JSON
 * `{"exists":bool,"from_operator":bool,"question":"..."}`. The override counts
 * only when exists and from_operator are true and question contains that
 * constraint sha. A PM-origin id never counts.
 *
 * Matching scope with no forbid hit: the go must contain `<constraint id>: 符合`
 * or `<constraint id>: 不適用：<reason>`. A pasted receipt id does not pass.
 *
 * Deny shape: permissionDecision "deny"; the reason names the constraint id, the
 * matched regex text, and the exact line to add. Fail-open on internal errors
 * (one stderr line, exit 0). A rule block is not fail-open.
 */
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { resolveFleetSeat } = require('./_shared/fleet-seat.js');

const REF_RE = /[\w./-]+@([0-9a-f]{7,40})/gi;
const TOOLS = new Set(['mcp__fleet__dispatch', 'mcp__fleet__reply', 'mcp__fleet__task_comment']);

function messageText(input) {
  const name = input && input.tool_name;
  const toolInput = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (name === 'Bash') return typeof toolInput.command === 'string' ? toolInput.command : '';
  const parts = [];
  for (const key of ['task', 'content', 'text', 'message', 'body']) {
    if (typeof toolInput[key] === 'string' && toolInput[key]) parts.push(toolInput[key]);
  }
  return parts.join('\n');
}

function triggered(input, text) {
  const name = input && input.tool_name;
  if (name === 'Bash') return /open-decision\.js\b[\s\S]*\bclose\b/.test(text);
  if (!TOOLS.has(name)) return false;
  return /ruling/i.test(text) || /\bgo\b/i.test(text) || /凍結|核准/.test(text);
}

function parseConstraints(raw) {
  const vocab = [];
  const lines = raw.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (/^\|\s*scope\s*\|/i.test(line)) { inTable = true; continue; }
    if (inTable) {
      if (!line.startsWith('|')) { inTable = false; continue; }
      if (/^\|\s*-+/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length >= 2 && cells[0] && cells[0] !== 'scope') {
        vocab.push({
          scope: cells[0],
          keywords: cells[1].split(',').map((k) => k.trim()).filter(Boolean),
        });
      }
    }
  }
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const head = line.match(/^###\s+(\S+)\s+(\S+)/);
    if (head) {
      if (cur) entries.push(cur);
      cur = { id: head[1], scope: head[2], ledger: '', forbid: '' };
      continue;
    }
    if (!cur) continue;
    const ledger = line.match(/^- ledger:\s*(\S+)/);
    if (ledger) cur.ledger = ledger[1];
    const scope = line.match(/^- scope:\s*(\S+)/);
    if (scope) cur.scope = scope[1];
    const forbid = line.match(/^- forbid:\s*`([^`]*)`/);
    if (forbid) cur.forbid = forbid[1];
  }
  if (cur) entries.push(cur);
  return { vocab, entries };
}

function scopesIn(text, vocab) {
  const hay = text.toLowerCase();
  return vocab.filter((row) => row.keywords.some((kw) => hay.includes(kw.toLowerCase()))).map((row) => row.scope);
}

function readRefs(message, repo) {
  const refs = [];
  const re = new RegExp(REF_RE.source, 'gi');
  let m;
  while ((m = re.exec(message))) {
    const token = m[0];
    const at = token.lastIndexOf('@');
    refs.push({ token, filePath: token.slice(0, at), sha: token.slice(at + 1) });
  }
  if (refs.length === 0) return { text: '', error: null };
  if (!repo) return { text: '', error: refs[0].token };
  let extra = '';
  for (const ref of refs) {
    const child = spawnSync('git', ['-C', repo, 'show', `${ref.sha}:${ref.filePath}`], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    if (child.status !== 0 || child.error) return { text: extra, error: ref.token };
    extra += `\n${child.stdout || ''}`;
  }
  return { text: extra, error: null };
}

function lookup(bin, id) {
  const child = spawnSync(bin, [id], { encoding: 'utf8', timeout: 2000, maxBuffer: 256 * 1024 });
  if (child.error || child.status !== 0) throw new Error(`answer lookup failed for ${id}`);
  const parsed = JSON.parse(child.stdout);
  return {
    exists: parsed.exists === true,
    from_operator: parsed.from_operator === true,
    question: typeof parsed.question === 'string' ? parsed.question : '',
  };
}

function overrideOk(message, ledger, bin, cache) {
  const re = new RegExp(`override:${ledger}:(\\S+)`, 'g');
  let m;
  while ((m = re.exec(message))) {
    const id = m[1];
    if (!cache.has(id)) cache.set(id, lookup(bin, id));
    const row = cache.get(id);
    if (row.exists && row.from_operator && row.question.includes(ledger)) return true;
  }
  return false;
}

function compliant(message, id) {
  const re = new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(?:符合|不適用：\\S+)`);
  return re.test(message);
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function evaluate(input) {
  if (resolveFleetSeat(input) !== 'pm') return null;
  const message = messageText(input);
  if (!triggered(input, message)) return null;
  const file = process.env.PM_CONSTRAINTS_FILE;
  if (!file) throw new Error('PM_CONSTRAINTS_FILE unset');
  const parsed = parseConstraints(fs.readFileSync(file, 'utf8'));
  const fetched = readRefs(message, process.env.PM_PLAN_REPO || '');
  if (fetched.error) {
    return deny(`引用的 path@sha 讀不到：${fetched.error}。請改成這個 repo 裡讀得到的 path@sha。`);
  }
  const plan = `${message}\n${fetched.text}`;
  const scopes = new Set(scopesIn(plan, parsed.vocab));
  const bin = process.env.PM_ANSWER_LOOKUP_BIN || '';
  const cache = new Map();
  for (const entry of parsed.entries) {
    if (!scopes.has(entry.scope)) continue;
    let matched = null;
    if (entry.forbid) {
      const re = new RegExp(entry.forbid, 'i');
      matched = plan.match(re);
    }
    if (matched) {
      if (!bin) throw new Error('PM_ANSWER_LOOKUP_BIN unset');
      if (overrideOk(message, entry.ledger, bin, cache)) continue;
      return deny(`約束 ${entry.id} 的禁止模式 \`${entry.forbid}\` 命中「${matched[0]}」。要放行請在 go 加上這一行：override:${entry.ledger}:<operator answer id>`);
    }
    if (!compliant(message, entry.id)) {
      return deny(`約束 ${entry.id} 範圍相符但未命中禁止模式，go 少了這一行：${entry.id}: 符合`);
    }
  }
  return null;
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = evaluate(input && typeof input === 'object' ? input : {});
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`pm-intake-c: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = { evaluate, parseConstraints };
