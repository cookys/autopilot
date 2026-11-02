'use strict';

// scripts/lib/events-fixture.js - fixture repo + every source store of the events feed (autopilot.events/1),
// built in a caller-given tempdir. Used by scripts/status-events.test.js (and, from E4, the bench and the doc gate).
//
//   buildFixture({ dir })  -> fx   writes a git repo, the manifests dir, costs file, review ledgers, decision
//                                  ledgers and a rotated run ledger under `dir`; never reads or writes anything else.
//   goldenEvents(fx)       -> the hand-derived event list (sorted by (ts, id)) the readers of E2 must reproduce.
//   goldenEnvelope(fx)     -> a small example envelope (schema + doc example).
//   normaliseExample(v,fx) -> v with tempdir / project_key / repo_name / generated_at replaced by the doc placeholders.
//
// Golden ids are derived HERE from the literal row text this module wrote, with this module's own sha256 helper,
// never by the code under test (E2 readers). Ids that do not depend on a path or on random bytes (commit shas under
// the pinned git env, run_id, decision_id, phase_base12 of literal base shas) are literal constants.
//
// Isolation: the env handed back is built from an explicit allowlist (never a copy of process.env); GIT_CONFIG_NOSYSTEM=1
// and GIT_CONFIG_GLOBAL point into the tempdir; only the pinned fixture GIT_* variables exist, and only while committing.
// Secret-shaped strings are assembled at run time so no token-looking literal sits in the source.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { scopeFromCwd } = require('../../src/status/project-key');
const { canonical } = require('../validate-json-schema');

const sha256hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The "canonical row" of the id rules is the validator's canonical() (key-sorted compact JSON): one implementation,
// shared with scripts/validate-json-schema.js and, later, the E2 readers.
const canonicalJson = canonical;

// Commit shas are constants under the pinned env below (same tree, message, author, committer, dates, parent).
const FIXTURE_COMMITS = {
  c1: '576de6de3fd53f2b783385fbee0744fe92051d53',
  c2: 'c32883fa590c3f1538a0743f77a41faae4dc5520',
  c3: '9403e1b493da7cd7b5964d2c5eaeb4ba3fb59cbf',
};

const FOREIGN_BASE = 'f'.repeat(40); // a commit that does not exist in the fixture repo

// The addresses are joined at run time so the source carries no email-shaped literal (leak-guard).
const GIT_PIN = {
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: ['author', 'fixture.invalid'].join('@'),
  GIT_COMMITTER_NAME: 'Fixture Committer',
  GIT_COMMITTER_EMAIL: ['committer', 'fixture.invalid'].join('@'),
};

// [subject, trailer|null, committer date as git reads it]. The second date carries a +01:00 offset (%cI exercise).
const COMMITS = [
  ['init', null, '2026-11-01T08:00:00+00:00'],
  ['feat: add thing', 'QC-Verdict: PASS', '2026-11-01T09:30:00+01:00'],
  ['fix: other thing', 'QC-Verdict: WAIVED', '2026-11-01T10:00:00+00:00'],
];

function tokenShaped() {
  return ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0'.repeat(2).slice(0, 36)].join('');
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function jsonl(rows) {
  return rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n';
}

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function buildEnv(dir) {
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const gitConfig = path.join(dir, 'gitconfig');
  writeFile(gitConfig, '[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n');
  const configFile = path.join(dir, 'autopilot-config.json');
  writeFile(configFile, '{}\n');
  return {
    HOME: home,
    TMPDIR: tmp,
    PATH: process.env.PATH,
    LC_ALL: 'C',
    AUTOPILOT_COSTS_FILE: path.join(dir, 'metrics', 'costs.jsonl'),
    AUTOPILOT_DISPATCH_RUNS_DIR: path.join(dir, 'runs'),
    AUTOPILOT_CONFIG_FILE: configFile,
    AUTOPILOT_LIVE_DIR: path.join(dir, 'live'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
  };
}

function initRepo(repoDir, env, commits) {
  fs.mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init', '-q', '--template=', '-b', 'main'], env);
  const shas = [];
  commits.forEach(([subject, trailer, date], index) => {
    writeFile(path.join(repoDir, 'README.md'), `fixture ${index + 1}\n`);
    git(repoDir, ['add', 'README.md'], env);
    const message = trailer ? ['-m', subject, '-m', trailer] : ['-m', subject];
    git(repoDir, ['commit', '-q', ...message], { ...env, ...GIT_PIN, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    shas.push(git(repoDir, ['rev-parse', 'HEAD'], env));
  });
  return shas;
}

function buildFixture({ dir }) {
  const root = fs.realpathSync(dir);
  const env = buildEnv(root);
  const repoDir = path.join(root, 'repo');
  const foreignDir = path.join(root, 'foreign');
  const commits = initRepo(repoDir, env, COMMITS);
  initRepo(foreignDir, env, []);
  const [c1, c2, c3] = commits;

  const scope = scopeFromCwd(repoDir);
  const foreignScope = scopeFromCwd(foreignDir);
  const identity = scope.repo_identity;
  const foreignIdentity = foreignScope.repo_identity;
  const commonDir = identity.replace(/^git-common-dir:/, '');
  const paths = {
    costsFile: env.AUTOPILOT_COSTS_FILE,
    runsDir: env.AUTOPILOT_DISPATCH_RUNS_DIR,
    decisionLedger: path.join(commonDir, 'autopilot', 'ledger', 'decisions.jsonl'),
    workOrderLedger: path.join(commonDir, 'autopilot', 'work-orders', 'fx-root-1', 'decision-ledger.jsonl'),
    runLedger: path.join(root, 'ledgers', 'run-ledger.jsonl'),
    runLedgerRotated: path.join(root, 'ledgers', 'run-ledger.jsonl.1'),
    reviewPointer: path.join(commonDir, 'autopilot', 'review-ledgers.txt'),
    reviewLedgers: {
      a: path.join(root, 'ledgers', 'review-a'),
      b: path.join(root, 'ledgers', 'review-b'),
      foreign: path.join(root, 'ledgers', 'review-foreign'),
      c: path.join(root, 'ledgers', 'review-c'),
    },
    removedWorktree: path.join(root, 'worktrees', 'fx-run-done'),
    liveWorktree: path.join(root, 'worktrees', 'fx-run-live'),
  };

  // ---- manifests (second-precision Z, as `date -u +%Y-%m-%dT%H:%M:%SZ` writes them) -------------------------------
  const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);
  const manifest = (over) => ({
    schema: 1, role: 'implementer', runner: 'codex', model: 'gpt-fx-1', base: 'main', base_sha: c1,
    lock_path: `${over.worktree}/.autopilot-worktree.lock`, log_path: path.join(root, 'logs', `${over.run_id}.log`),
    log_format: 'codex-chrome', pid: 4242, containment_planned: 'plain',
    prompt_file: path.join(root, 'prompts', `${over.run_id}.md`), scaffold_tier: 'off', ledger: paths.runLedger, stage: 'implement',
    ended_at: null, ended_epoch: null, final_status: null, parent_run_id: null, root_run_id: 'fx-root-1', depth: 0,
    timeout_seconds: 600, timeout_source: 'default', timeout_enforced: true,
    repo_identity: identity, repo_identity_source: 'git-common-dir', ...over,
  });
  const done = manifest({
    run_id: 'fx-run-done', branch: 'dispatch/fx-done', worktree: paths.removedWorktree,
    started_at: '2026-11-01T08:10:00Z', started_epoch: epoch('2026-11-01T08:10:00Z'),
    ended_at: '2026-11-01T08:25:00Z', ended_epoch: epoch('2026-11-01T08:25:00Z'), final_status: 'success',
  });
  const live = manifest({
    run_id: 'fx-run-live', branch: 'dispatch/fx-live', worktree: paths.liveWorktree,
    started_at: '2026-11-01T08:40:00Z', started_epoch: epoch('2026-11-01T08:40:00Z'),
    parent_run_id: 'fx-run-done', depth: 1,
  });
  const foreignManifest = manifest({
    run_id: 'fx-run-foreign', branch: 'dispatch/fx-foreign', worktree: path.join(root, 'worktrees', 'fx-run-foreign'),
    started_at: '2026-11-01T08:45:00Z', started_epoch: epoch('2026-11-01T08:45:00Z'),
    repo_identity: foreignIdentity, root_run_id: 'fx-root-9', ledger: null,
  });
  for (const m of [done, live, foreignManifest]) {
    writeFile(path.join(paths.runsDir, `${m.run_id}.manifest.json`), JSON.stringify(m) + '\n');
  }

  // ---- costs.jsonl (rows as hooks/cost-tracker.js writes them) ----------------------------------------------------
  const costRow = (over) => JSON.stringify({
    ts: '2026-11-01T08:12:00.000Z', session: 's-fx-1', model: 'claude-sonnet-5-5',
    input_tokens: 1200, output_tokens: 300, cache_read_tokens: 8000, cache_write_tokens: 500, cost_usd: 0.0123,
    cwd: repoDir, ...over,
  });
  const cost = {
    main: costRow({}),
    sub: costRow({ model: 'claude-fable-5', sidechain: true, agent_id: 'agent-fx-1', input_tokens: 900, output_tokens: 150, cost_usd: 0.0456 }),
    removedWorktree: costRow({ ts: '2026-11-01T08:13:00.000Z', session: 's-fx-2', cwd: paths.removedWorktree, cost_usd: 0.002 }),
    identical: costRow({ ts: '2026-11-01T08:26:00.000Z', session: 's-fx-3', model: 'claude-haiku-5', cost_usd: 0.001 }),
    foreign: costRow({ ts: '2026-11-01T08:14:00.000Z', session: 's-fx-9', cwd: foreignDir }),
    invalidTs: costRow({ ts: '2026-02-30T00:00:00Z', session: 's-fx-4' }),
  };
  writeFile(paths.costsFile, jsonl([cost.main, cost.sub, cost.removedWorktree, cost.foreign, cost.identical, cost.identical, cost.invalidTs]));

  // ---- review ledgers: <ledger>/review-<phase>/chain.json, g<N>/findings.json, phase-<phase>.base, receipt-<phase>.json
  const seats = [{ id: 'seat-a', status: 'reviewed' }, { id: 'seat-b', status: 'reviewed' }];
  function reviewLedger(ledgerDir, { phase, base, head, collectedAt, finalizedAt, findings }) {
    const phaseDir = path.join(ledgerDir, `review-${phase}`);
    writeFile(path.join(ledgerDir, `phase-${phase}.base`), `${base}\n`);
    if (findings) writeFile(path.join(phaseDir, 'g1', 'findings.json'), JSON.stringify({ findings }, null, 2) + '\n');
    const entry = {
      generation: 1, base, head, seats, reviewed_seats: 2, total_seats: 2, reviewed_seats_count: 2, total_seats_count: 2,
      status: finalizedAt ? 'finalized' : 'pending', collected_at: collectedAt,
    };
    if (finalizedAt) {
      const dispositions = JSON.stringify({ schema_version: 1, phase, generation: 1, dispositions: [] }, null, 2) + '\n';
      writeFile(path.join(phaseDir, 'g1', 'dispositions.json'), dispositions);
      entry.finalized_at = finalizedAt;
      entry.dispositions_path = `review-${phase}/g1/dispositions.json`;
      entry.dispositions_sha256 = sha256hex(dispositions);
      writeFile(path.join(ledgerDir, `receipt-${phase}.json`), JSON.stringify({
        kind: 'review', phase, phase_base_sha: base, chain: [entry], verdict: 'SHIP-AS-IS', open_findings: [],
      }, null, 2) + '\n');
    }
    writeFile(path.join(phaseDir, 'chain.json'), JSON.stringify([entry], null, 2) + '\n');
    return entry;
  }
  const finding = (id, severity) => ({ id, severity, seat_id: 'seat-a', text: `finding ${id}` });
  const reviewA = reviewLedger(paths.reviewLedgers.a, {
    phase: 'E1', base: c1, head: c3, collectedAt: '2026-11-01T09:00:00.000Z', findings: [finding('F-1', 'Major'), finding('F-2', 'Minor')],
  });
  const reviewB = reviewLedger(paths.reviewLedgers.b, {
    phase: 'E1', base: c2, head: c3, collectedAt: '2026-11-01T09:10:00.000Z', finalizedAt: '2026-11-01T09:20:00.000Z', findings: [finding('F-3', 'Minor')],
  });
  reviewLedger(paths.reviewLedgers.foreign, {
    phase: 'E9', base: FOREIGN_BASE, head: FOREIGN_BASE, collectedAt: '2026-11-01T09:05:00.000Z', findings: [],
  });
  // phase E2 has no g1/findings.json at all: its review.collected event keeps going, without findings_total
  const reviewC = reviewLedger(paths.reviewLedgers.c, {
    phase: 'E2', base: c3, head: c3, collectedAt: '2026-11-01T09:30:00.000Z', findings: null,
  });
  writeFile(paths.reviewPointer, `${paths.reviewLedgers.a}\n${paths.reviewLedgers.b}\n${paths.reviewLedgers.c}\n`);

  // ---- decision ledgers (rows per the scripts/decision-ledger.js header) -------------------------------------------
  const dRow = (over) => ({ schema_version: 1, repo_identity: identity, root_run_id: null, ...over });
  const decisionRows = {
    d1: dRow({ ts: '2026-11-01T08:05:00.000Z', kind: 'decision', decision_id: 'D-001', round: 1, class: 'routine', rationale: 'pick the smaller option', reversibility: 'two-way', refs: [] }),
    d5: dRow({ ts: '2026-11-01T08:06:00.000Z', kind: 'decision', decision_id: 'D-002', round: 1, class: 'routine', rationale: 'defer the rename', reversibility: 'two-way', refs: [] }),
    d6: dRow({ ts: '2026-11-01T08:07:00.000Z', kind: 'decision', decision_id: 'D-002', round: 1, class: 'routine', rationale: `rotated ${tokenShaped()} after review`, reversibility: 'two-way', refs: [] }),
    d2: dRow({ ts: '2026-11-01T08:50:00.000Z', kind: 'veto', target_decision_id: 'D-001', reason: 'too risky' }),
    d3: dRow({ ts: '2026-11-01T08:55:00.000Z', kind: 'ladder', rung: 'U4', unknown_type: 'how', terms: [], signal_ids: [], heterogeneous: true, question: 'does it hold', criterion: 'tests pass', result: 'pass' }),
    d4: { schema_version: 1, ts: '2026-11-01T09:00:00.000Z', kind: 'note', round: 1, text: 'checkpoint' },
    foreign: { ...dRow({ ts: '2026-11-01T08:08:00.000Z', kind: 'decision', decision_id: 'D-900', round: 1, class: 'routine', rationale: 'other repo', reversibility: 'two-way', refs: [] }), repo_identity: foreignIdentity },
    d7: dRow({ ts: '2026-11-01T08:09:00.000Z', kind: 'dispatch', decision_id: 'D-003', round: 1, run_id: 'fx-run-done', rationale: 'dispatch implementer', root_run_id: 'fx-root-1' }),
  };
  writeFile(paths.decisionLedger, jsonl([decisionRows.d1, decisionRows.d5, decisionRows.d6, decisionRows.d2, decisionRows.d3, decisionRows.d4, decisionRows.foreign]));
  writeFile(paths.workOrderLedger, jsonl([decisionRows.d7]));

  // ---- run ledger with a rotated segment ---------------------------------------------------------------------------
  // Three stage-row shapes: only `state` (run-ledger.sh stage-acquire rows), `status` and `state` that differ, only `status`.
  const runRows = {
    stage1: { kind: 'stage', ts: '2026-11-01T08:11:30Z', run_id: 'fx-run-done', stage: 'implement', state: 'running', generation: 1, nonce: 'n-1', pid: 4242, reason: null },
    hb1: { kind: 'heartbeat', ts: '2026-11-01T08:12:30Z', run_id: 'fx-run-done', stage: 'implement', generation: 1 },
    hb2: { kind: 'heartbeat', ts: '2026-11-01T08:15:00.000Z', run_id: 'fx-run-done', stage: 'implement', generation: 1 },
    journal: { kind: 'journal', ts: '2026-11-01T08:16:00.000Z', run_id: 'fx-run-done', text: 'progress note' },
    stage2: { kind: 'stage', ts: '2026-11-01T08:20:00.000Z', run_id: 'fx-run-done', stage: 'verify', state: 'terminal', generation: 2, status: 'ok', reason: 'all checks green' },
    stage3: { kind: 'stage', ts: '2026-11-01T08:22:00.000Z', run_id: 'fx-run-done', stage: 'review', generation: 3, status: 'done' },
  };
  writeFile(paths.runLedgerRotated, jsonl([runRows.stage1, runRows.hb1]));
  writeFile(paths.runLedger, jsonl([runRows.hb2, runRows.journal, runRows.stage2, runRows.stage3]));

  return {
    dir: root, repoDir, foreignDir, identity, foreignIdentity,
    projectKey: scope.project_key, repoName: path.basename(repoDir),
    env, paths, commits: { c1, c2, c3 }, tokenShaped: tokenShaped(),
    manifests: { done, live, foreign: foreignManifest },
    cost, decisionRows, runRows, reviewEntries: { a: reviewA, b: reviewB, c: reviewC },
  };
}

// ---- golden events -----------------------------------------------------------------------------------------------
// Derived from the literal rows above; the redacted rationale is a literal constant (what the redaction must produce).
function goldenEvents(fx) {
  const key = fx.projectKey;
  const ev = (kind, id, ts, source, ids, data, extra = {}) => ({
    id: `${kind}:${id}`, kind, ts, ts_basis: 'source', source, project_key: key,
    root_run_id: ids.root ?? null, run_id: ids.run ?? null, data, ...extra,
  });
  const out = [];

  const m = fx.manifests;
  const mdata = (x) => {
    const d = { run_id: x.run_id, role: x.role, runner: x.runner, model: x.model, branch: x.branch, base_sha: x.base_sha };
    if (x.parent_run_id) d.parent_run_id = x.parent_run_id;
    d.depth = x.depth;
    d.timeout_seconds = x.timeout_seconds;
    return d;
  };
  for (const x of [m.done, m.live]) {
    out.push(ev('dispatch.started', x.run_id, `${x.started_at.slice(0, -1)}.000Z`, 'dispatch_manifest', { root: x.root_run_id, run: x.run_id }, mdata(x)));
  }
  out.push(ev('dispatch.ended', m.done.run_id, `${m.done.ended_at.slice(0, -1)}.000Z`, 'dispatch_manifest', { root: m.done.root_run_id, run: m.done.run_id }, {
    run_id: m.done.run_id, final_status: 'success', duration_s: m.done.ended_epoch - m.done.started_epoch,
    role: m.done.role, runner: m.done.runner, model: m.done.model,
  }));

  // cost.turn: sha256(raw line)[0:24] + '#n', n = 1-based ordinal among byte-identical lines from the start of the read.
  const costData = (row, tier) => {
    const r = JSON.parse(row);
    const d = {
      session: r.session, model: r.model, tier, input_tokens: r.input_tokens, output_tokens: r.output_tokens,
      cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens, cost_usd: r.cost_usd, sidechain: r.sidechain === true,
    };
    if (r.agent_id) d.agent_id = r.agent_id;
    return d;
  };
  const costEvent = (row, tier, n) => ev('cost.turn', `${sha256hex(row).slice(0, 24)}#${n}`, JSON.parse(row).ts, 'costs', {}, costData(row, tier));
  out.push(costEvent(fx.cost.main, 'hands', 1));
  out.push(costEvent(fx.cost.sub, 'brain', 1));
  out.push(costEvent(fx.cost.removedWorktree, 'hands', 1));
  out.push(costEvent(fx.cost.identical, 'hands-cheap', 1));
  out.push(costEvent(fx.cost.identical, 'hands-cheap', 2));

  // review: id key = <first 12 hex of sha256(base)>:<phase>:g<generation>
  const reviewData = (entry, phase, findings) => {
    const d = {
      phase, phase_base12: sha256hex(entry.base).slice(0, 12), generation: entry.generation, base: entry.base, head: entry.head,
      seats: entry.seats, reviewed_seats: entry.reviewed_seats, total_seats: entry.total_seats,
    };
    if (findings) { // findings.json absent: the event is kept, findings_total and findings_by_severity are left out
      const bySeverity = {};
      for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      d.findings_total = findings.length;
      d.findings_by_severity = bySeverity;
    }
    return d;
  };
  const pushReview = (entry, findings, phase = 'E1') => {
    const base12 = sha256hex(entry.base).slice(0, 12);
    const idKey = `${base12}:${phase}:g${entry.generation}`;
    out.push(ev('review.collected', idKey, entry.collected_at, 'review_ledger', {}, reviewData(entry, phase, findings)));
    if (entry.status === 'finalized') {
      out.push(ev('review.finalized', idKey, entry.finalized_at, 'review_ledger', {}, {
        phase, phase_base12: base12, generation: entry.generation, verdict: 'SHIP-AS-IS', open_findings: 0,
        reviewed_seats: entry.reviewed_seats, total_seats: entry.total_seats, dispositions_sha256: entry.dispositions_sha256,
      }));
    }
  };
  pushReview(fx.reviewEntries.a, [{ severity: 'Major' }, { severity: 'Minor' }]);
  pushReview(fx.reviewEntries.b, [{ severity: 'Minor' }]);
  pushReview(fx.reviewEntries.c, null, 'E2');

  // qc.verdict: id key = commit sha; ts = committer date normalised to UTC.
  out.push(ev('qc.verdict', fx.commits.c2, '2026-11-01T08:30:00.000Z', 'git_trailer', {}, { commit: fx.commits.c2, verdict: 'PASS', subject: 'feat: add thing', basis: 'self_reported' }));
  out.push(ev('qc.verdict', fx.commits.c3, '2026-11-01T10:00:00.000Z', 'git_trailer', {}, { commit: fx.commits.c3, verdict: 'WAIVED', subject: 'fix: other thing', basis: 'self_reported' }));

  // decision.row: <decision_id or target_decision_id>:<row_kind>:sha256(canonical row)[0:12], else sha256(canonical row)[0:24]
  const dr = fx.decisionRows;
  const decisionEvent = (row, data) => {
    const sha = sha256hex(canonicalJson(row));
    const idOf = row.decision_id || row.target_decision_id;
    const idKey = idOf ? `${idOf}:${row.kind}:${sha.slice(0, 12)}` : sha.slice(0, 24);
    return ev('decision.row', idKey, row.ts, 'decision_ledger', { root: row.root_run_id, run: row.run_id }, { basis: 'self_reported', row_kind: row.kind, ...data });
  };
  const decisionBody = (row, rationale) => ({ decision_id: row.decision_id, round: row.round, class: row.class, reversibility: row.reversibility, rationale });
  out.push(decisionEvent(dr.d1, decisionBody(dr.d1, dr.d1.rationale)));
  out.push(decisionEvent(dr.d5, decisionBody(dr.d5, dr.d5.rationale)));
  out.push(decisionEvent(dr.d6, decisionBody(dr.d6, 'rotated [redacted] after review')));
  out.push(decisionEvent(dr.d2, { target_decision_id: 'D-001' }));
  out.push(decisionEvent(dr.d3, { rung: 'U4', result: 'pass' }));
  out.push(decisionEvent(dr.d4, { round: 1 }));
  out.push(decisionEvent(dr.d7, { decision_id: 'D-003', round: 1, rationale: dr.d7.rationale }));

  // run.stage: sha256(canonical row)[0:24]; only kind:"stage" rows; ts normalised to .sssZ
  const stageEvent = (row) => {
    const data = { run_id: row.run_id, stage: row.stage, generation: row.generation, basis: 'self_reported' };
    // status wins; state is read only when status is absent (docs/dev/events-contract.md, run.stage)
    const status = row.status || row.state;
    if (status) data.status = status;
    if (row.reason) data.reason = row.reason;
    const ts = row.ts.length === 20 ? `${row.ts.slice(0, -1)}.000Z` : row.ts;
    return ev('run.stage', sha256hex(canonicalJson(row)).slice(0, 24), ts, 'run_ledger', { run: row.run_id }, data);
  };
  out.push(stageEvent(fx.runRows.stage1));
  out.push(stageEvent(fx.runRows.stage2));
  out.push(stageEvent(fx.runRows.stage3));

  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function goldenEnvelope(fx) {
  const events = goldenEvents(fx);
  const page = [exampleEvent(events, 'dispatch.started'), exampleEvent(events, 'cost.turn')].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  return {
    schema: 'autopilot.events/1',
    generated_at: '2026-11-02T08:00:00.000Z',
    project: { project_key: fx.projectKey, repo_name: fx.repoName },
    events: page,
    cursor: '<opaque>',
    has_more: true,
    sources: [
      { name: 'dispatch', state: 'ok', rows_read: 3, rows_skipped: 0, rows_filtered: 1, redactions: 0 },
      { name: 'cost', state: 'degraded', rows_read: 7, rows_skipped: 1, rows_filtered: 1, redactions: 0 },
      { name: 'review', state: 'ok', rows_read: 2, rows_skipped: 0, rows_filtered: 1, redactions: 0 },
      { name: 'qc', state: 'ok', rows_read: 3, rows_skipped: 0, rows_filtered: 1, redactions: 0 },
      { name: 'decision', state: 'ok', rows_read: 8, rows_skipped: 0, rows_filtered: 1, redactions: 1 },
      { name: 'runledger', state: 'ok', rows_read: 5, rows_skipped: 0, rows_filtered: 3, redactions: 0 },
    ],
    warnings: [{ source: 'cost', code: 'ts_invalid', detail: 'costs.jsonl', count: 1 }],
  };
}

// The event a doc example shows for a kind. Chosen by content, not by list position: the (ts, id) order of events whose
// id hash covers a tempdir path (cost.turn batches share one ts) differs from run to run.
function exampleEvent(events, kind) {
  const ofKind = events.filter((e) => e.kind === kind);
  if (kind === 'cost.turn') return ofKind.find((e) => e.data.session === 's-fx-1' && e.data.sidechain === false);
  return ofKind[0];
}

const PATH_HASHED_KINDS = new Set(['cost.turn', 'decision.row']);

// Doc placeholders: tempdir -> <tmp>, project_key -> <project_key>, repo_name -> <repo>, generated_at -> <now>,
// and the path-dependent id hash of cost.turn / decision.row -> <sha>.
function normaliseExample(value, fx) {
  const text = JSON.stringify(value)
    .split(fx.dir).join('<tmp>')
    .split(fx.projectKey).join('<project_key>');
  const out = JSON.parse(text);
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.generated_at === 'string') node.generated_at = '<now>';
    if (node.project && typeof node.project.repo_name === 'string') node.project.repo_name = '<repo>';
    // The id hash of these kinds covers a row that embeds the tempdir (cwd, repo_identity), so it differs per run.
    if (PATH_HASHED_KINDS.has(node.kind) && typeof node.id === 'string') node.id = node.id.replace(/(?<=:)[0-9a-f]{12,24}(?=#|$)/, '<sha>');
    Object.values(node).forEach(walk);
  };
  walk(out);
  return out;
}

module.exports = {
  FIXTURE_COMMITS, FOREIGN_BASE, buildFixture, canonicalJson, exampleEvent, goldenEnvelope, goldenEvents, normaliseExample, sha256hex, tokenShaped,
};
