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

const secretName = /SALT|PASSWORD|PASS|SECRET|TOKEN|KEY|CREDENTIAL/i;
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
  const match = /^(([A-Za-z_][A-Za-z0-9_]*)[ \t]*[=:][ \t]*)(.*)$/.exec(text);
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

// Personal-data categories (same module, same mask mechanism). Kept out of `patterns` so
// commit-secret-scan and audit-log keep their credential-only scope.
// Official ID letter codes, A..Z in order: A=10 ... H=17, I=34, J=18 ... N=22, O=35, P=23 ... V=29, W=32, X=30, Y=31, Z=33.
const ID_CODE = [10, 11, 12, 13, 14, 15, 16, 17, 34, 18, 19, 20, 21, 22, 35, 23, 24, 25, 26, 27, 28, 29, 32, 30, 31, 33];
function twIdValid(id) {
  const n = ID_CODE[id.charCodeAt(0) - 65];
  let sum = Math.floor(n / 10) + (n % 10) * 9;
  for (let i = 1; i <= 8; i++) sum += Number(id[i]) * (9 - i);
  return (sum + Number(id[9])) % 10 === 0;
}
function luhnValid(digits) {
  let sum = 0;
  for (let i = digits.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const piiPatterns = [
  // [12] citizen, [89] new-format resident certificate; the checksum cuts random-token false positives.
  { name: 'tw_national_id', pattern: /(?<![A-Za-z0-9])[A-Z][1289]\d{8}(?![A-Za-z0-9])/g, valid: twIdValid },
  { name: 'tw_mobile', pattern: /(?<![A-Za-z0-9+])(?:\+886[- ]?9|09)\d{2}[- ]?\d{3}[- ]?\d{3}(?![A-Za-z0-9])/g },
  { name: 'email', pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-]|:\S)/g },
  // 13-19 digits, plain or 4-4-4-n / 4-6-5 groups; leading 2-6 (card networks) keeps epoch ms (1xxxxxxxxxxxx) out.
  {
    name: 'card_number',
    pattern: /(?<![A-Za-z0-9.-])[2-6](?:\d{12,18}|\d{3}[- ]\d{4}[- ]\d{4}[- ]\d{1,7}|\d{3}[- ]\d{6}[- ]\d{5})(?![A-Za-z0-9])/g,
    valid: (m) => luhnValid(m.replace(/[- ]/g, '')),
  },
];

/** Count PII hits per category without keeping any value. @returns {Object<string, number>} */
function scanPii(text) {
  const counts = {};
  const s = String(text);
  for (const { name, pattern, valid } of piiPatterns) {
    const n = [...s.matchAll(new RegExp(pattern.source, 'g'))].filter((m) => !valid || valid(m[0])).length;
    if (n) counts[name] = n;
  }
  return counts;
}

function piiSummary(counts) {
  const parts = Object.entries(counts).map(([name, n]) => `${name} x${n}`);
  return parts.length ? `[masked: ${parts.join(', ')}]` : '';
}

/** Replace PII values with [PII:<category>]; the counts carry no value. */
function maskPii(text) {
  let result = String(text);
  const counts = {};
  for (const { name, pattern, valid } of piiPatterns) {
    result = result.replace(new RegExp(pattern.source, 'g'), (m) => {
      if (valid && !valid(m)) return m;
      counts[name] = (counts[name] || 0) + 1;
      return `[PII:${name}]`;
    });
  }
  return { text: result, counts };
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
    // grep -n / -Hn and rg prefixes precede YAML list entries. Keep the
    // prefix/outer quotes, but redact the whole value (including spaces).
    // Prefer a bare list, then the shortest grep prefix; values may contain ':0: - '.
    const list = /^((?:(?:[^:\r\n]+:)*?\d+:)??[ \t]*-[ \t]+)(.*)$/.exec(line);
    if (list) {
      const body = list[2];
      if (body[0] === '"' || body[0] === "'") {
        const end = quotedEnd(body, 0);
        const close = end > 1 && body[end - 1] === body[0] ? body[0] : '';
        return list[1] + body[0] + redactAssignment(body.slice(1, close ? end - 1 : end), false)
          + close + body.slice(end);
      }
      return list[1] + redactAssignment(body);
    }
    const plain = /^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*[ \t]*=.*)$/.exec(line);
    return plain ? plain[1] + redactAssignment(plain[2]) : line;
  });
  result = redactProperties(result);
  for (const { pattern } of patterns) {
    result = result.replace(new RegExp(pattern.source, 'g'), '[REDACTED]');
  }
  const pii = maskPii(result);
  if (!Object.keys(pii.counts).length) return result;
  return `${pii.text}${pii.text.endsWith('\n') ? '' : '\n'}${piiSummary(pii.counts)}\n`;
}

module.exports = {
  patterns,
  piiPatterns,
  maskPii,
  scanPii,
  piiSummary,
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
