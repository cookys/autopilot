#!/usr/bin/env bash
# Host-resident production witness adapter: the component the Owner Kernel needed to
# leave shadow and that had never been written. Proves the properties the release gate
# actually reads — external trust tier, adapter-owned anchored timestamps, durable
# compare-and-append — plus byte-parity with the repo's canonical JSON, since the
# deployed copy cannot require() repo code and a silent hash divergence would corrupt
# every receipt chain.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];

const { HostWitnessAdapter, __canonical } = require(path.join(root, 'src/host-adapters/witness-adapter.js'));
const repoCanonical = require(path.join(root, 'src/engine/owner-kernel/canonical.js'));
const { assertWitnessAdapter, MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness.js'));

const results = [];
const ok = (name) => results.push(`${name}=ok`);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-host-witness-'));
const journal = (name) => path.join(tmpRoot, name, 'witness.jsonl');
const H = (n) => require('crypto').createHash('sha256').update(String(n)).digest('hex');

// --- 1. canonical-JSON parity (the duplication this file exists to police) ---------
// A divergence here would not fail loudly; it would silently produce different
// witness_head values than the kernel computes, and every receipt would fail to verify.
{
  const cases = [
    null, true, false, 0, -1, 1.5, '', 'plain', 'quote"in',
    [], [1, 'two', null], {},
    { b: 1, a: 2 },                               // key ordering
    { z: { y: [1, { x: null }] }, a: 'first' },   // nesting + ordering
    { 'ünïcödé': 'värde' },
    { nested: { deep: { deeper: [true, false, null] } } },
  ];
  for (const value of cases) {
    assert.equal(
      __canonical.canonicalJson(value),
      repoCanonical.canonicalJson(value),
      `canonicalJson diverged for ${JSON.stringify(value)}`,
    );
    assert.equal(
      __canonical.sha256(value),
      repoCanonical.sha256(value),
      `sha256 diverged for ${JSON.stringify(value)}`,
    );
  }
  // Rejections must match too — a copy that accepts what the original rejects is a hole.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => __canonical.canonicalJson(bad));
    assert.throws(() => repoCanonical.canonicalJson(bad));
  }
  ok('canonical_json_parity');
}

// --- 2. the release gate's actual requirement: trustTier === 'external' -----------
{
  const w = new HostWitnessAdapter({ streamId: 'stream-a', journalPath: journal('a') });
  assert.equal(w.trustTier, 'external');
  // Non-writable: a caller must not be able to forge or downgrade the tier.
  assert.throws(() => { 'use strict'; w.trustTier = 'test'; });
  assert.equal(w.trustTier, 'external');
  // The kernel's own gate must accept it WITHOUT the test-witness escape hatch.
  assertWitnessAdapter(w, { requireCompareAndAppend: true, requireBatch: true });
  ok('external_trust_tier_accepted');
}

// --- 3. NEGATIVE CONTROL: the test witness must still be refused ------------------
// This is the control that makes the suite non-vacuous. Every P0-P4 suite passed
// against MemoryWitness; the release gate forbids it. If this ever stops throwing,
// a double can mint release evidence again.
{
  const memory = new MemoryWitness({ streamId: 'stream-a' });
  assert.equal(memory.trustTier, 'test');
  assert.throws(
    () => assertWitnessAdapter(memory),
    (error) => error.code === 'UNTRUSTED_WITNESS',
    'MemoryWitness must be refused as production authority',
  );
  ok('test_witness_still_refused');
}

// --- 4. append chain + durability across process-level reconstruction ------------
{
  const jp = journal('b');
  const w1 = new HostWitnessAdapter({ streamId: 'stream-b', journalPath: jp });
  assert.equal(w1.getHead(), null);
  const r1 = w1.append({ run_id: 'run-1', sequence: 1, event_hash: H('e1') });
  const r2 = w1.append({ run_id: 'run-1', sequence: 2, event_hash: H('e2') });
  assert.equal(r1.previous_witness_head, null);
  assert.equal(r2.previous_witness_head, r1.witness_head);
  assert.equal(w1.getHead(), r2.witness_head);

  // A fresh adapter over the same journal must recover the same head — this is what
  // MemoryWitness could never do and why it cannot back a 14-day window.
  const w2 = new HostWitnessAdapter({ streamId: 'stream-b', journalPath: jp });
  assert.equal(w2.getHead(), r2.witness_head);
  assert.equal(w2.verify(r1), true);
  assert.equal(w2.verify(r2), true);
  ok('durable_head_recovery');
}

// --- 5. compare-and-append rejects a stale head ----------------------------------
{
  const w = new HostWitnessAdapter({ streamId: 'stream-c', journalPath: journal('c') });
  const r1 = w.appendIfHead({ expected_witness_head: null, run_id: 'run-2', sequence: 1, event_hash: H('c1') });
  assert.throws(
    () => w.appendIfHead({ expected_witness_head: null, run_id: 'run-2', sequence: 2, event_hash: H('c2') }),
    (error) => error.code === 'WITNESS_HEAD_STALE',
  );
  const r2 = w.appendIfHead({ expected_witness_head: r1.witness_head, run_id: 'run-2', sequence: 2, event_hash: H('c2') });
  assert.equal(r2.previous_witness_head, r1.witness_head);
  ok('compare_and_append_rejects_stale');
}

// --- 6. caller-supplied time is REJECTED, not ignored ----------------------------
// The checker sanitises time fields before lookup precisely so an adapter cannot
// launder a caller's clock. Ignoring the field would leave the caller believing it
// had been honoured; rejecting makes the boundary visible.
{
  const w = new HostWitnessAdapter({ streamId: 'stream-d', journalPath: journal('d') });
  for (const field of ['append_timestamp', 'observed_at', 'timestamp', 'issued_at']) {
    assert.throws(
      () => w.append({ run_id: 'run-3', sequence: 1, event_hash: H('d1'), [field]: '1999-01-01T00:00:00.000Z' }),
      (error) => error.code === 'CALLER_SUPPLIED_TIME',
      `caller-supplied ${field} must be rejected`,
    );
  }
  ok('caller_time_rejected');
}

// --- 7. getAppendTimestamp resolves from adapter state, over a SANITISED receipt --
{
  const w = new HostWitnessAdapter({ streamId: 'stream-e', journalPath: journal('e') });
  const before = new Date().toISOString();
  const receipt = w.append({ run_id: 'run-4', sequence: 1, event_hash: H('e1') });
  const after = new Date().toISOString();

  // Exactly what the checker passes: every time-shaped field stripped.
  const sanitized = { ...receipt };
  for (const f of ['append_timestamp', 'observation_timestamp', 'observed_at', 'appended_at',
    'witnessed_at', 'issued_at', 'timestamp', 'time']) delete sanitized[f];

  const ts = w.getAppendTimestamp(sanitized);
  assert.equal(typeof ts, 'string');
  assert.match(ts, /Z$/);
  assert.ok(!Number.isNaN(new Date(ts).getTime()));
  assert.ok(ts >= before && ts <= after, 'timestamp must be anchored at append time');

  // A receipt this adapter never issued has no timestamp to offer.
  const forged = { ...sanitized, witness_head: H('forged-head') };
  assert.equal(w.getAppendTimestamp(forged), null);
  assert.equal(w.getAppendTimestamp({}), null);
  assert.equal(w.getAppendTimestamp(null), null);
  ok('anchored_timestamp_from_adapter_state');
}

// --- 8. a tampered journal line cannot map a forged receipt onto a real time ------
{
  const jp = journal('f');
  const w = new HostWitnessAdapter({ streamId: 'stream-f', journalPath: jp });
  const receipt = w.append({ run_id: 'run-5', sequence: 1, event_hash: H('f1') });
  // Rewrite the stored line's event_hash while keeping its witness_head and timestamp.
  const lines = fs.readFileSync(jp, 'utf8').trim().split('\n');
  const tampered = { ...JSON.parse(lines[0]), event_hash: H('f1-tampered') };
  fs.writeFileSync(jp, `${JSON.stringify(tampered)}\n`);
  const w2 = new HostWitnessAdapter({ streamId: 'stream-f', journalPath: jp });
  assert.equal(w2.getAppendTimestamp({ witness_head: receipt.witness_head }), null,
    'a tampered line must not yield an anchored timestamp');
  assert.equal(w2.verify(receipt), false);
  ok('tampered_journal_rejected');
}

// --- 9. atomic batch: all-or-nothing, verifiable as a batch ----------------------
{
  const w = new HostWitnessAdapter({ streamId: 'stream-g', journalPath: journal('g') });
  const batch = w.appendBatchIfHead({
    expected_witness_head: null,
    stream_id: 'stream-g',
    run_id: 'run-6',
    batch_id: 'batch-1',
    events: [
      { sequence: 1, event_hash: H('g1') },
      { sequence: 2, event_hash: H('g2') },
    ],
  });
  assert.equal(batch.receipts.length, 2);
  assert.equal(batch.witness_head, batch.receipts[1].witness_head);
  assert.equal(w.getHead(), batch.witness_head);
  assert.equal(w.verifyBatch(batch), true);
  // A batch claiming a head it does not end on is not verifiable.
  assert.equal(w.verifyBatch({ ...batch, witness_head: H('wrong') }), false);
  // Stale head is refused for batches too.
  assert.throws(
    () => w.appendBatchIfHead({
      expected_witness_head: null, stream_id: 'stream-g', run_id: 'run-6',
      batch_id: 'batch-2', events: [{ sequence: 3, event_hash: H('g3') }],
    }),
    (error) => error.code === 'WITNESS_HEAD_STALE',
  );
  ok('atomic_batch_contract');
}

// --- 10. cross-stream isolation --------------------------------------------------
{
  const shared = journal('h');
  const wa = new HostWitnessAdapter({ streamId: 'stream-h1', journalPath: shared });
  const wb = new HostWitnessAdapter({ streamId: 'stream-h2', journalPath: shared });
  const ra = wa.append({ run_id: 'run-7', sequence: 1, event_hash: H('h1') });
  assert.equal(wb.getHead(), null, 'a second stream must not inherit another stream head');
  assert.equal(wb.verify(ra), false, 'a stream must not verify another stream receipt');
  ok('cross_stream_isolation');
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(results.join('\n'));
NODE
)"
rc=$?
if [ "$rc" -ne 0 ]; then
  printf '%s\n' "$OUT"
  fail "host-witness-adapter node assertions failed (rc=$rc)"
else
  printf '%s\n' "$OUT"
fi

assert_contains "$OUT" "canonical_json_parity=ok" "canonical JSON must stay byte-identical to the repo implementation"
assert_contains "$OUT" "external_trust_tier_accepted=ok" "adapter must satisfy the kernel gate without allowTestWitness"
assert_contains "$OUT" "test_witness_still_refused=ok" "MemoryWitness must remain refused as production authority"
assert_contains "$OUT" "durable_head_recovery=ok" "head must survive adapter reconstruction"
assert_contains "$OUT" "compare_and_append_rejects_stale=ok" "stale-head appends must be refused"
assert_contains "$OUT" "caller_time_rejected=ok" "caller-supplied time must be rejected, not ignored"
assert_contains "$OUT" "anchored_timestamp_from_adapter_state=ok" "timestamps must resolve from adapter-owned state"
assert_contains "$OUT" "tampered_journal_rejected=ok" "a tampered journal line must not yield a timestamp"
assert_contains "$OUT" "atomic_batch_contract=ok" "batch append must be atomic and verifiable"
assert_contains "$OUT" "cross_stream_isolation=ok" "streams sharing a journal must stay isolated"

finalize_test
