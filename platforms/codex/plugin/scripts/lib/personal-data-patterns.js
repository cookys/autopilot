'use strict';
/*
 * personal-data-patterns.js — one pattern engine for personal data that must not enter a
 * tracked file. Shared by scripts/leak-guard.js (blocks) and scripts/lib/personal-data-redact.js
 * (rewrites). Node built-ins only.
 *
 * Categories (also the category names a leak-guard registry entry uses):
 *   home_path       /home/<user>, /Users/<user>   (user name must not start with ".")
 *   tmp_claude_path /tmp/claude-<digits>
 *   run_user_path   /run/user/<digits>
 *   host            local hostname + the fleet host list (scripts/lib/leak-guard-hosts.json).
 *                   Ordinary words (pico, cuda, gentoo) count ONLY in a host context:
 *                   "@name", "ssh name", "name:" not followed by a digit, "/name/" not under
 *                   local|opt|lib|usr|share, "name.local", "cookys-name".
 *   private_ip      10/8, 172.16/12, 192.168/16, 100.64/10
 *   secret          the credential prefixes of hooks/_shared/secret-patterns.js (reused, not copied)
 *   env_file        a file NAMED ".env" or "*.env" (file-name check, see isEnvFileName)
 *
 * There is deliberately no benign-list here: a false positive is handled by a per-file
 * registry entry in leak-guard, never by teaching this module to look away.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const secrets = require('../../hooks/_shared/secret-patterns');

const CATEGORIES = ['home_path', 'tmp_claude_path', 'run_user_path', 'host', 'private_ip', 'secret', 'env_file'];

const PLACEHOLDER = {
  home_path: '$HOME',
  tmp_claude_path: ['', 'tmp', 'claude-<user>'].join('/'), // the text a redacted path becomes, not a temp-root use
  run_user_path: '/run/user/<user>',
  host: '<host>',
  private_ip: '<private-ip>',
  secret: '<redacted-secret>',
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadHosts() {
  const file = path.join(__dirname, 'leak-guard-hosts.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8')); // throws when missing or malformed: fail closed
  if (!Array.isArray(j.strong) || !Array.isArray(j.contextual)) throw new Error(`${file}: need "strong" and "contextual" arrays`);
  const strong = j.strong.slice();
  const local = os.hostname().split('.')[0];
  if (local.length >= 4 && local.toLowerCase() !== 'localhost') strong.push(local);
  return { strong: [...new Set(strong)], contextual: j.contextual };
}

function isPrivateIp(s) {
  const o = s.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return false;
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
  return false;
}

let CACHE = null;
function rules() {
  if (CACHE) return CACHE;
  const { strong, contextual } = loadHosts();
  const S = strong.map(escapeRe).join('|');
  const C = contextual.map(escapeRe).join('|');
  const list = [
    { kind: 'home_path', category: 'home_path', re: /(?<![A-Za-z0-9_.-])\/(?:home|Users)\/(?!\.)[A-Za-z0-9_][A-Za-z0-9._-]*/g },
    { kind: 'tmp_claude_path', category: 'tmp_claude_path', re: /(?<![A-Za-z0-9_.-])\/tmp\/claude-\d+/g },
    { kind: 'run_user_path', category: 'run_user_path', re: /(?<![A-Za-z0-9_.-])\/run\/user\/\d+/g },
    { kind: 'host_strong', category: 'host', re: new RegExp(`(?<![A-Za-z0-9_])(?:${S})(?![A-Za-z0-9_])`, 'gi') },
    // contextual names: case-sensitive lowercase, so the GPU "CUDA" never matches
    { kind: 'host_at', category: 'host', re: new RegExp(`(?<=@)(?:${C})(?![A-Za-z0-9_-])`, 'g') },
    { kind: 'host_ssh', category: 'host', re: new RegExp(`(?<=\\bssh\\s+(?:[\\w.-]+@)?)(?:${C})(?![A-Za-z0-9_-])`, 'g') },
    { kind: 'host_colon', category: 'host', re: new RegExp(`(?<![A-Za-z0-9_./-])(?:${C})(?=:(?!\\d))`, 'g') },
    { kind: 'host_seg', category: 'host', re: new RegExp(`(?<!(?:local|opt|lib|usr|share)\\/)(?<=\\/)(?:${C})(?=\\/)`, 'g') },
    { kind: 'host_dotlocal', category: 'host', re: new RegExp(`(?<![A-Za-z0-9_./-])(?:${C})(?=\\.local\\b)`, 'g') },
    { kind: 'host_cookys', category: 'host', re: new RegExp(`(?<![A-Za-z0-9_])cookys-(?:${C})(?![A-Za-z0-9_])`, 'g') },
    { kind: 'private_ip', category: 'private_ip', re: /(?<![0-9.])(?:\d{1,3}\.){3}\d{1,3}(?![0-9]|\.\d)/g, accept: isPrivateIp },
  ];
  for (const { name, pattern } of secrets.patterns) {
    list.push({ kind: `secret:${name}`, category: 'secret', re: new RegExp(pattern.source, 'g') });
  }
  CACHE = list;
  return list;
}

/**
 * Find every personal-data hit in a text. Overlaps are resolved: the earliest start wins,
 * then the longest, so a hit is reported and replaced exactly once.
 * @returns {Array<{category:string,kind:string,index:number,length:number,match:string}>}
 */
function findAll(text) {
  const raw = [];
  for (const r of rules()) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text)) !== null) {
      if (m[0].length === 0) { r.re.lastIndex += 1; continue; }
      if (r.accept && !r.accept(m[0])) continue;
      raw.push({ category: r.category, kind: r.kind, index: m.index, length: m[0].length, match: m[0] });
    }
  }
  raw.sort((a, b) => a.index - b.index || b.length - a.length);
  const out = [];
  let end = -1;
  for (const h of raw) {
    if (h.index < end) continue;
    out.push(h);
    end = h.index + h.length;
  }
  return out;
}

/** Replace every hit with its placeholder. */
function redact(text) {
  const hits = findAll(text);
  let out = '';
  let pos = 0;
  for (const h of hits) {
    out += text.slice(pos, h.index) + PLACEHOLDER[h.category];
    pos = h.index + h.length;
  }
  out += text.slice(pos);
  return { text: out, hits };
}

/** ".env" or "*.env" by base name. */
function isEnvFileName(p) {
  const base = String(p).split('/').pop();
  return base === '.env' || base.endsWith('.env');
}

module.exports = { CATEGORIES, PLACEHOLDER, findAll, redact, isEnvFileName, isPrivateIp };
