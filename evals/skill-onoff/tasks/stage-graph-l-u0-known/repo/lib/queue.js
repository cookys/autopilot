'use strict';
const jobs = [];
function push(job) { jobs.push({ attempts: 0, ...job }); }
function next() { return jobs.shift(); }
function size() { return jobs.length; }
module.exports = { push, next, size };
