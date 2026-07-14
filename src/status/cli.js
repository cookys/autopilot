'use strict';
// autopilot status — one human/agent-legible control surface over the three
// observation substrates that already exist (never re-derive, always reuse):
//   quota  → scripts/engine-capability-state.js report --capability quota
//   runs   → scripts/dispatch-status.js --list (+ per-live-run --run enrich)
//   roster → scripts/resolve-review-loop.sh --check-scorecard
//
// Subcommands:
//   autopilot status              overview (quota + live runs + roster seats)
//   autopilot status quota [--json] [--probe]
//   autopilot status runs  [--json]
//   autopilot status roster [--json]
//
// HONESTY CONTRACT: subscription CLIs (codex/grok/agy) expose no "remaining %"
// programmatically — what we CAN show is the recorded per-pool status, its
// reset_at, and HOW OLD the observation is (quota pools are per-model, not
// per-vendor: the 2026-07-14 lesson — gpt-5.3-codex-spark stayed available
// while gpt-5.5/gpt-5.6-sol were exhausted). `--probe` refreshes via
// probe-engine-capability.sh --safe (binary/auth surface only, NO model spend).
// Stale rows are flagged, never silently trusted.

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 30000, cwd: opts.cwd || ROOT });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch (_e) { return null; }
}

function ageLabel(iso, nowMs) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return 'unknown-age';
  const mins = Math.round((nowMs - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// --- quota --------------------------------------------------------------------

function collectQuota() {
  const r = sh('node', [path.join(ROOT, 'scripts', 'engine-capability-state.js'), 'report', '--capability', 'quota']);
  const rows = parseJsonSafe(r.stdout) || [];
  const nowMs = Date.now();
  return rows.map((row) => {
    const q = (row.capability && row.capability.quota) || {};
    const observedMs = Date.parse(String(row.observed_at || ''));
    const ttl = Number(q.ttl_seconds) || 0;
    const stale = Number.isFinite(observedMs) && ttl > 0
      ? (nowMs - observedMs) / 1000 > ttl
      : true;
    return {
      runner: row.runner,
      model: row.model,
      status: q.status || 'unknown',
      reset_at: q.reset_at || null,
      observed_at: row.observed_at || null,
      observed_age: ageLabel(row.observed_at, nowMs),
      stale,
      evidence: q.evidence || null,
    };
  });
}

function probeQuotaSafe(rows, stderr) {
  // SAFE surface only (binary/--version/auth status) — never a model prompt.
  const probe = path.join(ROOT, 'scripts', 'probe-engine-capability.sh');
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.runner}:${row.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = sh('bash', [probe, 'quota', '--runner', row.runner, '--model', row.model, '--safe'], { timeout: 60000 });
    if (r.status !== 0 && r.status !== null) {
      stderr.write(`probe ${key}: exit ${r.status}\n`);
    }
  }
}

function quotaHuman(rows, stdout) {
  if (rows.length === 0) {
    stdout.write('quota: no recorded observations (run a dispatch, or probe per-model with a tiny codex exec)\n');
    return;
  }
  stdout.write('QUOTA (recorded per-pool state; pools are PER-MODEL — never extrapolate across models)\n');
  for (const r of rows) {
    const flags = [r.stale ? 'STALE' : 'fresh', r.reset_at ? `reset ${r.reset_at}` : null].filter(Boolean).join(', ');
    stdout.write(`  ${r.runner}/${r.model}: ${r.status} (${r.observed_age}; ${flags})\n`);
  }
  stdout.write('note: subscription CLIs expose no remaining-%; status+reset+age is the honest ceiling. A model ABSENT here has no fresh observation (TTL-expired or never probed) — treat as unknown, probe per-model before relying.\n');
}

// --- runs ---------------------------------------------------------------------

function collectRuns() {
  const dispatch = path.join(ROOT, 'scripts', 'dispatch-status.js');
  const list = parseJsonSafe(sh('node', [dispatch, '--list']).stdout);
  const runs = Array.isArray(list) ? list : (list && Array.isArray(list.runs) ? list.runs : []);
  const out = [];
  let enriched = 0;
  for (const run of runs) {
    const entry = { ...run };
    const live = !(run.ended_at || run.final_status);
    if (live && run.run_id && enriched < 8) { // cap enrichment: each is a liveness probe
      enriched += 1;
      const s = parseJsonSafe(sh('node', [dispatch, '--run', String(run.run_id)]).stdout);
      if (s) {
        entry.phase = s.phase;
        entry.alive = s.alive;
        entry.stall = s.stall;
        entry.last_event_age_s = s.last_event_age_s;
      }
    }
    out.push(entry);
  }
  return out;
}

function runsHuman(runs, stdout) {
  const live = runs.filter((r) => !(r.ended_at || r.final_status));
  const done = runs.length - live.length;
  stdout.write(`RUNS (${live.length} live, ${done} finished manifests)\n`);
  for (const r of live) {
    const stall = r.stall ? ' STALL(report-only — cross-check before reacting)' : '';
    stdout.write(`  LIVE ${r.run_id} role=${r.role || '?'} ${r.runner || '?'}/${r.model || '?'} phase=${r.phase || '?'} alive=${r.alive}${stall}\n`);
  }
  if (live.length === 0) stdout.write('  (none live)\n');
}

// --- roster -------------------------------------------------------------------

function collectRoster(cwd) {
  const r = sh('bash', [path.join(ROOT, 'scripts', 'resolve-review-loop.sh'), '--check-scorecard'], { cwd });
  const j = parseJsonSafe(r.stdout);
  if (!j) return null;
  return {
    source: j.source,
    implementer: `${j.implementer_engine}@${j.implementer_effort} (${j.implementer_runner})`,
    reviewer_high_risk: `${j.reviewer_engine}@${j.reviewer_effort} (${j.reviewer_runner})`,
    reviewer_low_risk: j.reviewer_engine_low_risk
      ? `${j.reviewer_engine_low_risk}@${j.reviewer_effort_low_risk}`
      : '(tiering off)',
    on_family_conflict: j.on_family_conflict,
    fallback_preference: j.reviewer_fallback_preference,
    fallback_preference_low_risk: j.reviewer_fallback_preference_low_risk,
    reviewer_qualified: j.reviewer_qualified,
    fallback_ladder: (j.fallback_ladder || []).map((row) => `${row.engine}(${row.runner}${row.effort ? `@${row.effort}` : ''})`),
    qc_panel: j.qc_panel,
  };
}

function rosterHuman(ro, stdout) {
  if (!ro) { stdout.write('roster: resolver unavailable\n'); return; }
  stdout.write(`ROSTER (source: ${ro.source})\n`);
  stdout.write(`  implementer:        ${ro.implementer}\n`);
  stdout.write(`  reviewer high-risk: ${ro.reviewer_high_risk} (qualified=${ro.reviewer_qualified})\n`);
  stdout.write(`  reviewer low-risk:  ${ro.reviewer_low_risk}\n`);
  stdout.write(`  family conflict:    ${ro.on_family_conflict} | preference: ${JSON.stringify(ro.fallback_preference)} low-risk: ${JSON.stringify(ro.fallback_preference_low_risk)}\n`);
  stdout.write(`  fallback ladder:    ${ro.fallback_ladder.join(' > ') || '(empty)'}\n`);
  stdout.write(`  qc panel:           ${JSON.stringify(ro.qc_panel)}\n`);
}

// --- entry --------------------------------------------------------------------

function runStatusCli(argv, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) {
  const args = argv.slice();
  const sub = args[0] && !args[0].startsWith('--') ? args.shift() : 'overview';
  const json = args.includes('--json');
  const probe = args.includes('--probe');
  for (const a of args) {
    if (a !== '--json' && a !== '--probe') {
      stderr.write(`unknown status argument: ${a}\n`);
      return 2;
    }
  }

  if (sub === 'quota') {
    let rows = collectQuota();
    if (probe) { probeQuotaSafe(rows, stderr); rows = collectQuota(); }
    if (json) stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    else quotaHuman(rows, stdout);
    return 0;
  }
  if (sub === 'runs') {
    const runs = collectRuns();
    if (json) stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
    else runsHuman(runs, stdout);
    return 0;
  }
  if (sub === 'roster') {
    const ro = collectRoster(cwd);
    if (json) stdout.write(`${JSON.stringify(ro, null, 2)}\n`);
    else rosterHuman(ro, stdout);
    return 0;
  }
  if (sub === 'overview') {
    if (json) {
      stdout.write(`${JSON.stringify({ quota: collectQuota(), runs: collectRuns(), roster: collectRoster(cwd) }, null, 2)}\n`);
      return 0;
    }
    quotaHuman(collectQuota(), stdout);
    stdout.write('\n');
    runsHuman(collectRuns(), stdout);
    stdout.write('\n');
    rosterHuman(collectRoster(cwd), stdout);
    return 0;
  }
  stderr.write(`unknown status subcommand: ${sub} (quota|runs|roster or no subcommand for overview)\n`);
  return 2;
}

module.exports = { runStatusCli };
