const test = require('node:test'); const assert = require('node:assert');
const { syncOnce } = require('../src/sync/worker');
test('pushes', async () => { let n = 0; await syncOnce({ push: async () => { n++; } }, [1]); assert.equal(n, 1); });
