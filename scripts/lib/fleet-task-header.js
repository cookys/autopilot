#!/usr/bin/env node
// fleet-task-header.js — the one shared X-Fleet-Task validator (S2 gateway join, 2026-11-14).
//
// A GPU-host model gateway logs per-request speed and joins it to fleet tasks by the HTTP
// header `X-Fleet-Task: <fleet task id>`. The id reaches the rails as the env var
// AUTOPILOT_UPSTREAM_TASK_ID (the same value dispatch-usage.js records as upstream.task_id).
// Every gateway-bound call site resolves the header HERE; the ULID check is never inlined
// elsewhere — ANTHROPIC_CUSTOM_HEADERS is newline-separated, so an unvalidated value could
// inject extra headers onto every request a child makes.
//
// Rule (S2 round 2 — gateway allowlist + ULID gate):
//   Allowlist = AUTOPILOT_FLEET_GATEWAY_ENDPOINTS (comma-separated, case-insensitive;
//   set-but-empty overrides config.json and means none) else config.json fleet_gateway_endpoints
//   array. Default: empty (no endpoint is a gateway).
//   Endpoint name missing or not in the allowlist -> no header and no warning line.
//   Endpoint allowlisted and V (AUTOPILOT_UPSTREAM_TASK_ID) is a ULID -> send X-Fleet-Task: V.
//   Endpoint allowlisted and V unset or empty                          -> no header.
//   Endpoint allowlisted and V set but not a ULID                      -> no header, and one stderr line
//       `<rail>: AUTOPILOT_UPSTREAM_TASK_ID is not a ULID; X-Fleet-Task not sent`.
//
// CLI (the bash rails): node lib/fleet-task-header.js --rail <rail-name> [--endpoint <name>]
//   stdout: the ANTHROPIC_CUSTOM_HEADERS value (`X-Fleet-Task: V`) or nothing.
//   stderr: the refusal line above when endpoint is allowlisted and V is set but invalid.
//   exit 0 in every case — a bad id degrades to no header, never a failed dispatch.
//
// API (the Node dispatchers):
//   parseGatewayAllowlist(raw) -> string[] (trimmed, lowercased, non-empty, deduplicated)
//   readGatewayAllowlist({ env?, home? }) -> string[]
//   resolveFleetTask(value, endpointName, opts?) -> { ok: boolean, id: string }
//     ok:true,  id:''       not a gateway endpoint or unset/empty id — send no header
//     ok:true,  id:'<ULID>' send `X-Fleet-Task: <ULID>`
//     ok:false, id:''       gateway endpoint + invalid id — send nothing; print warnLine('<rail>') once
//   headerLine(id) -> 'X-Fleet-Task: <id>' or '' (the ANTHROPIC_CUSTOM_HEADERS value)
//   warnLine(rail) -> the exact stderr refusal line
'use strict';

const fs = require('fs');
const { configPath } = require('./config-path');

// Crockford base32: digits and letters minus I, L, O, U.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEADER_NAME = 'X-Fleet-Task';
const SOURCE_ENV = 'AUTOPILOT_UPSTREAM_TASK_ID';
const GATEWAY_ENV = 'AUTOPILOT_FLEET_GATEWAY_ENDPOINTS';
const GATEWAY_CONFIG_KEY = 'fleet_gateway_endpoints';

function parseGatewayAllowlist(raw) {
  let items;
  if (typeof raw === 'string') {
    items = raw.split(',');
  } else if (Array.isArray(raw)) {
    items = raw;
  } else {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const norm = item.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function readGatewayAllowlist(opts = {}) {
  const o = opts || {};
  const env = o.env || process.env;
  if (Object.prototype.hasOwnProperty.call(env, GATEWAY_ENV)) {
    return parseGatewayAllowlist(env[GATEWAY_ENV]);
  }
  const cfgFile = configPath({ env, home: o.home });
  try {
    const raw = fs.readFileSync(cfgFile, 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return [];
    return parseGatewayAllowlist(cfg[GATEWAY_CONFIG_KEY]);
  } catch {
    return [];
  }
}

function resolveFleetTask(value, endpointName, opts) {
  const ep = typeof endpointName === 'string' ? endpointName.trim().toLowerCase() : '';
  if (!ep) return { ok: true, id: '' };
  const allowlist = readGatewayAllowlist(opts);
  if (!allowlist.includes(ep)) return { ok: true, id: '' };
  if (value === undefined || value === null || value === '') return { ok: true, id: '' };
  return ULID_RE.test(value) ? { ok: true, id: value } : { ok: false, id: '' };
}

function headerLine(id) {
  return id ? `${HEADER_NAME}: ${id}` : '';
}

function warnLine(rail) {
  return `${rail}: ${SOURCE_ENV} is not a ULID; ${HEADER_NAME} not sent`;
}

module.exports = {
  HEADER_NAME,
  SOURCE_ENV,
  GATEWAY_ENV,
  GATEWAY_CONFIG_KEY,
  parseGatewayAllowlist,
  readGatewayAllowlist,
  resolveFleetTask,
  headerLine,
  warnLine,
};

if (require.main === module) {
  let rail = 'dispatch';
  let endpoint = '';
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rail' && i + 1 < argv.length) {
      rail = argv[++i] || 'dispatch';
    } else if (argv[i] === '--endpoint' && i + 1 < argv.length) {
      endpoint = argv[++i] || '';
    } else if (argv[i].startsWith('--endpoint=')) {
      endpoint = argv[i].slice('--endpoint='.length);
    }
  }
  const { ok, id } = resolveFleetTask(process.env[SOURCE_ENV], endpoint);
  if (!ok) process.stderr.write(`${warnLine(rail)}\n`);
  const line = headerLine(id);
  if (line) process.stdout.write(`${line}\n`);
}
