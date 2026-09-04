// Depth-0 re-derivation: apply the generation-2 dispositions to the generation-2
// artifact with the repo's own applyDispositions, and emit the checker-shaped
// dispositions file (fingerprint + candidate_blocker + disposition + rationale).
const fs = require('fs');
const path = require('path');
const repo = process.argv[2];
const { loadDispositionFile, applyDispositions } = require(path.join(repo, 'scripts/lib/plan-review-findings.js'));
const L = path.join(repo, 'docs/projects/2026-09-05-statusline-live-context-feed/ledger/plan-review');
const artifact = JSON.parse(fs.readFileSync(path.join(L, 'g2.stdout.json'), 'utf8'));
const dispPath = path.join(repo, 'docs/plans/2026-09-05-statusline-live-context-feed.g2-disposition.json');
const decisions = loadDispositionFile(dispPath, { logicalPlanId: artifact.logical_plan_id, generation: 2 });
applyDispositions(artifact.findings, decisions);
artifact.depth0_adjudication = {
  adjudicated_at: new Date().toISOString(),
  source_artifact: 'g2.stdout.json',
  dispositions: path.basename(dispPath),
  reviewed_plan_copy: 'plan.g2-reviewed.md',
  note: 'generation cap reached; every candidate blocker accepted_blocker and folded into the plan after review; checker run against the reviewed bytes',
};
fs.writeFileSync(path.join(L, 'g2.adjudicated.json'), JSON.stringify(artifact, null, 2) + '\n');
const checkerDisp = {
  schema_version: 1, logical_plan_id: artifact.logical_plan_id, generation: 2,
  findings: artifact.findings.map((f) => ({
    fingerprint: f.fingerprint, candidate_blocker: f.candidate_blocker,
    disposition: f.disposition, rationale: f.disposition_rationale,
  })),
};
fs.writeFileSync(path.join(L, 'g2.dispositions.checker.json'), JSON.stringify(checkerDisp, null, 2) + '\n');
console.log('applied', artifact.findings.map((f) => `${f.rubric_id}:${f.disposition}`).join(' '));
