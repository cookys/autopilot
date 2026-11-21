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
 *      allow with `updatedInput` preserving all original `tool_input` fields plus `class`.
 *   4. Missing or unmapped `Role:` -> deny with a one-line zh-TW reason explaining
 *      how to fix it (add `Role:` or pass `class` explicitly).
 *
 * Malformed stdin JSON -> exit 0 silently (fail-open).
 */
'use strict';

const fs = require('fs');

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
});

const VALID_CLASSES = Object.freeze(['plan-review', 'code-review', 'implement', 'chat', 'review', 'summary', 'inventory', 'test-gen', 'subagent', 'author']);
const HEAD_LINE_LIMIT = 15;
const ROLE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?role(?:\*\*)?\s*:\s*(.*)$/i;
const PLAN_WORD_RE = /(?:^|[^a-z])plan(?:[^a-z]|$)/i;

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
      permissionDecision: 'allow',
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

function decide(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.tool_name !== 'mcp__fleet__dispatch') return null;

  const toolInput = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
    ? input.tool_input
    : {};

  if (Object.prototype.hasOwnProperty.call(toolInput, 'class') && toolInput.class !== undefined && toolInput.class !== null) {
    if (typeof toolInput.class === 'string' && VALID_CLASSES.includes(toolInput.class)) {
      return null;
    }
    const shown = typeof toolInput.class === 'string' ? toolInput.class : JSON.stringify(toolInput.class);
    return preToolDeny(
      `mcp__fleet__dispatch 的 class 值「${oneLine(shown)}」無效；允許的值僅限 ${ALLOWED_CLASSES_TEXT} 十種。`,
    );
  }

  const roleHeader = extractRoleHeader(toolInput.task);
  if (!roleHeader) {
    return preToolDeny(
      `mcp__fleet__dispatch 缺少 Role: 標頭；請在 task 前 15 行加上「Role: <角色>」，或明確傳入 class（${ALLOWED_CLASSES_TEXT} 十擇一）。`,
    );
  }

  const mappedClass = resolveClassFromRole(roleHeader);
  if (!mappedClass) {
    return preToolDeny(
      `mcp__fleet__dispatch 的 Role:「${oneLine(roleHeader)}」不在支援的角色表內；請改用支援的 Role: 標頭（如 plan-reviewer、reviewer、implementer、chat），或明確傳入 class（${ALLOWED_CLASSES_TEXT} 十擇一）。`,
    );
  }

  return preToolAllowUpdated(toolInput, mappedClass);
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
  decide,
};
