'use strict';

// src/status/qc-fact.js — the `qc` fact of the runs watcher (stage-graph plan A1 P7c, QC chip).
//
//   <live>/runs/<project_key>.qc.json   schema autopilot.qc-status/1   (project scope: root_run_id is null)
//
// Whether HEAD's unpushed protected-path diff carries review evidence, computed by scripts/qc-evidence-status.js, which
// shares scripts/lib/qc-evidence.sh with .githooks/pre-push (one decision, two readers). Re-derivation only: the fact
// restates what the hook would check, it attests nothing. Recomputed at most every RECHECK_S (a handful of git calls);
// rewritten when the answer changes or REWRITE_S has passed (the file's `checked_at` is the freshness the reader sees).

const fs = require('fs');
const path = require('path');
const { computeQcStatus } = require('../../scripts/qc-evidence-status');

const SCHEMA = 'autopilot.qc-status/1';
const RECHECK_S = 30;
const REWRITE_S = 120;

function buildQcFact({ scope, status, nowMs }) {
  return {
    schema: SCHEMA,
    scope: { project_key: scope.project_key, repo_identity: scope.repo_identity, root_run_id: null },
    state: status.state,
    range: status.range,
    protected_files_count: status.protected_files_count,
    evidence: status.evidence,
    mode: status.mode,
    checked_at: new Date(nowMs).toISOString(),
  };
}

function createQcPublisher({ runsDir, key, repo, getIdentity, writeAtomic, log = () => {}, compute = computeQcStatus }) {
  const file = path.join(runsDir, `${key}.qc.json`);
  let last = null; // { stable, checkedMs, writtenMs }

  function publish({ nowMs }) {
    if (last && nowMs - last.checkedMs < RECHECK_S * 1000 && fs.existsSync(file)) return;
    let status;
    try { status = compute({ repo }); } catch (error) { log(`qc fact failed: ${error.message}`); return; }
    const fact = buildQcFact({ scope: { project_key: key, repo_identity: getIdentity() }, status, nowMs });
    const stable = JSON.stringify({ ...fact, checked_at: null });
    const unchanged = last && last.stable === stable && nowMs - last.writtenMs < REWRITE_S * 1000 && fs.existsSync(file);
    last = { stable, checkedMs: nowMs, writtenMs: unchanged ? last.writtenMs : nowMs };
    if (unchanged) return;
    try { writeAtomic(file, `${JSON.stringify(fact, null, 2)}\n`); } catch (error) { log(`qc fact write failed: ${error.message}`); }
  }

  return { publish };
}

module.exports = { SCHEMA, buildQcFact, createQcPublisher };
