#!/usr/bin/env bash
# Shadow terminal observer. The assertion that matters most is that it is NOT a tautology:
# a shadow built from the predicate it is judging agrees 100% forever and proves nothing,
# while looking like a validated second opinion. This suite proves the kernel can and does
# disagree with legacy, and that it never breaks what it watches.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');
const root = process.argv[2];
const { observeShadowTerminal, obligationsFor } = require(path.join(root, 'src/status/shadow-terminal-observer.js'));

const results = [];
const ok = (name) => results.push(`${name}=ok`);

// A task status where every legacy operand is satisfied AND an artifact is named.
const fullyGood = {
  can_close: true,
  mission_terminal: true,
  campaigns_terminal: true,
  acceptance_verdict: 'accepted',
  integration_target: { commit: 'a'.repeat(40) },
  evidence: { integration: { product_merged: true } },
};

// --- 1. agreement when everything genuinely holds ---------------------------------
{
  const obs = observeShadowTerminal(fullyGood);
  assert.equal(obs.shadow_decision, 'close');
  assert.equal(obs.legacy_decision, 'close');
  assert.equal(obs.agreed, true);
  ok('agrees_when_evidence_complete');
}

// --- 2. NOT A TAUTOLOGY: legacy closes, kernel refuses ----------------------------
// Legacy's operands are all true, so can_close is true. But no artifact is named, and the
// kernel additionally requires evidence to be bound to one. If this ever stops diverging,
// the observer has become a mirror of can_close and the monitor's data is worthless.
{
  const noArtifact = { ...fullyGood, integration_target: {}, evidence: { integration: { product_merged: true } } };
  const obs = observeShadowTerminal(noArtifact);
  assert.equal(obs.legacy_decision, 'close', 'legacy must still close');
  assert.equal(obs.shadow_decision, 'hold', 'kernel must refuse an unbound claim');
  assert.equal(obs.agreed, false);
  assert.deepEqual(obs.unsatisfied, ['evidence-bound-to-artifact']);
  assert.match(obs.reason, /not bound to a named artifact/);
  ok('diverges_on_kernel_only_obligation');
}

// --- 3. the shadow is built from EVIDENCE, not from can_close ---------------------
// A status object claiming can_close:true while its evidence says otherwise must not
// drag the kernel along. This is the structural guarantee against tautology.
{
  const lying = {
    can_close: true,
    mission_terminal: false,
    campaigns_terminal: false,
    acceptance_verdict: 'unknown',
    integration_target: { commit: 'b'.repeat(40) },
    evidence: { integration: { product_merged: false } },
  };
  const obs = observeShadowTerminal(lying);
  assert.equal(obs.legacy_decision, 'close');
  assert.equal(obs.shadow_decision, 'hold');
  assert.equal(obs.agreed, false);
  assert.ok(obs.unsatisfied.includes('mission-terminal'));
  assert.ok(obs.unsatisfied.includes('acceptance-accepted'));
  ok('judges_evidence_not_the_predicate');
}

// --- 4. agreement on refusal, too --------------------------------------------------
{
  const bad = {
    can_close: false,
    mission_terminal: false,
    campaigns_terminal: true,
    acceptance_verdict: 'accepted',
    integration_target: { commit: 'c'.repeat(40) },
    evidence: { integration: { product_merged: true } },
  };
  const obs = observeShadowTerminal(bad);
  assert.equal(obs.legacy_decision, 'hold');
  assert.equal(obs.shadow_decision, 'hold');
  assert.equal(obs.agreed, true);
  ok('agrees_on_refusal');
}

// --- 5. a divergence the kernel cannot self-explain stays unexplained ---------------
// Only the kernel-only obligation carries a canned reason. Anything else must reach the
// monitor as unexplained rather than with an invented rationale.
{
  const obs = observeShadowTerminal({
    can_close: true,
    mission_terminal: false,
    campaigns_terminal: true,
    acceptance_verdict: 'accepted',
    integration_target: { commit: 'd'.repeat(40) },
    evidence: { integration: { product_merged: true } },
  });
  assert.equal(obs.agreed, false);
  assert.equal(obs.reason, null, 'a non-kernel-only divergence must not be auto-explained');
  ok('no_invented_explanation');
}

// --- 6. a truthy flag with nothing named is not a binding --------------------------
{
  const obligations = obligationsFor({
    integration_target: { commit: '' },
    evidence: { integration: { product_merged: true, merge_commit: '' } },
  });
  const bound = obligations.find((o) => o.id === 'evidence-bound-to-artifact');
  assert.equal(bound.satisfied, false, 'empty identifiers must not count as a binding');
  ok('empty_identifier_is_not_a_binding');
}

// --- 7. it never throws and never mutates -----------------------------------------
// Shadow must not be able to break the authoritative answer. Fail-open here is the
// opposite of the terminal issuer's fail-closed rule, and the difference is authority.
{
  for (const junk of [null, undefined, {}, [], 'nope', 42, { evidence: null }]) {
    const obs = observeShadowTerminal(junk);
    assert.ok(obs === null || typeof obs === 'object', 'must never throw');
  }
  const frozen = Object.freeze({ ...fullyGood });
  const before = JSON.stringify(frozen);
  observeShadowTerminal(frozen);
  assert.equal(JSON.stringify(frozen), before, 'must not mutate the status it observes');
  ok('fail_open_and_non_mutating');
}

// --- 8. the observation reaches the sink in the monitor's shape --------------------
{
  const seen = [];
  observeShadowTerminal(fullyGood, { record: (o) => seen.push(o) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].entry_path, '/status-task');
  for (const field of ['shadow_decision', 'legacy_decision', 'agreed', 'reason', 'checks_hash']) {
    assert.ok(field in seen[0], `observation must carry ${field}`);
  }
  // A throwing sink must not propagate.
  const obs = observeShadowTerminal(fullyGood, { record: () => { throw new Error('sink down'); } });
  assert.ok(obs === null || obs.agreed === true, 'a failing sink must not break observation');
  ok('emits_monitor_shaped_observation');
}

console.log(results.join('\n'));
NODE
)"
rc=$?
printf '%s\n' "$OUT"
[ "$rc" -eq 0 ] || fail "shadow-terminal-observer node assertions failed (rc=$rc)"

assert_contains "$OUT" "agrees_when_evidence_complete=ok" "complete evidence must produce agreement"
assert_contains "$OUT" "diverges_on_kernel_only_obligation=ok" "the kernel must be able to disagree — otherwise the monitor measures nothing"
assert_contains "$OUT" "judges_evidence_not_the_predicate=ok" "the shadow must judge evidence, never can_close"
assert_contains "$OUT" "agrees_on_refusal=ok" "both refusing is agreement"
assert_contains "$OUT" "no_invented_explanation=ok" "an unexplainable divergence must stay unexplained"
assert_contains "$OUT" "empty_identifier_is_not_a_binding=ok" "an empty identifier must not count as an artifact binding"
assert_contains "$OUT" "fail_open_and_non_mutating=ok" "shadow must never throw or mutate"
assert_contains "$OUT" "emits_monitor_shaped_observation=ok" "observations must reach the sink in monitor shape"

finalize_test
