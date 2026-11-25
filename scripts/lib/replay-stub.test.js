'use strict';
const assert = require('node:assert/strict');
const { createStub } = require('./replay-stub');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
test('ordered duplicate results and canonical parameters', () => {
  const s = createStub([{name:'x',params:{a:1,b:2},result:'first'},{name:'x',params:{b:2,a:1},result:'second'}]);
  assert.equal(s.call('x',{b:2,a:1}), 'first'); assert.equal(s.call('x',{a:1,b:2}), 'second'); assert.equal(s.report().divergences,0);
});
test('out of order is divergent', () => {
  const s = createStub([{name:'a',params:{},result:1},{name:'b',params:{},result:2}]);
  assert.equal(s.call('b',{}),2); assert.equal(s.report().divergences,1); assert.equal(s.report().unmatched_recordings,1);
});
test('expected and unexpected misses are separate', () => {
  const s = createStub([], {normalizers:{x:p=>({params:p,expected_change:true})}});
  assert.deepEqual(s.call('x',{}),{stub:'no_recording'}); s.call('y',{}); assert.deepEqual(s.report(),{divergences:1,expected_changes:1,unmatched_recordings:0});
});
console.log(`${count} cases`);
