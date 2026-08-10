#!/usr/bin/env bash
# The single terminal-state issuer. A six-seat review named silent fall-through to legacy
# as the gap that makes autonomous completion untrustworthy: the task LOOKS successful, so
# nobody investigates. These assertions exist to prove the only two outcomes are COMPLETE
# and BLOCKED, and that COMPLETE is unreachable without satisfying every frozen check.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');
const root = process.argv[2];

const {
  TERMINAL_COMPLETE, TERMINAL_BLOCKED, BLOCKED_REASONS,
  freezeChecks, issueTerminal, isComplete,
} = require(path.join(root, 'src/engine/owner-kernel/terminal.js'));

const results = [];
const ok = (name) => results.push(`${name}=ok`);

// The four obligations the charter names, as a realistic frozen set.
const OBLIGATIONS = [
  { id: 'veto-set-empty', description: 'no executable failure veto is outstanding' },
  { id: 'evidence-bound', description: 'green evidence is bound to the final artifact' },
  { id: 'challenge-independent', description: 'a hash-bound independent challenge ran' },
  { id: 'approval-consumed', description: 'the exact single-use approval was consumed' },
];
const ARTIFACT = { artifact_sha256: 'a'.repeat(64), path: 'dist/thing.js' };
const allPass = () => OBLIGATIONS.map((o) => ({ id: o.id, satisfied: true }));

// --- 1. the planted-control matrix: each obligation planted as failing --------------
// One at a time, so a pass cannot be attributed to some other check also failing.
{
  const frozen = freezeChecks(OBLIGATIONS);
  for (const planted of OBLIGATIONS) {
    const withOneFailure = allPass().map((r) => (
      r.id === planted.id ? { id: r.id, satisfied: false } : r
    ));
    const terminal = issueTerminal({
      frozen, results: withOneFailure, artifact: ARTIFACT, attempt: 1, maxAttempts: 3,
    });
    assert.equal(terminal.status, TERMINAL_BLOCKED, `${planted.id} planted must BLOCK`);
    assert.deepEqual(terminal.unsatisfied, [planted.id]);
    // The decisive assertion: no artifact is accepted. A BLOCKED run that still hands
    // back an artifact is exactly the silent-success failure this module prevents.
    assert.equal(terminal.accepted_artifact, null, `${planted.id}: no artifact may be accepted`);
    assert.equal(isComplete(terminal), false);
  }
  ok('planted_control_matrix');
}

// --- 2. the positive control: all satisfied yields exactly one COMPLETE -------------
// Without this the suite would pass even if the module blocked unconditionally.
{
  const frozen = freezeChecks(OBLIGATIONS);
  const terminal = issueTerminal({ frozen, results: allPass(), artifact: ARTIFACT });
  assert.equal(terminal.status, TERMINAL_COMPLETE);
  assert.deepEqual(terminal.unsatisfied, []);
  assert.deepEqual(terminal.accepted_artifact, ARTIFACT);
  assert.equal(terminal.checks_hash, frozen.checks_hash);
  assert.equal(isComplete(terminal), true);
  ok('positive_control_completes');
}

// --- 3. silence is not consent: a missing result is unsatisfied ---------------------
{
  const frozen = freezeChecks(OBLIGATIONS);
  const missingOne = allPass().filter((r) => r.id !== 'challenge-independent');
  const terminal = issueTerminal({ frozen, results: missingOne, artifact: ARTIFACT });
  assert.equal(terminal.status, TERMINAL_BLOCKED);
  assert.deepEqual(terminal.unsatisfied, ['challenge-independent']);
  ok('missing_result_is_unsatisfied');
}

// --- 4. only strict true passes ------------------------------------------------------
// 'false', 0, undefined and truthy-but-not-true are all plausible caller bugs; each one
// sailing through would produce a false COMPLETE.
{
  const frozen = freezeChecks([{ id: 'solo-check' }]);
  for (const value of ['false', 'true', 0, 1, undefined, null, {}, [], 'yes']) {
    const terminal = issueTerminal({
      frozen, results: [{ id: 'solo-check', satisfied: value }], artifact: ARTIFACT,
    });
    assert.equal(terminal.status, TERMINAL_BLOCKED,
      `satisfied=${JSON.stringify(value)} must not complete`);
  }
  const good = issueTerminal({
    frozen, results: [{ id: 'solo-check', satisfied: true }], artifact: ARTIFACT,
  });
  assert.equal(good.status, TERMINAL_COMPLETE);
  ok('only_strict_true_passes');
}

// --- 5. an empty obligation set cannot complete vacuously ----------------------------
{
  const frozen = freezeChecks([]);
  const terminal = issueTerminal({ frozen, results: [], artifact: ARTIFACT });
  assert.equal(terminal.status, TERMINAL_BLOCKED);
  assert.equal(terminal.reason, BLOCKED_REASONS.CHECKS_EMPTY);
  ok('empty_checks_cannot_complete');
}

// --- 6. a check set altered after freezing cannot fund a completion ------------------
{
  const frozen = freezeChecks(OBLIGATIONS);
  // Drop the hardest obligation after freezing and report the rest as passing.
  const tampered = { ...frozen, checks: frozen.checks.filter((c) => c.id !== 'approval-consumed') };
  const terminal = issueTerminal({
    frozen: tampered,
    results: tampered.checks.map((c) => ({ id: c.id, satisfied: true })),
    artifact: ARTIFACT,
  });
  assert.equal(terminal.status, TERMINAL_BLOCKED);
  assert.equal(terminal.reason, BLOCKED_REASONS.CHECKS_TAMPERED);
  ok('tampered_check_set_blocked');
}

// --- 7. a check that threw is a failure, never an absence ---------------------------
{
  const frozen = freezeChecks(OBLIGATIONS);
  const withThrow = allPass().map((r) => (
    r.id === 'evidence-bound' ? { id: r.id, satisfied: false, threw: true, error: 'boom' } : r
  ));
  const terminal = issueTerminal({ frozen, results: withThrow, artifact: ARTIFACT });
  assert.equal(terminal.status, TERMINAL_BLOCKED);
  assert.equal(terminal.reason, BLOCKED_REASONS.CHECK_THREW);
  assert.deepEqual(terminal.threw, ['evidence-bound']);
  ok('throwing_check_blocks');
}

// --- 8. completion requires something to have been completed ------------------------
{
  const frozen = freezeChecks(OBLIGATIONS);
  for (const artifact of [null, undefined, {}, [], 'sha', 42]) {
    const terminal = issueTerminal({ frozen, results: allPass(), artifact });
    assert.equal(terminal.status, TERMINAL_BLOCKED,
      `artifact=${JSON.stringify(artifact)} must not complete`);
    assert.equal(terminal.reason, BLOCKED_REASONS.ARTIFACT_UNBOUND);
  }
  ok('unbound_artifact_blocks');
}

// --- 9. repair is bounded, and the budget buys retries not leniency ------------------
{
  const frozen = freezeChecks(OBLIGATIONS);
  const failing = allPass().map((r) => (r.id === 'veto-set-empty' ? { id: r.id, satisfied: false } : r));
  const mid = issueTerminal({ frozen, results: failing, artifact: ARTIFACT, attempt: 1, maxAttempts: 3 });
  assert.equal(mid.status, TERMINAL_BLOCKED);
  assert.equal(mid.reason, BLOCKED_REASONS.CHECKS_UNSATISFIED);
  assert.equal(mid.repair_available, true);

  const last = issueTerminal({ frozen, results: failing, artifact: ARTIFACT, attempt: 3, maxAttempts: 3 });
  assert.equal(last.status, TERMINAL_BLOCKED);
  assert.equal(last.reason, BLOCKED_REASONS.REPAIR_EXHAUSTED);
  assert.equal(last.repair_available, false);
  // Exhausting the budget must never flip to COMPLETE.
  assert.equal(isComplete(last), false);
  ok('repair_is_bounded');
}

// --- 10. there is no third outcome ---------------------------------------------------
// Exhaustive sweep over every satisfied-combination of the four obligations, crossed with
// bound/unbound artifacts. Every result must be COMPLETE or BLOCKED, and COMPLETE must
// occur exactly once — the all-true, artifact-bound case.
{
  const frozen = freezeChecks(OBLIGATIONS);
  let completes = 0;
  let total = 0;
  for (let mask = 0; mask < (1 << OBLIGATIONS.length); mask += 1) {
    for (const artifact of [ARTIFACT, null]) {
      const res = OBLIGATIONS.map((o, i) => ({ id: o.id, satisfied: Boolean(mask & (1 << i)) }));
      const terminal = issueTerminal({ frozen, results: res, artifact });
      total += 1;
      assert.ok(
        terminal.status === TERMINAL_COMPLETE || terminal.status === TERMINAL_BLOCKED,
        `unexpected status ${terminal.status}`,
      );
      if (terminal.status === TERMINAL_COMPLETE) {
        completes += 1;
        assert.equal(mask, (1 << OBLIGATIONS.length) - 1, 'COMPLETE requires every check');
        assert.deepEqual(terminal.accepted_artifact, ARTIFACT);
      } else {
        assert.equal(terminal.accepted_artifact, null);
      }
    }
  }
  assert.equal(total, 32);
  assert.equal(completes, 1, 'exactly one of 32 combinations may complete');
  ok('no_third_outcome');
}

// --- 11. malformed INPUT throws; a failed RUN does not --------------------------------
// A run failure is a terminal state, not an exception — otherwise a caller's catch block
// becomes the fall-through path this module exists to remove.
{
  assert.throws(() => freezeChecks('nope'), (e) => e.code === 'INVALID_TERMINAL_CHECKS');
  assert.throws(() => freezeChecks([{ id: 'bad id with spaces' }]), (e) => e.code === 'INVALID_TERMINAL_CHECKS');
  assert.throws(() => freezeChecks([{ id: 'dup' }, { id: 'dup' }]), (e) => e.code === 'INVALID_TERMINAL_CHECKS');
  assert.throws(() => issueTerminal({ frozen: null, results: [] }), (e) => e.code === 'INVALID_TERMINAL_CHECKS');
  const frozen = freezeChecks(OBLIGATIONS);
  assert.throws(() => issueTerminal({ frozen, results: 'nope' }), (e) => e.code === 'INVALID_TERMINAL_RESULTS');
  assert.throws(
    () => issueTerminal({ frozen, results: [{ id: 'veto-set-empty' }, { id: 'veto-set-empty' }] }),
    (e) => e.code === 'INVALID_TERMINAL_RESULTS',
  );
  // But a wholly failing run returns BLOCKED rather than throwing.
  const terminal = issueTerminal({
    frozen, results: OBLIGATIONS.map((o) => ({ id: o.id, satisfied: false })), artifact: ARTIFACT,
  });
  assert.equal(terminal.status, TERMINAL_BLOCKED);
  ok('malformed_input_throws_failed_run_does_not');
}

console.log(results.join('\n'));
NODE
)"
rc=$?
printf '%s\n' "$OUT"
[ "$rc" -eq 0 ] || fail "owner-kernel-terminal node assertions failed (rc=$rc)"

assert_contains "$OUT" "planted_control_matrix=ok" "each planted obligation failure must BLOCK and accept no artifact"
assert_contains "$OUT" "positive_control_completes=ok" "all-satisfied must still be able to COMPLETE"
assert_contains "$OUT" "missing_result_is_unsatisfied=ok" "a missing check result must not pass"
assert_contains "$OUT" "only_strict_true_passes=ok" "only satisfied===true may pass"
assert_contains "$OUT" "empty_checks_cannot_complete=ok" "an empty obligation set must not complete vacuously"
assert_contains "$OUT" "tampered_check_set_blocked=ok" "a check set altered after freezing must not fund completion"
assert_contains "$OUT" "throwing_check_blocks=ok" "a check that threw must block"
assert_contains "$OUT" "unbound_artifact_blocks=ok" "completion requires a bound artifact"
assert_contains "$OUT" "repair_is_bounded=ok" "exhausting the repair budget must stay BLOCKED"
assert_contains "$OUT" "no_third_outcome=ok" "exactly one of 32 combinations may complete"
assert_contains "$OUT" "malformed_input_throws_failed_run_does_not=ok" "a failed run must be a terminal state, not an exception"

finalize_test
