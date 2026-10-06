'use strict';
const registry = new Map();
registry.set('lines', (text) => text.split('\n').filter(Boolean).map((l) => ({ line: l })));
function get(name) { return registry.get(name); }
function register(name, parser) { registry.set(name, parser); }
module.exports = { get, register };
