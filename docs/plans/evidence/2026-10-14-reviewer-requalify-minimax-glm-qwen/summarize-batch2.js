#!/usr/bin/env node
// summarize-batch2.js — one line per batch2 cell: verdict/outcome, store event ids, key fields (read-only).
const fs = require('fs'), path = require('path');
const O = path.join(__dirname, 'out');
const cells = ['glm-consult', 'glm-discuss', 'glm-brain', 'minimax-discuss', 'minimax-brain', 'minimax31-consult', 'minimax31-discuss', 'minimax31-brain', 'qwen-discuss', 'qwen-brain'];
const last = (f) => { try { const t = fs.readFileSync(f, 'utf8').trim().split('\n'); return JSON.parse(t[t.length - 1]); } catch { return null; } };
for (const c of cells) {
  const d = path.join(O, 'm-' + c);
  const row = last(path.join(d, 'emit-row.json'));
  const ver = last(path.join(d, 'stderr.log')) || last(path.join(d, 'stdout.json'));
  const rec = last(path.join(d, 'record-out.json'));
  const rc = (() => { try { return fs.readFileSync(path.join(d, 'rc'), 'utf8').trim(); } catch { return '?'; } })();
  const out = { cell: c, rc };
  if (row) Object.assign(out, { status: row.status, quality: row.quality, score: row.capability_score, wall_s: row.latency && row.latency.sample_wall_time_s, scorecard_event: rec && rec.event_id, store_event: row.evidence_store && row.evidence_store.event_id, wall_truncated: JSON.stringify(row).includes('"wall_truncated":true') });
  else if (ver) Object.assign(out, { outcome: ver.outcome, subjects: ver.subjects, evidence_state: ver.evidence_state, store_event: ver.evidence_store_event_id, pair_delta: ver.pair_delta_count, spend_tokens: ver.spend_tokens, reason: ver.reason && String(ver.reason).slice(0, 200) });
  console.log(JSON.stringify(out));
}
