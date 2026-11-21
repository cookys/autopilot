'use strict';
/*
 * ar-redact-rules.js — the rule set of the AR digest redactor (scripts/ar-redact.js). Node built-ins only.
 *
 * Reuses by import (no copied regexes): scripts/lib/personal-data-patterns.js (home paths, host names,
 * private IPs, e-mail, credential prefixes) and hooks/_shared/secret-patterns.js (token prefixes).
 * Adds the gaps: public IPv4/IPv6, JWT, high-entropy values after Bearer/token:/key=, long hex and base64,
 * PEM private-key blocks, SSH public key lines, xAI / Hugging Face / GitLab / fine-grained GitHub tokens,
 * account names (user=, --account, login:, ssh <acct>@<host>), phone / national-id numbers,
 * scheme://user:pass@, and env-style KEY=VALUE where KEY contains KEY|SECRET|TOKEN|PASS.
 *
 * A hit becomes "[REDACTED:<class>]". redactText(s[, rules]) -> {text, counts, total}. A rule is
 * {cls, apply(text, bump) -> text}; passing a different list is the test seam (no env knob exists).
 * Matched values are never logged or thrown.
 */
const patterns = require('./personal-data-patterns');
function secretPatterns() {
  return require('../../hooks/_shared/secret-patterns').patterns;
}

const tag = (cls) => `[REDACTED:${cls}]`;
const isRedacted = (v) => typeof v === 'string' && v.startsWith('[REDACTED');

/** One regex rule. fn(match, g1.., offset, whole) returns the replacement, or null to leave the match. */
function sub(cls, re, fn) {
  return {
    cls,
    apply(text, bump) {
      return text.replace(re, (...a) => {
        const r = fn(...a);
        if (r === null) return a[0];
        bump(cls);
        return r;
      });
    },
  };
}

function shannon(s) {
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) || 0) + 1);
  let h = 0;
  for (const n of f.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

function highEntropy(v) {
  if (/^\[?REDACTED/.test(v)) return false;
  const letter = /[A-Za-z]/.test(v);
  const digit = /\d/.test(v);
  const mixed = /[a-z]/.test(v) && /[A-Z]/.test(v);
  return (letter && digit) || mixed || shannon(v) >= 4.0;
}

function publicV4(m) {
  const o = m.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return false;
  if (o[0] === 0 || o[0] === 127) return false; // 0.0.0.0, loopback, version-like 0.x
  return !patterns.isPrivateIp(m); // private ranges are the personal-data rule's job
}

const HEX = '[0-9A-Fa-f]{1,4}';
const V6 = new RegExp(
  `(?<![0-9A-Za-z:])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){1,7}:(?:${HEX}(?::${HEX}){0,6})?|::(?:${HEX}:){0,6}${HEX})(?![0-9A-Za-z:])`,
  'g'
);

const VAL = '("[^"]*"|\'[^\']*\'|[^\\s\'",;&]+)';

function personalDataRule() {
  return {
    cls: 'personal',
    apply(text, bump) {
      const hits = patterns.findAll(text);
      if (!hits.length) return text;
      let out = '';
      let pos = 0;
      for (const h of hits) {
        out += text.slice(pos, h.index) + tag(h.category);
        pos = h.index + h.length;
        bump(h.category);
      }
      return out + text.slice(pos);
    },
  };
}

function buildRules() {
  const rules = [];
  // 1. PEM private-key blocks (an unterminated block, e.g. a truncated paste, goes to the end of the text)
  rules.push(sub('pem_private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => tag('pem_private_key')));
  // 2. scheme://user:pass@host
  rules.push(sub('conn_string', /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/g, (m, scheme) => `${scheme}${tag('conn_string')}@`));
  // 3. JWT
  rules.push(sub('jwt', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, () => tag('jwt')));
  // 4. credential prefixes: the shared list by import, then the gaps
  const prefixed = secretPatterns().map(({ name, pattern }) => ({ name, re: new RegExp(pattern.source, 'g') }));
  prefixed.push(
    { name: 'xai', re: /(?<![A-Za-z0-9_-])xai-[A-Za-z0-9]{20,}/g },
    { name: 'huggingface', re: /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,}/g },
    { name: 'gitlab-pat', re: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g },
    { name: 'github-fine-pat', re: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}/g }
  );
  for (const { name, re } of prefixed) rules.push(sub(name, re, () => tag(name)));
  // 5. SSH public key lines
  rules.push(sub('ssh_pubkey', /\b(?:ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-nistp\d+)\s+AAAA[A-Za-z0-9+/]+={0,3}(?:[ \t]+\S+)?/g, () => tag('ssh_pubkey')));
  // 6. accounts
  rules.push(sub('account', /(\bssh\s+(?:-\S+\s+(?:[^\s@-][^\s@]*\s+)?)*)([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)/g,
    (m, pre) => `${pre}${tag('account')}@${tag('host')}`));
  rules.push(sub('account', new RegExp(`((?<![A-Za-z0-9_-])(?:user(?:name)?|account)\\s*=\\s*)${VAL}`, 'gi'),
    (m, pre, v) => (isRedacted(v) ? null : `${pre}${tag('account')}`)));
  rules.push(sub('account', new RegExp(`(--account(?:\\s+|=))${VAL}`, 'g'),
    (m, pre, v) => (isRedacted(v) ? null : `${pre}${tag('account')}`)));
  rules.push(sub('account', /(\blogin:[ \t]*)([^\s'",;]+)/gi,
    (m, pre, v) => (isRedacted(v) ? null : `${pre}${tag('account')}`)));
  // 7. secrets given as arguments or env-style assignments
  rules.push(sub('cli_secret', /(sshpass\s+-p\s+)('[^']*'|"[^"]*"|\S+)/g, (m, pre, v) => (isRedacted(v) ? null : `${pre}${tag('cli_secret')}`)));
  rules.push(sub('cli_secret', new RegExp(`(--(?:token|password|passwd|secret|api-key|apikey)(?:\\s+|=))${VAL}`, 'gi'),
    (m, pre, v) => (isRedacted(v) || /^[$-]/.test(v) ? null : `${pre}${tag('cli_secret')}`)));
  rules.push(sub('env_secret', new RegExp(`((?<![A-Za-z0-9_])[A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASS)[A-Za-z0-9_]*=)${VAL}`, 'gi'),
    (m, pre, v) => (isRedacted(v) || /^["']?[$<]/.test(v) ? null : `${pre}${tag('env_secret')}`)));
  // 8. high-entropy value after Bearer / token: / key=
  rules.push(sub('bearer', /(\bBearer\s+|(?<![A-Za-z0-9_-])(?:token|key)\s*[:=]\s*)(["']?)([A-Za-z0-9._~+/=-]{20,})/gi,
    (m, pre, q, v) => (highEntropy(v) ? `${pre}${q}${tag('bearer')}` : null)));
  // 9. personal data of the leak guard (home path, host, private IP, e-mail)
  rules.push(personalDataRule());
  // 10. IPs
  rules.push(sub('ipv6', V6, (m) => (m.length >= 5 && m !== '::1' ? tag('ipv6') : null)));
  rules.push(sub('ipv4', /(?<![0-9.])(?:\d{1,3}\.){3}\d{1,3}(?![0-9]|\.\d)/g, (m) => (publicV4(m) ? tag('ipv4') : null)));
  // 11. long hex and base64 runs (a 7-12 char git sha is left alone)
  rules.push(sub('hex40', /(?<![0-9A-Za-z])[0-9a-fA-F]{40,}(?![0-9A-Za-z])/g, () => tag('hex40')));
  rules.push(sub('base64', /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}/g,
    (m) => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m) ? tag('base64') : null)));
  // 12. phones and national ids (strict: better too much than too little)
  rules.push(sub('phone', /(?<![A-Za-z0-9])(?:\+\d{1,3}[ -]?\d{1,4}(?:[ -]?\d{2,4}){2,4}|09\d{2}[- ]?\d{3}[- ]?\d{3}|0\d{1,2}-\d{6,8}|\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4})(?![0-9A-Za-z])/g, () => tag('phone')));
  rules.push(sub('national_id', /(?<![A-Za-z0-9])(?:[A-Z][12]\d{8}|\d{3}-\d{2}-\d{4})(?![0-9A-Za-z])/g, () => tag('national_id')));
  return rules;
}

let DEFAULT = null;
function defaultRules() {
  if (!DEFAULT) DEFAULT = buildRules();
  return DEFAULT;
}

/** Undo the escapes a transcript layers on a value: \n \r \t \" and %xx (ascii), up to three rounds. */
function decodeVariant(s) {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const next = cur
      .replace(/\\([nrt"])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"' }[c]))
      .replace(/%([0-7][0-9A-Fa-f])/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

function pass(text, rules, counts) {
  let cur = text;
  const bump = (cls) => { counts[cls] = (counts[cls] || 0) + 1; };
  for (const r of rules) cur = r.apply(cur, bump);
  return cur;
}

/**
 * Redact one string. If the decoded variant (\n-escaped, URL-encoded) still hides a hit that the raw
 * text did not show, the redacted decoded text is returned instead.
 * @returns {{text:string, counts:Object<string,number>, total:number}}
 */
function redactText(s, rules = defaultRules()) {
  const counts = {};
  let text = pass(String(s), rules, counts);
  const dec = decodeVariant(text);
  if (dec !== text) {
    const c2 = {};
    const t2 = pass(dec, rules, c2);
    const n2 = Object.values(c2).reduce((a, b) => a + b, 0);
    if (n2 > 0) {
      text = t2;
      for (const [k, v] of Object.entries(c2)) counts[k] = (counts[k] || 0) + v;
    }
  }
  return { text, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

module.exports = { redactText, defaultRules, decodeVariant, tag };
