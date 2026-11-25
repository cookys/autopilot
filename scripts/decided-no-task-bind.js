#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

try {
  const args = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--records', '--mapping', '--now', '--who', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(opts, args[i])) throw Error(`invalid argument: ${args[i]}`);
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--mapping']) throw Error('--mapping is required');
  const recordsDir = fs.realpathSync(opts['--records'] || '/srv/pm-ro/ledger/records');
  const now = new Date(opts['--now'] || Date.now()).toISOString();
  const who = opts['--who'] || 'autopilot--claude';
  if (/[\t\r\n]/.test(who)) throw Error('invalid who');
  const records = new Map();
  for (const name of fs.readdirSync(recordsDir).sort()) {
    if (!/^[0-9A-Z]{26}\.md$/.test(name)) continue;
    const text = fs.readFileSync(path.join(recordsDir, name), 'utf8');
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    const fm = {};
    for (const line of (fmMatch?.[1] || '').split('\n')) {
      const pos = line.indexOf(': '); if (pos !== -1) fm[line.slice(0, pos)] = line.slice(pos + 2);
    }
    if (!Object.hasOwn(fm, 'created')) continue;
    const source = text.match(/^source: (.*)$/m)?.[1] || '';
    const id = fm.id || name.slice(0, -3);
    if (records.has(id)) throw Error(`duplicate record id: ${id}`);
    const missing = fm.kind === 'decision' && Date.parse(fm.created) >= Date.parse('2026-11-14T18:25:00Z') && !/(?<![-\w])task:([0-9A-Z]{26})/.test(text) && !text.includes('no-task:') && !/\bcard d-[0-9a-f]{8}/.test(source) && !source.startsWith('history-claim');
    records.set(id, missing);
  }
  const mapping = JSON.parse(fs.readFileSync(opts['--mapping'], 'utf8'));
  if (!Array.isArray(mapping.entries)) throw Error('mapping entries must be an array');
  const seen = new Set(), errors = [];
  for (const e of mapping.entries) {
    if (!e || typeof e.id !== 'string' || seen.has(e.id)) { errors.push('error: invalid or duplicate id'); continue; }
    seen.add(e.id);
    const hasTask = Object.hasOwn(e, 'task'), hasReason = Object.hasOwn(e, 'no_task');
    if (hasTask === hasReason || (hasTask && (typeof e.task !== 'string' || !/^[0-9A-Z]{26}$/.test(e.task))) || (hasReason && (typeof e.no_task !== 'string' || !e.no_task.trim() || /[\t\r\n]/.test(e.no_task)))) errors.push(`error: invalid mapping for ${e.id}`);
    if (!records.has(e.id)) errors.push(`unknown: ${e.id}`);
  }
  if (errors.length) throw Error(errors.join('\n'));
  const missing = [...records].filter(([, value]) => value).map(([id]) => id);
  const covered = new Set(), proposals = [], audits = [];
  for (const e of mapping.entries) {
    if (!records.get(e.id)) { console.log(`already_bound: ${e.id}`); continue; }
    const value = e.task || e.no_task;
    proposals.push(`${e.id}\t${e.task ? 'task' : 'no-task'}:${value}`);
    audits.push(`audit\t${e.id}\t${who}\t${now}\t${value}`);
    covered.add(e.id);
  }
  const uncovered = missing.filter(id => !covered.has(id));
  console.log(`before: ${missing.length}\nafter: ${uncovered.length}\nuncovered: ${uncovered.join(', ')}`);
  for (const line of proposals) console.log(line);
  for (const line of audits) console.log(line);
  if (opts['--out']) {
    const out = path.resolve(opts['--out']);
    let ancestor = out;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, out));
    if (resolved === recordsDir || resolved.startsWith(recordsDir + path.sep)) throw Error('--out cannot be inside records');
    fs.mkdirSync(out, {recursive: true});
    for (const [name, lines] of [['proposal.tsv', proposals], ['audit.log', audits]]) {
      const target = path.join(out, name);
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error(`output is a symlink: ${target}`);
      fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '');
    }
  }
  process.exitCode = uncovered.length ? 1 : 0;
} catch (err) { console.error(`error: ${err.message}`); process.exitCode = 1; }
