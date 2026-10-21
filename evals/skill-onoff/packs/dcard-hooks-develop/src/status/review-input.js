'use strict';

// src/status/review-input.js — the review facts of the runs watcher (stage-graph P7d; plan Owner addendum A1).
//
//   readPlanReview({ identity, stateRoot })  -> the relevant plan-review state of this repo, or null
//   readCodeReview({ liveBase, key })        -> the latest hetero-review-loop round summary of this repo, or null
//   buildReviewFact({ ... })                 -> { schema, project_key, plan, code, published_at } or null (both absent)
//   createReviewPublisher(...)               -> .publish({ nowMs }) writes <live>/runs/<project_key>.review.json
//
// Plan review. dispatch-plan-review.js keeps `<stateRoot>/<session_key>/state.json` (+ generation-NN.json); stateRoot is
// $AUTOPILOT_PLAN_REVIEW_STATE_DIR or ~/.autopilot/plan-review. Selection of "the relevant" state is explicit:
//   1. only states whose `repo_identity` equals this repo's identity count (a state of another repo is invisible);
//      a state that is unreadable, not version 2, or whose `session_key` differs from its directory name is skipped;
//   2. an ACTIVE state (terminal !== true) beats any terminal one;
//   3. among the same class the most recent wins (newest state.json mtime; ties: the lexically greater session_key).
// Fields: logical_plan_id, generation (the active claim's, else the highest generation artifact, else 0), max_generations,
// terminal, verdict (terminal_verdict when terminal, else the latest generation artifact verdict, else null),
// seats [{id, family, status}] (status = that seat's verdict in the latest generation artifact; no artifact -> []),
// updated_at (ISO of the state.json mtime).
//
// Code review. scripts/hetero-review-loop.js `collect` writes `<live>/review-rounds/<project_key>.json`
// (schema autopilot.review-round/1) when a round completes; one file per repo, the latest round overwrites. Shape:
// { phase, generation, base, head, seats:[{id, family, status, verdict}], converged, at }.
//
// Everything fails closed to "absent": a missing or malformed source yields null, never a throw.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FACT_SCHEMA = 'autopilot.review/1';
const ROUND_SCHEMA = 'autopilot.review-round/1';
const SESSION_KEY_RE = /^[0-9a-f]{64}$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; }
}

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function str(v) { return typeof v === 'string' && v !== '' ? v : null; }

function defaultStateRoot(env) {
  return (env && env.AUTOPILOT_PLAN_REVIEW_STATE_DIR) || path.join(os.homedir(), '.autopilot', 'plan-review');
}

function latestGeneration(dir) {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_error) { return null; }
  for (const n of names) {
    const m = /^generation-(\d+)\.json$/.exec(n);
    if (!m) continue;
    const g = Number(m[1]);
    if (best === null || g > best.generation) {
      const artifact = readJson(path.join(dir, n));
      if (isObject(artifact)) best = { generation: g, artifact };
    }
  }
  return best;
}

function readPlanReview({ identity, stateRoot, env }) {
  if (typeof identity !== 'string' || identity === '') return null;
  const root = stateRoot || defaultStateRoot(env);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_error) { return null; }
  let best = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_KEY_RE.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const file = path.join(dir, 'state.json');
    const state = readJson(file);
    if (!isObject(state) || state.version !== 2 || state.repo_identity !== identity || state.session_key !== entry.name) continue;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch (_error) { continue; }
    const active = state.terminal !== true;
    const better = !best
      || (active && !best.active)
      || (active === best.active && (mtimeMs > best.mtimeMs || (mtimeMs === best.mtimeMs && entry.name > best.sessionKey)));
    if (better) best = { dir, state, mtimeMs, active, sessionKey: entry.name };
  }
  if (!best) return null;
  const { state, dir, mtimeMs } = best;
  const latest = latestGeneration(dir);
  const claimGen = isObject(state.active_claim) && Number.isInteger(state.active_claim.generation) ? state.active_claim.generation : null;
  const generation = claimGen !== null ? claimGen : latest ? latest.generation : 0;
  const reviewers = latest && Array.isArray(latest.artifact.reviewer_verdicts) ? latest.artifact.reviewer_verdicts : [];
  const seats = reviewers
    .filter((r) => isObject(r) && str(r.seat_id))
    .map((r) => ({ id: r.seat_id, family: str(r.family), status: str(r.verdict) }));
  const terminal = state.terminal === true;
  return {
    logical_plan_id: str(state.logical_plan_id),
    generation,
    max_generations: Number.isInteger(state.max_generations) ? state.max_generations : null,
    terminal,
    verdict: terminal ? str(state.terminal_verdict) : latest ? str(latest.artifact.verdict) : null,
    seats,
    updated_at: new Date(mtimeMs).toISOString(),
  };
}

function roundPath(liveBase, key) {
  return path.join(liveBase, 'review-rounds', `${key}.json`);
}

function readCodeReview({ liveBase, key }) {
  if (!liveBase || !key) return null;
  const v = readJson(roundPath(liveBase, key));
  if (!isObject(v) || v.schema !== ROUND_SCHEMA || v.project_key !== key || !Array.isArray(v.seats)) return null;
  return {
    phase: str(v.phase),
    generation: Number.isInteger(v.generation) ? v.generation : null,
    base: str(v.base),
    head: str(v.head),
    seats: v.seats.filter(isObject).map((s) => ({ id: str(s.id), family: str(s.family), status: str(s.status), verdict: str(s.verdict) })),
    converged: v.converged === true,
    at: str(v.at),
  };
}

function buildReviewFact({ identity, key, liveBase, stateRoot, env, nowMs }) {
  const plan = readPlanReview({ identity, stateRoot, env });
  const code = readCodeReview({ liveBase, key });
  if (!plan && !code) return null;
  return { schema: FACT_SCHEMA, project_key: key, plan, code, published_at: new Date(nowMs).toISOString() };
}

function stable(fact) {
  return JSON.stringify({ plan: fact.plan, code: fact.code });
}

const REWRITE_S = 60;

function createReviewPublisher({ runsDir, key, live, getIdentity, writeAtomic, env, stateRoot, log = () => {} }) {
  const file = path.join(runsDir, `${key}.review.json`);
  let last = null; // { stable, atMs }
  function publish({ nowMs }) {
    let fact = null;
    try { fact = buildReviewFact({ identity: getIdentity(), key, liveBase: live, stateRoot, env, nowMs }); } catch (error) { log(`review fact failed: ${error.message}`); return; }
    if (!fact) {
      if (last || fs.existsSync(file)) { try { fs.unlinkSync(file); } catch (_error) { /* gone already */ } last = null; }
      return;
    }
    const s = stable(fact);
    if (last && last.stable === s && nowMs - last.atMs < REWRITE_S * 1000 && fs.existsSync(file)) return;
    try { writeAtomic(file, `${JSON.stringify(fact, null, 2)}\n`); last = { stable: s, atMs: nowMs }; } catch (error) { log(`review fact write failed: ${error.message}`); }
  }
  return { publish };
}

module.exports = { FACT_SCHEMA, ROUND_SCHEMA, readPlanReview, readCodeReview, buildReviewFact, createReviewPublisher, roundPath };
