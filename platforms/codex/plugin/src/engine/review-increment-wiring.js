'use strict';

// BL-0146 D4: glue between the pure eligibility module (review-increment.js), the seat store
// (final-panel-seat-store.js) and the engine's returned-head review. Plan:
// docs/plans/2026-10-17-review-only-campaign-fix-increment.md sections 2.2, 2.4, 2.6.
//
// Everything here is re-derived on each call from Git, the campaign's gate journal and the stored
// seat artifacts (ADR-0001); no flag from the caller is trusted for a fact Git or the store can
// answer. Every refusal is `{ mode: 'full', reason }` and the engine then runs today's path.

const fs = require('fs');
const path = require('path');
const { evaluateReturnIncrement, computeFileDigests } = require('./review-increment');
const seatStore = require('./final-panel-seat-store');

// Reasons raised by this layer (the D1 module raises its own, see review-increment.js REASONS).
const WIRING_REASONS = Object.freeze([
  'station_not_panel',
  'seat_store_unavailable',
  'prior_round_unknown',
  'prior_round_unverified',
  'seat_not_carriable',
  'binding_unavailable',
  'evaluation_failed',
]);

const SHA256 = /^[0-9a-f]{64}$/;
const full = (reason) => ({ mode: 'full', reason });

// A normalized finding has no path field: the `path:line` the reviewer wrote sits at the start of
// its claim ("src/a.js:10 retry loop never ends"). First `path:line` token with a path-like shape.
function findingPathFromClaim(claim) {
  if (typeof claim !== 'string') return null;
  const match = /(?:^|[\s([`'"])((?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_@+-]+\.[A-Za-z0-9_+-]+|(?:[A-Za-z0-9_.@+-]+\/)+[A-Za-z0-9_.@+-]+):[0-9]+/.exec(claim);
  return match ? match[1] : null;
}

// The composition's gate journal keeps only input digests, so the facts a later return needs
// (spec digest, roster digest, the verification argv, the seat-store binding) are indexed here, one
// small file per reviewed head, written only for campaigns that opted in. It is a pointer, not an
// attestation (ADR-0001): the tree and the diff digest are re-derived from Git, the binding is
// re-derived from its own parts, and the seat artifacts it points at re-derive through the seat
// store. A record that disagrees with any of that is treated as absent.
function roundRecordFile(root, campaignId, head) {
  if (typeof root !== 'string' || root.length === 0 || typeof campaignId !== 'string'
      || campaignId.length === 0 || typeof head !== 'string' || !/^[0-9a-f]{40,64}$/.test(head)) return null;
  return path.join(campaignDir(root, campaignId), `round-${head}.json`);
}

function writeRoundRecord({ root, campaignId, record }) {
  try {
    const file = roundRecordFile(root, campaignId, record && record.head);
    if (!file) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`);
    fs.renameSync(tmp, file);
    return true;
  } catch (_error) {
    return false;
  }
}

function readRoundRecord({ root, campaignId, head }) {
  try {
    const file = roundRecordFile(root, campaignId, head);
    if (!file) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.head === head ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function campaignDir(root, campaignId) {
  return path.join(root, String(campaignId).replace(/[^A-Za-z0-9._-]/g, '_'));
}

function listDirs(dir, prefix) {
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && SHA256.test(name.slice(prefix.length)))
      .map((name) => name.slice(prefix.length));
  } catch (_error) {
    return [];
  }
}

// Prior round artifacts for `treeSha`, re-derived through the seat store's own rules (artifact
// type, binding, tuple, findings re-normalise, review_digest re-derives). A directory's binding
// is only accepted when the artifacts it holds carry that very binding. Returns
// { status: 'none'|'ambiguous'|'found', binding, seats: [outcome|null] }.
function findPriorPanelArtifacts({
  root, campaignId, station, treeSha, seats, canonicalDigest, onlyBinding,
}) {
  const bindings = listDirs(campaignDir(root, campaignId), `${station}-`)
    .filter((binding) => onlyBinding === undefined || binding === onlyBinding);
  const hits = [];
  for (const binding of bindings) {
    const perSeat = seats.map((seat, seatIndex) => {
      const looked = seatStore.lookupSeat({
        root, campaignId, station, inputBinding: binding, seat, seatIndex, treeSha, packetHash: null,
      }, canonicalDigest);
      return looked.action === 'reuse' ? looked.outcome : null;
    });
    if (perSeat.some((outcome) => outcome !== null)) hits.push({ binding, seats: perSeat });
  }
  if (hits.length === 0) return { status: 'none', binding: null, seats: seats.map(() => null) };
  if (hits.length > 1) return { status: 'ambiguous', binding: null, seats: [] };
  return { status: 'found', ...hits[0] };
}

// Did an incremental round already review `head`? Read from the incremental station's artifacts
// (their `incremental.new_head`), independently of the gate journal.
function incrementalArtifactReviewed({ root, campaignId, head }) {
  const base = campaignDir(root, campaignId);
  for (const binding of listDirs(base, `${seatStore.INCREMENTAL_STATION}-`)) {
    const dir = path.join(base, `${seatStore.INCREMENTAL_STATION}-${binding}`);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_error) { continue; }
    for (const name of names) {
      try {
        const artifact = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (artifact && artifact.incremental && artifact.incremental.new_head === head) return true;
      } catch (_error) { /* unreadable artifact: not evidence either way */ }
    }
  }
  return false;
}

function parseFindings(outcome) {
  if (!outcome || typeof outcome.findings !== 'string') return null;
  const text = outcome.findings.trim();
  if (text === '' || text.toLowerCase() === 'none') return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Decide, for one returned head, whether the review is incremental.
 *
 * Returns `{ mode: 'full', reason }`, or `{ mode: 'incremental', binding, binding_parts,
 * increment, prior_binding, prior_tree_sha, prior_findings, seat_count }`.
 */
function decideReturnIncrement(args) {
  const {
    repo, baseSha, priorHead, newHead, newTreeSha, returnReview, stationIsPanel,
    rosterDigest, specDigest, reviewInputDigest, verificationGreen, verifyCmd,
    seats, storeRoot, campaignId, canonicalDigest, priorDerived, currentArgvHash,
  } = args || {};
  const evaluate = args && typeof args.evaluate === 'function' ? args.evaluate : evaluateReturnIncrement;
  if (returnReview !== 'incremental') return full('opt_in_off');
  if (stationIsPanel !== true) return full('station_not_panel');
  if (typeof storeRoot !== 'string' || storeRoot.length === 0 || typeof campaignId !== 'string'
      || !Array.isArray(seats) || seats.length === 0 || typeof canonicalDigest !== 'function') {
    return full('seat_store_unavailable');
  }
  const record = readRoundRecord({ root: storeRoot, campaignId, head: priorHead });
  if (!record) return full('prior_round_unknown');
  // A conclusion is carried only from a full round (plan 2.2 test 3): decided before any lookup,
  // from the record and from the incremental artifacts themselves (either one is enough).
  if (record.mode !== 'full'
      || incrementalArtifactReviewed({ root: storeRoot, campaignId, head: priorHead })) { // guard:prior_incremental
    return full('prior_round_incremental');
  }
  // Re-derive what Git can answer; a record that disagrees is no record.
  const priorTree = priorDerived && typeof priorDerived.tree_sha === 'string' ? priorDerived.tree_sha : null;
  const specOk = SHA256.test(record.spec_digest || '') && SHA256.test(record.review_input_digest || '');
  if (!priorTree || !priorDerived || !SHA256.test(priorDerived.diff_digest || '') || !specOk
      || record.tree_sha !== priorTree || record.base_sha !== baseSha
      || record.diff_digest !== priorDerived.diff_digest
      || record.binding !== canonicalDigest({
        candidate_tree_sha: priorTree,
        base_sha: baseSha,
        diff_digest: record.diff_digest,
        spec_digest: record.spec_digest,
        review_input_digest: record.review_input_digest,
      })) {
    return full('prior_round_unverified');
  }
  // The index's roster digest and verification argv hash are re-derived, not read back. The record
  // keeps the payloads they came from: the review payload re-derives review_input_digest (which the
  // binding above already pins, and the seat artifacts' directory name repeats) and carries the
  // verification argv hash; the roster re-derives roster_digest. A record that cannot show them, or
  // whose values disagree with its own payloads, is no record.
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const payload = record.review_payload;
  const payloadArgv = isObj(payload) && isObj(payload.verification) ? payload.verification.argv_hash || null : null;
  if (!isObj(payload) || canonicalDigest(payload) !== record.review_input_digest // guard:index_payload
      || (record.verify_argv_hash || null) !== payloadArgv // guard:index_argv
      || !isObj(record.roster) || canonicalDigest(record.roster) !== record.roster_digest) { // guard:index_roster
    return full('prior_round_unverified');
  }

  const station = 'panel';
  const found = findPriorPanelArtifacts({
    root: storeRoot, campaignId, station, treeSha: priorTree, seats, canonicalDigest, onlyBinding: record.binding,
  });

  const priorSeats = seats.map((_seat, index) => {
    const outcome = found.seats[index] || null;
    return {
      seatId: String(index + 1),
      carriable: outcome !== null,
      findings: outcome === null ? [] : (parseFindings(outcome) || null),
      // Parsed twice on purpose below: D1 wants {id, path}, the carry wants the full finding.
    };
  });
  const d1Seats = priorSeats.map((seat, index) => ({
    seatId: seat.seatId,
    carriable: seat.carriable,
    findings: seat.findings === null ? null : seat.findings.map((finding) => ({
      id: finding && finding.finding_id,
      path: findingPathFromClaim(finding && finding.claim),
    })),
    index,
  }));

  let res;
  try {
    res = evaluate({
      repo,
      baseSha,
      priorHead,
      newHead,
      returnReview,
      prior: {
        mode: 'full',
        baseSha: record.base_sha,
        rosterDigest: record.roster_digest,
        specDigest: record.spec_digest,
        verifyCmd: (record.verify_argv_hash || null) === (currentArgvHash || null) ? verifyCmd : `changed:${record.verify_argv_hash}`,
        seats: d1Seats,
      },
      current: { rosterDigest, specDigest, verifyCmd, verificationGreen: verificationGreen === true },
      limits: args.limits,
      acceptancePaths: args.acceptancePaths,
      sharedSurfacePaths: args.sharedSurfacePaths,
    });
  } catch (error) {
    // Git or input failure: today's path, never a throw into the review.
    return { ...full('evaluation_failed'), detail: String(error && error.message ? error.message : error).slice(0, 200) };
  }
  if (!res || res.mode !== 'incremental') return full(res && res.reason ? res.reason : 'evaluation_failed');
  // One packet per round: a mixed round (some seats without a re-derivable prior artifact) would
  // need two packet hashes in one receipt. Not built; the whole round is full instead.
  if (priorSeats.some((seat) => !seat.carriable)) return full('seat_not_carriable');

  const recheckSet = res.recheck.map((entry) => ({ path: entry.path, file_digest: entry.file_digest }));
  const carriedSet = res.carried.map((entry) => ({ path: entry.path, file_digest: entry.file_digest }));
  const carryPacketDigest = canonicalDigest({
    findings: res.findings.map((f) => ({ seat_id: f.seat_id, id: f.id, path: f.path })),
    seat_packets: res.seat_packets,
  });
  const parts = {
    base_sha: baseSha,
    prior_head: priorHead,
    prior_tree_sha: priorTree,
    prior_binding: found.binding,
    new_head: newHead,
    new_tree_sha: newTreeSha,
    delta_diff_digest: res.delta.digest,
    recheck_set: recheckSet,
    carried_set: carriedSet,
    carry_packet_digest: carryPacketDigest,
    spec_digest: specDigest,
    review_input_digest: reviewInputDigest,
  };
  const binding = seatStore.incrementalBinding(canonicalDigest, parts); // null on any malformed part
  if (binding === null) return full('binding_unavailable');

  return {
    mode: 'incremental',
    reason: null,
    binding,
    binding_parts: parts,
    increment: res,
    prior_binding: found.binding,
    prior_tree_sha: priorTree,
    prior_findings: priorSeats.map((seat) => seat.findings || []),
    seat_count: seats.length,
  };
}

/**
 * The seat-store context for one seat of an incremental round. `currentFileDigests` is recomputed
 * from Git here, at use time: it is never taken from the decision, the review input or the caller.
 */
function incrementalSeatContext(decision, ctx) {
  const {
    repo, baseSha, root, campaignId, treeSha, packetHash, seat, seatIndex,
  } = ctx;
  if (!decision || decision.mode !== 'incremental') return null;
  const parts = decision.binding_parts;
  return {
    root,
    campaignId,
    station: seatStore.INCREMENTAL_STATION,
    treeSha,
    packetHash: packetHash || null,
    inputBinding: decision.binding,
    seat,
    seatIndex,
    incremental: {
      prior_head: parts.prior_head,
      new_head: parts.new_head,
      delta_diff_digest: parts.delta_diff_digest,
      carried_set: parts.carried_set,
      recheck_set: parts.recheck_set,
    },
    currentFileDigests: computeFileDigests(repo, baseSha, parts.new_head),
  };
}

// Prior-round findings carried into an incremental round. No seat can answer them yet (the
// addendum that would show them is off, owner ruling d-3cf4dc4c), so every one stays open: silence
// never closes (plan 2.5). Ids are prefixed so they cannot collide with a fresh finding's id.
function carriedOpenFindings(decision) {
  const rows = [];
  const seen = new Set();
  (decision.prior_findings || []).forEach((findings, seatIndex) => {
    for (const finding of findings) {
      if (!finding || typeof finding.finding_id !== 'string') continue;
      const key = `${seatIndex}:${finding.finding_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...finding, finding_id: `prior:s${seatIndex + 1}.${finding.finding_id}` });
    }
  });
  return rows;
}

// Receipt disclosure (plan 2.3 step 3): the cut, so a reader can re-derive it from the two heads.
function disclosureFor(decision) {
  if (!decision) return null;
  if (decision.mode !== 'incremental') {
    return { review_scope: 'full', incremental_fallback_reason: decision.reason || null };
  }
  const res = decision.increment;
  return {
    review_scope: 'incremental',
    incremental: {
      prior_head: decision.binding_parts.prior_head,
      new_head: decision.binding_parts.new_head,
      incremental_binding: decision.binding,
      delta_diff_digest: decision.binding_parts.delta_diff_digest,
      carried: res.carried.map((entry) => ({ path: entry.path, file_digest: entry.file_digest })),
      recheck: res.recheck.map((entry) => ({
        path: entry.path, file_digest: entry.file_digest, why: entry.why,
      })),
    },
  };
}

module.exports = {
  WIRING_REASONS,
  findingPathFromClaim,
  roundRecordFile,
  writeRoundRecord,
  readRoundRecord,
  findPriorPanelArtifacts,
  incrementalArtifactReviewed,
  decideReturnIncrement,
  incrementalSeatContext,
  carriedOpenFindings,
  disclosureFor,
};
