#!/usr/bin/env node
/**
 * cost-tracker — Stop
 * Logs session token usage + estimated cost to ~/.claude/metrics/costs.jsonl.
 * Opt-out: set autopilot.costTracker = false in settings.json.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Model pricing (USD per 1M tokens) — update when Anthropic changes pricing
const PRICING = {
  haiku:  { input: 0.8,  output: 4 },
  sonnet: { input: 3,    output: 15 },
  opus:   { input: 15,   output: 75 },
};

function getRate(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku'))  return PRICING.haiku;
  if (m.includes('opus'))   return PRICING.opus;
  return PRICING.sonnet; // default
}

// ⚠️ STILL DISABLED (2026-06-23, v2.23.0): the read below was fixed to fd 0,
// but the Stop-event payload on Claude Code 2.1.186 carries NO `usage`/`model`
// fields (keys: session_id, transcript_path, cwd, permission_mode, effort,
// stop_hook_active, last_assistant_message, background_tasks, session_crons).
// So this hook would always hit the 0-tokens early-exit and write nothing.
// Re-enabling needs a rewrite that sums usage from the transcript (via the
// `transcript_path` in the Stop payload), NOT just a stdin fix. Left disabled.
try {
  // Read fd 0 (the '/dev/stdin' PATH ENXIOs; fd 0 carries the payload).
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);

  // Check opt-out via env (settings.json injects as env vars for hooks)
  if (process.env.AUTOPILOT_COST_TRACKER === 'false') process.exit(0);

  const usage = input.usage || input.metadata?.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);

  if (inputTokens === 0 && outputTokens === 0) process.exit(0);

  const model = input.model || process.env.CLAUDE_MODEL || 'sonnet';
  const rate = getRate(model);
  const costUsd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;

  const metricsDir = path.join(os.homedir(), '.claude', 'metrics');
  fs.mkdirSync(metricsDir, { recursive: true });

  const entry = {
    ts: new Date().toISOString(),
    session: process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || 'unknown',
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(costUsd * 10000) / 10000,
    cwd: process.cwd(),
  };

  fs.appendFileSync(
    path.join(metricsDir, 'costs.jsonl'),
    JSON.stringify(entry) + '\n'
  );

  process.exit(0);
} catch (e) {
  process.stderr.write(`cost-tracker error: ${e.message}\n`);
  process.exit(0);
}
