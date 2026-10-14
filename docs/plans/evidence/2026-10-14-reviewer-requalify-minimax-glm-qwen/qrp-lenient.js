#!/usr/bin/env node
'use strict';
// qrp-lenient.js — runs the REAL scripts/qualification-review-provider.js with ONE behavioural patch, VA mode only:
// when the model's reply holds no parseable JSON object, pass the raw reply through as `output` instead of exiting 1.
// Why: the provider exits 1 ("model response contained no parseable JSON object"), the broker reports
// provider_process_failed, and engine-qualify aborts the whole VA administration as a transport_fail with NO verdict.
// But engine-qualify's own parseVaPlanOutput() already treats unparseable output as a null plan = a FAILED case.
// So a model that emits malformed JSON must be graded (fail), not abort the exam (owner: every question runs to completion).
// The source is patched in memory only; the shipped provider file is untouched. The patch must apply or this exits 2.
const fs = require('fs'), path = require('path'), Module = require('module');
const real = path.resolve(__dirname, '../../../../scripts/qualification-review-provider.js');
const from = "const output = extractJsonObject(result.text);\n  if (!output) fail('model response contained no parseable JSON object');";
const to = "const output = extractJsonObject(result.text) || (promptMode === 'va' ? String(result.text) : '');\n  if (!output) fail('model response contained no parseable JSON object');";
const src = fs.readFileSync(real, 'utf8');
if (src.split(from).length !== 2) { process.stderr.write('qrp-lenient: patch anchor not found exactly once; provider changed\n'); process.exit(2); }
const m = new Module(real, null);
m.filename = real; m.paths = Module._nodeModulePaths(path.dirname(real));
m._compile(src.replace(from, to), real);
