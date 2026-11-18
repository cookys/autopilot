#!/usr/bin/env node
'use strict';
// Cursor has no usage reader. Broker verdicts update the same fleet.quota/1
// mirror as Kimi; no response text is kept here. Retry billing stops after 1 h.
const obs = require('./account-observation');
const RECHECK_S = 3600;
function observe({ verdict, liveDir, now, env = process.env } = {}) {
  if (!['done', 'stopped_billing'].includes(verdict)) return { wrote: false };
  const dir = liveDir || obs.liveDirOrNull({ env });
  if (!dir) return { wrote: false };
  const seconds = Math.floor((now ?? Date.now()) / 1000);
  const record = { schema: obs.SCHEMA, provider: 'cursor', alias: 'default', visibility: 'L1', windows: [] };
  if (verdict === 'stopped_billing') record.refusal = { observed_at: seconds, retry_at: seconds + RECHECK_S, reason: 'quota' };
  else Object.assign(record, { refusal: null, token_state: 'ok', token_state_at: seconds });
  const built = obs.buildRecord(record);
  return built.ok ? { wrote: obs.writeLocalRow(dir, built.record, {}).ok === true } : { wrote: false };
}
function cursorState({ liveDir, now, env = process.env } = {}) {
  const dir = liveDir || obs.liveDirOrNull({ env });
  if (!dir) return 'unknown';
  const { view } = obs.readView(dir, 'cursor', 'default', {});
  if (!view) return 'unknown';
  const seconds = Math.floor((now ?? Date.now()) / 1000);
  let available = false;
  for (const { record } of view.rows) {
    if (record.refusal) {
      const retry = record.refusal.retry_at ?? record.refusal.observed_at + RECHECK_S;
      if (retry > seconds) return 'exhausted';
      // The fixed recheck time admits a retry; its verdict refreshes the row.
      available = true;
    } else if (record.token_state === 'ok') available = true;
  }
  return available ? 'available' : 'unknown';
}
module.exports = { RECHECK_S, observe, cursorState };
if (require.main === module) {
  try { observe({ verdict: process.argv[2] }); } catch { /* observation is best effort */ }
}
