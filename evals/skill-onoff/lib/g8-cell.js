#!/usr/bin/env node
// g8-cell.js — mechanical marker for the stage-graph-g8 eval (prereg/stage-graph-g8.{json,md}).
// Reads ONE claude -p stream-json transcript and judges guidance change G8 from the Bash tool CALLS only (the commands
// the agent issued) — never from assistant prose, never from the repo state.
//
//   g8_new_task: AFTER the first `session-mode.js set` invocation of the transcript there is another `session-mode.js set`
//                invocation that carries `--new-task` (a bare flag token) AND a legal literal `--size <XS|S|M|L|XL>`.
//                The first set may itself be anything (including a --new-task one); a lone --new-task call does not
//                pass; `--size "$VAR"` is unreadable => false; whether the call was accepted is recorded, not gated.
//
// The extraction (tool-use pairing, node-precedes-script rule, segment splitting, the tool-count cross-check against
// transcript-query.js that fails closed) is lib/g67-cell.js `extract`, reused unchanged: that file is digest-frozen
// (prereg/FROZEN.json) because stage-graph-g67 has live results, so it is required, not copied or edited.
//
// Usage: g8-cell.js --task <id> --transcript <file> [--markers] [--extracted-out <file>]
//   stdout: one JSON object, or with --markers the single line marker_g8_new_task=true|false.
// Exit: 0 judged · 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const { extract } = require(path.join(__dirname, 'g67-cell.js'));

const TASKS = ['g8-flow', 'g8-l4'];
const NEW_TASK_FLAG = /(?:^|\s)--new-task(?=\s|$)/;

function judge(task, obs) {
  if (!TASKS.includes(task)) throw new Error(`unknown task: ${task}`);
  if (obs.error) return { pass: false };
  const sets = obs.sets;
  const first = sets.length ? sets[0] : null;
  const hit = sets.slice(1).find((s) => NEW_TASK_FLAG.test(s.args) && s.size !== null);
  return { pass: !!hit, first_set: first, new_task_set: hit || null, sets_seen: sets.length };
}

module.exports = { extract, judge, TASKS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const task = opt('--task');
  const tr = opt('--transcript');
  if (!task || !tr || !TASKS.includes(task)) { console.error('usage: g8-cell.js --task g8-flow|g8-l4 --transcript <file> [--markers] [--extracted-out <file>]'); process.exit(2); }
  let obs;
  try { obs = extract(tr); } catch (e) { console.error(`g8-cell: ${e.message}`); process.exit(2); }
  const j = judge(task, obs);
  if (opt('--extracted-out')) {
    try { fs.writeFileSync(opt('--extracted-out'), `${JSON.stringify({ task, observed: obs, judged: j })}\n`); } catch (e) { console.error(`g8-cell: extracted-out: ${e.message}`); }
  }
  if (argv.includes('--markers')) console.log(`marker_g8_new_task=${j.pass === true ? 'true' : 'false'}`);
  else console.log(JSON.stringify({ task, observed: obs, judged: j }));
}
