#!/usr/bin/env node
'use strict';

// Admits candidate rows from a portfolio artifact or a campaign terminal receipt's
// follow_up findings into BACKLOG.md. When the target repository has a hippo store
// (.hippo/repo.toml), each candidate is admitted through scripts/project-record.js
// backlog new (--key <fingerprint16>) so store and BACKLOG.md stay in agreement;
// direct file write is used only for repositories without a store. Refuses two shapes
// of row regardless of otherwise-canonical evidence (plan-graduation DESIGN sentence 3):
// a 🔵-severity finding (reason: blue_severity_excluded) and any row with no Trigger
// (reason: missing_trigger).

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, validateJsonSchema } = require('./validate-json-schema');
const { validateCanonicalPortfolioOutput } = require('./review-mvp-portfolio');
const { validateFinalPanelReceipt } = require('../src/engine/campaign-composition');
const { acquireLock, releaseLock } = require('./lib/jsonl-store');
const hippo = require('./lib/hippo');
const rules = require('./lib/backlog-rules');
const rf = require('./lib/record-files');

const PROJECT_RECORD_JS = path.join(__dirname, 'project-record.js');
const RESOLVE_PATHS_SH = path.join(__dirname, 'resolve-project-paths.sh');

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
    backlog: path.resolve(require('./lib/repo-layout.js').pathFor(process.cwd(), 'backlog_file')), // cwd's own backlog: this repo's registry path, a consuming project's docs/BACKLOG.md
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
    const material = {
      context: disposition && disposition.context,
      evidence_digest: evidence && evidence.digest,
      finding_id: finding && finding.id,
      source: finding && finding.source,
      title: disposition && disposition.proposed_backlog_title,
      trigger: disposition && disposition.trigger,
    };
    const common = {
      fingerprint: digest(material),
      expected_fingerprint: digest(material),
      title: disposition && disposition.proposed_backlog_title,
      context: disposition && disposition.context,
      trigger: disposition && disposition.trigger,
      sources: [finding && finding.source, sourceFile].filter(nonEmpty),
    };
    // A 🔵 finding is a suggestion, never a queue row (DESIGN sentence 3): refuse it
    // before touching artifact canonicality, so it never masquerades as unsupported_evidence.
    if (finding && finding.severity === '🔵') {
      return { ...common, eligible: false, reason: 'blue_severity_excluded' };
    }
    // A row with no Trigger has nothing for the queue to fire on; refuse with a
    // specific reason rather than folding it into the generic canonicality bucket.
    if (!nonEmpty(disposition && disposition.trigger)) {
      return { ...common, eligible: false, reason: 'missing_trigger' };
    }
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
    return {
      ...common,
      eligible,
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

function findStoreRoot(backlogPath) {
  const probeDir = fs.existsSync(path.dirname(backlogPath)) ? path.dirname(backlogPath) : process.cwd();
  const r = spawnSync('git', ['-C', probeDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const root = String(r.stdout || '').trim();
  if (!root || !fs.existsSync(path.join(root, '.hippo', 'repo.toml'))) return null;
  return root;
}

function clampUtf8(str, maxBytes) {
  const clean = String(str).replace(/[\r\n]+/gu, ' ').trim();
  if (Buffer.byteLength(clean, 'utf8') <= maxBytes) return clean;
  let out = '';
  let used = 0;
  const budget = Math.max(0, maxBytes - 3);
  for (const ch of clean) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (used + b > budget) break;
    out += ch;
    used += b;
  }
  return `${out.trimEnd()}...`;
}

function buildStoreRowInput(candidate, currentTicket, repoRoot, cfg) {
  const key16 = candidate.fingerprint.slice(0, 16);
  const fpMarker = `follow-up:${candidate.fingerprint}`;
  const titleCap = rules.effectiveCap(cfg, 'Title');
  const title = clampUtf8(String(candidate.title).trim().replace(/[.\u3002]+$/u, '').trim(), titleCap)
    .replace(/[.\u3002]+$/u, '').trim();
  let trigger = clampUtf8(candidate.trigger, Math.min(rules.effectiveCap(cfg, 'Trigger'), 200));
  const problem = clampUtf8(candidate.context, rules.effectiveCap(cfg, 'Problem'));
  const impact = clampUtf8(`Deferred from ${currentTicket}; triggers when: ${trigger}`, rules.effectiveCap(cfg, 'Impact'));
  const srcParts = candidate.sources.map((s) => {
    if (!path.isAbsolute(s)) return s;
    const rel = path.relative(repoRoot, s).split(path.sep).join('/');
    return (!rel || rel.startsWith('..') || path.isAbsolute(rel)) ? path.basename(s) : rel;
  });
  let source = clampUtf8(`${srcParts.join('; ')} (${currentTicket})`, Math.min(rules.effectiveCap(cfg, 'Source'), 120));
  const rawCtx = String(candidate.context).replace(/[\r\n]+/gu, ' ').trim();
  const contextCap = rules.effectiveCap(cfg, 'Context');
  let context = Buffer.byteLength(`${rawCtx} (${fpMarker})`, 'utf8') <= contextCap
    ? `${rawCtx} (${fpMarker})`
    : fpMarker;
  const fitsPointerNone = () => {
    const fields = rules.proposedFields({
      title, id: 'BL-0000', status: 'open', since: '2026-01-01', origin: 'self',
      problem, impact, trigger, triggerType: 'event', effort: 'S', source, pointer: 'none', context,
    });
    return rules.legacyBytes(rules.entryForFields(fields)) <= rules.POINTER_THRESHOLD;
  };
  if (!fitsPointerNone()) context = fpMarker;
  if (!fitsPointerNone()) {
    source = clampUtf8(`${srcParts[0] || 'follow-up'} (${currentTicket})`, 64);
    trigger = clampUtf8(candidate.trigger, 140);
  }
  return { key16, fpMarker, title, trigger, problem, impact, source, context };
}

function resolvedDefaultBacklog(repoRoot) {
  const r = spawnSync('bash', [RESOLVE_PATHS_SH, '--target', repoRoot, '--field', 'backlog'], { encoding: 'utf8' });
  const v = r.status === 0 ? String(r.stdout || '').trim() : '';
  if (!v || v === 'none') return null;
  return path.isAbsolute(v) ? path.resolve(v) : path.resolve(repoRoot, v);
}

function clearLegacyDirectoryLock(lockFile) {
  let st;
  try {
    st = fs.lstatSync(lockFile);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!st.isDirectory()) return;
  try {
    fs.rmdirSync(lockFile);
  } catch (error) {
    throw new Error(
      `backlog admission lock unavailable: legacy directory lock is not empty at ${lockFile}: ${error.message}`,
    );
  }
}

function main() {
  let lockFile = null;
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

    const candidateLockPath = `${options.backlog}.admission.lock`;
    clearLegacyDirectoryLock(candidateLockPath);
    try {
      acquireLock({
        storeDir: path.dirname(options.backlog),
        lockFile: candidateLockPath,
        name: 'backlog admission',
      });
      lockFile = candidateLockPath;
    } catch (error) {
      throw new Error(`backlog admission lock unavailable: ${error.message}`);
    }
    // Read only after owning the lock. This is the compare point for concurrent
    // admissions; an earlier speculative read must never authorize a write.
    let backlog = fs.readFileSync(options.backlog, 'utf8');
    const backlogBeforeDigest = digest(backlog);
    const admitted = [];
    const duplicate = [];
    let proposedBacklogDigest;
    const storeRoot = findStoreRoot(options.backlog);
    if (storeRoot) {
      const gateCfg = rf.gateConfig(storeRoot);
      const byKeyTag = new Map();
      const listRes = hippo.run(storeRoot, ['list', '--history', '--limit', '1000000']);
      if (listRes.exit === 0 && listRes.data && Array.isArray(listRes.data.records)) {
        for (const rec of listRes.data.records) {
          if (rec.kind !== 'issue') continue;
          for (const tag of rec.tags || []) {
            if (tag.startsWith('key:')) byKeyTag.set(tag.slice(4), rec);
          }
        }
      }
      const overrideFile = `${options.backlog}.admission.paths-${process.pid}.md`;
      let useOverride = false;
      try {
        const defaultAbs = resolvedDefaultBacklog(storeRoot);
        if (defaultAbs !== path.resolve(options.backlog)) {
          const relBacklog = path.relative(storeRoot, path.resolve(options.backlog)).split(path.sep).join('/');
          if (!relBacklog || relBacklog.startsWith('..') || path.isAbsolute(relBacklog)) {
            throw new Error(`--backlog must reside inside repository ${storeRoot}`);
          }
          fs.writeFileSync(overrideFile, `## Project Paths\n- Backlog: \`${relBacklog}\`\n`);
          useOverride = true;
        }
        const childEnv = useOverride
          ? Object.assign({}, process.env, { PROJECT_PATHS_CONFIG_OVERRIDE: overrideFile })
          : process.env;
        const todayIso = (process.env.PROJECT_RECORD_NOW ? new Date(process.env.PROJECT_RECORD_NOW) : new Date())
          .toISOString().slice(0, 10);
        for (const candidate of byFingerprint.values()) {
          const spec = buildStoreRowInput(candidate, options.currentTicket, storeRoot, gateCfg);
          const legacyMarker = `<!-- autopilot-follow-up:${candidate.fingerprint} -->`;
          if (byKeyTag.has(spec.key16)) {
            const existingRec = byKeyTag.get(spec.key16);
            if (existingRec.title !== spec.title) {
              throw new Error(`existing backlog fingerprint content conflict: ${candidate.fingerprint}`);
            }
            duplicate.push(candidate.fingerprint);
            continue;
          }
          if (backlog.includes(spec.fpMarker)) {
            if (!backlog.includes(`### ${spec.title}`)) {
              throw new Error(`existing backlog fingerprint content conflict: ${candidate.fingerprint}`);
            }
            duplicate.push(candidate.fingerprint);
            continue;
          }
          if (backlog.includes(legacyMarker)) {
            if (!backlog.includes(entry(candidate).trim())) {
              throw new Error(`existing backlog fingerprint content conflict: ${candidate.fingerprint}`);
            }
            duplicate.push(candidate.fingerprint);
            continue;
          }
          if (options.dryRun) {
            const mark = backlog.match(rules.NEXT_ID_RE);
            const mm = mark && mark[1].match(rules.BL_ID_RE);
            if (!mm) throw new Error('the backlog has no valid <!-- next-id: BL-NNNN --> mark; add one first');
            const n = Number(mm[1]);
            const id = `BL-${String(n).padStart(mm[1].length, '0')}`;
            const nextId = `BL-${String(n + 1).padStart(mm[1].length, '0')}`;
            const existingTitles = [...backlog.matchAll(/^###\s+(.+)$/gmu)].map((m) => m[1].trim());
            const v = rules.assertProposedValid({
              title: spec.title, id, status: 'open', since: todayIso, origin: 'self',
              problem: spec.problem, impact: spec.impact, trigger: spec.trigger,
              triggerType: 'event', effort: 'S', source: spec.source, pointer: 'none', context: spec.context,
            }, { cfg: gateCfg, repoRoot: storeRoot, existingTitles });
            const bumped = backlog.replace(rules.NEXT_ID_RE, (whole, tok) => whole.replace(tok, nextId));
            backlog = `${bumped.replace(/\n*$/, '')}\n\n${v.row}\n`;
            admitted.push(candidate.fingerprint);
          } else {
            const r = spawnSync(process.execPath, [
              PROJECT_RECORD_JS, '--target', storeRoot, '--key', spec.key16, '--json',
              'backlog', 'new',
              '--title', spec.title,
              '--origin', 'self',
              '--trigger', spec.trigger,
              '--trigger-type', 'event',
              '--effort', 'S',
              '--source', spec.source,
              '--problem', spec.problem,
              '--impact', spec.impact,
              '--pointer', 'none',
              '--context', spec.context,
            ], { encoding: 'utf8', env: childEnv });
            if (r.status !== 0) {
              throw new Error((r.stderr || r.stdout || `project-record exited ${r.status}`).trim());
            }
            backlog = fs.readFileSync(options.backlog, 'utf8');
            admitted.push(candidate.fingerprint);
          }
        }
      } finally {
        if (useOverride) fs.rmSync(overrideFile, { force: true });
      }
      proposedBacklogDigest = digest(backlog);
    } else {
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
      proposedBacklogDigest = digest(backlog);
    }
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
    if (lockFile !== null) {
      releaseLock(lockFile);
    }
  }
}

main();
