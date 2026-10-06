'use strict';
const jobs = require('./jobs');
function runAll() {
  const out = [];
  for (const j of jobs.list()) out.push(j.name + ': ' + j.run());
  return out;
}
module.exports = { runAll };
