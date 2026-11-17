/**
 * Shared secret detection patterns for autopilot hooks.
 * Used by: audit-log.js (redact), commit-secret-scan.js (scan), secret-output-redact.js (redactOutput).
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

const secretName = /SALT|PASSWORD|PASS|SECRET|TOKEN|KEY/i;
// Quote alternatives are disjoint; escapes consume two characters. Never cross a line.
const phpDefine = /\bdefine[ \t]*\([ \t]*(?:'([^'\r\n]*)'|"([^"\r\n]*)")[ \t]*,[ \t]*('(?:\\[^\r\n]|[^'\\\r\n])*'|"(?:\\[^\r\n]|[^"\\\r\n])*")/gi;

// Walk quotes/escapes once, including incomplete quoted values (redact to line end).
function quotedEnd(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

function redactAssignment(text, preserveComment = true) {
  const match = /^(([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*)(.*)$/.exec(text);
  if (!match || !secretName.test(match[2])) return text;
  const prefix = match[1];
  const value = match[3];
  if (value[0] === '"' || value[0] === "'") {
    const end = quotedEnd(value, 0);
    const close = end > 1 && value[end - 1] === value[0] ? value[0] : '';
    return prefix + value[0] + '[REDACTED]' + close + value.slice(end);
  }
  const comment = preserveComment && /[ \t]#/.exec(value);
  let end = comment ? comment.index : value.length;
  while (end > 0 && (value[end - 1] === ' ' || value[end - 1] === '\t')) end--;
  return prefix + '[REDACTED]' + (comment ? value.slice(end) : '');
}

function redactEnvironment(text) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length;) {
    if (text[i] === ' ' || text[i] === '\t') { i++; continue; }
    parts.push(text.slice(start, i));
    start = i;
    // A systemd Environment= line is a whitespace-separated list of assignments;
    // quoted spaces and escaped quotes belong to their original token.
    while (i < text.length && text[i] !== ' ' && text[i] !== '\t') {
      if (text[i] === '"' || text[i] === "'") i = quotedEnd(text, i);
      else if (text[i] === '\\') i = Math.min(i + 2, text.length);
      else i++;
    }
    const token = text.slice(start, i);
    const quote = token[0];
    if ((quote === '"' || quote === "'") && quotedEnd(token, 0) === token.length) {
      const close = token.length > 1 && token.at(-1) === quote ? quote : '';
      parts.push(quote + redactAssignment(token.slice(1, close ? -1 : undefined), false) + close);
    } else parts.push(redactAssignment(token));
    start = i;
  }
  parts.push(text.slice(start));
  return parts.join('');
}

function redactProperties(text) {
  // Disjoint quote bodies: backslash escapes in double quotes, YAML '' in single
  // quotes. A quoted key after a log/path prefix must not be consumed as a value.
  const quoted = String.raw`(?:"(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:''|[^'\r\n])*')(?![ \t]*:)`;
  // The left boundary prevents suffix retries within names and escaped quotes.
  // Consume benign properties too, so a secret word in their value is not a key.
  const properties = new RegExp(
    String.raw`(?<![A-Za-z0-9_."'\\-])(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]*)\1[ \t]*(?::[ \t]*(${quoted})|=[ \t]*(${quoted}|[^\s"',;{}\[\]]+))`, 'g');
  return text.replace(properties, (match, keyQuote, name, colonValue, equalsValue) => {
    if (!secretName.test(name)) return match;
    const value = colonValue ?? equalsValue;
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return match.slice(0, -value.length) + quote + '[REDACTED]' + quote;
  });
}

function redactOutput(text) {
  let result = text.replace(phpDefine, (match, singleName, doubleName, value) => {
    if (!secretName.test(singleName ?? doubleName)) return match;
    return match.slice(0, -value.length) + value[0] + '[REDACTED]' + value.at(-1);
  });
  // Match line bodies only, leaving LF/CRLF and all non-matching bytes untouched.
  result = result.replace(/^[^\r\n]+/gm, (line) => {
    const env = /^([ \t]*Environment[ \t]*=)(.*)$/.exec(line);
    if (env) return env[1] + redactEnvironment(env[2]);
    const plain = /^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*[ \t]*=.*)$/.exec(line);
    return plain ? plain[1] + redactAssignment(plain[2]) : line;
  });
  result = redactProperties(result);
  for (const { pattern } of patterns) {
    result = result.replace(new RegExp(pattern.source, 'g'), '[REDACTED]');
  }
  return result;
}

module.exports = {
  patterns,
  redactOutput,

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
