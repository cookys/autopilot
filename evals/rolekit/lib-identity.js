'use strict';
// lib-identity.js -- identity of the tested artifact. The G6 evidence is only valid for the exact bytes it was collected
// from, so the collector derives this itself (nobody types it) and the scorer recomputes it from the tree it is scoring.
// Identity = sha256 over "relative path TAB sha256(content)" lines of every file under the rolekit root, sorted, including
// the tests. Excluded: prereg/FROZEN.json, prereg/receipt-*.json, prereg/preconditions-*.json (stamping writes them after
// the code is final; stamp-rolekit.js --check covers them) and node_modules/.git. Symlinks are refused. Write evidence and
// results OUTSIDE the root: a file added under the root changes the identity.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXCLUDED = (rel) => rel === 'prereg/FROZEN.json' || /^prereg\/(receipt|preconditions)-[a-z0-9-]+\.json$/.test(rel);

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error(`symlink in the tested tree: ${r}`);
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else if (!EXCLUDED(r)) out.push(r);
  }
  return out;
}

function artifactIdentity(root) {
  const files = walk(root);
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(`${f}\t${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')}\n`);
  return { sha256: h.digest('hex'), files: files.length };
}

const testFiles = (root) => fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.js')).sort();

module.exports = { artifactIdentity, testFiles };
