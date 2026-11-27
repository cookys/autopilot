#!/usr/bin/env node
'use strict';
// Tier-0 sweep of leftover test temp dirs: removes <root>/autopilot-test-* directories
// (one level directly under root, default $HOME/.tmp) whose mtime is older than --min-age
// minutes (default 60). Uses fs.rmSync, never a shell find/rm. Symlinks are unlinked, not followed.
// Usage: sweep-test-tmp.js [--dry] [--root DIR] [--min-age MIN]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'autopilot-test-';

function sweep({ root, minAgeMin = 60, dry = false, now = Date.now() }) {
  const cutoff = now - minAgeMin * 60 * 1000;
  const hits = fs.readdirSync(root)
    .filter((n) => n.startsWith(PREFIX))
    .map((n) => path.join(root, n))
    .filter((p) => { try { return fs.lstatSync(p).mtimeMs < cutoff; } catch { return false; } });
  let removed = 0; let failed = 0;
  if (!dry) {
    for (const p of hits) {
      if (path.dirname(p) !== root) continue;
      try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { failed++; }
    }
  }
  return { matched: hits.length, removed, failed, dry };
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const val = (f, d) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : d; };
  const root = path.resolve(val('--root', path.join(os.homedir(), '.tmp')));
  const r = sweep({ root, minAgeMin: Number(val('--min-age', 60)), dry: a.includes('--dry') });
  console.log(`sweep-test-tmp root=${root} matched=${r.matched} removed=${r.removed} failed=${r.failed}${r.dry ? ' (dry)' : ''}`);
}
module.exports = { sweep, PREFIX };
