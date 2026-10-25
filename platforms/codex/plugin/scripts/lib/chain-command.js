'use strict';
/**
 * chain-command — the ONE parser for a hooks.json command that runs hooks/post-tool-chain.js (BL-0241 guard port).
 *
 * Used by scripts/check-hook-inventory.js, scripts/hook-harness-matrix.js and src/engine/profile-payload.js, so
 * the three cannot disagree about which stems a chain registration hosts. Node built-ins only; scripts/ and src/
 * are both mirrored into the Codex package, so this file runs there too (hooks/ is not mirrored, so the member
 * list is NOT read here: callers that need it read hooks/post-tool-chain-lib.js, the single source of MEMBERS).
 *
 * parseChainCommand(cmd) -> null   when the executed script is not post-tool-chain.js
 *                        -> { members: [stem, ...] }  ordered, as written on the command line
 *                        -> throws Error              when it IS the chain but cannot be read with certainty
 *                           (unterminated quote, unquoted shell operator, no member named, bad member token).
 * It never falls back to a default member list: a chain command that cannot be parsed is an error, because a
 * silent default would credit hooks to the chain that the registration does not name.
 */
const path = require('path');

// POSIX-ish word splitting: whitespace separates words; '...' is literal; "..." honours \" \\ \$ \` ; a bare \x is x.
// Unquoted ; & | < > ` ( ) are flagged (a hook command with a pipe or redirect is not a plain argv).
function tokenize(cmd) {
  const tokens = [];
  let cur = null;
  let unsafe = false;
  const s = String(cmd);
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\'') {
      const j = s.indexOf('\'', i + 1);
      if (j < 0) throw new Error('unterminated single quote');
      cur = (cur || '') + s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      let acc = '';
      for (; j < s.length && s[j] !== '"'; j += 1) {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) j += 1;
        acc += s[j];
      }
      if (j >= s.length) throw new Error('unterminated double quote');
      cur = (cur || '') + acc;
      i = j;
    } else if (c === '\\') {
      if (i + 1 >= s.length) throw new Error('trailing backslash');
      i += 1;
      cur = (cur || '') + s[i];
    } else if (/\s/.test(c)) {
      if (cur !== null) { tokens.push(cur); cur = null; }
    } else {
      if (';&|<>`()'.includes(c)) unsafe = true;
      cur = (cur || '') + c;
    }
  }
  if (cur !== null) tokens.push(cur);
  return { tokens, unsafe };
}

const STEM = /^[A-Za-z0-9_-]+$/;

function parseChainCommand(cmd) {
  let parsed;
  try { parsed = tokenize(cmd); } catch (e) {
    // an unreadable command is only an error when it plausibly is the chain
    if (/post-tool-chain/.test(String(cmd))) throw new Error(`post-tool-chain command cannot be parsed (${e.message}): ${cmd}`);
    return null;
  }
  const { tokens, unsafe } = parsed;
  if (tokens.length === 0) return null;
  let at = 0;
  if (path.basename(tokens[0]) === 'node') {
    at = 1;
    while (at < tokens.length && tokens[at].startsWith('-')) at += 1;
  }
  if (at >= tokens.length || path.basename(tokens[at]) !== 'post-tool-chain.js') return null;
  if (unsafe) throw new Error(`post-tool-chain command uses shell syntax this parser does not interpret: ${cmd}`);
  const members = tokens.slice(at + 1);
  if (members.length === 0) throw new Error(`post-tool-chain command names no members (a registration must list them): ${cmd}`);
  for (const m of members) if (!STEM.test(m)) throw new Error(`post-tool-chain member token "${m}" is not a hook stem: ${cmd}`);
  return { members };
}

module.exports = { parseChainCommand, tokenize };
