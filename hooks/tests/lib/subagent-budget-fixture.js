#!/usr/bin/env node
'use strict';
// Fixture builder for hooks/tests/subagent-budget.test.sh.
//   node subagent-budget-fixture.js <projectDir> <sessionId> <nowMs> '<json array of agents>'
// Writes <projectDir>/<sessionId>.jsonl (main transcript, empty) and, per agent,
// <projectDir>/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json when `description` is given).
// Agent spec: { id, brief?: [lines after the Engine header], description?, turns?: n, ageMs?: age of every turn
// (default 60000), ages?: [per-turn ages], noTs?: true, mtimeAgeMs?: file mtime age (default 0), raw?: literal file text }.
const fs = require('fs');
const path = require('path');

const [projectDir, sessionId, nowArg, specArg] = process.argv.slice(2);
const now = Number(nowArg);
const agents = JSON.parse(specArg || '[]');
const dir = path.join(projectDir, sessionId, 'subagents');
fs.mkdirSync(dir, { recursive: true });
const main = path.join(projectDir, `${sessionId}.jsonl`);
if (!fs.existsSync(main)) fs.writeFileSync(main, '');

for (const a of agents) {
  const file = path.join(dir, `agent-${a.id}.jsonl`);
  let text;
  if (typeof a.raw === 'string') {
    text = a.raw;
  } else {
    const head = ['Engine: sonnet', ...(a.brief || []), 'body'].join('\n');
    const rows = [JSON.stringify({ type: 'user', agentId: a.id, isSidechain: true, message: { role: 'user', content: head } })];
    const n = a.turns === undefined ? 1 : a.turns;
    for (let i = 0; i < n; i++) {
      const age = Array.isArray(a.ages) ? a.ages[i] : (a.ageMs === undefined ? 60000 : a.ageMs);
      const rec = {
        type: 'assistant', agentId: a.id, isSidechain: true, requestId: `r-${a.id}-${i}`,
        message: { id: `m-${a.id}-${i}`, model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: 'x' }],
          usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } },
      };
      if (!a.noTs) rec.timestamp = new Date(now - age).toISOString();
      rows.push(JSON.stringify(rec));
    }
    text = `${rows.join('\n')}\n`;
  }
  fs.writeFileSync(file, text);
  if (a.description !== undefined) fs.writeFileSync(path.join(dir, `agent-${a.id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: a.description }));
  const t = new Date(now - (a.mtimeAgeMs || 0));
  fs.utimesSync(file, t, t);
}
