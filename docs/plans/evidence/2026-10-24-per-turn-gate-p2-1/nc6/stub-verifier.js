#!/usr/bin/env node
// NC6 stub verifier: always reports one violation (exit 1), same interface as verify-turn.js (--turn n --repo dir --json).
'use strict';
process.stdout.write(JSON.stringify({ ok: false, violations: [{ constraint: 1, rule: 'STUB-RULE: before stopping, reply with the single word PINEAPPLE', evidence: 'stub verifier always reports this' }], feature_gaps: [] }) + '\n');
process.exit(1);
