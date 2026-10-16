#!/usr/bin/env node
'use strict';
// opencode containment — the ONE owner of the deny-all invocation an opencode
// REVIEW/EXAM seat runs under (dispatch-review.sh opencode branch and
// qualification-review-provider.js opencode kind). Never used by the implementer
// rail (dispatch-hetero.sh), which must be able to write files.
//
// Facts (live adversarial probe 2026-10-16, opencode 1.19.2, model
// opencode-go/muse-spark-1.3-contributor; permission docs
// https://opencode.ai/docs/permissions/ ; config docs https://opencode.ai/docs/config/):
//   - The only reliable deny-all is BOTH a global `permission: {"*":"deny"}` AND a
//     custom primary agent whose own `permission` is `{"*":"deny"}`, delivered through
//     OPENCODE_CONFIG_CONTENT (inline JSON, highest-precedence config source).
//   - OPENCODE_CONFIG (a file) does NOT override a project opencode.json; a global
//     deny alone is overridden by a project agent md; `--agent plan` denies only
//     `edit` (bash, webfetch, MCP stay open).
//   - With both layers, a hostile project opencode.json / .opencode/agent/locked.md
//     / `tools: bash: true` could not re-open anything (3 repeats, 0 executions across
//     bash write, ~/.ssh read, write/edit, webfetch/websearch, MCP, task, grep/glob).
//   - --dir is an EMPTY scratch directory so there is no project config to read at all.
// Live re-verification: hooks/tests/opencode-deny-all-live.test.sh (AUTOPILOT_LIVE_OPENCODE=1).
//
// CLI:
//   node opencode-containment.js config      print the canonical OPENCODE_CONFIG_CONTENT JSON
//   node opencode-containment.js agent       print the agent name

const fs = require('fs');

const AGENT_NAME = 'locked';
const CONFIG = Object.freeze({
  permission: { '*': 'deny' },
  agent: { [AGENT_NAME]: { mode: 'primary', permission: { '*': 'deny' } } },
});
const CONFIG_JSON = JSON.stringify(CONFIG);

// argv for `opencode run` (prompt goes on stdin). `dir` must be an empty directory.
function lockedArgs({ model, variant, dir }) {
  const args = ['run', '--dir', dir, '--pure', '-m', model, '--agent', AGENT_NAME];
  if (variant) args.push('--variant', variant);
  args.push('--format', 'json');
  return args;
}

function lockedEnv(base) {
  return { ...base, OPENCODE_CONFIG_CONTENT: CONFIG_JSON };
}

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Returns null when the invocation is the locked one, else a breach string. Fail
// closed: any deviation (no env, other agent, no --pure, missing/non-empty --dir) refuses.
function assertLocked({ args, env }) {
  const raw = env && env.OPENCODE_CONFIG_CONTENT;
  if (!raw) return 'OPENCODE_CONFIG_CONTENT is not set';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return 'OPENCODE_CONFIG_CONTENT is not valid JSON'; }
  if (!deepEqual(parsed, CONFIG)) return 'OPENCODE_CONFIG_CONTENT is not the canonical deny-all config';
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  if (args[0] !== 'run') return 'argv is not an `opencode run` invocation';
  if (at('--agent') !== AGENT_NAME) return `--agent is not ${AGENT_NAME}`;
  if (!args.includes('--pure')) return '--pure is missing';
  const dir = at('--dir');
  if (!dir) return '--dir is missing';
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return '--dir is not a readable directory'; }
  if (entries.length !== 0) return '--dir is not empty';
  return null;
}

// `--format json` emits NDJSON; the answer is the LAST {"type":"text"} event's part.text.
function extractText(raw) {
  let last = '';
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev && ev.type === 'text' && ev.part && typeof ev.part.text === 'string') last = ev.part.text;
  }
  return last;
}

module.exports = { AGENT_NAME, CONFIG, CONFIG_JSON, lockedArgs, lockedEnv, assertLocked, extractText };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'config') process.stdout.write(`${CONFIG_JSON}\n`);
  else if (cmd === 'agent') process.stdout.write(`${AGENT_NAME}\n`);
  else { process.stderr.write('usage: opencode-containment.js config|agent\n'); process.exit(2); }
}
