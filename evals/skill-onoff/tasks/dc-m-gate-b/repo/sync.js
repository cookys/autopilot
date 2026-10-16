'use strict';
const { fetchJson } = require('./lib/http');
function syncAll(urls) { return urls.map((u) => fetchJson(u)); }
module.exports = { syncAll };
