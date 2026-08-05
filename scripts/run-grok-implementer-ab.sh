#!/usr/bin/env bash
# run-grok-implementer-ab.sh — D8 within-model Grok effort A/B harness.
#
# LIVE path (required for acceptance): runs each arm through dispatch-hetero.sh
# with runner=grok / model=Grok-4.5, efforts medium|high from frozen seed.
# Mission-enforce repos are unsupported for free-form calibration, so each
# session is executed in a throwaway clone of the current candidate with
# owner-kernel governance removed (mission mode off). That keeps provider
# sessions live and rails real while avoiding sealed-projection requirements.
#
# Extension: after initial_pairs (30), if decision is still indeterminate,
# extend once to max_pairs (60). Session budget ≤ max_provider_sessions (120).
#
# Usage:
#   bash scripts/run-grok-implementer-ab.sh \
#     --tasks evals/grok-implementer-ab/tasks.json \
#     --report .autopilot/evidence/grok-implementer-ab.json
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TASKS=""
REPORT=""
SEED_FILE="$REPO/evals/grok-implementer-ab/seed.json"
TIMEOUT="${AUTOPILOT_GROK_AB_TIMEOUT:-3m}"
SCRATCH_ROOT="${AUTOPILOT_GROK_AB_SCRATCH:-/tmp/autopilot-grok-ab-$$}"
BASE_REF="${AUTOPILOT_GROK_AB_BASE_SHA:-HEAD^}"
CANDIDATE_REF="${AUTOPILOT_GROK_AB_CANDIDATE_SHA:-HEAD}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks) TASKS="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    --seed) SEED_FILE="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --base-sha) BASE_REF="$2"; shift 2 ;;
    --candidate-sha) CANDIDATE_REF="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$TASKS" && -n "$REPORT" ]] || { echo "--tasks and --report required" >&2; exit 2; }
[[ -r "$TASKS" ]] || { echo "tasks not readable: $TASKS" >&2; exit 2; }
[[ -r "$SEED_FILE" ]] || { echo "seed not readable: $SEED_FILE" >&2; exit 2; }
command -v grok >/dev/null 2>&1 || { echo "grok binary required for live A/B" >&2; exit 2; }

BASE_SHA="$(git -C "$REPO" rev-parse --verify "${BASE_REF}^{commit}" 2>/dev/null)" \
  || { echo "base ref does not resolve: $BASE_REF" >&2; exit 2; }
CANDIDATE_SHA="$(git -C "$REPO" rev-parse --verify "${CANDIDATE_REF}^{commit}" 2>/dev/null)" \
  || { echo "candidate ref does not resolve: $CANDIDATE_REF" >&2; exit 2; }
[ "$BASE_SHA" != "$CANDIDATE_SHA" ] \
  || { echo "base and candidate refs must resolve to distinct commits" >&2; exit 2; }

mkdir -p "$(dirname "$REPORT")" "$SCRATCH_ROOT"
cleanup() {
  rm -rf -- "$SCRATCH_ROOT" 2>/dev/null || true
}
trap cleanup EXIT

# Prepare scratch clone of current HEAD (mission enforce off).
SCRATCH="$SCRATCH_ROOT/repo"
git clone --local "$REPO" "$SCRATCH" >/dev/null 2>&1
git -C "$SCRATCH" checkout -q "$CANDIDATE_SHA"
# Remove mission enforce so free-form calibration sessions can run.
rm -f "$SCRATCH/.claude/owner-kernel-governance.json" 2>/dev/null || true
# Clear session markers that would force sealed projection.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  AUTOPILOT_SESSION_MODE_DIR AUTOPILOT_SESSION_ID 2>/dev/null || true

export AUTOPILOT_LIVE_GROK_AB=1
export DISPATCH_QUIET=1

node - "$REPO" "$TASKS" "$SEED_FILE" "$REPORT" "$SCRATCH" "$TIMEOUT" \
  "$BASE_REF" "$CANDIDATE_REF" "$BASE_SHA" "$CANDIDATE_SHA" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const [
  repo,
  tasksPath,
  seedPath,
  reportPath,
  scratch,
  timeout,
  baseRef,
  candidateRef,
  baseSha,
  candidateSha,
] = process.argv.slice(2);
const tasksDoc = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const allTasks = tasksDoc.tasks || [];
const primary = allTasks.filter((t) => !t.extension);
const extension = allTasks.filter((t) => t.extension === true);
const initialPairs = seed.initial_pairs || 30;
const maxPairs = seed.max_pairs || 60;
const maxSessions = seed.max_provider_sessions || 120;
const maxRetries = Number.isInteger(seed.max_retries_per_arm)
  ? seed.max_retries_per_arm : 6;
const model = seed.actor.model || 'grok-4.5';
// CLI model id is lowercase with hyphen
const modelCli = String(model).toLowerCase().replace(/\s+/g, '-');
const runner = seed.actor.runner || 'grok';
const hetero = path.join(repo, 'scripts', 'dispatch-hetero.sh');
const dispatchBin = process.env.AUTOPILOT_GROK_AB_DISPATCH_BIN || hetero;

function runnerVersion() {
  const probe = spawnSync(runner, ['--version'], {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (probe.error || probe.status !== 0) return null;
  const output = String(probe.stdout || probe.stderr || '').trim();
  return output.split(/\r?\n/)[0].trim() || null;
}

const resolvedRunnerVersion = runnerVersion();

if (primary.length < initialPairs) {
  process.stderr.write(`insufficient non-extension tasks: ${primary.length}\n`);
  process.exit(2);
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function armOrder(pairIndex) {
  if (seed.arm_order === 'ABBA' && pairIndex % 2 === 1) return ['B', 'A'];
  return ['A', 'B'];
}

function parseOutcome(stdout) {
  const text = String(stdout || '');
  // Last JSON object in stdout
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === 'object' && obj.status) return obj;
    } catch (_e) { /* continue */ }
  }
  // Whole-buffer parse
  try {
    return JSON.parse(text);
  } catch (_e) {
    return { status: 'runner_failed', error: 'unparseable_outcome', files_changed: 0 };
  }
}

function runAcceptance(task, commit) {
  const commands = Array.isArray(task.acceptance) ? task.acceptance : [];
  if (commands.length === 0 || typeof commit !== 'string' || commit.length === 0) {
    return { ok: false, results: [], error: 'acceptance_or_commit_missing' };
  }
  const acceptanceRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'grok-ab-acceptance-'));
  const results = [];
  try {
    const clone = spawnSync('git', ['clone', '--local', scratch, acceptanceRoot], {
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    if (clone.status !== 0) {
      return { ok: false, results, error: 'acceptance_clone_failed' };
    }
    const checkout = spawnSync('git', ['-C', acceptanceRoot, 'checkout', '-q', commit], {
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    if (checkout.status !== 0) {
      return { ok: false, results, error: 'acceptance_checkout_failed' };
    }
    for (const command of commands) {
      if (typeof command !== 'string' || command.trim() !== command || command.length === 0) {
        results.push({ command, exit: null });
        return { ok: false, results, error: 'acceptance_command_invalid' };
      }
      const check = spawnSync('bash', ['-lc', command], {
        cwd: acceptanceRoot,
        env: process.env,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      results.push({ command, exit: check.status });
      if (check.status !== 0) {
        return { ok: false, results, error: 'acceptance_failed' };
      }
    }
    return { ok: true, results, error: null };
  } finally {
    fs.rmSync(acceptanceRoot, { recursive: true, force: true });
  }
}

function runArm(task, arm, attempt) {
  const effort = seed.arms[arm].effort;
  // Absolute path: dispatch-hetero runs with cwd=scratch and must read the prompt
  // from a path visible in both trees.
  const promptDir = path.join(scratch, '.ab-prompts');
  fs.mkdirSync(promptDir, { recursive: true });
  const promptPath = path.join(promptDir, `ab-prompt-${task.id}-${arm}-${attempt}.txt`);
  const prompt = [
    task.prompt,
    '',
    'Constraints:',
    `- Touch at most ${task.max_files || 2} files.`,
    '- Prefer docs/ only.',
    '- Commit your change if any.',
    '- Do not push or open a PR.',
  ].join('\n');
  fs.writeFileSync(promptPath, prompt);
  const branch = `ab-cal-${task.id}-${arm}-a${attempt}-${Date.now().toString(36)}`;
  const env = { ...process.env };
  // Never inherit mission admission into the calibration dispatch.
  for (const k of [
    'AUTOPILOT_LEVEL', 'AUTOPILOT_ROOT_RUN_ID', 'AUTOPILOT_MISSION_ROOT_RUN_ID',
    'AUTOPILOT_PARENT_RUN_ID', 'AUTOPILOT_WORKTREE_ROOT_RUN_ID', 'AUTOPILOT_DISPATCH_DEPTH',
    'AUTOPILOT_SESSION_MODE_DIR', 'AUTOPILOT_SESSION_ID',
  ]) delete env[k];
  env.DISPATCH_QUIET = '1';
  env.AUTOPILOT_LIVE_GROK_AB = '1';

  const started = Date.now();
  const run = spawnSync('bash', [
    dispatchBin,
    '--branch', branch,
    '--prompt-file', promptPath,
    '--runner', runner,
    '--model', modelCli,
    '--effort', effort,
    '--base', 'HEAD',
    '--timeout', timeout,
  ], {
    cwd: scratch,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 0, // wall owned by hetero --timeout
  });
  const wallMs = Date.now() - started;
  const outcome = parseOutcome(run.stdout);
  const status = outcome.status || 'runner_failed';
  const committed = status === 'committed' && Boolean(outcome.commit);
  const expectedModel = modelCli.toLowerCase();
  const observedModel = typeof outcome.model === 'string' ? outcome.model.toLowerCase() : null;
  const observedRunner = typeof outcome.runner === 'string' ? outcome.runner.toLowerCase() : null;
  const providerSessionId = typeof outcome.provider_session_id === 'string'
    && outcome.provider_session_id.length > 0
    ? outcome.provider_session_id : null;
  const provenanceOk = observedRunner === runner.toLowerCase()
    && observedModel === expectedModel
    && providerSessionId !== null
    && resolvedRunnerVersion !== null;
  const acceptance = committed ? runAcceptance(task, outcome.commit) : {
    ok: false,
    results: [],
    error: 'commit_missing',
  };
  const toolFailure = (outcome.model_calls > 0 && !committed)
    || status === 'runner_failed'
    || status === 'failure'
    || (typeof outcome.error === 'string' && outcome.error.length > 0)
    || !provenanceOk
    || !acceptance.ok
    ? 1 : 0;
  // Independent mechanical acceptance (not implementer self-report):
  // committed + files_changed within max_files + no error.
  const files = Number(outcome.files_changed || 0);
  const maxFiles = task.max_files || 2;
  const qualityAccepted = committed && files > 0 && files <= maxFiles
    && !outcome.error && provenanceOk && acceptance.ok;
  const usable = committed && toolFailure === 0;

  return {
    effort,
    status,
    commit: outcome.commit || null,
    files_changed: files,
    wrapper_commit: committed,
    toolFailure,
    usable_session: usable,
    quality_accepted: qualityAccepted,
    acceptance_ok: acceptance.ok,
    acceptance_results: acceptance.results,
    acceptance_error: acceptance.error,
    provenance_ok: provenanceOk,
    runner: observedRunner,
    model: observedModel,
    provider_session_id: providerSessionId,
    runner_version: resolvedRunnerVersion,
    provider_version: resolvedRunnerVersion,
    retries: attempt,
    wall_ms: wallMs,
    run_id: outcome.run_id || null,
    model_calls: outcome.model_calls || 0,
    raw_status: status,
    error: outcome.error || acceptance.error || (!provenanceOk ? 'provenance_invalid' : null),
  };
}

const sessionBudget = { used: 0 };

function reserveSession() {
  if (sessionBudget.used >= maxSessions) return false;
  sessionBudget.used += 1;
  return true;
}

function runPair(task, pairIndex, retriesA, retriesB) {
  const order = armOrder(pairIndex);
  const arms = {};
  const pairStart = sessionBudget.used;
  for (const arm of order) {
    let attempt = 0;
    let result = null;
    const retries = arm === 'A' ? retriesA : retriesB;
    while (true) {
      if (!reserveSession()) {
        result = {
          effort: seed.arms[arm].effort,
          wrapper_commit: false,
          toolFailure: 1,
          usable_session: false,
          quality_accepted: false,
          retries: attempt,
          error: 'session_budget_exhausted',
          missing: true,
          retry_exhausted: false,
        };
        break;
      }
      result = runArm(task, arm, attempt);
      if (result.usable_session) break;
      // Infra-style failures may retry; count against per-arm retry budget.
      if (retries.count >= maxRetries) {
        result.retry_exhausted = true;
        break;
      }
      retries.count += 1;
      attempt += 1;
    }
    arms[arm] = result;
  }
  return {
    task_id: task.id,
    arms,
    order,
    sessions: sessionBudget.used - pairStart,
  };
}

function bootstrapCI(diffs, seedVal, B) {
  const rng = mulberry32((seedVal ^ 0x9e3779b9) >>> 0);
  const means = [];
  for (let i = 0; i < B; i += 1) {
    let s = 0;
    for (let j = 0; j < diffs.length; j += 1) {
      s += diffs[Math.floor(rng() * diffs.length)];
    }
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  return {
    low: means[Math.floor(0.025 * means.length)],
    high: means[Math.floor(0.975 * means.length)],
    mean: means.reduce((a, b) => a + b, 0) / means.length,
  };
}

function openArmReasons(pairs) {
  const reasons = [];
  for (const pair of pairs) {
    for (const arm of ['A', 'B']) {
      const result = pair.arms && pair.arms[arm];
      if (!result) {
        reasons.push(`${pair.task_id}:${arm}:missing_arm`);
      } else if (result.missing) {
        reasons.push(`${pair.task_id}:${arm}:session_budget_exhausted`);
      } else if (result.retry_exhausted) {
        reasons.push(`${pair.task_id}:${arm}:retry_cap_exhausted`);
      } else if (result.usable_session !== true) {
        reasons.push(`${pair.task_id}:${arm}:unusable_session`);
      }
    }
  }
  return [...new Set(reasons)];
}

function decide(pairs) {
  const diffs = pairs.map((p) => {
    const a = p.arms.A && p.arms.A.usable_session ? 1 : 0;
    const b = p.arms.B && p.arms.B.usable_session ? 1 : 0;
    return (a - b) * 100;
  });
  const qdiffs = pairs.map((p) => {
    const a = p.arms.A && p.arms.A.quality_accepted ? 1 : 0;
    const b = p.arms.B && p.arms.B.quality_accepted ? 1 : 0;
    return (a - b) * 100;
  });
  const B = seed.bootstrap_resamples || 10000;
  const endpoint = bootstrapCI(diffs, seed.seed, B);
  const quality = bootstrapCI(qdiffs, seed.seed, B);
  const material = seed.material_effect_pp || 10;
  const qMargin = seed.quality_non_inferiority_pp || 5;
  let decision = 'indeterminate';
  if (endpoint.low > material && quality.low >= -qMargin) decision = 'tune-medium';
  else if (endpoint.high < -material && quality.low >= -qMargin) decision = 'tune-high';
  else if (endpoint.low >= -material && endpoint.high <= material && quality.low >= -qMargin) {
    decision = 'no-change';
  }
  const openReasons = openArmReasons(pairs);
  if (openReasons.length > 0) decision = 'indeterminate';
  return { decision, endpoint, quality, material, qMargin, B, openReasons };
}

const retriesA = { count: 0 };
const retriesB = { count: 0 };
const pairs = [];
let sessions = 0;
const exclusions = [];

// Phase 1: initial 30 pairs
const phase1 = primary.slice(0, initialPairs);
for (let i = 0; i < phase1.length; i += 1) {
  if (sessionBudget.used >= maxSessions) {
    exclusions.push({ task_id: phase1[i].id, reason: 'session_budget_exhausted' });
    break;
  }
  process.stderr.write(`A/B pair ${i + 1}/${phase1.length} task=${phase1[i].id}\n`);
  const p = runPair(phase1[i], i, retriesA, retriesB);
  sessions = sessionBudget.used;
  // Missing arms never imputed
  if (!p.arms.A || !p.arms.B || p.arms.A.missing || p.arms.B.missing) {
    exclusions.push({
      task_id: phase1[i].id,
      reason: 'missing_arm_after_retries',
      schema_valid: true,
    });
    // Still record the pair for transparency; decision logic treats missing as not usable.
  }
  pairs.push(p);
  // Checkpoint partial report for long runs
  if ((i + 1) % 5 === 0) {
    fs.writeFileSync(reportPath + '.partial.json', JSON.stringify({ pairs: pairs.length, sessions }, null, 2));
  }
}

let {
  decision,
  endpoint,
  quality,
  material,
  qMargin,
  B,
  openReasons,
} = decide(pairs);

// Phase 2: one extension to max_pairs if still indeterminate
if (decision === 'indeterminate' && pairs.length === initialPairs && sessions < maxSessions) {
  process.stderr.write(`A/B indeterminate at ${initialPairs}; extending to ${maxPairs}\n`);
  const extPool = extension.length
    ? extension.slice(0, maxPairs - initialPairs)
    : primary.slice(initialPairs, maxPairs);
  // If not enough extension tasks, reuse remaining primary ids if present
  const need = maxPairs - pairs.length;
  const extraTasks = extPool.slice(0, need);
  for (let i = 0; i < extraTasks.length; i += 1) {
    if (sessionBudget.used >= maxSessions) break;
    const pairIndex = pairs.length;
    process.stderr.write(`A/B extension pair ${pairIndex + 1}/${maxPairs} task=${extraTasks[i].id}\n`);
    const p = runPair(extraTasks[i], pairIndex, retriesA, retriesB);
    sessions = sessionBudget.used;
    pairs.push(p);
  }
  ({ decision, endpoint, quality, material, qMargin, B, openReasons } = decide(pairs));
}

const report = {
  schema_version: 1,
  mode: 'live',
  base_ref: baseRef,
  candidate_ref: candidateRef,
  base_sha: baseSha,
  candidate_sha: candidateSha,
  seed: seed.seed,
  seed_digest: crypto.createHash('sha256').update(fs.readFileSync(seedPath)).digest('hex'),
  tasks_digest: crypto.createHash('sha256').update(fs.readFileSync(tasksPath)).digest('hex'),
  actor: seed.actor,
  runner,
  model: modelCli,
  runner_version: resolvedRunnerVersion,
  provider_version: resolvedRunnerVersion,
  arms: seed.arms,
  pairs: pairs.length,
  provider_sessions: sessionBudget.used,
  session_attempts_started: sessionBudget.used,
  exclusions,
  retries_per_arm: { A: retriesA.count, B: retriesB.count },
  max_provider_sessions: maxSessions,
  endpoint_pp: endpoint,
  quality_pp: quality,
  decision,
  open_reasons: openReasons,
  material_effect_pp: material,
  quality_non_inferiority_pp: qMargin,
  bootstrap_resamples: B,
  pair_results: pairs,
  runner_path: 'scripts/dispatch-hetero.sh',
  quality_definition: 'mechanical_independent: committed && 0<files<=max_files && !error && provenance_ok && acceptance_ok',
  generated_at: new Date().toISOString(),
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `wrote ${reportPath} mode=live decision=${decision} pairs=${pairs.length} sessions=${sessions}\n`,
);
if (decision === 'indeterminate') {
  process.stderr.write('ESCALATION: indeterminate result remains open; no calibration decision\n');
  process.exit(1);
}
NODE
