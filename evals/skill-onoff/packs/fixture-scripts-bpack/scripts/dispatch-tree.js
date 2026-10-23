#!/usr/bin/env node
'use strict';
// Eval fixture stand-in for scripts/dispatch-tree.js. Prints one fixed session tree and nothing else.
// Usage: node scripts/dispatch-tree.js [--session <id>] [--json]
const tree = {
  schema_version: 1,
  session_id: 'fixture-session',
  counts: { agents: 2, rails: 2, untracked: 1 },
  root: {
    kind: 'session', id: 'fixture-session', children: [
      { kind: 'agent', id: 'agent-a1', agent_type: 'reviewer', description: 'diff review', untracked: false, children: [] },
      { kind: 'agent', id: 'agent-a2', agent_type: 'general-purpose', description: 'doc sweep', untracked: false, children: [
        { kind: 'rail', id: 'run-r1', role: 'review', runner: 'codex', final_status: null, untracked: false, children: [] },
      ] },
      { kind: 'rail', id: 'run-r2', role: 'review', runner: 'kimi', final_status: null, untracked: true, untracked_reason: 'parent_agent_not_found', children: [] },
    ],
  },
};
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(tree) + '\n');
} else {
  process.stdout.write([
    'session fixture-session',
    '  agent agent-a1 reviewer (diff review)',
    '  agent agent-a2 general-purpose (doc sweep)',
    '    rail run-r1 review via codex',
    '  rail run-r2 review via kimi [untracked: parent_agent_not_found]',
    '',
  ].join('\n'));
}
