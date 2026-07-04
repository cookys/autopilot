const assert = require('assert');
const { parseQuery } = require('../lib/buggy');

assert.deepStrictEqual(parseQuery('?foo=bar'), { foo: 'bar' });
assert.deepStrictEqual(parseQuery(''), {});

// Real bug triggers here
assert.deepStrictEqual(parseQuery('?flag&foo=bar'), { flag: true, foo: 'bar' });

console.log('test-buggy.js passed');
