'use strict';
/*
 * personal-data-redact.js — in-place personal-data redactor (library).
 * Replaces every hit of personal-data-patterns.js with its placeholder:
 * $HOME, <user>, <host>, <private-ip>, <redacted-secret>. CLI: scripts/redact-personal.js.
 * Writes go through a tmp file in the same directory and a rename, never an in-place overwrite.
 * Not wired to any evidence writer at this step (that is the P2 job).
 */
const fs = require('fs');
const path = require('path');
const patterns = require('./personal-data-patterns');

function redactText(text) {
  return patterns.redact(text);
}

function isBinary(buf) {
  return buf.includes(0);
}

/**
 * Process one file. mode: 'write' | 'check' | 'dry-run' ('check' and 'dry-run' never write).
 * @returns {{file:string,skipped?:string,hits:number,byCategory:Object,changed:boolean}}
 */
function redactFile(file, mode) {
  const buf = fs.readFileSync(file);
  if (isBinary(buf)) return { file, skipped: 'binary', hits: 0, byCategory: {}, changed: false };
  const { text, hits } = redactText(buf.toString('utf8'));
  const byCategory = {};
  for (const h of hits) byCategory[h.category] = (byCategory[h.category] || 0) + 1;
  const changed = hits.length > 0;
  if (changed && mode === 'write') {
    const st = fs.statSync(file);
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.redact-${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmp, text, { mode: st.mode & 0o7777 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* nothing to clean */ }
      throw e;
    }
  }
  return { file, hits: hits.length, byCategory, changed };
}

module.exports = { redactText, redactFile };
