#!/usr/bin/env node
/**
 * fleet-dispatch-class — PreToolUse, matcher mcp__fleet__dispatch only.
 *
 * Stamps optional `class` (plan-review | code-review | implement | chat | review | summary | inventory | test-gen | subagent | author) onto
 * mcp__fleet__dispatch calls from the brief's `Role:` header when `class` is
 * omitted:
 *   1. Explicit valid `class` -> allow untouched (exit 0, no stdout).
 *   2. Explicit invalid `class` -> deny with a zh-TW reason listing the valid values.
 *   3. Missing `class` -> parse `Role:` in the first 15 lines of `tool_input.task`
 *      (case-insensitive key, trimmed value) and map via ROLE_CLASS_MAP; on match,
 *      updatedInput (no permissionDecision) preserving all original `tool_input` fields plus `class`.
 *   4. Missing or unmapped `Role:` -> deny with a one-line zh-TW reason explaining
 *      how to fix it (add `Role:` or pass `class` explicitly).
 *
 * Malformed stdin JSON -> exit 0 silently (fail-open).
 */
'use strict';

const fs = require('fs');
const { gateHint } = require('./lib/gate-hint.js');
const { readBurnMoreSignal } = require('../scripts/lib/shed-route.js');

const ROLE_CLASS_MAP = Object.freeze({
  'plan-reviewer': 'plan-review',
  'plan-review': 'plan-review',
  reviewer: 'code-review',
  review: 'code-review',
  'code-reviewer': 'code-review',
  'code-review': 'code-review',
  qc: 'code-review',
  verifier: 'code-review',
  implementer: 'implement',
  hand: 'implement',
  foreman: 'implement',
  author: 'implement',
  fixer: 'implement',
  chat: 'chat',
  question: 'chat',
  consult: 'chat',
  research: 'chat',
  report: 'chat',
  inventory: 'inventory',
  summary: 'summary',
  chores: 'implement',
});

const VALID_CLASSES = Object.freeze(['plan-review', 'code-review', 'implement', 'chat', 'review', 'summary', 'inventory', 'test-gen', 'subagent', 'author']);
const HEAD_LINE_LIMIT = 15;
const ROLE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?role(?:\*\*)?\s*:\s*(.*)$/i;
const SIZE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?size(?:\*\*)?\s*:\s*(.*)$/i;
const ENGINE_LINE_RE = /^(\s*(?:[-*]\s+)?(?:\*\*)?engine(?:\*\*)?\s*:\s*)(.*)$/i;
const ENGINE_PIN_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?engine-pin(?:\*\*)?\s*:/i;
const HEADER_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?[a-z0-9_-]+(?:\*\*)?\s*:/i;
const SHED_LINE_RE = /^\s*shed\s*:/im;
const SHED_ROLES = new Set(['inventory', 'summary', 'chores']);
const SHED_SIZES = new Set(['XS', 'S']);
// RT: when the pool is tight (AUTOPILOT_POOL_TIGHT=1) the reassignment order is
// agy, codex first and grok is never a target.
const TIGHT_FIRST = ['agy', 'codex'];
const TIGHT_REMOVED = new Set(['grok']);

function orderTargets(targets, env) {
  if (!env || env.AUTOPILOT_POOL_TIGHT !== '1') return targets;
  const kept = targets.filter((t) => !TIGHT_REMOVED.has(t));
  return [
    ...TIGHT_FIRST.filter((t) => kept.includes(t)),
    ...kept.filter((t) => !TIGHT_FIRST.includes(t)),
  ];
}
const PLAN_WORD_RE = /(?:^|[^a-z])plan(?:[^a-z]|$)/i;
const EXPECT_REVISION_FLAG_RE = /--expect-revision(?:=|\s)/;
const DISPATCH_PLAN_REVIEW_RE = /\bdispatch-plan-review\.js\b/;
const PLAN_SHA_RE = /(?:^\s*(?:[-*]\s+)?(?:\*\*)?Plan(?:\*\*)?\s*:\s*(?:\*\*)?\S+@([0-9a-f]{7,40})(?:\*\*)?\s*$|\S+\.md@([0-9a-f]{7,40})\b)/m;

function extractReferencedSha(task) {
  if (typeof task !== 'string' || !task) return null;
  const m = task.match(PLAN_SHA_RE);
  return m ? (m[1] || m[2] || null) : null;
}

function applyExpectRevision(task) {
  if (typeof task !== 'string' || !task) return task;
  if (EXPECT_REVISION_FLAG_RE.test(task)) return task;
  if (!DISPATCH_PLAN_REVIEW_RE.test(task)) return task;
  const sha = extractReferencedSha(task);
  if (!sha) return task;
  return task.replace(DISPATCH_PLAN_REVIEW_RE, `$& --expect-revision ${sha}`);
}

function oneLine(value, maxLen = 60) {
  return String(value).replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen);
}

const ALLOWED_CLASSES_TEXT = VALID_CLASSES.join(' | ');

function preToolDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function preToolAllowUpdated(toolInput, mappedClass) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      // updatedInput only: no permissionDecision, so the normal permission flow still decides (a hook must not answer the user's prompt).
      updatedInput: {
        ...toolInput,
        class: mappedClass,
      },
    },
  };
}

function extractRoleHeader(task) {
  if (typeof task !== 'string' || !task) return null;
  const lines = task.replace(/\r\n/g, '\n').split('\n').slice(0, HEAD_LINE_LIMIT);
  for (const line of lines) {
    const match = line.match(ROLE_LINE_RE);
    if (match) {
      return match[1].replace(/^[`"'*]+|[`"'*]+$/g, '').trim();
    }
  }
  return null;
}

function resolveClassFromRole(roleText) {
  if (!roleText) return null;
  const normalizedLead = roleText
    .toLowerCase()
    .replace(/^plan\s+review(er)?\b/, 'plan-review$1')
    .replace(/^code\s+review(er)?\b/, 'code-review$1');
  const tokenMatch = normalizedLead.match(/^[a-z0-9]+(?:[-_][a-z0-9]+)*/);
  const roleKey = tokenMatch ? tokenMatch[0].replace(/_/g, '-') : '';
  if (!roleKey || !Object.prototype.hasOwnProperty.call(ROLE_CLASS_MAP, roleKey)) {
    return null;
  }
  const baseClass = ROLE_CLASS_MAP[roleKey];
  if (
    (roleKey === 'reviewer' || roleKey === 'review' || roleKey === 'plan-reviewer' || roleKey === 'plan-review')
    && PLAN_WORD_RE.test(roleText)
  ) {
    return Object.prototype.hasOwnProperty.call(ROLE_CLASS_MAP, 'plan-reviewer')
      ? ROLE_CLASS_MAP['plan-reviewer']
      : null;
  }
  return baseClass || null;
}

function insertShedLine(lines, shedLine) {
  let lastHeaderIdx = -1;
  const limit = Math.min(lines.length, HEAD_LINE_LIMIT);
  for (let i = 0; i < limit; i++) {
    if (HEADER_LINE_RE.test(lines[i])) {
      lastHeaderIdx = i;
    } else if (lastHeaderIdx !== -1) {
      break;
    }
  }
  const out = lines.slice();
  if (lastHeaderIdx === -1) {
    out.unshift(shedLine);
  } else {
    out.splice(lastHeaderIdx + 1, 0, shedLine);
  }
  return out.join('\n');
}

function applyShedRouting(toolInput) {
  const task = toolInput && toolInput.task;
  if (typeof task !== 'string' || !task) return task;
  if (process.env.AUTOPILOT_SHED_ROUTE === '0') return task;
  if (SHED_LINE_RE.test(task)) return task;

  const roleHeader = extractRoleHeader(task);
  if (!roleHeader) return task;
  const roleToken = roleHeader.toLowerCase().match(/^[a-z0-9_-]+/);
  if (!roleToken || !SHED_ROLES.has(roleToken[0])) return task;

  const lines = task.replace(/\r\n/g, '\n').split('\n');
  const headLines = lines.slice(0, HEAD_LINE_LIMIT);
  let sizeVal = '';
  let hasEnginePin = false;
  for (const line of headLines) {
    const sm = line.match(SIZE_LINE_RE);
    if (sm) sizeVal = sm[1].replace(/^[`"'*]+|[`"'*]+$/g, '').trim().toUpperCase();
    if (ENGINE_PIN_LINE_RE.test(line)) hasEnginePin = true;
  }
  if (!sizeVal && typeof toolInput.size === 'string') {
    sizeVal = toolInput.size.trim().toUpperCase();
  }
  if (!SHED_SIZES.has(sizeVal)) return task;

  if (hasEnginePin) {
    return insertShedLine(lines, 'Shed: skipped reason=pinned');
  }

  const sig = readBurnMoreSignal({ env: process.env, now: new Date() });
  if (!sig.ok) {
    if (sig.reason === 'off') return task;
    const reasonMap = { no_file: 'missing', unreadable: 'missing', bad_schema: 'schema', stale: 'stale' };
    return insertShedLine(lines, `Shed: skipped reason=${reasonMap[sig.reason] || 'missing'}`);
  }

  const rules = sig.data.shed.rules;
  const undispatchable = new Set(Array.isArray(rules.undispatchable) ? rules.undispatchable : []);
  const chosen = orderTargets(rules.targets_in_order, process.env).find(
    (t) => typeof t === 'string' && t && !undispatchable.has(t),
  );
  if (!chosen) {
    return insertShedLine(lines, 'Shed: skipped reason=no_target');
  }

  const rewritten = lines.slice();
  for (let i = 0; i < Math.min(rewritten.length, HEAD_LINE_LIMIT); i++) {
    if (ENGINE_LINE_RE.test(rewritten[i])) {
      rewritten[i] = rewritten[i].replace(ENGINE_LINE_RE, `$1${chosen}`);
      break;
    }
  }
  return insertShedLine(
    rewritten,
    `Shed: hit engine=${chosen} run_id=${sig.data.run_id} signal_at=${sig.data.generated_at}`,
  );
}

function decide(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.tool_name !== 'mcp__fleet__dispatch') return null;

  const toolInput = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
    ? input.tool_input
    : {};

  if (Object.prototype.hasOwnProperty.call(toolInput, 'class') && toolInput.class !== undefined && toolInput.class !== null) {
    if (typeof toolInput.class === 'string' && VALID_CLASSES.includes(toolInput.class)) {
      const nextTask = applyShedRouting(toolInput);
      const finalTask = applyExpectRevision(nextTask);
      if (finalTask !== toolInput.task) {
        return preToolAllowUpdated({ ...toolInput, task: finalTask }, toolInput.class);
      }
      return null;
    }
    const shown = typeof toolInput.class === 'string' ? toolInput.class : JSON.stringify(toolInput.class);
    return preToolDeny(
      `mcp__fleet__dispatch 的 class 值「${oneLine(shown)}」無效；允許的值僅限 ${ALLOWED_CLASSES_TEXT} 十種。`
      + gateHint('class 只限這十種值；或拿掉 class 改用有效的 Role: 標頭', 'hooks/README.md'),
    );
  }

  const roleHeader = extractRoleHeader(toolInput.task);
  if (!roleHeader) {
    return preToolDeny(
      `mcp__fleet__dispatch 缺少 Role: 標頭；請在 task 前 15 行加上「Role: <角色>」，或明確傳入 class（${ALLOWED_CLASSES_TEXT} 十擇一）。`
      + gateHint('在 task 前 15 行加「Role: <角色>」，或明確傳入 class 十擇一', 'hooks/README.md'),
    );
  }

  const mappedClass = resolveClassFromRole(roleHeader);
  if (!mappedClass) {
    return preToolDeny(
      `mcp__fleet__dispatch 的 Role:「${oneLine(roleHeader)}」不在支援的角色表內；請改用支援的 Role: 標頭（如 plan-reviewer、reviewer、implementer、chat），或明確傳入 class（${ALLOWED_CLASSES_TEXT} 十擇一）。`
      + gateHint('改用支援的 Role:（plan-reviewer / reviewer / implementer / chat…），或明確傳入 class', 'hooks/README.md'),
    );
  }

  const nextTask = applyShedRouting(toolInput);
  const finalTask = applyExpectRevision(nextTask);
  const nextInput = finalTask !== toolInput.task ? { ...toolInput, task: finalTask } : toolInput;
  return preToolAllowUpdated(nextInput, mappedClass);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
}

function main() {
  let input;
  try {
    const raw = readStdin();
    if (!raw || !raw.trim()) return;
    input = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    const out = decide(input);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`fleet-dispatch-class: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = {
  ROLE_CLASS_MAP,
  VALID_CLASSES,
  extractRoleHeader,
  resolveClassFromRole,
  applyShedRouting,
  decide,
};
