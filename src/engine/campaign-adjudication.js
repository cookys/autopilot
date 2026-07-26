'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { canonicalDigest } = require('./campaign-verification');

const ADJUDICATE_FINDINGS = path.resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'adjudicate-findings.js',
);
const SEVERITIES = new Set(['🔴', '🟠', '🟡', '🔵']);
const DISPOSITIONS = new Set(['must-fix-now', 'follow-up', 'reject-out-of-scope']);

class CampaignAdjudicationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CampaignAdjudicationError';
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new CampaignAdjudicationError(
        'INVALID_FINDING',
        `${label} contains unknown field "${key}"`,
      );
    }
  }
}

function normalizeDisposition(value, label) {
  if (!isRecord(value)) {
    throw new CampaignAdjudicationError('INVALID_DISPOSITION', `${label} must be an object`);
  }
  if (!DISPOSITIONS.has(value.disposition)) {
    throw new CampaignAdjudicationError(
      'INVALID_DISPOSITION',
      `${label}.disposition is invalid`,
    );
  }
  const normalized = { disposition: value.disposition };
  if (value.disposition === 'must-fix-now') {
    exactKeys(value, new Set([
      'disposition',
      'acceptance_id',
      'rubric_id',
      'task_surface',
      'deferral_harm',
    ]), label);
    const surfaceFields = ['acceptance_id', 'rubric_id', 'task_surface']
      .filter((key) => nonEmpty(value[key]));
    if (surfaceFields.length === 0 || !nonEmpty(value.deferral_harm)) {
      throw new CampaignAdjudicationError(
        'INVALID_DISPOSITION',
        `${label} must bind a frozen surface and name deferral harm`,
      );
    }
    for (const key of surfaceFields) normalized[key] = value[key];
    normalized.deferral_harm = value.deferral_harm;
  } else if (value.disposition === 'follow-up') {
    exactKeys(value, new Set([
      'disposition',
      'context',
      'trigger',
      'proposed_backlog_title',
    ]), label);
    if (!nonEmpty(value.context)
        || !nonEmpty(value.trigger)
        || !nonEmpty(value.proposed_backlog_title)) {
      throw new CampaignAdjudicationError(
        'INVALID_DISPOSITION',
        `${label} follow-up requires context, trigger, and proposed_backlog_title`,
      );
    }
    normalized.context = value.context;
    normalized.trigger = value.trigger;
  } else {
    exactKeys(value, new Set(['disposition', 'rationale']), label);
    if (!nonEmpty(value.rationale)) {
      throw new CampaignAdjudicationError(
        'INVALID_DISPOSITION',
        `${label} reject-out-of-scope requires rationale`,
      );
    }
    normalized.rationale = value.rationale;
  }
  return {
    command: normalized,
    receipt: { ...value },
  };
}

function normalizeEvidence(value, label) {
  if (!isRecord(value)) {
    throw new CampaignAdjudicationError('INVALID_EVIDENCE', `${label} must be an object`);
  }
  const kind = value.kind;
  if (kind === 'trace') {
    exactKeys(value, new Set(['kind', 'trace_chain', 'confirmed_by']), label);
    if (!Array.isArray(value.trace_chain)
        || value.trace_chain.length === 0
        || !value.trace_chain.every(nonEmpty)
        || !nonEmpty(value.confirmed_by)) {
      throw new CampaignAdjudicationError('INVALID_EVIDENCE', `${label} trace is incomplete`);
    }
    return {
      commands: [{
        command: 'trace',
        payload: {
          trace_chain: value.trace_chain,
          confirmed_by: value.confirmed_by,
        },
      }],
      classification: 'actionable',
    };
  }
  if (kind === 'reproduced') {
    exactKeys(value, new Set([
      'kind',
      'probe_cmd',
      'expected_signature',
      'observed_output',
    ]), label);
    if (!nonEmpty(value.probe_cmd)
        || !nonEmpty(value.expected_signature)
        || typeof value.observed_output !== 'string') {
      throw new CampaignAdjudicationError(
        'INVALID_EVIDENCE',
        `${label} reproduced probe is incomplete`,
      );
    }
    return {
      commands: [{
        command: 'probe',
        payload: {
          probe_cmd: value.probe_cmd,
          expected_signature: value.expected_signature,
          observed_output: value.observed_output,
          observed_matches_expected: true,
        },
      }],
      classification: 'actionable',
    };
  }
  if (kind === 'refuted') {
    exactKeys(value, new Set([
      'kind',
      'probe_cmd',
      'expected_signature',
      'observed_output',
      'mutation_desc',
      'mutation_probe_output',
    ]), label);
    if (!nonEmpty(value.probe_cmd)
        || !nonEmpty(value.expected_signature)
        || typeof value.observed_output !== 'string'
        || !nonEmpty(value.mutation_desc)
        || typeof value.mutation_probe_output !== 'string') {
      throw new CampaignAdjudicationError(
        'INVALID_EVIDENCE',
        `${label} refutation is incomplete`,
      );
    }
    return {
      commands: [
        {
          command: 'probe',
          payload: {
            probe_cmd: value.probe_cmd,
            expected_signature: value.expected_signature,
            observed_output: value.observed_output,
            observed_matches_expected: false,
          },
        },
        {
          command: 'refute',
          payload: {
            mutation_desc: value.mutation_desc,
            mutation_probe_output: value.mutation_probe_output,
            probe_fired_under_mutation: true,
          },
        },
      ],
      classification: 'refuted',
    };
  }
  throw new CampaignAdjudicationError(
    'INVALID_EVIDENCE',
    `${label}.kind must be trace, reproduced, or refuted`,
  );
}

function normalizeFindings(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (trimmed.length === 0) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      throw new CampaignAdjudicationError(
        'UNSTRUCTURED_FINDINGS',
        'review findings are not exact structured JSON',
      );
    }
  }
  if (!Array.isArray(parsed)) {
    throw new CampaignAdjudicationError(
      'INVALID_FINDINGS',
      'review findings must be a JSON array',
    );
  }
  const seen = new Set();
  return parsed.map((finding, index) => {
    const label = `findings[${index}]`;
    if (!isRecord(finding)) {
      throw new CampaignAdjudicationError('INVALID_FINDING', `${label} must be an object`);
    }
    exactKeys(finding, new Set([
      'finding_id',
      'claim',
      'severity',
      'source',
      'evidence',
      'disposition',
    ]), label);
    if (!nonEmpty(finding.finding_id)
        || !nonEmpty(finding.claim)
        || !SEVERITIES.has(finding.severity)
        || !nonEmpty(finding.source)) {
      throw new CampaignAdjudicationError(
        'INVALID_FINDING',
        `${label} identity, claim, severity, or source is invalid`,
      );
    }
    if (seen.has(finding.finding_id)) {
      throw new CampaignAdjudicationError(
        'DUPLICATE_FINDING',
        `duplicate finding_id "${finding.finding_id}"`,
      );
    }
    seen.add(finding.finding_id);
    const evidence = normalizeEvidence(finding.evidence, `${label}.evidence`);
    const disposition = finding.disposition === null || finding.disposition === undefined
      ? null
      : normalizeDisposition(finding.disposition, `${label}.disposition`);
    return {
      ...finding,
      id: finding.finding_id,
      evidence,
      disposition,
    };
  });
}

function parseLastJson(stdout, label) {
  const lines = String(stdout || '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (_error) {
      // Continue to the previous line.
    }
  }
  throw new CampaignAdjudicationError(
    'ADJUDICATION_PROTOCOL',
    `${label} returned no JSON receipt`,
  );
}

function invokeAdjudication({ store, command, id, ids, payload, now }) {
  const args = [ADJUDICATE_FINDINGS, command, '--store', store];
  if (id) args.push('--id', id);
  if (ids) args.push('--ids', ids.join(','));
  if (command === 'status' || command === 'completeness') args.push('--json');
  if (now) args.push('--now', now);
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    input: payload === undefined ? '' : `${JSON.stringify(payload)}\n`,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const gateWithoutPayload = command === 'gate' || command === 'repair-gate';
  const receipt = gateWithoutPayload && String(child.stdout || '').trim().length === 0
    ? { passed: child.status === 0 }
    : parseLastJson(child.stdout, command);
  if (child.error || child.signal || child.status !== 0) {
    throw new CampaignAdjudicationError(
      'ADJUDICATION_REJECTED',
      `${command} rejected finding registry input`,
    );
  }
  return receipt;
}

function emptyRegistryReceipt() {
  return {
    registry_complete: true,
    repair_gate_passed: true,
    registry_digest: canonicalDigest([]),
    must_fix_now: [],
    follow_up: [],
    rejected: [],
  };
}

function adjudicateCampaignReview({
  review,
  convergenceVerdict = 'SHIP-AS-IS',
  now,
}) {
  const raw = review && Object.prototype.hasOwnProperty.call(review, 'findings')
    ? review.findings
    : null;
  if (review && review.verdict === convergenceVerdict
      && (raw === null || raw === undefined || raw === '')) {
    return emptyRegistryReceipt();
  }

  let findings;
  try {
    findings = normalizeFindings(raw);
  } catch (error) {
    return {
      registry_complete: false,
      repair_gate_passed: false,
      reason: error.message,
      error_code: error.code || 'ADJUDICATION_FAILED',
      must_fix_now: [],
      follow_up: [],
      rejected: [],
    };
  }
  if (findings.length === 0) {
    return review && review.verdict === convergenceVerdict
      ? emptyRegistryReceipt()
      : {
        registry_complete: false,
        repair_gate_passed: false,
        reason: 'non-converged review supplied an empty finding registry',
        error_code: 'EMPTY_NONCONVERGED_REVIEW',
        must_fix_now: [],
        follow_up: [],
        rejected: [],
      };
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-campaign-findings-'));
  const store = path.join(directory, 'findings.jsonl');
  try {
    for (const finding of findings) {
      invokeAdjudication({
        store,
        command: 'add',
        payload: {
          finding_id: finding.finding_id,
          claim: finding.claim,
          severity: finding.severity,
          source: finding.source,
        },
        now,
      });
      for (const evidenceCommand of finding.evidence.commands) {
        invokeAdjudication({
          store,
          command: evidenceCommand.command,
          id: finding.finding_id,
          payload: evidenceCommand.payload,
          now,
        });
      }
      if (finding.disposition) {
        invokeAdjudication({
          store,
          command: 'dispose',
          id: finding.finding_id,
          payload: finding.disposition.command,
          now,
        });
      }
    }

    const completeness = invokeAdjudication({
      store,
      command: 'completeness',
      now,
    });
    const mustFixIds = completeness.must_fix_now_ids;
    let repairGatePassed = true;
    if (mustFixIds.length > 0) {
      invokeAdjudication({
        store,
        command: 'repair-gate',
        ids: mustFixIds,
        now,
      });
      repairGatePassed = true;
    }
    const rows = fs.readFileSync(store, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((row) => JSON.parse(row));
    const byId = new Map(findings.map((finding) => [finding.finding_id, finding]));
    const toReceipt = (finding) => {
      const output = {
        id: finding.id,
        claim: finding.claim,
        severity: finding.severity,
        source: finding.source,
      };
      if (finding.disposition) output.disposition = finding.disposition.receipt;
      return output;
    };
    return {
      registry_complete: completeness.complete === true,
      repair_gate_passed: repairGatePassed,
      registry_digest: canonicalDigest(rows),
      must_fix_now: mustFixIds.map((id) => toReceipt(byId.get(id))),
      follow_up: findings
        .filter((finding) => finding.disposition
          && finding.disposition.receipt.disposition === 'follow-up')
        .map(toReceipt),
      rejected: findings
        .filter((finding) => finding.evidence.classification === 'refuted'
          || (finding.disposition
            && finding.disposition.receipt.disposition === 'reject-out-of-scope'))
        .map(toReceipt),
    };
  } catch (error) {
    return {
      registry_complete: false,
      repair_gate_passed: false,
      reason: error.message,
      error_code: error.code || 'ADJUDICATION_FAILED',
      must_fix_now: [],
      follow_up: [],
      rejected: [],
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = {
  CampaignAdjudicationError,
  adjudicateCampaignReview,
  normalizeFindings,
};
