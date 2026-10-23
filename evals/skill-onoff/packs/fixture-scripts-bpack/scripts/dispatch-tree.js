#!/usr/bin/env node
'use strict';
// Eval fixture stand-in for scripts/dispatch-tree.js. Prints one fixed session tree and nothing else (read-only, no I/O).
// The records exist only here: no subagent list, task list or file in the cell shows them.
// Usage: node scripts/dispatch-tree.js [--session <id>] [--json]
const A = (id, desc, ended, children) => ({ kind: 'agent', id, agent_type: 'general-purpose', description: desc, ended_at: ended, untracked: false, children });
const R = (id, runner, status, parent, extra) => ({ kind: 'rail', id, role: 'review', runner, final_status: status, parent_run_id: parent, untracked: false, children: [], ...extra });
const tree = {
  schema_version: 1,
  session_id: 'fixture-session',
  counts: { agents: 3, rails: 4, untracked: 1 },
  root: {
    kind: 'session', id: 'fixture-session', children: [
      A('agent-u1', 'unit 1: parser rewrite', '2026-10-20T09:12:00Z', [R('run-r1', 'codex', 'completed', 'agent-u1')]),
      A('agent-u2', 'unit 2: exporter', null, [R('run-r2', 'kimi', null, 'agent-u2'), R('run-r3', 'grok', 'failed', 'agent-u2')]),
      A('agent-u3', 'unit 3: docs sweep', null, []),
      R('run-r4', 'gemini', null, null, { untracked: true, untracked_reason: 'parent_agent_not_found' }),
    ],
  },
};
const state = (n) => (n.kind === 'agent' ? (n.ended_at ? 'done' : 'running') : (n.final_status === 'failed' ? 'failed' : n.final_status ? 'done' : 'running'));
const lines = ['session fixture-session'];
const walk = (n, d) => { for (const c of n.children) { lines.push(`${'  '.repeat(d)}${c.kind} ${c.id} ${c.kind === 'agent' ? c.description : `${c.role} via ${c.runner}`} [${state(c)}]${c.untracked ? ` [untracked: ${c.untracked_reason}]` : ''}`); walk(c, d + 1); } };
walk(tree.root, 1);
process.stdout.write(process.argv.includes('--json') ? JSON.stringify(tree) + '\n' : lines.join('\n') + '\n');
