#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENT_MAP = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  PreToolUse: 'pre_tool_use',
  PermissionRequest: 'permission_request',
  PostToolUse: 'post_tool_use',
  PostToolUseFailure: 'post_tool_use_failure',
  PreCompact: 'pre_compact',
  PostCompact: 'post_compact',
  UserPromptSubmit: 'user_prompt_submit',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
  Stop: 'stop',
};
const NORMALIZED_EVENTS = new Set(Object.values(EVENT_MAP));

const ENV_KEYS = [
  'PLUGIN_ROOT',
  'PLUGIN_DATA',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA',
  'CODEX_HOME',
];
const EMPTY_PAYLOAD = Object.freeze(Object.create(null));
const DEFAULT_MAX_EVENT_LOG_BYTES = 1024 * 1024;

function normalizeEventName(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  if (EVENT_MAP[name]) return EVENT_MAP[name];
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return NORMALIZED_EVENTS.has(normalized) ? normalized : 'unknown';
}

function knownHostEvent(name) {
  return name && typeof name === 'string' && EVENT_MAP[name] ? name : null;
}

function firstKnownHostEvent(payload) {
  return knownHostEvent(payload.hook_event_name)
    || knownHostEvent(payload.hookEventName)
    || knownHostEvent(payload.event)
    || null;
}

function normalizeProbeEvent(payload, hostEvent) {
  if (hostEvent) return normalizeEventName(hostEvent);
  return normalizeEventName(payload.event);
}

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return EMPTY_PAYLOAD;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_PAYLOAD;
    return parsed;
  } catch {
    return EMPTY_PAYLOAD;
  }
}

function outputDir() {
  if (process.env.PLUGIN_DATA) {
    return path.join(process.env.PLUGIN_DATA, 'autopilot-codex-hook-probe');
  }
  return path.join(os.homedir(), '.autopilot', 'codex-hook-probe');
}

function maxEventLogBytes() {
  const parsed = parseInt(process.env.AUTOPILOT_HOOK_PROBE_MAX_BYTES || '', 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return DEFAULT_MAX_EVENT_LOG_BYTES;
}

function rotateLogIfLarge(file, limitBytes) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < limitBytes) return;
    const rotated = `${file}.1`;
    try { fs.unlinkSync(rotated); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.renameSync(file, rotated);
    try { fs.chmodSync(rotated, 0o600); } catch { /* best effort */ }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function envPresence() {
  const output = {};
  for (const key of ENV_KEYS) {
    output[key] = Boolean(process.env[key]);
  }
  return output;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sortedKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function valueShape(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array' };
  if (typeof value === 'object') return { type: 'object', key_count: sortedKeys(value).length };
  return { type: typeof value };
}

function buildRecord(payload) {
  const hostEvent = firstKnownHostEvent(payload);
  const hasToolInput = hasOwn(payload, 'tool_input');
  const hasToolOutput = hasOwn(payload, 'tool_output');
  return {
    schema_version: 1,
    platform: 'codex',
    event: normalizeProbeEvent(payload, hostEvent),
    host_event: hostEvent,
    ts: new Date().toISOString(),
    session_id: null,
    cwd: null,
    source: null,
    model: null,
    permission_mode: null,
    turn_id: null,
    tool: null,
    tool_input: null,
    tool_output: null,
    session: {
      transcript_path: null,
    },
    probe: {
      env_present: envPresence(),
      payload_key_count: sortedKeys(payload).length,
      field_presence: {
        session_id: hasOwn(payload, 'session_id'),
        cwd: hasOwn(payload, 'cwd'),
        source: hasOwn(payload, 'source'),
        model: hasOwn(payload, 'model'),
        permission_mode: hasOwn(payload, 'permission_mode'),
        turn_id: hasOwn(payload, 'turn_id'),
        tool_name: hasOwn(payload, 'tool_name'),
        hook_event_name: hasOwn(payload, 'hook_event_name'),
        hookEventName: hasOwn(payload, 'hookEventName'),
        event: hasOwn(payload, 'event'),
        transcript_path: hasOwn(payload, 'transcript_path'),
      },
      cwd_present: typeof payload.cwd === 'string',
      transcript_path_present: typeof payload.transcript_path === 'string',
      tool_input_shape: hasToolInput ? valueShape(payload.tool_input) : null,
      tool_output_shape: hasToolOutput ? valueShape(payload.tool_output) : null,
      raw_value_policy: 'omitted',
    },
  };
}

function main() {
  try {
    const dir = outputDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'events.jsonl');
    rotateLogIfLarge(file, maxEventLogBytes());
    fs.appendFileSync(file, JSON.stringify(buildRecord(readPayload())) + '\n', { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  } catch (error) {
    try {
      process.stderr.write(`[autopilot-hook-probe] warning: ${error.message || error}\n`);
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

main();
