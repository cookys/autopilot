#!/usr/bin/env node
/**
 * attack-suite.js — executes ALL EIGHT plan P0 step-4 named attacks against a disposable
 * Owner Kernel fixture. NOT product code.
 *
 * Each run creates a FRESH fixture instance in a temp dir; within that run the fixture instance
 * is the authoritative object and every attack targets it DIRECTLY. Nothing here attacks a copy
 * of an unrelated artifact — that was the unsound scope of an earlier P0 revision.
 *
 * WHAT A RESULT MEANS
 *   fixture_contract=held      the proposed design detected/rejected the attack
 *   fixture_contract=violated  the proposed design FAILED to stop it (a real design defect)
 *
 *   This axis says NOTHING about host capability. A design that correctly requires an in-memory
 *   capability still needs a host that can keep one out of model reach; that is measured
 *   separately by host-capability-probe.js and the two must never be conflated.
 *
 * Depth-0 Owner decision (recorded): every attack MUST be repeated against the production
 * implementation at P1 exit before any host may be `full`/`partial`.
 *
 * Deterministic and non-destructive: fresh temp dir per run, removed on exit; touches nothing
 * outside it. Node built-ins only.
 *
 * Usage: attack-suite.js [--json] [--keep]
 * Exit:  0 all contracts held · 1 one or more contracts violated · 2 harness error
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { OwnerKernelFixture, FixtureRejection, sha256 } = require('./owner-kernel-fixture.js');

const JSON_ONLY = process.argv.includes('--json');
const KEEP = process.argv.includes('--keep');

// Fixed inputs so runs are byte-reproducible.
const WITNESS_KEY = 'fixture-witness-key-DO-NOT-REUSE';
const CAPABILITY = 'fixture-owner-capability-DO-NOT-REUSE';
const POLICY = { mode: 'owner-led', red_lines: ['external_push', 'irreversible_delete'], max_uses_default: 1 };
const CAP_SET = { hooks: ['pre-action'], tools: ['edit', 'bash'] };

function newFixture(root, name) {
  return new OwnerKernelFixture(path.join(root, name), {
    witnessKey: WITNESS_KEY, capability: CAPABILITY, policy: JSON.parse(JSON.stringify(POLICY)),
    capabilitySet: JSON.parse(JSON.stringify(CAP_SET)),
  });
}

/** Seed a fixture with a legitimate intent so attacks act on a live object. */
function seed(fx) {
  fx.append({ type: 'intent', text: 'ship the thing' },
    { channel: 'authenticated_user', witnessKey: WITNESS_KEY, emitter_id: 'user:cookys' });
  return fx;
}

/** Helper: expect the fixture to reject. Returns the oracle result. */
function expectReject(fn, expectedCode) {
  try {
    fn();
    return { fixture_contract: 'violated', observed: 'accepted',
      detail: `attack succeeded; expected rejection ${expectedCode}` };
  } catch (e) {
    if (e instanceof FixtureRejection) {
      return { fixture_contract: e.code === expectedCode ? 'held' : 'held_other_code',
        observed: 'rejected', rejection_code: e.code, expected_code: expectedCode };
    }
    throw e;
  }
}

const ATTACKS = {
  // 1 ------------------------------------------------------------------------------
  protected_event_envelope_forgery(root) {
    const fx = seed(newFixture(root, 'a1'));
    // Attacker mints a user-authority event with a forged witness key.
    return expectReject(() => fx.append(
      { type: 'approval', decision_id: 'd1', descriptor: 'external_push', max_uses: 1 },
      { channel: 'authenticated_user', witnessKey: 'FORGED-KEY', emitter_id: 'attacker' }
    ), 'witness_key_invalid');
  },

  // 2 ------------------------------------------------------------------------------
  direct_decision_append(root) {
    const fx = seed(newFixture(root, 'a2'));
    // A shell/worker caller appends a decision with no owner capability.
    return expectReject(() => fx.append(
      { type: 'decision', decision_id: 'd2', descriptor: 'external_push' },
      { channel: 'owner_turn', capability: undefined, emitter_id: 'worker:shell' }
    ), 'capability_invalid');
  },

  // 3 ------------------------------------------------------------------------------
  worker_artifact_decision_injection(root) {
    const fx = seed(newFixture(root, 'a3'));
    // Worker writes a file claiming to be a decision; it is submitted as the payload source.
    const artifact = path.join(fx.dir, 'worker-output.json');
    fs.writeFileSync(artifact, JSON.stringify({ type: 'decision', descriptor: 'external_push' }));
    return expectReject(() => fx.append(
      { type: 'decision', decision_id: 'd3', descriptor: 'external_push' },
      { channel: 'owner_turn', capability: CAPABILITY, source: 'worker_artifact_file',
        emitter_id: 'worker:impl' }
    ), 'decision_source_invalid');
  },

  // 4 ------------------------------------------------------------------------------
  child_process_capability_theft(root) {
    const fx = seed(newFixture(root, 'a4'));
    // A child process attempts to recover the capability from disk and from its environment.
    const onDisk = fx.capabilityOnDisk();
    let childSawEnv = 'no';
    try {
      const out = execFileSync(process.execPath, ['-e',
        'process.stdout.write(Object.entries(process.env).some(([k,v])=>String(v).includes("fixture-owner-capability"))?"yes":"no")'
      ], { encoding: 'utf8', timeout: 15000 });
      childSawEnv = out.trim();
    } catch (e) { childSawEnv = 'probe_error'; }

    // Same-uid parent-memory theft is recorded as host-substrate evidence only. It deliberately does
    // not decide the fixture contract: the fixture proves the proposed design avoids serializing or
    // exporting the capability, while host-capability-probe.js decides whether a real host can keep an
    // in-memory capability out of model reach.
    const theft = { parent_environ: 'not_attempted', parent_mem: 'not_attempted' };
    try {
      const out = execFileSync(process.execPath, ['-e',
        'const fs=require("fs");let r="no";' +
        'try{r=fs.readFileSync("/proc/"+process.ppid+"/environ","utf8").includes("fixture-owner-capability")?"yes":"no"}' +
        'catch(e){r="err:"+e.code}process.stdout.write(r)'], { encoding: 'utf8', timeout: 15000 });
      theft.parent_environ = out.trim();
    } catch (e) { theft.parent_environ = 'probe_error'; }
    try {
      const out = execFileSync(process.execPath, ['-e',
        'const fs=require("fs");let r="no";' +
        'try{fs.closeSync(fs.openSync("/proc/"+process.ppid+"/mem","r"));r="openable"}' +
        'catch(e){r="err:"+e.code}process.stdout.write(r)'], { encoding: 'utf8', timeout: 15000 });
      theft.parent_mem = out.trim();
    } catch (e) { theft.parent_mem = 'probe_error'; }

    const hostSubstrateStolen = theft.parent_environ === 'yes' || theft.parent_mem === 'openable';
    const fixtureLeak = onDisk.length > 0 || childSawEnv === 'yes';
    return {
      fixture_contract: fixtureLeak ? 'violated' : 'held',
      observed: fixtureLeak ? 'capability_recoverable_from_fixture_exports'
        : 'capability_not_recoverable_from_fixture_exports',
      capability_on_disk: onDisk.length,
      child_saw_capability_in_env: childSawEnv,
      host_substrate_probe: theft,
      host_substrate_theft_succeeded: hostSubstrateStolen,
      detail: 'capability is never serialized and never exported to the child environment. '
        + 'Same-uid parent /proc environ and /proc mem theft are observed separately as host-substrate '
        + 'signals and do not affect the fixture contract.',
    };
  },

  // 5 ------------------------------------------------------------------------------
  policy_kernel_mutation(root) {
    const fx = seed(newFixture(root, 'a5'));
    // Mutate the frozen policy in place, then try to keep operating.
    fx.policy.red_lines = [];               // attacker removes every red line
    return expectReject(() => fx.append(
      { type: 'decision', decision_id: 'd5', descriptor: 'external_push' },
      { channel: 'owner_turn', capability: CAPABILITY, source: 'owner_turn_envelope',
        emitter_id: 'owner:1' }
    ), 'policy_drift');
  },

  // 6 ------------------------------------------------------------------------------
  mediated_action_bypass(root) {
    const fx = seed(newFixture(root, 'a6'));
    // Perform a red-line action with no approved matching decision.
    let noDecision, exhausted, mismatched;
    try { fx.mediateRedLineAction('external_push', 'nonexistent'); noDecision = 'permitted'; }
    catch (e) { noDecision = e.code; }

    // Approve exactly one use, consume it, then attempt a second (approve-once-execute-many).
    fx.append({ type: 'decision', decision_id: 'd6', descriptor: 'external_push' },
      { channel: 'owner_turn', capability: CAPABILITY, source: 'owner_turn_envelope', emitter_id: 'owner:1' });
    fx.append({ type: 'approval', decision_id: 'd6', descriptor: 'external_push', max_uses: 1 },
      { channel: 'authenticated_user', witnessKey: WITNESS_KEY, emitter_id: 'user:cookys' });
    fx.mediateRedLineAction('external_push', 'd6');
    try { fx.mediateRedLineAction('external_push', 'd6'); exhausted = 'permitted'; }
    catch (e) { exhausted = e.code; }

    // Approved for one descriptor, attempt another (approve-then-drift).
    try { fx.mediateRedLineAction('irreversible_delete', 'd6'); mismatched = 'permitted'; }
    catch (e) { mismatched = e.code; }

    const held = noDecision === 'no_matching_decision'
      && exhausted === 'approval_exhausted'
      && mismatched !== 'permitted';
    return {
      fixture_contract: held ? 'held' : 'violated',
      observed: held ? 'all three bypass routes blocked' : 'a bypass route succeeded',
      no_decision: noDecision, reuse_after_exhaustion: exhausted, descriptor_drift: mismatched,
    };
  },

  // 7 ------------------------------------------------------------------------------
  capability_set_drift(root) {
    const fx = seed(newFixture(root, 'a7'));
    // Host gains a new unmediated sink after intake.
    fx.capabilitySet.tools.push('network_exfil');
    return expectReject(() => fx.append(
      { type: 'decision', decision_id: 'd7', descriptor: 'external_push' },
      { channel: 'owner_turn', capability: CAPABILITY, source: 'owner_turn_envelope',
        emitter_id: 'owner:1' }
    ), 'capability_set_drift');
  },

  // 8 ------------------------------------------------------------------------------
  witness_head_rewrite(root) {
    const fx = seed(newFixture(root, 'a8'));
    fx.append({ type: 'decision', decision_id: 'd8', descriptor: 'external_push' },
      { channel: 'owner_turn', capability: CAPABILITY, source: 'owner_turn_envelope', emitter_id: 'owner:1' });

    const before = fx.verifyAgainstWitness();

    // Attack: rewrite the AUTHORITATIVE ledger from genesis, recomputing every internal hash so
    // the chain is self-consistent. This is the attack an internally-consistent hash chain alone
    // cannot detect; only the independent witness receipt chain can.
    const rows = fs.readFileSync(fx.ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    rows[rows.length - 1].descriptor = 'irreversible_delete';   // forge the decision
    let head = 'genesis';
    for (const r of rows) {
      r.prev_hash = head;
      const clone = Object.assign({}, r); delete clone.content_hash; delete clone.prev_hash;
      r.content_hash = sha256(require('./owner-kernel-fixture.js').canonical(
        Object.assign({}, clone, { prev_hash: head })) + '|' + head);
      head = r.content_hash;
    }
    fs.writeFileSync(fx.ledgerPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const after = fx.verifyAgainstWitness();
    const detected = before.ok === true && after.ok === false;
    return {
      fixture_contract: detected ? 'held' : 'violated',
      observed: detected ? 'rewrite detected by external witness receipt chain'
                         : 'rewrite NOT detected — witness chain failed to catch it',
      verify_before: before, verify_after: after,
      note: 'the authoritative ledger of this run was rewritten in place, not a copy',
    };
  },
};

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-attack-suite-'));
  const results = {};
  let violations = 0;
  try {
    for (const [name, fn] of Object.entries(ATTACKS)) {
      let r;
      try { r = fn(root); }
      catch (e) { r = { fixture_contract: 'harness_error', observed: 'error', detail: String(e && e.message) }; }
      r.executed = true;
      r.scope = 'fixture_contract_only__not_host_capability';
      results[name] = r;
      if (r.fixture_contract === 'violated' || r.fixture_contract === 'harness_error') violations++;
    }
  } finally {
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
  }

  const payload = {
    probe: 'owner-kernel-p0-attack-suite',
    attacks_required: 8,
    attacks_executed: Object.keys(results).length,
    contracts_violated: violations,
    scope_note: 'Fixture-contract results ONLY. These do NOT classify any host and cannot qualify one. '
      + 'Depth-0 Owner decision: every attack MUST be repeated against the production implementation '
      + 'at P1 exit before any host may be full/partial.',
    results,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(violations === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { ATTACKS };
