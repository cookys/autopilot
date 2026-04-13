#!/usr/bin/env node
/**
 * failure-escalation — PostToolUse/Bash
 * Tracks consecutive Bash failures and injects escalating behavioral requirements.
 *
 * Escalation levels:
 *   L0 (count=1): Audit log only, no injection
 *   L1 (count=2): Switch to fundamentally different approach
 *   L2 (count=3): 5 mandatory investigation steps
 *   L3 (count=4): 7-point checklist
 *   L4 (count>=5): Structured failure report requirement
 *
 * Failure detection:
 *   Primary: exit_code != 0
 *   Secondary: strong error patterns with exit_code == 0
 *   NOT a failure: bare "error" keyword with exit 0 (e.g. grep output)
 *
 * State: session-namespaced counter files in ~/.autopilot/
 *
 * Inspired by tanweai/pua failure-detector.sh (MIT License)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Strong error patterns — only these trigger failure on exit code 0.
// Bare "error" keyword is intentionally excluded to prevent false positives
// (e.g., `grep error logfile.txt` returning matches with exit 0).
const STRONG_ERROR_PATTERNS = [
  /Traceback \(most recent call last\)/i,
  /\bfatal:/i,
  /\bpanic:/i,
  /\bENOENT\b/,
  /\bEACCES\b/,
  /\bPermission denied\b/i,
  /\bSegmentation fault\b/i,
  /\bcore dumped\b/i,
];

const STATE_DIR = path.join(os.homedir(), '.autopilot');
const MAX_OUTPUT_CHARS = 2000;

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

function getSessionHash(input) {
  const sessionId = input.session_id || String(process.ppid);
  return crypto.createHash('md5').update(sessionId).digest('hex').slice(0, 8);
}

function counterPath(sessionHash) {
  return path.join(STATE_DIR, `.failure_count_${sessionHash}`);
}

function readCounter(filePath) {
  try {
    const val = parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

function writeCounter(filePath, count) {
  fs.writeFileSync(filePath, String(count), { mode: 0o600 });
}

function isFailure(input) {
  // Primary signal: exit code
  const exitCode = extractExitCode(input);
  if (exitCode !== null && exitCode !== 0) return true;

  // Secondary signal: strong error patterns with exit 0
  if (exitCode === 0 || exitCode === null) {
    const output = extractOutput(input);
    for (const pattern of STRONG_ERROR_PATTERNS) {
      if (pattern.test(output)) return true;
    }
  }

  return false;
}

function extractExitCode(input) {
  // Try direct field
  if (input.exit_code !== undefined) return Number(input.exit_code);
  if (input.exitCode !== undefined) return Number(input.exitCode);

  // Try nested in tool_result
  const result = input.tool_result;
  if (result && typeof result === 'object') {
    if (result.exit_code !== undefined) return Number(result.exit_code);
    if (result.exitCode !== undefined) return Number(result.exitCode);
  }

  return null;
}

function extractOutput(input) {
  const result = input.tool_output || input.tool_result || '';
  if (typeof result === 'string') return result.slice(0, MAX_OUTPUT_CHARS);
  if (typeof result === 'object') {
    const text = result.content || result.text || result.stdout || JSON.stringify(result);
    return String(text).slice(0, MAX_OUTPUT_CHARS);
  }
  return String(result).slice(0, MAX_OUTPUT_CHARS);
}

function escalationMessage(count) {
  if (count === 1) {
    // L0: audit only, no injection to Claude
    return null;
  }

  if (count === 2) {
    return `[Autopilot Failure Escalation — L1]

Consecutive Bash failure detected (2nd). You MUST switch to a fundamentally different approach — not parameter tweaking, not retrying the same command with minor changes.

Consider invoking superpowers:systematic-debugging if you haven't already.`;
  }

  if (count === 3) {
    return `[Autopilot Failure Escalation — L2]

Third consecutive Bash failure. MANDATORY investigation steps:
1. Read the error message word by word — 90% of answers are in the error text
2. Search (WebSearch / Grep) for the core problem
3. Read the original context around the failure (50 lines up/down)
4. List 3 fundamentally different hypotheses
5. Reverse your main assumption — what if the problem is NOT where you think it is?`;
  }

  if (count === 4) {
    return `[Autopilot Failure Escalation — L3]

Fourth consecutive Bash failure. Complete ALL items before proceeding:
- [ ] Read failure signal word by word?
- [ ] Searched core problem with tools?
- [ ] Read original context around failure?
- [ ] All assumptions verified with tools?
- [ ] Tried the opposite assumption?
- [ ] Reproduced in minimal scope?
- [ ] Switched tools/methods/angles/stack?

Do not skip any item. Each must have a concrete answer, not just a checkmark.`;
  }

  // count >= 5: L4
  return `[Autopilot Failure Escalation — L4]

Five or more consecutive Bash failures. You MUST produce a structured failure report NOW:

1. **Verified facts** — what do you KNOW with evidence?
2. **Excluded possibilities** — what have you ruled out, with evidence for each?
3. **Narrowed problem scope** — where exactly is the problem?
4. **Recommended next steps** — what should be tried next?
5. **Approaches tried** — list each approach and why it failed

If you are genuinely stuck after exhausting all approaches, this report IS the deliverable. A well-documented dead end is more valuable than continued spinning.`;
}

// Main
try {
  let rawInput;
  try {
    rawInput = fs.readFileSync(0, 'utf8');
  } catch {
    // Fallback for environments where fd 0 direct read fails
    rawInput = fs.readFileSync('/dev/stdin', 'utf8');
  }
  const input = JSON.parse(rawInput);

  // Only process Bash tool results
  const toolName = input.tool_name || '';
  if (toolName !== 'Bash') process.exit(0);

  ensureStateDir();
  const sessionHash = getSessionHash(input);
  const cPath = counterPath(sessionHash);

  if (isFailure(input)) {
    const count = readCounter(cPath) + 1;
    writeCounter(cPath, count);

    const msg = escalationMessage(count);
    if (msg) {
      process.stdout.write(msg + '\n');
    }
  } else {
    // Success: reset consecutive counter
    const current = readCounter(cPath);
    if (current > 0) {
      writeCounter(cPath, 0);
    }
  }

  process.exit(0);
} catch (e) {
  // Fail-open: malformed JSON or other errors should not block the tool pipeline
  process.stderr.write(`failure-escalation: ${e.message}\n`);
  process.exit(0);
}
