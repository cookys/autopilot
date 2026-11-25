'use strict';
const assert=require('node:assert/strict');const {checkPool}=require('./replay-pool');
let count=0;function test(n,f){f();count++;console.log('PASS '+n);}
test('empty or absent whitelist fails closed',()=>{assert.equal(checkPool({pool_whitelist:[]},'a').ok,false);assert.equal(checkPool({},'a').ok,false);assert.equal(checkPool(null,'a').ok,false);});
test('missing and unlisted pools rejected',()=>{assert.equal(checkPool({pool_whitelist:['a']},' ').ok,false);assert.equal(checkPool({pool_whitelist:['a']},'b').ok,false);});
test('listed pool accepted',()=>assert.deepEqual(checkPool({pool_whitelist:['a']},'a'),{ok:true}));
console.log(`${count} cases`);
