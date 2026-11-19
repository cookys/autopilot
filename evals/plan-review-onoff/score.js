#!/usr/bin/env node
'use strict';
// usage: node score.js <task-id> <plan.md>  -> JSON {defects:{D1,D2,D3}, defect_score, quality:{...}, quality_score}
// Deterministic regex checks from defects.json; no model involved. Case-insensitive, multiline.
const fs = require('fs');
const path = require('path');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'defects.json'), 'utf8'));
function check(c, text) {
  const re = (s, f = 'im') => new RegExp(s, f);
  if (c.all && !c.all.every((s) => re(s).test(text))) return false;
  if (c.any && !c.any.some((s) => re(s).test(text))) return false;
  if (c.none && c.none.some((s) => re(s).test(text))) return false;
  if (c.min_matches) {
    const m = text.match(re(c.min_matches[0], 'img'));
    if (!m || m.length < c.min_matches[1]) return false;
  }
  return true;
}
function score(task, text) {
  const defs = { ...spec.shared, ...spec[task] };
  const defects = {};
  for (const [id, c] of Object.entries(defs)) defects[id] = check(c, text);
  const quality = {};
  for (const [id, c] of Object.entries(spec.quality)) quality[id] = check(c, text);
  const n = (o) => Object.values(o).filter(Boolean).length;
  return { defects, defect_score: n(defects), quality, quality_score: n(quality) };
}
module.exports = { score };
if (require.main === module) {
  const [task, file] = process.argv.slice(2);
  console.log(JSON.stringify(score(task, fs.readFileSync(file, 'utf8'))));
}
