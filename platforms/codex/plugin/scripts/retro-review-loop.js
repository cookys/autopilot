#!/usr/bin/env node
'use strict';
/*
 * Cross-harness review-loop lens for `skills/retro`.
 *
 * Harness-specific adapters discover and normalize local Claude Code and Codex
 * transcripts into a privacy-bounded event contract. Canonical repo/worktree
 * attribution decides inclusion before aggregate metrics are rendered. Raw
 * messages, prompts, reasoning, commands, and tool output are never emitted.
 *
 * Usage:
 *   node scripts/retro-review-loop.js [--days N] [--json] [--no-git]
 *     [--transcript-dir <dir>]  # backward-compatible Claude-only override
 *     [--claude-root <dir>] [--codex-root <dir>] [--repo <dir>]
 *     [--now <ISO>] [--max-file-bytes N] [--max-lines N] [--max-files N]
 *
 * Exit: 0. Missing/unreadable roots are represented in provenance and warnings.
 */
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanTranscriptAdapters } = require('./lib/transcript-adapters');
const {
  attributeSession,
  createRepoIdentity,
} = require('./lib/transcript-attribution');
const {
  aggregateTranscript,
  computeLoopMetrics,
  dispatchTotal,
} = require('./lib/retro-loop-metrics');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const out = {
    days: 7,
    json: false,
    git: true,
    transcriptDir: '',
    claudeRoot: '',
    codexRoot: '',
    repo: process.cwd(),
    now: '',
    maxFileBytes: 8 * 1024 * 1024,
    maxLines: 50000,
    maxFiles: 500,
    maxTotalBytes: 64 * 1024 * 1024,
    scanTimeoutMs: 5000,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--days') out.days = positiveInteger(argv[++index], 7);
    else if (arg === '--json') out.json = true;
    else if (arg === '--no-git') out.git = false;
    else if (arg === '--transcript-dir') out.transcriptDir = argv[++index] || '';
    else if (arg === '--claude-root') out.claudeRoot = argv[++index] || '';
    else if (arg === '--codex-root') out.codexRoot = argv[++index] || '';
    else if (arg === '--repo') out.repo = argv[++index] || process.cwd();
    else if (arg === '--now') out.now = argv[++index] || '';
    else if (arg === '--max-file-bytes') {
      out.maxFileBytes = positiveInteger(argv[++index], out.maxFileBytes);
    } else if (arg === '--max-lines') {
      out.maxLines = positiveInteger(argv[++index], out.maxLines);
    } else if (arg === '--max-files') {
      out.maxFiles = positiveInteger(argv[++index], out.maxFiles);
    } else if (arg === '--max-total-bytes') {
      out.maxTotalBytes = positiveInteger(argv[++index], out.maxTotalBytes);
    } else if (arg === '--scan-timeout-ms') {
      out.scanTimeoutMs = positiveInteger(argv[++index], out.scanTimeoutMs);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    'retro-review-loop.js - cross-harness review-loop lens for skills/retro\n'
    + '  --days N              window size in days (default 7)\n'
    + '  --json                machine-readable JSON only\n'
    + '  --no-git              skip git commit-message signals\n'
    + '  --transcript-dir D    backward-compatible Claude-only trusted root\n'
    + '  --claude-root D       Claude project transcript root\n'
    + '  --codex-root D        Codex sessions date-tree root\n'
    + '  --repo D               repository/worktree identity to attribute\n'
    + '  --now ISO              injected clock for deterministic tests\n'
    + '  --max-file-bytes N     per-file read bound\n'
    + '  --max-lines N          per-file JSONL line bound\n'
    + '  --max-files N          per-adapter candidate bound\n'
    + '  --max-total-bytes N    aggregate transcript read bound\n'
    + '  --scan-timeout-ms N    aggregate wall-clock scan bound\n',
  );
}

function defaultClaudeRoot(repo) {
  const encoded = path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function resolveAdapterSpecs(opts, identity) {
  const legacyRoot = opts.transcriptDir || process.env.RETRO_TRANSCRIPT_DIR || '';
  const claudeRoots = opts.claudeRoot || legacyRoot
    ? [opts.claudeRoot || legacyRoot]
    : (identity.worktrees.length > 0 ? identity.worktrees : [opts.repo])
      .map(defaultClaudeRoot);
  const codexRoot = opts.codexRoot
    || (legacyRoot ? '' : path.join(os.homedir(), '.codex', 'sessions'));
  const specs = [...new Set(claudeRoots)].map((root) => ({
    harness: 'claude',
    root,
    explicitOverride: Boolean(legacyRoot),
  }));
  specs.push({
    harness: 'codex',
    root: codexRoot,
    explicitOverride: false,
  });
  return specs;
}

function gitSignals(days, repo) {
  const signals = {
    review_rounds: 0,
    qc_verdicts: 0,
    converged: 0,
    versions: 0,
    available: false,
  };
  let log = '';
  try {
    log = execFileSync(
      'git',
      [
        '-C',
        repo,
        'log',
        'origin/develop',
        `--since=${days} days ago`,
        '-z',
        '--format=%s%n%b',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      },
    );
  } catch {
    return signals;
  }
  signals.available = true;
  const commits = log.split('\0').map((commit) => commit.trim()).filter(Boolean);
  const commitsWith = (pattern) => commits.filter((commit) => pattern.test(commit)).length;
  signals.review_rounds = commitsWith(
    /gpt-5\.5\s+R[0-9]|review round[s]? [0-9]|\(R[0-9]\)|\b[0-9]+ rounds?\b/i,
  );
  signals.qc_verdicts = commitsWith(/qc[- ]?verdict|qc pass|depth-0 qc/i);
  signals.converged = commitsWith(/converged|SHIP-AS-IS/i);
  const versions = new Set();
  for (const match of log.matchAll(/v2\.[0-9]+\.[0-9]+/g)) versions.add(match[0]);
  signals.versions = versions.size;
  return signals;
}

function projectSessionToWindow(session, cutoffMs, nowMs) {
  const events = [];
  let beforeWindow = 0;
  let afterWindow = 0;
  let missingTimestamp = 0;
  for (const event of session.events) {
    const timestamp = event.timestamp ? Date.parse(event.timestamp) : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      missingTimestamp += 1;
    } else if (timestamp < cutoffMs) {
      beforeWindow += 1;
    } else if (timestamp > nowMs) {
      afterWindow += 1;
    } else {
      events.push(event);
    }
  }
  return {
    ...session,
    events,
    providerDispatchBindings: session.events.filter(
      (event) => event.category === 'provider_dispatch',
    ),
    metricProjection: {
      interval: 'closed',
      included: events.length,
      before_window: beforeWindow,
      after_window: afterWindow,
      missing_timestamp: missingTimestamp,
    },
  };
}

function metricEvidence(scans, projectedSessions) {
  const reasons = new Set();
  for (const scan of scans) {
    const prefix = scan.harness || 'unknown';
    if (scan.status === 'unreadable') reasons.add(`${prefix}:root_unreadable`);
    else if (scan.unreadable) reasons.add(`${prefix}:partial_unreadable`);
    if (scan.truncated) reasons.add(`${prefix}:candidate_limit`);
    if (scan.budgetExceeded > 0) reasons.add(`${prefix}:scan_budget_exceeded`);
    if (scan.schemaErrors > 0) reasons.add(`${prefix}:schema_invalid`);
    for (const session of scan.sessions) {
      if (session.readError) reasons.add(`${prefix}:read_error`);
      if (session.parseErrors > 0) reasons.add(`${prefix}:parse_incomplete`);
      if (session.truncatedBytes) reasons.add(`${prefix}:byte_limit`);
      if (session.truncatedLines) reasons.add(`${prefix}:line_limit`);
    }
  }
  if (projectedSessions.some(
    (session) => session.metricProjection.missing_timestamp > 0,
  )) {
    reasons.add('attributed_event:missing_timestamp');
  }
  const values = [...reasons].sort();
  return {
    status: values.length > 0 ? 'incomplete' : 'complete',
    reasons: values,
  };
}

function provenanceEntry(scan, decisions) {
  const reasons = {};
  const confidence = {};
  for (const decision of decisions) {
    if (decision.attribution.included) {
      const label = decision.attribution.confidence || 'unknown';
      confidence[label] = (confidence[label] || 0) + 1;
    } else {
      const reason = decision.attribution.reason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }
  return {
    harness: scan.harness,
    adapter: scan.harness,
    root: scan.root || null,
    status: scan.status,
    candidate_count: scan.candidates.length,
    included_count: decisions.filter((item) => item.attribution.included).length,
    excluded_count: decisions.filter((item) => !item.attribution.included).length,
    parse_error_count: scan.sessions.reduce(
      (total, session) => total + session.parseErrors, 0,
    ),
    schema_error_count: scan.schemaErrors,
    exclusion_reasons: reasons,
    attribution_confidence: confidence,
    bounds: {
      candidate_limit_hit: scan.truncated,
      byte_limit_hit: scan.sessions.filter((session) => session.truncatedBytes).length,
      line_limit_hit: scan.sessions.filter((session) => session.truncatedLines).length,
      scan_budget_exceeded: scan.budgetExceeded,
    },
    metric_projection: {
      interval: 'closed',
      included_event_count: decisions.reduce(
        (total, decision) => total + (
          decision.metricProjection ? decision.metricProjection.included : 0
        ),
        0,
      ),
      before_window_event_count: decisions.reduce(
        (total, decision) => total + (
          decision.metricProjection ? decision.metricProjection.before_window : 0
        ),
        0,
      ),
      after_window_event_count: decisions.reduce(
        (total, decision) => total + (
          decision.metricProjection ? decision.metricProjection.after_window : 0
        ),
        0,
      ),
      missing_timestamp_event_count: decisions.reduce(
        (total, decision) => total + (
          decision.metricProjection ? decision.metricProjection.missing_timestamp : 0
        ),
        0,
      ),
    },
  };
}

function collect(opts) {
  const parsedNow = opts.now ? Date.parse(opts.now) : Date.now();
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const cutoffMs = nowMs - opts.days * 86400 * 1000;
  const identity = createRepoIdentity(opts.repo);
  const specs = resolveAdapterSpecs(opts, identity);
  const scans = scanTranscriptAdapters(specs, {
    cutoffMs,
    nowMs,
    maxFileBytes: opts.maxFileBytes,
    maxLines: opts.maxLines,
    maxFiles: opts.maxFiles,
    maxTotalBytes: opts.maxTotalBytes,
    scanTimeoutMs: opts.scanTimeoutMs,
  });
  const included = [];
  const metricSessions = [];
  const provenance = [];
  const warnings = [];

  for (const scan of scans) {
    const decisions = scan.sessions.map((session) => {
      const attribution = attributeSession(session, identity, {
        cutoffMs,
        nowMs,
        trustRootOverride: scan.explicitOverride,
      });
      let projection = null;
      if (attribution.included) {
        const attributed = { ...session, attribution };
        included.push(attributed);
        const projected = projectSessionToWindow(attributed, cutoffMs, nowMs);
        metricSessions.push(projected);
        projection = projected.metricProjection;
      }
      return { session, attribution, metricProjection: projection };
    });
    const entry = provenanceEntry(scan, decisions);
    provenance.push(entry);
    if (entry.status === 'scanned'
        && entry.candidate_count > 0
        && entry.included_count === 0) {
      const reasons = Object.entries(entry.exclusion_reasons)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(', ') || 'no attributable events';
      warnings.push(
        `${entry.harness}: ${entry.candidate_count} recent candidate(s), zero included (${reasons})`,
      );
    }
    if (entry.status === 'unreadable') {
      warnings.push(`${entry.harness}: supported transcript root is unreadable`);
    }
  }

  const evidence = metricEvidence(scans, metricSessions);
  const transcript = aggregateTranscript(metricSessions);
  const git = opts.git ? gitSignals(
    opts.days,
    identity.canonical_root || identity.requested_root,
  ) : {
    available: false,
    review_rounds: 0,
    qc_verdicts: 0,
    converged: 0,
    versions: 0,
  };
  return {
    window_days: opts.days,
    transcript_dir: specs[0].root,
    transcript,
    transcript_observation: evidence,
    hetero_dispatch_total: dispatchTotal(transcript),
    git_signals: git,
    coverage: {
      repo_root: identity.canonical_root || identity.requested_root,
      git_identity: identity.available ? 'available' : 'unavailable',
      harnesses_scanned: provenance
        .filter((entry) => entry.status === 'scanned')
        .map((entry) => entry.harness)
        .filter((harness, index, values) => values.indexOf(harness) === index),
      included_sessions: included.length,
      metric_window: {
        start: new Date(cutoffMs).toISOString(),
        end: new Date(nowMs).toISOString(),
        interval: 'closed',
      },
      metric_evidence: evidence,
      warnings,
    },
    provenance,
    warnings,
    loop_metrics: computeLoopMetrics(metricSessions, evidence),
    normalized_event_contract: {
      schema_version: 1,
      path: 'schemas/normalized-transcript-event.schema.json',
      raw_content_emitted: false,
    },
  };
}

function metricValue(metric) {
  if (metric.status === 'known') return String(metric.value);
  if (metric.status === 'incomplete') {
    return `incomplete (observed ${metric.value}; ${metric.reason})`;
  }
  return `unknown (${metric.reason})`;
}

function renderHuman(output) {
  const lines = [];
  lines.push('Transcript Coverage');
  lines.push(`   window: ${output.window_days}d | repo: ${output.coverage.repo_root}`);
  lines.push(`   metric evidence: ${output.transcript_observation.status}`
    + (output.transcript_observation.reasons.length > 0
      ? ` (${output.transcript_observation.reasons.join(', ')})`
      : ''));
  for (const entry of output.provenance) {
    lines.push(
      `   ${entry.harness}: ${entry.status} | candidates ${entry.candidate_count}`
      + ` | included ${entry.included_count} | excluded ${entry.excluded_count}`
      + ` | parse errors ${entry.parse_error_count}`,
    );
  }
  for (const warning of output.coverage.warnings) lines.push(`   WARNING: ${warning}`);
  lines.push('');
  lines.push('🔁 Review-Loop Lens (review-loop effort git-history retro cannot see)');
  lines.push(`   window: ${output.window_days}d | transcripts: ${output.transcript_dir}`);
  lines.push('');
  lines.push(`   sessions attributed    : ${output.transcript.sessions}`);
  lines.push(`   observed tool_use calls: ${output.transcript.total_tool_calls}`
    + ` (Bash ${output.transcript.bash_calls} / Agent ${output.transcript.agent_calls})`);
  lines.push('   ── hetero-engine dispatch / review / debate (real shell invocations) ──');
  lines.push(`   impl dispatch (hetero) : ${output.transcript.impl_dispatch}`);
  lines.push(`   review dispatch        : ${output.transcript.review_dispatch}`
    + '   [incl. ad-hoc harness/debug runs]');
  lines.push(`   direct codex exec      : ${output.transcript.codex_exec}`);
  lines.push(`   agy / grok / explore   : ${output.transcript.agy_dispatch}`
    + ` / ${output.transcript.grok_dispatch} / ${output.transcript.explore}`);
  lines.push(`   engine implement-review: ${output.transcript.engine_implement_review}`);
  lines.push(`   ─────  TOTAL           : ${output.hetero_dispatch_total}`
    + ' hetero dispatch/review/debate invocations');
  if (output.git_signals.available) {
    lines.push('   ── git commit-message loop signals (commits carrying each marker) ──');
    lines.push(`   review-driven commits  : ${output.git_signals.review_rounds}`);
    lines.push(`   QC-verdict commits     : ${output.git_signals.qc_verdicts}`);
    lines.push(`   converged / SHIP-AS-IS : ${output.git_signals.converged}`);
    lines.push(`   distinct versions      : ${output.git_signals.versions}`);
  }
  const deterministic = output.loop_metrics.deterministic;
  const heuristic = output.loop_metrics.heuristic;
  lines.push('');
  lines.push('Loop / Control Metrics');
  lines.push(`   provider dispatches   : ${metricValue(deterministic.provider_dispatches)}`);
  lines.push(`   provider reroutes     : ${metricValue(deterministic.provider_reroutes)}`);
  lines.push(`   transport failures   : ${metricValue(deterministic.transport_failures)}`);
  lines.push(`   ticket continuations : ${metricValue(deterministic.ticket_continuations)}`);
  lines.push(`   review generations   : ${metricValue(deterministic.review_generations)}`);
  lines.push(`   worktree high-water  : ${metricValue(deterministic.worktrees.high_water_mark)}`);
  lines.push(`   code->merge ready ms : ${metricValue(deterministic.code_ready_to_merge_ready_ms)}`);
  lines.push(`   user corrections     : ${metricValue(heuristic.user_corrections)} [heuristic]`);
  lines.push(`   status reversals     : ${metricValue(heuristic.status_reversals)} [heuristic]`);
  lines.push('');
  lines.push('   NOTE: review_dispatch includes harness/debug runs; deterministic and heuristic');
  lines.push('   evidence classes remain separate, and only attributed local sessions are counted.');
  lines.push('   Privacy: aggregate/redacted evidence only; no prompt, reasoning, command, or output body.');
  return `${lines.join('\n')}\n`;
}

function emptyFailure(opts, error) {
  const transcript = aggregateTranscript([]);
  const warnings = [`collection_error: ${error && error.code ? error.code : 'unexpected'}`];
  return {
    window_days: opts.days,
    transcript_dir: opts.transcriptDir || opts.claudeRoot || null,
    transcript,
    transcript_observation: {
      status: 'incomplete',
      reasons: ['collection_error'],
    },
    hetero_dispatch_total: 0,
    git_signals: {
      available: false,
      review_rounds: 0,
      qc_verdicts: 0,
      converged: 0,
      versions: 0,
    },
    coverage: {
      repo_root: path.resolve(opts.repo),
      git_identity: 'unavailable',
      harnesses_scanned: [],
      included_sessions: 0,
      metric_window: null,
      metric_evidence: {
        status: 'incomplete',
        reasons: ['collection_error'],
      },
      warnings,
    },
    provenance: [],
    warnings,
    loop_metrics: computeLoopMetrics([], {
      status: 'incomplete',
      reasons: ['collection_error'],
    }),
    normalized_event_contract: {
      schema_version: 1,
      path: 'schemas/normalized-transcript-event.schema.json',
      raw_content_emitted: false,
    },
  };
}

function main() {
  const opts = parseArgs(process.argv);
  let output;
  try {
    output = collect(opts);
  } catch (error) {
    output = emptyFailure(opts, error);
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(renderHuman(output));
  }
}

main();
