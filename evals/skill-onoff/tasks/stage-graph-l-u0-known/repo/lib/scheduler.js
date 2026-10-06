'use strict';
// Runs jobs from the queue. A failed job is currently dropped (no retry): see README.
const queue = require('./queue');
function runOnce(handler) {
  const job = queue.next();
  if (!job) return false;
  try { handler(job); } catch (err) { job.failed = true; }
  return true;
}
module.exports = { runOnce };
