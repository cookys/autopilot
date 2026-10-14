'use strict';

// grok-effort.js — JS entry to the grok effort clamp. DELEGATES to scripts/lib/grok-effort.sh's
// grok_effort_clamp (the canonical owner). The enum is per-MODEL (grok-4.5 rejects xhigh; 4.6/4.7
// accept it), so with a model the bash lib asks that model's CLI for its live enum. If bash or the
// lib is unavailable, fall back to the static table, never to an unvalidated value.
// Shared by qualification-review-provider.js (what is sent) and qualification-effort-label.js
// (what the row label is compared against), so the two can never disagree about the clamp.

const path = require('path');
const { execFileSync } = require('child_process');

function grokEffortClamp(effort, model, bin) {
  const staticClamp = () => {
    switch (effort) {
      case 'low': case 'medium': case 'high': case 'xhigh': return effort;
      default: return 'xhigh'; // 'max' and anything unrecognized clamp to the ceiling
    }
  };
  try {
    const lib = path.join(__dirname, 'grok-effort.sh');
    const out = execFileSync('bash', ['-c', '. "$1"; grok_effort_clamp "$2" "$3" "$4"', '_',
      lib, String(effort || ''), String(model || ''), String(bin || 'grok')],
      { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (['low', 'medium', 'high', 'xhigh'].includes(out)) return out;
  } catch { /* fall through to the static table */ }
  return staticClamp();
}

module.exports = { grokEffortClamp };
