#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO_ROOT/hooks/tests/lib.sh"

OUT=$(node - "$REPO_ROOT" <<'NODE'
const REPO_ROOT = process.argv[2];
const eq = require(REPO_ROOT + '/scripts/engine-qualify.js');
const vs = require(REPO_ROOT + '/src/engine/verification-strength.js');
const fold = eq.foldPooledVerdict;
const wl = vs.wilsonLower;
const Z = eq.VERDICT_Z !== undefined ? eq.VERDICT_Z : 1.6448536269514722;
const TAU = eq.VERDICT_TAU !== undefined ? eq.VERDICT_TAU : 0.85;
let F = 0;
function ok(g, n) { console.log(g + '-OK ' + n); }
function fa(g, n, e, a) { console.log(g + '-FAIL ' + n + ' exp=' + JSON.stringify(e) + ' got=' + JSON.stringify(a)); F++; }
function eq_(g, n, a, e) { a === e ? ok(g, n) : fa(g, n, e, a); }
function cl(g, n, a, e, t) { Math.abs(a - e) < (t || 1e-12) ? ok(g, n) : fa(g, n, e, a); }
function mc(id, tier, out) {
  return { case_id: 'c' + id, outcome: out || (tier === 'pass' ? 'pass' : 'fail'), tier: tier };
}
function mr(s, sid) {
  var c = [], id = sid || 0;
  for (var i = 0; i < (s.p || 0); i++) c.push(mc(id++, 'pass'));
  for (var i = 0; i < (s.t2 || 0); i++) c.push(mc(id++, 'tier2', 'fail'));
  for (var i = 0; i < (s.t1 || 0); i++) c.push(mc(id++, 'tier1', 'fail'));
  for (var i = 0; i < (s.h || 0); i++) c.push(mc(id++, 'harness', 'infra_fail'));
  return c;
}
function cv(role, admins, fn) { return fold({ role: role, administrations: admins, fullN: fn }); }

// ===== GROUP SHAPE =====
var sr = cv('consult', [mr({p: 20}, 0)], 60);
eq_('SHAPE', 'keys', Object.keys(sr).sort().join(','), 'competence,pooled,qualified,stop_reason,tier1_terminated');
eq_('SHAPE', 'pooled.eligible_full_N', sr.pooled.eligible_full_N, 60);
eq_('SHAPE', 'competence.n', sr.competence.n, 60);
eq_('SHAPE', 'pooled.passes', sr.pooled.passes, 20);
cl('SHAPE', 'competence.z', sr.competence.z, Z, 1e-15);
cl('SHAPE', 'competence.tau', sr.competence.tau, TAU, 1e-15);
cl('SHAPE', 'wilson_lower', sr.competence.wilson_lower, wl(sr.pooled.passes, 60, Z), 1e-12);

// ===== GROUP CONTINUE =====
var r;
r = cv('consult', [mr({p: 20}, 0)], 60);
eq_('CONTINUE', 'consult-20p.stop_reason', r.stop_reason, 'continue');
eq_('CONTINUE', 'consult-20p.qualified', r.qualified, false);
eq_('CONTINUE', 'consult-20p.tier1_terminated', r.tier1_terminated, false);

r = cv('discuss', [mr({p: 16}, 0)], 48);
eq_('CONTINUE', 'discuss-16p.stop_reason', r.stop_reason, 'continue');
eq_('CONTINUE', 'discuss-16p.qualified', r.qualified, false);
eq_('CONTINUE', 'discuss-16p.tier1_terminated', r.tier1_terminated, false);

r = cv('consult', [mr({p: 19, t2: 1}, 0)], 60);
eq_('CONTINUE', 'consult-19p1t.stop_reason', r.stop_reason, 'continue');

r = cv('discuss', [mr({p: 15, t2: 1}, 0)], 48);
eq_('CONTINUE', 'discuss-15p1t.stop_reason', r.stop_reason, 'continue');

// ===== GROUP TIER1 =====
var run1, run2, run3;

run1 = [];
for (var i = 0; i < 19; i++) run1.push(mc(i, 'pass'));
run1.push(mc(19, 'tier1', 'fail'));
r = cv('consult', [run1], 60);
eq_('TIER1', 'first-run-last.qualified', r.qualified, false);
eq_('TIER1', 'first-run-last.stop_reason', r.stop_reason, 'tier1');
eq_('TIER1', 'first-run-last.tier1_terminated', r.tier1_terminated, true);

run1 = mr({p: 20}, 0);
run2 = [];
for (var i = 0; i < 7; i++) run2.push(mc(20 + i, 'pass'));
run2.push(mc(27, 'tier1', 'fail'));
for (var i = 0; i < 12; i++) run2.push(mc(28 + i, 'pass'));
r = cv('consult', [run1, run2], 60);
eq_('TIER1', 'second-run-mid.qualified', r.qualified, false);
eq_('TIER1', 'second-run-mid.stop_reason', r.stop_reason, 'tier1');
eq_('TIER1', 'second-run-mid.tier1_terminated', r.tier1_terminated, true);

run1 = [];
for (var i = 0; i < 18; i++) run1.push(mc(i, 'pass'));
run1.push(mc(18, 'harness', 'infra_fail'));
run1.push(mc(19, 'tier1', 'fail'));
r = cv('consult', [run1], 60);
eq_('TIER1', 'harness+tier1.qualified', r.qualified, false);
eq_('TIER1', 'harness+tier1.stop_reason', r.stop_reason, 'tier1');
eq_('TIER1', 'harness+tier1.tier1_terminated', r.tier1_terminated, true);

run1 = mr({p: 16}, 0);
run2 = [];
for (var i = 0; i < 15; i++) run2.push(mc(16 + i, 'pass'));
run2.push(mc(31, 'tier1', 'fail'));
r = cv('discuss', [run1, run2], 48);
eq_('TIER1', 'after-clean.qualified', r.qualified, false);
eq_('TIER1', 'after-clean.stop_reason', r.stop_reason, 'tier1');
eq_('TIER1', 'after-clean.tier1_terminated', r.tier1_terminated, true);

// ===== GROUP HARNESS =====
run1 = mr({p: 20}, 0);
run2 = [mc(20, 'harness', 'infra_fail')];
for (var i = 0; i < 19; i++) run2.push(mc(21 + i, 'pass'));
r = cv('consult', [run1, run2], 60);
eq_('HARNESS', 'passes', r.pooled.passes, 20);
eq_('HARNESS', 'stop_reason', r.stop_reason, 'continue');
eq_('HARNESS', 'qualified', r.qualified, false);

// ===== GROUP LOCKED_FAIL =====
r = cv('consult', [mr({p: 20}, 0), mr({p: 16, t2: 4}, 20)], 60);
eq_('LOCKED_FAIL', 'consult-M4.stop_reason', r.stop_reason, 'continue');
eq_('LOCKED_FAIL', 'consult-M4.qualified', r.qualified, false);

run1 = mr({p: 20}, 0);
run2 = mr({p: 20}, 20);
run3 = [];
for (var i = 0; i < 14; i++) run3.push(mc(40 + i, 'pass'));
for (var i = 0; i < 5; i++) run3.push(mc(54 + i, 'tier2', 'fail'));
run3.push(mc(59, 'pass'));
r = cv('consult', [run1, run2, run3], 60);
eq_('LOCKED_FAIL', 'consult-M5.stop_reason', r.stop_reason, 'locked_fail');
eq_('LOCKED_FAIL', 'consult-M5.qualified', r.qualified, false);
eq_('LOCKED_FAIL', 'consult-M5.passes', r.pooled.passes, 54);

r = cv('discuss', [mr({p: 16}, 0), mr({p: 13, t2: 3}, 16)], 48);
eq_('LOCKED_FAIL', 'discuss-M3.stop_reason', r.stop_reason, 'continue');
eq_('LOCKED_FAIL', 'discuss-M3.qualified', r.qualified, false);

run1 = mr({p: 16}, 0);
run2 = mr({p: 16}, 16);
run3 = [];
for (var i = 0; i < 11; i++) run3.push(mc(32 + i, 'pass'));
for (var i = 0; i < 4; i++) run3.push(mc(43 + i, 'tier2', 'fail'));
run3.push(mc(47, 'pass'));
r = cv('discuss', [run1, run2, run3], 48);
eq_('LOCKED_FAIL', 'discuss-M4.stop_reason', r.stop_reason, 'locked_fail');
eq_('LOCKED_FAIL', 'discuss-M4.qualified', r.qualified, false);
eq_('LOCKED_FAIL', 'discuss-M4.passes', r.pooled.passes, 43);

// ===== GROUP LOCKED_QUALIFY =====
r = cv('consult', [mr({p: 20}, 0), mr({p: 20}, 20), mr({p: 16}, 40)], 60);
eq_('LOCKED_QUALIFY', 'consult-P56.stop_reason', r.stop_reason, 'locked_qualify');
eq_('LOCKED_QUALIFY', 'consult-P56.qualified', r.qualified, true);

r = cv('consult', [mr({p: 20}, 0), mr({p: 20}, 20), mr({p: 15}, 40)], 60);
eq_('LOCKED_QUALIFY', 'consult-P55.stop_reason', r.stop_reason, 'continue');

r = cv('discuss', [mr({p: 16}, 0), mr({p: 16}, 16), mr({p: 13}, 32)], 48);
eq_('LOCKED_QUALIFY', 'discuss-P45.stop_reason', r.stop_reason, 'locked_qualify');
eq_('LOCKED_QUALIFY', 'discuss-P45.qualified', r.qualified, true);

r = cv('discuss', [mr({p: 16}, 0), mr({p: 16}, 16), mr({p: 12}, 32)], 48);
eq_('LOCKED_QUALIFY', 'discuss-P44.stop_reason', r.stop_reason, 'continue');

// ===== GROUP COMPLETE =====
run1 = [];
for (var i = 0; i < 4; i++) run1.push(mc(i, 'tier2', 'fail'));
for (var i = 0; i < 16; i++) run1.push(mc(4 + i, 'pass'));
r = cv('consult', [run1, mr({p: 20}, 20), mr({p: 20}, 40)], 60);
eq_('COMPLETE', 'consult-56p4t.qualified', r.qualified, true);
if (r.stop_reason === 'locked_qualify' || r.stop_reason === 'complete') ok('COMPLETE', 'consult-56p4t.stop_reason');
else fa('COMPLETE', 'consult-56p4t.stop_reason', 'locked_qualify|complete', r.stop_reason);

run1 = [];
for (var i = 0; i < 3; i++) run1.push(mc(i, 'tier2', 'fail'));
for (var i = 0; i < 13; i++) run1.push(mc(3 + i, 'pass'));
r = cv('discuss', [run1, mr({p: 16}, 16), mr({p: 16}, 32)], 48);
eq_('COMPLETE', 'discuss-45p3t.qualified', r.qualified, true);

run1 = mr({p: 16}, 0);
run2 = mr({p: 16}, 16);
run3 = [];
for (var i = 0; i < 12; i++) run3.push(mc(32 + i, 'pass'));
for (var i = 0; i < 4; i++) run3.push(mc(44 + i, 'tier2', 'fail'));
r = cv('discuss', [run1, run2, run3], 48);
eq_('COMPLETE', 'discuss-44p4t.qualified', r.qualified, false);
if (r.stop_reason === 'locked_fail' || r.stop_reason === 'complete') ok('COMPLETE', 'discuss-44p4t.stop_reason'); else fa('COMPLETE', 'discuss-44p4t.stop_reason', 'locked_fail|complete', r.stop_reason); // depth-0 adjudication 2026-08-30: the 4th miss is the 48th case, so completion and locked_fail coincide; verdict is false either way

var w55 = wl(55, 60, Z), w56 = wl(56, 60, Z), w44 = wl(44, 48, Z), w45 = wl(45, 48, Z);
if (w55 < TAU) ok('COMPLETE', 'bnd.55-60<tau'); else fa('COMPLETE', 'bnd.55-60<tau', '<' + TAU, w55);
if (w56 >= TAU) ok('COMPLETE', 'bnd.56-60>=tau'); else fa('COMPLETE', 'bnd.56-60>=tau', '>=' + TAU, w56);
if (w44 < TAU) ok('COMPLETE', 'bnd.44-48<tau'); else fa('COMPLETE', 'bnd.44-48<tau', '<' + TAU, w44);
if (w45 >= TAU) ok('COMPLETE', 'bnd.45-48>=tau'); else fa('COMPLETE', 'bnd.45-48>=tau', '>=' + TAU, w45);

// ===== GROUP OC_PRESERVATION =====
var st = 20260830;
function rng() { st = (Math.imul(1103515245, st) + 12345) | 0; st = st & 0x7fffffff; return st / 0x80000000; }
function ocTest(role, fn, cpa) {
  var allMatch = true, esMatch = true;
  for (var s = 0; s < 200; s++) {
    var cases = [], tp = 0;
    for (var i = 0; i < fn; i++) {
      var p = rng() < 0.92;
      cases.push({ case_id: 'c' + i, outcome: p ? 'pass' : 'fail', tier: p ? 'pass' : 'tier2' });
      if (p) tp++;
    }
    var admins = [];
    for (var a = 0; a < fn / cpa; a++) admins.push(cases.slice(a * cpa, (a + 1) * cpa));
    var res = fold({ role: role, administrations: admins, fullN: fn });
    var fv = wl(tp, fn, Z) >= TAU;
    if (res.qualified !== fv) allMatch = false;
    if ((res.stop_reason === 'locked_fail' || res.stop_reason === 'locked_qualify') && res.qualified !== fv) esMatch = false;
  }
  return { all: allMatch, es: esMatch };
}
var co = ocTest('consult', 60, 20);
eq_('OC_PRESERVATION', 'consult.allMatch', co.all, true);
eq_('OC_PRESERVATION', 'consult.earlyStopMatch', co.es, true);
var dio = ocTest('discuss', 48, 16);
eq_('OC_PRESERVATION', 'discuss.allMatch', dio.all, true);
eq_('OC_PRESERVATION', 'discuss.earlyStopMatch', dio.es, true);

// ===== GROUP INPUT_SHAPE =====
var ir = [];
for (var i = 0; i < 19; i++) ir.push({ case_id: 'c' + i, outcome: 'pass', tier: 'pass' });
ir.push({ case_id: 'c19', outcome: 'fail', tier_classification: { tier: 'tier1' } });
r = cv('consult', [ir], 60);
eq_('INPUT_SHAPE', 'stop_reason', r.stop_reason, 'tier1');
eq_('INPUT_SHAPE', 'qualified', r.qualified, false);
eq_('INPUT_SHAPE', 'tier1_terminated', r.tier1_terminated, true);

// ===== SUMMARY =====
if (F === 0) { console.log('ALL-PASSED'); process.exit(0); }
else { console.log('SUITE-FAILED failures=' + F); process.exit(1); }
NODE
)
RC=$?

assert_exit_code "$RC" "0" "verdict node harness exits 0"
assert_contains "$OUT" "ALL-PASSED" "node suite reports ALL-PASSED"
for grp in SHAPE CONTINUE TIER1 HARNESS LOCKED_FAIL LOCKED_QUALIFY COMPLETE OC_PRESERVATION INPUT_SHAPE; do
  assert_not_contains "$OUT" "${grp}-FAIL" "no ${grp} failures"
done
finalize_test qualification-tier-mapping
# END-OF-HARNESS
