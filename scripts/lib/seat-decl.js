'use strict';
// Reader for hangar's seat-decl.tsv (the single source of seat facts). 14 tab-separated columns in a fixed order,
// "-" means unset, primary key is (host, seat). A wrong column count or a repeated key is an error, never a guess.
const fs = require('fs');

const COLUMNS = ['seat', 'host', 'os_account', 'harness', 'project_dir', 'model', 'pool', 'profile', 'perm',
  'operator_only', 'auto_compact', 'overlay', 'sid', 'lead'];

function parseSeatDecl(text, label = 'seat-decl.tsv') {
  const rows = [];
  const seen = new Map();
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trim() === '' || line.startsWith('#')) return;
    const cells = line.split('\t');
    if (cells.length !== COLUMNS.length) {
      throw new Error(`${label}:${i + 1}: expected ${COLUMNS.length} tab-separated columns, got ${cells.length}`);
    }
    const row = {};
    COLUMNS.forEach((name, k) => { row[name] = cells[k] === '-' ? null : cells[k]; });
    if (row.seat === null || row.host === null) throw new Error(`${label}:${i + 1}: seat and host are required`);
    const key = `${row.host}\u0000${row.seat}`;
    if (seen.has(key)) throw new Error(`${label}:${i + 1}: (host, seat) ${row.host}/${row.seat} repeats line ${seen.get(key)}`);
    seen.set(key, i + 1);
    rows.push(row);
  });
  return rows;
}

function readSeatDecl(file) {
  return parseSeatDecl(fs.readFileSync(file, 'utf8'), file);
}

// (host, os_account) -> sorted unique profiles: the shape scripts/login-checklist.js takes as input.
function loginEntries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.os_account === null || r.profile === null) continue;
    const key = `${r.host}\u0000${r.os_account}`;
    if (!map.has(key)) map.set(key, { host: r.host, os_account: r.os_account, profiles: new Set() });
    map.get(key).profiles.add(r.profile);
  }
  return [...map.values()].map((e) => ({ host: e.host, os_account: e.os_account, profiles: [...e.profiles].sort() }));
}

module.exports = { COLUMNS, parseSeatDecl, readSeatDecl, loginEntries };
