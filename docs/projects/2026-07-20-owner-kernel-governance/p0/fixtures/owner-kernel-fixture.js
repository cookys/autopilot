#!/usr/bin/env node
/**
 * owner-kernel-fixture.js — DISPOSABLE P0 fixture. NOT product code. NOT a Kernel implementation.
 *
 * Plan P0 step 5 calls for frozen baseline fixtures; step 6 for a run against "the minimum proposed
 * JSONL event fields". This file is that minimum, and nothing more: a throwaway reference object
 * that encodes what an Owner Kernel *would have to enforce*, so the eight named step-4 attacks can
 * be executed against something real instead of being deferred for want of a target.
 *
 * SCOPE AND AUTHORITY — read before using any result derived from this file.
 *
 *   Inside a single run, the fixture instance IS the authoritative object. Attacks mutate it
 *   directly; nothing here attacks a copy of something else, which was the unsound scope of an
 *   earlier P0 revision.
 *
 *   A passing attack proves a property of THIS FIXTURE'S CONTRACT — that the proposed design
 *   detects or rejects the attack. It proves NOTHING about any host's capability to provide the
 *   substrate that contract needs, and NOTHING about a future production implementation.
 *
 *   Depth-0 Owner decision (recorded): every attack here MUST be repeated against the production
 *   implementation at P1 exit before any host may be classified `full` or `partial`. Fixture
 *   results are a design gate, never a host qualification.
 *
 * Node built-ins only. Deterministic: no Date.now(), no randomness in the contract path — the
 * caller supplies a logical clock and nonces so runs are byte-reproducible.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Canonical serialization for hashing — sorted keys, no generation metadata. */
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  return '{' + Object.keys(obj).sort()
    .filter((k) => k !== 'content_hash' && k !== 'prev_hash')
    .map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

/**
 * Emitter-authority matrix (plan P1 step 2, reduced to the minimum P0 needs).
 * Which channel is permitted to mint which event type.
 */
const MINT_RULES = {
  intent:          { channel: 'authenticated_user', needs_capability: false },
  approval:        { channel: 'authenticated_user', needs_capability: false },
  abort:           { channel: 'authenticated_user', needs_capability: false },
  decision:        { channel: 'owner_turn',         needs_capability: true  },
  evidence:        { channel: 'kernel',             needs_capability: false },
  checkpoint:      { channel: 'kernel',             needs_capability: false },
  acceptance:      { channel: 'kernel',             needs_capability: false },
};

class FixtureRejection extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; }
}

class OwnerKernelFixture {
  /**
   * @param {string} dir            disposable run directory (created fresh per run)
   * @param {object} opts
   * @param {string} opts.witnessKey  authenticated-user witness key; held in memory only
   * @param {string} opts.capability  active-owner capability; held in memory only, never serialized
   * @param {object} opts.policy      governance policy, hash-frozen at intake
   * @param {object} opts.capabilitySet host capability set, hash-frozen at intake
   */
  constructor(dir, opts) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.ledgerPath = path.join(dir, 'events.jsonl');
    this.witnessPath = path.join(dir, 'witness-receipts.jsonl');
    fs.writeFileSync(this.ledgerPath, '');
    fs.writeFileSync(this.witnessPath, '');

    // In-memory only. Never written to disk — that is the whole point of R1/R2.
    this._witnessKey = opts.witnessKey;
    this._capability = opts.capability;

    this.policy = opts.policy;
    this.policyHash = sha256(canonical(opts.policy));
    this.capabilitySet = opts.capabilitySet;
    this.capabilitySetHash = sha256(canonical(opts.capabilitySet));

    this.head = 'genesis';
    this.seq = 0;
    this.approvedDecisions = new Map(); // decision_id -> {descriptor, uses_remaining}
  }

  /**
   * The ONLY append path. ctx carries the claimed authority; the fixture verifies it.
   * ctx = { channel, witnessKey?, capability?, emitter_id, source? }
   */
  append(event, ctx) {
    const rule = MINT_RULES[event.type];
    if (!rule) throw new FixtureRejection('unknown_event_type', event.type);

    // --- Emitter/channel authority -------------------------------------------------
    if (ctx.channel !== rule.channel) {
      throw new FixtureRejection('emitter_channel_mismatch',
        `${event.type} requires channel=${rule.channel}, got ${ctx.channel}`);
    }

    // --- Authenticated user channel: witness key must match the in-memory secret ----
    if (rule.channel === 'authenticated_user') {
      if (ctx.witnessKey !== this._witnessKey) {
        throw new FixtureRejection('witness_key_invalid', 'forged or absent user-channel witness');
      }
    }

    // --- Owner capability: must match the in-memory, non-exportable token ----------
    if (rule.needs_capability) {
      if (ctx.capability !== this._capability) {
        throw new FixtureRejection('capability_invalid', 'decision mint without valid owner capability');
      }
      // A decision payload must come from the owner turn envelope, never a worker artifact.
      if (ctx.source && ctx.source !== 'owner_turn_envelope') {
        throw new FixtureRejection('decision_source_invalid',
          `decision payload sourced from ${ctx.source}`);
      }
    }

    // --- Policy / capability-set drift --------------------------------------------
    if (sha256(canonical(this.policy)) !== this.policyHash) {
      throw new FixtureRejection('policy_drift', 'frozen policy mutated after intake');
    }
    if (sha256(canonical(this.capabilitySet)) !== this.capabilitySetHash) {
      throw new FixtureRejection('capability_set_drift', 'host capability set changed after intake');
    }

    // --- Hash chain + witness receipt ---------------------------------------------
    const row = Object.assign({}, event, {
      seq: this.seq,
      emitter_kind: rule.channel,
      emitter_id: ctx.emitter_id,
      prev_hash: this.head,
    });
    row.content_hash = sha256(canonical(row) + '|' + this.head);

    fs.appendFileSync(this.ledgerPath, JSON.stringify(row) + '\n');
    // External witness receipt: an independent record of each head, so a full-chain
    // recomputation of events.jsonl cannot silently pass verification.
    fs.appendFileSync(this.witnessPath, JSON.stringify({
      seq: this.seq, event_head: row.content_hash, prev_witnessed_head: this.head,
    }) + '\n');

    this.head = row.content_hash;
    this.seq += 1;

    if (event.type === 'approval') {
      this.approvedDecisions.set(event.decision_id, {
        descriptor: event.descriptor,
        uses_remaining: event.max_uses === undefined ? 1 : event.max_uses,
      });
    }
    return row;
  }

  /**
   * Pre-action mediator. A red-line action requires an approved decision whose descriptor
   * matches, with a use available. Consumes exactly one use atomically.
   */
  mediateRedLineAction(descriptor, decisionId) {
    const appr = this.approvedDecisions.get(decisionId);
    if (!appr) throw new FixtureRejection('no_matching_decision', descriptor);
    if (appr.descriptor !== descriptor) {
      throw new FixtureRejection('descriptor_mismatch',
        `approved for ${appr.descriptor}, attempted ${descriptor}`);
    }
    if (appr.uses_remaining <= 0) throw new FixtureRejection('approval_exhausted', descriptor);
    appr.uses_remaining -= 1;
    return { permitted: true, descriptor };
  }

  /**
   * Verify the local ledger chain and the independent witness receipt chain.
   * Detects single-row drift, broken prev links, and rewrite-from-genesis even when internal hashes
   * are recomputed consistently.
   */
  verifyAgainstWitness() {
    const rows = fs.readFileSync(this.ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const receipts = fs.readFileSync(this.witnessPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    if (rows.length !== receipts.length) {
      return { ok: false, reason: 'length_mismatch', rows: rows.length, receipts: receipts.length };
    }
    let expectedPrev = 'genesis';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const receipt = receipts[i];
      if (row.seq !== i || receipt.seq !== i) {
        return { ok: false, reason: 'seq_mismatch', seq: i };
      }
      if (row.prev_hash !== expectedPrev || receipt.prev_witnessed_head !== expectedPrev) {
        return { ok: false, reason: 'prev_hash_mismatch_at_seq', seq: i };
      }
      const expectedHash = sha256(canonical(row) + '|' + expectedPrev);
      if (row.content_hash !== expectedHash) {
        return { ok: false, reason: 'content_hash_mismatch_at_seq', seq: i };
      }
      if (row.content_hash !== receipt.event_head) {
        return { ok: false, reason: 'head_mismatch_at_seq', seq: i };
      }
      expectedPrev = row.content_hash;
    }
    return { ok: true };
  }

  /** Is the capability reachable from anything on disk? It must not be. */
  capabilityOnDisk() {
    const hits = [];
    for (const f of [this.ledgerPath, this.witnessPath]) {
      const body = fs.readFileSync(f, 'utf8');
      if (this._capability && body.includes(this._capability)) hits.push(f);
      if (this._witnessKey && body.includes(this._witnessKey)) hits.push(f);
    }
    return hits;
  }
}

module.exports = { OwnerKernelFixture, FixtureRejection, canonical, sha256, MINT_RULES };
