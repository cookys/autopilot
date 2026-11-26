#!/usr/bin/env node
'use strict';
// Spike: cold build time and peak RSS of the cn-gate 8-token shingle index for a repo (default: this repo). Not a gate.
const fs = require('fs');
const os = require('os');
const path = require('path');
const gate = require('./lib/cn-model-dispatch-gate');
const repo = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const runtime = fs.mkdtempSync('/dev/shm/cn-shingle-measure-');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-shingle-measure-'));
try {
  const brief = path.join(sandbox, 'brief.md');
  fs.writeFileSync(brief, 'Brief-Class: clean-sandbox\nTask: Measure.\nInputs: None.\nOutput: None.\nLimits: None.\n');
  const opts = { runner: 'kimi', model: 'kimi', endpoint: 'kimi', tier: 'T0', cwd: sandbox, files: [brief], sourceRepo: repo, env: { XDG_RUNTIME_DIR: runtime } };
  const t0 = process.hrtime.bigint();
  const cold = gate.check(opts);
  const coldS = Number(process.hrtime.bigint() - t0) / 1e9;
  const t1 = process.hrtime.bigint();
  gate.check(opts);
  const warmS = Number(process.hrtime.bigint() - t1) / 1e9;
  console.log(JSON.stringify({ repo_files_allowed: cold.allowed, cold_seconds: +coldS.toFixed(2), warm_seconds: +warmS.toFixed(2), peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024) }));
} finally { fs.rmSync(runtime, { recursive: true, force: true }); fs.rmSync(sandbox, { recursive: true, force: true }); }
