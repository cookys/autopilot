#!/usr/bin/env node
'use strict';

// scripts/lib/event-attribution.js - the five attribution fields that let a consumer (capacity: tokens per accepted
// merge, split by lane x model x pool) join a dispatch event or a cost.turn row to a run, a Fleet task, a pool and a commit.
//   run_id      the dispatch run id (cost rows: AUTOPILOT_PARENT_RUN_ID, which the rails export to the child; top-level session: null)
//   fleet_task  a Fleet task id, ULID shape only, else null
//   pool        subscription/account ALIAS (claude: acct-<sha8> or AUTOPILOT_ACCOUNT; other engines: noncq pool key, endpoint
//               name or runner name). Never a token, email or credential path (lib/account-alias.js returns hashes only).
//   commit      head sha the run produced, set only by an event emitted after the run ends; else null
//   lane        slug ^[a-z0-9][a-z0-9._-]{0,63}$ else null
// API: fleetTask(v) laneSlug(v) runIdOf(v) poolFor({runner,endpoint,env}) fromEnv(env)
// CLI: node event-attribution.js pool --runner R [--endpoint E]   -> prints a JSON string or null (always exit 0)
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { claudeAccount, codexAccount } = require('./account-alias');

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const LANE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RUN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const POOL_RE = /^[A-Za-z0-9_.-]+(:[A-Za-z0-9_.@-]+)?$/;
const CLAUDE_FAMILY = ['claude', 'claude-native', 'cc-shim', 'claude-code'];

const ok = (re, v) => (typeof v === 'string' && re.test(v) ? v : null);
const fleetTask = (v) => ok(ULID_RE, v);
const laneSlug = (v) => ok(LANE_RE, v);
const runIdOf = (v) => ok(RUN_RE, v);

function noncqKey(runner, endpoint) {
  try {
    const pools = JSON.parse(fs.readFileSync(path.join(__dirname, 'noncq-pools.json'), 'utf8'));
    const hits = Object.values(pools).filter((p) => p && p.runner === runner && (!p.endpoint || p.endpoint === endpoint));
    // an entry naming this endpoint is more specific than a runner-only entry
    const best = hits.find((p) => p.endpoint && p.endpoint === endpoint) || hits[0];
    return best ? ok(POOL_RE, best.key) : null;
  } catch (_) { return null; }
}

function poolFor({ runner, endpoint, env } = {}) {
  const e = env || process.env;
  const r = typeof runner === 'string' && runner ? runner : null;
  const ep = typeof endpoint === 'string' && endpoint ? endpoint : null;
  if (r && CLAUDE_FAMILY.includes(r) && !ep) return ok(POOL_RE, claudeAccount(e));
  if (r) {
    const key = noncqKey(r, ep);
    if (key) return key;
    if (ep) return ok(POOL_RE, ep);
    if (r === 'codex') return ok(POOL_RE, codexAccount(e));
    return ok(POOL_RE, r);
  }
  // no runner: a Claude session (cost-tracker)
  return ok(POOL_RE, claudeAccount(e));
}

// fleet_task: first non-empty of AUTOPILOT_FLEET_TASK / AUTOPILOT_UPSTREAM_TASK_ID, then validated, exactly as
// dispatch_fleet_task_json in lib/dispatch-lane.sh (keep the two in agreement; the rails export `none` for "no task").
// cost.turn side: what the rails exported to a dispatched child (or nothing, for a top-level session).
function fromEnv(env) {
  const e = env || process.env;
  return {
    run_id: runIdOf(e.AUTOPILOT_PARENT_RUN_ID),
    fleet_task: fleetTask(e.AUTOPILOT_FLEET_TASK || e.AUTOPILOT_UPSTREAM_TASK_ID),
    pool: poolFor({ env: e }),
    commit: null,
    lane: laneSlug(e.AUTOPILOT_LANE),
  };
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  let out = 'null';
  try {
    if (a[0] === 'pool') out = JSON.stringify(poolFor({ runner: get('--runner'), endpoint: get('--endpoint') }));
  } catch (_) { out = 'null'; }
  process.stdout.write(out);
}

module.exports = { fleetTask, laneSlug, runIdOf, poolFor, fromEnv, ULID_RE };
