#!/usr/bin/env node
/**
 * fleet-send-work-order-guard — PreToolUse, matcher mcp__fleet__send (and
 * mcp__fleet__dispatch for PM plan-first guard).
 *
 * mcp__fleet__send (default-on):
 *   A send that tells the peer to do the work now, or to return a deliverable,
 *   is a work order. New work uses dispatch. News about an existing task uses
 *   reply on that task's message. A pure fact uses send with fyi=true.
 *   [no-task: ...] is not an exemption. Broadcasts (to starts with @) always
 *   pass. Off switch: AUTOPILOT_SEND_WORK_ORDER_GUARD=off (false/0/no).
 *
 * mcp__fleet__dispatch (opt-in stem `pm-dispatch-plan-guard`, gated by
 * _shared/pm-console.js):
 *   Every PM dispatch must declare Size (XS|S|M|L|XL); Size M/L/XL must carry
 *   `Plan: <path>@<sha>` or `Plan: plan-first`.
 *
 * Fail-open: any error -> one stderr line, exit 0, no stdout.
 */
'use strict';

const fs = require('fs');
const { isEnabled } = require('./_shared/opt-in');
const { isPmConsole } = require('./_shared/pm-console');
const { parse: parseWorkOrder, isMPlus } = require('../scripts/lib/work-order-plan');

// Deliberately small: only imperative work requests, so a plain fact question still passes.
// [no-task: ...] is not an exemption.
const WORK_ORDER_PHRASES = Object.freeze([
  '回一行', '回報', '附 run id', '回 sha', '交件', 'report back', 'reply with',
  '現在就跑', '去跑', '開跑', '請做', '請跑', '請修', '要你', 'run it now', 'please run', 'please implement',
]);

const DENY_REASON = '這則 send 是在派工（要對方現在做事或回交件）。新工作請用 dispatch；既有任務的訊息請用 reply；純資訊才用 send 並設 fyi=true。';
const DISPATCH_OPT_IN = 'pm-dispatch-plan-guard';
const DISPATCH_SIZE_DENY_REASON = '每張派工都要帶 Size（XS|S|M|L|XL），請補上';
const DISPATCH_PLAN_DENY_REASON = '工單 Size M 以上要帶「Plan: 路徑@sha」或「Plan: plan-first」';

function envBag() {
  return process.env;
}

function knobOff(env) {
  const v = env && env.AUTOPILOT_SEND_WORK_ORDER_GUARD;
  return typeof v === 'string' && ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

function isWorkOrder(content) {
  if (typeof content !== 'string' || !content) return false;
  const hay = content.toLowerCase();
  return WORK_ORDER_PHRASES.some((phrase) => hay.includes(phrase.toLowerCase()));
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

function decideDispatch(input) {
  if (!isEnabled(DISPATCH_OPT_IN)) return null;
  if (!isPmConsole(input)) return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const parsed = parseWorkOrder(toolInput.task);
  if (!parsed.size || parsed.size === 'conflict') {
    return preToolDeny(DISPATCH_SIZE_DENY_REASON);
  }
  if (isMPlus(parsed.size) && !parsed.plan) {
    return preToolDeny(DISPATCH_PLAN_DENY_REASON);
  }
  return null;
}

function decide(input, env = envBag()) {
  if (!input || typeof input !== 'object') return null;
  if (input.tool_name === 'mcp__fleet__dispatch') {
    return decideDispatch(input);
  }
  if (knobOff(env)) return null;
  if (input.tool_name !== 'mcp__fleet__send') return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (toolInput.fyi === true) return null;
  if (typeof toolInput.to === 'string' && toolInput.to.startsWith('@')) return null;
  if (!isWorkOrder(toolInput.content)) return null;
  return preToolDeny(DENY_REASON);
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = decide(input && typeof input === 'object' ? input : {});
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`fleet-send-work-order-guard: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = {
  decide,
  WORK_ORDER_PHRASES,
  DISPATCH_SIZE_DENY_REASON,
  DISPATCH_PLAN_DENY_REASON,
};
