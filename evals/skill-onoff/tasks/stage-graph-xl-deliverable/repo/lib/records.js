'use strict';
const records = [
  { id: 1, name: 'alpha', value: 10 },
  { id: 2, name: 'beta', value: 20 },
  { id: 3, name: 'gamma', value: 30 },
];
function all() { return records.map((r) => ({ ...r })); }
function add(r) { records.push({ ...r }); return r; }
module.exports = { all, add };
