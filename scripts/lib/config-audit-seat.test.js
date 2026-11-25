'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('./config-audit');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seat-'));
const file = path.join(dir, 'config.json');
function check(pct, seat, env = {}) {
  fs.writeFileSync(file, JSON.stringify({ context_budget: { t2_pct_by_seat: { pm: pct } } }));
  return audit({ configFile: file, home: dir, env, seat, contextWindow: 1000000, resolve: () => ({ configured: seat === 'pm' ? 200000 : 283000 }) }).findings.find(f => f.rule === 't2_gap_over_window');
}
assert.equal(check(11, 'pm'), undefined);
assert.match(check(20, 'pm').detail, /seat pm 20% of 1000000/);
assert.match(check(25, 'pm').detail, /seat pm 25% of 1000000/);
assert.equal(check(20, undefined), undefined);
assert.equal(check(20, 'pm', { AUTOPILOT_CONTEXT_BUDGET_T2: '100000' }), undefined);
console.log('PASS config-audit seat: 5 cases');
