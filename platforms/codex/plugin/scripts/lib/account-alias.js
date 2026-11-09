'use strict';

// scripts/lib/account-alias.js — the account value written to the dispatch usage ledger and costs.jsonl.
// Same rule as codeforge src/usage/alias.rs account_from. Only a hash is ever returned: never the email, never
// the organization uuid (not in logs or errors either). sha8 = first 8 lowercase hex chars of sha256.
//
// Claude family runner, first match wins:
//   1. AUTOPILOT_ACCOUNT matching ^[a-z0-9-]{1,24}$ -> the value as is (an invalid value falls to the next tier)
//   2. acct-<sha8(organizationUuid + "\n" + emailAddress)>, raw UTF-8, no trim, no case fold, from
//      <CLAUDE_CONFIG_DIR>/.claude.json (CLAUDE_CONFIG_DIR set and non-empty) else ~/.claude.json,
//      fields oauthAccount.organizationUuid and oauthAccount.emailAddress; either missing or empty -> next tier
//   3. acct-<sha8(realpath(config dir))>, config dir = CLAUDE_CONFIG_DIR (non-empty) else ~/.claude; a path that
//      does not exist is hashed as the raw string
// codex: codex-<sha8(realpath(CODEX_HOME or ~/.codex))>; the directory must exist, else null.
//
// Node >= 20.10, built-ins only.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OVERRIDE_RE = /^[a-z0-9-]{1,24}$/;

const sha8 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
const nonEmpty = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const homeOf = (env) => nonEmpty(env && env.HOME) || os.homedir();

function overrideTier(env) {
  const v = env && env.AUTOPILOT_ACCOUNT;
  return typeof v === 'string' && OVERRIDE_RE.test(v) ? v : null;
}

function identityTier(env) {
  try {
    const dir = nonEmpty(env && env.CLAUDE_CONFIG_DIR);
    const file = dir ? path.join(dir, '.claude.json') : path.join(homeOf(env), '.claude.json');
    const oa = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount;
    const org = oa && nonEmpty(oa.organizationUuid);
    const email = oa && nonEmpty(oa.emailAddress);
    return org && email ? `acct-${sha8(`${org}\n${email}`)}` : null;
  } catch (_) { return null; }
}

function realpathOrRaw(p) {
  try { return fs.realpathSync(p); } catch (_) { return p; }
}

function configDirTier(env) {
  const dir = nonEmpty(env && env.CLAUDE_CONFIG_DIR) || path.join(homeOf(env), '.claude');
  return `acct-${sha8(realpathOrRaw(dir))}`;
}

// Pure helper: the codex alias of an already-resolved directory path.
const codexAliasOfPath = (p) => `codex-${sha8(p)}`;

// Cached per (env fingerprint) so a hook that resolves on every Stop reads .claude.json once per process.
const cache = new Map();
function claudeAccount(env) {
  const e = env || process.env;
  const key = [e.AUTOPILOT_ACCOUNT, e.CLAUDE_CONFIG_DIR, e.HOME].join('\u0000');
  if (!cache.has(key)) cache.set(key, overrideTier(e) || identityTier(e) || configDirTier(e));
  return cache.get(key);
}

function codexAccount(env) {
  const e = env || process.env;
  const dir = nonEmpty(e.CODEX_HOME) || path.join(homeOf(e), '.codex');
  try {
    return fs.statSync(dir).isDirectory() ? codexAliasOfPath(fs.realpathSync(dir)) : null;
  } catch (_) { return null; }
}

module.exports = { sha8, claudeAccount, codexAccount, codexAliasOfPath };
