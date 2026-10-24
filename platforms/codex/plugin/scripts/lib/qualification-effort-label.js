'use strict';

// qualification-effort-label.js — compares the operator-typed `--effort` label on an exam row
// with the effort the qualification provider will actually send (BL-0166).
//
// The label and the wire value travel separately: `--effort` is just a label stored on the row,
// while the provider reads QRP_HTTP_EFFORT (http) or QRP_CLI_EFFORT (cli), and only if the name
// is passed through `--provider-env` / `--panel-env` (the case broker scrubs everything else).
// Nothing compared the two, so a forgotten env var recorded a tier that never ran (13 rows,
// 2026-10-14). This module is pure: advisory by design (the caller warns and marks the row; it
// never blocks the exam), and silent about custom panel commands it knows nothing about.

const { grokEffortClamp } = require('./grok-effort');

const EFFORT_CHECK_STATUSES = Object.freeze(['match', 'mismatch', 'unverifiable']);
// CLI kinds whose provider branch never sends an effort (effort lives in the model name); the
// scorecard vocabulary labels that dimension `none`. kimi is NOT one: it takes
// KIMI_MODEL_THINKING_EFFORT, so its label is compared with the value actually sent.
const NO_EFFORT_CLI_KINDS = Object.freeze(['agy']);

function normalizeSent(value) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  return v === '' ? 'default' : v;
}

// listedEnvNames: names passed via --provider-env / --panel-env. env: the process environment
// whose values those names carry.
function checkEffortLabel({ label, listedEnvNames, env }) {
  const names = new Set(listedEnvNames || []);
  const providerInPlay = [...names].some((n) => n.startsWith('QRP_'));
  if (!providerInPlay) {
    return { status: 'unverifiable', label, sent: null, transport: null, reason: 'no QRP_* provider variable is passed through; effort delivery is not observable' };
  }
  const visible = (name) => (names.has(name) ? env[name] : undefined);
  const transport = normalizeSent(visible('QRP_TRANSPORT') === undefined ? 'http' : visible('QRP_TRANSPORT'));
  let sent;
  let reason = null;
  if (transport === 'cli') {
    const kind = visible('QRP_CLI_KIND');
    if (NO_EFFORT_CLI_KINDS.includes(kind)) {
      sent = 'none';
      reason = `cli kind ${kind} takes no effort flag`;
    } else {
      sent = normalizeSent(visible('QRP_CLI_EFFORT'));
      // The provider clamps grok's effort before sending, so compare the clamped value.
      if (kind === 'grok' && sent !== 'default') {
        sent = grokEffortClamp(sent, visible('QRP_MODEL') || '', visible('QRP_CLI_BIN') || '');
      }
    }
  } else {
    sent = normalizeSent(visible('QRP_HTTP_EFFORT'));
  }
  const status = normalizeSent(label) === sent ? 'match' : 'mismatch';
  if (status === 'mismatch' && !reason) {
    reason = names.has(transport === 'cli' ? 'QRP_CLI_EFFORT' : 'QRP_HTTP_EFFORT')
      ? 'the effort variable carries a different value than the label'
      : 'the effort variable is not passed through, so the endpoint default ran';
  }
  return { status, label, sent, transport, reason };
}

module.exports = { checkEffortLabel, EFFORT_CHECK_STATUSES, NO_EFFORT_CLI_KINDS };
