#!/usr/bin/env node
'use strict';
// Align explicitly supplied profile settings; --targets accepts the same nested target table.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const TARGETS = { pm: 200000, lead: 250000, worker: 300000, family: { fable: 250000, opus: 250000, sonnet: 300000, haiku: 300000 } };
const familyOf = (m) => (typeof m === 'string' ? ['fable', 'opus', 'sonnet', 'haiku'].find((f) => m.toLowerCase().includes(f)) : undefined);
const args = process.argv.slice(2);
function value(flag) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }
function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function shellQuote(s) { return `'${s.replace(/'/g, "'\\''")}'`; }
try {
  const allowed = new Set(['--profiles', '--targets', '--check', '--apply', '--yes-go']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`unknown argument ${args[i]}`);
    if (['--profiles', '--targets', '--yes-go'].includes(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`missing value for ${args[i]}`);
      i++;
    }
  }
  const apply = args.includes('--apply');
  if (!value('--profiles') || (apply && args.includes('--check')) || (apply && !value('--yes-go')?.trim())) throw new Error('usage: --profiles FILE [--targets FILE] [--check | --apply --yes-go ID]');
  const profiles = JSON.parse(fs.readFileSync(value('--profiles'), 'utf8'));
  const targets = value('--targets') ? JSON.parse(fs.readFileSync(value('--targets'), 'utf8')) : TARGETS;
  if (!Array.isArray(profiles)) throw new Error('profiles must be an array');
  const rows = profiles.map(p => {
    if (!p || typeof p.host !== 'string' || typeof p.profile !== 'string' || typeof p.settings_path !== 'string' || !['pm', 'lead', 'worker'].includes(p.kind)) throw new Error('invalid profile');
    // pm keeps its own fixed window; otherwise the model family (a full id like claude-opus-5-5 counts) decides, else the kind default
    const expected = p.kind === 'pm' ? targets.pm : (targets.family || {})[familyOf(p.model)] ?? targets[p.kind];
    if (!Number.isFinite(expected) || expected <= 0) throw new Error(`missing target for ${p.kind}/${p.model || ''}`);
    let content, data, status, current;
    try { content = fs.readFileSync(p.settings_path); } catch (e) { if (e.code === 'ENOENT') return { p, expected, status: 'absent' }; return { p, expected, status: 'unreadable' }; }
    try { data = JSON.parse(content); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); } catch { return { p, expected, status: 'unreadable' }; }
    current = data.autoCompactWindow;
    status = !Object.hasOwn(data, 'autoCompactWindow') ? 'unset' : current === expected ? 'ok' : 'diverged';
    return { p, expected, status, current, content, data };
  });
  console.log('host\tprofile\tkind\tcurrent\texpected\tstatus');
  for (const r of rows) console.log([r.p.host, r.p.profile, r.p.kind, r.status === 'unset' || r.status === 'absent' || r.status === 'unreadable' ? '-' : JSON.stringify(r.current), r.expected, r.status].join('\t'));
  const changes = rows.filter(r => r.status === 'diverged' || r.status === 'unset');
  if (!apply) process.exit(changes.length ? 1 : 0);
  if (!changes.length) console.log('already_aligned');
  for (const r of changes) {
    const backup = path.join(path.dirname(r.p.settings_path), `settings.json.bak.${Date.now()}`);
    fs.copyFileSync(r.p.settings_path, backup, fs.constants.COPYFILE_EXCL);
    const originalHash = hash(r.content);
    if (hash(fs.readFileSync(backup)) !== originalHash || hash(fs.readFileSync(r.p.settings_path)) !== originalHash) throw new Error('backup or source verification failed');
    const before = { ...r.data }; delete before.autoCompactWindow;
    const updated = { ...r.data, autoCompactWindow: r.expected };
    const other = { ...updated }; delete other.autoCompactWindow;
    if (!isDeepStrictEqual(before, other)) throw new Error('other fields changed before write');
    fs.writeFileSync(r.p.settings_path, `${JSON.stringify(updated, null, 2)}\n`);
    const after = JSON.parse(fs.readFileSync(r.p.settings_path, 'utf8')); delete after.autoCompactWindow;
    if (!isDeepStrictEqual(before, after)) throw new Error('other fields changed after write');
    console.log(`audit\t${r.p.host}\t${r.p.profile}\t${r.status === 'unset' ? 'unset' : JSON.stringify(r.current)}\t${r.expected}\t${backup}\t${originalHash.slice(0, 16)}`);
    console.log(`rollback\tcp -- ${shellQuote(backup)} ${shellQuote(r.p.settings_path)}`);
  }
} catch (e) { console.error(`align-autocompact: ${e.message}`); process.exit(2); }
