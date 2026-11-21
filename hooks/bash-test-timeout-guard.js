#!/usr/bin/env node
/**
 * bash-test-timeout-guard — PreToolUse/Bash (default-on)
 *
 * Prevents test or check commands from running unbounded in Bash tool calls
 * (e.g. if backgrounded and the parent subagent exits).
 *
 * Opt-out: AUTOPILOT_BASH_TEST_TIMEOUT=0
 */

'use strict';

const fs = require('fs');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
}

/**
 * Split a shell command into segments on &&, ||, ;, |, and newlines,
 * respecting single quotes, double quotes, and backslash escapes.
 */
function splitShellSegments(cmd) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote === "'") {
      cur += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < cmd.length) {
      cur += ch + cmd[i + 1];
      i++;
      continue;
    }
    if (quote === '"') {
      cur += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '\n' || ch === '\r' || ch === ';') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      continue;
    }
    if (ch === '&' && cmd[i + 1] === '&') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    if (ch === '|' && cmd[i + 1] === '|') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    if (ch === '|') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments;
}

const TIMEOUT_PREFIX_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*timeout\s+(?:-\S+\s+)*\d+[sm]?\b/;

const TEST_OR_CHECK_PATTERNS = [
  /\bnode\s+(?:--\S+\s+)*\S+\.test\.js\b/,
  /\bnode\s+--test\b/,
  /\b(?:bash|sh)\s+(?:\S+\.test\.sh|\S*hooks\/tests\/\S+\.sh)\b/,
  /\bhooks\/tests\/\S+\.sh\b/,
  /\bscripts\/affected-suites\.js\b/,
  /\bscripts\/check-\S+\.(?:js|sh)\b/,
  /\bpytest\b/,
  /\bpython3?\s+-m\s+pytest\b/,
  /\bnpm\s+(?:test|t)\b/,
  /\bnpx\s+vitest\b/,
  /\bjest\b/,
];

function isTestOrCheckSegment(seg) {
  return TEST_OR_CHECK_PATTERNS.some((re) => re.test(seg));
}

function hasTimeoutPrefix(seg) {
  return TIMEOUT_PREFIX_RE.test(seg);
}

function checkCommand(command) {
  const segments = splitShellSegments(command);
  for (const seg of segments) {
    if (isTestOrCheckSegment(seg) && !hasTimeoutPrefix(seg)) {
      return seg;
    }
  }
  return null;
}

function main() {
  if (process.env.AUTOPILOT_BASH_TEST_TIMEOUT === '0') {
    process.exit(0);
  }

  let input;
  try {
    const raw = readStdin();
    if (!raw.trim()) process.exit(0);
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (input.tool_name && input.tool_name !== 'Bash') {
    process.exit(0);
  }

  const command = String((input.tool_input && input.tool_input.command) || '');
  if (!command.trim()) process.exit(0);

  const offending = checkCommand(command);
  if (offending) {
    process.stderr.write(
      `BLOCKED: 測試或檢查指令必須加上 timeout 前綴（請加上 timeout 120，或為已知長測試套件指定更大的明確秒數），例如：timeout 120 ${offending}\n`
    );
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  splitShellSegments,
  isTestOrCheckSegment,
  hasTimeoutPrefix,
  checkCommand,
};
