const assert = require('assert');
const { chunkArray } = require('../lib/chunk');

assert.deepStrictEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepStrictEqual(chunkArray([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
assert.deepStrictEqual(chunkArray([1, 2, 3], 5), [[1, 2, 3]]);
assert.deepStrictEqual(chunkArray([1], 1), [[1]]);

console.log('test-chunk.js passed');
