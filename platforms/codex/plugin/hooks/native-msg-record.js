#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { record } = require('../scripts/native-msg-outbox');

function isCrossSessionTarget(to, toolInput) {
  if (!to || typeof to !== 'string') return false;
  if (toolInput && toolInput.in_process === true) return false;
  if (to.includes('/') || to.includes(':')) return true;
  if (to.startsWith('session-') || to.startsWith('peer-')) return true;
  return false;
}

function main() {
  const timer = setTimeout(() => process.exit(0), 3000);
  timer.unref();

  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return;
    const payload = JSON.parse(raw);

    const resp = payload.tool_response;
    if (resp && (resp.is_error === true || resp.error)) {
      return;
    }

    const input = payload.tool_input || {};
    const to = input.to;
    if (!isCrossSessionTarget(to, input)) {
      return;
    }

    const from = process.env.AUTOPILOT_FLEET_ADDRESS || 'unknown';
    const summary = input.summary || String(input.message || '').slice(0, 120);
    record({ from, to, summary });
  } catch {
    // fail-open
  }
}

main();
process.exit(0);
