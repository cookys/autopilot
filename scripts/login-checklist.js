#!/usr/bin/env node
'use strict';
/**
 * login-checklist.js - print the operator's one-time login checklist for Claude login profiles.
 *
 *   node scripts/login-checklist.js --hosts <file> [--json]
 *
 * Hosts file (JSON array, strict; unknown keys, bad names, empty lists and a repeated subscription in one OS account are rejected):
 *   [{"host":"cookys-aimax395","os_account":"team","profiles":["singularaion","stranity"]}]
 * `profiles` entries use the profile-name grammar of profile-health.js (letters, digits, . _ -; max 64; starts with a letter or digit).
 * `home` (the native ~/.claude) is allowed: it needs no directory and no relogin, so it yields a note and no step.
 * One (host, os_account) pair appears once; the same subscription twice under one OS account is refused (two dirs of one subscription overwrite each other).
 *
 * Per host x OS account x profile it prints numbered steps, each starting "在 <host>、OS 帳號 <user>：".
 * It only prints: it never runs claude and never reads any credential or ~/.claude file. Exit 0 ok, 2 usage / invalid hosts file.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEYS = ['host', 'os_account', 'profiles'];

function validate(list) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('hosts file must be a non-empty JSON array');
  const seen = new Set();
  const subs = new Map();
  list.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${at}: must be an object`);
    for (const k of Object.keys(e)) if (!KEYS.includes(k)) throw new Error(`${at}: unknown key ${JSON.stringify(k)}`);
    for (const k of ['host', 'os_account']) if (typeof e[k] !== 'string' || !NAME.test(e[k])) throw new Error(`${at}: bad ${k} ${JSON.stringify(e[k])}`);
    if (!Array.isArray(e.profiles) || e.profiles.length === 0) throw new Error(`${at}: profiles must be a non-empty array`);
    const pair = `${e.host}\u0000${e.os_account}`;
    if (seen.has(pair)) throw new Error(`${at}: host ${e.host} OS account ${e.os_account} listed twice`);
    seen.add(pair);
    const s = new Set();
    for (const p of e.profiles) {
      if (typeof p !== 'string' || !NAME.test(p)) throw new Error(`${at}: bad profile name ${JSON.stringify(p)}`);
      if (s.has(p)) throw new Error(`${at}: subscription ${p} twice in OS account ${e.os_account} on ${e.host}`);
      s.add(p);
    }
    subs.set(pair, s);
  });
  return list;
}

function build(list) {
  const out = [];
  for (const e of list) {
    for (const p of e.profiles) {
      const where = `在 ${e.host}、OS 帳號 ${e.os_account}：`;
      if (p === 'home') { out.push({ host: e.host, os_account: e.os_account, profile: p, note: `${where}home 是這個帳號原本的 ~/.claude 登入，不需要建目錄、不需要重新登入。`, steps: [] }); continue; }
      const pre = `CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/${p}" `;
      const steps = [
        `${where}開一個終端機。`,
        `${where}輸入：node ~/projects/autopilot/scripts/profile-link.js apply --profile ${p}`,
        `${where}輸入：${pre}claude auth login --claudeai`,
        `${where}在瀏覽器用 ${p} 這個訂閱登入（憑證只由你輸入）。`,
        `${where}輸入：${pre}claude auth status --text`,
        `${where}輸入：node ~/projects/autopilot/scripts/profile-health.js check`,
      ];
      out.push({ host: e.host, os_account: e.os_account, profile: p, note: null, steps });
    }
  }
  return out;
}

function render(items) {
  const lines = [];
  for (const it of items) {
    lines.push(`## ${it.host} / ${it.os_account} / ${it.profile}`);
    if (it.note) lines.push(it.note);
    it.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  return lines.join('\n');
}

function main(argv) {
  const hi = argv.indexOf('--hosts');
  const extra = argv.filter((a, i) => a !== '--json' && a !== '--hosts' && i !== hi + 1);
  if (hi < 0 || !argv[hi + 1] || extra.length) { process.stderr.write('usage: login-checklist.js --hosts <file> [--json]\n'); return 2; }
  let items;
  try { items = build(validate(JSON.parse(fs.readFileSync(argv[hi + 1], 'utf8')))); } catch (e) { process.stderr.write(`login-checklist: ${e.message}\n`); return 2; }
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(items, null, 2)}\n` : `${render(items)}\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { validate, build, render };
