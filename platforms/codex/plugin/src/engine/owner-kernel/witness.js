'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
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

function normalizeWitnessBinding(witness) {
  if (!witness || typeof witness !== 'object'
    || !Object.prototype.hasOwnProperty.call(witness, 'identity')
    || !Object.prototype.hasOwnProperty.call(witness, 'attestation_hash')
    || !Object.prototype.hasOwnProperty.call(witness, 'protocol_version')
    || typeof witness.identity !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(witness.identity)
    || !isSha256(witness.attestation_hash) || witness.protocol_version !== 1) {
    throw new OwnerKernelError(
      'authority-enabled Owner Kernel runs require witness identity, attestation_hash, and protocol_version 1',
      'WITNESS_BINDING_REQUIRED',
    );
  }
  return {
    identity: witness.identity,
    attestation_hash: witness.attestation_hash.toLowerCase(),
    protocol_version: 1,
  };
}

class MemoryWitness {
  constructor({ streamId } = {}) {
    if (typeof streamId !== 'string' || streamId.length === 0) {
      throw new OwnerKernelError('MemoryWitness requires a non-empty streamId', 'INVALID_WITNESS');
    }
    this.streamId = streamId;
    // This class lives in the model-process runtime and is permanently test-only.
    // Production callers must inject a separate host-resident witness adapter.
    Object.defineProperty(this, 'trustTier', {
      value: 'test',
      enumerable: true,
      writable: false,
      configurable: false,
    });
    this.identity = `memory-witness:${streamId}`;
    this.attestation_hash = sha256(`memory-witness:${streamId}`);
    this.protocol_version = 1;
    this._head = null;
    this._receipts = [];
    this._batches = new Map();
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

  appendIfHead(request) {
    if (request.expected_witness_head !== this._head) {
      throw new OwnerKernelError('witness compare-and-append head does not match', 'WITNESS_HEAD_STALE');
    }
    const { expected_witness_head: _expectedWitnessHead, ...appendRequest } = request;
    return this.append(appendRequest);
  }

  appendBatchIfHead(request) {
    if (!request || typeof request !== 'object' || request.expected_witness_head !== this._head
      || request.stream_id !== this.streamId || typeof request.run_id !== 'string'
      || typeof request.batch_id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.batch_id)
      || !Array.isArray(request.events) || request.events.length === 0) {
      throw new OwnerKernelError('invalid witness atomic batch request', 'INVALID_WITNESS_REQUEST');
    }
    const eventHashes = request.events.map((event) => event && event.event_hash);
    const batchCommitment = sha256(canonicalJson({
      run_id: request.run_id,
      stream_id: this.streamId,
      batch_id: request.batch_id,
      expected_witness_head: request.expected_witness_head,
      event_hashes: eventHashes,
    }));
    if (request.batch_commitment !== undefined && request.batch_commitment !== batchCommitment) {
      throw new OwnerKernelError('witness atomic batch commitment does not match requested event set', 'INVALID_WITNESS_REQUEST');
    }
    if (request.coordinator_commitment !== undefined
      && (!request.coordinator_commitment || typeof request.coordinator_commitment !== 'object'
        || Array.isArray(request.coordinator_commitment))) {
      throw new OwnerKernelError('witness atomic batch coordinator commitment is invalid', 'INVALID_WITNESS_REQUEST');
    }
    let previousWitnessHead = this._head;
    const receipts = [];
    for (const [index, event] of request.events.entries()) {
      if (!event || typeof event !== 'object' || !isSha256(event.event_hash)
        || !Number.isInteger(event.sequence) || event.sequence < 1) {
        throw new OwnerKernelError('invalid witness atomic batch event', 'INVALID_WITNESS_REQUEST');
      }
      if (index > 0 && event.sequence !== request.events[index - 1].sequence + 1) {
        throw new OwnerKernelError('witness atomic batch sequences must be contiguous', 'INVALID_WITNESS_REQUEST');
      }
      const receiptBase = {
        run_id: request.run_id,
        stream_id: this.streamId,
        sequence: event.sequence,
        event_hash: event.event_hash,
        previous_witness_head: previousWitnessHead,
      };
      const receipt = {
        ...receiptBase,
        witness_head: sha256(canonicalJson(receiptBase)),
        batch_id: request.batch_id,
        batch_index: index,
        batch_size: request.events.length,
        batch_event_hashes: [...eventHashes],
        batch_commitment: batchCommitment,
        ...(request.coordinator_commitment === undefined
          ? {}
          : { coordinator_commitment: cloneCanonical(request.coordinator_commitment) }),
      };
      receipts.push(receipt);
      previousWitnessHead = receipt.witness_head;
    }
    this._head = previousWitnessHead;
    this._receipts.push(...receipts);
    this._batches.set(batchCommitment, {
      batch_id: request.batch_id,
      receipts: receipts.map((receipt) => ({ ...receipt })),
    });
    return { receipts: receipts.map((receipt) => ({ ...receipt })) };
  }

  verifyBatch(receipts) {
    if (!Array.isArray(receipts) || receipts.length === 0) return false;
    const first = receipts[0];
    if (!first || typeof first.batch_id !== 'string' || !Number.isInteger(first.batch_size)
      || first.batch_size !== receipts.length || !Array.isArray(first.batch_event_hashes)
      || !isSha256(first.batch_commitment)) return false;
    const known = this._batches.get(first.batch_commitment);
    if (!known || known.batch_id !== first.batch_id || known.receipts.length !== receipts.length) return false;
    return receipts.every((receipt, index) => {
      const expected = known.receipts[index];
      return receipt && receipt.batch_id === first.batch_id
        && receipt.batch_index === index
        && receipt.batch_size === receipts.length
        && canonicalJson(receipt.batch_event_hashes) === canonicalJson(first.batch_event_hashes)
        && receipt.batch_commitment === first.batch_commitment
        && receipt.event_hash === first.batch_event_hashes[index]
        && canonicalJson(receipt) === canonicalJson(expected)
        && this.verify(receipt);
    });
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

  getHead() {
    return this._head;
  }
}

function assertWitnessAdapter(witness, {
  allowTestWitness = false,
  requireCompareAndAppend = false,
  requireBatch = false,
  requireBinding = false,
} = {}) {
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
  if (requireCompareAndAppend) {
    if (typeof witness.appendIfHead !== 'function') {
      throw new OwnerKernelError(
        'authority-enabled Owner Kernel runs require witness.appendIfHead() compare-and-append',
        'WITNESS_COMPARE_AND_APPEND_REQUIRED',
      );
    }
    if (typeof witness.getHead !== 'function') {
      throw new OwnerKernelError(
        'authority-enabled Owner Kernel runs require witness.getHead() head probing',
        'WITNESS_HEAD_REQUIRED',
      );
    }
  }
  if (requireBatch && typeof witness.appendBatchIfHead !== 'function') {
    throw new OwnerKernelError(
      'serializable acceptance requires witness.appendBatchIfHead() atomic batch compare-and-append',
      'WITNESS_BATCH_REQUIRED',
    );
  }
  if (requireBatch && typeof witness.verifyBatch !== 'function') {
    throw new OwnerKernelError(
      'serializable acceptance requires witness.verifyBatch() atomic batch receipt verification',
      'WITNESS_BATCH_REQUIRED',
    );
  }
  if (requireBinding) normalizeWitnessBinding(witness);
  return witness;
}

module.exports = {
  MemoryWitness,
  assertWitnessAdapter,
  normalizeWitnessBinding,
  verifyReceiptShape,
};
