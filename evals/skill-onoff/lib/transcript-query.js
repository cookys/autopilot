#!/usr/bin/env node
// transcript-query.js — deterministic queries over a claude -p stream-json transcript.
// Event shape pinned by the 2026-08-18 Phase-0 probe: assistant messages carry
// message.content[] blocks with {type:"tool_use", name, input:{...}}.
//
// Usage:
//   transcript-query.js <transcript.jsonl> tool-events
//       → one line per tool_use, in transcript order: "<idx>\t<name>\t<detail>"
//         detail: Skill→input.skill · Bash→input.command (first 200 chars, newlines→⏎)
//                 Edit/Write/NotebookEdit→input.file_path · else→""
//   transcript-query.js <transcript.jsonl> skill-invoked <substr>
//       → exit 0 iff a Skill tool_use whose input.skill contains <substr> exists
//   transcript-query.js <transcript.jsonl> order <patternA> <patternB>
//       → exit 0 iff the FIRST event matching regex A (over "name\tdetail") occurs
//         BEFORE the FIRST event matching regex B. Missing A or B → exit 1.
//   transcript-query.js <transcript.jsonl> order-last <patternA> <patternB>
//       → exit 0 iff the LAST event matching regex A occurs AFTER the LAST event
//         matching regex B. Missing A or B → exit 1.
// Exit: 0 query true / 1 query false or no match / 2 usage or unreadable transcript.

'use strict';
const fs = require('fs');

const [file, cmd, ...args] = process.argv.slice(2);
if (!file || !cmd) {
  console.error('usage: transcript-query.js <transcript.jsonl> tool-events|skill-invoked|order ...');
  process.exit(2);
}
let lines;
try {
  lines = fs.readFileSync(file, 'utf8').split('\n');
} catch {
  console.error(`unreadable transcript: ${file}`);
  process.exit(2);
}

const events = [];
for (const line of lines) {
  if (!line.trim()) continue;
  let j;
  try { j = JSON.parse(line); } catch { continue; }
  const content = j && j.message && j.message.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (!block || block.type !== 'tool_use') continue;
    const input = block.input || {};
    let detail = '';
    if (block.name === 'Skill') detail = String(input.skill || '');
    else if (block.name === 'Bash') detail = String(input.command || '').slice(0, 200).replace(/\n/g, '⏎');
    else if (['Edit', 'Write', 'NotebookEdit'].includes(block.name)) detail = String(input.file_path || '');
    events.push({ idx: events.length, name: String(block.name || ''), detail });
  }
}

if (cmd === 'tool-events') {
  for (const e of events) process.stdout.write(`${e.idx}\t${e.name}\t${e.detail}\n`);
  process.exit(0);
}
if (cmd === 'skill-invoked') {
  const sub = args[0] || '';
  if (!sub) process.exit(2);
  process.exit(events.some((e) => e.name === 'Skill' && e.detail.includes(sub)) ? 0 : 1);
}
if (cmd === 'order' || cmd === 'order-last') {
  const [a, b] = args;
  if (!a || !b) process.exit(2);
  const reA = new RegExp(a);
  const reB = new RegExp(b);
  if (cmd === 'order') {
    const firstA = events.findIndex((e) => reA.test(`${e.name}\t${e.detail}`));
    const firstB = events.findIndex((e) => reB.test(`${e.name}\t${e.detail}`));
    process.exit(firstA >= 0 && firstB >= 0 && firstA < firstB ? 0 : 1);
  }
  let lastA = -1;
  let lastB = -1;
  events.forEach((e, i) => {
    const s = `${e.name}\t${e.detail}`;
    if (reA.test(s)) lastA = i;
    if (reB.test(s)) lastB = i;
  });
  process.exit(lastA >= 0 && lastB >= 0 && lastA > lastB ? 0 : 1);
}
console.error(`unknown query: ${cmd}`);
process.exit(2);
