#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_DIVISOR = 3.5;
const MAX_TRACE_BYTES = 128 * 1024 * 1024;
const INVENTORY_CATEGORIES = new Set([
  'core',
  'guided',
  'autonomous',
  'assurance',
  'topology',
  'obsolete',
]);

const HELP = `Usage:
  node scripts/measure-profile-context.js source --file <path> [--file <path>] [--divisor <n>]
  node scripts/measure-profile-context.js inventory --inventory <path> --source-manifest <path> [--repo <path>]
  node scripts/measure-profile-context.js codex-trace --trace <jsonl> [--component <id=path>] [--divisor <n>]
    [--max-trace-bytes <n>] [--allow-malformed]

Commands:
  source       Report source bytes, words, heuristic token estimate, and conservative rule candidates.
  inventory    Verify every rule candidate has one category and duplicated rules have one owner.
  codex-trace  Emit a content-free summary of developer-prompt catalog/component visibility.

Exit codes:
  0 success
  1 invalid input, drift, or unreadable evidence
  2 usage error
`;

class MeasurementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MeasurementError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MeasurementError(code, message);
}

function parseArgs(argv) {
  const command = argv[2];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return { help: true };
  }
  const options = { file: [], component: [], allow_malformed: false };
  const provided = [];
  const repeatable = new Set(['file', 'component']);
  const boolean = new Set(['allow_malformed']);
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') return { help: true };
    if (!token.startsWith('--')) fail('USAGE_ERROR', `unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-/g, '_');
    if (boolean.has(key)) {
      options[key] = true;
      provided.push(key);
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail('USAGE_ERROR', `${token} requires a value`);
    i += 1;
    if (repeatable.has(key)) options[key].push(value);
    else if (options[key] !== undefined) fail('USAGE_ERROR', `${token} may appear only once`);
    else options[key] = value;
    provided.push(key);
  }
  return { command, options, provided };
}

function assertOptions(provided, allowed) {
  const unknown = provided.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail(
      'USAGE_ERROR',
      `unsupported option(s): ${unknown.map((key) => `--${key.replace(/_/g, '-')}`).join(', ')}`,
    );
  }
}

function readUtf8(file, code = 'FILE_UNREADABLE') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(code, `${file}: ${error.message}`);
  }
}

function readUtf8Bounded(file, maxBytes, code = 'FILE_UNREADABLE') {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    fail(code, `${file}: ${error.message}`);
  }
  if (!stat.isFile()) fail(code, `${file}: not a regular file`);
  if (stat.size > maxBytes) {
    fail('TRACE_TOO_LARGE', `${file}: ${stat.size} bytes exceeds limit ${maxBytes}`);
  }
  const source = readUtf8(file, code);
  const actualBytes = Buffer.byteLength(source);
  if (actualBytes > maxBytes) {
    fail('TRACE_TOO_LARGE', `${file}: ${actualBytes} bytes exceeds limit ${maxBytes}`);
  }
  return source;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function positiveDivisor(value) {
  if (value === undefined) return TOKEN_DIVISOR;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail('INVALID_DIVISOR', 'divisor must be a positive number');
  }
  return parsed;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail('INVALID_LIMIT', `${label} must be a positive safe integer`);
  }
  return parsed;
}

function estimateTokens(bytes, divisor = TOKEN_DIVISOR) {
  return Math.ceil(bytes / divisor);
}

function wordCount(source) {
  const matches = source.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function sourceStats(file, divisor = TOKEN_DIVISOR) {
  const source = readUtf8(file);
  return {
    path: file,
    sha256: sha256(source),
    bytes: Buffer.byteLength(source),
    words: wordCount(source),
    lines: source.split(/\r?\n/).length,
    estimated_tokens: estimateTokens(Buffer.byteLength(source), divisor),
    token_source: `heuristic_bytes_div_${divisor}`,
    estimate_can_satisfy_budget: false,
    rule_candidate_occurrences: extractRuleCandidates(source).length,
  };
}

function extractRuleCandidates(source) {
  const lines = source.split(/\r?\n/);
  const units = [];
  let heading = '';
  let fenced = false;
  let frontmatter = lines[0] === '---';

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();

    if (frontmatter) {
      if (lineNumber > 1 && trimmed === '---') {
        frontmatter = false;
        continue;
      }
      if (/^\s{2,}\S/.test(raw)) {
        units.push({
          line: lineNumber,
          heading: 'frontmatter.description',
          fenced: false,
          content_hash: sha256(trimmed.replace(/\s+/g, ' ')),
        });
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      heading = trimmed.replace(/^#{1,6}\s+/, '');
      continue;
    }
    if (/^```/.test(trimmed)) {
      fenced = !fenced;
      continue;
    }
    if (!trimmed || /^<!--/.test(trimmed)) continue;
    if (/^---+$/.test(trimmed)) continue;
    if (/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(trimmed)) continue;

    units.push({
      line: lineNumber,
      heading,
      fenced,
      content_hash: sha256(trimmed.replace(/\s+/g, ' ')),
    });
  }
  return units;
}

function assertInsideRepo(repo, candidate, label) {
  let root;
  let target;
  try {
    root = fs.realpathSync(path.resolve(repo));
    target = fs.realpathSync(path.resolve(repo, candidate));
  } catch (error) {
    fail('PATH_UNRESOLVABLE', `${label}: ${candidate}: ${error.message}`);
  }
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('PATH_ESCAPE', `${label} escapes repository root: ${candidate}`);
  }
  return target;
}

function validateSegment(segment, sourceLines, sourcePath) {
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
    fail('INVALID_INVENTORY', `${sourcePath}: segment must be an object`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(segment.id || '')) {
    fail('INVALID_INVENTORY', `${sourcePath}: invalid segment id`);
  }
  if (!INVENTORY_CATEGORIES.has(segment.category)) {
    fail('INVALID_INVENTORY', `${sourcePath}:${segment.id}: invalid category`);
  }
  if (!Number.isInteger(segment.start_line) || !Number.isInteger(segment.end_line)
    || segment.start_line < 1 || segment.end_line < segment.start_line
    || segment.end_line > sourceLines) {
    fail('INVALID_INVENTORY', `${sourcePath}:${segment.id}: invalid line range`);
  }
}

function parseJsonFile(file, code) {
  try {
    return JSON.parse(readUtf8(file, code));
  } catch (error) {
    if (error instanceof MeasurementError) throw error;
    fail(code, `${file}: ${error.message}`);
  }
}

function occurrenceInRange(occurrence, range) {
  return occurrence.path === range.path
    && occurrence.line >= range.start_line
    && occurrence.line <= range.end_line;
}

function validateOccurrenceRange(range, label, sourceLineCounts) {
  if (!range || typeof range !== 'object' || Array.isArray(range)
    || typeof range.path !== 'string'
    || !Number.isInteger(range.start_line) || !Number.isInteger(range.end_line)
    || range.start_line < 1 || range.end_line < range.start_line
    || !sourceLineCounts.has(range.path)
    || range.end_line > sourceLineCounts.get(range.path)) {
    fail('INVALID_INVENTORY', `${label}: invalid occurrence range`);
  }
}

function validateRuleInventory(inventoryPath, repo = process.cwd(), sourceManifestPath) {
  const absoluteInventory = assertInsideRepo(repo, inventoryPath, 'inventory');
  if (!sourceManifestPath) {
    fail('SOURCE_MANIFEST_REQUIRED', 'inventory requires an independent source manifest');
  }
  const absoluteManifest = assertInsideRepo(repo, sourceManifestPath, 'source manifest');
  const manifest = parseJsonFile(absoluteManifest, 'SOURCE_MANIFEST_UNREADABLE');
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.sources)
    || manifest.sources.length === 0
    || manifest.sources.some((item) => typeof item !== 'string' || item.trim() === '')
    || new Set(manifest.sources).size !== manifest.sources.length) {
    fail('INVALID_SOURCE_MANIFEST', 'source manifest requires unique schema_version 1 sources[]');
  }
  const inventory = parseJsonFile(absoluteInventory, 'INVALID_INVENTORY');
  if (!inventory || inventory.schema_version !== 1 || !Array.isArray(inventory.sources)) {
    fail('INVALID_INVENTORY', 'inventory requires schema_version 1 and sources[]');
  }
  if (!Array.isArray(inventory.duplicate_rule_sets)) {
    fail('INVALID_INVENTORY', 'inventory requires duplicate_rule_sets[]');
  }
  const inventoryPaths = inventory.sources.map((entry) => entry && entry.path);
  if (inventoryPaths.length !== manifest.sources.length
    || manifest.sources.some((source) => !inventoryPaths.includes(source))
    || inventoryPaths.some((source) => !manifest.sources.includes(source))) {
    fail('SOURCE_SET_DRIFT', 'inventory sources must exactly match the independent source manifest');
  }
  const seenSourcePaths = new Set();
  const totals = Object.fromEntries(Array.from(INVENTORY_CATEGORIES, (key) => [key, 0]));
  const sourceResults = [];
  const allOccurrences = [];
  const sourceLineCounts = new Map();

  for (const entry of inventory.sources) {
    if (!entry || typeof entry.path !== 'string' || !Array.isArray(entry.segments)) {
      fail('INVALID_INVENTORY', 'each source requires path and segments[]');
    }
    if (seenSourcePaths.has(entry.path)) fail('DUPLICATE_SOURCE', entry.path);
    seenSourcePaths.add(entry.path);
    const absoluteSource = assertInsideRepo(repo, entry.path, 'source');
    const source = readUtf8(absoluteSource, 'SOURCE_UNREADABLE');
    const actualHash = sha256(source);
    if (entry.sha256 !== actualHash) {
      fail('SOURCE_HASH_DRIFT', `${entry.path}: expected ${entry.sha256}, got ${actualHash}`);
    }
    const units = extractRuleCandidates(source);
    const lineCount = source.split(/\r?\n/).length;
    sourceLineCounts.set(entry.path, lineCount);
    const segmentIds = new Set();
    for (const segment of entry.segments) {
      validateSegment(segment, lineCount, entry.path);
      if (segmentIds.has(segment.id)) fail('DUPLICATE_SEGMENT', `${entry.path}:${segment.id}`);
      segmentIds.add(segment.id);
    }
    const orderedSegments = [...entry.segments].sort((a, b) => a.start_line - b.start_line);
    for (let index = 1; index < orderedSegments.length; index += 1) {
      if (orderedSegments[index].start_line <= orderedSegments[index - 1].end_line) {
        fail(
          'OVERLAPPING_SEGMENTS',
          `${entry.path}:${orderedSegments[index - 1].id}+${orderedSegments[index].id}`,
        );
      }
    }

    const uncovered = [];
    const multiplyCovered = [];
    for (const unit of units) {
      const matches = entry.segments.filter(
        (segment) => unit.line >= segment.start_line && unit.line <= segment.end_line,
      );
      if (matches.length === 0) uncovered.push(unit.line);
      if (matches.length > 1) multiplyCovered.push({
        line: unit.line,
        segments: matches.map((segment) => segment.id),
      });
      if (matches.length === 1) {
        allOccurrences.push({
          path: entry.path,
          line: unit.line,
          content_hash: unit.content_hash,
          category: matches[0].category,
          segment: matches[0].id,
        });
      }
    }
    if (uncovered.length) {
      fail('UNCOVERED_RULES', `${entry.path}: uncovered rule-candidate lines ${uncovered.join(',')}`);
    }
    if (multiplyCovered.length) {
      const detail = multiplyCovered.map((item) => `${item.line}:${item.segments.join('+')}`).join(',');
      fail('MULTIPLE_RULE_OWNERS', `${entry.path}: ${detail}`);
    }
    sourceResults.push({
      path: entry.path,
      sha256: actualHash,
      rule_candidate_occurrences: units.length,
      segments: entry.segments.length,
    });
  }

  const duplicateSetIds = new Set();
  for (const duplicateSet of inventory.duplicate_rule_sets) {
    if (!duplicateSet || typeof duplicateSet !== 'object' || Array.isArray(duplicateSet)
      || !/^[a-z0-9][a-z0-9._-]*$/.test(duplicateSet.id || '')
      || !INVENTORY_CATEGORIES.has(duplicateSet.category)
      || !Array.isArray(duplicateSet.aliases) || duplicateSet.aliases.length === 0) {
      fail('INVALID_INVENTORY', 'each duplicate rule set requires id, category, owner, and aliases[]');
    }
    if (duplicateSetIds.has(duplicateSet.id)) fail('DUPLICATE_RULE_SET', duplicateSet.id);
    duplicateSetIds.add(duplicateSet.id);
    validateOccurrenceRange(
      duplicateSet.owner,
      `${duplicateSet.id}.owner`,
      sourceLineCounts,
    );
    duplicateSet.aliases.forEach((alias, index) => validateOccurrenceRange(
      alias,
      `${duplicateSet.id}.aliases[${index}]`,
      sourceLineCounts,
    ));
  }

  const byHash = new Map();
  for (const occurrence of allOccurrences) {
    if (!byHash.has(occurrence.content_hash)) byHash.set(occurrence.content_hash, []);
    byHash.get(occurrence.content_hash).push(occurrence);
  }
  let duplicateRuleHashes = 0;
  let aliasOccurrences = 0;
  const usedDuplicateSets = new Set();
  for (const occurrences of byHash.values()) {
    if (occurrences.length === 1) {
      totals[occurrences[0].category] += 1;
      continue;
    }
    duplicateRuleHashes += 1;
    const matchingSets = inventory.duplicate_rule_sets.filter((duplicateSet) => {
      const ownerMatches = occurrences.filter((item) => occurrenceInRange(item, duplicateSet.owner));
      const aliasMatches = occurrences.filter((item) => duplicateSet.aliases.some(
        (alias) => occurrenceInRange(item, alias),
      ));
      return ownerMatches.length === 1
        && aliasMatches.length === occurrences.length - 1
        && occurrences.every((item) => occurrenceInRange(item, duplicateSet.owner)
          || duplicateSet.aliases.some((alias) => occurrenceInRange(item, alias)));
    });
    if (matchingSets.length !== 1) {
      const locations = occurrences.map((item) => `${item.path}:${item.line}`).join(',');
      fail(
        matchingSets.length === 0 ? 'UNDECLARED_DUPLICATE_RULE' : 'MULTIPLE_CANONICAL_OWNERS',
        locations,
      );
    }
    const duplicateSet = matchingSets[0];
    if (occurrences.some((item) => item.category !== duplicateSet.category)) {
      fail(
        'DUPLICATE_RULE_CATEGORY_DRIFT',
        `${duplicateSet.id}: expected ${duplicateSet.category}`,
      );
    }
    usedDuplicateSets.add(duplicateSet.id);
    aliasOccurrences += occurrences.length - 1;
    totals[duplicateSet.category] += 1;
  }
  const unusedDuplicateSets = inventory.duplicate_rule_sets
    .map((item) => item.id)
    .filter((id) => !usedDuplicateSets.has(id));
  if (unusedDuplicateSets.length > 0) {
    fail('STALE_DUPLICATE_RULE_SET', unusedDuplicateSets.join(','));
  }

  return {
    schema_version: 1,
    status: 'valid',
    inventory: path.relative(path.resolve(repo), absoluteInventory),
    source_manifest: path.relative(path.resolve(repo), absoluteManifest),
    sources: sourceResults,
    rule_candidate_occurrences: allOccurrences.length,
    canonical_rules: allOccurrences.length - aliasOccurrences,
    duplicate_rule_hashes: duplicateRuleHashes,
    alias_occurrences: aliasOccurrences,
    category_totals: totals,
  };
}

function messageText(payload) {
  if (!payload || !Array.isArray(payload.content)) return '';
  return payload.content.map((item) => {
    if (!item || typeof item !== 'object') return '';
    return typeof item.text === 'string' ? item.text : '';
  }).join('');
}

function skillsBlock(source) {
  const open = '<skills_instructions>';
  const close = '</skills_instructions>';
  const start = source.indexOf(open);
  const end = source.indexOf(close, start + open.length);
  if (start < 0 || end < 0) return null;
  return source.slice(start, end + close.length);
}

function safeUsage(info) {
  if (!info || typeof info !== 'object') return null;
  const usage = info.last_token_usage;
  return {
    model_context_window: Number.isFinite(info.model_context_window)
      ? info.model_context_window : null,
    last_token_usage: usage && typeof usage === 'object' ? {
      input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
      cached_input_tokens: Number.isFinite(usage.cached_input_tokens)
        ? usage.cached_input_tokens : null,
      cache_write_input_tokens: Number.isFinite(usage.cache_write_input_tokens)
        ? usage.cache_write_input_tokens : null,
      output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
      reasoning_output_tokens: Number.isFinite(usage.reasoning_output_tokens)
        ? usage.reasoning_output_tokens : null,
      total_tokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
    } : null,
  };
}

function parseComponent(value, repo) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    fail('INVALID_COMPONENT', `component must be id=path: ${value}`);
  }
  const id = value.slice(0, separator);
  if (!/^[A-Za-z0-9._-]+$/.test(id)) fail('INVALID_COMPONENT', `invalid component id: ${id}`);
  const file = assertInsideRepo(repo, value.slice(separator + 1), 'component');
  const source = readUtf8(file, 'COMPONENT_UNREADABLE');
  if (!source) fail('INVALID_COMPONENT', `${id}: component body is empty`);
  return { id, file, source };
}

function countComponentOccurrences(value, components, field) {
  if (typeof value === 'string') {
    for (const component of components) {
      component[field] += value.split(component.source).length - 1;
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) countComponentOccurrences(item, components, field);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) countComponentOccurrences(item, components, field);
  }
}

function analyzeCodexTrace(tracePath, componentArgs = [], options = {}) {
  const divisor = positiveDivisor(options.divisor);
  const repo = options.repo || process.cwd();
  const maxTraceBytes = positiveInteger(
    options.maxTraceBytes,
    MAX_TRACE_BYTES,
    'max trace bytes',
  );
  const raw = readUtf8Bounded(tracePath, maxTraceBytes, 'TRACE_UNREADABLE');
  const parsedComponents = componentArgs.map((value) => {
    const component = parseComponent(value, repo);
    return {
      ...component,
      developer_prompt_occurrences: 0,
      other_trace_occurrences: 0,
    };
  });
  const catalogSnapshots = [];
  let cliVersion = null;
  let sessionId = null;
  let latestUsage = null;
  let malformedLines = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    const payload = event && event.payload;
    if (event.type === 'session_meta' && payload) {
      cliVersion = typeof payload.cli_version === 'string' ? payload.cli_version : cliVersion;
      sessionId = typeof payload.id === 'string'
        ? payload.id : (typeof payload.session_id === 'string' ? payload.session_id : sessionId);
    }
    if (event.type === 'event_msg' && payload && payload.type === 'token_count') {
      latestUsage = safeUsage(payload.info);
    }
    if (event.type === 'response_item' && payload
      && payload.type === 'message' && payload.role === 'developer') {
      const developerText = messageText(payload);
      countComponentOccurrences(
        developerText,
        parsedComponents,
        'developer_prompt_occurrences',
      );
      const block = skillsBlock(developerText);
      if (block !== null) {
        const bytes = Buffer.byteLength(block);
        catalogSnapshots.push({
          bytes,
          estimated_tokens: estimateTokens(bytes, divisor),
          token_source: `heuristic_bytes_div_${divisor}`,
          entry_count: (block.match(/^- [a-z0-9-]+(?::[a-z0-9-]+)?:/gm) || []).length,
          content_hash: sha256(block),
        });
      }
    } else {
      countComponentOccurrences(event, parsedComponents, 'other_trace_occurrences');
    }
  }

  if (malformedLines > 0 && options.allowMalformed !== true) {
    fail('TRACE_MALFORMED', `${tracePath}: ${malformedLines} malformed JSONL line(s)`);
  }

  const components = parsedComponents.map((component) => ({
    id: component.id,
    path: path.relative(path.resolve(repo), component.file),
    sha256: sha256(component.source),
    bytes: Buffer.byteLength(component.source),
    visibility_scope: 'developer_message_content',
    developer_prompt_occurrences: component.developer_prompt_occurrences,
    other_trace_occurrences: component.other_trace_occurrences,
    absence_claim_eligible: false,
  }));
  const catalogBytes = catalogSnapshots.map((item) => item.bytes);

  return {
    schema_version: 1,
    host: 'codex',
    cli_version: cliVersion,
    session_id_present: Boolean(sessionId),
    evidence: {
      kind: 'persisted_session_trace',
      trace_sha256: sha256(raw),
      integrity: malformedLines === 0 ? 'complete' : 'partial',
      malformed_lines: malformedLines,
      max_trace_bytes: maxTraceBytes,
      raw_content_emitted: false,
    },
    skill_catalog: {
      status: catalogSnapshots.length ? 'observed' : 'unverified',
      snapshots: catalogSnapshots.length,
      min_bytes: catalogBytes.length ? Math.min(...catalogBytes) : null,
      max_bytes: catalogBytes.length ? Math.max(...catalogBytes) : null,
      max_estimated_tokens: catalogSnapshots.length
        ? Math.max(...catalogSnapshots.map((item) => item.estimated_tokens)) : null,
      token_source: catalogSnapshots.length ? `heuristic_bytes_div_${divisor}` : null,
      exact_token_measurement: false,
      estimate_can_satisfy_budget: false,
      observations: catalogSnapshots,
    },
    components,
    latest_usage: latestUsage,
  };
}

function run(argv = process.argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const { command, options, provided } = parsed;
  const divisor = positiveDivisor(options.divisor);
  let result;
  if (command === 'source') {
    assertOptions(provided, new Set(['file', 'divisor']));
    if (!options.file.length) fail('USAGE_ERROR', 'source requires --file');
    result = {
      schema_version: 1,
      files: options.file.map((file) => sourceStats(file, divisor)),
    };
  } else if (command === 'inventory') {
    assertOptions(provided, new Set(['inventory', 'source_manifest', 'repo']));
    if (!options.inventory) fail('USAGE_ERROR', 'inventory requires --inventory');
    if (!options.source_manifest) fail('USAGE_ERROR', 'inventory requires --source-manifest');
    result = validateRuleInventory(
      options.inventory,
      options.repo || process.cwd(),
      options.source_manifest,
    );
  } else if (command === 'codex-trace') {
    assertOptions(provided, new Set([
      'trace',
      'component',
      'divisor',
      'repo',
      'max_trace_bytes',
      'allow_malformed',
    ]));
    if (!options.trace) fail('USAGE_ERROR', 'codex-trace requires --trace');
    result = analyzeCodexTrace(options.trace, options.component, {
      divisor,
      repo: options.repo || process.cwd(),
      maxTraceBytes: options.max_trace_bytes,
      allowMalformed: options.allow_malformed,
    });
  } else {
    fail('USAGE_ERROR', `unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    const code = error instanceof MeasurementError ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = code === 'USAGE_ERROR' ? 2 : 1;
  }
}

module.exports = {
  MeasurementError,
  analyzeCodexTrace,
  estimateTokens,
  extractRuleCandidates,
  run,
  sha256,
  sourceStats,
  validateRuleInventory,
};
