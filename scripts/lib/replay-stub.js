'use strict';
const { createHash } = require('node:crypto');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function key(name, params) {
  return name + ':' + createHash('sha256').update(JSON.stringify(stable(params))).digest('hex');
}
// normalizers maps tool names to functions returning { params, expected_change }.
function createStub(recordings, { normalizers = {} } = {}) {
  const normalize = (name, params) => normalizers[name] ? normalizers[name](params) : { params, expected_change: false };
  const entries = recordings.map(r => ({ ...r, key: key(r.name, normalize(r.name, r.params).params), used: false }));
  let divergences = 0, expected_changes = 0;
  return {
    call(name, params) {
      const normalized = normalize(name, params);
      const k = key(name, normalized.params);
      const entry = entries.find(e => !e.used && e.key === k);
      if (!entry) {
        if (normalized.expected_change) expected_changes++; else divergences++;
        return { stub: 'no_recording' };
      }
      if (entries.find(e => !e.used) !== entry) divergences++;
      entry.used = true;
      return entry.result;
    },
    report() { return { divergences, expected_changes, unmatched_recordings: entries.filter(e => !e.used).length }; }
  };
}
module.exports = { createStub };
