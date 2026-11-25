#!/usr/bin/env node
/**
 * fleet-quota-wait-guard — PreToolUse, matcher mcp__fleet__task_result|mcp__fleet__task_comment|mcp__fleet__send.
 *
 * Blocks (default) or warns when a fleet message/comment/result marks "等額度 / 等 X 額度 / quota wait"
 * without attaching engine quota readings (engine, 5h%, 7d%, reset_at, observed_at), OR when the
 * attached readings show the engine still has quota (prompts to dispatch directly).
 *
 * Knob: AUTOPILOT_QUOTA_WAIT_GUARD_MODE=block|warn|off (default: block).
 * Fail-open: malformed stdin JSON -> exit 0 silently.
 */
'use strict';

const fs = require('fs');
const { normalizeEngine } = require('../scripts/quota-wait-check.js');

const QUOTA_WAIT_RE = /等\s*[A-Za-z0-9_.-]*\s*額度|quota[\s_-]*wait|wait(?:ing)?\s+(?:for|on)\s+quota/i;

function getMode(env = process.env) {
  const raw = env && env.AUTOPILOT_QUOTA_WAIT_GUARD_MODE;
  if (typeof raw !== 'string') return 'block';
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === '0' || v === 'no') return 'off';
  if (v === 'warn') return 'warn';
  return 'block';
}

function extractText(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const parts = [];
  for (const key of ['content', 'text', 'message', 'reason', 'note']) {
    if (typeof toolInput[key] === 'string' && toolInput[key].trim()) {
      parts.push(toolInput[key]);
    }
  }
  return parts.join('\n');
}

function parseAttachedReading(text) {
  if (typeof text !== 'string' || !text) return null;
  const has5h = /(?:5h\s*[=:]\s*|5h\s+)(\d+(?:\.\d+)?)\s*%/i.exec(text);
  const has7d = /(?:7d\s*[=:]\s*|7d\s+)(\d+(?:\.\d+)?)\s*%/i.exec(text);
  const hasReset = /(?:reset_at|resets_at|reset_time|重置時間|重置)\s*[=:：]\s*\S+/i.test(text);
  const hasObserved = /observed_at\s*[=:：]\s*\S+/i.test(text);

  if (!has5h || !has7d || !hasReset || !hasObserved) {
    return { complete: false };
  }

  const pct5h = Number(has5h[1]);
  const pct7d = Number(has7d[1]);
  const engMatch = /engine\s*[=:]\s*([A-Za-z0-9_.-]+)/i.exec(text);
  const engine = engMatch ? normalizeEngine(engMatch[1]) : '';
  const exhausted = pct5h >= 100 || pct7d >= 100;

  return {
    complete: true,
    engine,
    pct_5h: pct5h,
    pct_7d: pct7d,
    exhausted,
  };
}

function evaluateQuotaWaitGuard(payload, env = process.env) {
  const mode = getMode(env);
  if (mode === 'off') return { action: 'allow' };

  const toolInput = payload && payload.tool_input;
  const text = extractText(toolInput);
  if (!text || !QUOTA_WAIT_RE.test(text)) {
    return { action: 'allow' };
  }

  const reading = parseAttachedReading(text);
  if (!reading || !reading.complete) {
    const reason = '偵測到「等額度 / quota wait」字樣，但未附上完整引擎額度讀數（須含 5h、7d 百分比、重置時間 reset_at、observed_at）。'
      + '請先執行 `node scripts/quota-wait-check.js --engine <engine>` 取得讀數，並在訊息附上：'
      + '`quota_reading: engine=<engine> 5h=<pct>% 7d=<pct>% reset_at=<ISO> observed_at=<ISO>`。';
    return mode === 'warn'
      ? { action: 'warn', reason }
      : { action: 'deny', reason };
  }

  if (!reading.exhausted) {
    const engLabel = reading.engine || '該引擎';
    const reason = `偵測到「等額度 / quota wait」標記，但附上的讀數顯示 ${engLabel} 仍有額度（5h=${reading.pct_5h}%, 7d=${reading.pct_7d}%），請直接派工，勿等待。`;
    return mode === 'warn'
      ? { action: 'warn', reason }
      : { action: 'deny', reason };
  }

  return { action: 'allow' };
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

function preToolWarn(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: `[quota-wait-guard warn] ${reason}`,
    },
  };
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }
  if (!raw || !raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const decision = evaluateQuotaWaitGuard(payload, process.env);
  if (decision.action === 'deny') {
    process.stdout.write(JSON.stringify(preToolDeny(decision.reason)));
  } else if (decision.action === 'warn') {
    process.stdout.write(JSON.stringify(preToolWarn(decision.reason)));
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  QUOTA_WAIT_RE,
  getMode,
  extractText,
  parseAttachedReading,
  evaluateQuotaWaitGuard,
};
