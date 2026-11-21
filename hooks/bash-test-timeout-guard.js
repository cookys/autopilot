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
const { enforceFromReached } = require('./lib/enforce-from.js');
const ENFORCE_FROM = '2026-11-25T00:00:00+08:00';

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

const ENV_ASSIGN_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*/;
const TIMEOUT_PREFIX_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*(?:timeout|gtimeout)\s+(?:(?:--(?:signal|kill-after)(?:=\S+|\s+\S+)|-[ks]\s+\S+|-\S+)\s+)*\d+(?:\.\d+)?[smhd]?\b/;

function stripQuotes(str) {
  return str.replace(/'[^']*'|"[^"]*"/g, '""');
}

function getCommandTokens(seg) {
  let rest = seg.replace(ENV_ASSIGN_RE, '');
  if (TIMEOUT_PREFIX_RE.test(seg)) {
    rest = seg.replace(TIMEOUT_PREFIX_RE, '').trim();
  }
  const unquoted = stripQuotes(rest).trim();
  if (!unquoted) return [];
  return unquoted.split(/\s+/);
}

function isTestOrCheckSegment(seg) {
  const tokens = getCommandTokens(seg);
  if (tokens.length === 0) return false;
  const cmd = tokens[0];
  const arg1 = tokens[1] || '';
  const arg2 = tokens[2] || '';

  if (cmd === 'node') {
    const nonFlagArgs = tokens.slice(1).filter((t) => !t.startsWith('-'));
    if (tokens.includes('--test')) return true;
    return nonFlagArgs.some(
      (a) =>
        /\.test\.[cm]?js$/.test(a) ||
        /(?:^|\/)scripts\/affected-suites\.js$/.test(a) ||
        /(?:^|\/)scripts\/check-\S+\.js$/.test(a)
    );
  }

  if (cmd === 'bash' || cmd === 'sh') {
    const nonFlagArgs = tokens.slice(1).filter((t) => !t.startsWith('-'));
    return nonFlagArgs.some(
      (a) =>
        /\.test\.sh$/.test(a) ||
        /(?:^|\/)hooks\/tests\/\S+\.sh$/.test(a) ||
        /(?:^|\/)scripts\/check-\S+\.sh$/.test(a)
    );
  }

  if (/(?:^|\/)hooks\/tests\/\S+\.sh$/.test(cmd)) return true;
  if (cmd === 'pytest' || cmd === 'jest' || cmd === 'vitest') return true;
  if ((cmd === 'python' || cmd === 'python3') && arg1 === '-m' && arg2 === 'pytest') return true;
  if (cmd === 'npm' && (arg1 === 'test' || arg1 === 't' || (arg1 === 'run' && /^test/.test(arg2)))) return true;
  if ((cmd === 'pnpm' || cmd === 'yarn') && (arg1 === 'test' || (arg1 === 'run' && /^test/.test(arg2)))) return true;
  if (cmd === 'npx' && (arg1 === 'jest' || arg1 === 'vitest')) return true;
  if ((cmd === 'cargo' || cmd === 'go') && arg1 === 'test') return true;

  return false;
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
    const now = process.env.AUTOPILOT_BASH_TEST_TIMEOUT_NOW;
    if (!enforceFromReached(ENFORCE_FROM, now ? Date.parse(now) : Date.now())) {
      const message = `warn (blocking from ${ENFORCE_FROM}): 測試或檢查指令必須加上 timeout 前綴，例如：timeout 120 ${offending}`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message } }));
      process.exit(0);
    }
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
