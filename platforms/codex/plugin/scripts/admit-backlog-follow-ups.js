#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, validateJsonSchema } = require('./validate-json-schema');
const { validateCanonicalPortfolioOutput } = require('./review-mvp-portfolio');
const { validateFinalPanelReceipt } = require('../src/engine/campaign-composition');

const CAMPAIGN_RECEIPT_SCHEMA = readJson(
  path.join(__dirname, '..', 'schemas', 'implementation-campaign-receipt.schema.json'),
  'implementation campaign receipt schema',
);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    backlog: path.resolve('docs/BACKLOG.md'),
    currentTicket: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--input' || arg === '--backlog' || arg === '--current-ticket') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--input') options.inputs.push(path.resolve(value));
      else if (arg === '--backlog') options.backlog = path.resolve(value);
      else options.currentTicket = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (options.inputs.length === 0) throw new Error('at least one --input is required');
  if (!nonEmpty(options.currentTicket)) throw new Error('--current-ticket is required');
  return options;
}

function fromPortfolio(value, sourceFile) {
  const outputValidation = validateCanonicalPortfolioOutput(value);
  if (!Array.isArray(value.backlog_candidates)) return [];
  const canonicalArtifact = outputValidation.valid;
  return value.backlog_candidates.map((candidate) => {
    const canonicalCandidate = hasExactKeys(candidate, [
      'fingerprint',
      'item_id',
      'sources',
      'context',
      'trigger',
      'proposed_backlog_title',
      'evidence',
      'aggregate_score',
      'score_breakdown',
    ]);
    const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
    const supported = canonicalArtifact
      && canonicalCandidate
      && evidence.length > 0 && evidence.every((item) => (
      item && new Set(['spec', 'test', 'verified-observation']).has(item.evidence_kind)
      && nonEmpty(item.observation)
    ));
    return {
      eligible: supported
        && Number.isFinite(candidate.aggregate_score)
        && candidate.aggregate_score > 0,
      fingerprint: candidate.fingerprint,
      expected_fingerprint: digest({
        context: candidate.context,
        item_id: candidate.item_id,
        proposed_backlog_title: candidate.proposed_backlog_title,
        trigger: candidate.trigger,
      }),
      title: candidate.proposed_backlog_title,
      context: candidate.context,
      trigger: candidate.trigger,
      sources: Array.isArray(candidate.sources) ? candidate.sources : [sourceFile],
      reason: !canonicalArtifact
        ? 'noncanonical_artifact'
        : (canonicalCandidate
          ? (supported ? null : 'unsupported_evidence')
          : 'noncanonical_candidate'),
    };
  });
}

function fromCampaign(value, sourceFile) {
  const schemaResult = validateJsonSchema(CAMPAIGN_RECEIPT_SCHEMA, value);
  if (!Array.isArray(value.follow_up)) return [];
  const canonicalArtifact = schemaResult.valid
    && hasExactKeys(value, [
      'schema_version',
      'artifact_type',
      'status',
      'candidate_tree_sha',
      'verification_receipt_digest',
      'repair_generations',
      'sealed_min_panel_size',
      'final_panel_count',
      'final_panel_seat_receipts',
      'follow_up',
      'rejected_findings',
      'unresolved_final_findings',
      'lifecycle_receipt_ref',
      'trace',
      'receipt_digest',
    ])
    && value.schema_version === 1
    && value.artifact_type === 'implementation_campaign_terminal'
    && value.status === 'follow_up'
    && validateFinalPanelReceipt({
      reviewed: true,
      sealed_min_panel_size: value.sealed_min_panel_size,
      final_panel_count: value.final_panel_count,
      final_panel_seat_receipts: value.final_panel_seat_receipts,
    }, value.sealed_min_panel_size).passed === true
    && Array.isArray(value.unresolved_final_findings)
    && value.unresolved_final_findings.length === 0
    && /^[a-f0-9]{64}$/u.test(value.receipt_digest || '')
    && digest(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'receipt_digest'),
    )) === value.receipt_digest;
  return value.follow_up.map((finding) => {
    const disposition = finding && finding.disposition;
    const evidence = finding && finding.evidence;
    const eligible = Boolean(
      canonicalArtifact
      && finding
      && nonEmpty(finding.id)
      && nonEmpty(finding.source)
      && evidence
      && evidence.classification === 'actionable'
      && /^[a-f0-9]{64}$/u.test(evidence.digest || '')
      && disposition
      && disposition.disposition === 'follow-up'
      && nonEmpty(disposition.context)
      && nonEmpty(disposition.trigger)
      && nonEmpty(disposition.proposed_backlog_title),
    );
    const material = {
      context: disposition && disposition.context,
      evidence_digest: evidence && evidence.digest,
      finding_id: finding && finding.id,
      source: finding && finding.source,
      title: disposition && disposition.proposed_backlog_title,
      trigger: disposition && disposition.trigger,
    };
    return {
      eligible,
      fingerprint: digest(material),
      expected_fingerprint: digest(material),
      title: disposition && disposition.proposed_backlog_title,
      context: disposition && disposition.context,
      trigger: disposition && disposition.trigger,
      sources: [finding && finding.source, sourceFile].filter(nonEmpty),
      reason: canonicalArtifact
        ? (eligible ? null : 'unsupported_evidence')
        : 'noncanonical_artifact',
    };
  });
}

function normalizeCandidate(candidate) {
  if (!candidate.eligible) return candidate;
  if (!/^[a-f0-9]{64}$/u.test(candidate.fingerprint || '')
      || candidate.fingerprint !== candidate.expected_fingerprint
      || !nonEmpty(candidate.title)
      || !nonEmpty(candidate.context)
      || !nonEmpty(candidate.trigger)
      || !Array.isArray(candidate.sources)
      || candidate.sources.length === 0
      || !candidate.sources.every(nonEmpty)) {
    return { ...candidate, eligible: false, reason: 'malformed_candidate' };
  }
  return {
    ...candidate,
    sources: [...new Set(candidate.sources)].sort(),
  };
}

function entry(candidate) {
  return [
    '',
    `<!-- autopilot-follow-up:${candidate.fingerprint} -->`,
    `### ${candidate.title}`,
    `- **Trigger**: ${candidate.trigger}`,
    `- **Context**: ${candidate.context}`,
    '- **Effort**: S（re-estimate under the new ticket contract）',
    `- **Source**: ${candidate.sources.join('; ')}`,
    '',
  ].join('\n');
}

function main() {
  let lockDirectory = null;
  try {
    const options = parseArgs(process.argv.slice(2));
    const candidates = [];
    for (const input of options.inputs) {
      const value = JSON.parse(fs.readFileSync(input, 'utf8'));
      candidates.push(...fromPortfolio(value, input), ...fromCampaign(value, input));
    }
    const normalized = candidates.map(normalizeCandidate);
    const byFingerprint = new Map();
    for (const candidate of normalized) {
      if (!candidate.eligible) continue;
      const existing = byFingerprint.get(candidate.fingerprint);
      if (existing && canonical(existing) !== canonical(candidate)) {
        throw new Error(`candidate fingerprint conflict: ${candidate.fingerprint}`);
      }
      if (existing) continue;
      byFingerprint.set(candidate.fingerprint, candidate);
    }

    lockDirectory = `${options.backlog}.admission.lock`;
    try {
      fs.mkdirSync(lockDirectory);
    } catch (error) {
      throw new Error(`backlog admission lock unavailable: ${error.message}`);
    }
    // Read only after owning the lock. This is the compare point for concurrent
    // admissions; an earlier speculative read must never authorize a write.
    let backlog = fs.readFileSync(options.backlog, 'utf8');
    const backlogBeforeDigest = digest(backlog);
    const admitted = [];
    const duplicate = [];
    for (const candidate of byFingerprint.values()) {
      const marker = `<!-- autopilot-follow-up:${candidate.fingerprint} -->`;
      if (backlog.includes(marker)) {
        if (!backlog.includes(entry(candidate).trim())) {
          throw new Error(`existing backlog fingerprint content conflict: ${candidate.fingerprint}`);
        }
        duplicate.push(candidate.fingerprint);
        continue;
      }
      backlog += entry(candidate);
      admitted.push(candidate.fingerprint);
    }
    if (!options.dryRun && admitted.length > 0) {
      const temporary = `${options.backlog}.tmp-${process.pid}`;
      const mode = fs.statSync(options.backlog).mode & 0o777;
      fs.writeFileSync(temporary, backlog, { mode });
      fs.renameSync(temporary, options.backlog);
    }
    const proposedBacklogDigest = digest(backlog);
    const backlogAfterDigest = options.dryRun
      ? backlogBeforeDigest
      : digest(fs.readFileSync(options.backlog, 'utf8'));
    const body = {
      schema_version: 1,
      artifact_type: 'backlog_admission_receipt',
      current_ticket: options.currentTicket,
      current_ticket_reopened: false,
      admitted,
      duplicate,
      rejected: normalized.filter((item) => !item.eligible).map((item) => ({
        fingerprint: item.fingerprint || null,
        reason: item.reason,
      })),
      backlog_before_digest: backlogBeforeDigest,
      backlog_after_digest: backlogAfterDigest,
      proposed_backlog_digest: proposedBacklogDigest,
      dry_run: options.dryRun,
    };
    process.stdout.write(`${JSON.stringify({
      ...body,
      receipt_digest: digest(body),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`admit-backlog-follow-ups: ${error.message}\n`);
    process.exitCode = 2;
  } finally {
    if (lockDirectory !== null) {
      try { fs.rmdirSync(lockDirectory); } catch (_error) { /* fail closed already occurred */ }
    }
  }
}

main();
