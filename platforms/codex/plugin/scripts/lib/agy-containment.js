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

// Any tool-call encoding anywhere in a record, at any depth. Shared with
// kimi-containment.js: both runners are judged by the same "no tool call, however
// encoded" rule. Returns a short description of the first hit, or null.
const TOOL_TYPE_RE = /^(tool[._ -]?(call|calls|use|result|response)|function[._ -]?call)$/i;
function findToolEncoding(value, depth = 0) {
  if (depth > 40 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findToolEncoding(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value)) {
    if ((key === 'tool_calls' || key === 'toolCalls') && val && !(Array.isArray(val) && val.length === 0)) {
      return `${key} present`;
    }
    if ((key === 'tools' || key === 'tools_snapshot' || key === 'toolsSnapshot') && Array.isArray(val) && val.length > 0) {
      return `non-empty ${key}`;
    }
    if (key === 'tools_snapshot' || key === 'toolsSnapshot') {
      const inner = val && val.tools;
      if (Array.isArray(inner) && inner.length > 0) return `non-empty ${key}.tools`;
    }
    if (key === 'toolCallId' || key === 'tool_call_id') return `${key} present`;
    if ((key === 'type' || key === 'finishReason' || key === 'finish_reason') && typeof val === 'string' && TOOL_TYPE_RE.test(val)) {
      return `${key}=${JSON.stringify(val)}`;
    }
    const hit = findToolEncoding(val, depth + 1);
    if (hit) return hit;
  }
  return null;
}

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
//
// Two modes. Default (non-blind dispatch, qualification): the audit is exactly what it
// was before final-panel isolation phase 1 — plan §2.5, no behaviour change there.
// `cleanroom: true` (blind/cleanroom audit only, needs `agentsDir`) adds the positive
// agent marker and the stricter transcript rules below.
//
// agy 1.2.14 never writes the selected agent's NAME anywhere (verified with real calls):
// a selected custom agent logs `Starting new conversation (agent=true)` and
// `Creating new cascade trajectory (agentScript=true)`; a wrong name logs
// `Agent "<n>" not found, falling back to default` with agent=false/agentScript=false.
// So the marker is all of: agent=true, agentScript=true, no not-found line, and exactly
// one agent in the seat's agents dir (the tool-less one) — then agent=true can only
// mean that agent.
function auditAgyRun({ logDir, brainDir, cleanroom = false, agentsDir = null }) {
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

  if (cleanroom) {
    const notFound = logText.match(/Agent "([^"]*)" not found/);
    if (notFound) return `agy fell back to its default (fully tooled) agent: "${notFound[1]}" not found`;
    if (!logText.includes('Starting new conversation (agent=true)')) {
      return 'agy log lacks "Starting new conversation (agent=true)" — agent selection unverified';
    }
    if (!logText.includes('agentScript=true')) {
      return 'agy log lacks "agentScript=true" — agent selection unverified';
    }
    let agents = null;
    try {
      agents = agentsDir ? fs.readdirSync(agentsDir).filter((n) => !n.startsWith('.')) : null;
    } catch { /* unverified below */ }
    if (!agents) return `cannot list the seat agents dir ${agentsDir} — agent selection unverified`;
    if (agents.length !== 1 || agents[0] !== AGENT_NAME) {
      return `seat agents dir must hold exactly the tool-less agent "${AGENT_NAME}", found [${agents.join(', ')}]`;
    }
  }

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
  let stepCount = 0;
  for (const file of transcripts) {
    let text;
    if (cleanroom) {
      try { text = fs.readFileSync(file, 'utf8'); } catch { return `unreadable agy transcript ${file} — containment unverified`; }
    } else {
      text = fs.readFileSync(file, 'utf8');
    }
    const lines = text.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      let step;
      try { step = JSON.parse(line); } catch { return `unparseable agy transcript line in ${file}`; }
      if (cleanroom) {
        if (step === null || typeof step !== 'object' || Array.isArray(step)) return `non-object agy transcript line in ${file}`;
        stepCount += 1;
      }
      if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
        const names = step.tool_calls.map((call) => (call && call.name) || '?').join(', ');
        return `the model called tool(s) [${names}] (step ${step.step_index})`;
      }
      if (cleanroom) {
        const encoded = findToolEncoding(step);
        if (encoded) return `tool-call encoding in agy transcript: ${encoded} (step ${step.step_index})`;
      }
      if (!CLEAN_STEP_TYPES.has(step.type)) {
        return `unexpected agy transcript step type ${JSON.stringify(step.type)} (step ${step.step_index})`;
      }
    }
  }
  if (cleanroom && stepCount === 0) return `agy transcript under ${brainDir} holds no steps — containment unverified`;
  return null;
}

module.exports = { AGENT_NAME, AGENT_MD, DENY_RULES, writeToollessAgent, auditAgyRun, findToolEncoding };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'name' && !a) {
      process.stdout.write(`${AGENT_NAME}\n`);
    } else if (cmd === 'write' && a && !b) {
      writeToollessAgent(a);
    } else if (cmd === 'audit' && a && b) {
      // optional: --cleanroom <agents-dir> (blind/cleanroom audit); default = non-blind audit
      const extra = process.argv.slice(5);
      let opts = {};
      if (extra.length === 2 && extra[0] === '--cleanroom') opts = { cleanroom: true, agentsDir: extra[1] };
      else if (extra.length !== 0) { process.stderr.write('audit: unexpected arguments\n'); process.exit(2); }
      const breach = auditAgyRun({ logDir: a, brainDir: b, ...opts });
      if (breach) {
        process.stderr.write(`agy containment breach: ${breach}\n`);
        process.exit(1);
      }
    } else {
      process.stderr.write('usage: agy-containment.js name | write <agents-dir> | audit <log-dir> <brain-dir> [--cleanroom <agents-dir>]\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`agy containment: ${err.message}\n`);
    process.exit(1);
  }
}
