'use strict';

// Per-seat durable artifacts for the final panel / review-station panel.
//
// A `--resume` after a gate-transient seat fault (no_verdict / transport_failed /
// parser_failed) re-runs the panel. Without this store every seat is re-dispatched,
// discarding verdicts that were already returned for the identical packet. ADR-0001:
// reuse is RE-DERIVATION from the stored seat artifact, never trust in a flag. A stored
// verdict is reused only when, on every read, ALL of these re-check:
//   - the artifact parses and carries the expected artifact_type;
//   - its input_binding / station / campaign / seat identity equal the current ones;
//   - its findings re-normalize to themselves and its review_digest re-derives from
//     (verdict, findings, scope, tree_sha) — no "reviewed" or summary field is read.
// Anything else is a miss and the seat is re-dispatched. Every function fails open: an
// I/O or parse error is a miss, never a throw into the review path.

const fs = require('fs');
const path = require('path');
const { normalizeProductReviewFindings } = require('./product-review-normalizer');

const ARTIFACT_TYPE = 'implementation_campaign_final_panel_seat_artifact';
// Dispatch attempts a single seat may consume for one packet binding (the first run
// counts). A seat at the budget is not dispatched again: the panel ends with the named
// terminal reason below instead of a retry loop.
const FINAL_PANEL_SEAT_ATTEMPT_BUDGET = 3;
const FINAL_PANEL_SEAT_BUDGET_PHASE = 'final_panel_seat_attempt_budget';
const FINAL_PANEL_SEAT_BUDGET_STATUS = 'attempt_budget_exhausted';
const FINAL_PANEL_SEAT_BUDGET_REASON = `final_panel_seat_${FINAL_PANEL_SEAT_BUDGET_STATUS}`;
const SHA256 = /^[0-9a-f]{64}$/;

function seatTuple(seat) {
  return {
    runner: seat.runner,
    model: seat.model,
    effort: seat.effort,
    endpoint: seat.endpoint === undefined ? null : seat.endpoint,
    family: seat.family,
  };
}

function tupleEqual(a, b) {
  return ['runner', 'model', 'effort', 'endpoint', 'family']
    .every((key) => a[key] === b[key]);
}

function seatFile({ root, campaignId, inputBinding, station, seatIndex }) {
  if (typeof root !== 'string' || root.length === 0
      || typeof campaignId !== 'string' || campaignId.length === 0
      || !SHA256.test(inputBinding || '')) return null;
  const safeCampaign = campaignId.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(
    root, safeCampaign, `${station}-${inputBinding}`, `seat-${seatIndex + 1}.json`,
  );
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function writeJson(file, body) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch (_error) {
    return false;
  }
}

// Re-derive a reusable verdict from a stored artifact. Returns the outcome shape
// performReview yields on success, or null when any binding check fails.
function deriveReusableOutcome(artifact, expect, canonicalDigest) {
  if (!artifact || artifact.artifact_type !== ARTIFACT_TYPE || artifact.schema_version !== 1) {
    return null;
  }
  if (artifact.campaign_id !== expect.campaignId
      || artifact.station !== expect.station
      || artifact.input_binding !== expect.inputBinding
      || artifact.seat_index !== expect.seatIndex + 1
      || !artifact.seat || typeof artifact.seat !== 'object'
      || !tupleEqual(artifact.seat, seatTuple(expect.seat))) {
    return null;
  }
  const result = artifact.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (typeof result.verdict !== 'string' || result.verdict.length === 0
      || typeof result.findings !== 'string'
      || result.scope !== 'final'
      || result.tree_sha !== expect.treeSha
      || !SHA256.test(result.review_digest || '')) {
    return null;
  }
  if (result.findings.trim().length > 0) {
    let normalized;
    try {
      normalized = normalizeProductReviewFindings(result.findings);
    } catch (_error) {
      return null;
    }
    if (!normalized || normalized.status !== 'normalized'
        || normalized.canonical !== result.findings) return null;
  }
  const rederived = canonicalDigest({
    verdict: result.verdict,
    findings: result.findings,
    scope: result.scope,
    tree_sha: result.tree_sha,
  });
  if (rederived !== result.review_digest) return null;
  const hasPacket = Object.prototype.hasOwnProperty.call(result, 'packet_hash');
  if (hasPacket) {
    if (!SHA256.test(result.packet_hash || '')) return null;
    if (SHA256.test(expect.packetHash || '') && expect.packetHash !== result.packet_hash) {
      return null;
    }
  }
  return {
    reviewed: true,
    verdict: result.verdict,
    findings: result.findings,
    review_digest: result.review_digest,
    review_input_mode: 'full_diff_generation',
    blind_discovery: true,
    prior_findings_included: false,
    full_diff_required: true,
    ...(hasPacket ? { packet_hash: result.packet_hash } : {}),
    reused_from_artifact: true,
  };
}

// Look a seat up before dispatch. Returns
//   { action: 'reuse', outcome }          a re-derived valid verdict
//   { action: 'exhausted', attempts }     the seat already used its attempt budget
//   { action: 'dispatch', attempts }      dispatch it (attempts = prior count)
function lookupSeat(ctx, canonicalDigest) {
  const file = seatFile(ctx);
  if (!file) return { action: 'dispatch', attempts: 0, file: null };
  const artifact = readJson(file);
  const outcome = deriveReusableOutcome(artifact, ctx, canonicalDigest);
  if (outcome) return { action: 'reuse', outcome, file };
  const attempts = artifact && artifact.campaign_id === ctx.campaignId
    && artifact.input_binding === ctx.inputBinding
    && Number.isSafeInteger(artifact.attempts) && artifact.attempts >= 0
    ? artifact.attempts : 0;
  if (attempts >= FINAL_PANEL_SEAT_ATTEMPT_BUDGET) return { action: 'exhausted', attempts, file };
  return { action: 'dispatch', attempts, file };
}

function baseBody(ctx, attempts, result) {
  return {
    schema_version: 1,
    artifact_type: ARTIFACT_TYPE,
    campaign_id: ctx.campaignId,
    station: ctx.station,
    input_binding: ctx.inputBinding,
    seat_index: ctx.seatIndex + 1,
    seat: seatTuple(ctx.seat),
    attempts,
    result,
  };
}

// Charge one dispatch attempt BEFORE dispatching, so a crash mid-dispatch still counts.
function recordAttempt(ctx, priorAttempts) {
  const file = seatFile(ctx);
  if (!file) return false;
  return writeJson(file, baseBody(ctx, priorAttempts + 1, null));
}

// Store a reviewed verdict. `outcome` is performReview's success outcome.
function recordVerdict(ctx, attempts, outcome) {
  const file = seatFile(ctx);
  if (!file || !outcome || outcome.reviewed !== true) return false;
  const result = {
    verdict: outcome.verdict,
    findings: typeof outcome.findings === 'string' ? outcome.findings : '',
    scope: 'final',
    tree_sha: ctx.treeSha,
    review_digest: outcome.review_digest,
    ...(typeof outcome.packet_hash === 'string' && SHA256.test(outcome.packet_hash)
      ? { packet_hash: outcome.packet_hash } : {}),
  };
  return writeJson(file, baseBody(ctx, attempts, result));
}

module.exports = {
  ARTIFACT_TYPE,
  FINAL_PANEL_SEAT_ATTEMPT_BUDGET,
  FINAL_PANEL_SEAT_BUDGET_PHASE,
  FINAL_PANEL_SEAT_BUDGET_STATUS,
  FINAL_PANEL_SEAT_BUDGET_REASON,
  seatFile,
  deriveReusableOutcome,
  lookupSeat,
  recordAttempt,
  recordVerdict,
};
