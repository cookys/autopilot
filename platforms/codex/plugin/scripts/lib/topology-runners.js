'use strict';

// topology-runners.js — how a host topology file (~/.autopilot/topology.json) is read when a
// rung names a runner this checkout no longer knows.
//
// WHY (2026-11-14 incident): qoderclicn was retired from every rail, but per-host topology
// files live outside the repo and kept two rungs on it; resolve-review-loop.sh exits 3 on an
// unknown runner, so every dispatch-consult on that host died. A topology is a regenerable
// cache, so an unknown rung is skipped with one warning instead of failing the resolver.
//
//   node topology-runners.js sanitize <in> <out>   write <in> minus skipped rungs to <out>;
//                                                   warnings on stderr; exit 1 = <in> unreadable
//                                                   or not JSON (caller keeps its old path)
//
// Node built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');

const RETIRED_FILE = path.join(__dirname, 'retired-runners.json');
// Rung lists in a topology file. Each entry is {engine, effort, runner, ...}.
const RUNG_LISTS = ['implementer_ladder', 'reviewer_ladder', 'consult_ladder', 'discuss_ladder', 'plan_review_panel'];
// Review/QC seat sets: emptied by skips they must fail closed (never a native, same-family review).
// The other lists keep skip + warn + native fallback.
const REVIEW_SEAT_LISTS = ['reviewer_ladder', 'plan_review_panel'];
// Tokens the resolver accepts that are not keys of the runner-binary map.
const EXTRA_KNOWN = ['auto', 'codex-cli'];

function retiredRunners(file) {
  const doc = JSON.parse(fs.readFileSync(file || RETIRED_FILE, 'utf8'));
  return doc.runners || {};
}

function knownRunnerSet(runnerBinaryMap) {
  const map = runnerBinaryMap || require('./runner-binary').RUNNER_VERSION_BINARY;
  return new Set([...Object.keys(map), ...EXTRA_KNOWN]);
}

function topologyPath() {
  return process.env.AUTOPILOT_TOPOLOGY_FILE || path.join(process.env.HOME || os.homedir(), '.autopilot', 'topology.json');
}

function specOf(r) {
  return `${r.engine}/${r.effort}@${r.runner}`;
}

// Rungs whose runner is not a known runner. why = 'retired' (in the registry) or 'unknown'.
function findUnknownRungs(doc, known, retired) {
  const found = [];
  for (const list of RUNG_LISTS) {
    if (!Array.isArray(doc[list])) continue;
    doc[list].forEach((r, index) => {
      const runner = r && r.runner;
      if (runner === 'kimi') {
        const brokerRole = list === 'implementer_ladder';
        const unavailable = brokerRole
          ? !require('./cursor-broker-client').brokerAvailable('kimi')
          : require('./kimi-local-stop').isStopped() || require('./kimi-quota-observe').exhaustedKimi();
        if (unavailable) {
          found.push({ list, index, spec: specOf(r), runner, why: brokerRole ? 'kimi_broker_unavailable' : 'kimi_local_stopped' });
          return;
        }
      }
      if (typeof runner !== 'string' || known.has(runner)) return;
      found.push({ list, index, spec: specOf(r), runner, why: Object.prototype.hasOwnProperty.call(retired, runner) ? 'retired' : 'unknown' });
    });
  }
  return found;
}

function dropRungs(doc, skipped) {
  const drop = new Set(skipped.map((s) => `${s.list}:${s.index}`));
  const out = { ...doc };
  for (const list of RUNG_LISTS) {
    if (Array.isArray(doc[list])) out[list] = doc[list].filter((_, i) => !drop.has(`${list}:${i}`));
  }
  return out;
}

function sanitizeCli(inFile, outFile) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  } catch {
    return 1;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 1;
  const skipped = findUnknownRungs(doc, knownRunnerSet(), retiredRunners());
  for (const s of skipped) {
    process.stderr.write(`resolve-review-loop: ⚠ skipped rung ${s.spec}: runner ${s.runner} ${s.why} (topology ${inFile})\n`);
  }
  const cleaned = dropRungs(doc, skipped);
  const emptied = RUNG_LISTS.filter((l) => skipped.some((s) => s.list === l) && cleaned[l].length === 0);
  for (const l of emptied) {
    const names = skipped.filter((s) => s.list === l).map((s) => s.spec).join(', ');
    process.stderr.write(`resolve-review-loop: ⚠ ${l} emptied by skipped rungs (${names}); regenerate the topology: node scripts/resolve-dispatch-topology.js, or run scripts/topology-prune.js --fix\n`);
  }
  // Marker for the resolver: a review seat set that skips left empty (spec names of the skipped rungs).
  const reviewEmptied = {};
  for (const l of emptied.filter((x) => REVIEW_SEAT_LISTS.includes(x))) {
    reviewEmptied[l] = skipped.filter((s) => s.list === l).map((s) => s.spec);
  }
  if (Object.keys(reviewEmptied).length) cleaned.review_sets_emptied_by_skips = reviewEmptied;
  fs.writeFileSync(outFile, JSON.stringify(cleaned), 'utf8');
  return 0;
}

module.exports = { RETIRED_FILE, RUNG_LISTS, REVIEW_SEAT_LISTS, retiredRunners, knownRunnerSet, topologyPath, specOf, findUnknownRungs, dropRungs };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'sanitize' && a && b) process.exit(sanitizeCli(a, b));
  process.stderr.write('usage: topology-runners.js sanitize <in> <out>\n');
  process.exit(2);
}
