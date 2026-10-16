'use strict';
let calls = 0;
// stand-in transport: fails twice, then succeeds
function rawGet(url) { calls += 1; if (calls % 3 !== 0) throw new Error('ECONNRESET'); return { url, ok: true }; }
function fetchJson(url) { return rawGet(url); }
module.exports = { fetchJson, rawGet };
