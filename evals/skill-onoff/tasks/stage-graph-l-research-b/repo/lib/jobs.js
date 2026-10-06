'use strict';
const registry = [{ name: 'report', run: () => 'done' }];
function list() { return registry.slice(); }
module.exports = { list };
