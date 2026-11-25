'use strict';
const assert=require('node:assert/strict');const {createBudget,weightedCost}=require('./replay-budget');
let count=0;function test(n,f){f();count++;console.log('PASS '+n);}
test('weighted tokens',()=>assert.equal(weightedCost({read:10,cache_write_5m:4,cache_write_1h:3,input:2,output:2}),24));
test('reservations respect remaining budget including pending',()=>{const b=createBudget({total_limit:10,estimate:100});const t=b.reserve(7);assert.ok(t);assert.equal(b.reserve(4),null);b.settle(t,6);assert.equal(b.reserve(5),null);assert.ok(b.reserve(4));});
test('actual usage across retries and prefill halts permanently above estimate',()=>{const b=createBudget({total_limit:100,estimate:10});let t=b.reserve(10);b.settle(t,10);t=b.reserve(10);b.settle(t,6);assert.equal(b.report().halted,true);assert.equal(b.reserve(0),null);assert.throws(()=>b.settle(t,0));});
test('overspend and invalid values fail closed',()=>{const b=createBudget({total_limit:10,estimate:100});const t=b.reserve(1);b.settle(t,11);assert.equal(b.reserve(0),null);assert.throws(()=>b.reserve(-1));});
console.log(`${count} cases`);
