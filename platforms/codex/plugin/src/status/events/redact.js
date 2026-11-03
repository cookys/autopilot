'use strict';

// src/status/events/redact.js - deterministic redaction of the free-text fields of the events feed (autopilot.events/1).
//
// redactText(text) -> { text, redactions }
//   Layer 1 (this file): token shapes - private-key blocks, common service-token prefixes, JWTs and `name=value` secrets -
//   replaced by `[redacted]`. Runs first, so the contract's literal `[redacted]` is what a token becomes.
//   Layer 2: scripts/lib/personal-data-redact.js - home/tmp/run paths, e-mail, host names, private IPs and the secret
//   prefixes of hooks/_shared/secret-patterns.js, each replaced by that module's own placeholder.
// `redactions` counts the hits of both layers (it feeds sources[].redactions). Pure function; never throws.
//
// truncateText(text, max) -> text capped at `max` characters, the cut marked with an ellipsis.

const personal = require('../../../scripts/lib/personal-data-redact');

const MARK = '[redacted]';

// Token prefixes and shapes. Each pattern is anchored on a prefix that is rare in prose, so a commit subject or a
// rationale is not eaten by a generic "long random string" guess. Prefixes that cannot occur inside an ordinary word (ghp_, glpat-,
// AKIA, xoxb-, eyJ, ...) carry NO left boundary, so a token glued to letters is still masked; prefixes that do occur inside
// words (sk- in task-/desk-, Bearer) keep their \b.
const TOKEN_PATTERNS = [
  { name: 'private-key-block', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g },
  { name: 'github-token', re: /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: 'gitlab-token', re: /glpat-[A-Za-z0-9_-]{16,}/g },
  { name: 'anthropic-openai-key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g },
  { name: 'aws-access-key', re: /(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'google-api-key', re: /AIza[A-Za-z0-9_-]{30,}/g },
  { name: 'slack-token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'stripe-key', re: /(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}/g },
  { name: 'npm-token', re: /npm_[A-Za-z0-9]{30,}/g },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bearer', re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, keep: 1 },
  // `token=abc`, `api_key: abc`, `password = abc`: the name stays, the value goes.
  { name: 'named-secret', re: /\b((?:[A-Za-z0-9_]*(?:token|secret|passwd|password|api[_-]?key|apikey|credential)[A-Za-z0-9_]*)\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, keep: 1 },
];

function redactTokens(text) {
  let count = 0;
  let out = text;
  for (const { re, keep } of TOKEN_PATTERNS) {
    out = out.replace(re, (...args) => {
      count += 1;
      return keep ? `${args[keep]}${MARK}` : MARK;
    });
  }
  return { text: out, redactions: count };
}

function redactText(value) {
  const input = value === null || value === undefined ? '' : String(value);
  let tokens;
  try {
    tokens = redactTokens(input);
  } catch (_error) {
    return { text: MARK, redactions: 1 }; // fail closed: a field we cannot scan is not shown
  }
  try {
    const pd = personal.redactText(tokens.text);
    return { text: pd.text, redactions: tokens.redactions + pd.hits.length };
  } catch (_error) {
    return { text: MARK, redactions: tokens.redactions + 1 };
  }
}

function truncateText(value, max) {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

module.exports = { redactText, truncateText, redactTokens, TOKEN_PATTERNS, MARK };
