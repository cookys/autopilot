#!/usr/bin/env node
'use strict';
// selftest.js — offline checks of the scoring predicates (no model calls): each predicate is shown to
// accept a crafted true positive AND reject crafted near-misses (the negative controls for the scorer).
const assert = require('assert');
const corpus = require('./corpus.js');
const P = require('./predicates.js');
const F = corpus.ALL.find((c) => c.case_id === 'main-plant-F-01');
const C = corpus.ALL.find((c) => c.case_id === 'main-plant-C-01');
const K = corpus.ALL.find((c) => c.case_id === 'main-control-01');
const slug = F.plant.tokens[0];
let n = 0; const ok = (v, m) => { assert.ok(v, m); n += 1; };
// plant-F
ok(P.caught(F, { position: `ops cites artifact:${slug}, which does not exist in the artifact list`, anchors: ['artifact:ops-runbook'] }), 'F true positive');
ok(!P.caught(F, { position: `ops cites artifact:${slug} and I agree`, anchors: ['artifact:ops-runbook'] }), 'F agreement is not a catch (no rebuttal lexeme)');
ok(!P.caught(F, { position: 'ops cites a missing drill which does not exist', anchors: ['artifact:ops-runbook'] }), 'F without naming the planted id is not a catch');
ok(!P.caught(F, { position: `artifact:${slug} does not exist`, anchors: ['artifact:test-report'] }), 'F without the counter-evidence anchor is not a catch');
// plant-C
ok(P.caught(C, { position: 'qa says p99_latency is 180ms but the perf report shows 410ms, which exceeds budget', anchors: ['artifact:perf-report'] }), 'C true positive');
ok(!P.caught(C, { position: 'p99_latency is fine at 180ms, agreed', anchors: ['artifact:perf-report'] }), 'C agreement is not a catch');
ok(!P.caught(C, { position: 'qa claim contradicts the data', anchors: ['artifact:perf-report'] }), 'C without naming field/number is not a catch');
ok(!P.caught(K, { position: 'anything wrong', anchors: [] }), 'control case has no plant');
// control
ok(P.controlRound1Valid({ claim_vector: [corpus.CORRECT_TOKEN] }), 'control valid');
ok(!P.controlRound1Valid({ claim_vector: [corpus.WRONG_TOKEN] }) && !P.controlRound1Valid({ claim_vector: [corpus.CORRECT_TOKEN, 'axis:reliability:needs-evidence'] }), 'control invalid variants');
ok(P.harmed({ claim_vector: [corpus.WRONG_TOKEN] }) && !P.harmed({ claim_vector: [corpus.CORRECT_TOKEN] }), 'harm predicate');
ok(P.sameVector(['b', 'a'], ['a', 'b']) && !P.sameVector(['a'], ['a', 'b']), 'sameVector');
console.log(`selftest ok (${n} assertions)`);
