#!/usr/bin/env node
'use strict';
// kimi containment — the ONE owner of the tool-less agent a kimi seat runs review
// prompts under, and of the post-run audit that proves it held. Counterpart of
// agy-containment.js (final-panel kimi/agy isolation, phase 1).
//
// Facts (spike 2026-10-02, kimi 2.1.1; docs https://moonshotai.github.io/kimi-code/en/customization/agents):
//   - kimi has no --tools / --no-tools / --sandbox flag. A custom agent file with
//     `tools: []` is an allowlist that disables every tool (`--agent-file <path>`).
//   - `description` is required; without it kimi errors rc=1 (fails closed). That is
//     NOT relied on: the audit decides, never the exit code.
//   - Every run writes <seat-home>/.kimi-code/sessions/**/wire.jsonl. K1 (default
//     agent) holds a `tool.call` loop event and a non-empty `llm.tools_snapshot`;
//     K2 (tool-less agent) holds `llm.tools_snapshot` with "tools":[] and none.
//
// Audit = verification by re-deriving from the run's own transcript, not an
// attestation (ADR-0001). Fail closed: a missing/empty wire, an unparseable line,
// an unknown record type, ANY tool-call encoding, a non-empty tool snapshot, or a
// missing/mismatched positive tool-less-agent marker is a breach.
//
// CLI:
//   node kimi-containment.js write <agents-dir>   write <agents-dir>/<name>.md, read back; print path
//   node kimi-containment.js audit <seat-home>    exit 0 clean; exit 1 + breach on stderr
//   node kimi-containment.js name                 print the agent name

const fs = require('fs');
const path = require('path');
const { findToolEncoding } = require('./agy-containment');

const AGENT_NAME = 'toolless-reviewer';
const AGENT_MD = [
  '---',
  `name: ${AGENT_NAME}`,
  'description: Text-only reviewer with no tools; answers from the prompt alone.',
  'tools: []',
  '---',
  'You are a text-only assistant with no tools. Answer from the prompt alone.',
  '',
].join('\n');

// Top-level wire record types seen in the captured K1/K2 wire files (kimi 2.1.1).
// Allowlist: an unknown type is a breach, not a pass.
const KNOWN_TYPES = new Set([
  'metadata', 'runtime.set_binding', 'profile.bind', 'permission.set_mode',
  'agent.message.appended', 'agent.turn.started', 'turn.prompt', 'context.append_message',
  'plugin.session_start', 'context.append_loop_event', 'llm.tools_snapshot', 'llm.request',
  'usage.record', 'token_counting.measured', 'agent.turn.ended', 'turn.ended',
  'token_counting.turn_recorded', 'prompt.completed',
]);
// context.append_loop_event .event.type values a tool-less text answer produces
// (tool.call / tool.result appear only in K1, never here).
const CLEAN_LOOP_EVENTS = new Set(['step.begin', 'step.end', 'content.part']);
const CLEAN_PART_TYPES = new Set(['think', 'text']);

function writeToollessAgent(agentsDir) {
  const agentPath = path.join(agentsDir, `${AGENT_NAME}.md`);
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(agentPath, AGENT_MD);
  let written = null;
  try { written = fs.readFileSync(agentPath, 'utf8'); } catch { /* checked below */ }
  if (written !== AGENT_MD) {
    throw new Error(`could not read back ${agentPath} intact — refusing to run kimi without the tool-less agent`);
  }
  return agentPath;
}

function findWires(root) {
  const wires = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'wire.jsonl') wires.push(full);
    }
  };
  walk(root, 0);
  return wires;
}

function auditWire(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return `unreadable kimi wire ${file} — containment unverified`; }
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return `kimi wire ${file} is empty — containment unverified`;
  let snapshots = 0;
  let boundProfile = null;
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { return `unparseable kimi wire line in ${file}`; }
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return `non-object kimi wire line in ${file}`;
    if (typeof rec.type !== 'string' || !KNOWN_TYPES.has(rec.type)) {
      return `unknown kimi wire record type ${JSON.stringify(rec.type)} in ${file}`;
    }
    const encoded = findToolEncoding(rec);
    if (encoded) return `tool-call encoding in kimi wire (${rec.type}): ${encoded}`;
    if (rec.type === 'llm.tools_snapshot') {
      if (!Array.isArray(rec.tools) || rec.tools.length !== 0) return 'kimi tool snapshot is not an empty list';
      snapshots += 1;
    } else if (rec.type === 'profile.bind') {
      boundProfile = rec.profileName;
    } else if (rec.type === 'context.append_loop_event') {
      const ev = rec.event;
      if (!ev || typeof ev.type !== 'string' || !CLEAN_LOOP_EVENTS.has(ev.type)) {
        return `unexpected kimi loop event type ${JSON.stringify(ev && ev.type)}`;
      }
      if (ev.type === 'content.part' && !(ev.part && CLEAN_PART_TYPES.has(ev.part.type))) {
        return `unexpected kimi content part type ${JSON.stringify(ev.part && ev.part.type)}`;
      }
    }
  }
  if (snapshots === 0) return `no llm.tools_snapshot in ${file} — tool-less agent unverified`;
  if (boundProfile !== AGENT_NAME) {
    return `kimi bound agent ${JSON.stringify(boundProfile)}, expected "${AGENT_NAME}" — agent fallback or unverified`;
  }
  return null;
}

// Returns a breach description, or null when every session in the seat provably
// used the tool-less agent and no tool. Fail closed on a missing wire.
function auditKimiRun({ seatHome }) {
  const root = path.join(seatHome, '.kimi-code', 'sessions');
  const wires = findWires(root);
  if (wires.length === 0) return `no kimi wire.jsonl under ${root} — containment unverified`;
  for (const file of wires) {
    const breach = auditWire(file);
    if (breach) return breach;
  }
  return null;
}

module.exports = { AGENT_NAME, AGENT_MD, writeToollessAgent, auditKimiRun };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'name' && !a) {
      process.stdout.write(`${AGENT_NAME}\n`);
    } else if (cmd === 'write' && a && !b) {
      process.stdout.write(`${writeToollessAgent(a)}\n`);
    } else if (cmd === 'audit' && a && !b) {
      const breach = auditKimiRun({ seatHome: a });
      if (breach) {
        process.stderr.write(`kimi containment breach: ${breach}\n`);
        process.exit(1);
      }
    } else {
      process.stderr.write('usage: kimi-containment.js name | write <agents-dir> | audit <seat-home>\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`kimi containment: ${err.message}\n`);
    process.exit(1);
  }
}
