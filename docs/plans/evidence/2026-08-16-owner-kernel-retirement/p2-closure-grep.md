# P2 step 1 — repo-wide closure grep (pre-deletion), 2026-08-16

## (a) requires of deleted submodule paths (outside delete-set)
(none)

## (b) supervised- requires outside delete-set
src/engine/index.js:46:} = require('./supervised-engine-bridge-contract');
src/engine/index.js:60:} = require('./supervised-authenticated-intake');
src/engine/index.js:85:} = require('./supervised-host-preflight');
src/engine/index.js:108:} = require('./supervised-production-substrate-contract');
src/engine/index.js:127:} = require('./supervised-production-substrate-durable-contract');
src/engine/index.js:136:} = require('./supervised-owner-kernel-semantic-witness');
src/engine/index.js:151:} = require('./supervised-owner-kernel-probe-effect');
src/engine/index.js:166:} = require('./supervised-owner-kernel-engine-acceptance');
src/engine/index.js:186:} = require('./supervised-owner-kernel-installed-contract');
src/engine/index.js:194:} = require('./supervised-owner-kernel-installed-ipc');
src/engine/index.js:199:} = require('./supervised-owner-kernel-installed-runner');
src/engine/autopilot-engine.js:22:const { AUTOPILOT_ENGINE_CONTROL_SINKS } = require('./supervised-engine-bridge-contract');

## (c) kernel-only symbols used outside delete-set (OwnerKernel/verifyLedger/deriveDisclosure/freezeAcceptanceContract)
hooks/tests/owner-action-hardening.test.sh:11:  OwnerKernel,
hooks/tests/owner-action-hardening.test.sh:14:  verifyLedger,
hooks/tests/owner-action-hardening.test.sh:431:  const started = OwnerKernel.start({
hooks/tests/owner-action-hardening.test.sh:575:  const pendingState = verifyLedger(pendingLedger, { witness: run.witness, requireWitness: true }).state;
hooks/tests/owner-action-hardening.test.sh:580:  assert.throws(() => verifyLedger({
hooks/tests/owner-action-hardening.test.sh:584:  assert.throws(() => OwnerKernel.resume({
hooks/tests/owner-action-hardening.test.sh:621:  const legacyStarted = OwnerKernel.start({
hooks/tests/owner-action-hardening.test.sh:650:  const verifiedLegacy = verifyLedger(rebuilt.ledger, { witness: rebuilt.witness, requireWitness: true });
hooks/tests/owner-action-hardening.test.sh:661:  const p1Compatible = OwnerKernel.start({
hooks/tests/owner-action-hardening.test.sh:793:  verifyLedger(claimCommitRun.kernel.getLedger(), { witness: claimCommitRun.witness, requireWitness: true });
hooks/tests/level-governance-translation.test.sh:16:  OwnerKernel,
hooks/tests/level-governance-translation.test.sh:20:  freezeAcceptanceContract,
hooks/tests/level-governance-translation.test.sh:27:  verifyLedger,
hooks/tests/level-governance-translation.test.sh:232:const verified = verifyLedger(ledger, { witness, requireWitness: true });
hooks/tests/level-governance-translation.test.sh:291:const historicalContract = freezeAcceptanceContract({
hooks/tests/level-governance-translation.test.sh:350:  verifyLedger(historicalLedger, {
hooks/tests/level-governance-translation.test.sh:452:const genericDecision = OwnerKernel.start({
hooks/tests/level-governance-translation.test.sh:481:const genericTranslation = OwnerKernel.start({
hooks/tests/level-governance-translation.test.sh:515:assert.equal(typeof OwnerKernel.prototype.append, 'undefined');
hooks/tests/owner-action-reconciliation.test.sh:17:  OwnerKernel,
