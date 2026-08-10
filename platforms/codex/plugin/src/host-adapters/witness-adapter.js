'use strict';

/**
 * Host-resident production witness adapter.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/engine/owner-kernel/witness.js` ships `MemoryWitness`, which hard-sets
 * `trustTier: 'test'` and states in its own comment: "Production callers must inject a
 * separate host-resident witness adapter." That adapter was never written. Every P0-P4
 * suite therefore ran against a witness the release gate explicitly refuses
 * (`check-owner-kernel-release-gates.js` requires `trustTier === 'external'`), which is
 * why the Owner Kernel sat complete-but-inert: not a clock that had not started, but a
 * component that did not exist. This is that component.
 *
 * DEPLOYMENT BOUNDARY — read before editing
 * -----------------------------------------
 * This file is SOURCE. The deployed copy must live OUTSIDE the repo and outside the
 * project evidence directory: `loadTrustedWitnessAdapterBinding` refuses an
 * `adapter_module` that resolves inside either, and pins the deployed bytes by sha256.
 *
 * Consequently this module MUST stay dependency-free — Node built-ins only, and no
 * `require()` of anything in this repository. Requiring repo code from the deployed copy
 * would re-anchor host trust to the workspace the boundary exists to exclude. The
 * canonical-JSON implementation below is duplicated from
 * `src/engine/owner-kernel/canonical.js` for exactly that reason; byte-parity between the
 * two is enforced by `hooks/tests/host-witness-adapter.test.sh`, not by convention.
 *
 * WHAT MAKES A TIMESTAMP TRUSTWORTHY HERE
 * ---------------------------------------
 * The checker sanitises every time-shaped field out of a receipt before calling
 * `getAppendTimestamp()`, so an adapter cannot launder a caller-supplied time back. This
 * adapter stamps `append_timestamp` itself, from the host clock, at the moment the append
 * is durably written — and never accepts one from a request. Callers that supply
 * time-shaped fields are rejected rather than ignored.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TRUST_TIER = 'external';
const ADAPTER_PROTOCOL_VERSION = 1;

/**
 * Where the deployed adapter keeps its own append state.
 *
 * The release checker constructs this adapter through `createAuthority()` and passes
 * NO journal location — deliberately: "Adapter must own append-time state, not caller
 * journal fields." So the location is the adapter's, not the caller's. It must sit
 * outside the repo and outside any project evidence directory, and in production it
 * should be writable only by the account that runs the host.
 */
const DEFAULT_JOURNAL_ROOT = '/var/lib/autopilot/witness';
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;
const LOCK_MAX_WAIT_MS = 10_000;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Time-shaped fields a caller must never supply; the adapter owns append time. */
const CALLER_FORBIDDEN_TIME_FIELDS = Object.freeze([
  'append_timestamp',
  'observation_timestamp',
  'observed_at',
  'appended_at',
  'witnessed_at',
  'issued_at',
  'timestamp',
  'time',
]);

class WitnessAdapterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WitnessAdapterError';
    this.code = code || 'WITNESS_ADAPTER_ERROR';
  }
}

// ---------------------------------------------------------------------------
// Canonical JSON — byte-identical to src/engine/owner-kernel/canonical.js.
// Duplicated because the deployed copy cannot require() repo code (see header).
// ---------------------------------------------------------------------------

function assertJsonString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('canonical JSON rejects lone high-surrogate characters');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('canonical JSON rejects lone low-surrogate characters');
    }
  }
}

function canonicalJson(value, jsonPath = '$') {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonical JSON rejects non-finite number at ${jsonPath}`);
      }
      return JSON.stringify(value);
    case 'string':
      assertJsonString(value);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonical JSON rejects ${typeof value} at ${jsonPath}`);
  }

  if (Array.isArray(value)) {
    const values = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`canonical JSON rejects sparse array at ${jsonPath}`);
      }
      values.push(canonicalJson(value[index], `${jsonPath}[${index}]`));
    }
    return `[${values.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`canonical JSON accepts plain objects only at ${jsonPath}`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`canonical JSON rejects symbol properties at ${jsonPath}`);
  }

  const keys = Object.keys(value).sort();
  const entries = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`canonical JSON rejects accessor property at ${jsonPath}.${key}`);
    }
    assertJsonString(key);
    entries.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value, `${jsonPath}.${key}`)}`);
  }
  return `{${entries.join(',')}}`;
}

function sha256(value) {
  const source = typeof value === 'string' ? value : canonicalJson(value);
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

const isSha256 = (value) => typeof value === 'string' && SHA256_PATTERN.test(value);

// ---------------------------------------------------------------------------
// Durable append-only journal with cross-process exclusion.
// ---------------------------------------------------------------------------

function assertNoCallerTime(request, label) {
  for (const field of CALLER_FORBIDDEN_TIME_FIELDS) {
    if (request && Object.prototype.hasOwnProperty.call(request, field)) {
      throw new WitnessAdapterError(
        `${label} must not supply ${field}; append time is adapter-owned`,
        'CALLER_SUPPLIED_TIME',
      );
    }
  }
}

class HostWitnessAdapter {
  /**
   * @param {object} options
   * @param {string} options.streamId  Stream this adapter witnesses; must equal the
   *   `stream_id` in the installed authority config.
   * @param {string} options.journalPath  Absolute path to the append-only JSONL journal.
   *   Must live outside the repo and outside the project evidence dir.
   */
  constructor({ streamId, journalPath } = {}) {
    if (typeof streamId !== 'string' || streamId.length === 0) {
      throw new WitnessAdapterError('HostWitnessAdapter requires a non-empty streamId', 'INVALID_STREAM');
    }
    if (typeof journalPath !== 'string' || !path.isAbsolute(journalPath)) {
      throw new WitnessAdapterError(
        'HostWitnessAdapter requires an absolute journalPath',
        'INVALID_JOURNAL_PATH',
      );
    }
    // normalizeWitnessBinding() enforces /^[A-Za-z0-9._:-]{1,128}$/ on identity, and
    // identity embeds streamId. Reject here with a clear reason rather than letting the
    // kernel's binding check fail later with a message about a field the operator never set.
    const identity = `host-witness:${streamId}`;
    if (!ID_PATTERN.test(identity)) {
      throw new WitnessAdapterError(
        `streamId yields an identity outside /^[A-Za-z0-9._:-]{1,128}$/: ${identity}`,
        'INVALID_STREAM',
      );
    }
    this.streamId = streamId;
    this.journalPath = journalPath;
    this.lockPath = `${journalPath}.lock`;
    this.protocol_version = ADAPTER_PROTOCOL_VERSION;
    this.identity = identity;
    this.attestation_hash = sha256(identity);

    // Non-writable so a caller cannot downgrade or forge the tier the release gate reads.
    Object.defineProperty(this, 'trustTier', {
      value: TRUST_TIER,
      enumerable: true,
      writable: false,
      configurable: false,
    });

    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    if (!fs.existsSync(journalPath)) {
      const fd = fs.openSync(journalPath, 'a');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
  }

  // --- locking ---------------------------------------------------------------

  _acquireLock() {
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, canonicalJson({ pid: process.pid, acquired_at: new Date().toISOString() }));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Reclaim a lock whose holder died without releasing it.
        let stat = null;
        try {
          stat = fs.statSync(this.lockPath);
        } catch (_ignored) {
          continue;
        }
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          try {
            fs.unlinkSync(this.lockPath);
          } catch (_ignored) { /* another process reclaimed it first */ }
          continue;
        }
        if (Date.now() > deadline) {
          throw new WitnessAdapterError(
            `witness journal lock not acquired within ${LOCK_MAX_WAIT_MS}ms`,
            'LOCK_TIMEOUT',
          );
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
      }
    }
  }

  _releaseLock() {
    try {
      fs.unlinkSync(this.lockPath);
    } catch (_ignored) { /* already released */ }
  }

  _withLock(fn) {
    this._acquireLock();
    try {
      return fn();
    } finally {
      this._releaseLock();
    }
  }

  // --- journal ---------------------------------------------------------------

  _readRecords() {
    let raw;
    try {
      raw = fs.readFileSync(this.journalPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (_error) {
        throw new WitnessAdapterError(
          'witness journal contains an unparseable line; refusing to guess head',
          'JOURNAL_CORRUPT',
        );
      }
      if (parsed && parsed.stream_id === this.streamId) records.push(parsed);
    }
    return records;
  }

  /** Durably append one record. Caller must hold the lock. */
  _appendRecord(record) {
    const fd = fs.openSync(this.journalPath, 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  _headFrom(records) {
    if (records.length === 0) return null;
    return records[records.length - 1].witness_head;
  }

  // --- witness contract ------------------------------------------------------

  getHead() {
    return this._withLock(() => this._headFrom(this._readRecords()));
  }

  get head() {
    return this.getHead();
  }

  /** Build the receipt for an append against a known previous head. */
  _receiptFor(request, previousHead) {
    if (!isSha256(request.event_hash)
      || !Number.isInteger(request.sequence)
      || request.sequence < 1) {
      throw new WitnessAdapterError('invalid witness append request', 'INVALID_WITNESS_REQUEST');
    }
    if (typeof request.run_id !== 'string' || request.run_id.length === 0) {
      throw new WitnessAdapterError('witness append requires run_id', 'INVALID_WITNESS_REQUEST');
    }
    const expected = {
      run_id: request.run_id,
      stream_id: this.streamId,
      sequence: request.sequence,
      event_hash: request.event_hash,
      previous_witness_head: previousHead,
    };
    return { ...expected, witness_head: sha256(canonicalJson(expected)) };
  }

  append(request) {
    assertNoCallerTime(request, 'witness append request');
    return this._withLock(() => {
      const records = this._readRecords();
      const receipt = this._receiptFor(request, this._headFrom(records));
      // Adapter-owned anchored time, taken at durable-write, never from the caller.
      this._appendRecord({ ...receipt, append_timestamp: new Date().toISOString() });
      return { ...receipt };
    });
  }

  appendIfHead(request) {
    assertNoCallerTime(request, 'witness compare-and-append request');
    return this._withLock(() => {
      const records = this._readRecords();
      const head = this._headFrom(records);
      if (request.expected_witness_head !== head) {
        throw new WitnessAdapterError(
          'witness compare-and-append head does not match',
          'WITNESS_HEAD_STALE',
        );
      }
      const { expected_witness_head: _ignored, ...appendRequest } = request;
      const receipt = this._receiptFor(appendRequest, head);
      this._appendRecord({ ...receipt, append_timestamp: new Date().toISOString() });
      return { ...receipt };
    });
  }

  appendBatchIfHead(request) {
    assertNoCallerTime(request, 'witness batch request');
    if (!request || typeof request !== 'object'
      || request.stream_id !== this.streamId
      || typeof request.run_id !== 'string' || request.run_id.length === 0
      || typeof request.batch_id !== 'string' || !ID_PATTERN.test(request.batch_id)
      || !Array.isArray(request.events) || request.events.length === 0) {
      throw new WitnessAdapterError('invalid witness atomic batch request', 'INVALID_WITNESS_REQUEST');
    }
    return this._withLock(() => {
      const records = this._readRecords();
      const head = this._headFrom(records);
      if (request.expected_witness_head !== head) {
        throw new WitnessAdapterError(
          'witness batch compare-and-append head does not match',
          'WITNESS_HEAD_STALE',
        );
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
        throw new WitnessAdapterError(
          'witness atomic batch commitment does not match requested event set',
          'INVALID_WITNESS_REQUEST',
        );
      }
      // All-or-nothing: build every receipt first, then write them under one lock hold.
      let chainHead = head;
      const receipts = [];
      for (const event of request.events) {
        const receipt = this._receiptFor({ run_id: request.run_id, ...event }, chainHead);
        receipts.push(receipt);
        chainHead = receipt.witness_head;
      }
      const stamped = new Date().toISOString();
      for (const receipt of receipts) {
        this._appendRecord({ ...receipt, append_timestamp: stamped, batch_id: request.batch_id });
      }
      return {
        batch_id: request.batch_id,
        batch_commitment: batchCommitment,
        witness_head: chainHead,
        receipts: receipts.map((receipt) => ({ ...receipt })),
      };
    });
  }

  /** True when the receipt is well-formed AND this adapter actually issued it. */
  verify(receipt) {
    try {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
      if (receipt.stream_id !== this.streamId) return false;
      if (typeof receipt.run_id !== 'string' || receipt.run_id.length === 0) return false;
      if (!Number.isInteger(receipt.sequence) || receipt.sequence < 1) return false;
      if (!isSha256(receipt.event_hash) || !isSha256(receipt.witness_head)) return false;
      if (receipt.previous_witness_head !== null && !isSha256(receipt.previous_witness_head)) {
        return false;
      }
      const expectedHead = sha256(canonicalJson({
        run_id: receipt.run_id,
        stream_id: receipt.stream_id,
        sequence: receipt.sequence,
        event_hash: receipt.event_hash,
        previous_witness_head: receipt.previous_witness_head,
      }));
      if (receipt.witness_head !== expectedHead) return false;
      return this._withLock(() => this._readRecords().some((known) => {
        if (known.witness_head !== receipt.witness_head
          || known.run_id !== receipt.run_id
          || known.sequence !== receipt.sequence) {
          return false;
        }
        // Re-derive the stored line's own head. Matching on (head, run_id, sequence)
        // alone would accept a journal line whose other fields were rewritten — the
        // stored head is only meaningful if the line still hashes to it.
        const storedHead = sha256(canonicalJson({
          run_id: known.run_id,
          stream_id: known.stream_id,
          sequence: known.sequence,
          event_hash: known.event_hash,
          previous_witness_head: known.previous_witness_head,
        }));
        return storedHead === known.witness_head;
      }));
    } catch (_error) {
      return false;
    }
  }

  verifyBatch(batch) {
    try {
      if (!batch || typeof batch !== 'object' || !Array.isArray(batch.receipts)
        || batch.receipts.length === 0
        || typeof batch.batch_id !== 'string' || !ID_PATTERN.test(batch.batch_id)) {
        return false;
      }
      const records = this._withLock(() => this._readRecords());
      for (const receipt of batch.receipts) {
        if (!this.verify(receipt)) return false;
        const stored = records.find((known) => known.witness_head === receipt.witness_head);
        if (!stored || stored.batch_id !== batch.batch_id) return false;
      }
      const last = batch.receipts[batch.receipts.length - 1];
      return batch.witness_head === last.witness_head;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Adapter-owned anchored append time for a receipt this adapter issued.
   *
   * The checker strips every time-shaped field from the receipt before calling this, so
   * the lookup must resolve against the adapter's own durable state. Returns an ISO-8601
   * UTC string, or null when this adapter did not issue the receipt.
   */
  getAppendTimestamp(receipt) {
    if (!receipt || typeof receipt !== 'object') return null;
    const head = receipt.witness_head;
    if (!isSha256(head)) return null;
    const records = this._withLock(() => this._readRecords());
    const stored = records.find((known) => known.witness_head === head);
    if (!stored || typeof stored.append_timestamp !== 'string') return null;
    // Re-derive rather than trust the stored receipt fields, so a tampered journal line
    // cannot map a forged receipt onto a genuine timestamp.
    const expectedHead = sha256(canonicalJson({
      run_id: stored.run_id,
      stream_id: stored.stream_id,
      sequence: stored.sequence,
      event_hash: stored.event_hash,
      previous_witness_head: stored.previous_witness_head,
    }));
    if (expectedHead !== head) return null;
    return stored.append_timestamp;
  }
}

/**
 * Factory the release checker looks for. It requires the deployed module to export
 * `createAuthority()` or `createWitness()`, and calls it with the authority config's
 * stream and journal — never with a storage location.
 *
 * The `receipts` / `receipt_journal` the checker passes come from the installed
 * authority config and are DELIBERATELY NOT trusted as state here. They are the claims
 * to be checked; this adapter's own durable journal is what checks them. Seeding
 * in-memory state from them would let a config assert its own history, which is the
 * whole failure the external-witness boundary exists to prevent.
 *
 * @param {object} options
 * @param {string} options.streamId     Stream to witness (from the authority config).
 * @param {string} [options.journalRoot] Deployment override for the adapter's own
 *   storage root. Not supplied by the checker; present so an operator can place state
 *   on a specific volume. It is not a trust input — adapter integrity comes from the
 *   sha256 pin in the adapter binding.
 */
function createAuthority({ streamId, journalRoot } = {}) {
  if (typeof streamId !== 'string' || streamId.length === 0) {
    throw new WitnessAdapterError('createAuthority requires a non-empty streamId', 'INVALID_STREAM');
  }
  const root = typeof journalRoot === 'string' && journalRoot.length > 0
    ? journalRoot
    : DEFAULT_JOURNAL_ROOT;
  if (!path.isAbsolute(root)) {
    throw new WitnessAdapterError('journalRoot must be an absolute path', 'INVALID_JOURNAL_PATH');
  }
  // Keep the stream out of path semantics: no separators, no traversal, no surprises.
  const safeStream = streamId.replace(/[^A-Za-z0-9._-]/g, '_');
  return new HostWitnessAdapter({
    streamId,
    journalPath: path.join(root, `${safeStream}.jsonl`),
  });
}

module.exports = {
  HostWitnessAdapter,
  WitnessAdapterError,
  ADAPTER_PROTOCOL_VERSION,
  DEFAULT_JOURNAL_ROOT,
  // The factory name the release checker resolves.
  createAuthority,
  createWitness: createAuthority,
  // Exported for the parity test only; not part of the witness contract.
  __canonical: { canonicalJson, sha256 },
};
