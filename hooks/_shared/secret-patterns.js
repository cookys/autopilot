/**
 * Shared secret detection patterns for autopilot hooks.
 * Used by: audit-log.js (redact), commit-secret-scan.js (scan).
 * Single source of truth — prevents regex drift between hooks.
 *
 * Patterns sourced from gitleaks/truffleHog canonical lists, filtered to top-10
 * most common cloud/dev service tokens.
 */

'use strict';

const patterns = [
  { name: 'openai', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'anthropic', pattern: /sk-ant-[A-Za-z0-9\-]{20,}/ },
  { name: 'github-pat', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'github-oauth', pattern: /gho_[A-Za-z0-9]{36}/ },
  { name: 'github-app', pattern: /ghs_[A-Za-z0-9]{36}/ },
  { name: 'aws-access-key', pattern: /AKIA[A-Z0-9]{16}/ },
  { name: 'google-api', pattern: /AIza[A-Za-z0-9_\-]{35}/ },
  { name: 'slack-bot', pattern: /xoxb-[A-Za-z0-9\-]+/ },
  { name: 'slack-user', pattern: /xoxp-[A-Za-z0-9\-]+/ },
  { name: 'stripe-secret', pattern: /sk_live_[A-Za-z0-9]{24,}/ },
];

/** Inline key=value patterns (not service-specific). */
const kvPatterns = [
  { find: /--token[= ][^ ]*/g, replace: '--token=<REDACTED>' },
  { find: /password[= ][^ ]*/gi, replace: 'password=<REDACTED>' },
  { find: /sshpass\s+-p\s+'[^']*'/g, replace: "sshpass -p '<REDACTED>'" },
  { find: /Authorization:\s*Bearer\s+[^ '"]*/gi, replace: 'Authorization: Bearer <REDACTED>' },
];

module.exports = {
  patterns,

  /**
   * Redact all known secret patterns in text.
   * @param {string} text
   * @returns {string} text with secrets replaced by <REDACTED>
   */
  redact(text) {
    let result = String(text);
    for (const { pattern } of patterns) {
      result = result.replace(new RegExp(pattern.source, 'g'), '<REDACTED>');
    }
    for (const { find, replace } of kvPatterns) {
      result = result.replace(find, replace);
    }
    return result;
  },

  /**
   * Scan text for secret patterns. Returns array of hits.
   * @param {string} text
   * @returns {Array<{name: string, match: string}>} found secrets (match truncated to 8 chars + ...)
   */
  scan(text) {
    const hits = [];
    const s = String(text);
    for (const { name, pattern } of patterns) {
      const m = s.match(pattern);
      if (m) hits.push({ name, match: m[0].slice(0, 8) + '...' });
    }
    return hits;
  },
};
