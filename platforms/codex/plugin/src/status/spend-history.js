'use strict';

// src/status/spend-history.js — the host-wide brain-tier spend time series the runs watcher publishes (TUI follow-up C).
//
//   <live>/runs/spend-history.json   schema autopilot.spend-history/1   (live dir = tmpfs, scripts/lib/live-state-dir.js)
//
// Spend is host-wide (the costs file is one per host), so the file is one per host, not per project: every project's watcher
// appends to it, and the 15-minute throttle is read from the FILE's last sample, so N watchers still add ~one sample per 15 min.
// Shape: { schema, updated_at, samples: [{ at: ISO, usd: number }] } oldest first; usd is the UTC-day cumulative
// host_today_brain_usd (cents-rounded), the number the band's spend slot already shows. The last 48 hours are kept.
// The reader (mods/live/model.ts) turns it into per-hour increments; a null spend (no costs file) adds no sample.
// Write is atomic (tmp + rename). Two watchers racing the read-modify-write can drop one sample; the next tick re-adds it.

const fs = require('fs');
const path = require('path');

const SCHEMA = 'autopilot.spend-history/1';
const SAMPLE_EVERY_S = 15 * 60;
const KEEP_MS = 48 * 3600 * 1000;
const MAX_SAMPLES = 400; // 48 h at one per 15 min is 192; the cap only bounds a clock that jumped around

function readSamples(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return []; }
  if (!parsed || parsed.schema !== SCHEMA || !Array.isArray(parsed.samples)) return [];
  const out = [];
  for (const s of parsed.samples) {
    if (s && typeof s.at === 'string' && Number.isFinite(Date.parse(s.at)) && typeof s.usd === 'number' && Number.isFinite(s.usd) && s.usd >= 0) out.push({ at: s.at, usd: s.usd });
  }
  return out;
}

function createSpendHistoryPublisher({ live, writeAtomic, log = () => {} }) {
  const file = path.join(live, 'runs', 'spend-history.json');

  // -> true when a sample was appended and the file written
  function publish({ nowMs, usd }) {
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return false;
    // a sample dated more than one throttle interval in the future (a clock that jumped) is stale: dropped, so sampling resumes
    const samples = readSamples(file).filter((x) => Date.parse(x.at) - nowMs <= SAMPLE_EVERY_S * 1000);
    const last = samples.length > 0 ? Date.parse(samples[samples.length - 1].at) : null;
    if (last !== null && nowMs - last < SAMPLE_EVERY_S * 1000) return false; // also when the clock went backwards
    const kept = samples.filter((s) => nowMs - Date.parse(s.at) <= KEEP_MS);
    kept.push({ at: new Date(nowMs).toISOString(), usd });
    const body = { schema: SCHEMA, updated_at: new Date(nowMs).toISOString(), samples: kept.slice(-MAX_SAMPLES) };
    try {
      writeAtomic(file, `${JSON.stringify(body)}\n`);
      return true;
    } catch (error) { log(`spend-history write failed: ${error.message}`); return false; }
  }

  return { publish, file };
}

module.exports = { SCHEMA, SAMPLE_EVERY_S, KEEP_MS, MAX_SAMPLES, createSpendHistoryPublisher };
