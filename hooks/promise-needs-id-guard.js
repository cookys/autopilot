#!/usr/bin/env node
/**
 * promise-needs-id-guard — PreToolUse, matcher
 * Write|Edit|mcp__fleet__send|mcp__fleet__task_comment|mcp__fleet__task_result.
 *
 * Prevents unverified promises in handoff docs and fleet messages by requiring
 * an object id (`d-<8 hex>` card id or 26-char `[0-9A-Z]{26}` fleet id) in the
 * same clause (split by 。；; and newline) whenever a promise/wait phrase appears.
 *
 * Default-on. Off switch: AUTOPILOT_PROMISE_ID_GUARD=0 (or off/false/no).
 * Fail-open: any error -> one stderr line, exit 0, no stdout.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DENY_REASON = '承諾要帶物件 id：請補 d- 卡號或請求訊息 id';

const TRIGGER_RE = /已報 PM 開.{0,4}卡|已開卡|卡在排|等操作員|waiting_on_operator|等 operator/;
const CARD_ID_RE = /d-[0-9a-f]{8}/;
const FLEET_ID_RE = /[0-9A-Z]{26}/;
const CLAUSE_SPLIT_RE = /[。；;\n]+/;
const HANDOFF_RUN_PATH_RE = /^\/run\/user\/\d+\/autopilot\/handoff\/[^/]+\.md$/;

const FLEET_TOOLS = new Set([
  'mcp__fleet__send',
  'mcp__fleet__task_comment',
  'mcp__fleet__task_result',
]);

function envBag() {
  return process.env;
}

function knobOff(env) {
  const v = env && env.AUTOPILOT_PROMISE_ID_GUARD;
  return typeof v === 'string' && ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

function preToolDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function isHandoffMarkdown(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (HANDOFF_RUN_PATH_RE.test(filePath)) return true;
  const base = path.basename(filePath);
  return base.toLowerCase().includes('handoff') && base.toLowerCase().endsWith('.md');
}

function extractText(input) {
  const name = input && input.tool_name;
  const toolInput = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (name === 'Write') {
    if (!isHandoffMarkdown(toolInput.file_path)) return null;
    return typeof toolInput.content === 'string' ? toolInput.content : null;
  }
  if (name === 'Edit') {
    if (!isHandoffMarkdown(toolInput.file_path)) return null;
    return typeof toolInput.new_string === 'string' ? toolInput.new_string : null;
  }
  if (FLEET_TOOLS.has(name)) {
    // send/task_result carry `content`; task_comment carries `text`
    const body = name === 'mcp__fleet__task_comment' ? toolInput.text : toolInput.content;
    return typeof body === 'string' ? body : null;
  }
  return null;
}

function hasObjectId(clause) {
  return CARD_ID_RE.test(clause) || FLEET_ID_RE.test(clause);
}

function decide(input, env = envBag()) {
  if (!input || typeof input !== 'object') return null;
  if (knobOff(env)) return null;
  const text = extractText(input);
  if (typeof text !== 'string' || !text) return null;

  const clauses = text.split(CLAUSE_SPLIT_RE);
  for (const clause of clauses) {
    if (!clause) continue;
    if (TRIGGER_RE.test(clause) && !hasObjectId(clause)) {
      return preToolDeny(DENY_REASON);
    }
  }
  return null;
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = decide(input && typeof input === 'object' ? input : {});
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`promise-needs-id-guard: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = {
  decide,
  DENY_REASON,
  isHandoffMarkdown,
};
