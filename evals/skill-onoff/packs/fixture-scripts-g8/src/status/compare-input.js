'use strict';

// src/status/compare-input.js — compare-record/1 files of an execution root (mods P1W W2e-m).
// Directory: <git-common-dir>/autopilot/compare/<root_run_id>/*.json (mirror of work-orders/<root>/). The unbound scope
// reads nothing. Directory absent -> { provided: false, entries: [] }: the sources manifest decides what that means.
// Nothing writes there yet (W2e-g is a guidance row). Loading goes through the renderer's exported loadCompare.

const fs = require('fs');
const path = require('path');

const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;

function compareDir(commonDir, root) {
  return path.join(commonDir, 'autopilot', 'compare', root);
}

// signature: `<file>:<mtime>` of every .json, sorted; '' when none.
function readCompare({ commonDir, root }) {
  try {
    if (!commonDir || typeof root !== 'string' || !SAFE_ROOT.test(root) || root === '.' || root === '..') return { provided: false, entries: [], signature: [] };
    const dir = compareDir(commonDir, root);
    let names;
    try { names = fs.readdirSync(dir); } catch (_error) { return { provided: false, entries: [], signature: [] }; }
    const signature = names.filter((n) => n.endsWith('.json')).sort().map((n) => {
      let mtime = '-';
      try { mtime = String(fs.statSync(path.join(dir, n)).mtimeMs); } catch (_error) { /* raced away */ }
      return `${path.join(dir, n)}:${mtime}`;
    });
    const { loadCompare } = require('../../scripts/render-review-page');
    return { provided: true, entries: loadCompare(dir), signature };
  } catch (_error) {
    return { provided: false, entries: [], signature: [] };
  }
}

module.exports = { readCompare, compareDir };
