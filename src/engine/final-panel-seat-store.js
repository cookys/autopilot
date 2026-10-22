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
const { normalizeProductReviewFindings, revalidateResolutions } = require('./product-review-normalizer');

const ARTIFACT_TYPE = 'implementation_campaign_final_panel_seat_artifact';
// Dispatch attempts a single seat may consume for one packet binding (the first run
// counts). A seat at the budget is not dispatched again: the panel ends with the named
// terminal reason below instead of a retry loop.
const FINAL_PANEL_SEAT_ATTEMPT_BUDGET = 3;
const FINAL_PANEL_SEAT_BUDGET_PHASE = 'final_panel_seat_attempt_budget';
const FINAL_PANEL_SEAT_BUDGET_STATUS = 'attempt_budget_exhausted';
const FINAL_PANEL_SEAT_BUDGET_REASON = `final_panel_seat_${FINAL_PANEL_SEAT_BUDGET_STATUS}`;
const SHA256 = /^[0-9a-f]{64}$/;
// BL-0146 D2: an incremental (return-review) round has its OWN station name, so a stored
// full-round artifact can never satisfy an incremental lookup and the reverse.
const INCREMENTAL_STATION = 'final-panel-incremental';
const INCREMENTAL_REVIEW_INPUT_MODE = 'incremental_return';

function isIncrementalStation(station) {
  return station === INCREMENTAL_STATION;
}

function sortedPathDigests(list) {
  if (!Array.isArray(list)) return null;
  const rows = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0
        || !SHA256.test(entry.file_digest || '')) return null;
    // BL-0146 D4: a path listed twice is ambiguous about which digest the carry rests on.
    if (seen.has(entry.path)) return null; // guard:duplicate_path
    seen.add(entry.path);
    rows.push({ path: entry.path, file_digest: entry.file_digest });
  }
  return rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// A path in both the re-check set and the carried set would be both re-judged and trusted.
function setsOverlap(a, b) {
  const paths = new Set(a.map((e) => e.path));
  return b.some((e) => paths.has(e.path));
}

// Plan 2.4 reuse key. Returns null when any component is missing or malformed, so a caller
// cannot build a binding from a partial input (fail closed to the full path).
function incrementalBinding(canonicalDigest, parts) {
  if (!parts || typeof parts !== 'object') return null;
  const strings = ['base_sha', 'prior_head', 'prior_tree_sha', 'prior_binding', 'new_head', 'new_tree_sha'];
  for (const key of strings) {
    if (typeof parts[key] !== 'string' || parts[key].length === 0) return null;
  }
  for (const key of ['delta_diff_digest', 'carry_packet_digest', 'spec_digest', 'review_input_digest']) {
    if (!SHA256.test(parts[key] || '')) return null;
  }
  const recheck = sortedPathDigests(parts.recheck_set);
  const carried = sortedPathDigests(parts.carried_set);
  if (!recheck || !carried) return null;
  if (setsOverlap(recheck, carried)) return null; // guard:set_overlap
  return canonicalDigest({
    mode: 'incremental',
    base_sha: parts.base_sha,
    prior_head: parts.prior_head,
    prior_tree_sha: parts.prior_tree_sha,
    prior_binding: parts.prior_binding,
    new_head: parts.new_head,
    new_tree_sha: parts.new_tree_sha,
    delta_diff_digest: parts.delta_diff_digest,
    recheck_set: recheck,
    carried_set: carried,
    carry_packet_digest: parts.carry_packet_digest,
    spec_digest: parts.spec_digest,
    review_input_digest: parts.review_input_digest,
  });
}

// The incremental block stored with an artifact: what the carry rested on.
function incrementalBlock(ctx) {
  const inc = ctx && ctx.incremental;
  if (!inc || typeof inc !== 'object') return null;
  const carried = sortedPathDigests(inc.carried_set);
  const recheck = sortedPathDigests(inc.recheck_set);
  if (!carried || !recheck || setsOverlap(recheck, carried) || typeof inc.prior_head !== 'string' || inc.prior_head.length === 0
      || typeof inc.new_head !== 'string' || inc.new_head.length === 0
      || !SHA256.test(inc.delta_diff_digest || '')) return null;
  return {
    prior_head: inc.prior_head,
    new_head: inc.new_head,
    delta_diff_digest: inc.delta_diff_digest,
    carried_set: carried,
    recheck_set: recheck,
  };
}

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
      || !SHA256.test(inputBinding || '')
      || !Number.isSafeInteger(seatIndex) || seatIndex < 0) return null; // guard:seat_index
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
  const incremental = isIncrementalStation(expect.station);
  if (incremental) {
    // The artifact must say it is incremental and carry the same increment block the caller
    // derived now (prior head, delta digest, carried and re-check sets). Missing = miss.
    const want = incrementalBlock(expect);
    const have = artifact.incremental;
    if (artifact.review_scope !== 'incremental' || !want || !have
        || canonicalDigest(want) !== canonicalDigest(have)) return null;
    // A7: a carried verdict stands for path P only while P's cumulative digest at the new head
    // still equals the digest recorded with the artifact. The caller recomputes the current
    // digests from Git at use time (Map path -> digest); a missing map is a miss, never a pass.
    const current = expect.currentFileDigests;
    if (!(current instanceof Map)) return null;
    for (const entry of have.carried_set) {
      if (current.get(entry.path) !== entry.file_digest) return null;
    }
  } else if (artifact.review_scope !== undefined || artifact.incremental !== undefined) {
    return null;
  }
  return {
    reviewed: true,
    verdict: result.verdict,
    findings: result.findings,
    review_digest: result.review_digest,
    review_input_mode: incremental ? INCREMENTAL_REVIEW_INPUT_MODE : 'full_diff_generation',
    blind_discovery: true,
    // True only for an incremental seat whose spec carried the prior-round addendum (owner ruling
    // d-3cf4dc4c); a full-round seat never had one.
    prior_findings_included: incremental && expect.addendumIncluded === true,
    full_diff_required: !incremental,
    // The seat's explicit answers about the earlier findings, re-derived from the packet it was given.
    ...(incremental ? {
      resolutions: revalidateResolutions(result.resolutions, expect.priorFindingIds, expect.packetPaths),
    } : {}),
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
  const block = isIncrementalStation(ctx.station) ? incrementalBlock(ctx) : null;
  return {
    ...(block ? { review_scope: 'incremental', incremental: block } : {}),
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
  if (isIncrementalStation(ctx.station) && !incrementalBlock(ctx)) return false;
  const result = {
    verdict: outcome.verdict,
    findings: typeof outcome.findings === 'string' ? outcome.findings : '',
    scope: 'final',
    tree_sha: ctx.treeSha,
    review_digest: outcome.review_digest,
    ...(isIncrementalStation(ctx.station) && Array.isArray(outcome.resolutions)
      ? { resolutions: outcome.resolutions } : {}),
    ...(typeof outcome.packet_hash === 'string' && SHA256.test(outcome.packet_hash)
      ? { packet_hash: outcome.packet_hash } : {}),
  };
  return writeJson(file, baseBody(ctx, attempts, result));
}

// ---- Reaping -------------------------------------------------------------------------
// A campaign's seat subtree is read only by a resume, so it is dead weight once the
// campaign is terminal. Only the journal says which: a parked campaign (durable wait,
// BOUNDARY_REJECTED, AWAITING_DISPOSITION, REVIEWING ...) has a non-terminal last event and
// MUST keep its artifacts.
const TERMINAL_EVENT_TYPES = new Set(['terminal_ready', 'terminal_follow_up', 'terminal_stop']);
const CAMPAIGN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlainCampaignToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && CAMPAIGN_TOKEN.test(value) && !value.includes('..');
}

// Last journaled campaign event per campaign id, in append order, across the live ledger
// and its rotated generations. Returns Map(campaign_id -> event_type), or null when a
// ledger file exists but cannot be read (callers then treat every campaign as not
// provably terminal).
function campaignLastEvents(ledgerPath) {
  const last = new Map();
  // Mirrors scripts/run-ledger.sh ledger_scan_files (:2814-2827) and the writer's rotation
  // (:3284-3303): `<ledger>.1` is the newest rotated segment, `<ledger>.N` the oldest, N up to
  // run_ledger.max_rotations (config, default 4; the env var is not read); read oldest first, live ledger last.
  const parsedRot = Number.parseInt(require('../../scripts/lib/run-ledger-config').configuredValue() || '', 10);
  const maxRotations = Number.isSafeInteger(parsedRot) && parsedRot >= 1 ? parsedRot : 4;
  const files = [];
  for (let n = maxRotations; n >= 1; n -= 1) files.push(`${ledgerPath}.${n}`);
  files.push(ledgerPath);
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { return null; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch (_error) { continue; }
      if (!row || row.kind !== 'journal'
          || (row.op !== 'campaign_event' && row.op !== 'campaign_intake')
          || typeof row.payload !== 'string') continue;
      let payload;
      try { payload = JSON.parse(row.payload); } catch (_error) { continue; }
      if (!payload || typeof payload.campaign_id !== 'string') continue;
      const type = payload.event && typeof payload.event.event_type === 'string'
        ? payload.event.event_type : 'intake';
      last.set(payload.campaign_id, type);
    }
  }
  return last;
}

// Remove <root>/<campaignId>/ and nothing else. Refuses a non-token id, a root that is not
// a `final-panel-seats` directory, and any target that does not resolve directly under the
// root. Never throws. Returns { status: 'removed'|'absent'|'refused'|'failed', reason, path }.
function reapCampaignSeats({ root, campaignId }) {
  try {
    if (typeof root !== 'string' || root.length === 0
        || path.basename(path.resolve(root)) !== 'final-panel-seats') {
      return { status: 'refused', reason: 'seat_root_invalid', path: null };
    }
    if (!isPlainCampaignToken(campaignId)) {
      return { status: 'refused', reason: 'campaign_id_not_a_plain_token', path: null };
    }
    const absRoot = path.resolve(root);
    const target = path.resolve(absRoot, campaignId);
    if (path.dirname(target) !== absRoot) {
      return { status: 'refused', reason: 'path_escapes_seat_root', path: target };
    }
    let st;
    try { st = fs.lstatSync(target); } catch (error) {
      if (error && error.code === 'ENOENT') return { status: 'absent', reason: null, path: target };
      throw error;
    }
    if (!st.isDirectory()) {
      return { status: 'refused', reason: 'target_is_not_a_directory', path: target };
    }
    fs.rmSync(target, { recursive: true, force: true });
    return { status: 'removed', reason: null, path: target };
  } catch (error) {
    return {
      status: 'failed',
      reason: `reap_failed: ${error && error.message ? error.message : String(error)}`,
      path: null,
    };
  }
}

// Terminal-time reap: only when the journal proves the campaign is terminal. Fail-open.
function reapIfCampaignTerminal({ root, campaignId, ledgerPath }) {
  try {
    if (typeof ledgerPath !== 'string' || ledgerPath.length === 0) {
      return { status: 'kept', reason: 'campaign_ledger_unknown', path: null };
    }
    const events = campaignLastEvents(ledgerPath);
    if (!events) return { status: 'kept', reason: 'campaign_ledger_unreadable', path: null };
    const type = events.get(campaignId);
    if (!TERMINAL_EVENT_TYPES.has(type)) {
      return { status: 'kept', reason: `campaign_not_terminal:${type || 'unjournaled'}`, path: null };
    }
    return reapCampaignSeats({ root, campaignId });
  } catch (error) {
    return {
      status: 'failed',
      reason: `reap_failed: ${error && error.message ? error.message : String(error)}`,
      path: null,
    };
  }
}

module.exports = {
  TERMINAL_EVENT_TYPES,
  isPlainCampaignToken,
  campaignLastEvents,
  reapCampaignSeats,
  reapIfCampaignTerminal,
  ARTIFACT_TYPE,
  INCREMENTAL_STATION,
  INCREMENTAL_REVIEW_INPUT_MODE,
  incrementalBinding,
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
