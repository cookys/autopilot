#!/usr/bin/env node
'use strict';
// Reads the local codex models cache (<CODEX_HOME>/models_cache.json).
//   codex-models-cache.js ids <cache>                  -> comma-joined model ids, or nothing
//   codex-models-cache.js substitute <model> <cache>   -> same-tier model id, or nothing
// Tier = the trailing name of `gpt-<version>-<tier>` (terra, luna, sol, astra ...); a
// substitute shares the tier and differs in version. Never crosses tiers. Output is
// restricted to safe model-id characters.
const fs = require('fs');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._\/:-]*$/;

function modelIds(cachePath) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { return []; }
  const list = Array.isArray(raw) ? raw : (raw && (Array.isArray(raw.models) ? raw.models : (Array.isArray(raw.data) ? raw.data : []))) || [];
  return list
    .map((e) => (typeof e === 'string' ? e : (e && (e.slug || e.id))))
    .filter((id) => typeof id === 'string' && SAFE_ID.test(id));
}

function tierOf(id) {
  const m = /^gpt-[0-9][0-9.]*-([a-z]+)$/i.exec(String(id));
  return m ? m[1].toLowerCase() : null;
}

function sameTierSubstitute(requested, cachePath) {
  const tier = tierOf(requested);
  if (!tier) return null;
  return modelIds(cachePath).find((id) => id !== requested && tierOf(id) === tier) || null;
}

module.exports = { modelIds, tierOf, sameTierSubstitute };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'ids') {
    const ids = modelIds(a || '');
    if (ids.length) process.stdout.write(ids.join(', '));
  } else if (cmd === 'substitute') {
    const sub = sameTierSubstitute(a || '', b || '');
    if (sub) process.stdout.write(sub);
  }
}
