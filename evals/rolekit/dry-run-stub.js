#!/usr/bin/env node
'use strict';
// dry-run-stub.js -- a stand-in for the `claude` CLI used only by `run-pilot.js --dry-run`. Makes no network call and reads no
// credentials. Reads the prompt from stdin, looks its cell up in the scenario file (RKRUN_SCENARIO, {"A|weak1|role|task|rep": outcome}),
// and answers by outcome: "pass" (explorer only: a correct cited answer built from expected.json and the task input), "miss"
// (default: a well-formed but wrong answer), "infra" (empty output, exit 1), "auth" (stderr says authentication failed, exit 1),
// "quota" (stderr says rate limit, exit 1). Every call is appended to RKRUN_CALLS as one JSON line (the sentinel-calls count).
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
let prompt = ''; try { prompt = fs.readFileSync(0, 'utf8'); } catch (e) { /* no stdin */ }
const cell = process.env.RKRUN_CELL || '';
let scenario = {}; try { scenario = JSON.parse(fs.readFileSync(process.env.RKRUN_SCENARIO, 'utf8')); } catch (e) { /* none */ }
const frame = (prompt.match(/^<<<AUTOPILOT-AUTHOR-[0-9a-f]+>>>$/m) || [])[0]; // the author rail wraps its prompt in a nonce frame the answer must reuse
const endFrame = (prompt.match(/^<<<AUTOPILOT-END-[0-9a-f]+>>>$/m) || [])[0];
const emit = (t) => process.stdout.write(frame && endFrame ? `${frame}\n${t}\n${endFrame}\n` : t);
// A scenario value may be a list: the Nth call for this cell (counted in RKRUN_CALLS) takes the Nth entry, the last entry repeats.
let seen = 0; try { seen = fs.readFileSync(process.env.RKRUN_CALLS, 'utf8').split('\n').filter((l) => l && JSON.parse(l).cell === cell).length; } catch (e) { /* first call */ }
const want = scenario[cell];
const outcome = (Array.isArray(want) ? want[Math.min(seen, want.length - 1)] : want) || 'miss';
if (process.env.RKRUN_CALLS) {
  fs.appendFileSync(process.env.RKRUN_CALLS, `${JSON.stringify({ cell, outcome, argv_flags: argv.filter((a) => a.startsWith('--')), prompt_bytes: prompt.length })}\n`);
}
if (outcome === 'auth') { process.stderr.write('Error: authentication failed (invalid token), STOP_AUTH\n'); process.exit(1); }
if (outcome === 'quota') { process.stderr.write('Error: rate limit reached (usage limit)\n'); process.exit(1); }
if (outcome === 'infra') process.exit(1);

const role = cell.split('|')[2];
if (outcome === 'pass' && role === 'explorer') {
  const exp = JSON.parse(fs.readFileSync(path.join(process.env.RKRUN_TASK_DIR, 'expected.json'), 'utf8'));
  const answers = exp.questions.map((q) => {
    if (!q.expect_found) return { q: q.id, found: false, citations: [] };
    const lines = fs.readFileSync(path.join(process.env.RKRUN_TASK_DIR, 'input', q.file), 'utf8').split('\n');
    const re = new RegExp(q.needle);
    const i = lines.findIndex((l) => re.test(l));
    return { q: q.id, found: true, citations: [{ file: q.file, line: i + 1, quote: lines[i].trim() }] };
  });
  emit(`Here is my answer.\n\`\`\`json\n${JSON.stringify({ answers })}\n\`\`\`\n`);
} else {
  emit(`${JSON.stringify({ answers: [], findings: [], verdict: 'SHIP-AS-IS' })}\n`);
}
