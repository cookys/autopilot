#!/bin/bash
cd /tmp/hetero-mission-29b0e7f49725-blind-review-panel-parallel-2026-09-18-a1-i0xM8X
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
node - <<'NODE' > /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c2a/dogfood-panel.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c2a/dogfood-panel.err
const path=require('path');
const { dispatchReviewJsonBatch } = require(path.join(process.cwd(),'src/runners/review'));
const S='/tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c2a';
const t0=Date.now();
const rows=dispatchReviewJsonBatch([
  { args:['--runner','cc-shim','--model','MiniMax-M3','--endpoint','minimax','--effort','high','--timeout','10m','--diff-file',S+'/small.diff','--spec-file',S+'/small-spec.md'] },
  { args:['--runner','anthropic-compatible','--model','GLM-5.2','--endpoint','glm','--effort','high','--timeout','10m','--diff-file',S+'/small.diff','--spec-file',S+'/small-spec.md'] },
  { args:['--runner','claude-native','--model','claude-fable-5-1','--effort','high','--timeout','10m','--diff-file',S+'/small.diff','--spec-file',S+'/small-spec.md'] },
]);
const wall=Date.now()-t0;
console.log(JSON.stringify({ wall_ms: wall, seats: rows.map(r=>({ status:r.status, signal:r.signal, verdict:r.result&&r.result.verdict, rstatus:r.result&&r.result.status, error:r.result&&r.result.error, started_at:r.fanout&&r.fanout.started_at, ended_at:r.fanout&&r.fanout.ended_at })) }, null, 1));
NODE
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c2a/dogfood-panel.err
