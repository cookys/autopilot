'use strict';

const { canonicalJson, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');

function requireReceiptField(receipt, name) {
  if (!Object.prototype.hasOwnProperty.call(receipt, name)) {
    throw new OwnerKernelError(`witness receipt is missing ${name}`, 'INVALID_WITNESS_RECEIPT');
  }
  return receipt[name];
}

function verifyReceiptShape(receipt, expected = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new OwnerKernelError('witness receipt must be an object', 'INVALID_WITNESS_RECEIPT');
  }
  const runId = requireReceiptField(receipt, 'run_id');
  const streamId = requireReceiptField(receipt, 'stream_id');
  const sequence = requireReceiptField(receipt, 'sequence');
  const eventHash = requireReceiptField(receipt, 'event_hash');
  const previousWitnessHead = requireReceiptField(receipt, 'previous_witness_head');
  const witnessHead = requireReceiptField(receipt, 'witness_head');
  if (typeof runId !== 'string' || runId.length === 0
    || typeof streamId !== 'string' || streamId.length === 0
    || !Number.isInteger(sequence) || sequence < 1
    || !isSha256(eventHash) || !isSha256(witnessHead)
    || (previousWitnessHead !== null && !isSha256(previousWitnessHead))) {
    throw new OwnerKernelError('witness receipt has invalid fields', 'INVALID_WITNESS_RECEIPT');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) {
      throw new OwnerKernelError(`witness receipt ${key} does not match event`, 'INVALID_WITNESS_RECEIPT');
    }
  }
  return true;
}

class MemoryWitness {
  constructor({ streamId } = {}) {
    if (typeof streamId !== 'string' || streamId.length === 0) {
      throw new OwnerKernelError('MemoryWitness requires a non-empty streamId', 'INVALID_WITNESS');
    }
    this.streamId = streamId;
    // This class lives in the model-process runtime and is permanently test-only.
    // Production callers must inject a separate host-resident witness adapter.
    this.trustTier = 'test';
    this._head = null;
    this._receipts = [];
  }

  append(request) {
    const expected = {
      run_id: request.run_id,
      stream_id: this.streamId,
      sequence: request.sequence,
      event_hash: request.event_hash,
      previous_witness_head: this._head,
    };
    if (!isSha256(request.event_hash) || !Number.isInteger(request.sequence) || request.sequence < 1) {
      throw new OwnerKernelError('invalid witness append request', 'INVALID_WITNESS_REQUEST');
    }
    const witnessHead = sha256(canonicalJson(expected));
    const receipt = { ...expected, witness_head: witnessHead };
    this._head = witnessHead;
    this._receipts.push(receipt);
    return { ...receipt };
  }

  verify(receipt) {
    try {
      verifyReceiptShape(receipt, { stream_id: this.streamId });
      const expectedHead = sha256(canonicalJson({
        run_id: receipt.run_id,
        stream_id: receipt.stream_id,
        sequence: receipt.sequence,
        event_hash: receipt.event_hash,
        previous_witness_head: receipt.previous_witness_head,
      }));
      return receipt.witness_head === expectedHead && this._receipts.some((known) => (
        known.witness_head === receipt.witness_head
        && known.run_id === receipt.run_id
        && known.sequence === receipt.sequence
      ));
    } catch (_error) {
      return false;
    }
  }

  get head() {
    return this._head;
  }
}

function assertWitnessAdapter(witness, { allowTestWitness = false } = {}) {
  if (!witness || typeof witness !== 'object'
    || typeof witness.streamId !== 'string' || witness.streamId.length === 0
    || typeof witness.append !== 'function' || typeof witness.verify !== 'function') {
    throw new OwnerKernelError(
      'Owner Kernel requires a witness adapter with streamId, append(), and verify()',
      'WITNESS_REQUIRED',
    );
  }
  if (!allowTestWitness && witness.trustTier !== 'external') {
    throw new OwnerKernelError(
      'test/local witness adapters cannot activate autonomous Owner Kernel runs',
      'UNTRUSTED_WITNESS',
    );
  }
  return witness;
}

module.exports = {
  MemoryWitness,
  assertWitnessAdapter,
  verifyReceiptShape,
};
