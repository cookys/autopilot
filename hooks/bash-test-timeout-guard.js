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
const { gateHint } = require('./lib/gate-hint.js');
const { enforceFromReached } = require('./lib/enforce-from.js');
const ENFORCE_FROM = '2026-11-25T00:00:00+08:00';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
}

/** Split shell operators outside quotes, preserving quoted arguments. */
function splitShellSegments(cmd) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === '\\' && quote !== "'" && i + 1 < cmd.length) {
      cur += ch + cmd[++i];
      continue;
    }
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if ('\n\r;|&`(){}'.includes(ch) || (ch === '$' && cmd[i + 1] === '(')) {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      if (ch === '$') i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments;
}

const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"$()]*"|[^\s$()]*)$/;
const TIMEOUT_DURATION_RE = /^\d+(?:\.\d+)?[smhd]?$/;

function getCommandTokens(seg) {
  const tokens = [];
  const words = seg.match(/(?:[^\s'"\\]+|\\.|'[^']*'|"(?:\\.|[^"\\])*")+/g) || [];
  for (const word of words) {
    tokens.push(word.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"|\\(.)/g,
      (_, single, double, escaped) => single ?? double ?? escaped));
  }
  return tokens;
}

function commandInfo(seg) {
  const tokens = getCommandTokens(seg);
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i].split('/').pop();
    if (ENV_ASSIGN_RE.test(tokens[i])) { i++; continue; }
    if (cmd === 'timeout' || cmd === 'gtimeout') {
      let j = i + 1;
      while (tokens[j] && tokens[j].startsWith('-')) {
        if (/^(?:-k|-s|--kill-after|--signal)$/.test(tokens[j])) j++;
        j++;
      }
      if (TIMEOUT_DURATION_RE.test(tokens[j] || '')) return { timeout: true, tokens: [] };
    }
    if (['nohup', 'env', 'time', 'exec', 'command', 'xargs', 'stdbuf'].includes(cmd)) {
      i++;
      while (tokens[i] && (tokens[i].startsWith('-') || (cmd === 'env' && ENV_ASSIGN_RE.test(tokens[i])))) i++;
      continue;
    }
    break;
  }
  return { timeout: false, tokens: tokens.slice(i) };
}

function isTestOrCheckSegment(seg) {
  const { tokens } = commandInfo(seg);
  if (!tokens.length) return false;
  const fullCmd = tokens[0];
  const cmd = fullCmd.split('/').pop();
  const arg1 = tokens[1] || '';
  const arg2 = tokens[2] || '';
  if (['bash', 'sh', 'zsh'].includes(cmd) && arg1 === '-c') return Boolean(checkCommand(arg2));
  if (cmd === 'node') {
    return tokens.slice(1).some((a) => a.startsWith('--test') || /\.test\.[cm]?js$/.test(a) || /(?:^|\/)scripts\/(?:affected-suites|check-[^/]+)\.js$/.test(a));
  }
  if (['bash', 'sh', 'zsh'].includes(cmd)) {
    return tokens.slice(1).some((a) => /\.test\.sh$/.test(a) || /(?:^|\/)hooks\/tests\/[^/]+\.sh$/.test(a) || /(?:^|\/)scripts\/check-[^/]+\.sh$/.test(a));
  }
  if (/(?:^|\/)hooks\/tests\/[^/]+\.sh$/.test(fullCmd) || /(?:^|\/)scripts\/(?:affected-suites\.js|check-[^/]+\.(?:js|sh))$/.test(fullCmd)) return true;
  if (['pytest', 'jest', 'vitest', 'mocha'].includes(cmd)) return true;
  if (/^python(?:3(?:\.\d+)?)?$/.test(cmd) && arg1 === '-m' && arg2 === 'pytest') return true;
  if (cmd === 'uv' && arg1 === 'run' && arg2 === 'pytest') return true;
  if (cmd === 'npm' && (/^test/.test(arg1) || arg1 === 't' || (arg1 === 'run' && /^test/.test(arg2)))) return true;
  if (cmd === 'pnpm' || cmd === 'yarn') {
    const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
    return /^test/.test(args[0] || '') || args[0] === 'jest' || (args[0] === 'run' && /^test/.test(args[1] || ''));
  }
  if (cmd === 'npx') return ['jest', 'vitest', 'mocha'].includes(tokens.slice(1).find((t) => !t.startsWith('-')));
  return (cmd === 'cargo' || cmd === 'go') && arg1 === 'test';
}

function hasTimeoutPrefix(seg) {
  return commandInfo(seg).timeout;
}

function checkCommand(command) {
  for (const seg of splitShellSegments(command)) {
    if (!hasTimeoutPrefix(seg) && isTestOrCheckSegment(seg)) return seg;
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
      `BLOCKED: 測試或檢查指令必須加上 timeout 前綴（請加上 timeout 120，或為已知長測試套件指定更大的明確秒數），例如：timeout 120 ${offending}`
      + gateHint('在測試或檢查指令前加上適當秒數的 timeout', 'hooks/README.md') + '\n'
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
