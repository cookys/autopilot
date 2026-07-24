#!/usr/bin/env node
/**
 * mutation-validate.js — proves the attack-suite oracles are NOT VACUOUS.
 *
 * An eight-for-eight pass is exactly the result that should be distrusted: an oracle that never
 * fires is indistinguishable from an oracle that cannot fire. This script applies a targeted
 * mutation that DISABLES one guard in a disposable copy of the fixture, re-runs the corresponding
 * attack, and requires the attack to flip `held` -> `violated`.
 *
 * An attack whose oracle stays `held` under the injected defect is VACUOUS and its green result
 * from attack-suite.js must not be counted as evidence. This mirrors the repo's existing
 * mutation-validated-probe rule (scripts/adjudicate-findings.js `refute` path).
 *
 * Non-destructive: operates entirely inside a temp dir copy; the committed fixture is never edited.
 * Node built-ins only.
 *
 * Usage: mutation-validate.js [--json]
 * Exit:  0 every oracle proven live · 1 one or more oracles vacuous · 2 harness error
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC_DIR = __dirname;
const REQUIRED_MUTATIONS = [
  'protected_event_envelope_forgery',
  'direct_decision_append',
  'worker_artifact_decision_injection',
  'policy_kernel_mutation',
  'capability_set_drift',
  'mediated_action_bypass',
  'witness_head_rewrite',
  'child_process_capability_theft',
];

/**
 * Each mutation removes exactly one guard. `attack` names the attack whose oracle must fire.
 * `find` must match the committed fixture source exactly, or the mutation is reported unapplied
 * (which is itself a failure — a mutation that does not apply proves nothing).
 */
const MUTATIONS = [
  { attack: 'protected_event_envelope_forgery', guard: 'witness key check',
    find: `      if (ctx.witnessKey !== this._witnessKey) {
        throw new FixtureRejection('witness_key_invalid', 'forged or absent user-channel witness');
      }`,
    replace: `      // MUTATED: witness key check removed` },

  { attack: 'direct_decision_append', guard: 'capability check',
    find: `      if (ctx.capability !== this._capability) {
        throw new FixtureRejection('capability_invalid', 'decision mint without valid owner capability');
      }`,
    replace: `      // MUTATED: capability check removed` },

  { attack: 'worker_artifact_decision_injection', guard: 'decision source check',
    find: `      if (ctx.source && ctx.source !== 'owner_turn_envelope') {
        throw new FixtureRejection('decision_source_invalid',
          \`decision payload sourced from \${ctx.source}\`);
      }`,
    replace: `      // MUTATED: decision source check removed` },

  { attack: 'policy_kernel_mutation', guard: 'policy drift check',
    find: `    if (sha256(canonical(this.policy)) !== this.policyHash) {
      throw new FixtureRejection('policy_drift', 'frozen policy mutated after intake');
    }`,
    replace: `    // MUTATED: policy drift check removed` },

  { attack: 'capability_set_drift', guard: 'capability-set drift check',
    find: `    if (sha256(canonical(this.capabilitySet)) !== this.capabilitySetHash) {
      throw new FixtureRejection('capability_set_drift', 'host capability set changed after intake');
    }`,
    replace: `    // MUTATED: capability-set drift check removed` },

  { attack: 'mediated_action_bypass', guard: 'approval use-bound consumption',
    find: `    if (appr.uses_remaining <= 0) throw new FixtureRejection('approval_exhausted', descriptor);`,
    replace: `    // MUTATED: use-bound exhaustion check removed` },

  { attack: 'witness_head_rewrite', guard: 'witness receipt comparison',
    find: `      if (row.content_hash !== receipt.event_head) {
        return { ok: false, reason: 'head_mismatch_at_seq', seq: i };
      }`,
    replace: `      // MUTATED: witness receipt comparison removed` },

  { attack: 'child_process_capability_theft', guard: 'capability kept out of serialized state',
    // Force the capability onto disk, which is precisely what R2 forbids.
    find: `    fs.appendFileSync(this.ledgerPath, JSON.stringify(row) + '\\n');`,
    replace: `    fs.appendFileSync(this.ledgerPath, JSON.stringify(Object.assign({}, row, { leaked_capability: this._capability })) + '\\n');` },
];

function runSuiteIn(dir, attackName) {
  const out = execFileSync(process.execPath, [path.join(dir, 'attack-suite.js'), '--json'],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out).results[attackName];
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-mutation-'));
  const results = {};
  let vacuous = 0;

  try {
    const baseSrc = fs.readFileSync(path.join(SRC_DIR, 'owner-kernel-fixture.js'), 'utf8');
    const suiteSrc = fs.readFileSync(path.join(SRC_DIR, 'attack-suite.js'), 'utf8');

    for (const m of MUTATIONS) {
      const dir = path.join(root, m.attack);
      fs.mkdirSync(dir, { recursive: true });

      if (!baseSrc.includes(m.find)) {
        results[m.attack] = { oracle: 'UNKNOWN', mutation_applied: false, guard: m.guard,
          detail: 'mutation target not found in fixture source — cannot prove the oracle is live' };
        vacuous++;
        continue;
      }

      fs.writeFileSync(path.join(dir, 'owner-kernel-fixture.js'), baseSrc.replace(m.find, m.replace));
      fs.writeFileSync(path.join(dir, 'attack-suite.js'), suiteSrc);

      let mutated;
      try { mutated = runSuiteIn(dir, m.attack); }
      catch (e) {
        // Non-zero exit is expected when a contract is violated; parse stdout anyway.
        try { mutated = JSON.parse(e.stdout).results[m.attack]; }
        catch (_) { mutated = { fixture_contract: 'harness_error', detail: String(e && e.message).slice(0, 200) }; }
      }

      const fired = mutated && mutated.fixture_contract === 'violated';
      results[m.attack] = {
        oracle: fired ? 'LIVE' : 'VACUOUS',
        mutation_applied: true,
        guard: m.guard,
        contract_under_mutation: mutated && mutated.fixture_contract,
        observed_under_mutation: mutated && mutated.observed,
      };
      if (!fired) vacuous++;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const payload = {
    probe: 'owner-kernel-p0-attack-oracle-mutation-validation',
    oracles_tested: Object.keys(results).length,
    oracles_required: REQUIRED_MUTATIONS.length,
    missing_oracles: REQUIRED_MUTATIONS.filter((name) => !Object.prototype.hasOwnProperty.call(results, name)),
    extra_oracles: Object.keys(results).filter((name) => !REQUIRED_MUTATIONS.includes(name)),
    vacuous_oracles: vacuous,
    rule: 'An attack whose oracle does not flip to `violated` under an injected defect is VACUOUS; '
        + 'its green result in attack-suite.js is not evidence and must not be counted.',
    results,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  const complete = payload.oracles_tested === payload.oracles_required
    && payload.missing_oracles.length === 0
    && payload.extra_oracles.length === 0;
  process.exit(vacuous === 0 && complete ? 0 : 1);
}

if (require.main === module) main();
