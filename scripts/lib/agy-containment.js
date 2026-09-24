#!/usr/bin/env node
'use strict';
// agy containment — the ONE owner of the tool-less agent agy runs review/exam
// prompts under, and of the post-run audit that proves it held. Shared by
// scripts/qualification-review-provider.js (exam cases) and
// scripts/dispatch-review.sh (daily reviews) so the two cannot drift apart.
//
// Why an agent and not a deny list (probed 2026-09-24, agy 1.2.9):
//   - agy's permission system accepts exactly five actions: command / write_file /
//     read_file / read_url / mcp. Any other deny entry is logged `ignoring invalid
//     deny entry ... unknown action` and dropped — silently, exit 0.
//   - `search_web` is not a permission action at all, so no deny entry blocks it.
//     A live exam probe searched the web 8 times for the exam's own rule vocabulary.
//   - A custom agent with `excludeDefaultComponents: true` + `tools: []` is an
//     ALLOWLIST: five escape prompts under --dangerously-skip-permissions (shell
//     hostname, read a canary file, fetch a URL, list the dir, spawn a subagent)
//     ran zero tools, where the default agent leaked the real hostname and canary.
//   - `description` is REQUIRED. Without it agy logs `Agent "<name>" not found,
//     falling back to default` and runs the fully-tooled default agent, exit 0.
//     That is why the audit, not the exit code, decides.
//
// CLI:
//   node agy-containment.js write <agents-dir>        write <agents-dir>/<name>/agent.md, read back
//   node agy-containment.js audit <log-dir> <brain-dir>  exit 0 clean; exit 1 + breach on stderr
//   node agy-containment.js name                      print the agent name (for --agent)

const fs = require('fs');
const path = require('path');

const AGENT_NAME = 'autopilot-toolless-reviewer';
const AGENT_MD = [
  '---',
  `name: ${AGENT_NAME}`,
  'description: Text-only reviewer with no tools; answers from the prompt alone.',
  'mainAgent: true',
  'subagent: false',
  'hidden: true',
  'inheritMcp: false',
  'excludeDefaultComponents: true',
  'tools: []',
  '---',
  `# ${AGENT_NAME}`,
  'You are a text-only assistant with no tools. Answer from the prompt alone.',
  '',
].join('\n');

// agy 1.2.9's full permission-action vocabulary. Defense in depth only — the
// agent above is the containment; the audit fails the run if agy calls any of
// these invalid (i.e. the vocabulary drifted again).
const DENY_RULES = ['command(*)', 'write_file(*)', 'read_file(*)', 'read_url(*)', 'mcp(*)'];

// The only transcript steps a tool-less text answer produces. Allowlist: an
// unknown step type is a breach, not a pass.
const CLEAN_STEP_TYPES = new Set(['USER_INPUT', 'PLANNER_RESPONSE']);

function writeToollessAgent(agentsDir) {
  const agentPath = path.join(agentsDir, AGENT_NAME, 'agent.md');
  fs.mkdirSync(path.dirname(agentPath), { recursive: true });
  fs.writeFileSync(agentPath, AGENT_MD);
  let written = null;
  try { written = fs.readFileSync(agentPath, 'utf8'); } catch { /* checked below */ }
  if (written !== AGENT_MD) {
    throw new Error(`could not read back ${agentPath} intact — refusing to run agy without the tool-less agent`);
  }
  return agentPath;
}

// Returns a breach description, or null when the run provably used no tools.
// Fail closed: a missing log or transcript means containment is UNVERIFIED.
function auditAgyRun({ logDir, brainDir }) {
  let logText = '';
  try {
    for (const name of fs.readdirSync(logDir)) {
      if (name.endsWith('.log')) logText += fs.readFileSync(path.join(logDir, name), 'utf8');
    }
  } catch { /* handled as empty below */ }
  if (!logText) return `no agy log under ${logDir} — containment unverified`;
  if (logText.includes(`Agent "${AGENT_NAME}" not found`)) {
    return `agy fell back to its default (fully tooled) agent: "${AGENT_NAME}" not found`;
  }
  const invalid = logText.match(/ignoring invalid deny entry "[^"]*"/);
  if (invalid) return `agy rejected a forced deny rule (${invalid[0]}) — tool vocabulary drifted`;

  const transcripts = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'transcript.jsonl') transcripts.push(full);
    }
  };
  walk(brainDir, 0);
  if (transcripts.length === 0) return `no agy transcript.jsonl under ${brainDir} — containment unverified`;
  for (const file of transcripts) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
    for (const line of lines) {
      let step;
      try { step = JSON.parse(line); } catch { return `unparseable agy transcript line in ${file}`; }
      if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
        const names = step.tool_calls.map((call) => (call && call.name) || '?').join(', ');
        return `the model called tool(s) [${names}] (step ${step.step_index})`;
      }
      if (!CLEAN_STEP_TYPES.has(step.type)) {
        return `unexpected agy transcript step type ${JSON.stringify(step.type)} (step ${step.step_index})`;
      }
    }
  }
  return null;
}

module.exports = { AGENT_NAME, AGENT_MD, DENY_RULES, writeToollessAgent, auditAgyRun };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'name' && !a) {
      process.stdout.write(`${AGENT_NAME}\n`);
    } else if (cmd === 'write' && a && !b) {
      writeToollessAgent(a);
    } else if (cmd === 'audit' && a && b) {
      const breach = auditAgyRun({ logDir: a, brainDir: b });
      if (breach) {
        process.stderr.write(`agy containment breach: ${breach}\n`);
        process.exit(1);
      }
    } else {
      process.stderr.write('usage: agy-containment.js name | write <agents-dir> | audit <log-dir> <brain-dir>\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`agy containment: ${err.message}\n`);
    process.exit(1);
  }
}
