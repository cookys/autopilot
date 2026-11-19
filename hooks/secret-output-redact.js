#!/usr/bin/env node
'use strict';

// PostToolUse Bash: return a response-shaped object; Claude ignores string replacements.
// Also masks personal data (tw_national_id, tw_mobile, email, card_number) via redactOutput and appends
// `[masked: <category> xN]`. Read/Grep cannot be rewritten here; pii-read-guard.js blocks them pre-run.
const fs = require('node:fs');
const { configPath } = require('../scripts/lib/config-path.js');
const { redactOutput } = require('./_shared/secret-patterns.js');

function secretMode() {
  const override = process.env.AUTOPILOT_BASH_GUARD_SECRET_MODE;
  if (override !== undefined && override !== '') {
    return ['block', 'warn', 'off'].includes(override) ? override : 'block';
  }
  try {
    const mode = JSON.parse(fs.readFileSync(configPath(), 'utf8'))?.depth0_delegate_gate?.secret_print;
    if (['block', 'warn', 'off'].includes(mode)) return mode;
  } catch { /* Missing or invalid config keeps the default protection. */ }
  return 'block';
}

function handle(payload) {
  if (payload?.hook_event_name !== 'PostToolUse' || payload.tool_name !== 'Bash') return null;
  const response = payload.tool_response;
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || typeof response.stdout !== 'string' || secretMode() === 'off') return null;
  const stdout = redactOutput(response.stdout);
  const stderr = typeof response.stderr === 'string' ? redactOutput(response.stderr) : response.stderr;
  if (stdout === response.stdout && stderr === response.stderr) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: { ...response, stdout, stderr },
    },
  };
}

if (require.main === module) {
  try {
    const output = handle(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (output) process.stdout.write(JSON.stringify(output));
  } catch { /* Invalid hook input: no output, never echo the unredacted payload. */ }
}

module.exports = { handle, secretMode };
