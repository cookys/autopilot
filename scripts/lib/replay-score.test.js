'use strict';
const assert = require('node:assert/strict');
const {scoreArm,compareArms} = require('./replay-score');
let count=0; function test(n,f){f();count++;console.log('PASS '+n);}
const ev=(extra={})=>({intents:[{action:'send',target:'a',params:{x:1}}],valid_answers:[{intents:[{target:'a',action:'send',params:{x:1}}]}],...extra});
test('exact intent sets and reply categories',()=>{assert.equal(scoreArm([ev(),ev({intents:[]}),ev({intents:[],reply_category:'answer',valid_answers:[{intents:[],reply_category:'answer'}]})]).agreement,2/3);});
test('frozen denominator includes divergence',()=>{assert.equal(scoreArm([ev(),ev({divergent:true})]).agreement,0.5);});
test('paired reversal is indeterminate',()=>{const b=scoreArm(Array.from({length:12},()=>ev()));const t=scoreArm([ev({divergent:true}),...Array.from({length:11},()=>ev())]);assert.equal(compareArms(b,t).verdict,'indeterminate');});
test('block and screening elimination',()=>{const b=scoreArm(Array.from({length:12},()=>ev()));const t=scoreArm([ev({intents:[]}),...Array.from({length:11},()=>ev())]);assert.equal(compareArms(b,t).verdict,'block');assert.equal(compareArms(b,t,{screening:true}).verdict,'eliminate');assert.equal(compareArms(b,b,{screening:true}).verdict,'inconclusive');});
test('invalid baseline and no paired observations',()=>{const b=scoreArm(Array.from({length:4},()=>ev({divergent:true})));assert.equal(compareArms(b,b).verdict,'baseline_invalid');assert.equal(compareArms(b,b,{screening:true}).verdict,'inconclusive');assert.equal(compareArms(b,b,{screening:true}).baseline_invalid,true);});
console.log(`${count} cases`);
