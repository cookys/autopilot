#!/usr/bin/env node
/**
 * pm-output-cap — PM-session output truncation for Bash and mcp__* tools (P3).
 *
 * Opt-in stem: `pm-output-cap` (hooks/_shared/opt-in.js) + PM gate (hooks/_shared/pm-console.js).
 * Both must pass; otherwise exits 0 with no output and no disk writes.
 *
 * Modes (selected from `input.hook_event_name`):
 *   - PostToolUse: for Bash (`updatedToolOutput`) and `mcp__*` (`updatedMCPToolOutput`),
 *     when text output exceeds `cap` lines (40, or 30 when `pm_output_cap.ledger_search_pattern`
 *     matches the command or tool name), writes the full text to
 *     `$XDG_RUNTIME_DIR/autopilot/pm-output/<id>.txt` (fallback `<state dir>/pm-output/<id>.txt`;
 *     dirs 0700, file 0600) and returns the first `cap` lines plus
 *     `… N 行已截斷，全文：<path>`. Read/Grep/Glob and non-text results pass through.
 *   - PreToolUse (Bash fallback): rewrites `tool_input.command` via `updatedInput` so the
 *     command runs inside a subshell `( <cmd>\n)` redirected to `<file>`, preserving heredocs,
 *     exit codes, and trailing `#` comments, printing all lines when <= `cap` (removing `<file>`)
 *     or `head -n <cap>` plus `… N 行已截斷，全文：<file>` when > `cap`.
 *
 * Fail-open: any error writes one stderr line and exits 0 without stdout.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isEnabled } = require('./_shared/opt-in.js');
const { isPmConsole } = require('./_shared/pm-console.js');
const { configPath } = require('../scripts/lib/config-path.js');

const DEFAULT_MAX_LINES = 40;
const LEDGER_SEARCH_MAX_LINES = 30;
const MAX_ID_LEN = 128;

function absPath(v) {
  return typeof v === 'string' && path.isAbsolute(v) ? v : '';
}

function envFromProcess() {
  return {
    AUTOPILOT_STATE_DIR: process.env.AUTOPILOT_STATE_DIR,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    HOME: process.env.HOME,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    AUTOPILOT_CONFIG_FILE: process.env.AUTOPILOT_CONFIG_FILE,
  };
}

function stateDir(env) {
  const e = env || envFromProcess();
  const over = absPath(e.AUTOPILOT_STATE_DIR);
  if (over) return over;
  const xdg = absPath(e.XDG_STATE_HOME);
  if (xdg) return path.join(xdg, 'autopilot');
  const home = absPath(e.HOME) || os.homedir();
  return path.join(home, '.local', 'state', 'autopilot');
}

function resolveOutputDir(env) {
  const e = env || envFromProcess();
  const xdgRuntime = absPath(e.XDG_RUNTIME_DIR);
  if (xdgRuntime) {
    return path.join(xdgRuntime, 'autopilot', 'pm-output');
  }
  return path.join(stateDir(e), 'pm-output');
}

function assertNotSymlinkDir(dir) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`refusing symlinked output path: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`output path is not a directory: ${dir}`);
  }
  return true;
}

function ensurePrivateOutputDir(dir) {
  const parent = path.dirname(dir);
  if (path.basename(parent) === 'autopilot') {
    assertNotSymlinkDir(parent);
  }
  assertNotSymlinkDir(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (path.basename(parent) === 'autopilot') {
    assertNotSymlinkDir(parent);
    fs.chmodSync(parent, 0o700);
  }
  assertNotSymlinkDir(dir);
  fs.chmodSync(dir, 0o700);
}

function sanitizeToolUseId(rawId) {
  const reduced = (typeof rawId === 'string' ? rawId : '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, MAX_ID_LEN);
  if (reduced.length > 0) return reduced;
  return crypto.randomBytes(8).toString('hex');
}

function resolveOutputFile(dir, toolUseId) {
  const resolvedDir = path.resolve(dir);
  const id = sanitizeToolUseId(toolUseId);
  const filePath = path.resolve(resolvedDir, `${id}.txt`);
  if (path.dirname(filePath) !== resolvedDir) {
    throw new Error('resolved output path escapes output directory');
  }
  return filePath;
}

function readLedgerSearchPattern(env) {
  let raw;
  try {
    raw = fs.readFileSync(configPath({ env }), 'utf8');
  } catch {
    return null;
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    return null;
  }
  const pat = cfg && cfg.pm_output_cap && cfg.pm_output_cap.ledger_search_pattern;
  if (typeof pat !== 'string' || pat === '') return null;
  try {
    return new RegExp(pat);
  } catch {
    return null;
  }
}

function lineCapFor(toolName, command, env) {
  const re = readLedgerSearchPattern(env);
  if (!re) return DEFAULT_MAX_LINES;
  if (typeof command === 'string' && re.test(command)) return LEDGER_SEARCH_MAX_LINES;
  if (typeof toolName === 'string' && re.test(toolName)) return LEDGER_SEARCH_MAX_LINES;
  return DEFAULT_MAX_LINES;
}

function isTargetPostTool(toolName) {
  return toolName === 'Bash' || (typeof toolName === 'string' && toolName.startsWith('mcp__'));
}

function textFromBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const parts = [];
  for (const blk of blocks) {
    if (!blk || typeof blk !== 'object' || blk.type !== 'text' || typeof blk.text !== 'string') {
      return null;
    }
    parts.push(blk.text);
  }
  return parts.join('\n');
}

function extractResponseText(input) {
  const resp = input.tool_response !== undefined ? input.tool_response : input.tool_output;
  if (resp === undefined || resp === null) return null;
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return textFromBlocks(resp);
  if (typeof resp !== 'object') return null;
  if (resp.isImage === true) return null;
  if (Array.isArray(resp.content)) return textFromBlocks(resp.content);
  if (typeof resp.content === 'string') {
    if (resp.type && resp.type !== 'text') return null;
    return resp.content;
  }
  if (typeof resp.stdout === 'string' || typeof resp.stderr === 'string') {
    const out = typeof resp.stdout === 'string' ? resp.stdout : '';
    const err = typeof resp.stderr === 'string' ? resp.stderr : '';
    if (out && err) return `${out.endsWith('\n') ? out : `${out}\n`}${err}`;
    return out || err;
  }
  if (typeof resp.text === 'string') {
    if (resp.type && resp.type !== 'text') return null;
    return resp.text;
  }
  return null;
}

function splitLines(text) {
  const norm = String(text).replace(/\r\n/g, '\n');
  const lines = norm.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function wrapPreToolCommand(command, outFile, cap) {
  const qFile = shellQuote(outFile);
  return [
    `( umask 077; : > ${qFile} )`,
    '__pm_cap_rc=0',
    `( ${command}`,
    `) > ${qFile} 2>&1 || __pm_cap_rc=$?`,
    `__pm_cap_n=$(awk 'END{print NR+0}' ${qFile})`,
    `if [ "$__pm_cap_n" -gt ${cap} ]; then`,
    `  chmod 600 ${qFile} 2>/dev/null || true`,
    `  head -n ${cap} ${qFile}`,
    `  printf '… %d 行已截斷，全文：%s\\n' "$((__pm_cap_n - ${cap}))" ${qFile}`,
    'else',
    `  cat ${qFile}`,
    `  rm -f ${qFile}`,
    'fi',
    'exit "$__pm_cap_rc"',
  ].join('\n');
}

function handlePostToolUse(input, env) {
  const toolName = input.tool_name;
  if (!isTargetPostTool(toolName)) return null;
  if (toolName === 'Bash' && (!input.tool_response
    || typeof input.tool_response !== 'object' || Array.isArray(input.tool_response))) return null;
  const fullText = extractResponseText(input);
  if (fullText === null) return null;

  const lines = splitLines(fullText);
  const command = input.tool_input && typeof input.tool_input.command === 'string'
    ? input.tool_input.command
    : '';
  const cap = lineCapFor(toolName, command, env);
  if (lines.length <= cap) return null;

  const dir = resolveOutputDir(env);
  ensurePrivateOutputDir(dir);
  const filePath = resolveOutputFile(dir, input.tool_use_id);
  fs.writeFileSync(filePath, fullText, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);

  const dropped = lines.length - cap;
  const truncated = `${lines.slice(0, cap).join('\n')}\n… ${dropped} 行已截斷，全文：${filePath}`;
  const field = toolName === 'Bash' ? 'updatedToolOutput' : 'updatedMCPToolOutput';
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      [field]: toolName === 'Bash'
        ? { ...input.tool_response, stdout: truncated, stderr: '' }
        : truncated,
    },
  };
}

function handlePreToolUse(input, env) {
  if (input.tool_name !== 'Bash') return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : null;
  if (!toolInput || typeof toolInput.command !== 'string' || toolInput.command === '') return null;

  const dir = resolveOutputDir(env);
  ensurePrivateOutputDir(dir);
  const filePath = resolveOutputFile(dir, input.tool_use_id);
  const cap = lineCapFor('Bash', toolInput.command, env);

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: {
        ...toolInput,
        command: wrapPreToolCommand(toolInput.command, filePath, cap),
      },
    },
  };
}

function handle(input, env = envFromProcess()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();
  if (!isPmConsole(cwd)) return null;

  if (input.hook_event_name === 'PostToolUse') return handlePostToolUse(input, env);
  if (input.hook_event_name === 'PreToolUse') return handlePreToolUse(input, env);
  return null;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
}

function main() {
  try {
    if (!isEnabled('pm-output-cap')) return;
    const raw = readStdin();
    const input = JSON.parse(raw);
    const out = handle(input, envFromProcess());
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`pm-output-cap: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = {
  handle,
  sanitizeToolUseId,
  splitLines,
  wrapPreToolCommand,
  resolveOutputDir,
  DEFAULT_MAX_LINES,
  LEDGER_SEARCH_MAX_LINES,
};
