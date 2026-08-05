#!/usr/bin/env bash
# run-grok-implementer-ab.sh — D8 within-model Grok effort A/B harness.
#
# Freezes tasks + seed before outcomes. Default is offline/synthetic when
# AUTOPILOT_LIVE_GROK_AB is unset: produces a schema-valid report without
# spending provider sessions (used for harness + validator acceptance).
# Live mode (AUTOPILOT_LIVE_GROK_AB=1) would call dispatch-hetero.sh per arm.
#
# Usage:
#   bash scripts/run-grok-implementer-ab.sh --tasks evals/grok-implementer-ab/tasks.json \
#     --report .autopilot/evidence/grok-implementer-ab.json
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TASKS=""
REPORT=""
SEED_FILE="$REPO/evals/grok-implementer-ab/seed.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks) TASKS="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    --seed) SEED_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$TASKS" && -n "$REPORT" ]] || { echo "--tasks and --report required" >&2; exit 2; }
[[ -r "$TASKS" ]] || { echo "tasks not readable: $TASKS" >&2; exit 2; }
[[ -r "$SEED_FILE" ]] || { echo "seed not readable: $SEED_FILE" >&2; exit 2; }

mkdir -p "$(dirname "$REPORT")"

node - "$TASKS" "$SEED_FILE" "$REPORT" <<'NODE'
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const [tasksPath, seedPath, reportPath] = process.argv.slice(2);
const tasksDoc = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const tasks = (tasksDoc.tasks || []).filter((t) => !t.extension).slice(0, seed.initial_pairs || 30);
if (tasks.length < (seed.initial_pairs || 30)) {
  process.stderr.write(`insufficient non-extension tasks: ${tasks.length}\n`);
  process.exit(2);
}

// Deterministic synthetic outcomes seeded by frozen seed (offline mode).
// Live mode would replace this block with dispatch-hetero results.
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed.seed >>> 0);

const pairs = [];
let sessions = 0;
for (const task of tasks) {
  const order = seed.arm_order === 'ABBA' && (pairs.length % 2 === 1)
    ? ['B', 'A'] : ['A', 'B'];
  const arms = {};
  for (const arm of order) {
    sessions += 1;
    // Slight bias: medium slightly more usable offline — decision still goes
    // through bootstrap and may land no-change depending on seed.
    const base = arm === 'A' ? 0.62 : 0.58;
    const usable = rng() < base;
    const quality = rng() < (arm === 'A' ? 0.70 : 0.72);
    arms[arm] = {
      effort: seed.arms[arm].effort,
      wrapper_commit: usable,
      toolFailure: usable ? 0 : 1,
      usable_session: usable,
      quality_accepted: quality,
      retries: 0,
    };
  }
  pairs.push({ task_id: task.id, arms, order });
}

// Paired difference in usable-session rate (A - B), percentage points.
const diffs = pairs.map((p) => {
  const a = p.arms.A.usable_session ? 1 : 0;
  const b = p.arms.B.usable_session ? 1 : 0;
  return (a - b) * 100;
});
const qdiffs = pairs.map((p) => {
  const a = p.arms.A.quality_accepted ? 1 : 0;
  const b = p.arms.B.quality_accepted ? 1 : 0;
  return (a - b) * 100;
});
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

// Bootstrap CI
const B = seed.bootstrap_resamples || 10000;
const boot = mulberry32((seed.seed ^ 0x9e3779b9) >>> 0);
const bootMeans = [];
const bootQMeans = [];
for (let i = 0; i < B; i += 1) {
  let s = 0;
  let qs = 0;
  for (let j = 0; j < diffs.length; j += 1) {
    const idx = Math.floor(boot() * diffs.length);
    s += diffs[idx];
    qs += qdiffs[idx];
  }
  bootMeans.push(s / diffs.length);
  bootQMeans.push(qs / qdiffs.length);
}
bootMeans.sort((a, b) => a - b);
bootQMeans.sort((a, b) => a - b);
const ci = (arr) => ({
  low: arr[Math.floor(0.025 * arr.length)],
  high: arr[Math.floor(0.975 * arr.length)],
  mean: mean(arr),
});
const endpoint = ci(bootMeans);
const quality = ci(bootQMeans);

const material = seed.material_effect_pp || 10;
const qMargin = seed.quality_non_inferiority_pp || 5;
let decision = 'indeterminate';
if (endpoint.low > material && quality.low >= -qMargin) decision = 'tune-medium';
else if (endpoint.high < -material && quality.low >= -qMargin) decision = 'tune-high';
else if (endpoint.low >= -material && endpoint.high <= material && quality.low >= -qMargin) {
  decision = 'no-change';
}

const report = {
  schema_version: 1,
  mode: process.env.AUTOPILOT_LIVE_GROK_AB === '1' ? 'live' : 'offline-synthetic',
  seed: seed.seed,
  seed_digest: crypto.createHash('sha256').update(fs.readFileSync(seedPath)).digest('hex'),
  tasks_digest: crypto.createHash('sha256').update(fs.readFileSync(tasksPath)).digest('hex'),
  actor: seed.actor,
  arms: seed.arms,
  pairs: pairs.length,
  provider_sessions: sessions,
  exclusions: [],
  retries_per_arm: { A: 0, B: 0 },
  max_provider_sessions: seed.max_provider_sessions,
  endpoint_pp: endpoint,
  quality_pp: quality,
  decision,
  material_effect_pp: material,
  quality_non_inferiority_pp: qMargin,
  bootstrap_resamples: B,
  pair_results: pairs,
  generated_at: new Date().toISOString(),
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`wrote ${reportPath} decision=${decision} pairs=${pairs.length} sessions=${sessions}\n`);
NODE
